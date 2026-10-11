// Running the engine in the worker: split scores for /api/evolve, play-seed runs for the leaderboard, sealed runs.
import { evaluatePolicy } from '@headway/evolve';
import { PolicyController, runSync, SEEDS, TOWN } from '@headway/sim';
import type { FailureFinding, Intent, Metrics, Policy, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
import type { Evaluate } from './env';

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Split score over runs. Mirrors `aggregateResults` in packages/evolve/src/aggregate.ts (not exported from the barrel),
 *  so worker and CLI numbers agree: J and counts summed, completion from totals, journey weighted by completed, waits by spawned. */
export function aggregate(results: RunResult[]): SplitScore {
  const ms = results.map((r) => r.metrics);
  const sum = (f: (m: Metrics) => number) => ms.reduce((acc, m) => acc + f(m), 0);
  const spawned = sum((m) => m.spawned);
  const completed = sum((m) => m.completed);
  const weighted = (f: (m: Metrics) => number, w: (m: Metrics) => number) => {
    const total = sum(w);
    return total > 0 ? round2(sum((m) => f(m) * w(m)) / total) : 0;
  };
  const J = round2(sum((m) => m.J));
  return {
    J,
    runs: results.length,
    metrics: {
      J, spawned, completed, unfinished: sum((m) => m.unfinished),
      completionPct: spawned > 0 ? round2((100 * completed) / spawned) : 0,
      meanJourneyS: weighted((m) => m.meanJourneyS, (m) => m.completed),
      meanWaitS: weighted((m) => m.meanWaitS, (m) => m.spawned),
      p95WaitS: weighted((m) => m.p95WaitS, (m) => m.spawned),
      maxWaitS: ms.reduce((acc, m) => Math.max(acc, m.maxWaitS), 0),
      transfersMade: sum((m) => m.transfersMade),
      missedConnections: sum((m) => m.missedConnections),
      leftBehind: sum((m) => m.leftBehind),
      walkaways: sum((m) => m.walkaways),
      effort: {
        busDistanceU: round2(sum((m) => m.effort.busDistanceU)),
        deadheadDistanceU: round2(sum((m) => m.effort.deadheadDistanceU)),
        holdS: sum((m) => m.effort.holdS),
        trainDwellS: sum((m) => m.effort.trainDwellS),
      },
    },
  };
}

/** Top `n` findings by impactS across runs (as on Proposal/Generation records). */
export function topFindings(results: RunResult[], n = 8): FailureFinding[] {
  return results.flatMap((r) => r.findings).sort((a, b) => b.impactS - a.impactS).slice(0, n);
}

/** One headless run of `policy` (plus optional human intents) on a scenario instance. */
export function runPolicy(policy: Policy, scenario: ScenarioInstance, intents?: Array<{ t: number; intent: Intent }>): RunResult {
  return runSync({ map: TOWN, scenario, controller: new PolicyController(policy), ...(intents?.length ? { intents } : {}) });
}

/** Default `AppDeps.evaluate`: the CLI's own scorer (`evaluatePolicy`) on train = stadium_exit + class_change × 1001–1004,
 *  val = × 2001–2002 (spec §7), so worker and CLI rounds score identically. */
export const evaluateSplit: Evaluate = async (policy, split) => evaluatePolicy(policy, SEEDS[split]);

/** Everything but meta: what the simulator actually runs (a memo key; key order as stored). */
export const policyKey = (p: Policy): string => JSON.stringify({ params: p.params, rules: p.rules, defaults: p.defaults, advisor: p.advisor ?? null });

/** Per-request memo: a round asks for the champion's scores more than once (spec §7 caches them per policy and split). */
export function memoEvaluate(evaluate: Evaluate): Evaluate {
  const memo = new Map<string, ReturnType<Evaluate>>();
  return (policy, split) => {
    const key = `${split}|${policyKey(policy)}`;
    let hit = memo.get(key);
    if (!hit) {
      hit = evaluate(policy, split);
      memo.set(key, hit);
      hit.catch(() => memo.delete(key));
    }
    return hit;
  };
}
