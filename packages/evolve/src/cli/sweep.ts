// Owner: T8. `sweep`: policies × scenarios × seeds → metrics table (for tuning; spec §7, §12 sanity gates).
//
//   pnpm --filter @headway/evolve exec tsx src/cli/sweep.ts [--policies g0,ref,champion] [--split train|val|showcase|play]
//        [--scenarios stadium_exit,class_change] [--seeds 1001-1004] [--set bus.capacity=60 ...] [--json out.json] [--quiet] [--no-gates]
//
// Also hosts the helpers shared by the other T8 CLIs (export-web, eval-sealed, verify-leaderboard): argument parsing, repo paths,
// data/ readers, policy resolution, the Node sim runner and table formatting.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_CONFIG, EXAMPLE_G3, G0, PolicyController, REF, SEEDS, TOWN, playInstance, runSync, validatePolicy,
} from '@headway/sim';
import type { FailureFinding, Generation, Policy, RunResult, ScenarioInstance, SimConfig, Split, SplitScore } from '@headway/sim';
import { aggregateResults, worstGapS } from '../aggregate';

// =====================================================================================================================
// Shared CLI helpers
// =====================================================================================================================

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const DATA_DIR = join(REPO_ROOT, 'data');
export const WEB_DATA_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'data');

/** True when `metaUrl` is the script node/tsx was started with (so importing a CLI never runs it). */
export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === pathToFileURL(realpathSync(fileURLToPath(metaUrl))).href;
  } catch {
    return false;
  }
}

/** Runs `main` when the module is the entry point; sets the exit code (no process.exit, so piped output is never truncated). */
export function runIfMain(metaUrl: string, main: (argv: string[]) => Promise<number>): void {
  if (!isMain(metaUrl)) return;
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}

export interface Args {
  /** Last string value of `--name`. */
  get(name: string): string | undefined;
  /** Every string value of a repeatable `--name`. */
  all(name: string): string[];
  /** `--name` → true, `--no-name` → false, `--name=false|0` → false, absent → `dflt`. */
  flag(name: string, dflt?: boolean): boolean;
  positionals: string[];
}

/** `--k v`, `--k=v`, `--flag` (when followed by another `--opt`, the end, or listed in `booleans`), `--no-flag`. */
export function parseArgs(argv: string[], booleans: string[] = []): Args {
  const values = new Map<string, Array<string | boolean>>();
  const positionals: string[] = [];
  const push = (k: string, v: string | boolean) => values.set(k, [...(values.get(k) ?? []), v]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--') || a === '--') {
      if (a !== '--') positionals.push(a);
      continue;
    }
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      push(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (body.startsWith('no-') && !booleans.includes(body)) {
      push(body.slice(3), false);
      continue;
    }
    const next = argv[i + 1];
    if (booleans.includes(body) || next === undefined || next.startsWith('--')) push(body, true);
    else {
      push(body, next);
      i++;
    }
  }
  return {
    positionals,
    get: (k) => {
      const v = values.get(k)?.filter((x): x is string => typeof x === 'string');
      return v && v.length > 0 ? v[v.length - 1] : undefined;
    },
    all: (k) => (values.get(k) ?? []).filter((x): x is string => typeof x === 'string'),
    flag: (k, dflt = false) => {
      const v = values.get(k);
      if (!v || v.length === 0) return dflt;
      const last = v[v.length - 1]!;
      return typeof last === 'boolean' ? last : !['false', '0', 'no'].includes(last.toLowerCase());
    },
  };
}

