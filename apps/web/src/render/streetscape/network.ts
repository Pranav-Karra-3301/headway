// Owner: S1. Road-network analysis for the streetscape: junction arms, rounded curb corners, the road field
// (signed distance from the curb: < 0 on the carriageway), the rail field, zebra crossings near stops and
// bus-stop bays.
import { pointAt, projectOnPolyline } from '@headway/sim';
import type { RoadEdge, Stop, TownMap, Vec2 } from '@headway/sim';
import { type Grid, polyDist, stampPolyline, windowOf } from './field';

export interface Arm { edge: RoadEdge; node: string; at: 'a' | 'b'; u: Vec2; ang: number }
/** Rounded curb corner between two arms of a junction: fillet circle centre `o`; ni / nj are the arms' unit
 *  normals pointing into the corner wedge. */
export interface Corner { node: string; n: Vec2; ni: Vec2; nj: Vec2; o: Vec2 }
/** A zebra crossing: centre on the road centreline, `u` = road direction leaving the junction. */
export interface Crossing { node: string; edge: string; x: number; z: number; ux: number; uz: number }
/** A painted bus-stop bay along the kerb: centre, `u` along the road, `n` from the centreline toward the stop. */
export interface Bay { stop: string; x: number; z: number; u: Vec2; n: Vec2; len: number; wid: number }

const unit = (a: Vec2, b: Vec2): Vec2 => {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  return { x: dx / L, z: dz / L };
};

export function armsByNode(map: TownMap): Map<string, Arm[]> {
  const out = new Map<string, Arm[]>();
  const add = (arm: Arm) => {
    const list = out.get(arm.node);
    if (list) list.push(arm); else out.set(arm.node, [arm]);
  };
  for (const e of map.roads.edges) {
    const pts = e.path.points;
    if (pts.length < 2) continue;
    const ua = unit(pts[0]!, pts[1]!), ub = unit(pts[pts.length - 1]!, pts[pts.length - 2]!);
    add({ edge: e, node: e.a, at: 'a', u: ua, ang: Math.atan2(ua.z, ua.x) });
    add({ edge: e, node: e.b, at: 'b', u: ub, ang: Math.atan2(ub.z, ub.x) });
  }
  for (const list of out.values()) list.sort((p, q) => p.ang - q.ang);
  return out;
}

/** Fillet corners at every junction wedge narrower than a straight line. */
export function cornersOf(map: TownMap, arms: Map<string, Arm[]>, h: number, rc: number): Corner[] {
  const pos = new Map(map.roads.nodes.map((n) => [n.id, n.p] as const));
  const out: Corner[] = [];
  for (const [node, list] of arms) {
    const p = pos.get(node);
    if (!p || list.length < 2) continue;
    for (let k = 0; k < list.length; k++) {
      const A = list[k]!, B = list[(k + 1) % list.length]!;
      let d = B.ang - A.ang;
      if (d <= 0) d += Math.PI * 2;
      if (d >= Math.PI - 0.05 || d < 0.2) continue;
      const ni = perpToward(A.u, B.u), nj = perpToward(B.u, A.u);
      // Fillet centre O: (O − p)·ni = h + rc and (O − p)·nj = h + rc.
      const r = h + rc, det = ni.x * nj.z - ni.z * nj.x;
      if (Math.abs(det) < 1e-6) continue;
      const ox = (r * nj.z - ni.z * r) / det, oz = (ni.x * r - r * nj.x) / det;
      out.push({ node, n: p, ni, nj, o: { x: p.x + ox, z: p.z + oz } });
    }
  }
  return out;
}

/** Unit component of `v` perpendicular to `u` (the normal of arm u pointing toward arm v). */
function perpToward(u: Vec2, v: Vec2): Vec2 {
  const k = v.x * u.x + v.z * u.z;
  return unit({ x: 0, z: 0 }, { x: v.x - k * u.x, z: v.z - k * u.z });
}

/** Rounded-corner override for one point: inside the corner zone the curb follows the fillet circle. */
export function cornerS(c: Corner, h: number, rc: number, x: number, z: number, s: number): number {
  const rx = x - c.n.x, rz = z - c.n.z;
  const a = rx * c.ni.x + rz * c.ni.z - h, b = rx * c.nj.x + rz * c.nj.z - h;
  if (a <= -h || b <= -h || a >= rc || b >= rc) return s;
  const f = rc - Math.hypot(x - c.o.x, z - c.o.z);
  return f < s ? f : s;
}

/** Road field at a point: distance from the curb line (< 0 on the carriageway), with rounded corners. */
export function roadS(map: TownMap, corners: Corner[], h: number, rc: number, p: Vec2): number {
  let d = Infinity;
  for (const e of map.roads.edges) d = Math.min(d, polyDist(p, e.path.points, false));
  let s = d - h;
  for (const c of corners) s = cornerS(c, h, rc, p.x, p.z, s);
  return s;
}

