// Owner: T4. Evaluate a policy on scenario instances with the real engine (runSync + PolicyController on TOWN),
// plus a cached evaluator for the round runner (spec §7: scores are cached per (policy, simVersion, split)).
// No Node built-ins: this runs in Node, the browser and the Worker.
import { DEFAULT_CONFIG, FEATURES, G0, PolicyController, SEEDS, TOWN, runSync, validatePolicy } from '@headway/sim';
import type {
  Action, Controller, DecisionKind, FailureFinding, FeatureVector, Generation, Policy, RouteId, Rule, RunResult, ScenarioInstance, SplitScore,
} from '@headway/sim';
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

/** A one-step variant of the champion, scored on training so designers see measured levers. `rule` is set for new-rule probes. */
export interface Probe { id: string; label: string; policy: Policy; rule?: Rule }
export interface ProbeResult { id: string; label: string; J: number; deltaPct: number; rule?: Rule }
/** Feature vectors seen at the champion's decision points, per decision kind. */
export type FeatureSamples = Partial<Record<DecisionKind, FeatureVector[]>>;

const KINDS: DecisionKind[] = ['bus_at_stop', 'bus_at_terminal', 'train_at_station'];
const ROUTE_IDS: RouteId[] = ['r1', 'r2', 'r3'];
export const MAX_PROBES = 50;
const MAX_EDIT_PROBES = 24;         // probes on the champion's existing rules, allocation and defaults; new rules fill the rest
const MAX_SAMPLES_PER_KIND = 5000;
/** The queue feature a hold rule can be guarded with, per decision kind. */
const QUEUE_FEATURE: Partial<Record<DecisionKind, string>> = { bus_at_stop: 'queue_here', bus_at_terminal: 'route_queue' };
const GUARD_QUEUES = [20, 40, 80];
const THRESHOLD_SCALES = [0.5, 1.5];
const allocText = (a: Record<RouteId, number>) => ROUTE_IDS.map((r) => a[r]).join('/');

/** Which features of each decision kind relate to each kind of finding (most related first). */
const PAIN_FEATURES: Record<FailureFinding['kind'], Partial<Record<DecisionKind, string[]>>> = {
  overload: {
    bus_at_terminal: ['route_queue', 'max_other_route_queue', 'queue_ratio_other'],
    bus_at_stop: ['queue_here', 'downstream_queue', 'load_factor'],
    train_at_station: ['platform_queue', 'onboard'],
  },
  missed_transfer: {
    bus_at_stop: ['expected_transfers', 'train_eta_s'],
    train_at_station: ['transfers_alighted', 'next_bus_eta_s', 'buses_here_or_due_60s'],
  },
  service_gap: { bus_at_terminal: ['headway_ahead_s', 'headway_ratio', 'layover_s'], bus_at_stop: ['headway_behind_s', 'headway_ahead_s'] },
  bunching: { bus_at_stop: ['headway_ratio', 'headway_ahead_s'], bus_at_terminal: ['headway_ratio'] },
  unused_capacity: { bus_at_terminal: ['queue_ratio_other', 'max_other_route_queue', 'buses_on_route'], bus_at_stop: ['load_factor'] },
  long_hold: { bus_at_stop: ['hold_used_s', 'onboard'] },
};
const PAIN_WEIGHTS = [1, 0.6, 0.4];
/** Features whose LOW values call for action (a train or bus is close); the rest trigger when high. */
const LOW_TRIGGER = new Set(['train_eta_s', 'next_bus_eta_s', 'headway_ratio']);
const KIND_CODE: Record<DecisionKind, string> = { bus_at_stop: 'stop', bus_at_terminal: 'term', train_at_station: 'train' };

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

