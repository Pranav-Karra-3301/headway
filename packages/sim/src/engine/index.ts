// Owner: T1a. The deterministic engine (spec §5). Stub until filled.
import type { Controller, CreateSimArgs, DecisionKind, FeatureVector, RunResult, Sim } from '../contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export type FeatureContext = unknown;
export function createSim(a: CreateSimArgs): Sim { return ni('createSim ' + a.scenario.scenarioId); }
export function runSync(a: CreateSimArgs & { controller: Controller }): RunResult { return ni('runSync ' + a.scenario.scenarioId); }
export function runAsync(a: CreateSimArgs): Promise<RunResult> { return ni('runAsync ' + a.scenario.scenarioId); }
export function computeFeatures(kind: DecisionKind, ctx: FeatureContext): FeatureVector { return ni('computeFeatures ' + kind + String(ctx)); }
