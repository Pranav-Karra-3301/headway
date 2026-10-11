// Owner: T4. One headless run, metrics printed (spec §3 "pnpm sim:run").
//
//   pnpm sim:run [--policy g0|ref|example|champion|gN|<file.json>] [--scenario stadium_exit|class_change] [--seed 1001]
//                [--findings 5] [--json]
//
// A policy file may hold a Policy or anything with a `.policy` (a Generation, a Proposal, the /api/champion body).
// champion / gN read data/generations (written by `pnpm evolve`).
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLE_G3, G0, REF, SEEDS, scenarioDef, validatePolicy } from '@headway/sim';
import type { Policy, RunResult, ScenarioInstance, Split } from '@headway/sim';
import { runPolicy } from '../evaluate';
import { createFileStore } from './store-file';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const DATA_DIR = join(REPO_ROOT, 'data');
const BUILTINS: Record<string, Policy> = { g0: G0, ref: REF, example: EXAMPLE_G3 };

export const USAGE = `usage: pnpm sim:run [--policy g0|ref|example|champion|gN|file.json] [--scenario stadium_exit|class_change] [--seed 1001]
                    [--findings 5] [--json]`;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export interface SimRunOptions { policy: string; scenario: string; seed: number; json: boolean; findings: number; help: boolean }

export function parseSimRunArgs(argv: string[]): SimRunOptions {
  const o: SimRunOptions = { policy: 'g0', scenario: 'stadium_exit', seed: 1001, json: false, findings: 5, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq >= 0 ? eq : undefined);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new Error(`--${name} needs a value`);
      return v;
    };
    const count = (what: string): number => {
      const v = value();
      if (!/^\d+$/.test(v)) throw new Error(`--${what} must be a non-negative integer, got "${v}"`);
      return Number(v);
    };
    switch (name) {
      case 'policy': o.policy = value(); break;
      case 'scenario': o.scenario = value(); break;
      case 'seed': o.seed = count('seed'); break;
      case 'findings': o.findings = count('findings'); break;
      case 'json': o.json = true; break;
      case 'help': o.help = true; break;
      default: throw new Error(`unknown option --${name}`);
    }
  }
  return o;
}

function validated(raw: unknown, what: string): Policy {
  const v = validatePolicy(raw);
  if (!v.ok) throw new Error(`invalid policy ${what}:\n  ${v.errors.slice(0, 12).join('\n  ')}`);
  return v.policy;
}

/** g0 | ref | example | champion | gN (data/generations) | a JSON file (relative to cwd, then the repo root). */
export function resolvePolicyRef(ref: string, ctx: { dataDir?: string; cwd?: string } = {}): { label: string; policy: Policy } {
  const builtin = BUILTINS[ref];
  if (builtin) return { label: ref, policy: builtin };
  const dataDir = ctx.dataDir ?? DATA_DIR;
  if (ref === 'champion' || /^g\d+$/.test(ref)) {
    const gens = existsSync(join(dataDir, 'generations')) ? createFileStore(dataDir).generations() : [];
    if (!gens.length) throw new Error(`no generations in ${join(dataDir, 'generations')} (run pnpm evolve first)`);
    const g = ref === 'champion' ? gens[gens.length - 1]! : gens.find((x) => x.id === ref);
    if (!g) throw new Error(`generation ${ref} not found (have ${gens.map((x) => x.id).join(', ')})`);
    return { label: g.id, policy: validated(g.policy, g.id) };
  }
  const candidates = isAbsolute(ref) ? [ref] : [resolve(ctx.cwd ?? process.cwd(), ref), resolve(REPO_ROOT, ref)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`unknown policy "${ref}": not g0, ref, example, champion, gN or an existing file`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read policy file ${path}: ${errText(e)}`);
  }
  const policy = validated(isRecord(raw) && isRecord(raw.policy) ? raw.policy : raw, basename(path));
  return { label: policy.meta.id || basename(path), policy };
}

function splitOf(scenarioId: string, seed: number): Split {
  for (const split of ['train', 'val', 'showcase'] as const) {
    if (SEEDS[split].some((x) => x.scenarioId === scenarioId && x.seed === seed)) return split;
  }
  return seed >= 50_000 ? 'play' : 'train';
}

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const mmss = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function formatRun(r: RunResult, o: { label: string; ms: number; findings: number }): string {
  const m = r.metrics;
  const split = splitOf(r.scenarioId, r.seed);
  const fires = Object.entries(r.ruleFires).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const worst = r.stops.flatMap((s) => Object.entries(s.maxGapS).map(([route, g]) => ({ stop: s.id, route, g: g ?? 0 })))
    .sort((a, b) => b.g - a.g)[0];
  const lines = [
    `${o.label} on ${r.scenarioId} seed ${r.seed} (${split}) · sim ${r.simVersion} · map ${r.mapVersion} · ${Math.round(o.ms)} ms · hash ${r.hash}`,
    `J             ${(m.J / 3600).toFixed(1)} pax-h (${n0(m.J)} pax-s)`,
    `completion    ${m.completionPct.toFixed(1)}% (${n0(m.completed)} of ${n0(m.spawned)}; ${n0(m.unfinished)} unfinished)`,
    `journey       mean ${mmss(m.meanJourneyS)}`,
    `wait          mean ${mmss(m.meanWaitS)} · p95 ${mmss(m.p95WaitS)} · max ${mmss(m.maxWaitS)}`,
    `transfers     ${n0(m.transfersMade)} made · ${n0(m.missedConnections)} missed connections`,
    `crowding      ${n0(m.leftBehind)} left behind · ${n0(m.walkaways)} walkaways`,
    `effort        bus ${n0(m.effort.busDistanceU)} u · deadhead ${n0(m.effort.deadheadDistanceU)} u · holds ${n0(m.effort.holdS)} s · train dwell ${n0(m.effort.trainDwellS)} s`,
  ];
  if (worst) lines.push(`worst gap     ${mmss(worst.g)} at ${worst.stop} (${worst.route})`);
  if (o.findings > 0 && r.findings.length) {
    lines.push(`findings (top ${Math.min(o.findings, r.findings.length)} of ${r.findings.length} by impact):`);
    for (const f of r.findings.slice(0, o.findings)) lines.push(`  - ${f.text || f.kind} (${n0(f.impactS / 60)} pax-min)`);
  }
  lines.push(`rule fires    ${fires.length ? fires.map(([id, k]) => `${id} ${k}`).join(' · ') : '(none)'}`);
  return lines.join('\n');
}

export async function main(argv: string[], deps: { log?: (s: string) => void; dataDir?: string } = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  let o: SimRunOptions;
  let instance: ScenarioInstance;
  let named: { label: string; policy: Policy };
  try {
    o = parseSimRunArgs(argv);
    if (o.help) {
      log(USAGE);
      return 0;
    }
    scenarioDef(o.scenario);
    instance = { scenarioId: o.scenario, seed: o.seed, split: splitOf(o.scenario, o.seed) };
    named = resolvePolicyRef(o.policy, { dataDir: deps.dataDir });
  } catch (e) {
    log(`error: ${errText(e)}\n${USAGE}`);
    return 2;
  }
  const t0 = performance.now();
  const result = runPolicy(named.policy, instance);
  const ms = performance.now() - t0;
  log(o.json ? JSON.stringify(result, null, 2) : formatRun(result, { label: named.label, ms, findings: o.findings }));
  return 0;
}

function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e: unknown) => { console.error(errText(e)); process.exitCode = 1; },
  );
}
