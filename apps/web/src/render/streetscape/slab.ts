// Owner: S1. Geometry builders: bevelled slabs from region loops (flat top, 45° chamfer, vertical sides) and flat
// paint quads (zebra stripes, bay lines, pitch lines). Output is plain position/normal/index geometry in world
// space; index.ts tags it with palette roles and bakes everything into one kit geometry.
import * as THREE from 'three';
import type { Vec2 } from '@headway/sim';
import type { Loop, Poly } from './field';

/** Growable position/normal/index buffers. */
export class Mesher {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  get vertexCount(): number { return this.pos.length / 3; }
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    return this.pos.length / 3 - 1;
  }
  /** Triangle a-b-c, flipped if its geometric normal disagrees with `want` (so winding can never be wrong). */
  tri(a: number, b: number, c: number, want: { x: number; y: number; z: number }): void {
    const P = this.pos;
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want.x + ny * want.y + nz * want.z < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setIndex(this.idx);
    return g;
  }
}

const UP = { x: 0, y: 1, z: 0 };

/** Offset a loop to its left (into the region) by `d`, mitred, keeping vertex correspondence. */
export function offsetLoop(l: Loop, d: number): Loop {
  const n = l.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = l[(i - 1 + n) % n]!, p = l[i]!, b = l[(i + 1) % n]!;
    const n1 = leftNormal(a, p), n2 = leftNormal(p, b);
    let mx = n1.x + n2.x, mz = n1.z + n2.z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n2.x; mz = n2.z; } else { mx /= ml; mz /= ml; }
    const k = d / Math.max(0.35, mx * n2.x + mz * n2.z);
    out.push({ x: p.x + mx * k, z: p.z + mz * k });
  }
  return out;
}

function leftNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  return { x: -dz / L, z: dx / L };
}

export interface SlabOptions {
  /** Top surface height. */
  top: number;
  /** Bottom of the side walls (default 0, the board). */
  base?: number;
  /** Chamfer size along the top edge (0 = square edge). */
  bevel?: number;
  /** Vertices whose two edges turn less than this (degrees) get one smooth normal (curves look round). */
  smoothDeg?: number;
}

/**
 * Bevelled slab for polygons-with-holes: the top cap goes to `top`, the chamfer + walls to `side` (so they can
 * take different colour roles, e.g. sidewalk top vs curb face).
 */
export function slab(polys: Poly[], o: SlabOptions, top: Mesher, side: Mesher): void {
  const bevel = o.bevel ?? 0, base = o.base ?? 0, y1 = o.top, y0 = o.top - bevel;
  const cosSmooth = Math.cos(((o.smoothDeg ?? 38) * Math.PI) / 180);
  for (const poly of polys) {
    const loops = [poly.outer, ...poly.holes];
    const insets = loops.map((l) => (bevel > 0 ? offsetLoop(l, bevel) : l));
    // Top cap.
    const contour = insets[0]!.map((p) => new THREE.Vector2(p.x, p.z));
    const holes = insets.slice(1).map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const flat = [...contour, ...holes.flat()];
    const v0 = top.vertexCount;
    for (const p of flat) top.vertex(p.x, y1, p.y, 0, 1, 0);
    for (const [a, b, c] of faces) top.tri(v0 + a!, v0 + b!, v0 + c!, UP);
    // Chamfer + walls.
    loops.forEach((l, li) => {
      const q = insets[li]!;
      const n = l.length;
      const en: Vec2[] = []; // outward (right-hand) normal of edge i → i+1
      for (let i = 0; i < n; i++) { const ln = leftNormal(l[i]!, l[(i + 1) % n]!); en.push({ x: -ln.x, z: -ln.z }); }
      const vn = (i: number, edge: number): Vec2 => {
        const a = en[(i - 1 + n) % n]!, b = en[i % n]!;
        if (a.x * b.x + a.z * b.z < cosSmooth) return en[edge]!;
        const x = a.x + b.x, z = a.z + b.z, L = Math.hypot(x, z) || 1;
        return { x: x / L, z: z / L };
      };
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p0 = l[i]!, p1 = l[j]!, q0 = q[i]!, q1 = q[j]!;
        const n0 = vn(i, i), n1 = vn(j, i), e = en[i]!;
        const want = { x: e.x, y: 0, z: e.z };
        if (y0 - base > 1e-4) {
          const a = side.vertex(p0.x, base, p0.z, n0.x, 0, n0.z), b = side.vertex(p1.x, base, p1.z, n1.x, 0, n1.z);
          const c = side.vertex(p1.x, y0, p1.z, n1.x, 0, n1.z), d = side.vertex(p0.x, y0, p0.z, n0.x, 0, n0.z);
          side.tri(a, b, c, want); side.tri(a, c, d, want);
        }
        if (bevel > 0) {
          const s = Math.SQRT1_2;
          const a = side.vertex(p0.x, y0, p0.z, n0.x * s, s, n0.z * s), b = side.vertex(p1.x, y0, p1.z, n1.x * s, s, n1.z * s);
          const c = side.vertex(q1.x, y1, q1.z, n1.x * s, s, n1.z * s), d = side.vertex(q0.x, y1, q0.z, n0.x * s, s, n0.z * s);
          const wb = { x: e.x, y: 1, z: e.z };
          side.tri(a, b, c, wb); side.tri(a, c, d, wb);
        }
      }
    });
  }
}

/** Flat paint quad centred at (x, z): `len` along unit u, `wid` across it, at height y (faces up). */
export function paintQuad(m: Mesher, x: number, z: number, u: Vec2, len: number, wid: number, y: number): void {
  const hx = (u.x * len) / 2, hz = (u.z * len) / 2, wx = (-u.z * wid) / 2, wz = (u.x * wid) / 2;
  const a = m.vertex(x - hx - wx, y, z - hz - wz, 0, 1, 0);
  const b = m.vertex(x + hx - wx, y, z + hz - wz, 0, 1, 0);
  const c = m.vertex(x + hx + wx, y, z + hz + wz, 0, 1, 0);
  const d = m.vertex(x - hx + wx, y, z - hz + wz, 0, 1, 0);
  m.tri(a, b, c, UP); m.tri(a, c, d, UP);
}

/** Flat paint ring (annulus) centred at (x, z). */
export function paintRing(m: Mesher, x: number, z: number, r: number, wid: number, y: number, seg = 28): void {
  const r0 = r - wid / 2, r1 = r + wid / 2;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = [
      m.vertex(x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0, 0, 1, 0),
      m.vertex(x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0, 0, 1, 0),
      m.vertex(x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1, 0, 1, 0),
      m.vertex(x + Math.cos(a0) * r1, y, z + Math.sin(a0) * r1, 0, 1, 0),
    ];
    m.tri(p[0]!, p[1]!, p[2]!, UP); m.tri(p[0]!, p[2]!, p[3]!, UP);
  }
}

/** Flat paint disc (spot) centred at (x, z). */
export function paintDisc(m: Mesher, x: number, z: number, r: number, y: number, seg = 14): void {
  const c = m.vertex(x, y, z, 0, 1, 0);
  const rim: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    rim.push(m.vertex(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 1, 0));
  }
  for (let i = 0; i < seg; i++) m.tri(c, rim[i]!, rim[(i + 1) % seg]!, UP);
}
