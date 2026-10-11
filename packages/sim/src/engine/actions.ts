// Owner: T1a. Action resolution shared by the engine and PolicyController (spec §5.5, §6): resolves
// `hold until target_headway` and `reassign busiest` to concrete parameters, clamps holds and dwells to their
// bounds, and reports inapplicable actions as null (the policy then tries its next rule, the engine its default).
import type { Action, DecisionKind, FeatureVector, RouteId } from '../contracts';

export interface ResolveCtx {
  kind: DecisionKind;
  features: FeatureVector;
  /** The deciding bus's route (bus decisions). */
  routeId?: RouteId;
  /** Route ids that exist on the map (for `busiest`). */
  routeIds: readonly RouteId[];
  /** Total waiting for a route across its stops (same number as the `route_queue` feature). */
  routeQueue: (r: RouteId) => number;
  /** min(cfg.limits.maxHoldS, policy.params.maxHoldS). */
  maxHoldS: number;
  maxHoldPerLoopS: number;
  maxLayoverS: number;
  minBusesPerRoute: number;
  trainMinDwellS: number;
  trainMaxDwellS: number;
}

export const STOP_HOLD_MIN_S = 5;
export const TERMINAL_HOLD_S: [number, number] = [10, 120];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** The route with the largest total queue, excluding `own`; ties → lowest id. */
export function busiestRoute(own: RouteId | undefined, ids: readonly RouteId[], q: (r: RouteId) => number): RouteId | null {
  let best: RouteId | null = null;
  for (const id of [...ids].sort()) {
    if (id === own) continue;
    if (best === null || q(id) > q(best)) best = id;
  }
  return best;
}

/** Concrete, clamped action for this decision point, or null when the action is illegal here or a no-op. */
export function resolveAction(action: Action | null | undefined, c: ResolveCtx): Action | null {
  if (!action || typeof action !== 'object') return null;
  const f = c.features;
  switch (c.kind) {
    case 'bus_at_stop': {
      if (action.type === 'continue') return { type: 'continue' };
      if (action.type !== 'hold') return null;
      let s = 'seconds' in action ? Number(action.seconds) : (f.target_headway_s ?? NaN) - (f.headway_ahead_s ?? NaN);
      if (!(s > 0)) return null;
      s = Math.min(Math.max(Math.round(s), STOP_HOLD_MIN_S), Math.floor(c.maxHoldS));
      s = Math.min(s, c.maxHoldPerLoopS - (f.hold_used_s ?? 0));
      return s > 0 ? { type: 'hold', seconds: s } : null;
    }
    case 'bus_at_terminal': {
      if (action.type === 'dispatch') return { type: 'dispatch' };
      if (action.type === 'hold') {
        let s = 'seconds' in action ? Number(action.seconds) : (f.target_headway_s ?? NaN) - (f.headway_ahead_s ?? NaN);
        if (!(s > 0)) return null;
        s = clamp(Math.round(s), TERMINAL_HOLD_S[0], TERMINAL_HOLD_S[1]);
        s = Math.min(s, c.maxLayoverS - (f.layover_s ?? 0));
        return s > 0 ? { type: 'hold', seconds: s } : null;
      }
      if (action.type === 'reassign') {
        const to = action.to === 'busiest' ? busiestRoute(c.routeId, c.routeIds, c.routeQueue) : action.to;
        if (!to || to === c.routeId || !c.routeIds.includes(to)) return null;
        if ((f.buses_on_route ?? 0) - 1 < c.minBusesPerRoute) return null;
        return { type: 'reassign', to };
      }
      return null;
    }
    case 'train_at_station': {
      if (action.type !== 'setTrainDeparture') return null;
      const d = Number(action.dwellS);
      if (!Number.isFinite(d)) return null;
      return { type: 'setTrainDeparture', dwellS: clamp(Math.round(d), c.trainMinDwellS, c.trainMaxDwellS) };
    }
  }
  return null;
}

/** Last-resort action when neither the decision nor the policy default applies. */
export function safeAction(kind: DecisionKind, trainDwellS: number): Action {
  if (kind === 'bus_at_stop') return { type: 'continue' };
  if (kind === 'bus_at_terminal') return { type: 'dispatch' };
  return { type: 'setTrainDeparture', dwellS: trainDwellS };
}

/** Explanation for a default (no rule fired) decision. */
export function defaultExplanation(action: Action): string {
  switch (action.type) {
    case 'continue': return 'No rule fired: leaving on schedule';
    case 'dispatch': return 'No rule fired: starting the next loop';
    case 'hold': return 'seconds' in action ? `Holding ${action.seconds}s (default)` : 'Holding to the target headway (default)';
    case 'reassign': return `Moving to ${action.to} (default)`;
    case 'setTrainDeparture': return `Standard ${action.dwellS}s station dwell`;
  }
}
