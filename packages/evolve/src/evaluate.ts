// Owner: T4. Evaluate a policy on scenario instances with the real engine (runSync + PolicyController on TOWN),
// plus a cached evaluator for the round runner (spec §7: scores are cached per (policy, simVersion, split)).
// No Node built-ins: this runs in Node, the browser and the Worker.
import { DEFAULT_CONFIG, G0, PolicyController, SEEDS, TOWN, runSync } from '@headway/sim';
import type { Generation, Policy, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
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
