// Owner: T1b. Trip planning (spec §5.4).
//
// Candidates per (origin zone, destination zone) are enumerated once per planner (lazily, memoized):
//   walk · one bus leg (every stop pair within accessRadius served by a common route) · one train leg (platform pairs
//   within accessRadius) · one transfer: bus↔bus at a shared stop, bus→train / train→bus at a paired station stop.
// Choice minimises  w.walk·walkS + w.wait·Σ(headway/2) + w.ride·rideS + transferPenaltyS·transfers + noise
// using ADVERTISED headways only. Ride times: path distance / speed + a nominal dwell per intermediate stop
// (20 s for buses, as in the map's nominalLoopS calibration; train defaultDwellS per intermediate station).
// A bus leg lists the routes serving both stops that are worth boarding (classic common-lines rule with the
// passenger's own weights): its wait uses the combined headway 1/Σ(1/h) and its ride the frequency-weighted mean.
// Choice noise: the fixed per-passenger draw `choiceNoise` ∈ [−1, 1] scales a deterministic per-itinerary sign
// σ ∈ [−1, 1) (hash of passenger and itinerary key), adding 60·choiceNoise·σ s — a constant offset would never
// change a choice.
// Station transfers (spec §5.4 "a short walk between the platform and the stop") take at most
// STATION_TRANSFER_WALK_S, whatever the geometry: at walking pace the 3.85 u platform–stop hop on TOWN takes ~96 s,
// longer than any legal hold, so no bus could ever wait for a train connection.
import type { Itinerary, Leg, PassengerSpec, RouteId, SimConfig, StationId, Stop, StopId, TownMap, Vec2, Zone } from '../contracts';
import type { TripPlanner } from '../internal';
import { distance } from '../map/geometry';
import { cyrb128 } from '../rng';

type WalkLeg = Extract<Leg, { kind: 'walk' }>;

/** Nominal dwell per intermediate bus stop (spec §4: nominalLoopS = length / speed + 20 × stops). */
export const NOMINAL_STOP_DWELL_S = 20;
/** Scale of the choice-noise term (spec §5.4: 60·choiceNoise). */
export const CHOICE_NOISE_S = 60;
/** Longest walk between a station platform and its paired bus stop (a transfer connection). */
export const STATION_TRANSFER_WALK_S = 20;

export interface BusOption { route: RouteId; rideS: number; headwayS: number }
export type CandidateLeg =
  | { kind: 'walk'; from: Vec2; to: Vec2; dist: number; transfer?: true } // transfer: platform ↔ paired stop
  | { kind: 'bus'; board: StopId; alight: StopId; options: BusOption[] } // sorted by rideS, then route id
  | { kind: 'train'; board: StationId; alight: StationId; rideS: number; headwayS: number };
export interface Candidate { key: string; hash: number; legs: CandidateLeg[]; transfers: number }

interface Ctx {
  map: TownMap;
  cfg: SimConfig;
  zones: Map<string, Zone>;
  stops: Map<StopId, Stop>;
  busOptions: Map<string, BusOption[]>; // `${a}>${b}`
}

export function walkDurationS(dist: number, speed: number, cfg: SimConfig): number {
  return Math.max(1, Math.round((dist * cfg.walk.detourFactor) / speed));
}

/** A station transfer walk (platform ↔ paired stop): walking time, capped at STATION_TRANSFER_WALK_S. */
export function transferWalkS(dist: number, speed: number, cfg: SimConfig): number {
  return Math.min(STATION_TRANSFER_WALK_S, walkDurationS(dist, speed, cfg));
}

function legWalkS(l: Extract<CandidateLeg, { kind: 'walk' }>, speed: number, cfg: SimConfig): number {
  return l.transfer ? transferWalkS(l.dist, speed, cfg) : walkDurationS(l.dist, speed, cfg);
}

/** In-vehicle seconds on `routeId` from stop a to stop b (forward around the loop), or null if not served. */
export function busRideS(map: TownMap, cfg: SimConfig, routeId: RouteId, a: StopId, b: StopId): number | null {
  const r = map.routes.find((x) => x.id === routeId);
  if (!r) return null;
  const ia = r.stops.indexOf(a);
  const ib = r.stops.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  const n = r.stops.length;
  const L = r.path.length;
  const d = (((r.stopDist[ib]! - r.stopDist[ia]!) % L) + L) % L;
  const hops = (ib - ia + n) % n;
  return d / cfg.bus.speed + NOMINAL_STOP_DWELL_S * (hops - 1);
}

