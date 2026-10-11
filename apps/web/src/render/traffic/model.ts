// Owner: T2.3. Ambient traffic state machine (pure, no THREE). Visual only: it reads bus/train poses, never the sim.
// Each car drives a lane, takes a connector through a node, and plans its next connector with a seeded PRNG
// (no U-turns). Hard invariants per step:
//  - a car's centre never gets closer than max(MIN_SPACING, half lengths + gap) to the car or bus ahead on its path;
//  - a car only enters a junction with a reservation that conflicts with no other car in it, no bus in the box,
//    and room to clear the box on the far side ("don't block the box");
//  - cars stop before a level crossing while the train is near it.
// Cars enter at board-edge exits and leave there; after the advertised stadium closing time extra cars pull out
// near the stadium and head for the exits. A car stuck for STUCK_S shrinks away (liveness).
import { pointAt, projectOnPolyline } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { Connector, Crossing, Lane, LaneGraph } from './lanes';
import { mulberry32, weightedIndex } from './rng';

export const MIN_SPACING = 2.5;
export const MIN_CARS = 14;
export const MAX_CARS = 24;
export const DEFAULT_CARS = 16;
/** Extra cars after the stadium closes, and how long the exodus lasts (sim s). */
export const SURGE_CARS = 8;
export const SURGE_S = 1200;

const CRUISE = 0.42; // u/s sim (buses run 0.30)
const TURN_SPEED = { straight: 0.42, right: 0.26, left: 0.3 } as const;
const ACCEL = 0.3;
const BRAKE = 0.7;
const MAX_DT = 2;
const GAP_CAR = 0.4; // bumper gap (beyond half lengths) car ↔ car, when larger than MIN_SPACING
const GAP_BUS = 0.5; // bumper gap behind a bus
const CROSS_STOP = 1.2; // front bumper stops this far before the rail centre line
const TRAIN_BEHIND = 12, TRAIN_AHEAD = 9; // rail arc window around the train's dist that closes a crossing
const JUNCTION_BUS_R = 3.0;
const STUCK_S = 90;
/** Out-lane centre position at which a car's rear has cleared the junction box (lanes start 0.5 u past it). */
const CLEAR_BOX = -0.4;
/** A car first in line that has waited this long for a full exit lane picks another way if one has room. */
const REPLAN_S = 12;
const GROW_S = 3;
const SHRINK_DIST = 1.4;
const DIE_S = 2.5;
const SPAWN_GAP_S = 2;
const SURGE_SPAWN_GAP_S = 5;
const STADIUM_R = 15;
const CLEAR_CAR = 3.2;

export interface CarVariantSpec { length: number; weight: number }
/** Kit cars (render/kit/cars.ts CAR_SIZE): hatchback, van, pickup. */
export const KIT_VARIANTS: CarVariantSpec[] = [
  { length: 1.72, weight: 0.5 },
  { length: 2.12, weight: 0.22 },
  { length: 1.97, weight: 0.28 },
];

export interface TrafficModelOptions {
  seed: number;
  /** Base number of cars (clamped to 14–24), default 16. */
  carCount?: number;
  /** Advertised stadium closing time (sim s): more cars near the stadium after it. */
  closingT?: number | null;
  variants?: CarVariantSpec[];
  /** Number of body colours to pick from (palette role `car`), default 6. */
  colors?: number;
}

/** A bus as the renderer shows it: world centre, unit travel direction, half length, stopped at a stop/terminal. */
export interface BusPose { id: string; x: number; z: number; dx: number; dz: number; halfLen: number; stopped: boolean }
export interface TrafficEnv {
  /** Interpolated sim seconds. */
  simT: number;
  buses?: BusPose[];
  /** Train front arc distance along the rail loop, or null when there is no train. */
  trainDist?: number | null;
}

