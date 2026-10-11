// Owner: T3b. Scripted, deterministic fake Sim for the HUD dev harness (never shipped). A stadium-exit-shaped
// evening: the crowd surges after closing, Apartments South starves, b4 holds for the train, the train fills.
import type {
  DecisionRecord, Observation, PassengerInfo, PersonView, QueuePlace, QueueView, Replay, RouteId, RunResult, Sim,
  SimSnapshot, StationId, StopId, Vec2, VehicleView,
} from '@headway/sim';
import { ROUTE_IDS, severityOf, townMap } from '../format';

export interface Loop { pts: Vec2[]; cum: number[]; len: number }
export function makeLoop(points: Vec2[]): Loop {
  const pts = [...points, points[0]!];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return { pts, cum, len: cum[cum.length - 1]! };
}
export function pointOn(l: Loop, d: number): { x: number; z: number; heading: number } {
  const dd = ((d % l.len) + l.len) % l.len;
  let i = 1;
  while (i < l.cum.length - 1 && l.cum[i]! < dd) i++;
  const a = l.pts[i - 1]!;
  const b = l.pts[i]!;
  const seg = l.cum[i]! - l.cum[i - 1]! || 1;
  const f = (dd - l.cum[i - 1]!) / seg;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(b.z - a.z, b.x - a.x) };
}

const FALLBACK_STOPS: Record<StopId, Vec2> = {
  stop_stadium_gate: { x: 25, z: -4 }, stop_stadium_stn: { x: 19, z: -15 }, stop_university_stn: { x: -15, z: -16 },
  stop_old_main: { x: -1, z: -9 }, stop_downtown: { x: 3, z: 3 }, stop_central_stn: { x: -19, z: 6 },
  stop_apts_north: { x: -7, z: 15 }, stop_apts_south: { x: 11, z: 19 },
};
const FALLBACK_STATIONS: Record<StationId, Vec2> = { stn_stadium: { x: 19, z: -20 }, stn_university: { x: -15, z: -21 }, stn_central: { x: -24, z: 6 } };
const ROUTE_STOPS: Record<RouteId, StopId[]> = {
  r1: ['stop_central_stn', 'stop_downtown', 'stop_old_main', 'stop_university_stn'],
  r2: ['stop_central_stn', 'stop_apts_north', 'stop_apts_south', 'stop_downtown'],
  r3: ['stop_stadium_gate', 'stop_stadium_stn', 'stop_old_main', 'stop_downtown'],
};
const STOP_IDS = Object.keys(FALLBACK_STOPS) as StopId[];
const STATIONS: StationId[] = ['stn_stadium', 'stn_university', 'stn_central'];
const STOP_STATION: Partial<Record<StopId, StationId>> = { stop_stadium_stn: 'stn_stadium', stop_university_stn: 'stn_university', stop_central_stn: 'stn_central' };

export interface Geo {
  stops: Record<StopId, Vec2>;
  queueDir: Record<StopId, Vec2>;
  stations: Record<StationId, Vec2>;
  routes: Record<RouteId, { loop: Loop; stopDist: number[]; stops: StopId[] }>;
  rail: { loop: Loop; stationDist: Record<StationId, number> };
}

/** Geometry from the real town map when it is loaded, else a hand-placed fallback with the same topology. */
export function buildGeo(): Geo {
  const m = townMap();
  if (m && m.routes?.length === 3 && m.rail?.loop?.points?.length) {
    const stops = Object.fromEntries(m.stops.map((s) => [s.id, s.p])) as Record<StopId, Vec2>;
    const queueDir = Object.fromEntries(m.stops.map((s) => [s.id, s.queueDir])) as Record<StopId, Vec2>;
    const stations = Object.fromEntries(m.rail.stations.map((s) => [s.id, s.platform])) as Record<StationId, Vec2>;
    const routes = Object.fromEntries(m.routes.map((r) => {
      const pts = r.path.closed ? r.path.points.slice(0, -1) : r.path.points;
      const loop = makeLoop(pts.length ? pts : [{ x: 0, z: 0 }]);
      return [r.id, { loop, stopDist: r.stopDist, stops: r.stops }];
    })) as Geo['routes'];
    const rl = makeLoop(m.rail.loop.points.slice(0, m.rail.loop.closed ? -1 : undefined));
    const stationDist = Object.fromEntries(m.rail.stations.map((s) => [s.id, s.dist])) as Record<StationId, number>;
    return { stops, queueDir, stations, routes, rail: { loop: rl, stationDist } };
  }
  const routes = {} as Geo['routes'];
  for (const r of ROUTE_IDS) {
    const ids = ROUTE_STOPS[r];
    const loop = makeLoop(ids.map((id) => FALLBACK_STOPS[id]));
    routes[r] = { loop, stopDist: ids.map((_, i) => loop.cum[i]!), stops: ids };
  }
  const railPts = [{ x: 19, z: -21.5 }, { x: -15, z: -22.5 }, { x: -25.5, z: 6 }, { x: -12, z: 24 }, { x: 28, z: 12 }];
  const rail = makeLoop(railPts);
  const queueDir = Object.fromEntries(STOP_IDS.map((id) => [id, { x: 0.8, z: 0.6 }])) as Record<StopId, Vec2>;
  return {
    stops: FALLBACK_STOPS, queueDir, stations: FALLBACK_STATIONS, routes,
    rail: { loop: rail, stationDist: { stn_stadium: rail.cum[0]!, stn_university: rail.cum[1]!, stn_central: rail.cum[2]! } },
  };
}

