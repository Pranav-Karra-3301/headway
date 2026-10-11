// Owner: T6. `jev-compare`: rules-only champion vs Jev (generic instructions) vs Jev (evolved instructions) on
// stadium_exit × 2 train seeds (spec §9) → data/jev-compare.json.
//
//   pnpm --filter @headway/evolve exec tsx src/cli/jev-compare.ts [--champion champion|g0|ref|gN|<file>]
//        [--evolved <file: policy | advisor | {advisor}>] [--design] [--rounds 1] [--seeds 1001,1002] [--timeout 5000]
//        [--out data/jev-compare.json] [--fake]
//
// --design runs Jev-track rounds: DeepSeek designers (Luminal, OpenRouter fallback) rewrite only the advisor, each
// candidate is scored with Jev on the same seeds, and the best becomes the evolved arm. --fake uses an offline
// stand-in for Jev (no network) to check the pipeline. Reads OPENROUTER_API_KEY / LUMINAL_API_KEY from the root .env.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { G0, validatePolicy } from '@headway/sim';
import type { DecisionProvider, Policy, ScenarioInstance } from '@headway/sim';
import { createOpenAICompatClient, withFallback } from '../llm';
import {
  JEV_GENERIC_INSTRUCTIONS, compareJev, jevInstances, runJevArm, runRulesArm, withJevAdvisor,
  type JevAdvisor, type JevArm, type JevCompareReport,
} from '../jev/compare';
import { createJevProvider, withCache } from '../jev/provider';
import { designJevAdvisors, jevEvidence } from '../jev/track';
import { aggregateResults } from '../aggregate';
import {
  DATA_DIR, REPO_ROOT, WEB_DATA_DIR, formatTable, inputPath, outputPath, parseArgs, resolvePolicy, runIfMain, signedPct, writeJson,
} from './sweep';

const LUMINAL_MODEL = 'deepseek-ai/DeepSeek-V4.1-Flash';
const FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** KEY=VALUE lines of the root .env (quotes stripped). Values never printed. */
export function readEnv(path = join(REPO_ROOT, '.env')): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** `--champion`: built-ins / data generations via sweep's resolver; "champion" falls back to the web fixture, then g0. */
export function loadChampion(ref: string, log: (s: string) => void): Policy {
  try {
    return resolvePolicy(ref, { dataDir: DATA_DIR }).policy;
  } catch (err) {
    if (ref !== 'champion') throw err;
    const web = join(WEB_DATA_DIR, 'champion.json');
    if (existsSync(web)) {
      const raw: unknown = JSON.parse(readFileSync(web, 'utf8'));
      const v = validatePolicy(isObj(raw) && isObj(raw.policy) ? raw.policy : raw);
      if (v.ok) {
        log(`champion: no data/generations yet, using ${web} (${v.policy.meta.id})`);
        return v.policy;
      }
    }
    log('champion: no generations found, using g0');
    return structuredClone(G0);
  }
}

/** `--evolved <file>`: a Policy (its advisor), `{ advisor }`, or a bare advisor. */
export function loadAdvisor(path: string): JevAdvisor {
  const raw: unknown = JSON.parse(readFileSync(inputPath(path), 'utf8'));
  const a = isObj(raw) && isObj(raw.policy) && isObj(raw.policy.advisor) ? raw.policy.advisor
    : isObj(raw) && isObj(raw.advisor) ? raw.advisor : raw;
  if (!isObj(a) || typeof a.instructions !== 'string') throw new Error(`${path}: no advisor with instructions found`);
  return { provider: 'jev', enabled: true, askWhen: (a.askWhen ?? []) as JevAdvisor['askWhen'],
    holdOptionsS: (a.holdOptionsS ?? [0, 20, 40, 60]) as number[], instructions: a.instructions };
}

/** Counts real (uncached) provider calls and their latency. */
function counting(p: DecisionProvider, live: { calls: number; failures: number; latencyMs: number }): DecisionProvider {
  return {
    model: (p as { model?: string }).model,
    async choose(req) {
      live.calls++;
      try {
        const r = await p.choose(req);
        live.latencyMs += r.latencyMs;
        return r;
      } catch (e) {
        live.failures++;
        throw e;
      }
    },
  } as DecisionProvider;
}

/**
 * Offline stand-in for Jev (--fake): holds 20 s when the situation reports ≥ 5 transferring riders and the train is close,
 * else departs. Deterministic; for pipeline checks only.
 */
