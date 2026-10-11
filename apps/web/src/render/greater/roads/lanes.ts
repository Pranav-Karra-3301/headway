// Owner: G0. Lanes, ports and street centrelines from the rasterised plan (pure data).
//  - edges: road between two nodes (junction, roundabout, dead end) or a port, traced cell by cell through straights,
//    1×1 bends (r = 2 u), 2×2 curves (r = 6 u) and the east-exit S-bend; one lane per direction, KERB.lane to the right.
//  - junctions: a turn lane from every arm to every other arm (cubic, no U-turns); dead ends: a U-turn loop.
//  - roundabouts: anticlockwise seen from above (right-hand traffic). Per arm k: `in` (arm → merge point), `out`
//    (diverge point → arm), and circle arcs `ring` (merge k → diverge k+1) and `pass` (diverge k → merge k).
import { polyline } from '@headway/sim';
import type { Polyline, Vec2 } from '@headway/sim';
import { linkLanes, type Lane, type LaneKind, type Port, type RoadClass, type Street } from '../grid';
import { DIR_VEC, HIGHWAY_ROWS, KERB, OPPOSITE, STEP, cellCenter, cellRect, inGrid, inRect, rightOf, sideMid, type Dir, type GridFrame } from './cells';
import { ROUNDABOUT, dirsOf, type Network, type Piece } from './plan';

export const LANE_SPEED: Readonly<Record<LaneKind, number>> = {
  ring: 6, parkway: 6, avenue: 5, radial: 5, local: 4, junction: 3.5, roundabout: 3.2, uturn: 2, highway: 9, ramp: 5,
};
/** Merge / diverge angle from an arm's axis on the circulating lane. */
const RB_BETA = (32 * Math.PI) / 180;

type End =
  | { kind: 'node'; id: string; c: number; r: number; side: Dir }
  | { kind: 'port'; port: Port['kind']; p: Vec2; dir: Vec2 };
interface Edge { id: string; street: string; cls: RoadClass; pts: Vec2[]; a: End; b: End }

const add = (a: Vec2, b: Vec2, s = 1): Vec2 => ({ x: a.x + b.x * s, z: a.z + b.z * s });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
const len = (a: Vec2): number => Math.hypot(a.x, a.z);
const neg = (a: Vec2): Vec2 => ({ x: -a.x, z: -a.z });

/** Points on a circle from `from` to `to` (both on it) the short way; excludes `from`, includes `to`. */
function arc(center: Vec2, from: Vec2, to: Vec2, segs: number): Vec2[] {
  const a0 = Math.atan2(from.z - center.z, from.x - center.x);
  let da = Math.atan2(to.z - center.z, to.x - center.x) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const R = len(sub(from, center));
  const out: Vec2[] = [];
  for (let i = 1; i < segs; i++) {
    const a = a0 + (da * i) / segs;
    out.push({ x: center.x + Math.cos(a) * R, z: center.z + Math.sin(a) * R });
  }
  out.push({ x: to.x, z: to.z });
  return out;
}

/** Cubic Bézier from p0 (heading d0) to p3 (heading d3), handles `h`; includes both ends. */
function bezier(p0: Vec2, d0: Vec2, p3: Vec2, d3: Vec2, h: number, segs = 8): Vec2[] {
  const p1 = add(p0, d0, h), p2 = add(p3, d3, -h);
  const out: Vec2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
  }
  return out;
}

/** Drop points that lie on the straight line between their neighbours. */
function simplify(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (out.length && len(sub(p, out[out.length - 1]!)) < 1e-6) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2]!, b = out[out.length - 1]!;
      const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
      const dot = (b.x - a.x) * (p.x - b.x) + (b.z - a.z) * (p.z - b.z);
      if (Math.abs(cross) < 1e-6 && dot > 0) out.pop(); else break;
    }
    out.push(p);
  }
  return out;
}

/** Offset an open polyline to the right of its direction by d (mitred). Optional exact end directions (tangents)
 *  keep lane ends on the junction boundaries when the polyline starts/ends with an arc chord. */