/** In-vehicle seconds on the train from station a to station b (travel order), or null. */
export function trainRideS(map: TownMap, cfg: SimConfig, a: StationId, b: StationId): number | null {
  const st = map.rail.stations;
  const ia = st.findIndex((s) => s.id === a);
  const ib = st.findIndex((s) => s.id === b);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  const n = st.length;
  const L = map.rail.loop.length;
  const d = (((st[ib]!.dist - st[ia]!.dist) % L) + L) % L;
  const hops = (ib - ia + n) % n;
  return d / cfg.train.speed + cfg.train.defaultDwellS * (hops - 1);
}

/** Common-lines rule: routes worth boarding (by ride time, each added while its weighted ride beats the set's expected
 *  weighted wait + ride), with the set's mean wait (combined headway / 2) and frequency-weighted ride. */
export function attractiveSet(options: BusOption[], w: PassengerSpec['weights']): { routes: RouteId[]; waitS: number; rideS: number } {
  const sorted = [...options].sort((a, b) => a.rideS - b.rideS || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  let freq = 0;
  let rideF = 0;
  const routes: RouteId[] = [];
  for (const o of sorted) {
    if (routes.length > 0 && !(w.ride * o.rideS < (w.wait * 0.5 + w.ride * rideF) / freq)) break;
    routes.push(o.route);
    freq += 1 / o.headwayS;
    rideF += o.rideS / o.headwayS;
  }
  return { routes: routes.sort(), waitS: 0.5 / freq, rideS: rideF / freq };
}

function buildCtx(map: TownMap, cfg: SimConfig): Ctx {
  const busOptions = new Map<string, BusOption[]>();
  for (const a of map.stops) {
    for (const b of map.stops) {
      if (a.id === b.id) continue;
      const opts: BusOption[] = [];
      for (const r of map.routes) {
        const rideS = busRideS(map, cfg, r.id, a.id, b.id);
        if (rideS !== null) opts.push({ route: r.id, rideS, headwayS: r.advertisedHeadwayS });
      }
      if (opts.length) {
        opts.sort((x, y) => x.rideS - y.rideS || (x.route < y.route ? -1 : 1));
        busOptions.set(`${a.id}>${b.id}`, opts);
      }
    }
  }
  return {
    map, cfg, busOptions,
    zones: new Map(map.zones.map((z) => [z.id, z] as const)),
    stops: new Map(map.stops.map((s) => [s.id, s] as const)),
  };
}

function zoneOf(ctx: Ctx, id: string): Zone {
  const z = ctx.zones.get(id);
  if (!z) throw new Error(`passengers: unknown zone ${id}`);
  return z;
}

function enumerate(ctx: Ctx, originId: string, destId: string): Candidate[] {
  const { map, cfg } = ctx;
  const o = zoneOf(ctx, originId).door;
  const d = zoneOf(ctx, destId).door;
  const R = cfg.walk.accessRadius;
  const oStops = map.stops.filter((s) => distance(o, s.p) <= R);
  const dStops = map.stops.filter((s) => distance(d, s.p) <= R);
  const oPlat = map.rail.stations.filter((s) => distance(o, s.platform) <= R);
  const dPlat = map.rail.stations.filter((s) => distance(d, s.platform) <= R);
  const out: Candidate[] = [];
  const walk = (from: Vec2, to: Vec2): CandidateLeg => ({ kind: 'walk', from, to, dist: distance(from, to) });
  const xfer = (from: Vec2, to: Vec2): CandidateLeg => ({ kind: 'walk', from, to, dist: distance(from, to), transfer: true });
  const bus = (a: StopId, b: StopId, options: BusOption[]): CandidateLeg => ({ kind: 'bus', board: a, alight: b, options });
  const train = (a: StationId, b: StationId): CandidateLeg | null => {
    const rideS = trainRideS(map, cfg, a, b);
    return rideS === null ? null : { kind: 'train', board: a, alight: b, rideS, headwayS: map.rail.advertisedHeadwayS };
  };
  const opts = (a: StopId, b: StopId) => ctx.busOptions.get(`${a}>${b}`) ?? [];
  const add = (key: string, legs: CandidateLeg[]) => {
    const transit = legs.filter((l) => l.kind !== 'walk').length;
    out.push({ key, hash: cyrb128(key)[0], legs, transfers: Math.max(0, transit - 1) });
  };

  add('walk', [walk(o, d)]);
  for (const a of oStops) {
    for (const b of dStops) {
      const ob = a.id === b.id ? [] : opts(a.id, b.id);
      if (ob.length) add(`bus:${a.id}>${b.id}`, [walk(o, a.p), bus(a.id, b.id, ob), walk(b.p, d)]);
    }
  }
  for (const A of oPlat) {
    for (const B of dPlat) {
      const t = A.id === B.id ? null : train(A.id, B.id);
      if (t) add(`train:${A.id}>${B.id}`, [walk(o, A.platform), t, walk(B.platform, d)]);
    }
  }
  // bus ↔ bus at a shared stop; a route serving both legs makes the transfer pointless (the direct leg covers it)
  for (const a of oStops) {
    for (const x of map.stops) {
      for (const b of dStops) {
        if (a.id === x.id || x.id === b.id || a.id === b.id) continue;
        const o1 = opts(a.id, x.id);
        const o2 = opts(x.id, b.id);
        if (!o1.length || !o2.length) continue;
        const f1 = o1.filter((p) => !o2.some((q) => q.route === p.route));
        const f2 = o2.filter((q) => !o1.some((p) => p.route === q.route));
        if (!f1.length || !f2.length) continue;
        add(`bb:${a.id}>${x.id}>${b.id}`, [walk(o, a.p), bus(a.id, x.id, f1), bus(x.id, b.id, f2), walk(b.p, d)]);
      }
    }
  }
  // bus → train: ride to the station's paired stop, walk to the platform
  for (const a of oStops) {
    for (const S of map.rail.stations) {
      const s = ctx.stops.get(S.stopId);
      if (!s || s.id === a.id) continue;
      const o1 = opts(a.id, s.id);
      if (!o1.length) continue;
      for (const B of dPlat) {
        const t = B.id === S.id ? null : train(S.id, B.id);
        if (t) add(`bt:${a.id}>${S.id}>${B.id}`, [walk(o, a.p), bus(a.id, s.id, o1), xfer(s.p, S.platform), t, walk(B.platform, d)]);
      }
    }
  }
  // train → bus: alight, walk from the platform to the paired stop, ride on
  for (const A of oPlat) {
    for (const S of map.rail.stations) {
      const s = ctx.stops.get(S.stopId);
      const t = !s || S.id === A.id ? null : train(A.id, S.id);
      if (!s || !t) continue;
      for (const b of dStops) {
        const o2 = b.id === s.id ? [] : opts(s.id, b.id);
        if (o2.length) add(`tb:${A.id}>${S.id}>${b.id}`, [walk(o, A.platform), t, xfer(S.platform, s.p), bus(s.id, b.id, o2), walk(b.p, d)]);
      }
    }
  }
  return out;
}

/** Every candidate itinerary for a zone pair (tests and tools; the planner memoizes the same list). */
export function candidatesFor(map: TownMap, cfg: SimConfig, originId: string, destId: string): Candidate[] {
  return enumerate(buildCtx(map, cfg), originId, destId);
}

function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function passengerHash(spec: PassengerSpec): number {
  return fmix32((Math.imul(spec.id + 1, 0x9e3779b1) ^ ((spec.choiceNoise * 0x40000000) | 0)) >>> 0);
}

function noiseS(spec: PassengerSpec, c: Candidate, pHash: number): number {
  if (!spec.choiceNoise) return 0;
  const u = fmix32((c.hash ^ pHash) >>> 0) / 4294967296;
  return CHOICE_NOISE_S * spec.choiceNoise * (2 * u - 1);
}

function evaluate(spec: PassengerSpec, c: Candidate, cfg: SimConfig): { cost: number; busRoutes: RouteId[][] } {
  let walkS = 0;
  let waitS = 0;
  let rideS = 0;
  const busRoutes: RouteId[][] = [];
  for (const l of c.legs) {
    if (l.kind === 'walk') walkS += legWalkS(l, spec.walkSpeed, cfg);
    else if (l.kind === 'train') {
      waitS += l.headwayS / 2;
      rideS += l.rideS;
    } else {
      const set = attractiveSet(l.options, spec.weights);
      waitS += set.waitS;
      rideS += set.rideS;
      busRoutes.push(set.routes);
    }
  }
  const w = spec.weights;
  return { cost: w.walk * walkS + w.wait * waitS + w.ride * rideS + spec.transferPenaltyS * c.transfers, busRoutes };
}

function materialize(spec: PassengerSpec, c: Candidate, cost: number, busRoutes: RouteId[][], cfg: SimConfig): Itinerary {
  let bi = 0;
  const legs: Leg[] = c.legs.map((l): Leg => {
    if (l.kind === 'walk') {
      return { kind: 'walk', from: { x: l.from.x, z: l.from.z }, to: { x: l.to.x, z: l.to.z }, durationS: legWalkS(l, spec.walkSpeed, cfg) };
    }
    if (l.kind === 'train') return { kind: 'train', board: l.board, alight: l.alight };
    return { kind: 'bus', routes: [...busRoutes[bi++]!], board: l.board, alight: l.alight };
  });
  return { legs, expectedCostS: Math.round(cost), transfers: c.transfers };
}

/** Generalized cost of the rest of a plan, assuming another advertised headway/2 of waiting for every transit leg. */
function remainingCostS(ctx: Ctx, spec: PassengerSpec, legs: Leg[]): number {
  const { map, cfg } = ctx;
  let walkS = 0;
  let waitS = 0;
  let rideS = 0;
  let transit = 0;
  for (const l of legs) {
    if (l.kind === 'walk') {
      walkS += l.durationS;
      continue;
    }
    transit++;
    if (l.kind === 'train') {
      const r = trainRideS(map, cfg, l.board, l.alight);
      if (r === null) return Infinity;
      waitS += map.rail.advertisedHeadwayS / 2;
      rideS += r;
      continue;
    }
    let freq = 0;
    let rideF = 0;
    for (const rid of l.routes) {
      const r = busRideS(map, cfg, rid, l.board, l.alight);
      const route = map.routes.find((x) => x.id === rid);
      if (r === null || !route) continue;
      freq += 1 / route.advertisedHeadwayS;
      rideF += r / route.advertisedHeadwayS;
    }
    if (!(freq > 0)) return Infinity;
    waitS += 0.5 / freq;
    rideS += rideF / freq;
  }
  const w = spec.weights;
  return w.walk * walkS + w.wait * waitS + w.ride * rideS + spec.transferPenaltyS * Math.max(0, transit - 1);
}

/** Candidate tables shared by every planner on the same map and ride-relevant config (candidates are immutable). */
const shared = new WeakMap<TownMap, Map<string, { ctx: Ctx; memo: Map<string, Candidate[]> }>>();

function sharedTables(map: TownMap, cfg: SimConfig): { ctx: Ctx; memo: Map<string, Candidate[]> } {
  let byCfg = shared.get(map);
  if (!byCfg) {
    byCfg = new Map();
    shared.set(map, byCfg);
  }
  const key = `${cfg.bus.speed}|${cfg.train.speed}|${cfg.train.defaultDwellS}|${cfg.walk.accessRadius}`;
  let t = byCfg.get(key);
  if (!t) {
    t = { ctx: buildCtx(map, cfg), memo: new Map() };
    byCfg.set(key, t);
  }
  return t;
}

export function createTripPlanner(map: TownMap, cfg: SimConfig): TripPlanner {
  const { ctx: tables, memo } = sharedTables(map, cfg);
  const ctx: Ctx = { ...tables, cfg };
  const candidates = (o: string, d: string): Candidate[] => {
    const key = `${o}>${d}`;
    let c = memo.get(key);
    if (!c) {
      c = enumerate(ctx, o, d);
      memo.set(key, c);
    }
    return c;
  };

  return {
    plan(spec: PassengerSpec): Itinerary {
      const cands = candidates(spec.origin, spec.dest);
      const pHash = passengerHash(spec);
      const walkOnly = cands[0]!;
      let best = { c: walkOnly, ...evaluate(spec, walkOnly, cfg) };
      let bestScore = best.cost + noiseS(spec, walkOnly, pHash);
      for (let i = 1; i < cands.length; i++) {
        const c = cands[i]!;
        if (c.transfers > spec.maxTransfers) continue;
        const e = evaluate(spec, c, cfg);
        const score = e.cost + noiseS(spec, c, pHash);
        if (score < bestScore) {
          bestScore = score;
          best = { c, ...e };
        }
      }
      return materialize(spec, best.c, best.cost, best.busRoutes, cfg);
    },

    reconsider(spec: PassengerSpec, from: Vec2, waitedS: number, remaining: Leg[]): WalkLeg | null {
      if (waitedS < spec.patienceS) return null;
      const door = zoneOf(ctx, spec.dest).door;
      const durationS = walkDurationS(distance(from, door), spec.walkSpeed, cfg);
      const walkNow = spec.weights.walk * durationS + spec.switchPenaltyS;
      if (!(walkNow < remainingCostS(ctx, spec, remaining))) return null;
      return { kind: 'walk', from: { x: from.x, z: from.z }, to: { x: door.x, z: door.z }, durationS };
    },
  };
}