export function fakeJev(): DecisionProvider {
  return {
    async choose(req) {
      const xfer = Number(/with (\d+) riders? transferring/.exec(req.situation)?.[1] ?? 0);
      const hold = xfer >= 5 ? Math.max(0, req.options.findIndex((o) => o.startsWith('Hold'))) : 0;
      return { index: hold, probs: req.options.map((_, i) => (i === hold ? 0.8 : 0.2 / Math.max(1, req.options.length - 1))), latencyMs: 0 };
    },
  };
}

function table(report: JevCompareReport): string {
  return formatTable(
    ['arm', 'J (pax·h)', 'ΔJ vs rules', 'completion', 'missed', 'Jev asked', 'Jev choices'],
    report.arms.map((a) => [
      a.label,
      (a.score.J / 3600).toFixed(1),
      a.id === 'rules' ? '—' : signedPct(a.deltaPct),
      `${a.score.metrics.completionPct.toFixed(1)}%`,
      String(a.score.metrics.missedConnections),
      a.jev ? `${a.jev.answered}/${a.jev.asked}` : '—',
      a.jev ? Object.entries(a.jev.chosen).map(([k, v]) => `${k} ×${v}`).join(', ') || '—' : '—',
    ]),
  );
}

interface DesignCandidate { round: number; designer: number; valid: boolean; summary: string; rationale: string; errors: string[];
  model: string; advisor: JevAdvisor | null; J: number | null; deltaPct: number | null }

/** Jev-track rounds: design advisors from the current best Jev arm's evidence, score each with Jev, keep the best. */
async function designRounds(o: {
  rounds: number; champion: Policy; provider: DecisionProvider; instances: ScenarioInstance[]; timeoutMs: number;
  env: Record<string, string>; log: (s: string) => void;
}): Promise<{ best: JevAdvisor | null; candidates: DesignCandidate[] }> {
  const { env, log } = o;
  if (!env.LUMINAL_API_KEY && !env.OPENROUTER_API_KEY) throw new Error('--design needs LUMINAL_API_KEY or OPENROUTER_API_KEY in .env');
  const luminal = createOpenAICompatClient({ baseUrl: env.LUMINAL_BASE_URL || 'https://flash.luminal.cloud/v1', apiKey: env.LUMINAL_API_KEY ?? '', provider: 'luminal' });
  const openrouter = createOpenAICompatClient({ baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY ?? '', provider: 'openrouter' });
  const llm = env.LUMINAL_API_KEY ? withFallback(luminal, openrouter, FALLBACK_MODEL) : openrouter;
  const model = env.LUMINAL_API_KEY ? (env.LUMINAL_MODEL || LUMINAL_MODEL) : FALLBACK_MODEL;

  const rulesResults = runRulesArm(o.champion, o.instances);
  const rulesScore = aggregateResults(rulesResults);
  const rulesArm: JevArm = { id: 'rules', label: `Rules only (${o.champion.meta.id})`, policyId: o.champion.meta.id, advisor: null,
    score: rulesScore, deltaPct: 0, runs: [], jev: null };
  const scoreAdvisor = async (advisor: JevAdvisor, suffix: string) => {
    const policy = withJevAdvisor(o.champion, { ...advisor, enabled: true }, suffix);
    const { results, stats } = await runJevArm({ policy, provider: o.provider, instances: o.instances, timeoutMs: o.timeoutMs });
    const score = aggregateResults(results);
    const arm: JevArm = { id: 'jev_evolved', label: `Jev (${suffix})`, policyId: policy.meta.id, advisor: policy.advisor!, score,
      deltaPct: rulesScore.J > 0 ? ((score.J - rulesScore.J) / rulesScore.J) * 100 : 0, runs: [], jev: stats };
    return { arm, results };
  };

  const genericAdvisor = withJevAdvisor(o.champion, { instructions: JEV_GENERIC_INSTRUCTIONS }, 'g').advisor!;
  let current = o.champion.advisor?.instructions && o.champion.advisor.instructions !== JEV_GENERIC_INSTRUCTIONS
    ? { ...o.champion.advisor, enabled: true } : genericAdvisor;
  let currentScored = await scoreAdvisor(current, 'current');
  log(`design: starting point J ${Math.round(currentScored.arm.score.J)} (${signedPct(currentScored.arm.deltaPct)} vs rules)`);
  // The evolved arm is the best valid candidate (lowest J, earliest on ties) even when it does not beat the start, so the
  // Lab always shows what the designers produced; iteration continues from whichever is better.
  let best: { advisor: JevAdvisor; J: number } | null = null;
  const candidates: DesignCandidate[] = [];
  for (let round = 1; round <= o.rounds; round++) {
    const evidence = jevEvidence({ rules: rulesArm, jev: currentScored.arm, results: currentScored.results });
    log(`design round ${round}: asking 3 designers (${model})`);
    const designs = await designJevAdvisors({ llm, model, champion: o.champion, current, evidence });
    for (const [i, d] of designs.entries()) {
      if (!d.ok) {
        log(`  designer ${i}: invalid (${d.errors.slice(0, 2).join('; ')})`);
        candidates.push({ round, designer: i, valid: false, summary: '', rationale: '', errors: d.errors, model: d.model, advisor: null, J: null, deltaPct: null });
        continue;
      }
      const scored = await scoreAdvisor(d.advisor, `r${round}-${'abc'[i] ?? i}`);
      log(`  designer ${i}: J ${Math.round(scored.arm.score.J)} (${signedPct(scored.arm.deltaPct)} vs rules) — ${d.summary}`);
      candidates.push({ round, designer: i, valid: true, summary: d.summary, rationale: d.rationale, errors: [], model: d.model,
        advisor: d.advisor, J: scored.arm.score.J, deltaPct: scored.arm.deltaPct });
      if (!best || scored.arm.score.J < best.J) best = { advisor: d.advisor, J: scored.arm.score.J };
      if (scored.arm.score.J < currentScored.arm.score.J) { current = d.advisor; currentScored = scored; }
    }
    log(`design round ${round}: best so far J ${Math.round(currentScored.arm.score.J)} (${signedPct(currentScored.arm.deltaPct)} vs rules)`);
  }
  return { best: best?.advisor ?? (current === genericAdvisor ? null : current), candidates };
}

