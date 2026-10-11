// Owner: U1. "Same crowd · different dispatcher": run Baseline, Hand-written and the AI champion headlessly on one crowd
// (runSync, ~10 ms each) and keep the three numbers the Watch panel draws as bars. Cached per crowd + champion.
import { G0, PolicyController, REF, TOWN, runSync } from '@headway/sim';
import type { Policy, ScenarioInstance } from '@headway/sim';

export type CompareKey = 'g0' | 'ref' | 'champion';
export interface CompareRow { key: CompareKey; waitS: number; gaveUp: number; homePct: number }

const cache = new Map<string, CompareRow[] | null>();

export function compareCacheKey(scenario: ScenarioInstance, champion: Policy | null): string {
  return `${scenario.scenarioId}:${scenario.seed}:${(champion ?? G0).meta.id}`;
}

export function cachedComparison(scenario: ScenarioInstance, champion: Policy | null): CompareRow[] | null | undefined {
  return cache.get(compareCacheKey(scenario, champion));
}

/** Runs all three controllers on this crowd; null when the engine cannot run it. */
export function compareCrowd(scenario: ScenarioInstance, champion: Policy | null): CompareRow[] | null {
  const k = compareCacheKey(scenario, champion);
  if (cache.has(k)) return cache.get(k)!;
  let rows: CompareRow[] | null;
  try {
    const policies: Array<[CompareKey, Policy]> = [['g0', G0], ['ref', REF], ['champion', champion ?? G0]];
    rows = policies.map(([key, policy]) => {
      const m = runSync({ map: TOWN, scenario, controller: new PolicyController(policy) }).metrics;
      return { key, waitS: m.meanWaitS, gaveUp: m.walkaways, homePct: m.completionPct };
    });
  } catch {
    rows = null;
  }
  cache.set(k, rows);
  return rows;
}
