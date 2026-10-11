// Owner: T3b. Pure view models for the inspector card (spec §10: vehicle / stop / person).
import type {
  DecisionSource, Leg, Observation, PassengerInfo, RouteId, SimSnapshot, StationId, StopId, TownMap, VehicleState,
} from '@headway/sim';
import {
  ROUTE_IDS, actionLabel, localClock, minutes, routeName, severityOf, stateLabel, stationName, stationOfStop, stationOrder,
  stopName, townMap, zoneName,
} from './format';
import type { Severity } from './format';

export interface VehicleModel {
  kind: 'bus' | 'train';
  id: string;
  title: string;
  /** Route name for buses, "Rail loop" for the train. */
  subtitle: string;
  routeId: RouteId | null;
  state: VehicleState;
  stateLabel: string;
  onboard: number;
  capacity: number;
  /** 0..100, rounded. */
  loadPct: number;
  next: { name: string; etaS: number | null } | null;
  holdLeftS: number | null;
  /** Length of the current hold when the last decision set it (for the ring timer). */
  holdTotalS: number | null;
  headway: { aheadS: number | null; behindS: number | null; targetS: number | null } | null;
  decision: { text: string; ruleId: string; source: DecisionSource; action: string; clock: string; agoS: number } | null;
  train: {
    alightingNext: number;
    transfers: Array<{ routeId: RouteId; n: number }>;
    departInS: number | null;
    platforms: Array<{ id: StationId; name: string; queue: number }>;
  } | null;
}

export interface StopModel {
  id: StopId;
  name: string;
  queue: number;
  longestWaitS: number;
  severity: Severity;
  byRoute: Array<{ routeId: RouteId; n: number }>;
  arrivals: Array<{ vehicleId: string; routeId: RouteId | null; kind: 'bus' | 'train'; etaS: number }>;
  lastDeparture: Array<{ routeId: RouteId; agoS: number }>;
  platform: { stationId: StationId; name: string; queue: number } | null;
}

export interface PersonModel {
  id: number;
  title: string;
  from: string;
  to: string;
  legs: Array<{ kind: Leg['kind']; label: string; detail: string; state: 'done' | 'now' | 'next'; routes: RouteId[] }>;
  status: string;
  waitedS: number;
  patienceS: number;
  /** waited / patience, 0..100. */
  patiencePct: number;
  reason: string;
  expectedS: number;
}

const pctOf = (a: number, b: number) => (b > 0 ? Math.round(Math.min(1, Math.max(0, a / b)) * 100) : 0);

