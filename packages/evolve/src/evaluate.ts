// Owner: T4. Evaluate a policy on scenario instances with the real engine. Stub until filled.
import type { Policy, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function evaluatePolicy(policy: Policy, instances: ScenarioInstance[]): { score: SplitScore; results: RunResult[] } { return ni('evaluatePolicy ' + instances.length + String(!!policy)); }
