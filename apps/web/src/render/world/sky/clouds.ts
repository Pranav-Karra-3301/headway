// Owner: E3. A few slow low-poly clouds high in the haze band behind the mountains (never over the board or the
// water, no shadows). Each cloud is a cluster of smooth-shaded puffs with a flattened belly. Drift runs in the vertex
// shader along the cloud's band (north band → east, west band → north: left → right on screen), wrapping inside a span
// that stays behind the diorama; clouds shrink away near the wrap point instead of popping. `cloudOffset` mirrors the
// shader exactly.
import * as THREE from 'three';
import type { WorldLayout } from '../layout';
import { prng, type PropsAttribs } from './ridges';

export interface CloudSpec {
  /** Rest position of the cloud centre. */
  x: number;
  y: number;
  z: number;
  /** Overall length (u). */
  size: number;
  /** Outward normal of the band the cloud drifts along (north (0,-1) or west (-1,0)). */
  nx: number;
  nz: number;
  /** Drift span along the band direction (coordinate = dot(p, dir)), the rest phase in it and speed (u/s). */
  spanStart: number;
  span: number;
  phase: number;
  speed: number;
  seed: number;
}

/** Drift direction of a band: perpendicular to its outward normal (north → +x, west → −z). */
export const driftDir = (nx: number, nz: number) => ({ x: -nz, z: nx });

// [band, phase in span, depth beyond the edge, height, size, speed]
const DEFS: Array<['north' | 'west', number, number, number, number, number]> = [
  ['north', 0.5, 40, 30, 11, 0.3],
  ['north', 0.78, 36, 25, 8, 0.38],
  ['west', 0.3, 42, 31, 12, 0.26],
  ['west', 0.62, 35, 24, 7.5, 0.34],
];

export function cloudSpecs(layout: WorldLayout): CloudSpec[] {
  const E = layout.extent;
  return DEFS.map(([band, phase, depth, y, size, speed], i) => {
    const nx = band === 'north' ? 0 : -1, nz = band === 'north' ? -1 : 0;
    // span along the drift direction: from well past the far end of the back to past the near corner
    const spanStart = band === 'north' ? E.minX - 70 : -(E.maxZ + 40);
    const spanEnd = band === 'north' ? E.maxX + 40 : -(E.minZ - 70);
    const span = spanEnd - spanStart;
    const a = spanStart + phase * span;
    const perp = band === 'north' ? E.minZ - depth : E.minX - depth;
    return { x: band === 'north' ? a : perp, y, z: band === 'north' ? perp : -a, size, nx, nz, spanStart, span, phase, speed, seed: 101 + i * 17 };
  });
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Offset of a cloud from its rest position at time `t` (s) and its scale (0 near the wrap, 1 elsewhere). */
export function cloudOffset(c: CloudSpec, t: number): { dx: number; dz: number; grow: number } {
  const u = (((c.phase + (t * c.speed) / c.span) % 1) + 1) % 1;
  const delta = (u - c.phase) * c.span;
  const dir = driftDir(c.nx, c.nz);
  const grow = smooth(0, 0.08, u) * (1 - smooth(0.92, 1, u));
  return { dx: dir.x * delta, dz: dir.z * delta, grow };
}

/** Append every cloud's puffs (smooth icosphere puffs with flattened bellies) as triangles. */
export function appendClouds(out: PropsAttribs, clouds: CloudSpec[]): void {
  const ico = new THREE.IcosahedronGeometry(1, 2);
  const pos = ico.getAttribute('position');
  const v = new THREE.Vector3();
  for (const c of clouds) {
    const rnd = prng(c.seed);
    const dir = driftDir(c.nx, c.nz);
    const puffs = 4 + Math.floor(rnd() * 2);
    const belly = c.y - c.size * 0.09;
    for (let k = 0; k < puffs; k++) {
      const f = k / (puffs - 1) - 0.5; // −0.5 … 0.5 along the cloud
      const mid = 1 - Math.abs(f) * 1.25;
      const r = c.size * (0.17 + 0.14 * mid + rnd() * 0.04);
      const along = f * c.size * 0.8 + (rnd() - 0.5) * c.size * 0.05;
      const side = (rnd() - 0.5) * c.size * 0.18;
      const cx = c.x + dir.x * along + c.nx * side, cz = c.z + dir.z * along + c.nz * side;
      const cy = c.y + r * 0.3 * mid;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i); // unit sphere: the normal is the position
        const sy = 0.7;
        const y = cy + v.y * r * sy;
        const flat = y < belly;
        out.position.push(cx + v.x * r, flat ? belly : y, cz + v.z * r);
        // ellipsoid normal (x, y / sy, z); the flattened belly faces down
        const nx = v.x, ny = flat ? -3 : v.y / sy, nz = v.z, l = Math.hypot(nx, ny, nz) || 1;
        out.normal.push(nx / l, ny / l, nz / l);
        out.info.push(3, 0, c.nx, c.nz);
        out.center.push(c.x, c.y, c.z);
        out.drift.push(c.spanStart, c.span, c.phase, c.speed);
        out.mist.push(-1e4, -1e4 + 1);
      }
    }
  }
  ico.dispose();
}
