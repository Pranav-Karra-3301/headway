// Owner: T1a. Interprets a Policy at decision points (spec §6 semantics). Stub until filled.
import type { Controller, Decision, DecisionPoint, Observation, Policy } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export class PolicyController implements Controller {
  readonly id: string;
  constructor(readonly policy: Policy) { this.id = policy.meta?.id ?? 'policy'; }
  decide(dp: DecisionPoint, obs: Observation): Decision { return ni(`PolicyController.decide ${dp.kind} ${obs.t}`); }
}