/** Fill a grid with the road field (samples farther than `reach` from every road keep `reach − h`). */
export function stampRoads(g: Grid, f: Float32Array, map: TownMap, corners: Corner[], h: number, rc: number, reach: number): void {
  f.fill(reach - h);
  for (const e of map.roads.edges) stampPolyline(g, f, e.path.points, false, reach, -h);
  for (const c of corners) {
    const [i0, j0, i1, j1] = windowOf(g, Math.min(c.n.x, c.o.x), Math.min(c.n.z, c.o.z), Math.max(c.n.x, c.o.x), Math.max(c.n.z, c.o.z), h + rc + 0.2);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * g.nx + i;
        f[k] = cornerS(c, h, rc, g.x0 + i * g.c, g.z0 + j * g.c, f[k]!);
      }
    }
  }
}

/** f = min(f, zone) where zone < 0 inside a corner's fillet square (from the curb lines out to the fillet centre). */
export function stampCornerZones(g: Grid, f: Float32Array, corners: Corner[], h: number, rc: number): void {
  for (const c of corners) {
    const [i0, j0, i1, j1] = windowOf(g, Math.min(c.n.x, c.o.x), Math.min(c.n.z, c.o.z), Math.max(c.n.x, c.o.x), Math.max(c.n.z, c.o.z), h + rc + 0.2);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const rx = g.x0 + i * g.c - c.n.x, rz = g.z0 + j * g.c - c.n.z;
        const a = rx * c.ni.x + rz * c.ni.z - h, b = rx * c.nj.x + rz * c.nj.z - h;
        const v = Math.max(a - rc, b - rc, -0.1 - a, -0.1 - b);
        const k = j * g.nx + i;
        if (v < f[k]!) f[k] = v;
      }
    }
  }
}

/** Junction nodes (degree ≥ 3). */
export function junctions(arms: Map<string, Arm[]>): string[] {
  return [...arms.entries()].filter(([, l]) => l.length >= 3).map(([id]) => id);
}

/**
 * Zebra crossings on every arm of the junctions near stops: each junction within `near` of a stop, plus the
 * nearest junction (within `far`) for stops with none that close. Crossings sit `from` along each arm.
 */
export function crossingsNearStops(map: TownMap, arms: Map<string, Arm[]>, o: { near: number; far: number; from: number }): Crossing[] {
  const pos = new Map(map.roads.nodes.map((n) => [n.id, n.p] as const));
  const js = junctions(arms).filter((id) => pos.has(id));
  const pick = new Set<string>();
  for (const s of map.stops) {
    const d = js.map((id) => ({ id, d: Math.hypot(pos.get(id)!.x - s.p.x, pos.get(id)!.z - s.p.z) })).sort((a, b) => a.d - b.d);
    const close = d.filter((x) => x.d <= o.near);
    if (close.length) close.forEach((x) => pick.add(x.id));
    else if (d[0] && d[0].d <= o.far) pick.add(d[0].id);
  }
  const out: Crossing[] = [];
  for (const id of [...pick].sort()) {
    for (const arm of arms.get(id) ?? []) {
      const path = arm.edge.path;
      if (path.length < 2 * o.from + 1) continue;
      const t = arm.at === 'a' ? o.from : path.length - o.from;
      const t2 = arm.at === 'a' ? t + 0.05 : t - 0.05;
      const p = pointAt(path, t), q = pointAt(path, t2);
      const u = unit(p, q);
      out.push({ node: id, edge: arm.edge.id, x: p.x, z: p.z, ux: u.x, uz: u.z });
    }
  }
  return out;
}

/** A bay painted on the carriageway beside every stop (kerb side, centred on the stop's road point). */
export function stopBays(map: TownMap, h: number, len: number, wid: number): Bay[] {
  return map.stops.map((s: Stop) => {
    let road = s.p, best = Infinity;
    for (const e of map.roads.edges) {
      const q = projectOnPolyline(e.path, s.p);
      if (q.d < best) { best = q.d; road = { x: q.x, z: q.z }; }
    }
    const L = Math.hypot(s.p.x - road.x, s.p.z - road.z);
    const n = L > 1e-6 ? { x: (s.p.x - road.x) / L, z: (s.p.z - road.z) / L } : s.queueDir;
    const off = h - wid / 2 - 0.06;
    return { stop: s.id, x: road.x + n.x * off, z: road.z + n.z * off, u: { x: -n.z, z: n.x }, n, len, wid };
  });
}

/** Oriented-rectangle overlap (separating axes). Rect: centre, unit axis u, half extents along u and its normal. */
export function rectsOverlap(
  a: { x: number; z: number; u: Vec2; hu: number; hv: number },
  b: { x: number; z: number; u: Vec2; hu: number; hv: number },
): boolean {
  const axes = [a.u, { x: -a.u.z, z: a.u.x }, b.u, { x: -b.u.z, z: b.u.x }];
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const ax of axes) {
    const proj = (r: typeof a) => {
      const v = { x: -r.u.z, z: r.u.x };
      return Math.abs(r.u.x * ax.x + r.u.z * ax.z) * r.hu + Math.abs(v.x * ax.x + v.z * ax.z) * r.hv;
    };
    if (Math.abs(dx * ax.x + dz * ax.z) > proj(a) + proj(b)) return false;
  }
  return true;
}
