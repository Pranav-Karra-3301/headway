// Owner: E3. Distant ridges: 2–3 layered low-poly mountain bands wrapped around the back of the diorama (beyond the
// north + west mountain sides, rounding the NW corner), farther layers taller and hazier (aerial perspective is
// applied in the shader by blending toward the sky colour at the same screen height, so their misty feet melt into
// the gradient). Each band is a single front slope: foot row (below the diorama, toward it) → jittered mid row →
// crest. The foot always stays outside the diorama + plinth, so no distant slope can poke through the terrain.
import * as THREE from 'three';
import type { WorldLayout } from '../layout';

export interface RidgeSpec {
  /** Distance of the crest line beyond the diorama's back edges (u). */
  offset: number;
  /** Horizontal run of the front slope, crest → foot, toward the diorama (≤ offset − 3). */
  run: number;
  /** Crest height range (u). */
  peak: [number, number];
  /** Aerial perspective: share of the sky colour mixed in (0 = none). */
  aerial: number;
  /** Mist: the slope fades fully into the sky below `mist[0]` and is clear above `mist[1]` (world y). */
  mist: [number, number];
  /** Crest sample spacing (u): bigger = chunkier facets. */
  step: number;
  /** How far the band runs past the NE / SW corners while tapering away. */
  overrun: number;
  seed: number;
}

/** World y of every ridge foot: well below the diorama base, inside the mist. */
export const RIDGE_FOOT_Y = -22;

export const RIDGE_LAYERS: RidgeSpec[] = [
  { offset: 12, run: 9, peak: [15, 25], aerial: 0.26, mist: [-4, 16], step: 6.5, overrun: 30, seed: 11 },
  { offset: 30, run: 24, peak: [23, 35], aerial: 0.46, mist: [0, 24], step: 8.5, overrun: 46, seed: 23 },
  { offset: 52, run: 44, peak: [31, 47], aerial: 0.64, mist: [6, 34], step: 11, overrun: 64, seed: 37 },
];

export interface BandPoint {
  x: number;
  z: number;
  /** Outward normal of the band (away from the diorama), unit length in xz. */
  nx: number;
  nz: number;
  /** Crest height. */
  h: number;
  /** Arc length along the band from its NE end. */
  u: number;
}

/** Small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Base line of one ridge layer: north edge (from past the NE corner, heading west) → arc round the NW corner →
 *  west edge (heading south, past the SW corner), `spec.offset` beyond the extent, with crest heights. */
export function ridgeBand(layout: WorldLayout, spec: RidgeSpec): BandPoint[] {
  const E = layout.extent;
  const d = spec.offset;
  const north = (E.maxX + spec.overrun) - E.minX;
  const arc = (Math.PI / 2) * d;
  const west = (E.maxZ + spec.overrun) - E.minZ;
  const total = north + arc + west;
  const at = (u: number): { x: number; z: number; nx: number; nz: number } => {
    if (u <= north) return { x: E.maxX + spec.overrun - u, z: E.minZ - d, nx: 0, nz: -1 };
    if (u <= north + arc) {
      const th = -Math.PI / 2 - (u - north) / d;
      return { x: E.minX + d * Math.cos(th), z: E.minZ + d * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th) };
    }
    return { x: E.minX - d, z: E.minZ + (u - north - arc), nx: -1, nz: 0 };
  };
  const rnd = prng(spec.seed);
  const n = Math.max(8, Math.round(total / spec.step));
  // Smooth value noise for the broad mountain massing, sampled on a coarse lattice.
  const lattice = Array.from({ length: Math.ceil(total / 38) + 3 }, () => rnd());
  const massing = (u: number) => {
    const f = u / 38, i = Math.floor(f), t = smooth(f - i);
    return lattice[i]! + (lattice[i + 1]! - lattice[i]!) * t;
  };
  const taper = Math.min(spec.overrun + 18, total / 3);
  const out: BandPoint[] = [];
  for (let i = 0; i <= n; i++) {
    // jitter interior samples along the band so facets are irregular
    const u = i === 0 || i === n ? (i / n) * total : ((i + (rnd() - 0.5) * 0.55) / n) * total;
    const p = at(u);
    const mass = massing(u);
    const saddle = i % 2 === 1 ? 0.7 + 0.18 * rnd() : 0.94 + 0.06 * rnd();
    let h = (spec.peak[0] + (spec.peak[1] - spec.peak[0]) * mass) * saddle;
    const end = Math.min(u, total - u);
    h *= Math.pow(smooth(end / taper), 0.75);
    out.push({ ...p, h: Math.max(0, Math.min(spec.peak[1], h)), u });
  }
  return out;
}