export function offsetRight(pts: readonly Vec2[], d: number, startDir?: Vec2, endDir?: Vec2): Vec2[] {
  const n = pts.length;
  const segDir = (i: number): Vec2 => {
    const v = sub(pts[i + 1]!, pts[i]!), L = len(v) || 1;
    return { x: v.x / L, z: v.z / L };
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 && startDir) { out.push(add(pts[0]!, rightOf(startDir), d)); continue; }
    if (i === n - 1 && endDir) { out.push(add(pts[n - 1]!, rightOf(endDir), d)); continue; }
    const r0 = rightOf(segDir(Math.max(0, i - 1))), r1 = rightOf(segDir(Math.min(n - 2, i)));
    let m = { x: r0.x + r1.x, z: r0.z + r1.z };
    const L = len(m) || 1;
    m = { x: m.x / L, z: m.z / L };
    const s = 1 / Math.max(0.4, m.x * r1.x + m.z * r1.z);
    out.push(add(pts[i]!, m, d * s));
  }
  return out;
}

function cornerPoint(g: GridFrame, p: Piece): Vec2 {
  const R = cellRect(g, p.cells.c, p.cells.r, p.cells.w, p.cells.h);
  const k = p.corner!;
  return { x: k[1] === 'w' ? R.minX : R.maxX, z: k[0] === 'n' ? R.minZ : R.maxZ };
}