// ---------- scripted demand ----------
const noise = (k: number, t: number) => 0.5 + 0.5 * Math.sin(t / 37 + k * 1.7) * Math.cos(t / 91 + k * 0.6);
const surge = (t: number) => (t < 600 ? 0.06 : t < 720 ? 0.06 + 0.94 * ((t - 600) / 120) : Math.exp((720 - t) / 520));

interface Q { count: number; longestWaitS: number; byRoute: Partial<Record<RouteId, number>> }
function queueAt(place: QueuePlace, t: number): Q {
  const s = surge(t);
  const id = place.id;
  let count: number;
  let wait: number;
  if (place.kind === 'platform') {
    const base = id === 'stn_stadium' ? 64 * s : id === 'stn_central' ? 10 + 6 * noise(3, t) : 3 * noise(4, t);
    count = Math.round(base);
    wait = id === 'stn_stadium' ? 90 + 220 * s : 40 + 80 * noise(5, t);
    return { count, longestWaitS: Math.round(wait), byRoute: {} };
  }
  switch (id as StopId) {
    case 'stop_stadium_gate': count = 72 * s + 2; wait = 120 + 340 * s; break;
    case 'stop_stadium_stn': count = 30 * s + 1; wait = 90 + 200 * s; break;
    case 'stop_apts_south': count = t < 640 ? 2 : Math.min(24, 4 + (t - 640) / 18); wait = t < 640 ? 60 : Math.min(640, 140 + (t - 640) * 1.4); break;
    case 'stop_downtown': count = 9 + 8 * noise(1, t); wait = 100 + 90 * noise(2, t); break;
    case 'stop_central_stn': count = 6 + 7 * noise(6, t); wait = 70 + 80 * noise(7, t); break;
    default: count = 4 * noise(STOP_IDS.indexOf(id as StopId), t); wait = 50 + 70 * noise(9, t);
  }
  count = Math.max(0, Math.round(count));
  const served = ROUTE_IDS.filter((r) => ROUTE_STOPS[r].includes(id as StopId));
  const byRoute: Partial<Record<RouteId, number>> = {};
  let left = count;
  served.forEach((r, i) => {
    const n = i === served.length - 1 ? left : Math.round(count * (r === 'r3' ? 0.7 : 0.45));
    byRoute[r] = Math.max(0, Math.min(left, n));
    left -= byRoute[r]!;
  });
  return { count, longestWaitS: Math.round(count > 0 ? wait : 0), byRoute };
}

const EXPLAIN: Record<string, DecisionRecord['explanation']> = {
  b1: 'Dispatching: 3:40 since the last r1 bus, target 3:30',
  b2: 'Continuing: no transfers expected at Old Main',
  b3: 'Holding to headway: 1:10 behind b4',
  b5: 'Continuing: full, 12 waiting downtown',
  b6: 'Dispatching early: 61 waiting at Stadium Gate',
};

export class FakeSim implements Sim {
  t: number;
  done = false;
  private geo: Geo;
  constructor(t0: number, geo: Geo = buildGeo()) {
    this.t = t0;
    this.geo = geo;
  }

  step(): { pending: null } {
    if (this.done) return { pending: null };
    this.t += 1;
    if (this.t >= 2700) this.done = true;
    return { pending: null };
  }
  resolve(): void {}
  intent(): void {}