/** Legal actions per kind for new-rule probes, with an id code and a label. Defaults that would be no-ops are skipped. */
function probeActions(kind: DecisionKind, champion: Policy): Array<{ code: string; text: string; action: Action }> {
  const others = champion.rules.some((r) => r.on === kind);
  const def = champion.defaults[kind];
  const out: Array<{ code: string; text: string; action: Action }> = [];
  const push = (code: string, text: string, action: Action) => {
    if (!others && stableJson(action) === stableJson(def)) return; // identical to the default and nothing to override
    out.push({ code, text, action });
  };
  if (kind === 'bus_at_stop') {
    push('h30', `hold ${Math.min(30, champion.params.maxHoldS)} s`, { type: 'hold', seconds: Math.max(5, Math.min(30, champion.params.maxHoldS)) });
    push('hhw', 'hold until target headway', { type: 'hold', until: 'target_headway' });
  } else if (kind === 'bus_at_terminal') {
    push('reas', 'reassign to busiest', { type: 'reassign', to: 'busiest' });
    push('disp', 'dispatch', { type: 'dispatch' });
    push('hhw', 'hold until target headway', { type: 'hold', until: 'target_headway' });
    push('h30', 'hold 30 s', { type: 'hold', seconds: 30 });
  } else {
    for (const dwellS of [75, 30]) push(`dw${dwellS}`, `dwell ${dwellS} s`, { type: 'setTrainDeparture', dwellS });
  }
  return out;
}

/** The champion's findings, as related features per decision kind ranked by impact (top 3 per kind, with scores). */
export function painFeatures(results: RunResult[]): Record<DecisionKind, Array<{ f: string; score: number }>> {
  const score: Record<DecisionKind, Map<string, number>> = { bus_at_stop: new Map(), bus_at_terminal: new Map(), train_at_station: new Map() };
  for (const r of results) {
    for (const f of r.findings) {
      for (const kind of KINDS) {
        (PAIN_FEATURES[f.kind][kind] ?? []).forEach((feat, i) => score[kind].set(feat, (score[kind].get(feat) ?? 0) + f.impactS * (PAIN_WEIGHTS[i] ?? 0.3)));
      }
    }
  }
  const out = {} as Record<DecisionKind, Array<{ f: string; score: number }>>;
  for (const kind of KINDS) {
    out[kind] = [...score[kind]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([f, sc]) => ({ f, score: sc }));
  }
  return out;
}

/** Value at quantile q of the samples (nearest rank). */
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Two thresholds per feature from the champion's decision records: p50 and p80 (p50 and p20 for low-trigger features). */
function thresholds(kind: DecisionKind, f: string, samples: FeatureSamples): Array<{ op: '>=' | '<='; v: number }> {
  const spec = (FEATURES[kind] as Record<string, { min: number; max: number } | undefined>)[f];
  if (!spec) return [];
  const vals = (samples[kind] ?? []).map((x) => x[f]).filter((v): v is number => typeof v === 'number' && v < spec.max && v >= spec.min);
  if (vals.length < 5) return [];
  vals.sort((a, b) => a - b);
  const integral = vals.every((v) => Number.isInteger(v));
  const low = LOW_TRIGGER.has(f);
  const out: Array<{ op: '>=' | '<='; v: number }> = [];
  for (const q of low ? [0.5, 0.2] : [0.5, 0.8]) {
    const raw = quantile(vals, q);
    const v = integral ? Math.round(raw) : Math.round(raw * 100) / 100;
    if (v <= spec.min && !low) continue;   // ">= min" always holds: not a condition
    if (!out.some((o) => o.v === v)) out.push({ op: low ? '<=' : '>=', v });
  }
  return out;
}

const idNum = (v: number) => String(v).replace('.', 'p');

/**
 * Single-condition candidate rules: for each decision kind and each legal action, the 3 features most related to the
 * champion's findings × 2 thresholds from the champion's decision records. Priority above the kind's existing rules so
 * the candidate takes effect; neutral `say`; ids probe-<kind>-<action>-<feature>-<v>. Ordered round-robin over the kinds
 * (most pain first) so every kind is covered before the cap.
 */
