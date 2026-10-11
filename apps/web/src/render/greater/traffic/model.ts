// Owner: G4. Greater-town traffic state machine (pure, no three.js). Visual only: never touches the sim.
// Cars enter at world exits (approach lanes beyond the grid edge), drive to another exit by a near-shortest route
// (some take a detour through local streets), and leave there. Per step, hard invariants:
//  - a car never closes within MIN_GAP of the car ahead on its path (same lane, the lanes it plans next, and cars
//    about to merge into its next lane ahead of it);
//  - a car only enters a junction box lane holding a reservation no crossing/merging box lane holds, on green when
//    the junction is signalled, and with room to clear the box ("don't block the box");
//  - a car entering a roundabout yields to circulating cars near the merge point and needs room on the ring;
//  - cars stop before a level crossing while the train is near it.
// Moves in model seconds (the layer feeds real seconds; it freezes while the sim is paused).
import { pointAt } from '@headway/sim';
import { signalGreen, type LevelCrossing, type TLane, type TrafficGraph } from './graph';
import { mulberry32 } from './rng';

export const MIN_GAP = 0.35;
export const DEFAULT_CARS = 36;
export const MAX_CARS = 64;
/** Speed hints are scaled by this (G0 hints ≈ real m/s-ish; 0.55 keeps pace with the town's own traffic). */
export const SPEED_SCALE = 0.55;

const ACCEL = 2.2;
const BRAKE = 3.2;
const MAX_DT = 0.2;
const HORIZON = 14;
const STOP_BACK = 0.15;
const YIELD_BACK = 0.45;
const CROSS_STOP = 1.5; // front bumper stops this far before the rail centre line
const TRAIN_BEHIND = 11, TRAIN_AHEAD = 16; // rail arc window around the train front that closes a crossing
const SPAWN_GAP = 0.45;
const SOURCE_GAP = 1.5;
const GROW = 1.6; // u of approach lane over which a car scales in / out

export interface VehicleSpec { length: number; weight: number; /** Speed factor (trucks < 1). */ speed?: number }
export const DEFAULT_SPECS: VehicleSpec[] = [
  { length: 1.66, weight: 0.5 },
  { length: 1.66, weight: 0.32 },
  { length: 2.11, weight: 0.18, speed: 0.85 },
];

export interface GreaterTrafficModelOptions {
  seed: number;
  /** Target number of cars on the network (default 36, ≤ MAX_CARS). */
  cars?: number;
  variants?: VehicleSpec[];
  /** Number of body colours (palette `car` roles), default 6. */
  colors?: number;
  speedScale?: number;
  /** Share of cars that detour through a local street (default 0.4). */
  viaShare?: number;
  /** Called when a car reaches the board edge through a board port (the composer continues it on the town's
   *  streets). When set, `boardShare` of new cars head into the town; without it no car ever enters the board. */
  onBoardExit?: (portId: string, car: Readonly<GreaterCar>) => void;
  boardShare?: number;
}

export interface GreaterCar {
  readonly id: number;
  variant: number;
  color: number;
  halfLen: number;
  /** Speed factor for this car (variant × jitter). */
  vf: number;
  lane: TLane;
  s: number;
  v: number;
  /** Planned lanes after `lane` (plan[0] is next). */
  plan: TLane[];
  dest: TLane;
  via: TLane | null;
  /** Lane whose entry permission this car holds (box / merge), until it is on it. */
  committed: TLane | null;
  /** Box lanes reserved (released when the rear clears them). */
  holds: TLane[];
  x: number;
  z: number;
  /** Viewer heading: rotation.y for a model facing +x (pointAt convention). */
  heading: number;
  scale: number;
  age: number;
  /** Seconds stopped (debug / liveness). */
  wait: number;
  done: boolean;
  /** Route noise (0..0.25): how far from the shortest way this car is willing to stray. */
  noise: number;
}

export interface TrafficEnv { /** Train front arc distance along the rail loop, or null. */ trainDist?: number | null }

