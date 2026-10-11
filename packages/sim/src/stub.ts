// Owner: Task M. Contract-conformant fake sim for renderer/HUD development. Stub until filled.
import type { ScenarioInstance, Sim, TownMap } from './contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function createStubSim(a: { map: TownMap; scenario: ScenarioInstance }): Sim { return ni(`stub.createStubSim ${a.scenario.scenarioId}`); }
