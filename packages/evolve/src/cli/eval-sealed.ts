// Owner: T8. `eval-sealed`: the sealed test split (spec §7) — champion, g0 and ref on secret seeds, POSTed to /api/admin/sealed-eval.
//
//   pnpm --filter @headway/evolve exec tsx src/cli/eval-sealed.ts [--url https://headway.….workers.dev] [--champion champion|gN|file]
//        [--env .env] [--scenarios stadium_exit,class_change] [--out sealed.json] [--no-post]
//
// Seeds come from SEALED_TEST_SEEDS in the root .env (a JSON array); when absent, 3 random seeds are generated and appended there.
// The seeds are never printed, logged, POSTed or written anywhere else — only an 8-hex fingerprint (`seedSet`) identifies the set.
// This file is a CLI only: nothing in the evolve loop imports it, so the test seeds never reach prompts or evolve code paths.
import { createHash, randomInt } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, G0, REF, SCENARIOS, TOWN, validatePolicy } from '@headway/sim';
import type { Metrics, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
import { aggregateResults } from '../aggregate';
import {
  DATA_DIR, REPO_ROOT, csv, formatTable, inputPath, mmss, outputPath, parseArgs, paxH, readGenerations, resolvePolicy, runIfMain, signedPct, simRun,
  writeJson, type NamedPolicy, type SimRun,
} from './sweep';

export const SEALED_KEY = 'SEALED_TEST_SEEDS';

// ---------- .env ----------

/** Minimal dotenv: `KEY=VALUE`, `export KEY=…`, '…' / "…" quotes, `#` comments (whole-line, or after an unquoted value). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    const q = v[0];
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]!] = v;
  }
  return out;
}

export function loadEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvText(readFileSync(path, 'utf8')) : {};
}

// ---------- seeds ----------

/** A JSON array (or comma list) of 1–10 distinct positive integers. Error messages never echo the value. */
export function parseSealedSeeds(value: string): number[] {
  const bad = () => new Error(`${SEALED_KEY} must be a JSON array of 1–10 distinct positive integers, e.g. [123456,234567,345678]`);
  const t = value.trim();
  let xs: unknown;
  if (t.startsWith('[')) {
    try {
      xs = JSON.parse(t);
    } catch {
      throw bad();
    }
  } else xs = t ? t.split(',').map((s) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN)) : [];
  if (!Array.isArray(xs) || xs.length < 1 || xs.length > 10) throw bad();
  if (!xs.every((x) => typeof x === 'number' && Number.isSafeInteger(x) && x > 0)) throw bad();
  if (new Set(xs).size !== xs.length) throw bad();
  return xs as number[];
}

/** Distinct seeds in [100000, 900000): far from train 1001–1004, val 2001–2002, showcase 4001–4003 and play 50000+day. */
export function generateSeeds(n = 3, randInt: (lo: number, hi: number) => number = randomInt): number[] {
  const out: number[] = [];
  for (let guard = 0; out.length < n && guard < 1000; guard++) {
    const s = randInt(100_000, 900_000);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length < n) throw new Error('could not generate distinct sealed seeds');
  return out;
}

/** Reads SEALED_TEST_SEEDS from the env file (then `fallbackValue`); otherwise generates 3 seeds and appends them to the file. */
export function ensureSealedSeeds(envPath: string, o: { randInt?: (lo: number, hi: number) => number; fallbackValue?: string } = {}): { seeds: number[]; generated: boolean } {
  const existing = loadEnvFile(envPath)[SEALED_KEY] ?? o.fallbackValue;
  if (existing !== undefined && existing.trim() !== '') return { seeds: parseSealedSeeds(existing), generated: false };
  const seeds = generateSeeds(3, o.randInt);
  const line = `${SEALED_KEY}=${JSON.stringify(seeds)}\n`;
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    appendFileSync(envPath, text.length > 0 && !text.endsWith('\n') ? `\n${line}` : line);
  } else writeFileSync(envPath, line, { mode: 0o600 });
  return { seeds, generated: true };
}

/** 8 hex chars of SHA-256 over the sorted seed list: tells seed sets apart without revealing them. */
export function seedSetId(seeds: number[]): string {
  return createHash('sha256').update([...seeds].sort((a, b) => a - b).join(',')).digest('hex').slice(0, 8);
}

/** stadium_exit and class_change, plus evening_commute when the sim defines it (spec §7). */
export function sealedScenarios(): string[] {
  const defined = (SCENARIOS ?? {}) as Record<string, unknown>;
  return ['stadium_exit', 'class_change', ...(defined.evening_commute ? ['evening_commute'] : [])];
}

