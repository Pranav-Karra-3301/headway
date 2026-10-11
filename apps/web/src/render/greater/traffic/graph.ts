// Owner: G4. The traffic graph for the greater town (pure data, no three.js): G0's lanes (+ any extra lanes, e.g.
// G1's highway and ramps) turned into a linked lane graph that cars can drive.
//  - world exits only (v9): cars spawn on SOURCE lanes and leave from SINK lanes. Those are the lanes at 'edge' and
//    'highway' ports (and the open ends of extra lanes), each lengthened by an APPROACH lane that runs straight out
//    past the grid edge, so cars come out of the mountain tunnel / off the causeway instead of popping up in town.
//    'board' ports (the town's own streets) are neither, unless the composer hands cars over (model.admit /
//    onBoardExit).
//  - junction turn lanes are BOX lanes: entering one needs a reservation that no crossing / merging box lane holds.
//  - signals: G0 junctions with `signals` alternate the through axis and the side arm (+ all-red).
//  - yield lanes (roundabout entries) give way to circulating traffic at the merge.
//  - level crossings: lanes crossing the rail on G0's `railCrossing` tiles stop while the train is near.
import { pointAt, polyline, projectOnPolyline } from '@headway/sim';
import type { Polyline, TownMap, Vec2 } from '@headway/sim';
import { greaterGrid, linkLanes, type GreaterGrid, type Lane, type LaneKind } from '../grid';
import { LANE_SPEED } from '../roads/lanes';

export interface TLane {
  readonly id: string;
  readonly kind: LaneKind;
  readonly poly: Polyline;
  readonly len: number;
  /** Cruise speed hint (u/s, before the model's speed scale). */
  readonly speed: number;
  next: TLane[];
  prev: TLane[];
  /** Give way at the end (roundabout entry / ramp merge). */
  readonly yield: boolean;
  /** Junction id when this is a turn lane inside a junction box, or the lane id of a dead-end U-turn (entering
   *  needs a reservation), else null. */
  box: string | null;
  /** Box lanes that cross or merge with this one (same junction; a U-turn loop conflicts with itself). */
  conflicts: TLane[];
  /** This lane ends at a signalled junction: its arm belongs to signal group `group`. */
  signal: { junction: string; group: 0 | 1 } | null;
  /** Cars may spawn at the start (a world exit: no predecessors). */
  source: boolean;
  /** Cars leave the network at the end (a world exit: no successors). */
  sink: boolean;
  /** Board port id when this lane enters (source side) or leaves (sink side) the playable board. */
  board: string | null;
  /** Port the lane belongs to (spawn/despawn bookkeeping), if any. */
  port: string | null;
  /** Level crossings on this lane: lane arc position of the rail centre line. */
  crossings: Array<{ id: string; s: number }>;
  /** Road surface height per path point (G1's ramps / overpass: HighwayLane.y), or null when flat. */
  ys: number[] | null;
  /** Lanes that start where this one starts (a diverge): cars on them are still in the way for a little while. */
  siblings: TLane[];
  /** Where a car waiting to enter the next lane stops its front bumper (yield lanes: clear of the traffic it
   *  gives way to). */
  holdS: number;
}

export interface Signal {
  id: string;
  center: Vec2;
  /** Arm sides per group: 0 = through axis, 1 = the cross / side arms. */
  groups: [string[], string[]];
  /** Phase durations (s): green 0, all-red, green 1, all-red. */
  phases: [number, number, number, number];
  offset: number;
}

export interface LevelCrossing { id: string; p: Vec2; /** Arc distance of the crossing along the rail loop. */ railDist: number }

export interface TrafficGraph {
  readonly grid: GreaterGrid;
  readonly lanes: TLane[];
  readonly byId: Map<string, TLane>;
  /** World-exit spawn lanes / despawn lanes (never board lanes). */
  readonly sources: TLane[];
  readonly sinks: TLane[];
  /** Board port id → the lane entering the greater network from the town / leaving it into the town. */
  readonly boardIn: Map<string, TLane>;
  readonly boardOut: Map<string, TLane>;
  /** Street lanes worth a detour (cars with a `via` drive through local streets). */
  readonly streets: TLane[];
  readonly signals: Map<string, Signal>;
  readonly crossings: LevelCrossing[];
  readonly railLength: number;
  /** Shortest distance (u) from the start of each lane to the end of `target` (missing: unreachable). Routes never
   *  use dead-end U-turn loops. */
  distTo(target: TLane): Map<TLane, number>;
}

