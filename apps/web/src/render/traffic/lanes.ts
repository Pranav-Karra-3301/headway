// Owner: T2.3. Lane graph for ambient traffic, derived from TownMap.roads (pure, no THREE).
// - One lane per road edge and direction, offset LANE_OFFSET to the right of travel (right-hand traffic), trimmed
//   JUNCTION_TRIM short of junctions (degree ≥ 3) so turns happen inside the junction box.
// - Connectors join an incoming lane end to every outgoing lane start at a node except the same edge (no U-turns):
//   quadratic Béziers through the intersection of the two lane lines (eased corners), straight when collinear.
// - Connectors at a junction that come too close to each other conflict (one reservation at a time).
// - Board-edge nodes (degree 1 on the board boundary) are exits: cars enter on `entry` lanes and leave on `exit` lanes.
// - Level crossings: where lanes cross the rail loop (cars stop while the train is there).
import { pointAt, polyline } from '@headway/sim';
import type { Polyline, TownMap, Vec2 } from '@headway/sim';

/** Lane centre distance from the road centreline (road width 2.4 → two 1.2 u lanes). */
export const LANE_OFFSET = 0.6;
/** Lanes stop this far (along the road) short of a junction centre; turns run inside that box. */
export const JUNCTION_TRIM = 2.0;
export const ROAD_HALF_WIDTH = 1.2;
/** Two movements whose paths come closer than this cannot share a junction. */
const CONFLICT_DIST = 1.1;
const CONNECTOR_SEGS = 10;

export interface LaneNode { id: string; p: Vec2; degree: number; exit: boolean; junction: boolean }
export interface Lane {
  id: string;
  edgeId: string;
  forward: boolean;
  from: string;
  to: string;
  /** Lane polyline in travel direction (offset, trimmed). */
  poly: Polyline;
  len: number;
  /** Untrimmed road centreline in travel direction. */
  centre: Polyline;
  /** Centreline arc length at lane s = 0. */
  trimStart: number;
  /** Starts at a board-edge exit (cars enter here). */
  entry: boolean;
  /** Ends at a board-edge exit (cars leave here). */
  exit: boolean;
}
export type Turn = 'straight' | 'left' | 'right';
export interface Connector {
  id: string;
  node: string;
  from: Lane;
  to: Lane;
  poly: Polyline;
  len: number;
  turn: Turn;
  /** Connector ids at the same node that may not be occupied at the same time as this one. */
  conflicts: Set<string>;
}
export interface Crossing { lane: Lane; s: number; railDist: number }
export interface LaneGraph {
  map: TownMap;
  nodes: Map<string, LaneNode>;
  lanes: Lane[];
  laneById: Map<string, Lane>;
  /** Connectors leaving each lane's end (empty for exit lanes). */
  out: Map<string, Connector[]>;
  /** Connectors arriving at each lane's start. */
  into: Map<string, Connector[]>;
  connectors: Connector[];
  entries: Lane[];
  crossings: Crossing[];
}

const EPS = 1e-6;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const len2 = (a: Vec2) => Math.sqrt(a.x * a.x + a.z * a.z);
const norm = (a: Vec2): Vec2 => { const l = len2(a) || 1; return { x: a.x / l, z: a.z / l }; };
const cross = (a: Vec2, b: Vec2) => a.x * b.z - a.z * b.x;
/** Right-hand normal of a travel direction (x east, z south, y up). */
const right = (d: Vec2): Vec2 => ({ x: -d.z, z: d.x });

/** Offset an open polyline to the right of travel by `off` (mitred joints). */
export function offsetRight(points: Vec2[], off: number): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const dIn = i > 0 ? norm(sub(p, points[i - 1]!)) : null;
    const dOut = i < n - 1 ? norm(sub(points[i + 1]!, p)) : null;
    const nIn = dIn ? right(dIn) : null, nOut = dOut ? right(dOut) : null;
    let m: Vec2, scale = off;
    if (nIn && nOut) {
      m = norm({ x: nIn.x + nOut.x, z: nIn.z + nOut.z });
      scale = off / Math.max(0.35, m.x * nIn.x + m.z * nIn.z);
    } else m = (nIn ?? nOut)!;
    out.push({ x: p.x + m.x * scale, z: p.z + m.z * scale });
  }
  return out;
}

/** Sub-polyline between arc lengths a..b (open). */
export function slicePolyline(poly: Polyline, a: number, b: number): Polyline {
  const pts: Vec2[] = [];
  const pa = pointAt(poly, a);
  pts.push({ x: pa.x, z: pa.z });
  for (let i = 0; i < poly.points.length; i++) {
    const c = poly.cum[i]!;
    if (c > a + EPS && c < b - EPS) pts.push({ x: poly.points[i]!.x, z: poly.points[i]!.z });
  }
  const pb = pointAt(poly, b);
  pts.push({ x: pb.x, z: pb.z });
  return polyline(pts, false);
}

function endDir(poly: Polyline, atEnd: boolean): Vec2 {
  const p = poly.points;
  return atEnd ? norm(sub(p[p.length - 1]!, p[p.length - 2]!)) : norm(sub(p[1]!, p[0]!));
}