  private busState(id: string, idx: number) {
    const routeId = ROUTE_IDS[Math.floor(idx / 2)]!;
    const r = this.geo.routes[routeId];
    const v = 0.3;
    const t = this.t;
    const holdFrom = 830;
    const holdTo = 875;
    let dist = (r.loop.len * ((idx % 2) * 0.5 + idx * 0.07) + v * t) % r.loop.len;
    let state: VehicleView['state'] = 'moving';
    let holdUntil: number | null = null;
    if (id === 'b4' && t >= holdFrom - 40 && t < holdTo + 600) {
      const central = r.stopDist[0] ?? 0;
      if (t < holdTo) { dist = central; state = 'holding'; holdUntil = holdTo; }
      else dist = (central + v * (t - holdTo)) % r.loop.len;
    }
    let k = r.stopDist.findIndex((d) => d > dist + 0.01);
    if (k < 0) k = 0;
    const nextD = r.stopDist[k] ?? 0;
    const gap = (nextD - dist + r.loop.len) % r.loop.len;
    const onboard = id === 'b5' ? 40 : id === 'b4' ? 31 : Math.round(12 + 20 * noise(idx, t));
    return { routeId, dist, state, holdUntil, nextStopId: r.stops[k]!, etaS: Math.round(gap / v), onboard };
  }

  private trainState() {
    const t = this.t;
    const period = 360;
    const ph = ((t % period) + period) % period;
    const legs: StationId[] = ['stn_stadium', 'stn_university', 'stn_central'];
    const seg = Math.floor(ph / 120);
    const within = ph - seg * 120;
    const at = legs[seg]!;
    const next = legs[(seg + 1) % 3]!;
    const rl = this.geo.rail;
    const d0 = rl.stationDist[at];
    const d1raw = rl.stationDist[next];
    const d1 = d1raw > d0 ? d1raw : d1raw + rl.loop.len;
    const dwelling = within < 45;
    const dist = dwelling ? d0 : d0 + (d1 - d0) * ((within - 45) / 75);
    return {
      state: (dwelling ? 'dwelling' : 'moving') as VehicleView['state'],
      stationId: dwelling ? at : next, etaS: dwelling ? 0 : Math.round(120 - within), dist: dist % rl.loop.len,
      departAt: dwelling ? t - within + 45 : null, onboard: Math.round(70 + 85 * surge(t)),
    };
  }

  private running() {
    const t = this.t;
    const spawned = Math.round(Math.min(1500, 120 + t * 0.35 + 900 * Math.min(1, Math.max(0, (t - 600) / 500))));
    const completed = Math.round(spawned * Math.min(0.92, 0.25 + t / 2300));
    return {
      spawned, completed, waitingNow: 0, ridingNow: Math.round((spawned - completed) * 0.45),
      meanWaitS: Math.round(140 + 70 * surge(t) + 20 * noise(11, t)), missedConnections: Math.floor(t / 52),
      leftBehind: Math.floor(Math.max(0, t - 640) / 14), jSoFar: Math.round(spawned * (300 + t * 0.32)),
    };
  }