export interface TrafficCar {
  readonly id: number;
  variant: number;
  color: number;
  halfLen: number;
  vMax: number;
  /** Current lane, or the lane a connector leaves from while `conn` is set. */
  lane: Lane;
  conn: Connector | null;
  /** Distance along the current piece (lane or connector). */
  s: number;
  /** Planned connector at the end of the lane the car is on (or heading to, while on a connector). */
  next: Connector | null;
  prev: Lane | Connector | null;
  reserved: Connector | null;
  v: number;
  x: number;
  z: number;
  /** Viewer heading: rotation.y for a model whose forward axis is +x (same convention as pointAt). */
  heading: number;
  /** 0..1 spawn/leave scale. */
  scale: number;
  surge: boolean;
  age: number;
  stuck: number;
  /** Seconds left while shrinking away (0 = alive). */
  dying: number;
  /** Sim time it started waiting first in line at a junction (FIFO priority), or null. */
  waitSince: number | null;
}

export interface BusOnLane { id: string; s: number; halfLen: number; stopped: boolean }
export interface BusMap { lanes: Map<string, BusOnLane[]>; blockedNodes: Set<string> }

export interface TrafficModel {
  readonly graph: LaneGraph;
  readonly cars: readonly TrafficCar[];
  closingT: number | null;
  /** Target number of cars at a sim time (base + stadium surge). */
  target(simT: number): number;
  step(dtS: number, env: TrafficEnv): void;
  /** Swap the car models (e.g. kit → Kenney once loaded): existing cars keep their place and take the new lengths. */
  setVariants(specs: CarVariantSpec[]): void;
}

/** Project bus poses onto lanes (by heading) and mark junctions with a bus in the box. */
export function mapBuses(graph: LaneGraph, buses: readonly BusPose[]): BusMap {
  const lanes = new Map<string, BusOnLane[]>();
  const blockedNodes = new Set<string>();
  for (const b of buses) {
    const p = { x: b.x, z: b.z };
    for (const n of graph.nodes.values()) {
      if (n.junction && Math.hypot(n.p.x - b.x, n.p.z - b.z) < JUNCTION_BUS_R) blockedNodes.add(n.id);
    }
    let best: { lane: Lane; s: number; d: number } | null = null;
    for (const lane of graph.lanes) {
      if (!lane.forward) continue;
      const c = projectOnPolyline(lane.centre, p);
      if (c.d > 1.3) continue;
      const h = pointAt(lane.centre, c.dist);
      const dot = b.dx * Math.cos(h.heading) - b.dz * Math.sin(h.heading);
      if (Math.abs(dot) < 0.5) continue;
      const l = dot > 0 ? lane : graph.laneById.get(`${lane.edgeId}:r`);
      if (!l) continue;
      const s = laneS(l, p);
      if (!best || c.d < best.d) best = { lane: l, s, d: c.d };
    }
    if (best) {
      const list = lanes.get(best.lane.id) ?? lanes.set(best.lane.id, []).get(best.lane.id)!;
      list.push({ id: b.id, s: best.s, halfLen: b.halfLen, stopped: b.stopped });
    }
  }
  return { lanes, blockedNodes };
}

