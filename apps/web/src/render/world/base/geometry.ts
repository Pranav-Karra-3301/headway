// Owner: E3. Base geometry, merged into ONE buffer (one draw call): the four cut walls (soil strata below the
// ground, a water column over the lake bed; the top 0.3 u carries tilted normals so the cut reads with a rounded
// top edge), a sunken safety floor beyond the board (never visible when terrain + water cover it), and a rounded
// wooden plinth the whole diorama sits on.
// Per-vertex `aKind` (see KIND) picks the look in the base material; `aTop` is the surface depth is measured from
// (ground for strata, water level for the water column).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldLayout } from '../layout';
import { BASE, floorAt, type EdgeProfile } from './profile';

export const KIND = { strata: 0, water: 1, plinth: 2, floor: 3 } as const;

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

  /** Quad a-b-c-d (any winding, may be degenerate on one side) facing `face`, with per-corner normals. */
  quad(q: [V3, V3, V3, V3], n: [V3, V3, V3, V3], face: V3, kind: number, top: number | [number, number, number, number]): void {
    const [a, b, c, d] = q;
    // orientation from the diagonals: robust when one edge has collapsed to a point
    const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const cx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, cy = e1[2]! * e2[0]! - e1[0]! * e2[2]!, cz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const order = cx * face[0] + cy * face[1] + cz * face[2] < 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const i of order) this.vert(q[i]!, n[i]!, kind, typeof top === 'number' ? top : top[i]!);
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

/** One wall panel between two cut samples, from lo to hi at each end (aTop = ta at the a end, tc at the c end);
 *  with `bevel`, the top `BASE.bevel` gets normals tilted up so the cut reads with a rounded top edge. */
function panel(b: Builder, xa: number, za: number, xc: number, zc: number, lo: [number, number], hi: [number, number], n: V3, kind: number, ta: number, tc: number, bevel: boolean): void {
  const up: V3 = [n[0] * 0.42, 0.91, n[2] * 0.42];
  const r = BASE.bevel;
  const tops: [number, number, number, number] = [ta, tc, tc, ta];
  if (bevel && hi[0] - lo[0] > r + 0.05 && hi[1] - lo[1] > r + 0.05) {
    const ma = hi[0] - r, mc = hi[1] - r;
    b.quad([[xa, lo[0], za], [xc, lo[1], zc], [xc, mc, zc], [xa, ma, za]], [n, n, n, n], n, kind, tops);
    b.quad([[xa, ma, za], [xc, mc, zc], [xc, hi[1], zc], [xa, hi[0], za]], [n, n, up, up], n, kind, tops);
  } else {
    b.quad([[xa, lo[0], za], [xc, lo[1], zc], [xc, hi[1], zc], [xa, hi[0], za]], [n, n, n, n], n, kind, tops);
  }
}

/** The ground shown on the cut faces (per side, per sample): the profile's ground, except under water, where the
 *  cut's lake bed sinks to `BASE.cutWaterDepth` below the water level, easing in over `BASE.cutRamp` samples from the
 *  nearest dry sample anywhere round the (closed) perimeter, so shared corners agree. */
export function cutGround(sides: EdgeProfile[]): number[][] {
  const ring = sides.flatMap((s, si) => s.samples.slice(0, -1).map((p, i) => ({ si, i, wet: p.water !== null })));
  const n = ring.length;
  const dist = new Array<number>(n).fill(Infinity);
  if (ring.some((r) => !r.wet)) {
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0, d = Infinity; k < 2 * n; k++) {
        const j = pass === 0 ? k % n : (2 * n - 1 - k) % n;
        d = ring[j]!.wet ? d + 1 : 0;
        dist[j] = Math.min(dist[j]!, d);
      }
    }
  }
  const at = new Map<string, number>();
  ring.forEach((r, j) => at.set(`${r.si}:${r.i}`, dist[j]!));
  return sides.map((s, si) => s.samples.map((p, i) => {
    if (p.water === null) return p.ground;
    const d = at.get(`${si}:${i}`) ?? at.get(`${(si + 1) % sides.length}:0`) ?? Infinity; // last sample = next side's first
    const t = Math.min(1, d / BASE.cutRamp), k = t * t * (3 - 2 * t);
    const deep = Math.max(BASE.bottom + 1.6, p.water - BASE.cutWaterDepth);
    return Math.min(p.ground, p.ground + (deep - p.ground) * k);
  }));
}

function walls(b: Builder, sides: EdgeProfile[]): void {
  const bot = BASE.bottom;
  const grounds = cutGround(sides);
  for (const [si, side] of sides.entries()) {
    const n: V3 = [side.nx, 0, side.nz];
    const samples = side.samples.map((s, i) => ({ ...s, ground: grounds[si]![i]! }));
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i]!, c = samples[i + 1]!;
      const wet = a.water !== null || c.water !== null;
      panel(b, a.x, a.z, c.x, c.z, [bot, bot], [a.ground, c.ground], n, KIND.strata, a.ground, c.ground, !wet);
      if (wet) {
        const level = (a.water ?? c.water)!;
        const wa = a.water !== null ? Math.max(a.water, a.ground) : a.ground;
        const wc = c.water !== null ? Math.max(c.water, c.ground) : c.ground;
        panel(b, a.x, a.z, c.x, c.z, [a.ground, c.ground], [wa, wc], n, KIND.water, level, level, true);
      }
    }
  }
}

function floor(b: Builder, layout: WorldLayout): void {
  const E = layout.extent, B = layout.board, cell = 2;
  const nx = Math.round((E.maxX - E.minX) / cell), nz = Math.round((E.maxZ - E.minZ) / cell);
  const X = (i: number) => E.minX + ((E.maxX - E.minX) * i) / nx;
  const Z = (j: number) => E.minZ + ((E.maxZ - E.minZ) * j) / nz;
  const y = (x: number, z: number) => floorAt(layout, x, z);
  const up: V3 = [0, 1, 0];
  const inBoard = (x: number, z: number) => x >= B.minX - 1e-6 && x <= B.maxX + 1e-6 && z >= B.minZ - 1e-6 && z <= B.maxZ + 1e-6;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = X(i), x1 = X(i + 1), z0 = Z(j), z1 = Z(j + 1);
      if (inBoard(x0, z0) && inBoard(x1, z1)) continue;
      const p: [V3, V3, V3, V3] = [[x0, y(x0, z0), z0], [x1, y(x1, z0), z0], [x1, y(x1, z1), z1], [x0, y(x0, z1), z1]];
      b.quad(p, [up, up, up, up], up, KIND.floor, 0);
    }
  }
}

function plinth(b: Builder, layout: WorldLayout): void {
  const E = layout.extent;
  const bevel = 0.28;
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

/** The whole base as one geometry for the given cut profile. */
export function buildBaseGeometry(layout: WorldLayout, sides: EdgeProfile[]): THREE.BufferGeometry {
  const b = new Builder();
  walls(b, sides);
  floor(b, layout);
  plinth(b, layout);
  return b.build();
}
