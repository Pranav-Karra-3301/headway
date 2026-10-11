// Owner: T1b. Demand generation + trip planning (spec §5.4). Stub until filled.
import type { PassengerSpec, ScenarioDef, SimConfig, TownMap } from '../contracts';
import type { TripPlanner } from '../internal';
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export function generatePassengers(map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig): PassengerSpec[] { return ni(`generatePassengers ${map.version} ${def.id} ${seed} ${cfg.simVersion}`); }
export function createTripPlanner(map: TownMap, cfg: SimConfig): TripPlanner { return ni(`createTripPlanner ${map.version} ${cfg.simVersion}`); }
