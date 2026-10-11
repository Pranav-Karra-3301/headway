// Owner: E3. A few slow low-poly clouds drifting high up behind the mountains (never over the board or the water).
// Each cloud is a cluster of faceted puffs with a flattened belly. Drift runs in the vertex shader along the cloud's
// band (north band → east, west band → north, i.e. left → right on screen), wrapping inside a span that stays behind
// the diorama; clouds shrink away near the wrap point instead of popping. `cloudOffset` mirrors the shader exactly.
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
  ['north', 0.34, 15, 31, 9, 0.34],
  ['north', 0.58, 34, 41, 12, 0.26],
  ['north', 0.8, 10, 27, 7, 0.4],
  ['west', 0.22, 20, 35, 10, 0.3],
  ['west', 0.5, 9, 26, 7.5, 0.38],
  ['west', 0.76, 38, 44, 12, 0.24],
];

export function cloudSpecs(layout: WorldLayout): CloudSpec[] {
  const E = layout.extent;
  return DEFS.map(([band, phase, depth, y, size, speed], i) => {
    const nx = band === 'north' ? 0 : -1, nz = band === 'north' ? -1 : 0;
    // span along the drift direction: from well past the far corner of the back to past the near corner
    const spanStart = band === 'north' ? E.minX - 60 : -(E.maxZ + 30);
    const spanEnd = band === 'north' ? E.maxX + 30 : -(E.minZ - 60);
    const span = spanEnd - spanStart;
    const a = spanStart + phase * span;
    const perp = band === 'north' ? E.minZ - depth : E.minX - depth;
    const x = band === 'north' ? a : perp;
    const z = band === 'north' ? perp : -a;
    return { x, y, z, size, nx, nz, spanStart, span, phase, speed, seed: 101 + i * 17 };
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

/** Append every cloud's puffs (faceted icosahedra with flattened bellies) as triangles. */
export function appendClouds(out: PropsAttribs, clouds: CloudSpec[]): void {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.getAttribute('position');
  const v = new THREE.Vector3();
  for (const c of clouds) {
    const rnd = prng(c.seed);
    const dir = driftDir(c.nx, c.nz);
    const puffs = 4 + Math.floor(rnd() * 2);
    for (let k = 0; k < puffs; k++) {
      const f = puffs === 1 ? 0 : k / (puffs - 1) - 0.5; // −0.5 … 0.5 along the cloud
      const mid = 1 - Math.abs(f) * 1.3;
      const r = c.size * (0.2 + 0.13 * mid + rnd() * 0.05);
      const along = f * c.size * 0.78 + (rnd() - 0.5) * c.size * 0.06;
      const side = (rnd() - 0.5) * c.size * 0.22;
      const cx = c.x + dir.x * along + c.nx * side, cz = c.z + dir.z * along + c.nz * side;
      const cy = c.y + r * 0.22 * mid;
      const belly = c.y - c.size * 0.1;
      const spin = rnd() * Math.PI * 2;
      const cs = Math.cos(spin), sn = Math.sin(spin);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const lx = v.x * cs - v.z * sn, lz = v.x * sn + v.z * cs;
        const y = Math.max(belly, cy + v.y * r * 0.72);
        out.position.push(cx + lx * r, y, cz + lz * r);
        out.info.push(0.14, 1, c.nx, c.nz);
        out.center.push(c.x, c.y, c.z);
        out.drift.push(c.spanStart, c.span, c.phase, c.speed);
        out.mist.push(-1e4, -1e4 + 1);
      }
    }
  }
  ico.dispose();
}