/** Fixed per-band data written into the sky-props geometry. */
export interface PropsAttribs {
  position: number[];
  /** aerial, kind (0 ridge, 1 cloud), side normal x, z. */
  info: number[];
  /** Cloud centre (0 for ridges). */
  center: number[];
  /** Cloud drift: span start, span length, phase, speed (ridges: 0, 1, 0, 0). */
  drift: number[];
  /** Mist range lo, hi (clouds: no mist). */
  mist: number[];
}

export function emptyAttribs(): PropsAttribs {
  return { position: [], info: [], center: [], drift: [], mist: [] };
}

/** Append one ridge layer's front slope as triangles. */
export function appendRidge(out: PropsAttribs, band: BandPoint[], spec: RidgeSpec): void {
  const rnd = prng(spec.seed * 7 + 3);
  type P = [number, number, number];
  const rows: Array<{ foot: P; mid: P; crest: P; nx: number; nz: number }> = band.map((b) => {
    const k = 0.4 + rnd() * 0.18;
    const midH = RIDGE_FOOT_Y + (b.h - RIDGE_FOOT_Y) * (0.5 + (rnd() - 0.5) * 0.12);
    const along = (rnd() - 0.5) * spec.step * 0.35;
    return {
      foot: [b.x - b.nx * spec.run, RIDGE_FOOT_Y, b.z - b.nz * spec.run],
      mid: [b.x - b.nx * spec.run * k - b.nz * along, midH, b.z - b.nz * spec.run * k + b.nx * along],
      crest: [b.x, b.h, b.z],
      nx: b.nx,
      nz: b.nz,
    };
  });
  const push = (p: P, nx: number, nz: number) => {
    out.position.push(p[0], p[1], p[2]);
    out.info.push(spec.aerial, 0, nx, nz);
    out.center.push(0, 0, 0);
    out.drift.push(0, 1, 0, 0);
    out.mist.push(spec.mist[0], spec.mist[1]);
  };
  const tri = (a: P, b: P, c: P, nx: number, nz: number) => { push(a, nx, nz); push(b, nx, nz); push(c, nx, nz); };
  for (let i = 0; i + 1 < rows.length; i++) {
    const r0 = rows[i]!, r1 = rows[i + 1]!;
    const nx = (r0.nx + r1.nx) / 2, nz = (r0.nz + r1.nz) / 2, l = Math.hypot(nx, nz) || 1;
    const flip = i % 2 === 0;
    for (const [lo0, lo1, hi0, hi1] of [[r0.foot, r1.foot, r0.mid, r1.mid], [r0.mid, r1.mid, r0.crest, r1.crest]] as const) {
      if (flip) { tri(lo0, lo1, hi1, nx / l, nz / l); tri(lo0, hi1, hi0, nx / l, nz / l); }
      else { tri(lo0, lo1, hi0, nx / l, nz / l); tri(lo1, hi1, hi0, nx / l, nz / l); }
    }
  }
}

export function toGeometry(a: PropsAttribs): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.position, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(a.info, 4));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(a.center, 3));
  g.setAttribute('aDrift', new THREE.Float32BufferAttribute(a.drift, 4));
  g.setAttribute('aMist', new THREE.Float32BufferAttribute(a.mist, 2));
  g.computeBoundingSphere();
  return g;
}