export function sealedInstances(seeds: number[], scenarios: string[] = sealedScenarios()): ScenarioInstance[] {
  return scenarios.flatMap((scenarioId) => seeds.map((seed) => ({ scenarioId, seed, split: 'test' as const })));
}

// ---------- evaluation ----------

export type SealedRole = 'champion' | 'baseline' | 'reference';
export interface SealedResult {
  role: SealedRole;
  /** Generation id for the champion ('g7'), 'g0', 'ref'. */
  policyId: string;
  simVersion: string;
  /** J summed over every sealed run (seconds; lower is better). */
  jTest: number;
  /** = score.metrics (top-level for D1 `metrics_json` and the web's sealed readers). */
  metrics: Metrics;
  score: SplitScore;
  byScenario: Record<string, SplitScore>;
  deltaVsBaselinePct: number | null;
  createdAt: string;
}
/** Body of POST /api/admin/sealed-eval. Contains no seeds. */
export interface SealedEvalBody {
  simVersion: string; mapVersion: string;
  /** Fingerprint of the seed set (seedSetId). */
  seedSet: string;
  scenarios: string[]; seedsPerScenario: number;
  /** Runs per policy (= scenarios × seeds). */
  runs: number;
  createdAt: string;
  results: SealedResult[];
}

export function runSealedEval(o: { champion: NamedPolicy; instances: ScenarioInstance[]; run?: SimRun; now?: () => string }): SealedEvalBody {
  const run = o.run ?? simRun;
  const entries: Array<{ role: SealedRole; np: NamedPolicy }> = [
    { role: 'champion', np: o.champion },
    { role: 'baseline', np: { label: 'g0', policy: G0 } },
    { role: 'reference', np: { label: 'ref', policy: REF } },
  ];
  const cache = new Map<string, RunResult[]>();
  const resultsOf = (np: NamedPolicy) => {
    let rs = cache.get(np.label);
    if (!rs) {
      rs = o.instances.map((i) => run(np.policy, i));
      cache.set(np.label, rs);
    }
    return rs;
  };
  const scored = entries.map(({ role, np }) => {
    const rs = resultsOf(np);
    const byScenario: Record<string, SplitScore> = {};
    for (const id of [...new Set(rs.map((r) => r.scenarioId))]) byScenario[id] = aggregateResults(rs.filter((r) => r.scenarioId === id));
    return { role, np, rs, score: aggregateResults(rs), byScenario };
  });
  const baseJ = scored.find((s) => s.role === 'baseline')!.score.J;
  const first = scored[0]?.rs[0];
  const seeds = [...new Set(o.instances.map((i) => i.seed))];
  const createdAt = (o.now ?? (() => new Date().toISOString()))();
  return {
    simVersion: first?.simVersion ?? DEFAULT_CONFIG.simVersion,
    mapVersion: first?.mapVersion ?? TOWN.version,
    seedSet: seedSetId(seeds),
    scenarios: [...new Set(o.instances.map((i) => i.scenarioId))],
    seedsPerScenario: seeds.length,
    runs: o.instances.length,
    createdAt,
    results: scored.map((s) => ({
      role: s.role, policyId: s.np.label, simVersion: s.rs[0]?.simVersion ?? DEFAULT_CONFIG.simVersion, jTest: s.score.J, metrics: s.score.metrics,
      score: s.score, byScenario: s.byScenario, deltaVsBaselinePct: baseJ > 0 ? ((s.score.J - baseJ) / baseJ) * 100 : null, createdAt,
    })),
  };
}

// ---------- HTTP ----------

const trimSlash = (u: string) => u.replace(/\/+$/, '');

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function postSealedEval(baseUrl: string, token: string, body: SealedEvalBody, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number; response: unknown }> {
  try {
    const res = await fetchImpl(`${trimSlash(baseUrl)}/api/admin/sealed-eval`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, response: await readBody(res) };
  } catch (err) {
    return { ok: false, status: 0, response: err instanceof Error ? err.message : String(err) };
  }
}