/** A port as G1 describes its expressway exits (several lanes per direction). */
export interface PortLike { id: string; kind: string; inLane?: string | null; outLane?: string | null; inLanes?: readonly string[]; outLanes?: readonly string[] }

export interface TrafficGraphOptions {
  /** Extra lanes (G1 highway, ramps; `y` per point is honoured); merged with G0's lanes and relinked. Passing G1's
   *  whole network (`greaterLanes(map).lanes`) is fine too: lanes are merged by id. */
  lanes?: ReadonlyArray<Lane & { y?: readonly number[] }>;
  /** Extra ports (G1's expressway exits) so their lanes count as one world exit each. */
  ports?: readonly PortLike[];
  /** Length (u) of the approach lanes beyond the grid edge at world exits (default 4). */
  approach?: number;
}

/** Default approach length beyond the grid edge (u). */
export const APPROACH = 4;
const SIGNAL_PHASES = { through: 9, side: 5.5, cross: 7, red: 1.4 } as const;
/** Front bumper gap before a junction box. */
const STOP_BACK = 0.15;
/** Lateral clearance (u, centreline to centreline) between a waiting car's front and the lanes it yields to, and
 *  between box lanes of different arms below which they conflict (car width ≈ 0.98 u). */
const CLEAR = 1.15;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const unit = (a: Vec2): Vec2 => { const L = Math.hypot(a.x, a.z) || 1; return { x: a.x / L, z: a.z / L }; };
/** Snap a direction to the nearest axis when within ~8° (grid roads are axis-aligned; bezier ends are not quite). */
const snap = (d: Vec2): Vec2 => (Math.abs(d.x) > 0.99 ? { x: Math.sign(d.x), z: 0 } : Math.abs(d.z) > 0.99 ? { x: 0, z: Math.sign(d.z) } : d);
const near = (a: Vec2, b: Vec2, tol = 0.05) => Math.hypot(a.x - b.x, a.z - b.z) <= tol;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Proper segment intersection: parameters (t on ab, u on cd) or null. */
function segHit(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
  const r = sub(b, a), s = sub(d, c);
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const q = sub(c, a);
  const t = (q.x * s.z - q.z * s.x) / den, u = (q.x * r.z - q.z * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

function polysCross(p: Polyline, q: Polyline): boolean {
  const A = p.points, B = q.points;
  for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < B.length; j++) {
    const h = segHit(A[i]!, A[i + 1]!, B[j]!, B[j + 1]!);
    if (!h) continue;
    // ignore touching at the very start (lanes fanning out of the same arm)
    if ((i === 0 && h.t < 0.02) || (j === 0 && h.u < 0.02)) continue;
    return true;
  }
  return false;
}

/** Smallest distance between two polylines (sampled every 0.2 u along p). */
function minDist(p: Polyline, q: Polyline): number {
  let best = Infinity;
  for (let s = 0; s <= p.length + 1e-9; s += 0.2) best = Math.min(best, projectOnPolyline(q, pointAt(p, Math.min(s, p.length))).d);
  return best;
}

/** Distance from p along dir until it leaves the rectangle (0 when already outside). */
function exitDistance(g: GreaterGrid, p: Vec2, dir: Vec2): number {
  const b = g.bounds;
  if (p.x <= b.minX + 1e-6 || p.x >= b.maxX - 1e-6 || p.z <= b.minZ + 1e-6 || p.z >= b.maxZ - 1e-6) return 0;
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (b.maxX - p.x) / dir.x);
  if (dir.x < -1e-6) t = Math.min(t, (b.minX - p.x) / dir.x);
  if (dir.z > 1e-6) t = Math.min(t, (b.maxZ - p.z) / dir.z);
  if (dir.z < -1e-6) t = Math.min(t, (b.minZ - p.z) / dir.z);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

const sideOf = (d: Vec2): string => (Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? 'e' : 'w') : d.z > 0 ? 's' : 'n');

const cache = new WeakMap<TownMap, TrafficGraph>();

