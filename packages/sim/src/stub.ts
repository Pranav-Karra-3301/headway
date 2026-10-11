// Owner: Task M. Contract-conformant fake sim for renderer/HUD development (not the real engine).
// Buses loop their routes at cfg.bus.speed with ~10 s dwells, the train loops with 45 s dwells, ~150 people spawn
// at zone doors (scenario-shaped), walk straight to the nearest stop or platform, queue in slots along queueDir,
// board when a vehicle of their mode dwells there, ride, alight near their destination and walk to it.
// Deterministic for a given (map, scenario): all randomness comes from `stream(seed, 'stub:*')`.
import { withConfig } from './config';
import type {
  DecisionRecord, Itinerary, Leg, Observation, PassengerInfo, PersonView, QueuePlace, QueueView, Replay, RouteId,
  RunningMetrics, RunResult, ScenarioInstance, Sim, SimEvent, SimSnapshot, StationId, StopId, StopStats, TimeProfile,
  TownMap, Vec2, VehicleState, VehicleView, Zone, ZoneSelector, Intent,
} from './contracts';
import { distance } from './map/geometry';
import { stream, type Rng } from './rng';
import { scenarioDef } from './scenarios';

type Mode = RouteId | 'train';
const STUB_PEOPLE = 150;
const BUS_DWELL_S = 10;
const TERMINAL_LAYOVER_S = 15;

interface Person {
  id: number; spawnT: number; origin: Zone; dest: Zone; tint: number; walkSpeed: number; patienceS: number;
  state: 'pending' | 'walking' | 'waiting' | 'riding' | 'arrived' | 'gone';
  from: Vec2; to: Vec2; t0: number; t1: number;
  /** Where the current walk ends: a queue to join, or the destination door. */
  walkEnd: 'queue' | 'arrive';
  place: QueuePlace; mode: Mode; since: number; waitedS: number; reconsidered: boolean;
  vehicle: string | null; alightKey: string | null; arriveT: number | null; leftBehindAt: Set<string>;
}
interface Vehicle {
  id: string; kind: 'bus' | 'train'; routeId: RouteId | null; mode: Mode;
  dist: number; length: number; speed: number; capacity: number;
  /** Arc positions of the places served, in loop order (first = terminal / start station). */
  stopDist: number[]; places: QueuePlace[]; next: number;
  state: VehicleState; dwellUntil: number; holdUntil: number | null; riders: number[];
  lastDecision: DecisionRecord | null; departures: number;
}

const keyOf = (p: QueuePlace) => `${p.kind}:${p.id}`;
const routeNum = (r: Mode) => (r === 'train' ? 'the train' : `Route ${r.slice(1)}`);

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function selectZones(map: TownMap, sel: ZoneSelector): Zone[] {
  if (sel.zones) return map.zones.filter((z) => sel.zones!.includes(z.id));
  return map.zones.filter((z) => (!sel.neighborhood || z.neighborhood === sel.neighborhood) && (!sel.tag || z.tags.includes(sel.tag)));
}

function drawSpawnT(rng: Rng, p: TimeProfile, durationS: number): number {
  let t: number;
  if (p.kind === 'uniform') t = rng.range(p.start, p.end);
  else if (p.kind === 'pulse') {
    const up = rng.next() < p.rampS / (p.rampS + p.decayS);
    const s = 1 - Math.sqrt(rng.next());
    t = up ? p.at - p.rampS * s : p.at + p.decayS * s;
  } else {
    const pts = p.points;
    const t0 = pts[0]?.[0] ?? 0, t1 = pts[pts.length - 1]?.[0] ?? durationS;
    const max = Math.max(...pts.map((q) => q[1]), 1e-9);
    const rate = (x: number) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, ra] = pts[i]!, [b, rb] = pts[i + 1]!;
        if (x >= a && x <= b) return b > a ? ra + ((rb - ra) * (x - a)) / (b - a) : ra;
      }
      return 0;
    };
    t = t0;
    for (let k = 0; k < 64; k++) { const x = rng.range(t0, t1); if (rng.next() * max <= rate(x)) { t = x; break; } }
  }
  return Math.min(durationS - 1, Math.max(1, Math.round(t)));
}