/** The live champion (`GET /api/champion`), validated. */
export async function fetchChampion(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<NamedPolicy> {
  const res = await fetchImpl(`${trimSlash(baseUrl)}/api/champion`);
  if (!res.ok) throw new Error(`GET ${trimSlash(baseUrl)}/api/champion → ${res.status}`);
  const body = (await res.json()) as { policy?: unknown; generation?: { id?: unknown } | null };
  const v = validatePolicy(body.policy);
  if (!v.ok) throw new Error(`live champion does not validate: ${v.errors[0]}`);
  const id = typeof body.generation?.id === 'string' ? body.generation.id : v.policy.meta.id;
  return { label: id, policy: v.policy };
}

// ---------- CLI ----------

export interface SealedDeps {
  run?: SimRun; fetch?: typeof fetch; log?: (s: string) => void; randInt?: (lo: number, hi: number) => number; dataDir?: string;
  /** Process environment (ADMIN_TOKEN / HEADWAY_URL / SEALED_TEST_SEEDS fallbacks); defaults to process.env. */
  processEnv?: Record<string, string | undefined>;
}

const USAGE = `usage: tsx src/cli/eval-sealed.ts [--url <worker base URL>] [--champion champion|gN|g0|<file.json>] [--env .env]
                                [--scenarios a,b] [--out sealed.json] [--no-post]`;

export async function main(argv: string[], deps: SealedDeps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const fetchImpl = deps.fetch ?? fetch;
  const penv = deps.processEnv ?? process.env;
  const dataDir = deps.dataDir ?? DATA_DIR;
  const args = parseArgs(argv, ['help']);
  if (args.flag('help')) {
    log(USAGE);
    return 0;
  }
  const envPath = inputPath(args.get('env') ?? join(REPO_ROOT, '.env'));
  const url = args.get('url') ?? penv.HEADWAY_URL;
  const post = !!url && args.flag('post', true);

  let seeds: number[];
  let generated: boolean;
  try {
    ({ seeds, generated } = ensureSealedSeeds(envPath, { randInt: deps.randInt, fallbackValue: penv[SEALED_KEY] }));
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const fp = seedSetId(seeds);
  if (generated) {
    log(`Generated 3 sealed test seeds into ${envPath} (seed set ${fp}); they are never printed.`);
    log(`For the worker, copy the same value: pnpm --filter @headway/worker exec wrangler secret put ${SEALED_KEY}`);
  } else log(`Using ${seeds.length} sealed test seeds from ${envPath} (seed set ${fp}).`);

  const token = loadEnvFile(envPath).ADMIN_TOKEN ?? penv.ADMIN_TOKEN;
  if (post && !token) {
    log(`error: ADMIN_TOKEN is not set in ${envPath} or the environment; cannot POST (use --no-post to only evaluate)`);
    return 1;
  }

  let champion: NamedPolicy;
  try {
    const ref = args.get('champion');
    if (ref) champion = resolvePolicy(ref, { dataDir });
    else if (url) champion = await fetchChampion(url, fetchImpl);
    else if (readGenerations(dataDir).length > 0) champion = resolvePolicy('champion', { dataDir });
    else {
      log('note: no champion in data/generations and no --url; evaluating g0 as the champion');
      champion = { label: 'g0', policy: G0 };
    }
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    return 2;
  }

  const scenarioArg = csv(args.get('scenarios'));
  const instances = sealedInstances(seeds, scenarioArg.length ? scenarioArg : sealedScenarios());
  log(`Sealed evaluation: champion ${champion.label}, g0, ref × ${instances.length} runs (${[...new Set(instances.map((i) => i.scenarioId))].join(', ')} × ${seeds.length} seeds)`);
  const body = runSealedEval({ champion, instances, run: deps.run });

  log('');
  log(formatTable(
    ['role', 'policy', 'J_test pax-h', 'ΔJ vs g0', 'compl %', 'journey', 'mean wait', 'p95 wait', 'missed', 'left bhd', 'walkaway', ...body.scenarios.map((s) => `${s} J`)],
    body.results.map((r) => {
      const m = r.score.metrics;
      return [r.role, r.policyId, paxH(r.jTest), r.role === 'baseline' ? '—' : signedPct(r.deltaVsBaselinePct), m.completionPct.toFixed(1), mmss(m.meanJourneyS),
        mmss(m.meanWaitS), mmss(m.p95WaitS), String(m.missedConnections), String(m.leftBehind), String(m.walkaways),
        ...body.scenarios.map((s) => (r.byScenario[s] ? paxH(r.byScenario[s]!.J) : ''))];
    }),
  ));

  const out = args.get('out');
  if (out) {
    const path = outputPath(out);
    writeJson(path, body, true);
    log(`wrote ${path}`);
  }
  if (!post) {
    log(url ? 'not posted (--no-post)' : 'not posted (pass --url <worker base URL> to POST to /api/admin/sealed-eval)');
    return 0;
  }
  const r = await postSealedEval(url!, token!, body, fetchImpl);
  const shown = typeof r.response === 'string' ? r.response : JSON.stringify(r.response);
  log(`POST ${trimSlash(url!)}/api/admin/sealed-eval → ${r.status || 'network error'} ${shown.slice(0, 400)}`);
  return r.ok ? 0 : 1;
}

runIfMain(import.meta.url, main);
