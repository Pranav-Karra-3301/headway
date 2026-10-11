// Owner: T1b. Demand generation + trip planning (spec §5.4).
import type { PassengerSpec, ScenarioDef, SimConfig, TownMap } from '../contracts';
import type { TripPlanner } from '../internal';
import { generatePassengers as generate } from './demand';
import { createTripPlanner as createPlanner } from './planner';

/** The run's passengers, drawn up front from `demand` and `behavior:${pid}` streams; sorted by spawnT, ids 0…n−1. */
export function generatePassengers(map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig): PassengerSpec[] {
  return generate(map, def, seed, cfg);
}

/** Itinerary choice at spawn and the one-time patience reconsideration (pure, deterministic). */
export function createTripPlanner(map: TownMap, cfg: SimConfig): TripPlanner {
  return createPlanner(map, cfg);
}
