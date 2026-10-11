// Owner: T6. Jev-backed station-hold controller (spec §9). Stub until filled.
import type { Action, AsyncController, Decision, DecisionPoint, Observation, Policy, SimConfig, TownMap } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export interface DecisionProvider {
  choose(req: { instructions: string; situation: string; options: string[] }): Promise<{ index: number; probs: number[]; latencyMs: number }>;
}
export class JevController implements AsyncController {
  readonly async = true as const;
  readonly id: string;
  constructor(readonly policy: Policy, readonly provider: DecisionProvider, readonly opts: { timeoutMs?: number; map?: TownMap } = {}) {
    this.id = 'jev:' + (policy.meta?.id ?? 'policy');
  }
  decide(dp: DecisionPoint, obs: Observation): Promise<Decision> { return ni(`JevController.decide ${dp.kind} ${obs.t}`); }
}
export function situationText(dp: DecisionPoint, obs: Observation): string { return ni(`situationText ${dp.kind} ${obs.t}`); }
export function holdOptions(policy: Policy, dp: DecisionPoint, cfg: SimConfig): Array<{ label: string; action: Action }> { return ni(`holdOptions ${policy.meta?.id} ${dp.kind} ${cfg.simVersion}`); }