/** Comma list of seeds and inclusive ranges: `1001-1004,2001`. */
export function parseSeeds(spec: string): number[] {
  const out: number[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad seed "${part}" (use e.g. 1001-1004,2001)`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo) throw new Error(`bad seed range "${part}"`);
    if (hi - lo > 10_000) throw new Error(`seed range "${part}" is too large`);
    for (let s = lo; s <= hi; s++) out.push(s);
  }
  if (out.length === 0) throw new Error('no seeds given');
  return out;
}

export const csv = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Input paths: as given if absolute, else relative to the cwd, else relative to the repo root. */
export function inputPath(p: string, cwd = process.cwd()): string {
  if (isAbsolute(p)) return p;
  const here = resolve(cwd, p);
  if (existsSync(here)) return here;
  const root = resolve(REPO_ROOT, p);
  return existsSync(root) ? root : here;
}

/** Output paths: relative paths resolve against the repo root (same result for `pnpm <script>` and `pnpm --filter … exec`). */
export function outputPath(p: string): string {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

export function writeJson(path: string, value: unknown, pretty = false): number {
  mkdirSync(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
  writeFileSync(path, text);
  return text.length;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every value in `dir/*.json` (arrays are flattened). Unreadable files are skipped with a warning. Missing dir → []. */
export function readJsonDir(dir: string, warn: (msg: string) => void = () => {}): unknown[] {
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const v: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (Array.isArray(v)) out.push(...(v as unknown[]));
      else out.push(v);
    } catch (err) {
      warn(`skipping ${join(dir, name)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export function isGeneration(v: unknown): v is Generation {
  return isObj(v) && typeof v.id === 'string' && typeof v.number === 'number' && Number.isFinite(v.number) && isObj(v.policy);
}

/** Records of one kind from JSON values: the value itself, `{ [one]: record }` or `{ [many]: record[] }` wrappers. */
export function unwrapRecords<T>(values: unknown[], is: (v: unknown) => v is T, one: string, many: string): T[] {
  const out: T[] = [];
  for (const v of values) {
    if (is(v)) out.push(v);
    else if (isObj(v) && is(v[one])) out.push(v[one] as T);
    else if (isObj(v) && Array.isArray(v[many])) out.push(...(v[many] as unknown[]).filter(is));
  }
  return out;
}

/** `<dataDir>/generations/*.json`, oldest first (by `number`); duplicates by id keep the last file read. */
export function readGenerations(dataDir: string, warn: (msg: string) => void = () => {}): Generation[] {
  const byId = new Map<string, Generation>();
  for (const g of unwrapRecords(readJsonDir(join(dataDir, 'generations'), warn), isGeneration, 'generation', 'generations')) byId.set(g.id, g);
  return [...byId.values()].sort((a, b) => a.number - b.number);
}

// ---------- policies ----------

export interface NamedPolicy { label: string; policy: Policy }
const BUILTINS: Record<string, Policy> = { g0: G0, ref: REF, example: EXAMPLE_G3, 'example-g3': EXAMPLE_G3 };

function validated(policy: unknown, what: string): Policy {
  const v = validatePolicy(policy);
  if (!v.ok) throw new Error(`invalid policy ${what}:\n  ${v.errors.slice(0, 12).join('\n  ')}`);
  return v.policy;
}

/**
 * `g0` | `ref` | `example` (spec §6 example) | `champion` (latest in data/generations) | `gN` (a generation in data/) |
 * a JSON file holding a Policy or anything with a `.policy` (Generation, Proposal, `/api/champion` body).
 */
export function resolvePolicy(ref: string, ctx: { dataDir?: string; cwd?: string } = {}): NamedPolicy {
  const dataDir = ctx.dataDir ?? DATA_DIR;
  const builtin = BUILTINS[ref];
  if (builtin) return { label: ref === 'example-g3' ? 'example' : ref, policy: validated(builtin, ref) };
  if (ref === 'champion' || /^g\d+$/.test(ref)) {
    const gens = readGenerations(dataDir);
    if (gens.length === 0) throw new Error(`no generations in ${join(dataDir, 'generations')} (run the evolve CLI first) for "${ref}"`);
    const g = ref === 'champion' ? gens[gens.length - 1]! : gens.find((x) => x.id === ref);
    if (!g) throw new Error(`generation "${ref}" not found in ${join(dataDir, 'generations')} (have ${gens.map((x) => x.id).join(', ')})`);
    return { label: g.id, policy: validated(g.policy, g.id) };
  }
  const path = inputPath(ref, ctx.cwd);
  if (!existsSync(path)) throw new Error(`unknown policy "${ref}": not a built-in (g0, ref, example, champion, gN) and file not found`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read policy file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const policy = isObj(raw) && isObj(raw.policy) ? raw.policy : raw;
  const p = validated(policy, ref);
  return { label: p.meta.id || ref, policy: p };
}

/** Labels must be unique for aggregation: repeated labels get `#2`, `#3`. */
export function uniqueLabels(ps: NamedPolicy[]): NamedPolicy[] {
  const seen = new Map<string, number>();
  return ps.map((p) => {
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    return n === 1 ? p : { ...p, label: `${p.label}#${n}` };
  });
}

// ---------- scenario instances ----------

/** Spec §7 splits; used when the sim's SEEDS are not filled in yet. */
const SPEC_SEEDS: Record<'train' | 'val' | 'showcase', ScenarioInstance[]> = {
  train: cross(['stadium_exit', 'class_change'], [1001, 1002, 1003, 1004], 'train'),
  val: cross(['stadium_exit', 'class_change'], [2001, 2002], 'val'),
  showcase: cross(['stadium_exit', 'class_change'], [4001, 4002, 4003], 'showcase'),
};

function cross(scenarios: string[], seeds: number[], split: Split): ScenarioInstance[] {
  return scenarios.flatMap((scenarioId) => seeds.map((seed) => ({ scenarioId, seed, split })));
}

export function splitInstances(split: 'train' | 'val' | 'showcase'): ScenarioInstance[] {
  const fromSim = SEEDS?.[split];
  return (fromSim && fromSim.length > 0 ? fromSim : SPEC_SEEDS[split]).map((x) => ({ ...x }));
}

/** The split a seed belongs to (spec §7), else play for 50000+, else train. */
export function inferSplit(seed: number): Split {
  for (const split of ['train', 'val', 'showcase'] as const) if (splitInstances(split).some((x) => x.seed === seed)) return split;
  return seed >= 50_000 ? 'play' : 'train';
}

/** UTC days since 2026-10-11 (play seed = 50000 + this). */
export function todayIndex(now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.UTC(2026, 9, 11)) / 86_400_000));
}

export function buildInstances(o: { split?: string; scenarios?: string[]; seeds?: number[]; dayIndex?: number }): ScenarioInstance[] {
  const scenarios = o.scenarios && o.scenarios.length > 0 ? o.scenarios : undefined;
  if (o.seeds && o.seeds.length > 0) {
    return (scenarios ?? ['stadium_exit', 'class_change']).flatMap((scenarioId) => o.seeds!.map((seed) => ({ scenarioId, seed, split: inferSplit(seed) })));
  }
  const split = o.split ?? 'train';
  if (split === 'play') return [playInstance(o.dayIndex ?? todayIndex())];
  if (split !== 'train' && split !== 'val' && split !== 'showcase') throw new Error(`unknown split "${split}" (train | val | showcase | play)`);
  const xs = splitInstances(split);
  return scenarios ? xs.filter((x) => scenarios.includes(x.scenarioId)) : xs;
}

// ---------- config ----------

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** `bus.capacity=60` → `{ bus: { ...base.bus, capacity: 60 } }` (whole top-level groups, because `withConfig` merges shallowly). */
export function configOverrides(sets: string[], base: SimConfig = DEFAULT_CONFIG): Partial<SimConfig> {
  const out: Record<string, unknown> = {};
  const root = base as unknown as Record<string, unknown>;
  for (const s of sets) {
    const eq = s.indexOf('=');
    if (eq <= 0) throw new Error(`--set expects key=value, got "${s}"`);
    const key = s.slice(0, eq).trim();
    const value = parseValue(s.slice(eq + 1).trim());
    const path = key.split('.');
    const top = path[0]!;
    if (!(top in root)) throw new Error(`unknown config key "${key}"`);
    if (path.length === 1) {
      out[top] = value;
      continue;
    }
    if (!isObj(out[top])) out[top] = structuredClone(root[top]);
    let obj = out[top] as Record<string, unknown>;
    for (const p of path.slice(1, -1)) {
      if (!isObj(obj[p])) throw new Error(`unknown config key "${key}"`);
      obj = obj[p] as Record<string, unknown>;
    }
    const last = path[path.length - 1]!;
    if (!(last in obj)) throw new Error(`unknown config key "${key}"`);
    obj[last] = value;
  }
  return out as Partial<SimConfig>;
}

// ---------- running ----------

export type SimRun = (policy: Policy, instance: ScenarioInstance, config?: Partial<SimConfig>) => RunResult;

/** The real engine: `runSync` + `PolicyController` on the canonical town. */
export const simRun: SimRun = (policy, instance, config) =>
  runSync({ map: TOWN, scenario: instance, config, controller: new PolicyController(policy) });

/** Aggregate a policy over instances (same aggregation as the evolve loop). */
export function evaluateOn(policy: Policy, instances: ScenarioInstance[], run: SimRun = simRun, config?: Partial<SimConfig>): { score: SplitScore; results: RunResult[] } {
  const results = instances.map((i) => run(policy, i, config));
  return { score: aggregateResults(results), results };
}

// ---------- formatting ----------

export const paxH = (j: number) => (j / 3600).toFixed(1);
export function mmss(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
export function signedPct(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—';
  const r = Math.round(x * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}%`;
}

/** Plain text table: the first column left-aligned, the rest right-aligned, two spaces between columns. */
export function formatTable(headers: string[], rows: string[][]): string {
  const width = (s: string) => [...s].length;
  const widths = headers.map((h, c) => Math.max(width(h), ...rows.map((r) => width(r[c] ?? ''))));
  const cell = (s: string, c: number) => (c === 0 ? s + ' '.repeat(widths[c]! - width(s)) : ' '.repeat(widths[c]! - width(s)) + s);
  const line = (r: string[]) => r.map((s, c) => cell(s, c)).join('  ').trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

// =====================================================================================================================
// Sweep
// =====================================================================================================================

export interface SweepRow { label: string; policyId: string; scenarioId: string; seed: number; ms: number; result: RunResult }

export function runSweep(o: {
  policies: NamedPolicy[]; instances: ScenarioInstance[]; run: SimRun; config?: Partial<SimConfig>;
  onRow?: (r: SweepRow) => void; warmup?: boolean;
}): SweepRow[] {
  if (o.warmup && o.policies[0] && o.instances[0]) o.run(o.policies[0].policy, o.instances[0], o.config);
  const rows: SweepRow[] = [];
  for (const p of o.policies) {
    for (const inst of o.instances) {
      const t0 = performance.now();
      const result = o.run(p.policy, inst, o.config);
      const row: SweepRow = { label: p.label, policyId: p.policy.meta.id, scenarioId: inst.scenarioId, seed: inst.seed, ms: performance.now() - t0, result };
      rows.push(row);
      o.onRow?.(row);
    }
  }
  return rows;
}

export interface PolicySummary {
  label: string; policyId: string; runs: number; score: SplitScore;
  /** ΔJ % vs the baseline policy (g0 when swept, else the first policy). */
  deltaPct: number | null;
  worstGapS: number; msMedian: number; msMax: number;
  byScenario: Array<{ scenarioId: string; runs: number; score: SplitScore; deltaPct: number | null }>;
  findings: Array<{ kind: FailureFinding['kind']; count: number; impactS: number; top: string }>;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pctDelta = (x: number, base: number | undefined) => (base === undefined || base === 0 ? null : ((x - base) / base) * 100);

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function aggregateRows(rows: SweepRow[], baselineLabel?: string): PolicySummary[] {
  const byPolicy = groupBy(rows, (r) => r.label);
  const labels = [...byPolicy.keys()];
  const base = baselineLabel ?? (labels.includes('g0') ? 'g0' : labels[0]);
  const baseRows = base ? byPolicy.get(base) ?? [] : [];
  const baseJ = baseRows.length ? aggregateResults(baseRows.map((r) => r.result)).J : undefined;
  const baseByScenario = new Map([...groupBy(baseRows, (r) => r.scenarioId)].map(([k, rs]) => [k, aggregateResults(rs.map((r) => r.result)).J]));
  return labels.map((label) => {
    const rs = byPolicy.get(label)!;
    const results = rs.map((r) => r.result);
    const score = aggregateResults(results);
    const kinds = new Map<FailureFinding['kind'], { count: number; impactS: number; top: FailureFinding }>();
    for (const f of results.flatMap((r) => r.findings)) {
      const k = kinds.get(f.kind);
      if (!k) kinds.set(f.kind, { count: 1, impactS: f.impactS, top: f });
      else {
        k.count++;
        k.impactS += f.impactS;
        if (f.impactS > k.top.impactS) k.top = f;
      }
    }
    return {
      label, policyId: rs[0]!.policyId, runs: rs.length, score, deltaPct: pctDelta(score.J, baseJ),
      worstGapS: worstGapS(results), msMedian: median(rs.map((r) => r.ms)), msMax: Math.max(...rs.map((r) => r.ms)),
      byScenario: [...groupBy(rs, (r) => r.scenarioId)].map(([scenarioId, srs]) => {
        const s = aggregateResults(srs.map((r) => r.result));
        return { scenarioId, runs: srs.length, score: s, deltaPct: pctDelta(s.J, baseByScenario.get(scenarioId)) };
      }),
      findings: [...kinds].map(([kind, k]) => ({ kind, count: k.count, impactS: k.impactS, top: k.top.text })).sort((a, b) => b.impactS - a.impactS),
    };
  });
}

export interface Gate { name: string; pass: boolean | null; detail: string }

/** Spec §12 sanity gates, computed over whatever the sweep ran (run it on the train split). null = not measurable here. */
export function sanityGates(rows: SweepRow[]): Gate[] {
  const g0 = rows.filter((r) => r.label === 'g0');
  const ref = rows.filter((r) => r.label === 'ref');
  const sum = (rs: SweepRow[]) => rs.reduce((a, r) => a + r.result.metrics.J, 0);
  const gates: Gate[] = [];

  if (g0.length && ref.length) {
    const d = pctDelta(sum(ref), sum(g0))!;
    gates.push({ name: 'ref beats g0 by ≥ 5% J', pass: d <= -5, detail: `ref ${signedPct(d)} vs g0` });
  } else gates.push({ name: 'ref beats g0 by ≥ 5% J', pass: null, detail: 'needs g0 and ref in --policies' });

  const g0Stadium = g0.filter((r) => r.scenarioId === 'stadium_exit');
  if (g0Stadium.length) {
    const c = aggregateResults(g0Stadium.map((r) => r.result)).metrics.completionPct;
    gates.push({ name: 'g0 stadium_exit completion ≥ 85%', pass: c >= 85, detail: `${c.toFixed(1)}% over ${g0Stadium.length} runs` });
  } else gates.push({ name: 'g0 stadium_exit completion ≥ 85%', pass: null, detail: 'needs g0 on stadium_exit' });

  if (g0.length) {
    const gap = worstGapS(g0.map((r) => r.result));
    gates.push({ name: 'g0 has a service gap > 10 min', pass: gap > 600, detail: `worst gap ${mmss(gap)}` });
    const missed = g0.reduce((a, r) => a + r.result.metrics.missedConnections, 0);
    gates.push({ name: 'g0 has ≥ 10 missed connections', pass: missed >= 10, detail: `${missed} over ${g0.length} runs` });
  } else {
    gates.push({ name: 'g0 has a service gap > 10 min', pass: null, detail: 'needs g0' });
    gates.push({ name: 'g0 has ≥ 10 missed connections', pass: null, detail: 'needs g0' });
  }

  const stadium = rows.filter((r) => r.scenarioId === 'stadium_exit');
  if (stadium.length) {
    const ms = stadium.map((r) => r.ms);
    const m = median(ms);
    gates.push({ name: 'stadium_exit run < 150 ms', pass: m < 150, detail: `median ${m.toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms` });
  } else gates.push({ name: 'stadium_exit run < 150 ms', pass: null, detail: 'needs stadium_exit' });
  return gates;
}

// ---------- CLI ----------

const USAGE = `usage: tsx src/cli/sweep.ts [options]
  --policies a,b,…     g0 | ref | example | champion | gN | path/to/policy.json  (default: g0,ref,+champion if data/ has one)
  --split s            train | val | showcase | play  (default train)
  --scenarios a,b      filter / cross scenarios (stadium_exit, class_change, evening_commute)
  --seeds 1001-1004    explicit seeds (crossed with --scenarios)
  --set key=value      SimConfig override, repeatable (e.g. --set bus.capacity=60 --set objective.unfinishedPenaltyS=1800)
  --json out.json      write every run (relative paths resolve against the repo root)
  --quiet              summary only;  --no-gates  skip the spec §12 sanity gates`;

export interface CliDeps { run?: SimRun; log?: (s: string) => void; dataDir?: string; cwd?: string }

export async function main(argv: string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const dataDir = deps.dataDir ?? DATA_DIR;
  const args = parseArgs(argv, ['quiet', 'help']);
  if (args.flag('help')) {
    log(USAGE);
    return 0;
  }
  let policies: NamedPolicy[];
  let instances: ScenarioInstance[];
  let config: Partial<SimConfig> | undefined;
  try {
    const refs = csv(args.get('policies'));
    if (refs.length === 0) refs.push('g0', 'ref', ...(readGenerations(dataDir).some((g) => g.number > 0) ? ['champion'] : []));
    policies = uniqueLabels(refs.map((r) => resolvePolicy(r, { dataDir, cwd: deps.cwd })));
    const seeds = args.get('seeds');
    instances = buildInstances({ split: args.get('split'), scenarios: csv(args.get('scenarios')), seeds: seeds ? parseSeeds(seeds) : undefined });
    if (instances.length === 0) throw new Error('no scenario instances selected');
    const sets = args.all('set');
    config = sets.length ? configOverrides(sets) : undefined;
  } catch (err) {
    log(`error: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 2;
  }

  const run = deps.run ?? simRun;
  const quiet = args.flag('quiet');
  log(`Sweep: ${policies.length} policies × ${instances.length} runs (${[...new Set(instances.map((i) => i.scenarioId))].join(', ')}; seeds ${[...new Set(instances.map((i) => i.seed))].join(', ')})${config ? ` with ${args.all('set').join(' ')}` : ''}`);
  const rows = runSweep({ policies, instances, run, config, warmup: !deps.run });

  if (!quiet) {
    log('');
    log(formatTable(
      ['policy', 'scenario', 'seed', 'J pax-h', 'compl %', 'mean wait', 'p95 wait', 'missed', 'left bhd', 'walkaway', 'xfers', 'hold s', 'deadhead u', 'worst gap', 'ms'],
      rows.map((r) => {
        const m = r.result.metrics;
        return [r.label, r.scenarioId, String(r.seed), paxH(m.J), m.completionPct.toFixed(1), mmss(m.meanWaitS), mmss(m.p95WaitS), String(m.missedConnections),
          String(m.leftBehind), String(m.walkaways), String(m.transfersMade), String(Math.round(m.effort.holdS)), String(Math.round(m.effort.deadheadDistanceU)),
          mmss(worstGapS([r.result])), r.ms.toFixed(0)];
      }),
    ));
  }

  const summary = aggregateRows(rows);
  const base = summary.find((s) => s.label === 'g0') ?? summary[0];
  log('');
  log(`By policy (ΔJ vs ${base?.label ?? '—'}; J in passenger-hours, lower is better)`);
  log(formatTable(
    ['policy', 'runs', 'J pax-h', 'ΔJ', 'compl %', 'journey', 'mean wait', 'p95 wait', 'missed', 'left bhd', 'walkaway', 'xfers', 'hold s', 'deadhead u', 'worst gap', 'ms/run'],
    summary.map((s) => {
      const m = s.score.metrics;
      return [s.label, String(s.runs), paxH(s.score.J), s.label === base?.label ? '—' : signedPct(s.deltaPct), m.completionPct.toFixed(1), mmss(m.meanJourneyS),
        mmss(m.meanWaitS), mmss(m.p95WaitS), String(m.missedConnections), String(m.leftBehind), String(m.walkaways), String(m.transfersMade),
        String(Math.round(m.effort.holdS)), String(Math.round(m.effort.deadheadDistanceU)), mmss(s.worstGapS), s.msMedian.toFixed(0)];
    }),
  ));
  const scenarios = [...new Set(rows.map((r) => r.scenarioId))];
  if (scenarios.length > 1) {
    log('');
    log('By policy × scenario');
    log(formatTable(
      ['policy', ...scenarios.flatMap((s) => [`${s} J`, 'ΔJ', 'compl %'])],
      summary.map((s) => [s.label, ...scenarios.flatMap((sc) => {
        const x = s.byScenario.find((b) => b.scenarioId === sc);
        return x ? [paxH(x.score.J), s.label === base?.label ? '—' : signedPct(x.deltaPct), x.score.metrics.completionPct.toFixed(1)] : ['', '', ''];
      })]),
    ));
  }
  log('');
  log('Findings (count · Σ impact pax-h · strongest)');
  for (const s of summary) {
    if (s.findings.length === 0) log(`  ${s.label}: none`);
    for (const f of s.findings.slice(0, 4)) log(`  ${s.label}  ${f.kind} ×${f.count} · ${paxH(f.impactS)} · ${f.top}`);
  }

  const gates = args.flag('gates', true) ? sanityGates(rows) : [];
  if (gates.length) {
    log('');
    log('Spec §12 sanity gates (meaningful on --split train)');
    for (const g of gates) log(`  ${g.pass === null ? 'n/a ' : g.pass ? 'PASS' : 'FAIL'}  ${g.name} — ${g.detail}`);
  }

  const jsonOut = args.get('json');
  if (jsonOut) {
    const path = outputPath(jsonOut);
    const first = rows[0]?.result;
    writeJson(path, {
      createdAt: new Date().toISOString(), simVersion: first?.simVersion ?? null, mapVersion: first?.mapVersion ?? null, config: config ?? {}, instances,
      rows: rows.map((r) => ({ label: r.label, policyId: r.policyId, scenarioId: r.scenarioId, seed: r.seed, ms: Math.round(r.ms * 10) / 10,
        hash: r.result.hash, worstGapS: worstGapS([r.result]), metrics: r.result.metrics, stops: r.result.stops, findings: r.result.findings, ruleFires: r.result.ruleFires })),
      summary, gates,
    }, true);
    log('');
    log(`wrote ${path}`);
  }
  return 0;
}

runIfMain(import.meta.url, main);
