// Owner: Task P. Explanation templates filled from real values (spec §6). Stub until filled.
import type { Action, FeatureVector } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function explain(say: string, features: FeatureVector, action: Action): string { return ni(`explain ${say} ${Object.keys(features).length} ${action.type}`); }
