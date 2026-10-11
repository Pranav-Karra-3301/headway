// Owner: A4. Rounded-rectangle "bowl" lofts: a 2D profile (inward offset d, height y) swept around a rounded
// rectangle whose half sizes shrink with d. Used for the stadium facade, parapet, stepped seating tiers and
// field wall. Strips have crisp edges across the profile and smooth shading around the curve.
import * as THREE from 'three';

export interface RRect { a: number; b: number; r: number }

/** Outer rounded rectangle (half sizes a × b, corner radius r) and how it shrinks with the inward offset d. */
export interface Bowl { a: number; b: number; r: number; fx: number; fz: number; fr: number; rMin: number; seg: number }

export function rrAt(bowl: Bowl, d: number): RRect {
  const a = bowl.a - d * bowl.fx, b = bowl.b - d * bowl.fz;
  const r = Math.max(bowl.rMin, Math.min(bowl.r - d * bowl.fr, a - 1e-3, b - 1e-3));
  return { a, b, r };
}

export interface RingPoint { x: number; z: number; nx: number; nz: number }

const CORNERS: Array<[number, number, number]> = [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]];

/** seg + 1 points per corner arc, corners in order (+,+) (-,+) (-,-) (+,-); straight edges join consecutive corners. */
export function ringPoints(rr: RRect, seg: number): RingPoint[] {
  const out: RingPoint[] = [];
  for (const [sx, sz, t0] of CORNERS) {
    const cx = sx * (rr.a - rr.r), cz = sz * (rr.b - rr.r);
    for (let i = 0; i <= seg; i++) {
      const t = t0 + (i / seg) * (Math.PI / 2);
      const nx = Math.cos(t), nz = Math.sin(t);
      out.push({ x: cx + rr.r * nx, z: cz + rr.r * nz, nx, nz });
    }
  }
  return out;
}

/** Point + outward normal at fraction u ∈ [0, 1) of the perimeter (arc length), same start/order as ringPoints. */
export function perimeterAt(rr: RRect, u: number): RingPoint {
  const sa = 2 * (rr.a - rr.r), sb = 2 * (rr.b - rr.r), arc = (Math.PI / 2) * rr.r;
  // segments: arc(+,+), edge +z (len sa), arc(-,+), edge -x (sb), arc(-,-), edge -z (sa), arc(+,-), edge +x (sb)
  const lens = [arc, sa, arc, sb, arc, sa, arc, sb];
  const total = lens.reduce((s, v) => s + v, 0);
  let t = (((u % 1) + 1) % 1) * total;
  for (let i = 0; i < 8; i++) {
    const L = lens[i]!;
    if (t <= L || i === 7) {
      const f = L > 0 ? Math.min(1, t / L) : 0;
      const c = Math.floor(i / 2);
      const [sx, sz, t0] = CORNERS[c]!;
      const cx = sx * (rr.a - rr.r), cz = sz * (rr.b - rr.r);
      if (i % 2 === 0) {
        const ang = t0 + f * (Math.PI / 2);
        const nx = Math.cos(ang), nz = Math.sin(ang);
        return { x: cx + rr.r * nx, z: cz + rr.r * nz, nx, nz };
      }
      const [nsx, nsz] = CORNERS[(c + 1) % 4]!;
      const ncx = nsx * (rr.a - rr.r), ncz = nsz * (rr.b - rr.r);
      const end = t0 + Math.PI / 2;
      const nx = Math.round(Math.cos(end)), nz = Math.round(Math.sin(end));
      const x0 = cx + rr.r * nx, z0 = cz + rr.r * nz, x1 = ncx + rr.r * nx, z1 = ncz + rr.r * nz;
      return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, nx, nz };
    }
    t -= L;
  }
  return { x: rr.a, z: 0, nx: 1, nz: 0 };
}

export function perimeterLength(rr: RRect): number {
  return 4 * (rr.a - rr.r) + 4 * (rr.b - rr.r) + 2 * Math.PI * rr.r;
}

/**
 * One indexed geometry for a profile polyline [d, y][] swept around the bowl. Every profile segment is its own
 * strip (crisp edge between steps); normals are analytic (profile normal rotated by the ring normal).
 */
export function loftGeometry(bowl: Bowl, profile: Array<[number, number]>): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), an = new THREE.Vector3();
  for (let s = 0; s + 1 < profile.length; s++) {
    const [d0, y0] = profile[s]!, [d1, y1] = profile[s + 1]!;
    let no = y1 - y0, nu = d1 - d0;
    const L = Math.hypot(no, nu);
    if (L < 1e-6) continue;
    no /= L; nu /= L;
    const r0 = ringPoints(rrAt(bowl, d0), bowl.seg), r1 = ringPoints(rrAt(bowl, d1), bowl.seg);
    const n = r0.length, base = pos.length / 3;
    for (const [ring, y] of [[r0, y0], [r1, y1]] as const) {
      for (const p of ring) { pos.push(p.x, y, p.z); nor.push(no * p.nx, nu, no * p.nz); uv.push(0, 0); }
    }
    // Winding: compare the geometric normal of a corner quad with the analytic one.
    const q = Math.floor(bowl.seg / 2);
    const P = (i: number) => new THREE.Vector3(pos[(base + i) * 3]!, pos[(base + i) * 3 + 1]!, pos[(base + i) * 3 + 2]!);
    e1.subVectors(P(q + 1), P(q));
    e2.subVectors(P(n + q + 1), P(q));
    fn.crossVectors(e1, e2);
    an.set(no * r0[q]!.nx, nu, no * r0[q]!.nz);
    const flip = fn.dot(an) < 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = base + i, b = base + j, c = base + n + j, d = base + n + i;
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
