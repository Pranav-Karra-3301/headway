// Owner: C1 (camera study). Ray vs oriented-box occlusion: an orthographic camera sees a point iff the ray from the
// point toward the camera (+d) leaves the scene without entering an occluder box.
import type { V3 } from './views';

export type OccluderClass = 'building' | 'landmark' | 'tree' | 'station' | 'terrain' | 'vehicle';

/** A box standing upright, turned by `rot` about +y (three.js rotation.y): half extents hx/hz in its local frame. */
export interface Box {
  cx: number; cz: number; hx: number; hz: number;
  y0: number; y1: number;
  rot: number;
  cls: OccluderClass;
  kind: string;
}

/** Point in the box's local frame (inverse of rotation.y). */
function local(b: Box, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.cx, dz = z - b.cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function containsPoint(b: Box, p: V3, margin = 0.05): boolean {
  if (p.y < b.y0 - margin || p.y > b.y1 + margin) return false;
  const q = local(b, p.x, p.z);
  return Math.abs(q.x) <= b.hx + margin && Math.abs(q.z) <= b.hz + margin;
}

/** Entry distance t > 0 of the ray p + t·d into the box, or null (slab method in the box frame). */
export function rayBox(p: V3, d: V3, b: Box): number | null {
  const o = local(b, p.x, p.z);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dl = { x: d.x * c - d.z * s, y: d.y, z: d.x * s + d.z * c };
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o0: number, dd: number, lo: number, hi: number): boolean => {
    if (Math.abs(dd) < 1e-12) return o0 >= lo && o0 <= hi;
    let a = (lo - o0) / dd, z = (hi - o0) / dd;
    if (a > z) { const t = a; a = z; z = t; }
    if (a > t0) t0 = a;
    if (z < t1) t1 = z;
    return t0 <= t1;
  };
  if (!slab(o.x, dl.x, -b.hx, b.hx) || !slab(p.y, dl.y, b.y0, b.y1) || !slab(o.z, dl.z, -b.hz, b.hz)) return null;
  if (t1 <= 1e-9) return null;
  return t0 > 0 ? t0 : 0;
}

/** Nearest box the ray enters, skipping boxes that contain the point itself (a thing never hides itself). */
export function firstOccluder(p: V3, d: V3, boxes: readonly Box[], margin = 0.05): Box | null {
  let best: Box | null = null, bestT = Infinity;
  for (const b of boxes) {
    if (containsPoint(b, p, margin)) continue;
    const t = rayBox(p, d, b);
    if (t !== null && t < bestT) { bestT = t; best = b; }
  }
  return best;
}
