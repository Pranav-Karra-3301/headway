// Owner: T4. Evaluate a policy on scenario instances with the real engine (runSync + PolicyController on TOWN),
// plus a cached evaluator for the round runner (spec §7: scores are cached per (policy, simVersion, split)).
// No Node built-ins: this runs in Node, the browser and the Worker.
import { DEFAULT_CONFIG, FEATURES, G0, PolicyController, SEEDS, TOWN, runSync, validatePolicy } from '@headway/sim';
import type { Action, DecisionKind, Generation, Policy, RouteId, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
import { aggregateResults, topFindings } from './aggregate';

export type EvolveSplit = 'train' | 'val';
export interface Evaluation { score: SplitScore; results: RunResult[] }
/** One headless run of `policy` on one instance. */
export type RunOne = (policy: Policy, instance: ScenarioInstance) => RunResult;
export type EvaluatorCache = Map<string, Evaluation>;

/** The real engine on the canonical town. */
export const runPolicy: RunOne = (policy, scenario) => runSync({ map: TOWN, scenario, controller: new PolicyController(policy) });

export function evaluatePolicy(policy: Policy, instances: ScenarioInstance[]): { score: SplitScore; results: RunResult[] } {
  const results = instances.map((instance) => runPolicy(policy, instance));
  return { score: aggregateResults(results), results };
}

/** The spec §7 instances of a split evolve may see. The sealed test split is not expressible here on purpose. */
export function evolveInstances(split: EvolveSplit): ScenarioInstance[] {
  return SEEDS[split].map((x) => ({ ...x }));
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Sorted-key JSON, so equal values compare equal regardless of key order; undefined members are dropped. */
export function stableJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  if (isRecord(x)) {
    return `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/** Everything but meta: what the simulator actually runs (meta.id only labels the RunResult's controller). */
export function policyBody(p: Policy): string {
  return stableJson({ ...p, meta: null });
}

function restamp(results: RunResult[], policyId: string): RunResult[] {
  return results.map((r) => (r.controller.kind === 'policy' && r.controller.policyId !== policyId
    ? { ...r, controller: { kind: 'policy' as const, policyId } }
    : r));
}

/** Lets a streaming response (NDJSON events in the Worker) flush between runs. */
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface Evaluator {
  /** The `RoundDeps['evaluate']` dependency. */
  evaluate(policy: Policy, split: EvolveSplit): Promise<Evaluation>;
  /** `runs` = sim runs executed; `hits` / `misses` count evaluate calls. */
  readonly stats: { runs: number; hits: number; misses: number };
}

/**
 * A cached evaluator keyed by (policy body, simVersion, split). Two policies that differ only in meta share scores, so a
 * promoted proposal's train/val runs are reused when it becomes the champion; cached results are re-stamped with the
 * requesting policy's id. Failures are not cached. Pass a shared `cache` to reuse scores across rounds or requests.
 */
export function createEvaluator(o: {
  run?: RunOne; instances?: (split: EvolveSplit) => ScenarioInstance[]; simVersion?: string; cache?: EvaluatorCache; yieldBetweenRuns?: boolean;
} = {}): Evaluator {
  const run = o.run ?? runPolicy;
  const instancesOf = o.instances ?? evolveInstances;
  const simVersion = o.simVersion ?? DEFAULT_CONFIG.simVersion;
  const cache: EvaluatorCache = o.cache ?? new Map();
  const yieldBetween = o.yieldBetweenRuns ?? true;
  const stats = { runs: 0, hits: 0, misses: 0 };
  return {
    stats,
    async evaluate(policy, split) {
      const key = `${simVersion}|${split}|${policyBody(policy)}`;
      const id = policy.meta?.id ?? 'policy';
      const hit = cache.get(key);
      if (hit) {
        stats.hits++;
        return { score: hit.score, results: restamp(hit.results, id) };
      }
      stats.misses++;
      const results: RunResult[] = [];
      for (const instance of instancesOf(split)) {
        if (yieldBetween && results.length > 0) await yieldToLoop();
        results.push(run(policy, instance));
        stats.runs++;
      }
      const evaluation: Evaluation = { score: aggregateResults(results), results };
      cache.set(key, evaluation);
      return { score: evaluation.score, results: restamp(results, id) };
    },
  };
}

/** Generation g0: the G0 baseline scored on train and val (the store's bootstrap champion). */
export async function baselineGeneration(
  evaluate: (policy: Policy, split: EvolveSplit) => Promise<Evaluation>, now: () => string,
): Promise<Generation> {
  const policy: Policy = { ...G0, meta: { ...G0.meta, id: 'g0', parent: null, generation: 0 } };
  const train = await evaluate(policy, 'train');
  const val = await evaluate(policy, 'val');
  return {
    id: 'g0', number: 0, parentId: null, policy, fromProposal: null, explanation: G0.meta.summary,
    train: train.score, val: val.score, findings: topFindings(train.results, 8), createdAt: now(),
  };
}

// ---------- sensitivity probes (training split only) ----------

/** A one-step variant of the champion, scored on training so designers see measured levers. */
export interface Probe { id: string; label: string; policy: Policy }
export interface ProbeResult { id: string; label: string; J: number; deltaPct: number }

const ROUTE_IDS: RouteId[] = ['r1', 'r2', 'r3'];
export const MAX_PROBES = 40;
/** The queue feature a hold rule can be guarded with, per decision kind. */
const QUEUE_FEATURE: Partial<Record<DecisionKind, string>> = { bus_at_stop: 'queue_here', bus_at_terminal: 'route_queue' };
const GUARD_QUEUES = [20, 40, 80];
const THRESHOLD_SCALES = [0.5, 1.5];
const allocText = (a: Record<RouteId, number>) => ROUTE_IDS.map((r) => a[r]).join('/');

/** The cheapest alternative to each default action (one per decision kind). */
function altDefault(kind: DecisionKind, a: Action, trainDwellS: number): { action: Action; text: string } {
  switch (kind) {
    case 'bus_at_stop':
      return a.type === 'continue'
        ? { action: { type: 'hold', until: 'target_headway' }, text: 'hold until target headway' }
        : { action: { type: 'continue' }, text: 'continue' };
    case 'bus_at_terminal':
      return a.type === 'dispatch'
        ? { action: { type: 'hold', until: 'target_headway' }, text: 'hold until target headway' }
        : { action: { type: 'dispatch' }, text: 'dispatch' };
    case 'train_at_station': {
      const cur = a.type === 'setTrainDeparture' ? a.dwellS : trainDwellS;
      const dwellS = cur > 30 ? 30 : 60;
      return { action: { type: 'setTrainDeparture', dwellS }, text: `dwell ${dwellS} s` };
    }
  }
}

/**
 * One-step variants of `champion`: (a) each rule removed, (b) one bus moved between every ordered pair of routes (no
 * route below 1 bus), (c) each decision kind's default swapped for its cheapest alternative, (d) each hold rule skipped
 * while a queue of 20/40/80 waits, (e) each rule threshold scaled ×0.5 and ×1.5. Generic mutations of the champion's own
 * rules only; invalid variants are dropped; at most MAX_PROBES.
 */
export function championProbes(champion: Policy): Probe[] {
  const out: Probe[] = [];
  const add = (id: string, label: string, edit: (p: Policy) => void) => {
    if (out.length >= MAX_PROBES) return;
    const p = structuredClone(champion);
    edit(p);
    p.meta = { ...p.meta, id: `probe-${id}` };
    const v = validatePolicy(p);
    if (v.ok) out.push({ id, label, policy: v.policy });
  };
  for (const r of champion.rules) add(`rm-${r.id}`, `remove rule ${r.id}`, (p) => { p.rules = p.rules.filter((x) => x.id !== r.id); });
  const alloc = champion.params.allocation;
  for (const from of ROUTE_IDS) {
    for (const to of ROUTE_IDS) {
      if (from === to || alloc[from] < 2) continue;
      const next = { ...alloc, [from]: alloc[from] - 1, [to]: alloc[to] + 1 };
      add(`mv-${from}-${to}`, `move 1 bus ${from}→${to} (${allocText(alloc)} → ${allocText(next)})`, (p) => { p.params.allocation = next; });
    }
  }
  for (const kind of Object.keys(champion.defaults) as DecisionKind[]) {
    const alt = altDefault(kind, champion.defaults[kind], champion.params.trainDefaultDwellS);
    add(`def-${kind}`, `default ${kind} → ${alt.text}`, (p) => { (p.defaults as Record<DecisionKind, Action>)[kind] = alt.action; });
  }
  champion.rules.forEach((r, i) => {
    const q = QUEUE_FEATURE[r.on];
    if (r.do.type !== 'hold' || !q || r.when.some((c) => c.f === q)) return;
    for (const Q of GUARD_QUEUES) {
      add(`guard-${r.id}-${Q}`, `rule ${r.id} skipped while ${q} >= ${Q}`, (p) => { p.rules[i]!.when.push({ f: q, op: '<', v: Q }); });
    }
  });
  champion.rules.forEach((r, i) => r.when.forEach((c, j) => {
    const spec = (FEATURES[r.on] as Record<string, { min: number; max: number } | undefined>)[c.f];
    if (!spec || c.v === 0) return;
    for (const k of THRESHOLD_SCALES) {
      const raw = c.v * k;
      const v = Math.min(spec.max, Math.max(spec.min, Math.round(raw * 100) / 100));
      if (v === c.v) continue;
      add(`thr-${r.id}-${j}-${k}`, `rule ${r.id}: ${c.f} ${c.op} ${c.v} → ${v}`, (p) => { p.rules[i]!.when[j]!.v = v; });
    }
  }));
  return out;
}

/**
 * Score every probe on the TRAINING split (never validation or test) against the champion's training J; results are
 * sorted best first (most negative ΔJ). A probe that fails to evaluate is skipped. `onProbe` reports each result.
 */
export async function runProbes(
  evaluate: (policy: Policy, split: EvolveSplit) => Promise<Evaluation>, champion: Policy, championJ: number,
  onProbe?: (r: ProbeResult, runs: number) => void,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const probe of championProbes(champion)) {
    try {
      const ev = await evaluate(probe.policy, 'train');
      const deltaPct = championJ > 0 ? Math.round((10_000 * (ev.score.J - championJ)) / championJ) / 100 : 0;
      const r: ProbeResult = { id: probe.id, label: probe.label, J: ev.score.J, deltaPct };
      out.push(r);
      onProbe?.(r, ev.results.length);
    } catch { /* a probe is evidence only: skip it */ }
  }
  return out.sort((a, b) => a.deltaPct - b.deltaPct || a.id.localeCompare(b.id));
}
