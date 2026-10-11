// Owner: E3. Distant ridges (art bible §6.5): 2–3 layered flat silhouettes wrapped round the back of the diorama —
// beyond the north + west mountain sides, rounding the NW corner — like painted flats behind a model railway.
// Each layer is a vertical curtain from far below the base up to a smooth crest; farther layers are authored lower
// and flatter (an ortho camera has no size falloff, so distance comes from overlap, haze and a higher screen
// position). Only the nearest layer carries a soft tree line. Colour, mist (feet melting into the sky) and the dusk
// rim are applied in the shader; the geometry only knows its layer and its crest height.
import * as THREE from 'three';
import type { WorldLayout } from '../layout';

export interface RidgeSpec {
  /** Distance of the curtain beyond the diorama's back edges (u). */
  offset: number;
  /** Mean crest height and its swing (u). */
  base: number;
  amp: number;
  /** Main hill wavelength along the band (u): longer = flatter. */
  wave: number;
  /** World heights over which the feet fade into the sky (fully misted below [0], clear above [1]). */
  mist: [number, number];
  /** Tree-line bumps on the crest (0 = none). */
  trees: number;
  /** How far the band runs past the NE / SW corners while tapering away. */
  overrun: number;
  seed: number;
}

/** World y of every curtain's foot: far below the base, inside the mist. */
export const RIDGE_FOOT_Y = -30;

export const RIDGE_LAYERS: RidgeSpec[] = [
  { offset: 12, base: 11, amp: 6, wave: 34, mist: [-6, 7], trees: 1, overrun: 34, seed: 11 },
  { offset: 30, base: 10, amp: 4.5, wave: 48, mist: [-5, 6], trees: 0, overrun: 52, seed: 23 },
  { offset: 52, base: 9, amp: 3, wave: 66, mist: [-4, 5], trees: 0, overrun: 74, seed: 37 },
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

/** The curtain's path for an offset: north edge (from past the NE corner, heading west) → arc round the NW corner
 *  → west edge (heading south, past the SW corner). */
export function bandPath(layout: WorldLayout, offset: number, overrun: number) {
  const E = layout.extent, d = offset;
  const north = E.maxX + overrun - E.minX, arc = (Math.PI / 2) * d, west = E.maxZ + overrun - E.minZ;
  const at = (u: number): { x: number; z: number; nx: number; nz: number } => {
    if (u <= north) return { x: E.maxX + overrun - u, z: E.minZ - d, nx: 0, nz: -1 };
    if (u <= north + arc) {
      const th = -Math.PI / 2 - (u - north) / d;
      return { x: E.minX + d * Math.cos(th), z: E.minZ + d * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th) };
    }
    return { x: E.minX - d, z: E.minZ + (u - north - arc), nx: -1, nz: 0 };
  };
  return { total: north + arc + west, at };
}

/** Crest line of one layer, sampled finely enough for smooth hills (and tree bumps on the near layer). */
export function ridgeBand(layout: WorldLayout, spec: RidgeSpec): BandPoint[] {
  const { total, at } = bandPath(layout, spec.offset, spec.overrun);
  const rnd = prng(spec.seed);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  // value noise lattice for broad massing (a few higher summits)
  const lattice = Array.from({ length: Math.ceil(total / (spec.wave * 1.7)) + 3 }, () => rnd());
  const massing = (u: number) => {
    const f = u / (spec.wave * 1.7), i = Math.floor(f), t = smooth(f - i);
    return lattice[i]! + (lattice[i + 1]! - lattice[i]!) * t;
  };
  const W = spec.wave;
  const hill = (u: number) =>
    0.5 * Math.sin((u / W) * 6.283 + ph[0]!) + 0.3 * Math.sin((u / (W * 0.53)) * 6.283 + ph[1]!) + 0.2 * Math.sin((u / (W * 0.29)) * 6.283 + ph[2]!);
  const taper = Math.min(spec.overrun + 20, total / 3);
  const step = spec.trees ? 0.55 : 1.2;
  const n = Math.max(16, Math.round(total / step));
  const out: BandPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * total;
    const p = at(u);
    let h = spec.base + spec.amp * (0.65 * hill(u) + 0.7 * (massing(u) - 0.5));
    if (spec.trees) {
      // patches of little pine bumps along the crest
      const patch = smooth((Math.sin((u / 23) * 6.283 + ph[3]!) + 0.15) * 3);
      h += patch * (i % 2 === 0 ? 0.9 + 0.5 * rnd() : 0.1);
    }
    const end = Math.min(u, total - u);
    h *= Math.pow(smooth(end / taper), 0.7);
    out.push({ ...p, h: Math.max(0, h), u });
  }
  return out;
}

/** Per-vertex data of the sky props mesh (ridges + clouds). */
export interface PropsAttribs {
  position: number[];
  normal: number[];
  /** layer (0–2 ridges; 3 cloud), crest height (ridges) / unused, band normal x, z. */
  info: number[];
  /** Cloud centre (0 for ridges). */
  center: number[];
  /** Cloud drift: span start, span length, phase, speed (ridges: 0, 1, 0, 0). */
  drift: number[];
  /** Mist range lo, hi (clouds: no mist). */
  mist: number[];
}

export function emptyAttribs(): PropsAttribs {
  return { position: [], normal: [], info: [], center: [], drift: [], mist: [] };
}

/** Append one ridge layer: a vertical curtain strip from the foot to the crest, facing the diorama. */
export function appendRidge(out: PropsAttribs, band: BandPoint[], spec: RidgeSpec, layer: number): void {
  const push = (b: BandPoint, y: number, crest: number) => {
    out.position.push(b.x, y, b.z);
    out.normal.push(-b.nx, 0, -b.nz);
    out.info.push(layer, crest, b.nx, b.nz);
    out.center.push(0, 0, 0);
    out.drift.push(0, 1, 0, 0);
    out.mist.push(spec.mist[0], spec.mist[1]);
  };
  for (let i = 0; i + 1 < band.length; i++) {
    const a = band[i]!, b = band[i + 1]!;
    // a (foot) → b (foot) → b (crest); a (foot) → b (crest) → a (crest): front faces toward the diorama
    push(a, RIDGE_FOOT_Y, a.h); push(a, a.h, a.h); push(b, b.h, b.h);
    push(a, RIDGE_FOOT_Y, a.h); push(b, b.h, b.h); push(b, RIDGE_FOOT_Y, b.h);
  }
}

export function toGeometry(a: PropsAttribs): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(a.normal, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(a.info, 4));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(a.center, 3));
  g.setAttribute('aDrift', new THREE.Float32BufferAttribute(a.drift, 4));
  g.setAttribute('aMist', new THREE.Float32BufferAttribute(a.mist, 2));
  g.computeBoundingSphere();
  return g;
}
