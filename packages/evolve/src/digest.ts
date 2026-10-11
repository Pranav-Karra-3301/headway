// Owner: T4. Evidence digest for designers (spec §8.3). Stub until filled.
import type { Policy, Proposal, RunResult, SplitScore } from '@headway/sim';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function buildDigest(a: { champion: { policy: Policy; results: RunResult[] }; baseline: SplitScore; reference: SplitScore; history: Proposal[] }): string { return ni('buildDigest ' + a.history.length); }