function connectorPoly(from: Lane, to: Lane): { poly: Polyline; turn: Turn } {
  const P0 = from.poly.points[from.poly.points.length - 1]!;
  const P2 = to.poly.points[0]!;
  const d0 = endDir(from.poly, true), d2 = endDir(to.poly, false);
  const c = cross(d0, d2);
  const turn: Turn = c > 0.3 ? 'right' : c < -0.3 ? 'left' : 'straight';
  if (len2(sub(P2, P0)) < 1e-3) return { poly: polyline([P0, { x: P0.x + 1e-4 * d0.x, z: P0.z + 1e-4 * d0.z }], false), turn };
  let C: Vec2 = { x: (P0.x + P2.x) / 2, z: (P0.z + P2.z) / 2 };
  if (Math.abs(c) > 0.05) {
    const a = cross(sub(P2, P0), d2) / c;
    if (a > 0.05 && a < 8) C = { x: P0.x + d0.x * a, z: P0.z + d0.z * a };
  }
  const pts: Vec2[] = [];
  for (let k = 0; k <= CONNECTOR_SEGS; k++) {
    const t = k / CONNECTOR_SEGS, u = 1 - t;
    pts.push({ x: u * u * P0.x + 2 * u * t * C.x + t * t * P2.x, z: u * u * P0.z + 2 * u * t * C.z + t * t * P2.z });
  }
  return { poly: polyline(pts, false), turn };
}

function minPointDist(a: Polyline, b: Polyline): number {
  let best = Infinity;
  for (const p of a.points) for (const q of b.points) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
  return best;
}

function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { t: number; u: number } | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

function crossingsOf(lane: Lane, rail: Polyline): Crossing[] {
  const out: Crossing[] = [];
  const lp = lane.poly.points, rp = rail.points;
  const rn = rp.length;
  for (let i = 0; i + 1 < lp.length; i++) {
    for (let j = 0; j < (rail.closed ? rn : rn - 1); j++) {
      const a = rp[j]!, b = rp[(j + 1) % rn]!;
      const hit = segIntersect(lp[i]!, lp[i + 1]!, a, b);
      if (!hit) continue;
      const s = lane.poly.cum[i]! + hit.t * Math.hypot(lp[i + 1]!.x - lp[i]!.x, lp[i + 1]!.z - lp[i]!.z);
      const railDist = rail.cum[j]! + hit.u * Math.hypot(b.x - a.x, b.z - a.z);
      if (!out.some((x) => Math.abs(x.s - s) < 0.5)) out.push({ lane, s, railDist });
    }
  }
  return out;
}

const graphs = new WeakMap<TownMap, LaneGraph>();

/** Build (and cache per map) the lane graph. */
export function buildLaneGraph(map: TownMap): LaneGraph {
  const hit = graphs.get(map);
  if (hit) return hit;
  const b = map.bounds;
  const degree = new Map<string, number>();
  for (const e of map.roads.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const nodes = new Map<string, LaneNode>();
  for (const n of map.roads.nodes) {
    const deg = degree.get(n.id) ?? 0;
    const onEdge = n.p.x <= b.minX + 0.75 || n.p.x >= b.maxX - 0.75 || n.p.z <= b.minZ + 0.75 || n.p.z >= b.maxZ - 0.75;
    nodes.set(n.id, { id: n.id, p: n.p, degree: deg, exit: deg === 1 && onEdge, junction: deg >= 3 });
  }

  const lanes: Lane[] = [];
  for (const e of map.roads.edges) {
    if (e.path.points.length < 2 || e.path.length < 0.5) continue;
    for (const forward of [true, false]) {
      const from = forward ? e.a : e.b, to = forward ? e.b : e.a;
      const centrePts = forward ? e.path.points : [...e.path.points].reverse();
      const centre = polyline(centrePts, false);
      const off = polyline(offsetRight(centre.points, LANE_OFFSET), false);
      const maxTrim = Math.max(0, (centre.length - 0.6) / 2);
      const t0 = nodes.get(from)!.junction ? Math.min(JUNCTION_TRIM, maxTrim) : 0;
      const t1 = nodes.get(to)!.junction ? Math.min(JUNCTION_TRIM, maxTrim) : 0;
      // Edge ends are straight, so trimming the offset lane by the same distance matches the centreline.
      const poly = t0 > 0 || t1 > 0 ? slicePolyline(off, t0, off.length - t1) : off;
      lanes.push({
        id: `${e.id}:${forward ? 'f' : 'r'}`, edgeId: e.id, forward, from, to, poly, len: poly.length, centre, trimStart: t0,
        entry: nodes.get(from)!.exit, exit: nodes.get(to)!.exit,
      });
    }
  }
  const laneById = new Map(lanes.map((l) => [l.id, l] as const));

  const out = new Map<string, Connector[]>(lanes.map((l) => [l.id, []]));
  const into = new Map<string, Connector[]>(lanes.map((l) => [l.id, []]));
  const connectors: Connector[] = [];
  for (const a of lanes) {
    if (a.exit) continue;
    for (const c of lanes) {
      if (c.from !== a.to || c.edgeId === a.edgeId) continue;
      const { poly, turn } = connectorPoly(a, c);
      const conn: Connector = { id: `${a.id}>${c.id}`, node: a.to, from: a, to: c, poly, len: poly.length, turn, conflicts: new Set() };
      connectors.push(conn);
      out.get(a.id)!.push(conn);
      into.get(c.id)!.push(conn);
    }
  }
  const byNode = new Map<string, Connector[]>();
  for (const c of connectors) (byNode.get(c.node) ?? byNode.set(c.node, []).get(c.node)!).push(c);
  for (const list of byNode.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const p = list[i]!, q = list[j]!;
      if (p.from === q.from || p.to === q.to || minPointDist(p.poly, q.poly) < CONFLICT_DIST) {
        p.conflicts.add(q.id);
        q.conflicts.add(p.id);
      }
    }
  }

  const crossings = lanes.flatMap((l) => crossingsOf(l, map.rail.loop));
  const g: LaneGraph = { map, nodes, lanes, laneById, out, into, connectors, entries: lanes.filter((l) => l.entry), crossings };
  graphs.set(map, g);
  return g;
}
