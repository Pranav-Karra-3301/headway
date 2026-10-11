// Owner: T4. Designer prompts (spec §8.3). Stub until filled.
import type { Emphasis, Policy } from '@headway/sim';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function designerSystemPrompt(): string { return ni('designerSystemPrompt'); }
export function designerUserPrompt(a: { emphasis: Emphasis; champion: Policy; digest: string }): string { return ni('designerUserPrompt ' + a.emphasis); }
export function repairPrompt(errors: string[]): string { return ni('repairPrompt ' + errors.length); }