export function buildLanes(g: GridFrame, net: Network): { lanes: Lane[]; ports: Port[]; streets: Street[] } {
  const { cols } = g;
  const at = (c: number, r: number) => r * cols + c;
  const pieceOf = (c: number, r: number): Piece | null => {
    const i = net.pieceAt[at(c, r)]!;
    return i >= 0 ? net.pieces[i]! : null;
  };
  const degree = (c: number, r: number) => dirsOf(net.links[at(c, r)]!).length;
  const isNodeCell = (c: number, r: number) => {
    if (pieceOf(c, r)) return pieceOf(c, r)!.kind === 'roundabout';
    const d = degree(c, r);
    return d === 1 || d >= 3;
  };
  const nodeId = (c: number, r: number): string => pieceOf(c, r)?.id ?? `j${c}-${r}`;
  const clsOf = (street: string): RoadClass => net.streetClass.get(street) ?? 'local';

  // ---- trace edges
  const visited = new Set<string>();
  const vkey = (c: number, r: number, d: Dir) => `${c},${r},${d}`;
  const edges: Edge[] = [];

  const trace = (sc: number, sr: number, side: Dir, startStreet: string): Edge => {
    const start: End = { kind: 'node', id: nodeId(sc, sr), c: sc, r: sr, side };
    const pts: Vec2[] = [sideMid(g, sc, sr, side)];
    let street = '';
    let c = sc + STEP[side].dc, r = sr + STEP[side].dr, enter: Dir = OPPOSITE[side];
    let end: End | null = null;
    for (let guard = 0; guard < 4096 && !end; guard++) {
      const last = pts[pts.length - 1]!;
      const outward = DIR_VEC[OPPOSITE[enter]];
      if (!inGrid(g, c, r)) { end = { kind: 'port', port: 'edge', p: last, dir: outward }; break; }
      if (inRect(g.board, c, r)) { end = { kind: 'port', port: 'board', p: last, dir: outward }; break; }
      if (r < HIGHWAY_ROWS) { end = { kind: 'port', port: 'highway', p: last, dir: outward }; break; }
      const pc = pieceOf(c, r);
      if (pc?.kind === 'roundabout' || (!pc && isNodeCell(c, r))) {
        end = { kind: 'node', id: nodeId(c, r), c, r, side: enter };
        break;
      }
      if (pc?.kind === 'curve') {
        if (!street) street = pc.street;
        const other = pc.arms.find((a) => !(a.c === c && a.r === r && a.side === enter))!;
        const to = sideMid(g, other.c, other.r, other.side);
        pts.push(...arc(cornerPoint(g, pc), last, to, 10));
        c = other.c + STEP[other.side].dc; r = other.r + STEP[other.side].dr; enter = OPPOSITE[other.side];
        continue;
      }
      if (pc?.kind === 'connector') {
        if (!street) street = pc.street;
        const from = last, to = pc.board!.p, segs = 10;
        for (let i = 1; i <= segs; i++) {
          const t = i / segs, s = t * t * (3 - 2 * t);
          const along = DIR_VEC[pc.board!.side];
          const axial = along.x !== 0 ? { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * s } : { x: from.x + (to.x - from.x) * s, z: from.z + (to.z - from.z) * t };
          pts.push(axial);
        }
        end = { kind: 'port', port: 'board', p: { x: to.x, z: to.z }, dir: DIR_VEC[pc.board!.side] };
        break;
      }
      // plain 2-link cell
      if (!street) street = net.streetAt[at(c, r)] ?? '';
      const exits = dirsOf(net.links[at(c, r)]!).filter((d) => d !== enter);
      const exit = exits[0]!;
      const to = sideMid(g, c, r, exit);
      if (exit === OPPOSITE[enter]) pts.push(to);
      else {
        const ctr = cellCenter(g, c, r), h = g.tile / 2;
        const corner = add(add(ctr, DIR_VEC[enter], h), DIR_VEC[exit], h);
        pts.push(...arc(corner, last, to, 6));
      }
      c += STEP[exit].dc; r += STEP[exit].dr; enter = OPPOSITE[exit];
    }
    if (!end) throw new Error('greater grid: runaway edge trace');
    if (end.kind === 'node') visited.add(vkey(end.c, end.r, end.side));
    if (!street) street = startStreet;
    return { id: `e${edges.length}`, street, cls: clsOf(street), pts: simplify(pts), a: start, b: end };
  };

  interface NodeArm { c: number; r: number; side: Dir; street: string }
  const nodeArms: Array<{ id: string; kind: 'junction' | 'end' | 'roundabout'; arms: NodeArm[]; center: Vec2; piece?: Piece }> = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (pieceOf(c, r) || !net.links[at(c, r)]) continue;
    const ds = dirsOf(net.links[at(c, r)]!);
    if (ds.length === 2) continue;
    nodeArms.push({
      id: `j${c}-${r}`, kind: ds.length === 1 ? 'end' : 'junction', center: cellCenter(g, c, r),
      arms: ds.map((side) => ({ c, r, side, street: net.streetAt[at(c, r)] ?? '' })),
    });
  }
  for (const p of net.pieces) {
    if (p.kind !== 'roundabout') continue;
    nodeArms.push({ id: p.id, kind: 'roundabout', piece: p, center: cellCenter(g, p.cells.c + 1, p.cells.r + 1), arms: p.arms.map((a) => ({ ...a, street: p.street })) });
  }
  for (const n of nodeArms) {
    for (const a of n.arms) {
      const k = vkey(a.c, a.r, a.side);
      if (visited.has(k)) continue;
      visited.add(k);
      edges.push(trace(a.c, a.r, a.side, a.street));
    }
  }

  // ---- lanes
  const lanes: Lane[] = [];
  const mk = (id: string, kind: LaneKind, pts: Vec2[], extra: Partial<Lane> = {}): Lane => {
    const lane: Lane = { id, kind, path: polyline(pts, false), speed: LANE_SPEED[kind], next: [], ...extra };
    lanes.push(lane);
    return lane;
  };
  const ports: Port[] = [];
  const portOf = (e: Edge, end: End & { kind: 'port' }, inLane: string | null, outLane: string | null): void => {
    const d = end.dir;
    const side: Dir = Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? 'e' : 'w') : d.z > 0 ? 's' : 'n';
    let id = end.port === 'board' ? `board-${OPPOSITE[side]}` : `${end.port}-${side}`;
    if (ports.some((q) => q.id === id)) id += `-${ports.length}`;
    ports.push({ id, kind: end.port, side, p: end.p, dir: d, inLane, outLane, street: e.street });
  };
  const streetPaths = new Map<string, Polyline[]>();
  const rbLane = (rbId: string, io: 'in' | 'out', side: Dir) => `${rbId}:${io}-${side}`;

  for (const e of edges) {
    const L = e.pts.length >= 2 ? polyline(e.pts, false).length : 0;
    let fwd: Lane | null = null, bwd: Lane | null = null;
    if (L > 1e-6) {
      const a = e.a as End & { kind: 'node' };
      const d0 = DIR_VEC[a.side];
      const d1 = e.b.kind === 'node' ? neg(DIR_VEC[e.b.side]) : e.b.dir;
      fwd = mk(`${e.id}:f`, e.cls, offsetRight(e.pts, KERB.lane, d0, d1), { street: e.street });
      bwd = mk(`${e.id}:b`, e.cls, offsetRight([...e.pts].reverse(), KERB.lane, neg(d1), neg(d0)), { street: e.street });
      const arr = streetPaths.get(e.street) ?? [];
      arr.push(polyline(e.pts, false));
      streetPaths.set(e.street, arr);
    }
    if (e.b.kind === 'port') {
      // lanes at the far end: entering = backward lane, leaving = forward lane; zero-length → the node's own lanes
      const a = e.a as End & { kind: 'node' };
      const nodeIsRb = net.pieces.some((p) => p.id === a.id && p.kind === 'roundabout');
      const inL = bwd?.id ?? (nodeIsRb ? rbLane(a.id, 'in', a.side) : null);
      const outL = fwd?.id ?? (nodeIsRb ? rbLane(a.id, 'out', a.side) : null);
      portOf(e, e.b, inL, outL);
    }
  }

  // junction turns + dead-end U-turns
  for (const n of nodeArms) {
    if (n.kind === 'roundabout') continue;
    const c0 = n.arms[0]!.c, r0 = n.arms[0]!.r;
    const inEnd = (side: Dir) => add(sideMid(g, c0, r0, side), rightOf(neg(DIR_VEC[side])), KERB.lane);
    const outStart = (side: Dir) => add(sideMid(g, c0, r0, side), rightOf(DIR_VEC[side]), KERB.lane);
    if (n.kind === 'end') {
      const s = n.arms[0]!.side, inward = neg(DIR_VEC[s]);
      const p0 = inEnd(s), p3 = outStart(s);
      mk(`${n.id}:uturn`, 'uturn', bezier(p0, inward, p3, DIR_VEC[s], 2.2, 10));
      continue;
    }
    for (const ai of n.arms) for (const aj of n.arms) {
      if (ai.side === aj.side) continue;
      const p0 = inEnd(ai.side), p3 = outStart(aj.side);
      const d0 = neg(DIR_VEC[ai.side]), d3 = DIR_VEC[aj.side];
      const pts = aj.side === OPPOSITE[ai.side] ? [p0, p3] : bezier(p0, d0, p3, d3, 0.39 * len(sub(p3, p0)));
      mk(`${n.id}:${ai.side}>${aj.side}`, 'junction', pts);
    }
  }

  // roundabouts
  const ANG: Record<Dir, number> = { e: 0, s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2 };
  const NEXT: Record<Dir, Dir> = { e: 'n', n: 'w', w: 's', s: 'e' }; // anticlockwise seen from above
  for (const n of nodeArms) {
    if (n.kind !== 'roundabout') continue;
    const C = n.center, Rc = ROUNDABOUT.laneR, Ra = ROUNDABOUT.armR;
    const onCircle = (t: number): Vec2 => ({ x: C.x + Math.cos(t) * Rc, z: C.z + Math.sin(t) * Rc });
    const tangent = (t: number): Vec2 => ({ x: Math.sin(t), z: -Math.cos(t) });
    const arcDown = (t0: number, t1: number): Vec2[] => {
      const segs = Math.max(2, Math.ceil(((t0 - t1) * 180) / Math.PI / 8));
      const out: Vec2[] = [];
      for (let i = 0; i <= segs; i++) out.push(onCircle(t0 + ((t1 - t0) * i) / segs));
      return out;
    };
    for (const a of n.arms) {
      const s = a.side, v = DIR_VEC[s], phi = ANG[s];
      const pin = add(add(C, v, Ra), rightOf(neg(v)), KERB.lane);
      const pout = add(add(C, v, Ra), rightOf(v), KERB.lane);
      const te = phi - RB_BETA, tx = phi + RB_BETA;
      const qe = onCircle(te), qx = onCircle(tx);
      mk(rbLane(n.id, 'in', s), 'roundabout', bezier(pin, neg(v), qe, tangent(te), 0.39 * len(sub(qe, pin))), { yield: true });
      mk(rbLane(n.id, 'out', s), 'roundabout', bezier(qx, tangent(tx), pout, v, 0.39 * len(sub(pout, qx))));
      mk(`${n.id}:pass-${s}`, 'roundabout', arcDown(tx, te));
      const nx = ANG[NEXT[s]] + RB_BETA;
      let t1 = nx;
      while (t1 > te) t1 -= 2 * Math.PI;
      mk(`${n.id}:ring-${s}`, 'roundabout', arcDown(te, t1));
    }
  }

  linkLanes(lanes);
  const streets: Street[] = [...streetPaths.entries()].map(([name, paths]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name, cls: clsOf(name), paths,
  }));
  return { lanes, ports, streets };
}
