// Owner: E3. Base geometry, merged into ONE buffer (one draw call): the four cut walls (strata below the ground,
// a water column over the lake bed), the floor beyond the board (land at board level, the beach slope, the lake bed),
// a rounded wooden plinth the whole diorama sits on, and pebbles embedded in the rock strata.
// Per-vertex `aKind` (see KIND) picks the look in the base material; `aTop` is the surface the strata/water depth is
// measured from (ground for strata, water level for the water column, a variant index for pebbles).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldLayout } from '../layout';
import { BASE, groundAt, type EdgeProfile, type EdgeSample } from './profile';

export const KIND = { strata: 0, water: 1, plinth: 2, floor: 3, pebble: 4 } as const;

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type V3 = [number, number, number];

class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly kind: number[] = [];
  readonly top: number[] = [];

  vert(p: V3, n: V3, kind: number, top: number): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.kind.push(kind);
    this.top.push(top);
  }

  /** Quad a-b-c-d (any winding, may be degenerate on one side) facing `n`; `tops` per corner. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, kind: number, tops: [number, number, number, number]): void {
    // orientation from the diagonals: robust when one edge has collapsed to a point
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!, cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order: Array<[V3, number]> = flip
      ? [[a, tops[0]], [c, tops[2]], [b, tops[1]], [a, tops[0]], [d, tops[3]], [c, tops[2]]]
      : [[a, tops[0]], [b, tops[1]], [c, tops[2]], [a, tops[0]], [c, tops[2]], [d, tops[3]]];
    for (const [p, t] of order) this.vert(p, n, kind, t);
  }

  /** Append an indexed or non-indexed geometry's triangles. */
  geometry(g: THREE.BufferGeometry, kind: number, top: number): void {
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      const k = idx ? idx.getX(i) : i;
      this.vert([pos.getX(k), pos.getY(k), pos.getZ(k)], [nor.getX(k), nor.getY(k), nor.getZ(k)], kind, top);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(this.top, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function walls(b: Builder, sides: EdgeProfile[]): void {
  const bot = BASE.bottom;
  for (const side of sides) {
    const n: V3 = [side.nx, 0, side.nz];
    for (let i = 0; i + 1 < side.samples.length; i++) {
      const a = side.samples[i]!, c = side.samples[i + 1]!;
      b.quad([a.x, bot, a.z], [c.x, bot, c.z], [c.x, c.ground, c.z], [a.x, a.ground, a.z], n, KIND.strata, [a.ground, c.ground, c.ground, a.ground]);
      if (a.water !== null || c.water !== null) {
        const level = (a.water ?? c.water)!;
        const wt = (s: EdgeSample) => (s.water !== null ? Math.max(s.water, s.ground) : s.ground);
        b.quad([a.x, a.ground, a.z], [c.x, c.ground, c.z], [c.x, wt(c), c.z], [a.x, wt(a), a.z], n, KIND.water, [level, level, level, level]);
      }
    }
  }
}

function floor(b: Builder, layout: WorldLayout): void {
  const E = layout.extent, B = layout.board, cell = 2;
  const nx = Math.round((E.maxX - E.minX) / cell), nz = Math.round((E.maxZ - E.minZ) / cell);
  const X = (i: number) => E.minX + ((E.maxX - E.minX) * i) / nx;
  const Z = (j: number) => E.minZ + ((E.maxZ - E.minZ) * j) / nz;
  const y = (x: number, z: number) => groundAt(layout, x, z);
  const normal = (x: number, z: number): V3 => {
    const e = 0.5, dx = y(x + e, z) - y(x - e, z), dz = y(x, z + e) - y(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    return [-dx / l, (2 * e) / l, -dz / l];
  };
  const inBoard = (x: number, z: number) => x >= B.minX - 1e-6 && x <= B.maxX + 1e-6 && z >= B.minZ - 1e-6 && z <= B.maxZ + 1e-6;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = X(i), x1 = X(i + 1), z0 = Z(j), z1 = Z(j + 1);
      if (inBoard(x0, z0) && inBoard(x1, z1)) continue;
      const corner = (x: number, z: number): V3 => [x, y(x, z), z];
      const p = [corner(x0, z0), corner(x1, z0), corner(x1, z1), corner(x0, z1)] as const;
      const ns = [normal(x0, z0), normal(x1, z0), normal(x1, z1), normal(x0, z1)] as const;
      // two upward-facing triangles (counter-clockwise seen from above: x right, z toward the viewer)
      for (const k of [0, 2, 1, 0, 3, 2]) b.vert(p[k]!, ns[k]!, KIND.floor, p[k]![1]);
    }
  }
}

function plinth(b: Builder, layout: WorldLayout): void {
  const E = layout.extent;
  const bevel = 0.42;
  const hx = (E.maxX - E.minX) / 2 + BASE.plinthOut - bevel, hz = (E.maxZ - E.minZ) / 2 + BASE.plinthOut - bevel;
  const r = Math.max(0.1, BASE.plinthR - bevel);
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.quadraticCurveTo(hx, -hz, hx, -hz + r);
  s.lineTo(hx, hz - r);
  s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz);
  s.quadraticCurveTo(-hx, hz, -hx, hz - r);
  s.lineTo(-hx, -hz + r);
  s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  const depth = BASE.plinthH - 2 * bevel;
  let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.rotateX(-Math.PI / 2); // extrusion → +y; shape y → −z (symmetric, so the footprint is unchanged)
  g.translate((E.minX + E.maxX) / 2, BASE.bottom - depth - bevel, (E.minZ + E.maxZ) / 2);
  b.geometry(g, KIND.plinth, 0);
  g.dispose();
}

