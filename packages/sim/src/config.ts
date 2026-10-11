// Owner: Task M. SimConfig defaults (spec §5.3, all tunable).
import type { SimConfig } from './contracts';

export const DEFAULT_CONFIG: SimConfig = {
  // '3' (Play UX v2): 2 reserve buses in a depot beside Central (deploy intent/action, depot_check), 3-car train.
  simVersion: '3',
  bus: { count: 6, capacity: 40, speed: 0.3, boardS: 2, alightS: 1.5, minDwellS: 8, reserve: 2 },
  // Train speed 1.2 u/s (was 0.75; sim tuning, docs/research/sim-tuning.md): the regional loop is 234.5 u, so a loop is
  // ~5.5 min nominal (195 s running + 3 × 45 s dwells) and ~6 min in the stadium crush.
  // 3 linked cars × 80 riders (v3; was one 160-rider train).
  train: {
    cars: 3, capacity: 240, speed: 1.2, minDwellS: 30, maxDwellS: 120, defaultDwellS: 45,
    boardS: 0.5, alightS: 0.4, carSpacing: 4.6,
  },
  walk: { meanSpeed: 0.05, sdSpeed: 0.01, minSpeed: 0.03, maxSpeed: 0.07, detourFactor: 1.25, accessRadius: 14 },
  limits: { maxHoldS: 90, maxHoldPerLoopS: 180, maxLayoverS: 300, minBusesPerRoute: 1 },
  objective: { unfinishedPenaltyS: 2700, missedWindowS: 120, bunchingFraction: 0.25 },
};

/** The bus depot (v3): beside Central, the shared r1/r2 terminal. A deployed reserve spends `exitS` pulling out of the
 *  lot (VehicleState 'depot', holdUntil = when it reaches Central), then joins its route there (r1/r2: layover at
 *  Central; r3: deadheads Central → Stadium Gate like an r1 → r3 reassign). `depot_check` is raised every
 *  `checkEveryS` while reserves remain. `fromRoute` is the route whose terminal the depot sits beside. */
export const DEPOT = { exitS: 20, checkEveryS: 60, fromRoute: 'r1' } as const;

/** Fresh config: defaults overlaid group by group (a partial group only overrides the keys it names). */
export function withConfig(p?: Partial<SimConfig>): SimConfig {
  const d = DEFAULT_CONFIG;
  return {
    simVersion: p?.simVersion ?? d.simVersion,
    bus: { ...d.bus, ...p?.bus },
    train: { ...d.train, ...p?.train },
    walk: { ...d.walk, ...p?.walk },
    limits: { ...d.limits, ...p?.limits },
    objective: { ...d.objective, ...p?.objective },
  };
}