export function createStubSim(a: { map: TownMap; scenario: ScenarioInstance }): Sim {
  const { map, scenario } = a;
  const def = scenarioDef(scenario.scenarioId);
  const cfg = withConfig();
  const tEnd = def.durationS + def.clearingS;
  const placePoint = new Map<string, Vec2>();
  const placeDir = new Map<string, Vec2>();
  const placeName = new Map<string, string>();
  const placeModes = new Map<string, Mode[]>();
  for (const s of map.stops) {
    const k = keyOf({ kind: 'stop', id: s.id });
    placePoint.set(k, s.p); placeDir.set(k, s.queueDir); placeName.set(k, s.name); placeModes.set(k, s.servedRoutes);
  }
  for (const s of map.rail.stations) {
    const k = keyOf({ kind: 'platform', id: s.id });
    placePoint.set(k, s.platform); placeDir.set(k, s.queueDir); placeName.set(k, `${s.name} platform`); placeModes.set(k, ['train']);
  }
  const queues = new Map<string, number[]>([...placePoint.keys()].map((k) => [k, []]));
  const maxQueue = new Map<string, number>();
  const lastDeparture = new Map<string, Partial<Record<Mode, number>>>();
  const maxGap = new Map<string, Partial<Record<RouteId, number>>>();
  const boardWaits = new Map<string, number[]>();

  // ---------------- people (drawn up front)
  const demandRng = stream(scenario.seed, 'stub:demand');
  const totalDemand = def.demand.reduce((s, g) => s + g.total, 0) || 1;
  const drafts: Array<{ spawnT: number; origin: Zone; dest: Zone; order: number }> = [];
  for (const g of def.demand) {
    const n = Math.round((STUB_PEOPLE * g.total) / totalDemand);
    const from = selectZones(map, g.from);
    if (from.length === 0) continue;
    for (let i = 0; i < n; i++) {
      const origin = demandRng.weighted(from, from.map((z) => z.weight));
      const target = demandRng.weighted(g.to, g.to.map((t) => t.share));
      let dests = selectZones(map, target.sel).filter((z) => z.id !== origin.id);
      if (dests.length === 0) dests = map.zones.filter((z) => z.id !== origin.id);
      const dest = demandRng.weighted(dests, dests.map((z) => z.weight));
      drafts.push({ spawnT: drawSpawnT(demandRng, g.profile, def.durationS), origin, dest, order: drafts.length });
    }
  }
  drafts.sort((x, y) => x.spawnT - y.spawnT || x.order - y.order);
  const people: Person[] = drafts.map((d, id) => {
    const r = stream(scenario.seed, `stub:behavior:${id}`);
    const walkSpeed = Math.min(cfg.walk.maxSpeed, Math.max(cfg.walk.minSpeed, r.normal(cfg.walk.meanSpeed, cfg.walk.sdSpeed)));
    return {
      id, spawnT: d.spawnT, origin: d.origin, dest: d.dest, tint: r.int(0, 5), walkSpeed, patienceS: r.int(600, 1100),
      state: 'pending', from: d.origin.door, to: d.origin.door, t0: 0, t1: 0, walkEnd: 'queue',
      place: { kind: 'stop', id: 'stop_downtown' }, mode: 'r1', since: 0, waitedS: 0, reconsidered: false,
      vehicle: null, alightKey: null, arriveT: null, leftBehindAt: new Set(),
    };
  });
  const modeRng = stream(scenario.seed, 'stub:modes');

  // ---------------- vehicles
  const vehicles: Vehicle[] = [];
  let busNo = 0;
  for (const route of map.routes) {
    for (let k = 0; k < 2; k++) {
      busNo++;
      const L = route.path.length;
      const start = k === 0 ? 0 : L / 2;
      const next = k === 0 ? 0 : Math.max(0, route.stopDist.findIndex((d) => d > start));
      vehicles.push({
        id: `b${busNo}`, kind: 'bus', routeId: route.id, mode: route.id, dist: start, length: L, speed: cfg.bus.speed,
        capacity: cfg.bus.capacity, stopDist: route.stopDist, places: route.stops.map((id) => ({ kind: 'stop', id })),
        next, state: k === 0 ? 'layover' : 'moving', dwellUntil: k === 0 ? 1 : 0, holdUntil: null, riders: [],
        lastDecision: null, departures: 0,
      });
    }
  }
  const stations = map.rail.stations;
  vehicles.push({
    id: 't1', kind: 'train', routeId: null, mode: 'train', dist: stations[0]?.dist ?? 0, length: map.rail.loop.length,
    speed: cfg.train.speed, capacity: cfg.train.capacity, stopDist: stations.map((s) => s.dist),
    places: stations.map((s) => ({ kind: 'platform', id: s.id })), next: 0, state: 'dwelling',
    dwellUntil: cfg.train.defaultDwellS, holdUntil: null, riders: [], lastDecision: null, departures: 0,
  });
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // ---------------- run state
  let t = 0;
  let dpId = 0;
  const events: SimEvent[] = [];
  const intents: Array<{ t: number; intent: Intent }> = [];
  let spawnCursor = 0;
  let spawned = 0, completed = 0, leftBehind = 0, walkaways = 0, waitSum = 0, waitN = 0, busDistance = 0, trainDwell = 0;
  const emit = (e: SimEvent) => { if (events.length < 400) events.push(e); };

  const nearestPlace = (p: Vec2): QueuePlace => {
    let best: QueuePlace = { kind: 'stop', id: map.stops[0]!.id };
    let bd = Infinity;
    for (const s of map.stops) { const d = distance(p, s.p); if (d < bd) { bd = d; best = { kind: 'stop', id: s.id }; } }
    for (const s of map.rail.stations) { const d = distance(p, s.platform); if (d < bd) { bd = d; best = { kind: 'platform', id: s.id }; } }
    return best;
  };
  const queueHead = (k: string): Vec2 => {
    const p = placePoint.get(k)!, d = placeDir.get(k)!;
    return { x: p.x + d.x, z: p.z + d.z };
  };
  const walkFrom = (p: Person, from: Vec2, to: Vec2, end: Person['walkEnd']) => {
    p.state = 'walking';
    p.from = { x: from.x, z: from.z };
    p.to = { x: to.x, z: to.z };
    p.t0 = t;
    p.t1 = t + Math.max(1, Math.round((distance(from, to) * cfg.walk.detourFactor) / p.walkSpeed));
    p.walkEnd = end;
  };
  const removeFromQueue = (k: string, pid: number) => {
    const q = queues.get(k)!;
    const i = q.indexOf(pid);
    if (i >= 0) q.splice(i, 1);
  };
  const nextVehicleEta = (k: string, mode: Mode): number | null => {
    let best: number | null = null;
    for (const v of vehicles) {
      if (v.mode !== mode) continue;
      const i = v.places.findIndex((pl) => keyOf(pl) === k);
      if (i < 0) continue;
      let ahead = v.stopDist[i]! - v.dist;
      if (ahead < 0) ahead += v.length;
      const eta = Math.round(ahead / v.speed + (v.state === 'moving' ? 0 : Math.max(0, v.dwellUntil - t)));
      if (best === null || eta < best) best = eta;
    }
    return best;
  };

  // ---------------- tick pieces
  function spawn() {
    while (spawnCursor < people.length && people[spawnCursor]!.spawnT <= t) {
      const p = people[spawnCursor++]!;
      spawned++;
      p.place = nearestPlace(p.origin.door);
      const k = keyOf(p.place);
      const modes = placeModes.get(k)!;
      p.mode = modes.length === 1 ? modes[0]! : modeRng.pick(modes);
      walkFrom(p, p.origin.door, queueHead(k), 'queue');
    }
  }

  function walkers() {
    for (const p of people) {
      if (p.state === 'arrived' && p.arriveT !== null && t - p.arriveT >= 3) p.state = 'gone';
      if (p.state !== 'walking' || p.t1 > t) continue;
      if (p.walkEnd === 'arrive') {
        p.state = 'arrived';
        p.arriveT = t;
        completed++;
        emit({ t, kind: 'arrive', personId: p.id });
      } else {
        const k = keyOf(p.place);
        p.state = 'waiting';
        p.since = t;
        queues.get(k)!.push(p.id);
        maxQueue.set(k, Math.max(maxQueue.get(k) ?? 0, queues.get(k)!.length));
      }
    }
  }

  function alightAndBoard(v: Vehicle, place: QueuePlace) {
    const k = keyOf(place);
    const stay: number[] = [];
    for (const pid of v.riders) {
      const p = people[pid]!;
      if (p.alightKey === k) {
        emit({ t, kind: 'alight', personId: pid, vehicleId: v.id, at: place });
        p.vehicle = null;
        walkFrom(p, placePoint.get(k)!, p.dest.door, 'arrive');
      } else stay.push(pid);
    }
    v.riders = stay;
    const q = queues.get(k);
    if (!q) return;
    for (const pid of [...q]) {
      const p = people[pid]!;
      if (p.mode !== v.mode) continue;
      if (v.riders.length >= v.capacity) {
        if (!p.leftBehindAt.has(k)) { p.leftBehindAt.add(k); leftBehind++; emit({ t, kind: 'left_behind', personId: pid, at: place }); }
        continue;
      }
      removeFromQueue(k, pid);
      p.state = 'riding';
      p.vehicle = v.id;
      p.waitedS = t - p.since;
      waitSum += p.waitedS; waitN++;
      (boardWaits.get(k) ?? boardWaits.set(k, []).get(k)!).push(p.waitedS);
      // alight at the place on this loop closest to the destination door (never the boarding place)
      let bestKey: string | null = null;
      let bd = Infinity;
      for (const pl of v.places) {
        const pk = keyOf(pl);
        if (pk === k) continue;
        const d = distance(placePoint.get(pk)!, p.dest.door);
        if (d < bd) { bd = d; bestKey = pk; }
      }
      p.alightKey = bestKey;
      v.riders.push(pid);
      emit({ t, kind: 'board', personId: pid, vehicleId: v.id, at: place });
    }
  }

  function depart(v: Vehicle, place: QueuePlace) {
    const k = keyOf(place);
    const last = lastDeparture.get(k) ?? {};
    if (v.routeId) {
      const prevT = last[v.routeId];
      if (prevT !== undefined) {
        const gaps = maxGap.get(k) ?? {};
        gaps[v.routeId] = Math.max(gaps[v.routeId] ?? 0, t - prevT);
        maxGap.set(k, gaps);
      }
    }
    last[v.mode] = t;
    lastDeparture.set(k, last);
    v.departures++;
  }

  function decide(v: Vehicle, place: QueuePlace, terminal: boolean) {
    const placeLabel = placeName.get(keyOf(place)) ?? place.id;
    const q = queues.get(keyOf(place))?.length ?? 0;
    const record: DecisionRecord = {
      dpId: ++dpId, t, vehicleId: v.id,
      kind: v.kind === 'train' ? 'train_at_station' : terminal ? 'bus_at_terminal' : 'bus_at_stop',
      features: v.kind === 'train' ? { onboard: v.riders.length, platform_queue: q, dwell_s: 0 } : { onboard: v.riders.length, queue_here: q },
      action: v.kind === 'train' ? { type: 'setTrainDeparture', dwellS: cfg.train.defaultDwellS } : terminal ? { type: 'dispatch' } : { type: 'continue' },
      ruleId: 'default', source: 'default',
      explanation: v.kind === 'train'
        ? `Train waits ${cfg.train.defaultDwellS}s at ${placeLabel} (${q} on the platform)`
        : terminal ? `Dispatching from ${placeLabel} on schedule` : `Leaving ${placeLabel} with ${v.riders.length} aboard`,
    };
    v.lastDecision = record;
    if (terminal || v.kind === 'train') emit({ t, kind: 'decision', record });
  }

  function moveVehicles() {
    for (const v of vehicles) {
      const place = v.places[v.next]!;
      if (v.state !== 'moving') {
        alightAndBoard(v, place);
        if (v.kind === 'train' && v.state === 'dwelling') trainDwell++;
        const until = v.holdUntil !== null ? Math.max(v.holdUntil, v.dwellUntil) : v.dwellUntil;
        if (t < until) continue;
        if (v.holdUntil !== null) v.holdUntil = null;
        depart(v, place);
        v.state = 'moving';
        v.next = (v.next + 1) % v.places.length;
      }
      let remaining = v.stopDist[v.next]! - v.dist;
      if (remaining < -1e-9) remaining += v.length;
      if (remaining < 1e-9 && v.places.length === 1) remaining = v.length;
      const step = Math.min(v.speed, Math.max(0, remaining));
      if (v.kind === 'bus') busDistance += step;
      if (step < remaining - 1e-9) {
        v.dist += step;
        if (v.dist >= v.length) v.dist -= v.length;
        continue;
      }
      v.dist = v.stopDist[v.next]!;
      const terminal = v.next === 0;
      v.state = terminal && v.kind === 'bus' ? 'layover' : 'dwelling';
      v.dwellUntil = t + (v.kind === 'train' ? cfg.train.defaultDwellS : terminal ? TERMINAL_LAYOVER_S : BUS_DWELL_S);
      decide(v, v.places[v.next]!, terminal);
      alightAndBoard(v, v.places[v.next]!);
    }
  }

  function patience() {
    for (const p of people) {
      if (p.state !== 'waiting' || p.reconsidered || t - p.since <= p.patienceS) continue;
      p.reconsidered = true;
      if (distance(placePoint.get(keyOf(p.place))!, p.dest.door) > 18) continue; // too far to walk: keep waiting
      removeFromQueue(keyOf(p.place), p.id);
      walkaways++;
      emit({ t, kind: 'walkaway', personId: p.id, at: p.place });
      walkFrom(p, queueHead(keyOf(p.place)), p.dest.door, 'arrive');
    }
  }

  // ---------------- views
  function running(): RunningMetrics {
    let waitingNow = 0, ridingNow = 0, jSoFar = 0;
    for (const p of people) {
      if (p.state === 'pending') continue;
      if (p.state === 'waiting') waitingNow++;
      if (p.state === 'riding') ridingNow++;
      jSoFar += (p.arriveT ?? t) - p.spawnT;
    }
    return { spawned, completed, waitingNow, ridingNow, meanWaitS: waitN ? Math.round(waitSum / waitN) : 0, missedConnections: 0, leftBehind, jSoFar };
  }

  function queueViews(): QueueView[] {
    const out: QueueView[] = [];
    for (const [k, q] of queues) {
      const [kind, id] = k.split(':') as ['stop' | 'platform', string];
      const longest = q.length ? t - people[q[0]!]!.since : 0;
      const at = (kind === 'stop' ? { kind, id: id as StopId } : { kind, id: id as StationId }) as QueuePlace;
      out.push({ at, count: q.length, longestWaitS: longest, severity: longest < 180 ? 'ok' : longest < 420 ? 'warn' : 'bad' });
    }
    return out;
  }

  function personView(p: Person): PersonView | null {
    if (p.state === 'walking') return { id: p.id, state: 'walking', tint: p.tint, from: p.from, to: p.to, t0: p.t0, t1: p.t1 };
    if (p.state === 'waiting') {
      const slot = queues.get(keyOf(p.place))!.indexOf(p.id);
      return { id: p.id, state: 'waiting', tint: p.tint, at: p.place, slot, since: p.since };
    }
    if (p.state === 'arrived') return { id: p.id, state: 'arrived', tint: p.tint, to: p.dest.door, t0: p.arriveT ?? t, t1: (p.arriveT ?? t) + 3 };
    return null;
  }

  function vehicleView(v: Vehicle): VehicleView {
    const nextPlace = v.places[v.state === 'moving' ? v.next : (v.next + 1) % v.places.length]!;
    const nextStopId: StopId | null = nextPlace.kind === 'stop'
      ? nextPlace.id
      : map.rail.stations.find((s) => s.id === nextPlace.id)?.stopId ?? null;
    return {
      id: v.id, kind: v.kind, routeId: v.routeId, path: v.routeId ? { kind: 'route', routeId: v.routeId } : { kind: 'rail' },
      dist: v.dist, state: v.state, onboard: v.riders.length, capacity: v.capacity, nextStopId,
      holdUntil: v.holdUntil, lastDecision: v.lastDecision,
    };
  }

  function busAhead(v: Vehicle): Vehicle | null {
    let best: Vehicle | null = null, bd = Infinity;
    for (const o of vehicles) {
      if (o === v || o.routeId !== v.routeId) continue;
      let d = o.dist - v.dist;
      if (d <= 0) d += v.length;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  const sim: Sim = {
    get t() { return t; },
    get done() { return t >= tEnd; },
    step() {
      if (t >= tEnd) return { pending: null };
      t++;
      spawn();
      walkers();
      moveVehicles();
      patience();
      return { pending: null };
    },
    resolve() { /* the stub never raises async decisions */ },
    intent(i: Intent) {
      intents.push({ t, intent: i });
      if (i.type === 'hold') {
        const v = byId.get(i.vehicleId);
        if (v && v.state !== 'moving') { v.holdUntil = t + Math.max(0, Math.min(cfg.limits.maxHoldS, i.seconds)); v.state = 'holding'; }
      } else if (i.type === 'dispatch') {
        const v = byId.get(i.vehicleId);
        if (v && (v.state === 'layover' || v.state === 'holding')) { v.dwellUntil = t; v.holdUntil = null; }
      } else if (i.type === 'setTrainDeparture') {
        const v = byId.get('t1');
        if (v && v.state === 'dwelling') v.dwellUntil = t + Math.max(0, Math.min(cfg.train.maxDwellS, i.dwellS));
      }
    },
    observe(): Observation {
      const busViews = vehicles.filter((v) => v.kind === 'bus').map((v) => {
        const nextPlace = v.places[v.state === 'moving' ? v.next : (v.next + 1) % v.places.length]!;
        const ahead = busAhead(v);
        let gap: number | null = null;
        if (ahead) { let d = ahead.dist - v.dist; if (d <= 0) d += v.length; gap = Math.round(d / v.speed); }
        let toNext = (v.state === 'moving' ? v.stopDist[v.next]! : v.stopDist[(v.next + 1) % v.places.length]!) - v.dist;
        if (toNext <= 0) toNext += v.length;
        return {
          id: v.id, routeId: v.routeId!, state: v.state, onboard: v.riders.length, capacity: v.capacity,
          nextStopId: nextPlace.id as StopId, etaNextStopS: Math.round(toNext / v.speed + (v.state === 'moving' ? 0 : Math.max(0, v.dwellUntil - t))),
          holdUntil: v.holdUntil, headwayAheadS: gap, headwayBehindS: gap, holdUsedS: 0,
        };
      });
      const train = byId.get('t1')!;
      const atStation = train.state !== 'moving';
      const st = stations[train.next]!;
      let toSt = train.stopDist[train.next]! - train.dist;
      if (toSt < 0) toSt += train.length;
      const platformQueue = Object.fromEntries(stations.map((s) => [s.id, queues.get(keyOf({ kind: 'platform', id: s.id }))!.length])) as Record<StationId, number>;
      const stops = map.stops.map((s) => {
        const k = keyOf({ kind: 'stop', id: s.id });
        const q = queues.get(k)!;
        const byRoute: Partial<Record<RouteId, number>> = {};
        for (const pid of q) { const m = people[pid]!.mode; if (m !== 'train') byRoute[m] = (byRoute[m] ?? 0) + 1; }
        const last = lastDeparture.get(k) ?? {};
        const lastDepartureT: Partial<Record<RouteId, number>> = {};
        for (const r of s.servedRoutes) if (last[r] !== undefined) lastDepartureT[r] = last[r]!;
        return { id: s.id, queue: q.length, queueByRoute: byRoute, longestWaitS: q.length ? t - people[q[0]!]!.since : 0, lastDepartureT };
      });
      return {
        t, phase: t < def.durationS ? 'running' : 'clearing',
        scenario: { id: def.id, kind: def.kind, name: def.name, clockStart: def.clockStart, durationS: def.durationS, clearingS: def.clearingS, advertised: def.advertised },
        buses: busViews,
        train: {
          state: train.state, stationId: st.id, etaS: atStation ? 0 : Math.round(toSt / train.speed), onboard: train.riders.length,
          capacity: train.capacity, departAt: atStation ? train.dwellUntil : null,
          alightingNext: train.riders.filter((pid) => people[pid]!.alightKey === keyOf({ kind: 'platform', id: st.id })).length,
          transfersNext: {}, platformQueue,
        },
        stops,
        routes: map.routes.map((r) => {
          const buses = vehicles.filter((v) => v.routeId === r.id).map((v) => v.id);
          const queue = stops.reduce((s, x) => s + (x.queueByRoute[r.id] ?? 0), 0);
          return { id: r.id, buses, targetHeadwayS: Math.round(r.nominalLoopS / Math.max(1, buses.length)), queue };
        }),
        running: running(),
      };
    },
    snapshot(): SimSnapshot {
      const out: SimSnapshot = {
        t, phase: t >= tEnd ? 'done' : t < def.durationS ? 'running' : 'clearing',
        vehicles: vehicles.map(vehicleView),
        people: people.map(personView).filter((p): p is PersonView => p !== null),
        queues: queueViews(),
        running: running(),
        events: events.splice(0, events.length),
      };
      return out;
    },
    passenger(id: number): PassengerInfo | null {
      const p = people[id];
      if (!p || p.state === 'pending') return null;
      const k = keyOf(p.place);
      const placeP = placePoint.get(k)!;
      const ride: Leg = p.mode === 'train'
        ? { kind: 'train', board: p.place.id as StationId, alight: (p.alightKey?.split(':')[1] ?? p.place.id) as StationId }
        : { kind: 'bus', routes: [p.mode], board: p.place.id as StopId, alight: (p.alightKey?.split(':')[1] ?? p.place.id) as StopId };
      const walkIn: Leg = { kind: 'walk', from: p.origin.door, to: placeP, durationS: Math.round((distance(p.origin.door, placeP) * cfg.walk.detourFactor) / p.walkSpeed) };
      const walkOut: Leg = { kind: 'walk', from: placeP, to: p.dest.door, durationS: Math.round((distance(placeP, p.dest.door) * cfg.walk.detourFactor) / p.walkSpeed) };
      const itinerary: Itinerary = { legs: [walkIn, ride, walkOut], expectedCostS: walkIn.durationS + walkOut.durationS + 300, transfers: 0 };
      const legIndex = p.state === 'walking' ? (p.walkEnd === 'queue' ? 0 : 2) : p.state === 'riding' ? 1 : p.state === 'waiting' ? 1 : 2;
      const waitedS = p.state === 'waiting' ? t - p.since : p.waitedS;
      const eta = p.state === 'waiting' ? nextVehicleEta(k, p.mode) : null;
      const where = placeName.get(k) ?? p.place.id;
      const status = p.state === 'walking' ? (p.walkEnd === 'queue' ? `Walking to ${where}` : `Walking to ${p.dest.name}`)
        : p.state === 'waiting' ? `Waiting at ${where}` : p.state === 'riding' ? `Riding ${p.vehicle}` : 'Arrived';
      const reason = p.state === 'waiting'
        ? `Waiting for ${routeNum(p.mode)}${eta === null ? '' : ` — next ${p.mode === 'train' ? 'train' : 'bus'} in ~${Math.max(1, Math.round(eta / 60))} min`}`
        : p.state === 'walking' ? (p.walkEnd === 'queue' ? `Heading to ${where} for ${routeNum(p.mode)}` : `Walking home to ${p.dest.name}`)
        : p.state === 'riding' ? `On ${p.vehicle} toward ${p.dest.name}` : `Reached ${p.dest.name}`;
      return { id: p.id, origin: p.origin.id, dest: p.dest.id, itinerary, legIndex, status, waitedS, patienceS: p.patienceS, reason };
    },
    result(): RunResult {
      const done = people.filter((p) => p.arriveT !== null);
      const unfinished = people.filter((p) => p.arriveT === null);
      const J = done.reduce((s, p) => s + (p.arriveT! - p.spawnT), 0)
        + unfinished.reduce((s, p) => s + (tEnd - p.spawnT) + cfg.objective.unfinishedPenaltyS, 0);
      const waits = people.filter((p) => p.state === 'riding' || p.arriveT !== null).map((p) => p.waitedS).sort((x, y) => x - y);
      const p95 = waits.length ? waits[Math.min(waits.length - 1, Math.floor(0.95 * waits.length))]! : 0;
      const metrics = {
        J, spawned: people.length, completed: done.length, unfinished: unfinished.length,
        completionPct: people.length ? Math.round((1000 * done.length) / people.length) / 10 : 0,
        meanJourneyS: done.length ? Math.round(done.reduce((s, p) => s + (p.arriveT! - p.spawnT), 0) / done.length) : 0,
        meanWaitS: waitN ? Math.round(waitSum / waitN) : 0, p95WaitS: p95, maxWaitS: waits[waits.length - 1] ?? 0,
        transfersMade: 0, missedConnections: 0, leftBehind, walkaways,
        effort: { busDistanceU: Math.round(busDistance), deadheadDistanceU: 0, holdS: 0, trainDwellS: trainDwell },
      };
      const stops: StopStats[] = map.stops.map((s) => {
        const k = keyOf({ kind: 'stop', id: s.id });
        const w = boardWaits.get(k) ?? [];
        return { id: s.id, maxQueue: maxQueue.get(k) ?? 0, meanWaitS: w.length ? Math.round(w.reduce((x, y) => x + y, 0) / w.length) : 0, maxGapS: maxGap.get(k) ?? {} };
      });
      return {
        simVersion: cfg.simVersion, mapVersion: map.version, scenarioId: def.id, seed: scenario.seed,
        controller: { kind: 'policy', policyId: 'stub' }, metrics, stops, findings: [], ruleFires: { default: dpId },
        hash: fnv1a(JSON.stringify({ metrics, stops })),
      };
    },
    replay(): Replay {
      return {
        simVersion: cfg.simVersion, mapVersion: map.version, scenarioId: def.id, seed: scenario.seed,
        controller: { kind: 'policy', policyId: 'stub' }, intents: intents.map((x) => ({ ...x })),
      };
    },
  };
  return sim;
}