/** Arc position of p along a lane, extrapolated past the lane ends (into junction boxes). */
function laneS(l: Lane, p: Vec2): number {
  const q = projectOnPolyline(l.poly, p);
  const pts = l.poly.points;
  if (q.dist <= 1e-6) {
    const a = pts[0]!, b = pts[1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return Math.min(0, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len);
  }
  if (q.dist >= l.len - 1e-6) {
    const a = pts[pts.length - 2]!, b = pts[pts.length - 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return l.len + Math.max(0, ((p.x - b.x) * (b.x - a.x) + (p.z - b.z) * (b.z - a.z)) / len);
  }
  return q.dist;
}

export function createTrafficModel(graph: LaneGraph, opts: TrafficModelOptions): TrafficModel {
  const rand = mulberry32((opts.seed ^ 0x7ea1f1c) >>> 0);
  let variants = opts.variants?.length ? opts.variants : KIT_VARIANTS;
  const colors = Math.max(1, opts.colors ?? 6);
  const base = Math.min(MAX_CARS, Math.max(MIN_CARS, Math.round(opts.carCount ?? DEFAULT_CARS)));
  const cars: TrafficCar[] = [];
  const active = new Map<string, Set<TrafficCar>>(); // junction reservations by node
  const crossingsByLane = new Map<string, Crossing[]>();
  for (const x of graph.crossings) (crossingsByLane.get(x.lane.id) ?? crossingsByLane.set(x.lane.id, []).get(x.lane.id)!).push(x);
  const stadium = graph.map.neighborhoods.find((n) => n.id === 'stadium')?.center ?? null;
  const stadiumLanes = stadium
    ? graph.lanes.filter((l) => {
      const m = pointAt(l.poly, l.len / 2);
      return !l.exit && !l.entry && l.len > 4 && Math.hypot(m.x - stadium.x, m.z - stadium.z) < STADIUM_R;
    })
    : [];
  const railLen = graph.map.rail.loop.length;
  let nextId = 1;
  let filled = false;
  let spawnCooldown = 0;
  let surgeCooldown = 0;
  let lastT = 0;
  let buses: BusMap = { lanes: new Map(), blockedNodes: new Set() };
  let busPoses: readonly BusPose[] = [];
  let trainDist: number | null = null;

  const model: TrafficModel = {
    graph,
    cars,
    closingT: opts.closingT ?? null,
    target,
    step,
    setVariants(specs) {
      if (!specs.length) return;
      variants = specs;
      for (const c of cars) {
        c.variant %= variants.length;
        c.halfLen = variants[c.variant]!.length / 2;
      }
    },
  };

  function inSurge(t: number): boolean {
    return model.closingT !== null && t >= model.closingT && t < model.closingT + SURGE_S;
  }
  function target(t: number): number {
    return Math.min(MAX_CARS, base + (inSurge(t) && stadiumLanes.length ? SURGE_CARS : 0));
  }

  const pieceLen = (c: TrafficCar) => (c.conn ? c.conn.len : c.lane.len);
  const spacing = (a: TrafficCar, b: { halfLen: number }) => Math.max(MIN_SPACING, a.halfLen + b.halfLen + GAP_CAR);

  function crossingClosed(x: Crossing): boolean {
    if (trainDist === null) return false;
    let d = (x.railDist - trainDist) % railLen;
    if (d > railLen / 2) d -= railLen;
    if (d < -railLen / 2) d += railLen;
    return d >= -TRAIN_BEHIND && d <= TRAIN_AHEAD;
  }

  function stoppedBusOn(l: Lane): boolean {
    return (buses.lanes.get(l.id) ?? []).some((b) => b.stopped);
  }

  function awayFromStadium(l: Lane): boolean {
    if (!stadium) return false;
    const a = l.poly.points[0]!, b = l.poly.points[l.poly.points.length - 1]!;
    return Math.hypot(b.x - stadium.x, b.z - stadium.z) > Math.hypot(a.x - stadium.x, a.z - stadium.z);
  }

  function plan(c: TrafficCar, lane: Lane): Connector | null {
    if (lane.exit) return null;
    const options = graph.out.get(lane.id) ?? [];
    if (!options.length) return null;
    const over = cars.length > target(lastT);
    const w = options.map((o) => {
      let x = o.turn === 'straight' ? 1.2 : o.turn === 'right' ? 1 : 0.8;
      if (o.to.exit) x *= c.surge ? 4 : over ? 3 : 0.3;
      if (stoppedBusOn(o.to)) x *= 0.05;
      if (laneHead(o.to, c) < 2) x *= 0.25; // congestion-aware: avoid full exit lanes
      if (c.surge) x *= awayFromStadium(o.to) ? 1.6 : 0.6;
      return x;
    });
    return options[weightedIndex(rand, w)]!;
  }

  function onPiece(piece: Lane | Connector, isConn: boolean): TrafficCar[] {
    return cars.filter((o) => (isConn ? o.conn === piece : !o.conn && o.lane === piece));
  }

  /** First obstacle (cars, buses) at the start of a lane: smallest centre s and its half length. */
  function laneHead(l: Lane, me: TrafficCar): number {
    let room = Infinity;
    for (const o of cars) {
      if (o === me) continue;
      if (!o.conn && o.lane === l) room = Math.min(room, o.s - spacing(me, o));
      else if (o.conn && o.conn.to === l) room = Math.min(room, o.s - o.conn.len - spacing(me, o));
    }
    for (const b of buses.lanes.get(l.id) ?? []) room = Math.min(room, b.s - (b.halfLen + me.halfLen + GAP_BUS));
    return room;
  }

  const roomFor = (c: TrafficCar, conn: Connector) => laneHead(conn.to, c) >= c.halfLen + CLEAR_BOX + 0.05;

  /** Junction entry: no conflicting movement inside, no bus in the box, room to clear it, and no conflicting car
   *  that has waited longer and could go (FIFO, so nobody starves). Following the same movement is fine. */
  function canReserve(c: TrafficCar, conn: Connector): boolean {
    if (buses.blockedNodes.has(conn.node)) return false;
    for (const o of active.get(conn.node) ?? []) {
      const oc = o.reserved;
      if (o !== c && oc && oc !== conn && oc.conflicts.has(conn.id)) return false;
    }
    if (!roomFor(c, conn)) return false;
    const mine = c.waitSince ?? lastT;
    for (const w of cars) {
      const wn = w.next;
      if (w === c || w.waitSince === null || !wn || w.reserved === wn || wn.node !== conn.node) continue;
      if (wn !== conn && !wn.conflicts.has(conn.id)) continue;
      if (w.waitSince > mine || (w.waitSince === mine && w.id > c.id)) continue;
      if (roomFor(w, wn)) return false;
    }
    return true;
  }

  function reserve(c: TrafficCar, conn: Connector): void {
    if (c.reserved) release(c);
    c.waitSince = null;
    c.reserved = conn;
    (active.get(conn.node) ?? active.set(conn.node, new Set()).get(conn.node)!).add(c);
  }
  function release(c: TrafficCar): void {
    if (!c.reserved) return;
    active.get(c.reserved.node)?.delete(c);
    c.reserved = null;
  }

  /** How far the car's centre may advance this step. */
  function freeAhead(c: TrafficCar): number {
    let free = Infinity;
    const consider = (g: number, sp: number) => { if (g > 1e-9) free = Math.min(free, g - sp); };
    const lanePiece = (l: Lane, off: number, current: boolean) => {
      for (const o of onPiece(l, false)) if (o !== c && (!current || o.s > c.s)) consider(off + o.s, spacing(c, o));
      for (const b of buses.lanes.get(l.id) ?? []) if (!current || b.s > c.s) consider(off + b.s, b.halfLen + c.halfLen + GAP_BUS);
      for (const x of crossingsByLane.get(l.id) ?? []) {
        if (!crossingClosed(x)) continue;
        const g = off + x.s - CROSS_STOP - c.halfLen;
        if (g >= -0.01) free = Math.min(free, Math.max(0, g));
      }
    };
    const connPiece = (k: Connector, off: number, current: boolean) => {
      for (const o of onPiece(k, true)) if (o !== c && (!current || o.s > c.s)) consider(off + o.s, spacing(c, o));
    };
    if (!c.conn) {
      const l = c.lane;
      lanePiece(l, -c.s, true);
      const rest = l.len - c.s;
      for (const k of graph.out.get(l.id) ?? []) connPiece(k, rest, false);
      if (c.next) {
        lanePiece(c.next.to, rest + c.next.len, false);
        if (graph.nodes.get(l.to)!.junction && c.reserved !== c.next) {
          const stop = rest - c.halfLen - 0.05;
          const first = !cars.some((o) => o !== c && !o.conn && o.lane === l && o.s > c.s);
          if (first && c.waitSince !== null && lastT - c.waitSince > REPLAN_S && !roomFor(c, c.next)) {
            const alt = (graph.out.get(l.id) ?? []).filter((o) => o !== c.next && roomFor(c, o));
            if (alt.length) c.next = alt[Math.floor(rand() * alt.length)]!;
          }
          if (first && stop <= 1.5 && canReserve(c, c.next)) reserve(c, c.next);
          else {
            free = Math.min(free, Math.max(0, stop));
            if (first && stop <= 0.3 && c.waitSince === null) c.waitSince = lastT;
          }
        }
      } else if (!l.exit) free = Math.min(free, Math.max(0, rest - c.halfLen));
    } else {
      const k = c.conn;
      connPiece(k, -c.s, true);
      const rest = k.len - c.s;
      lanePiece(k.to, rest, false);
      if (c.next) connPiece(c.next, rest + k.to.len, false);
    }
    return free;
  }

  function pointOn(piece: Lane | Connector, s: number): Vec2 {
    const p = pointAt(piece.poly, s);
    return { x: p.x, z: p.z };
  }

  /** Path point `d` ahead (d > 0) or behind (d < 0) of the car's centre, crossing into neighbouring pieces. */
  function pathPoint(c: TrafficCar, d: number): Vec2 {
    const piece: Lane | Connector = c.conn ?? c.lane;
    const len = pieceLen(c);
    const s = c.s + d;
    if (s >= 0 && s <= len) return pointOn(piece, s);
    if (s > len) {
      const nxt: Lane | Connector | null = c.conn ? c.conn.to : c.next;
      if (nxt && nxt.len > 1e-3) return pointOn(nxt, Math.min(nxt.len, s - len));
      const e = pointAt(piece.poly, len), dir = { x: Math.cos(e.heading), z: -Math.sin(e.heading) };
      return { x: e.x + dir.x * (s - len), z: e.z + dir.z * (s - len) };
    }
    const prv = c.prev;
    if (prv && prv.len > 1e-3) return pointOn(prv, Math.max(0, prv.len + s));
    const e = pointAt(piece.poly, 0), dir = { x: Math.cos(e.heading), z: -Math.sin(e.heading) };
    return { x: e.x + dir.x * s, z: e.z + dir.z * s };
  }

  function pose(c: TrafficCar): void {
    const p = pointOn(c.conn ?? c.lane, c.s);
    c.x = p.x;
    c.z = p.z;
    const a = Math.max(0.3, c.halfLen * 0.6);
    const f = pathPoint(c, a), r = pathPoint(c, -a);
    if (Math.hypot(f.x - r.x, f.z - r.z) > 1e-4) c.heading = Math.atan2(-(f.z - r.z), f.x - r.x);
    let scale = c.dying > 0 ? c.dying / DIE_S : Math.min(1, c.age / GROW_S);
    if (!c.conn && c.lane.exit) scale = Math.min(scale, Math.max(0, (c.lane.len - c.s) / SHRINK_DIST));
    c.scale = Math.max(0, Math.min(1, scale));
  }

  function makeCar(lane: Lane, s: number, surge: boolean, grown: boolean): TrafficCar {
    const variant = weightedIndex(rand, variants.map((v) => v.weight));
    const c: TrafficCar = {
      id: nextId++, variant, color: Math.floor(rand() * colors), halfLen: variants[variant]!.length / 2,
      vMax: CRUISE * (0.85 + rand() * 0.3), lane, conn: null, s, next: null, prev: null, reserved: null,
      v: 0, x: 0, z: 0, heading: 0, scale: grown ? 1 : 0, surge, age: grown ? GROW_S : 0, stuck: 0, dying: 0, waitSince: null,
    };
    c.v = grown ? c.vMax * 0.7 : c.vMax * 0.5;
    c.next = plan(c, lane);
    pose(c);
    return c;
  }

  function clearAt(p: Vec2, carR: number): boolean {
    for (const o of cars) if (Math.hypot(o.x - p.x, o.z - p.z) < carR) return false;
    for (const b of busPoses) if (Math.hypot(b.x - p.x, b.z - p.z) < b.halfLen + carR + 0.5) return false;
    return true;
  }

  function validSpot(l: Lane, s: number, halfLen: number): boolean {
    if (s < 0 || s > l.len) return false;
    if (graph.nodes.get(l.to)!.junction && s > l.len - halfLen - 0.1) return false;
    for (const x of crossingsByLane.get(l.id) ?? []) if (Math.abs(x.s - s) < halfLen + CROSS_STOP + 0.2) return false;
    return clearAt(pointOn(l, s), CLEAR_CAR);
  }

  function fill(t: number): void {
    const n = target(t);
    const weights = graph.lanes.map((l) => (l.exit ? l.len * 0.4 : l.len));
    for (let tries = 0; cars.length < n && tries < n * 40; tries++) {
      const l = graph.lanes[weightedIndex(rand, weights)]!;
      const s = 0.5 + rand() * Math.max(0, l.len - 1);
      if (!validSpot(l, s, 1.1)) continue;
      cars.push(makeCar(l, s, false, true));
    }
  }

  function spawn(t: number): void {
    if (cars.length >= target(t)) return;
    const surgeAlive = cars.filter((c) => c.surge).length;
    if (inSurge(t) && surgeAlive < SURGE_CARS && surgeCooldown <= 0 && stadiumLanes.length) {
      for (let k = 0; k < 6; k++) {
        const l = stadiumLanes[Math.floor(rand() * stadiumLanes.length)]!;
        const s = 1 + rand() * Math.max(0, l.len - 2);
        if (!validSpot(l, s, 1.1)) continue;
        cars.push(makeCar(l, s, true, false));
        surgeCooldown = SURGE_SPAWN_GAP_S * (0.7 + rand() * 0.6);
        return;
      }
      surgeCooldown = 1;
    }
    if (spawnCooldown > 0 || !graph.entries.length) return;
    if (inSurge(t) && cars.length >= base + surgeAlive && surgeAlive < SURGE_CARS) return; // leave room for the exodus
    for (let k = 0; k < 4; k++) {
      const l = graph.entries[Math.floor(rand() * graph.entries.length)]!;
      const probe: TrafficCar = { halfLen: 1.1 } as TrafficCar;
      if (laneHead(l, probe) < 1.2 || !clearAt(pointOn(l, 0), CLEAR_CAR)) continue;
      cars.push(makeCar(l, 0, false, false));
      spawnCooldown = SPAWN_GAP_S * (0.6 + rand() * 0.8);
      return;
    }
    spawnCooldown = 0.5;
  }

  function advance(c: TrafficCar, ds: number): boolean {
    let rem = ds;
    for (let guard = 0; rem > 1e-9 && guard < 8; guard++) {
      const len = pieceLen(c);
      if (c.s + rem <= len) { c.s += rem; return true; }
      rem -= len - c.s;
      c.s = len;
      if (!c.conn) {
        if (c.lane.exit) return false; // left the board
        const nx = c.next;
        if (!nx) return true;
        if (graph.nodes.get(c.lane.to)!.junction && c.reserved !== nx) return true;
        c.prev = c.lane;
        c.conn = nx;
        c.s = 0;
        c.next = plan(c, nx.to);
      } else {
        c.prev = c.conn;
        c.lane = c.conn.to;
        c.conn = null;
        c.s = 0;
      }
    }
    return true;
  }

  function remove(c: TrafficCar): void {
    release(c);
    const i = cars.indexOf(c);
    if (i >= 0) cars.splice(i, 1);
  }

  function step(dtS: number, env: TrafficEnv): void {
    const t = Number.isFinite(env.simT) ? env.simT : lastT;
    lastT = t;
    busPoses = env.buses ?? [];
    buses = mapBuses(graph, busPoses);
    trainDist = env.trainDist ?? null;
    if (!filled) { fill(t); filled = true; }
    const dt = Number.isFinite(dtS) ? Math.min(MAX_DT, Math.max(0, dtS)) : 0;
    spawnCooldown -= dt;
    surgeCooldown -= dt;
    if (dt > 0) {
      for (const c of [...cars]) {
        c.age += dt;
        if (c.dying > 0) {
          c.dying -= dt;
          c.v = 0;
          if (c.dying <= 0) { remove(c); continue; }
          pose(c);
          continue;
        }
        const free = Math.max(0, freeAhead(c));
        let vTarget = c.vMax;
        if (c.conn) vTarget = Math.min(vTarget, TURN_SPEED[c.conn.turn]);
        else if (c.next) vTarget = Math.min(vTarget, Math.sqrt(TURN_SPEED[c.next.turn] ** 2 + 2 * 0.25 * Math.max(0, c.lane.len - c.s)));
        const v = Math.max(0, Math.min(c.v + ACCEL * dt, vTarget, Math.sqrt(2 * BRAKE * free)));
        const ds = Math.min(v * dt, free);
        c.v = ds / dt;
        if (!advance(c, ds)) { remove(c); continue; }
        if (c.reserved && !c.conn && c.lane === c.reserved.to && c.s >= c.halfLen + CLEAR_BOX) release(c);
        c.stuck = c.v < 0.02 ? c.stuck + dt : 0;
        if (c.stuck > STUCK_S) c.dying = DIE_S; // keeps its reservation until removed
        pose(c);
      }
      spawn(t);
    } else {
      for (const c of cars) pose(c);
    }
  }

  return model;
}