export function newRuleProbes(champion: Policy, results: RunResult[], samples: FeatureSamples): Probe[] {
  const pain = painFeatures(results);
  const kinds = [...KINDS].sort((a, b) => pain[b].reduce((s, x) => s + x.score, 0) - pain[a].reduce((s, x) => s + x.score, 0));
  const perKind: Probe[][] = kinds.map((kind) => {
    const priority = Math.max(0, ...champion.rules.filter((r) => r.on === kind).map((r) => r.priority)) + 10;
    const list: Probe[] = [];
    for (const { f } of pain[kind]) {
      for (const t of thresholds(kind, f, samples)) {
        for (const a of probeActions(kind, champion)) {
          const id = `probe-${KIND_CODE[kind]}-${a.code}-${f.replace(/_/g, '').slice(0, 8)}-${idNum(t.v)}`.slice(0, 32);
          if (champion.rules.some((r) => r.id === id)) continue;
          const rule: Rule = { id, on: kind, priority, when: [{ f, op: t.op, v: t.v }], do: a.action, say: `Probe rule: ${f} is {${f}}` };
          const p = structuredClone(champion);
          p.rules = [...p.rules, rule];
          p.meta = { ...p.meta, id };
          const v = validatePolicy(p);
          if (v.ok) list.push({ id, label: `new rule on ${kind}: ${a.text} when ${f} ${t.op} ${t.v}`, policy: v.policy, rule });
        }
      }
    }
    return list;
  });
  const out: Probe[] = [];
  for (let i = 0; perKind.some((l) => i < l.length); i++) for (const l of perKind) if (i < l.length) out.push(l[i]!);
  return out;
}

/**
 * Edit probes on the champion: (a) each rule removed, (b) one bus moved between every ordered pair of routes (no route
 * below 1 bus), (c) each decision kind's default swapped for its cheapest alternative, (d) each hold rule skipped while a
 * queue of 20/40/80 waits, (e) each rule threshold scaled ×0.5 and ×1.5; then (f) new single-condition rules from
 * `newRuleProbes` when findings and decision samples are given. Invalid variants are dropped; at most `limit` in total.
 */
export function championProbes(champion: Policy, o: { results?: RunResult[]; samples?: FeatureSamples; limit?: number } = {}): Probe[] {
  const limit = o.limit ?? MAX_PROBES;
  const out: Probe[] = [];
  const editCap = o.samples ? Math.min(limit, MAX_EDIT_PROBES) : limit;
  const add = (id: string, label: string, edit: (p: Policy) => void) => {
    if (out.length >= editCap) return;
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
      const v = Math.min(spec.max, Math.max(spec.min, Math.round(c.v * k * 100) / 100));
      if (v === c.v) continue;
      add(`thr-${r.id}-${j}-${k}`, `rule ${r.id}: ${c.f} ${c.op} ${c.v} → ${v}`, (p) => { p.rules[i]!.when[j]!.v = v; });
    }
  }));
  if (o.samples) {
    for (const probe of newRuleProbes(champion, o.results ?? [], o.samples)) {
      if (out.length >= limit) break;
      out.push(probe);
    }
  }
  return out;
}

/** Run `policy` on `instances` and record the feature vector of every decision point, per decision kind (real engine). */
export function sampleFeatures(policy: Policy, instances: ScenarioInstance[] = evolveInstances('train')): FeatureSamples {
  const out: FeatureSamples = {};
  const inner = new PolicyController(policy);
  const recorder: Controller & { policy: Policy } = {
    id: inner.id, policy,
    decide(dp, obs) {
      const list = (out[dp.kind] ??= []);
      if (list.length < MAX_SAMPLES_PER_KIND) list.push({ ...dp.features });
      return inner.decide(dp, obs);
    },
  };
  for (const scenario of instances) runSync({ map: TOWN, scenario, controller: recorder });
  return out;
}

/**
 * Score every probe on the TRAINING split (never validation or test) against the champion's training J; results are
 * sorted best first (most negative ΔJ). A probe that fails to evaluate is skipped. `onProbe` reports each result.
 */
export async function runProbes(
  evaluate: (policy: Policy, split: EvolveSplit) => Promise<Evaluation>, champion: Policy, championJ: number,
  onProbe?: (r: ProbeResult, runs: number) => void,
  o: { results?: RunResult[]; samples?: FeatureSamples; limit?: number } = {},
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const probe of championProbes(champion, o)) {
    try {
      const ev = await evaluate(probe.policy, 'train');
      const deltaPct = championJ > 0 ? Math.round((10_000 * (ev.score.J - championJ)) / championJ) / 100 : 0;
      const r: ProbeResult = { id: probe.id, label: probe.label, J: ev.score.J, deltaPct, ...(probe.rule ? { rule: probe.rule } : {}) };
      out.push(r);
      onProbe?.(r, ev.results.length);
    } catch { /* a probe is evidence only: skip it */ }
  }
  return out.sort((a, b) => a.deltaPct - b.deltaPct || a.id.localeCompare(b.id));
}
