// Owner: Task M. Scenario definitions and seed splits (spec §5.7, §7). Stub until filled.
import type { ScenarioDef, ScenarioInstance, ScenarioKind } from './contracts';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export const SCENARIOS = {} as Record<ScenarioKind, ScenarioDef>;
export const SEEDS: { train: ScenarioInstance[]; val: ScenarioInstance[]; showcase: ScenarioInstance[] } = { train: [], val: [], showcase: [] };
export function playInstance(dayIndex: number): ScenarioInstance { return { scenarioId: 'stadium_exit', seed: 50000 + dayIndex, split: 'play' }; }
export function scenarioDef(id: string): ScenarioDef { return (SCENARIOS as Record<string, ScenarioDef>)[id] ?? ni('scenario ' + id); }