export interface GreaterTrafficModel {
  readonly graph: TrafficGraph;
  readonly cars: readonly GreaterCar[];
  /** Model clock (s). */
  readonly time: number;
  target: number;
  step(dt: number, env?: TrafficEnv): void;
  /** Run `seconds` of traffic instantly (fills the network so the first frame already looks lived-in). */
  warm(seconds: number): void;
  /** Spawn a car arriving from the town at a board port (handoff); false when the lane start is full. */
  admit(portId: string, variant?: number, color?: number): boolean;
  /** Green signal group at a junction right now (0 through, 1 side) or null (all red / not signalled). */
  signal(junctionId: string): 0 | 1 | null;
  crossingClosed(id: string): boolean;
  setVariants(specs: VehicleSpec[]): void;
}

export function createGreaterTrafficModel(graph: TrafficGraph, opts: GreaterTrafficModelOptions): GreaterTrafficModel {
  const rand = mulberry32((opts.seed ^ 0x6a4c7e1) >>> 0);
  let specs = opts.variants?.length ? opts.variants : DEFAULT_SPECS;
  const colors = Math.max(1, opts.colors ?? 6);
  const speedScale = opts.speedScale ?? SPEED_SCALE;
  const viaShare = opts.viaShare ?? 0.4;
  const boardShare = opts.onBoardExit ? opts.boardShare ?? 0.3 : 0;
  const cars: GreaterCar[] = [];
  const held = new Map<TLane, number>();
  const sourceCool = new Map<TLane, number>();
  const crossingById = new Map<string, LevelCrossing>(graph.crossings.map((c) => [c.id, c] as const));
  let byLane = new Map<TLane, GreaterCar[]>();
  let time = 0;
  let nextId = 1;
  let spawnCool = 0;
  let trainDist: number | null = null;

  const pickVariant = (): number => {
    let total = 0;
    for (const s of specs) total += s.weight;
    let r = rand() * total;
    for (let i = 0; i < specs.length; i++) { r -= specs[i]!.weight; if (r <= 0) return i; }
    return specs.length - 1;
  };

  // ---------------------------------------------------------------- routing
  const targetOf = (c: GreaterCar): TLane => c.via ?? c.dest;
  const choose = (c: GreaterCar, from: TLane): TLane | null => {
    if (!from.next.length) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = targetOf(c);
      const d = graph.distTo(target);
      let best: TLane | null = null, bestScore = Infinity;
      for (const n of from.next) {
        if (n.board && n !== c.dest) continue; // into the town only when that is where it is going
        const dn = d.get(n);
        if (dn === undefined) continue;
        const score = dn * (1 + c.noise * rand());
        if (score < bestScore) { best = n; bestScore = score; }
      }
      if (best) {
        if (best === c.via) c.via = null;
        return best;
      }
      if (c.via) { c.via = null; continue; }
      // destination unreachable from here: head for the nearest exit instead
      let near: TLane | null = null, nd = Infinity;
      for (const s of graph.sinks) {
        const v = graph.distTo(s).get(from);
        if (v !== undefined && v < nd) { nd = v; near = s; }
      }
      if (!near || near === c.dest) break;
      c.dest = near;
    }
    // last resort: any non-board successor (keeps cars moving; never into the town uninvited)
    return from.next.find((n) => !n.board) ?? null;
  };
  const ensurePlan = (c: GreaterCar): void => {
    while (c.plan.length < 4) {
      const last = c.plan.length ? c.plan[c.plan.length - 1]! : c.lane;
      const n = choose(c, last);
      if (!n) break;
      c.plan.push(n);
    }
  };

  // ---------------------------------------------------------------- rules
  const needsPermit = (from: TLane, to: TLane): boolean => !!to.box || (from.yield && to.prev.length > 1);
  const firstRear = (l: TLane): number => {
    const list = byLane.get(l);
    if (!list?.length) return Infinity;
    const f = list[0]!;
    return f.s - f.halfLen;
  };
  const isGreen = (from: TLane): boolean => {
    if (!from.signal) return true;
    const sig = graph.signals.get(from.signal.junction);
    return !sig || signalGreen(sig, time) === from.signal.group;
  };
  const closed = (id: string): boolean => {
    const x = crossingById.get(id);
    if (!x || trainDist === null) return false;
    const L = graph.railLength;
    let d = (x.railDist - trainDist) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d >= -TRAIN_BEHIND && d <= TRAIN_AHEAD;
  };

  const permit = (c: GreaterCar, from: TLane, to: TLane): boolean => {
    const need = 2 * c.halfLen + MIN_GAP;
    if (to.box) {
      if (!isGreen(from)) return false;
      for (const q of to.conflicts) if ((held.get(q) ?? 0) > 0) return false;
      // don't block the box: room after it for this car and everyone already inside heading the same way
      const exit = c.plan[1];
      if (exit && !exit.sink) {
        let room = Math.min(firstRear(exit), exit.len + 4);
        for (const o of cars) if (o !== c && o.lane.box && o.plan[0] === exit) room -= 2 * o.halfLen + MIN_GAP;
        if (room < need) return false;
      }
      return true;
    }
    // yield: circulating cars close to the merge point have priority; need room on the ring
    if (firstRear(to) < need) return false;
    const window = to.speed * speedScale * 1.7 + 1.6;
    for (const q of to.prev) {
      if (q === from || q.yield) continue;
      for (const o of byLane.get(q) ?? []) {
        if (o.plan[0] !== to) continue;
        if (q.len - o.s - o.halfLen < window + c.halfLen) return false;
      }
      for (const p of q.prev) {
        for (const o of byLane.get(p) ?? []) {
          if (o.plan[0] !== q || o.plan[1] !== to) continue;
          if (p.len - o.s + q.len - o.halfLen < window + c.halfLen) return false;
        }
      }
    }
    return true;
  };

  /** Free distance ahead of the front bumper to the nearest obstacle, and the speed cap from upcoming lanes. */
  const look = (c: GreaterCar): { gap: number; vCap: number } => {
    let gap = Infinity;
    const vLane = (l: TLane) => l.speed * speedScale * c.vf;
    let vCap = vLane(c.lane);
    const front = c.s + c.halfLen;
    // same lane
    const own = byLane.get(c.lane)!;
    const idx = own.indexOf(c);
    if (idx >= 0 && idx + 1 < own.length) {
      const o = own[idx + 1]!;
      gap = Math.min(gap, o.s - o.halfLen - front);
    }
    // level crossings on the current lane
    for (const x of c.lane.crossings) {
      const stop = x.s - CROSS_STOP;
      if (front <= stop + 0.05 && closed(x.id)) { gap = Math.min(gap, stop - front); break; }
    }
    // lanes ahead
    let base = c.lane.len - c.s; // centre → start of plan[k]
    let from = c.lane;
    for (let k = 0; k < c.plan.length && base - c.halfLen < HORIZON; k++) {
      const l = c.plan[k]!;
      // speed for the next lane, reachable with comfortable braking
      const vn = vLane(l);
      if (vn < vCap) vCap = Math.min(vCap, Math.sqrt(vn * vn + 2 * BRAKE * Math.max(0, base - c.halfLen)));
      // permission to enter l
      if (needsPermit(from, l) && c.committed !== l) {
        const back = from.yield ? YIELD_BACK : STOP_BACK;
        const stopGap = base - c.halfLen - back;
        if (k === 0 && stopGap <= (c.v * c.v) / (2 * BRAKE) + 0.9 && permit(c, from, l)) {
          c.committed = l;
          if (l.box) { c.holds.push(l); held.set(l, (held.get(l) ?? 0) + 1); }
        } else {
          gap = Math.min(gap, stopGap);
          break;
        }
      }
      // cars about to merge into l ahead of me (zipper; uncommitted yielders wait, so they are not leaders)
      if (l.prev.length > 1) {
        for (const q of l.prev) {
          if (q === from) continue;
          for (const o of byLane.get(q) ?? []) {
            if (o.plan[0] !== l) continue;
            if (needsPermit(q, l) && o.committed !== l) continue;
            const od = q.len - o.s; // other's centre → merge point
            if (od < base || (od === base && o.id < c.id)) gap = Math.min(gap, base - od - o.halfLen - c.halfLen);
          }
        }
      }
      // first car on l
      const list = byLane.get(l);
      if (list?.length) {
        const o = list[0]!;
        gap = Math.min(gap, base + o.s - o.halfLen - c.halfLen);
      }
      // closed level crossing on l
      for (const x of l.crossings) {
        if (closed(x.id)) { gap = Math.min(gap, base + x.s - CROSS_STOP - c.halfLen); break; }
      }
      if (gap < Infinity) break;
      base += l.len;
      from = l;
    }
    return { gap, vCap };
  };

  // ---------------------------------------------------------------- lifecycle
  const placeCar = (c: GreaterCar): void => {
    const p = pointAt(c.lane.poly, Math.min(c.lane.len, Math.max(0, c.s)));
    c.x = p.x; c.z = p.z; c.heading = p.heading;
  };
  const spawnOn = (lane: TLane, dest: TLane, variant = pickVariant(), color = Math.floor(rand() * colors)): GreaterCar | null => {
    const spec = specs[variant % specs.length]!;
    const halfLen = spec.length / 2;
    if (firstRear(lane) < 2 * halfLen + MIN_GAP + 0.2) return null;
    const c: GreaterCar = {
      id: nextId++, variant: variant % specs.length, color, halfLen, vf: (spec.speed ?? 1) * (0.92 + rand() * 0.16),
      lane, s: 0, v: lane.speed * speedScale * 0.8, plan: [], dest, via: null, committed: null, holds: [],
      x: 0, z: 0, heading: 0, scale: lane.board ? 1 : 0, age: 0, wait: 0, done: false, noise: 0.05 + rand() * 0.2,
    };
    if (graph.streets.length && rand() < viaShare) {
      const v = graph.streets[Math.floor(rand() * graph.streets.length)]!;
      if (graph.distTo(v).has(lane) && graph.distTo(dest).has(v)) c.via = v;
    }
    ensurePlan(c);
    placeCar(c);
    cars.push(c);
    const list = byLane.get(lane) ?? byLane.set(lane, []).get(lane)!;
    list.unshift(c);
    return c;
  };
  const pickDest = (src: TLane, fromTown = false): TLane | null => {
    const intoTown = !fromTown && boardShare > 0 && graph.boardOut.size > 0 && rand() < boardShare;
    const pool = intoTown ? [...graph.boardOut.values()] : graph.sinks.filter((s) => s.port !== src.port);
    const ok = pool.filter((s) => graph.distTo(s).has(src));
    if (!ok.length) return null;
    const w = (s: TLane) => (s.kind === 'highway' || s.port?.startsWith('highway') ? 1.5 : 1);
    let total = 0;
    for (const s of ok) total += w(s);
    let r = rand() * total;
    for (const s of ok) { r -= w(s); if (r <= 0) return s; }
    return ok[ok.length - 1]!;
  };
  const trySpawn = (): void => {
    const ready = graph.sources.filter((s) => (sourceCool.get(s) ?? 0) <= 0);
    if (!ready.length) return;
    const w = (s: TLane) => (s.kind === 'highway' || s.port?.startsWith('highway') ? 1.5 : 1);
    let total = 0;
    for (const s of ready) total += w(s);
    let r = rand() * total, src = ready[ready.length - 1]!;
    for (const s of ready) { r -= w(s); if (r <= 0) { src = s; break; } }
    const dest = pickDest(src);
    if (!dest) return;
    if (spawnOn(src, dest)) { sourceCool.set(src, SOURCE_GAP * (0.7 + rand() * 0.8)); spawnCool = SPAWN_GAP; }
  };

  const release = (c: GreaterCar, all = false): void => {
    c.holds = c.holds.filter((h) => {
      const keep = !all && (h === c.lane || (c.lane.prev.includes(h) && c.s - c.halfLen < 0.1) || c.plan[0] === h);
      if (!keep) held.set(h, Math.max(0, (held.get(h) ?? 1) - 1));
      return keep;
    });
  };

  const rebuildIndex = (): void => {
    byLane = new Map();
    for (const c of cars) (byLane.get(c.lane) ?? byLane.set(c.lane, []).get(c.lane)!).push(c);
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s || a.id - b.id);
  };

  const stepOnce = (dt: number): void => {
    time += dt;
    rebuildIndex();
    // phase 1: decide (from the positions at the start of the step)
    const moves = new Map<GreaterCar, number>();
    for (const c of cars) {
      ensurePlan(c);
      const { gap, vCap } = look(c);
      const free = gap - MIN_GAP;
      let vt = Math.min(vCap, free > 0 ? Math.sqrt(2 * BRAKE * free) : 0);
      if (!(vt >= 0)) vt = 0;
      let v = vt > c.v ? Math.min(vt, c.v + ACCEL * dt) : Math.max(vt, c.v - BRAKE * 2.5 * dt);
      let adv = v * dt;
      const maxAdv = Math.max(0, free);
      if (adv > maxAdv) { adv = maxAdv; v = adv / dt; }
      c.v = v;
      moves.set(c, adv);
    }
    // phase 2: move
    for (const c of cars) {
      c.s += moves.get(c) ?? 0;
      c.age += dt;
      c.wait = c.v < 0.05 ? c.wait + dt : 0;
      while (c.s > c.lane.len) {
        if (!c.lane.next.length) { c.done = true; break; }
        const to = c.plan[0];
        if (!to || (needsPermit(c.lane, to) && c.committed !== to)) { c.s = c.lane.len; c.v = 0; break; }
        c.s -= c.lane.len;
        c.lane = to;
        c.plan.shift();
        if (c.committed === to) c.committed = null;
        ensurePlan(c);
      }
      if (c.lane.sink && c.s >= c.lane.len - 0.02) c.done = true;
      if (c.done && c.lane.board && !c.lane.next.length) opts.onBoardExit?.(c.lane.board, c);
      release(c, c.done);
      // scale in on the approach lane, out at the far end of an exit lane
      let sc = 1;
      if (c.lane.source) sc = Math.min(sc, c.s / GROW);
      if (c.lane.sink) sc = Math.min(sc, (c.lane.len - c.s) / GROW);
      c.scale = Math.max(0, Math.min(1, sc));
      const p = pointAt(c.lane.poly, Math.min(c.lane.len, c.s));
      c.x = p.x; c.z = p.z;
      let dh = p.heading - c.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      c.heading += dh * Math.min(1, dt * 14);
    }
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i]!.done) cars.splice(i, 1);
    // spawn
    spawnCool -= dt;
    for (const [s, t] of sourceCool) sourceCool.set(s, t - dt);
    if (cars.length < model.target && spawnCool <= 0) { rebuildIndex(); trySpawn(); }
  };

  const model: GreaterTrafficModel = {
    graph,
    cars,
    get time() { return time; },
    target: Math.min(MAX_CARS, Math.max(0, Math.round(opts.cars ?? DEFAULT_CARS))),
    step(dt, env = {}) {
      trainDist = env.trainDist ?? null;
      if (!(dt > 0)) return;
      let left = Math.min(dt, 1);
      while (left > 1e-6) {
        const h = Math.min(MAX_DT, left);
        stepOnce(h);
        left -= h;
      }
    },
    warm(seconds) {
      const saved = trainDist;
      trainDist = null;
      for (let t = 0; t < seconds; t += MAX_DT) stepOnce(MAX_DT);
      trainDist = saved;
    },
    admit(portId, variant, color) {
      const lane = graph.boardIn.get(portId);
      if (!lane || cars.length >= MAX_CARS) return false;
      rebuildIndex();
      const dest = pickDest(lane, true);
      if (!dest) return false;
      return !!spawnOn(lane, dest, variant ?? pickVariant(), color ?? Math.floor(rand() * colors));
    },
    signal(junctionId) {
      const sig = graph.signals.get(junctionId);
      return sig ? signalGreen(sig, time) : null;
    },
    crossingClosed: closed,
    setVariants(next) {
      if (!next.length) return;
      specs = next;
      for (const c of cars) {
        c.variant %= specs.length;
        c.halfLen = specs[c.variant]!.length / 2;
      }
    },
  };
  return model;
}
