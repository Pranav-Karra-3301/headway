// Owner: Task P. Feature whitelist per decision kind (spec §6). The sim computes exactly these features
// from the Observation, so the HUD inspector shows the same numbers the rules see.
import type { DecisionKind } from '../contracts';

export interface FeatureSpec { min: number; max: number; desc: string }

const headway = {
  target_headway_s: { min: 60, max: 1800, desc: 'params.targetHeadwayS[route] ?? round(nominalLoopS / buses_on_route)' },
  headway_ratio: { min: 0, max: 10, desc: 'headway_ahead_s / target_headway_s' },
};
const eventIn: FeatureSpec = {
  min: -9999, max: 9999, desc: 's to the next advertised event (< 0 after the last one, 9999 if none)',
};

/** r1_x, r2_x, r3_x sharing one spec (depot_check). */
const perRoute = (x: string, spec: FeatureSpec): Record<string, FeatureSpec> => ({ [`r1_${x}`]: spec, [`r2_${x}`]: spec, [`r3_${x}`]: spec });

export const FEATURES: Record<DecisionKind, Record<string, FeatureSpec>> = {
  bus_at_stop: {
    onboard: { min: 0, max: 40, desc: 'riders aboard after boarding' },
    load_factor: { min: 0, max: 1, desc: 'onboard / capacity' },
    queue_here: { min: 0, max: 500, desc: 'still waiting here for this route' },
    headway_ahead_s: { min: 0, max: 3600, desc: 's since the last same-route departure here (3600 if none)' },
    headway_behind_s: { min: 0, max: 3600, desc: 'ETA of the next same-route bus (3600 if none)' },
    ...headway,
    train_eta_s: { min: 0, max: 9999, desc: "train arrival at this stop's station (9999 if none or > 900 s)" },
    expected_transfers: { min: 0, max: 240, desc: 'train riders who will transfer to this route here' },
    downstream_queue: { min: 0, max: 1000, desc: 'waiting for this route at the next 2 stops' },
    hold_used_s: { min: 0, max: 180, desc: 'hold seconds used this loop' },
    is_station: { min: 0, max: 1, desc: '1 if the stop is paired with a station' },
    event_in_s: eventIn,
  },
  bus_at_terminal: {
    route_queue: { min: 0, max: 2000, desc: 'total waiting for this route' },
    max_other_route_queue: { min: 0, max: 2000, desc: 'the largest such total on another route' },
    queue_ratio_other: { min: 0, max: 2000, desc: 'max_other_route_queue / max(route_queue, 1)' },
    buses_on_route: { min: 1, max: 8, desc: 'buses on this route, including this one' },
    headway_ahead_s: { min: 0, max: 3600, desc: 's since the last terminal departure on this route (3600 if none)' },
    ...headway,
    layover_s: { min: 0, max: 300, desc: 'time at the terminal so far' },
    event_in_s: eventIn,
  },
  train_at_station: {
    onboard: { min: 0, max: 240, desc: 'riders aboard' },
    platform_queue: { min: 0, max: 1000, desc: 'waiting on this platform' },
    buses_here_or_due_60s: { min: 0, max: 8, desc: 'buses at the paired stop or arriving within 60 s' },
    next_bus_eta_s: { min: 0, max: 3600, desc: 'soonest bus ETA at the paired stop (3600 if none)' },
    transfers_alighted: { min: 0, max: 240, desc: 'riders who just alighted heading for buses here' },
    dwell_s: { min: 0, max: 120, desc: 'dwell so far' },
    event_in_s: eventIn,
  },
  // v3: raised every 60 s while reserve buses are parked in the depot (beside Central, the r1/r2 terminal).
  depot_check: {
    reserves_left: { min: 0, max: 8, desc: 'reserve buses still parked in the depot' },
    ...perRoute('queue', { min: 0, max: 2000, desc: 'total waiting for that route' }),
    max_route_queue: { min: 0, max: 2000, desc: 'the largest route total' },
    queue_ratio: { min: 0, max: 2000, desc: 'max_route_queue / max(1, mean of the other two)' },
    ...perRoute('left_behind', { min: 0, max: 1000, desc: 'of those, left behind by a full bus' }),
    ...perRoute('gap_s', { min: 0, max: 3600, desc: 's since that route last served its most-neglected stop' }),
    event_in_s: eventIn,
  },
};

/** Action parameters a `say` template may use, per kind (filled from the resolved action). */
const ACTION_PARAMS: Record<DecisionKind, string[]> = {
  bus_at_stop: ['seconds'],
  bus_at_terminal: ['seconds', 'to'],
  train_at_station: ['dwellS'],
  depot_check: ['to'],
};

/** Every `{name}` a rule's `say` may use: the kind's features plus its action parameters. */
export const PLACEHOLDERS: Record<DecisionKind, string[]> = {
  bus_at_stop: [...Object.keys(FEATURES.bus_at_stop), ...ACTION_PARAMS.bus_at_stop],
  bus_at_terminal: [...Object.keys(FEATURES.bus_at_terminal), ...ACTION_PARAMS.bus_at_terminal],
  train_at_station: [...Object.keys(FEATURES.train_at_station), ...ACTION_PARAMS.train_at_station],
  depot_check: [...Object.keys(FEATURES.depot_check), ...ACTION_PARAMS.depot_check],
};