export interface JevCompareDeps { provider?: DecisionProvider; log?: (s: string) => void; env?: Record<string, string>; now?: () => string }

export async function main(argv: string[], deps: JevCompareDeps = {}): Promise<number> {
  const args = parseArgs(argv, ['design', 'fake']);
  const log = deps.log ?? ((s: string) => console.log(s));
  const env = deps.env ?? readEnv();
  const champion = loadChampion(args.get('champion') ?? 'champion', log);
  const seeds = (args.get('seeds') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const instances = seeds.length > 0
    ? seeds.map((seed) => ({ scenarioId: 'stadium_exit', seed, split: 'train' as const }))
    : jevInstances();
  const timeoutMs = Number(args.get('timeout') ?? 5000);
  const model = env.JEV_MODEL || 'typesafe/jev-1.13';
  const live = { calls: 0, failures: 0, latencyMs: 0 };
  let provider = deps.provider;
  if (!provider) {
    if (args.flag('fake')) provider = fakeJev();
    else {
      if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing from .env (or pass --fake)');
      provider = withCache(counting(createJevProvider({ baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model }), live));
    }
  }

  let evolved: JevAdvisor | null = args.get('evolved') ? loadAdvisor(args.get('evolved')!) : null;
  let design: { candidates: DesignCandidate[] } | undefined;
  if (args.flag('design')) {
    const rounds = Math.max(1, Math.min(5, Number(args.get('rounds') ?? 1) || 1));
    const out = await designRounds({ rounds, champion, provider, instances, timeoutMs, env, log });
    design = { candidates: out.candidates };
    if (out.best) evolved = out.best;
    else log('design: no valid candidate');
  }

  log(`comparing on ${instances.map((i) => `${i.scenarioId}#${i.seed}`).join(', ')} (Jev ${args.flag('fake') ? 'fake' : model}, ${timeoutMs} ms deadline)`);
  const report = await compareJev({ champion, provider, evolved, instances, timeoutMs, model: args.flag('fake') ? 'fake' : model, log, ...(deps.now ? { now: deps.now } : {}) });
  if (design) report.design = design;
  if (live.calls > 0) {
    const ok = live.calls - live.failures;
    report.notes.push(`Live Jev calls: ${live.calls} (${live.failures} failed), mean latency ${ok > 0 ? Math.round(live.latencyMs / ok) : 0} ms; repeated situations were served from the SHA-256 cache.`);
  }
  const out = outputPath(args.get('out') ?? 'data/jev-compare.json');
  writeJson(out, report, true);
  log('');
  log(table(report));
  for (const n of report.notes) log(`note: ${n}`);
  log(`wrote ${out}`);
  return 0;
}

runIfMain(import.meta.url, main);
