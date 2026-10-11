// Owner: Task M. Polyline helpers shared by the sim, the renderer and the map tools.
//
// Conventions
// - A closed polyline does NOT repeat its first point: the closing segment runs from the last point back to
//   points[0], and `length` includes it. `cum[i]` is the arc length at points[i] (cum[0] = 0).
// - Positions use only + − × ÷ and Math.sqrt (deterministic across JS engines). `heading` uses Math.atan2 and is
//   for viewers only: `object.rotation.y = heading` turns a model whose forward axis is local +x (the kit's
//   vehicles) to face the direction of travel, i.e. heading = atan2(−dz, dx).
import type { Polyline, Vec2 } from '../contracts';

const EPS = 1e-9;

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

export function polyline(points: Vec2[], closed: boolean): Polyline {
  const pts: Vec2[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || distance(last, p) > EPS) pts.push({ x: p.x, z: p.z });
  }
  if (closed && pts.length > 1 && distance(pts[0]!, pts[pts.length - 1]!) <= EPS) pts.pop();
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += distance(pts[i - 1]!, pts[i]!);
    cum.push(acc);
  }
  const length = closed && pts.length > 1 ? acc + distance(pts[pts.length - 1]!, pts[0]!) : acc;
  return { points: pts, cum, length, closed };
}

/** Segment index i such that the point at arc length d lies on points[i] → points[i+1] (or the closing segment). */
function segmentAt(poly: Polyline, d: number): number {
  const { cum } = poly;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Point and viewer heading at arc length `dist`. Closed polylines wrap; open ones clamp to their ends. */
export function pointAt(poly: Polyline, dist: number): { x: number; z: number; heading: number } {
  const pts = poly.points;
  const n = pts.length;
  if (n === 0) return { x: 0, z: 0, heading: 0 };
  if (n === 1 || poly.length <= EPS) return { x: pts[0]!.x, z: pts[0]!.z, heading: 0 };
  const L = poly.length;
  let d = dist;
  if (poly.closed) {
    d = d % L;
    if (d < 0) d += L;
  } else {
    d = d < 0 ? 0 : d > L ? L : d;
  }
  let i = segmentAt(poly, d);
  if (!poly.closed && i >= n - 1) i = n - 2;
  const a = pts[i]!;
  const b = pts[(i + 1) % n]!;
  const segLen = (i + 1 < n ? poly.cum[i + 1]! : L) - poly.cum[i]!;
  const t = segLen > EPS ? Math.min(1, Math.max(0, (d - poly.cum[i]!) / segLen)) : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(-(b.z - a.z), b.x - a.x) };
}

/** Closest point on the polyline to p: its arc length, position and Euclidean distance from p. Ties → smallest arc length. */
export function projectOnPolyline(poly: Polyline, p: Vec2): { dist: number; x: number; z: number; d: number } {
  const pts = poly.points;
  const n = pts.length;
  if (n === 0) return { dist: 0, x: p.x, z: p.z, d: 0 };
  let best = { dist: 0, x: pts[0]!.x, z: pts[0]!.z, d: distance(pts[0]!, p) };
  const segs = poly.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    const d = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);
    if (d < best.d - EPS) best = { dist: poly.cum[i]! + Math.sqrt(len2) * t, x, z, d };
  }
  if (poly.closed && best.dist >= poly.length) best.dist = 0;
  return best;
}

/** Arc length along `poly` of the point closest to `p` (e.g. a stop's distance along a route). */
export function nearestDist(poly: Polyline, p: Vec2): number {
  return projectOnPolyline(poly, p).dist;
}

/**
 * Fillets every corner with a quadratic Bézier whose tangent points sit where a circular arc of `radius` would
 * touch (tangent length r·tan(θ/2), capped at half of each adjacent segment). Collinear points and U-turns are kept
 * as they are. Open polylines keep their end points. Uses only arithmetic and Math.sqrt (deterministic).
 */
export function roundCorners(points: Vec2[], radius: number, closed: boolean, segments = 6): Vec2[] {
  const pts = polyline(points, closed).points;
  const n = pts.length;
  if (n < 3 || radius <= 0) return pts.map((p) => ({ x: p.x, z: p.z }));
  const out: Vec2[] = [];
  const segs = Math.max(1, Math.floor(segments));
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!hasPrev || !hasNext) {
      out.push({ x: p.x, z: p.z });
      continue;
    }
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[(i + 1) % n]!;
    const d1 = distance(a, p);
    const d2 = distance(p, b);
    const ux = (p.x - a.x) / d1, uz = (p.z - a.z) / d1; // incoming direction
    const vx = (b.x - p.x) / d2, vz = (b.z - p.z) / d2; // outgoing direction
    const cross = Math.abs(ux * vz - uz * vx);
    const dot = ux * vx + uz * vz;
    if (cross < 1e-6 || dot < -0.999) {
      out.push({ x: p.x, z: p.z });
      continue;
    }
    const tanHalf = cross / (1 + dot);
    const t = Math.min(radius * tanHalf, d1 / 2, d2 / 2);
    const t1 = { x: p.x - ux * t, z: p.z - uz * t };
    const t2 = { x: p.x + vx * t, z: p.z + vz * t };
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const w0 = (1 - s) * (1 - s), w1 = 2 * (1 - s) * s, w2 = s * s;
      out.push({ x: w0 * t1.x + w1 * p.x + w2 * t2.x, z: w0 * t1.z + w1 * p.z + w2 * t2.z });
    }
  }
  return polyline(out, closed).points;
}