export function vehicleModel(id: string, obs: Observation | null, snap: SimSnapshot | null, map: TownMap | null = townMap()): VehicleModel | null {
  const view = snap?.vehicles.find((v) => v.id === id) ?? null;
  // The per-frame snapshot is fresher than the 4 Hz observation: prefer it for state, fall back to the observation.
  const t = snap?.t ?? obs?.t ?? 0;
  const lag = obs ? Math.max(0, t - obs.t) : 0;
  const clockStart = obs?.scenario.clockStart ?? '00:00';
  const rec = view?.lastDecision ?? null;
  const decision = rec
    ? { text: rec.explanation, ruleId: rec.ruleId, source: rec.source, action: actionLabel(rec.action), clock: localClock(clockStart, rec.t), agoS: Math.max(0, t - rec.t) }
    : null;

  const isTrain = view ? view.kind === 'train' : obs ? obs.buses.every((b) => b.id !== id) && /^t\d*$/.test(id) : false;
  if (isTrain) {
    const tr = obs?.train;
    if (!tr && !view) return null;
    const onboard = view?.onboard ?? tr?.onboard ?? 0;
    const capacity = view?.capacity ?? tr?.capacity ?? 0;
    const state = view?.state ?? tr?.state ?? 'moving';
    return {
      kind: 'train', id, title: 'Train', subtitle: 'Rail loop', routeId: null, state, stateLabel: state === 'dwelling' ? 'At platform' : stateLabel(state),
      onboard, capacity, loadPct: pctOf(onboard, capacity),
      next: tr ? { name: stationName(tr.stationId, map), etaS: Math.max(0, tr.etaS - lag) } : null,
      holdLeftS: null, holdTotalS: null, headway: null, decision,
      train: tr ? {
        alightingNext: tr.alightingNext,
        transfers: ROUTE_IDS.map((r) => ({ routeId: r, n: tr.transfersNext?.[r] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
        departInS: tr.departAt != null ? Math.max(0, tr.departAt - t) : null,
        platforms: stationOrder(map).map((s) => ({ id: s, name: stationName(s, map), queue: tr.platformQueue?.[s] ?? 0 })),
      } : null,
    };
  }

  const ob = obs?.buses.find((b) => b.id === id) ?? null;
  if (!ob && !view) return null;
  const routeId = view?.routeId ?? ob?.routeId ?? null;
  const onboard = view?.onboard ?? ob?.onboard ?? 0;
  const capacity = view?.capacity ?? ob?.capacity ?? 0;
  const state = view?.state ?? ob?.state ?? 'moving';
  const holdUntil = view ? view.holdUntil : ob?.holdUntil ?? null;
  const nextStopId = view?.nextStopId ?? ob?.nextStopId ?? null;
  const etaS = ob?.etaNextStopS != null && ob.nextStopId === nextStopId ? Math.max(0, ob.etaNextStopS - lag) : null;
  const target = routeId ? obs?.routes.find((r) => r.id === routeId)?.targetHeadwayS ?? null : null;
  return {
    kind: 'bus', id, title: `Bus ${id}`, subtitle: routeId ? routeName(routeId, map) : 'Unassigned', routeId, state,
    stateLabel: state === 'deadhead' ? 'Deadheading' : stateLabel(state),
    onboard, capacity, loadPct: pctOf(onboard, capacity),
    next: nextStopId ? { name: stopName(nextStopId, map), etaS } : null,
    holdLeftS: holdUntil != null && holdUntil > t ? holdUntil - t : null,
    holdTotalS: rec && rec.action.type === 'hold' && holdUntil != null && holdUntil > rec.t ? holdUntil - rec.t : null,
    headway: ob ? { aheadS: ob.headwayAheadS, behindS: ob.headwayBehindS, targetS: target } : null,
    decision, train: null,
  };
}

export function stopModel(id: StopId, obs: Observation | null, map: TownMap | null = townMap()): StopModel | null {
  if (!obs) return null;
  const s = obs.stops.find((x) => x.id === id);
  const t = obs.t;
  const stationId = stationOfStop(id, map);
  const arrivals: StopModel['arrivals'] = obs.buses
    .filter((b) => b.nextStopId === id && b.etaNextStopS != null)
    .map((b) => ({ vehicleId: b.id, routeId: b.routeId, kind: 'bus' as const, etaS: b.etaNextStopS! }));
  if (stationId && obs.train.stationId === stationId) {
    arrivals.push({ vehicleId: 't1', routeId: null, kind: 'train', etaS: obs.train.etaS });
  }
  arrivals.sort((a, b) => a.etaS - b.etaS || a.vehicleId.localeCompare(b.vehicleId));
  const queue = s?.queue ?? 0;
  const longestWaitS = s?.longestWaitS ?? 0;
  return {
    id, name: stopName(id, map), queue, longestWaitS, severity: severityOf(longestWaitS),
    byRoute: ROUTE_IDS.map((r) => ({ routeId: r, n: s?.queueByRoute?.[r] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n),
    arrivals: arrivals.slice(0, 4),
    lastDeparture: ROUTE_IDS.flatMap((r) => {
      const d = s?.lastDepartureT?.[r];
      return d == null ? [] : [{ routeId: r, agoS: Math.max(0, t - d) }];
    }),
    platform: stationId ? { stationId, name: stationName(stationId, map), queue: obs.train.platformQueue?.[stationId] ?? 0 } : null,
  };
}

export function personModel(info: PassengerInfo | null, map: TownMap | null = townMap()): PersonModel | null {
  if (!info) return null;
  const arrived = /arriv/i.test(info.status);
  const legs = info.itinerary.legs.map((leg, i) => {
    const state: 'done' | 'now' | 'next' = arrived || i < info.legIndex ? 'done' : i === info.legIndex ? 'now' : 'next';
    switch (leg.kind) {
      case 'walk':
        return { kind: leg.kind, label: 'Walk', detail: minutes(leg.durationS), state, routes: [] as RouteId[] };
      case 'bus':
        return { kind: leg.kind, label: `Bus ${leg.routes.join(' / ')}`, detail: `${stopName(leg.board, map)} → ${stopName(leg.alight, map)}`, state, routes: leg.routes };
      case 'train':
        return { kind: leg.kind, label: 'Train', detail: `${stationName(leg.board, map)} → ${stationName(leg.alight, map)}`, state, routes: [] as RouteId[] };
    }
  });
  return {
    id: info.id, title: `Rider #${info.id}`, from: zoneName(info.origin, map), to: zoneName(info.dest, map), legs,
    status: info.status, waitedS: info.waitedS, patienceS: info.patienceS, patiencePct: pctOf(info.waitedS, info.patienceS),
    reason: info.reason, expectedS: info.itinerary.expectedCostS,
  };
}