/** The traffic graph for a map (memoised when no options are given). */
export function buildTrafficGraph(map: TownMap, opts: TrafficGraphOptions = {}): TrafficGraph {
  const plain = !opts.lanes?.length && !opts.ports?.length && opts.approach === undefined;
  if (plain) { const c = cache.get(map); if (c) return c; }
  const g = greaterGrid(map);
  const approach = opts.approach ?? APPROACH;

  // never mutate G0's memoised lanes: copy, then relink when extra lanes join
  const raw: Array<Lane & { y?: readonly number[] }> = g.lanes.map((l) => ({ ...l, next: [...l.next] }));
  if (opts.lanes?.length) {
    const at = new Map(raw.map((l, i) => [l.id, i] as const));
    for (const l of opts.lanes) {
      if (l.path.points.length < 2) continue;
      const i = at.get(l.id);
      if (i === undefined) raw.push({ ...l, next: [...l.next] });
      else if (l.y) raw[i] = { ...raw[i]!, y: l.y };
    }
    linkLanes(raw);
  }

  const boardLane = new Map<string, string>(); // lane id → board port id
  // a lane can be the way in at one port and the way out at another (an expressway lane end to end)
  type P = PortLike & { dir?: Vec2 };
  const inPort = new Map<string, P>(), outPort = new Map<string, P>();
  for (const p of [...g.ports, ...(opts.ports ?? [])] as P[]) {
    for (const id of [p.inLane, ...(p.inLanes ?? [])]) if (id) { inPort.set(id, p); if (p.kind === 'board') boardLane.set(id, p.id); }
    for (const id of [p.outLane, ...(p.outLanes ?? [])]) if (id) { outPort.set(id, p); if (p.kind === 'board') boardLane.set(id, p.id); }
  }
  const portLane = { get: (id: string): P | undefined => inPort.get(id) ?? outPort.get(id) };

  const mk = (l: Lane & { y?: readonly number[] }): TLane => ({
    id: l.id, kind: l.kind, poly: l.path, len: l.path.length, speed: l.speed || LANE_SPEED[l.kind] || 4,
    next: [], prev: [], yield: !!l.yield, box: null, conflicts: [], signal: null,
    source: false, sink: false, board: boardLane.get(l.id) ?? null, port: portLane.get(l.id)?.id ?? null, crossings: [],
    siblings: [], holdS: Math.max(0, l.path.length - STOP_BACK),
    ys: l.y && l.y.length === l.path.points.length && l.y.some((v) => Math.abs(v) > 1e-6) ? [...l.y] : null,
  });
  const lanes = raw.filter((l) => l.path.length > 1e-6).map(mk);
  const byId = new Map(lanes.map((l) => [l.id, l] as const));
  for (const l of raw) {
    const t = byId.get(l.id);
    if (!t) continue;
    for (const n of l.next) { const m = byId.get(n); if (m) { t.next.push(m); m.prev.push(t); } }
  }

  // ---- approach lanes at world exits: every open end that is not a board lane
  const open = lanes.slice();
  for (const l of open) {
    if (l.board) continue;
    const pts = l.poly.points;
    // outward direction: the port's when it agrees with the lane end, else the end tangent (axis-snapped)
    const outward = (p: P | undefined, t: Vec2): Vec2 => (p?.dir && p.dir.x * t.x + p.dir.z * t.z > 0.7 ? p.dir : snap(t));
    if (!l.prev.length) {
      const pin = inPort.get(l.id);
      const d = outward(pin, unit(sub(pts[0]!, pts[1]!)));
      const L = exitDistance(g, pts[0]!, d) + approach;
      const y0 = l.ys?.[0] ?? 0;
      const a: TLane = { ...mk({ id: `${l.id}~in`, kind: l.kind === 'highway' ? 'highway' : 'radial', path: polyline([{ x: pts[0]!.x + d.x * L, z: pts[0]!.z + d.z * L }, pts[0]!], false), speed: 0, next: [], ...(y0 ? { y: [y0, y0] } : {}) }), port: pin?.id ?? null };
      a.next.push(l); l.prev.push(a); a.source = true;
      lanes.push(a); byId.set(a.id, a);
    }
    if (!l.next.length) {
      const n = pts.length;
      const pout = outPort.get(l.id);
      const d = outward(pout, unit(sub(pts[n - 1]!, pts[n - 2]!)));
      const L = exitDistance(g, pts[n - 1]!, d) + approach;
      const y1 = l.ys?.[n - 1] ?? 0;
      const a: TLane = { ...mk({ id: `${l.id}~out`, kind: l.kind === 'highway' ? 'highway' : 'radial', path: polyline([pts[n - 1]!, { x: pts[n - 1]!.x + d.x * L, z: pts[n - 1]!.z + d.z * L }], false), speed: 0, next: [], ...(y1 ? { y: [y1, y1] } : {}) }), port: pout?.id ?? null };
      a.prev.push(l); l.next.push(a); a.sink = true;
      lanes.push(a); byId.set(a.id, a);
    }
  }
  // open ends without a known port: ends within 10 u of each other are one world exit
  const loose = lanes.filter((l) => (l.source || l.sink) && !l.port);
  loose.forEach((l, i) => {
    const far = l.source ? l.poly.points[0]! : l.poly.points[l.poly.points.length - 1]!;
    const mate = loose.slice(0, i).find((o) => {
      const q = o.source ? o.poly.points[0]! : o.poly.points[o.poly.points.length - 1]!;
      return Math.hypot(q.x - far.x, q.z - far.z) < 10;
    });
    l.port = mate?.port ?? `exit-${i}`;
  });
  const boardIn = new Map<string, TLane>(), boardOut = new Map<string, TLane>();
  for (const p of g.ports) {
    if (p.kind !== 'board') continue;
    const i = p.inLane ? byId.get(p.inLane) : undefined, o = p.outLane ? byId.get(p.outLane) : undefined;
    if (i && !i.prev.length) boardIn.set(p.id, i);
    if (o && !o.next.length) boardOut.set(p.id, o);
  }

  // ---- junction boxes: conflicts between turn lanes of the same junction
  const boxes = new Map<string, TLane[]>();
  for (const l of lanes) {
    if (l.kind !== 'junction') continue;
    const j = l.id.slice(0, l.id.indexOf(':'));
    l.box = j;
    (boxes.get(j) ?? boxes.set(j, []).get(j)!).push(l);
  }
  // dead-end U-turn loops are so tight that one car at a time fits
  for (const l of lanes) if (l.kind === 'uturn') { l.box = l.id; l.conflicts = [l]; }
  for (const list of boxes.values()) {
    for (const a of list) for (const b of list) {
      if (a === b) continue;
      const pa = a.poly.points, pb = b.poly.points;
      if (near(pa[0]!, pb[0]!)) continue; // same arm: following (+ siblings)
      if (near(pa[pa.length - 1]!, pb[pb.length - 1]!) || polysCross(a.poly, b.poly) || minDist(a.poly, b.poly) < CLEAR - 0.1) a.conflicts.push(b);
    }
  }

  // ---- diverges (siblings) and yield hold lines
  for (const l of lanes) {
    const sib = new Set<TLane>();
    for (const p of l.prev) for (const n of p.next) if (n !== l && near(n.poly.points[0]!, l.poly.points[0]!, 0.2)) sib.add(n);
    l.siblings = [...sib];
  }
  for (const l of lanes) {
    if (!l.yield) continue;
    const end = l.poly.points[l.poly.points.length - 1]!;
    const others = lanes.filter((o) => o !== l && !l.prev.includes(o) && o.poly.points.some((p) => Math.hypot(p.x - end.x, p.z - end.z) < 6));
    let hold = 0;
    for (let s = l.len; s >= 0; s -= 0.1) {
      const p = pointAt(l.poly, s);
      if (others.every((o) => projectOnPolyline(o.poly, p).d >= CLEAR)) { hold = s; break; }
    }
    l.holdS = hold;
  }

  // ---- signals at G0's major junctions
  const signals = new Map<string, Signal>();
  for (const j of g.junctions) {
    if (!j.signals || (j.kind !== 'tee' && j.kind !== 'cross')) continue;
    const sides = j.arms.map((a) => sideOf(a.dir));
    const has = (s: string) => sides.includes(s);
    let through: string[];
    if (j.kind === 'cross') through = ['n', 's'];
    else through = has('n') && has('s') ? ['n', 's'] : ['e', 'w'];
    const side = sides.filter((s) => !through.includes(s));
    const g1 = j.kind === 'cross' ? SIGNAL_PHASES.cross : SIGNAL_PHASES.side;
    const phases: Signal['phases'] = [SIGNAL_PHASES.through, SIGNAL_PHASES.red, g1, SIGNAL_PHASES.red];
    const cycle = phases.reduce((a, b) => a + b, 0);
    signals.set(j.id, { id: j.id, center: j.center, groups: [through, side], phases, offset: (hash(j.id) % 1000) / 1000 * cycle });
  }
  for (const l of lanes) {
    const box = l.next.find((n) => n.box && signals.has(n.box));
    if (!box) continue;
    const arm = box.id.slice(box.id.indexOf(':') + 1).split('>')[0]!;
    const sig = signals.get(box.box!)!;
    l.signal = { junction: sig.id, group: sig.groups[0].includes(arm) ? 0 : 1 };
  }

  // ---- level crossings (G0 railCrossing tiles × the rail loop)
  const rail = map.rail.loop;
  const crossings: LevelCrossing[] = [];
  const RP = rail.points, rn = RP.length, rsegs = rail.closed ? rn : rn - 1;
  for (const t of g.roads) {
    if (!t.railCrossing) continue;
    const h = (Math.max(t.cells.w, t.cells.h) * g.tile) / 2 + 0.5;
    let railDist: number | null = null, hitP: Vec2 | null = null;
    for (const l of lanes) {
      const P = l.poly.points;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i]!, b = P[i + 1]!;
        if (Math.max(Math.abs(a.x - t.center.x), Math.abs(a.z - t.center.z)) > h + 4) continue;
        for (let k = 0; k < rsegs; k++) {
          const c = RP[k]!, d = RP[(k + 1) % rn]!;
          const hit = segHit(a, b, c, d);
          if (!hit) continue;
          const p = { x: a.x + (b.x - a.x) * hit.t, z: a.z + (b.z - a.z) * hit.t };
          if (Math.max(Math.abs(p.x - t.center.x), Math.abs(p.z - t.center.z)) > h) continue;
          const segLen = Math.hypot(d.x - c.x, d.z - c.z);
          railDist ??= rail.cum[k]! + segLen * hit.u;
          hitP ??= p;
          l.crossings.push({ id: t.id, s: l.poly.cum[i]! + Math.hypot(b.x - a.x, b.z - a.z) * hit.t });
        }
      }
    }
    if (railDist !== null && hitP) crossings.push({ id: t.id, p: hitP, railDist });
  }
  for (const l of lanes) l.crossings.sort((a, b) => a.s - b.s);

  // ---- sources / sinks (world exits that can actually reach an exit)
  const sinks = lanes.filter((l) => l.sink);
  const canExit = new Set<TLane>();
  const stack = [...sinks];
  for (const s of stack) canExit.add(s);
  while (stack.length) {
    const l = stack.pop()!;
    for (const p of l.prev) if (!canExit.has(p)) { canExit.add(p); stack.push(p); }
  }
  const sources = lanes.filter((l) => l.source && canExit.has(l));
  const reach = new Set<TLane>(sources);
  const fwd = [...sources, ...boardIn.values()];
  for (const s of fwd) reach.add(s);
  while (fwd.length) {
    const l = fwd.pop()!;
    for (const n of l.next) if (!reach.has(n)) { reach.add(n); fwd.push(n); }
  }
  const STREET: ReadonlySet<LaneKind> = new Set<LaneKind>(['local', 'avenue', 'parkway', 'radial', 'ring']);
  // detours avoid dead-end stubs (lanes into / out of a U-turn loop): queues there can only drain one car at a time
  const stub = (l: TLane) => l.next.some((n) => n.kind === 'uturn') || l.prev.some((p) => p.kind === 'uturn');
  const streets = lanes.filter((l) => STREET.has(l.kind) && !l.board && !l.source && !l.sink && l.len >= 3 && !stub(l) && reach.has(l) && canExit.has(l));

  const dcache = new Map<TLane, Map<TLane, number>>();
  const distTo = (target: TLane): Map<TLane, number> => {
    let d = dcache.get(target);
    if (d) return d;
    d = new Map<TLane, number>();
    d.set(target, target.len);
    const open: TLane[] = [target];
    while (open.length) {
      // tiny graph: linear-scan priority queue
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (d.get(open[i]!)! < d.get(open[bi]!)!) bi = i;
      const l = open.splice(bi, 1)[0]!;
      const dl = d.get(l)!;
      for (const p of l.prev) {
        if (p.kind === 'uturn') continue; // routes never turn around in a cul-de-sac (one car at a time: gridlock bait)
        const nd = dl + p.len;
        if (nd < (d.get(p) ?? Infinity)) { d.set(p, nd); open.push(p); }
      }
    }
    dcache.set(target, d);
    return d;
  };

  const graph: TrafficGraph = {
    grid: g, lanes, byId, sources, sinks: sinks.filter((s) => !s.board), boardIn, boardOut, streets, signals, crossings,
    railLength: rail.length, distTo,
  };
  if (plain) cache.set(map, graph);
  return graph;
}

/** Signal group showing green at time t (s), or null during all-red. */
export function signalGreen(sig: Signal, t: number): 0 | 1 | null {
  const [g0, r0, g1, r1] = sig.phases;
  const cycle = g0 + r0 + g1 + r1;
  let u = (t + sig.offset) % cycle;
  if (u < 0) u += cycle;
  if (u < g0) return 0;
  if (u < g0 + r0) return null;
  if (u < g0 + r0 + g1) return 1;
  return null;
}