  observe(): Observation {
    const t = this.t;
    const tr = this.trainState();
    const buses = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id, i) => {
      const b = this.busState(id, i);
      return {
        id, routeId: b.routeId, state: b.state, onboard: b.onboard, capacity: 40, nextStopId: b.nextStopId, etaNextStopS: b.etaS,
        holdUntil: b.holdUntil, headwayAheadS: 200 + i * 23, headwayBehindS: 170 + i * 17, holdUsedS: 0,
      };
    });
    const stops = STOP_IDS.map((id) => {
      const q = queueAt({ kind: 'stop', id }, t);
      const lastDepartureT: Partial<Record<RouteId, number>> = {};
      for (const r of ROUTE_IDS) if (ROUTE_STOPS[r].includes(id)) lastDepartureT[r] = id === 'stop_apts_south' ? Math.min(t, 360) : Math.max(0, t - 60 - 40 * ROUTE_IDS.indexOf(r));
      return { id, queue: q.count, queueByRoute: q.byRoute, longestWaitS: q.longestWaitS, lastDepartureT };
    });
    const running = this.running();
    running.waitingNow = stops.reduce((a, s) => a + s.queue, 0) + STATIONS.reduce((a, s) => a + queueAt({ kind: 'platform', id: s }, t).count, 0);
    return {
      t, phase: t < 1800 ? 'running' : 'clearing',
      scenario: {
        id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900,
        advertised: [{ kind: 'stadium_closing', t: 600, label: 'Stadium closing' }],
      },
      buses,
      train: {
        state: tr.state, stationId: tr.stationId, etaS: tr.etaS, onboard: tr.onboard, capacity: 160, departAt: tr.departAt,
        alightingNext: 18 + Math.round(10 * noise(12, t)), transfersNext: { r1: 9 + Math.round(5 * surge(t)), r2: 8 + Math.round(9 * surge(t)) },
        platformQueue: Object.fromEntries(STATIONS.map((s) => [s, queueAt({ kind: 'platform', id: s }, t).count])) as Record<StationId, number>,
      },
      stops,
      routes: ROUTE_IDS.map((r, i) => ({
        id: r, buses: [`b${i * 2 + 1}`, `b${i * 2 + 2}`], targetHeadwayS: 210 + i * 15,
        queue: stops.reduce((a, s) => a + (s.queueByRoute[r] ?? 0), 0),
      })),
      running,
    };
  }

  snapshot(): SimSnapshot {
    const t = this.t;
    const vehicles: VehicleView[] = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'].map((id, i) => {
      const b = this.busState(id, i);
      const lastDecision: DecisionRecord = id === 'b4'
        ? { dpId: 40, t: 830, kind: 'bus_at_stop', vehicleId: id, features: {}, action: { type: 'hold', seconds: 45 }, ruleId: 'hold_for_train', source: 'policy', explanation: 'Holding 45 s for the train (34 s away, 14 transfers)' }
        : { dpId: 10 + i, t: Math.max(0, t - 40 - i * 13), kind: i % 2 ? 'bus_at_stop' : 'bus_at_terminal', vehicleId: id, features: {}, action: i % 2 ? { type: 'continue' } : { type: 'dispatch' }, ruleId: i % 2 ? 'default' : 'even_headway', source: i % 2 ? 'default' : 'policy', explanation: EXPLAIN[id] ?? 'Continuing' };
      return {
        id, kind: 'bus', routeId: b.routeId, path: { kind: 'route', routeId: b.routeId }, dist: b.dist, state: b.state, onboard: b.onboard,
        capacity: 40, nextStopId: b.nextStopId, holdUntil: b.holdUntil, lastDecision,
      };
    });
    const tr = this.trainState();
    vehicles.push({
      id: 't1', kind: 'train', routeId: null, path: { kind: 'rail' }, dist: tr.dist, state: tr.state, onboard: tr.onboard, capacity: 160,
      nextStopId: null, holdUntil: null,
      lastDecision: { dpId: 33, t: Math.max(0, t - 50), kind: 'train_at_station', vehicleId: 't1', features: {}, action: { type: 'setTrainDeparture', dwellS: 60 }, ruleId: 'wait_for_crowd', source: 'policy', explanation: 'Dwelling 60 s: 41 people still walking to the platform' },
    });
    const queues: QueueView[] = [];
    const people: PersonView[] = [];
    let pid = 1;
    const places: QueuePlace[] = [...STOP_IDS.map((id) => ({ kind: 'stop', id }) as QueuePlace), ...STATIONS.map((id) => ({ kind: 'platform', id }) as QueuePlace)];
    for (const at of places) {
      const q = queueAt(at, t);
      queues.push({ at, count: q.count, longestWaitS: q.longestWaitS, severity: severityOf(q.longestWaitS) });
      for (let k = 0; k < Math.min(q.count, 36); k++) people.push({ id: pid++, state: 'waiting', tint: k % 6, at, slot: k, since: t - k * 5 });
    }
    const r = this.running();
    return { t, phase: t < 1800 ? 'running' : t < 2700 ? 'clearing' : 'done', vehicles, people, queues, running: r, events: [] };
  }

  passenger(id: number): PassengerInfo | null {
    return {
      id, origin: 'zone_stadium_north_stand', dest: 'zone_apts_south_tower', legIndex: 2, status: 'waiting',
      waitedS: 392, patienceS: 640, reason: 'Waiting at Central Station for r2: bus b4 is holding for this train and leaves in under a minute',
      itinerary: {
        expectedCostS: 1380, transfers: 1,
        legs: [
          { kind: 'walk', from: { x: 0, z: 0 }, to: { x: 1, z: 1 }, durationS: 170 },
          { kind: 'train', board: 'stn_stadium', alight: 'stn_central' },
          { kind: 'bus', routes: ['r2'], board: 'stop_central_stn', alight: 'stop_apts_south' },
          { kind: 'walk', from: { x: 1, z: 1 }, to: { x: 2, z: 2 }, durationS: 140 },
        ],
      },
    };
  }

  result(): RunResult { throw new Error('FakeSim has no result'); }
  replay(): Replay {
    return { simVersion: 'fake', mapVersion: 'fake', scenarioId: 'stadium_exit', seed: 0, controller: { kind: 'policy', policyId: 'fake' } };
  }
}

export { STOP_STATION, STATIONS, STOP_IDS, ROUTE_STOPS };