function pebbles(b: Builder, sides: EdgeProfile[]): void {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.getAttribute('position'), nor = ico.getAttribute('normal');
  const rnd = prng(907);
  for (const side of sides) {
    const S = side.samples;
    const len = Math.hypot(S[S.length - 1]!.x - S[0]!.x, S[S.length - 1]!.z - S[0]!.z);
    const count = Math.round(len / 6.5);
    const tx = -side.nz, tz = side.nx; // along the wall
    for (let k = 0; k < count; k++) {
      const f = (k + 0.15 + rnd() * 0.7) / count;
      const s = S[Math.min(S.length - 1, Math.round(f * (S.length - 1)))]!;
      if (f * len < 2.5 || (1 - f) * len < 2.5) continue;
      const hi = Math.min(s.ground - 2.4, -5.3), lo = BASE.bottom + 0.8;
      if (hi <= lo) continue;
      const r = 0.24 + rnd() * 0.32;
      const cy = lo + (hi - lo) * rnd();
      const sx = r * (1.15 + rnd() * 0.35), sy = r * (0.7 + rnd() * 0.15), sd = r * 0.8;
      const cx = s.x + side.nx * r * 0.12, cz = s.z + side.nz * r * 0.12;
      const variant = Math.floor(rnd() * 3);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
        // local frame: x along the wall, y up, z out of the wall
        const along = lx * sx, up = ly * sy, out = lz * sd;
        const p: V3 = [cx + tx * along + side.nx * out, cy + up, cz + tz * along + side.nz * out];
        const nl = [nor.getX(i) / sx, nor.getY(i) / sy, nor.getZ(i) / sd];
        const n: V3 = [tx * nl[0]! + side.nx * nl[2]!, nl[1]!, tz * nl[0]! + side.nz * nl[2]!];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        b.vert(p, [n[0] / l, n[1] / l, n[2] / l], KIND.pebble, variant);
      }
    }
  }
  ico.dispose();
}

/** The whole base as one geometry for the given cut profile. */
export function buildBaseGeometry(layout: WorldLayout, sides: EdgeProfile[]): THREE.BufferGeometry {
  const b = new Builder();
  walls(b, sides);
  floor(b, layout);
  plinth(b, layout);
  pebbles(b, sides);
  return b.build();
}
