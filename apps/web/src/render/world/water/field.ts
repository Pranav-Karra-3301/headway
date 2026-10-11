// Owner: E2. The shore field the water shader samples (pure, no three.js): per texel over the diorama,
//   shore   — signed distance to the nearest land (> 0 on water): beach waterline, the lighthouse point and, when the
//             composer passes a terrain height function, any headland that rises out of the lake;
//   objects — distance to the nearest small thing standing in the water (piers, piles, moored hulls, rocks).
// Depth tint, shore foam and travelling wave lines key off `shore`; the small foam rings off `objects`.
import { capsuleDist, WATER_Y, type WaterPlan } from './plan';

export interface ShoreField {
  minX: number;
  minZ: number;
  cell: number;
  w: number;
  h: number;
  shore: Float32Array;
  objects: Float32Array;
}

export interface FieldOptions {
  /** Texel size in world units (default 0.25). */
  cell?: number;
  /** Ground height of other world parts (terrain headlands); land wherever it rises above the water. */
  landHeight?: (x: number, z: number) => number;
  /** Signed distance to another part's coastline (> 0 on land), e.g. the terrain headlands. Only used beyond the
   *  board's mountain-side edges (x < board.minX or z < board.minZ), where the beach does not reach. */
  landDist?: (x: number, z: number) => number;
}

/** Cap for the objects channel (nothing beyond this matters for foam). */
export const OBJECT_FAR = 6;
const INF = 1e20;

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher) of f into d. */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) { k--; s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
  }
}

/** Euclidean distance (in cells) from every cell to the nearest cell with seed[i] = 1 (row-major, w × h). */
export function edt2d(seed: Uint8Array, w: number, h: number): Float32Array {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = seed[i] ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]!;
    dt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    dt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]!);
  }
  return out;
}

export function buildShoreField(plan: WaterPlan, opts: FieldOptions = {}): ShoreField {
  const cell = opts.cell ?? 0.25;
  const ex = plan.extent;
  const minX = ex.minX - cell, minZ = ex.minZ - cell;
  const w = Math.ceil((ex.maxX - ex.minX) / cell) + 2, h = Math.ceil((ex.maxZ - ex.minZ) / cell) + 2;
  const shore = new Float32Array(w * h);
  const objects = new Float32Array(w * h).fill(OBJECT_FAR);
  for (let j = 0; j < h; j++) {
    const z = minZ + (j + 0.5) * cell;
    for (let i = 0; i < w; i++) shore[j * w + i] = plan.waterDist(minX + (i + 0.5) * cell, z);
  }
  if (opts.landDist) {
    const B = plan.board;
    const smooth = (e0: number, e1: number, v: number) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let j = 0; j < h; j++) {
      const z = minZ + (j + 0.5) * cell;
      const wz = smooth(B.minZ + 1, B.minZ - 2, z);
      for (let i = 0; i < w; i++) {
        const x = minX + (i + 0.5) * cell;
        const wgt = Math.max(wz, smooth(B.minX + 1, B.minX - 2, x));
        const k = j * w + i;
        if (wgt <= 0 || shore[k]! < -3) continue;
        const ext = -opts.landDist(x, z) + (1 - wgt) * 60;
        if (ext < shore[k]!) shore[k] = ext;
      }
    }
  }
  if (opts.landHeight) {
    const land = new Uint8Array(w * h), water = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const z = minZ + (j + 0.5) * cell;
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const isLand = shore[k]! < -1.5 || opts.landHeight(minX + (i + 0.5) * cell, z) > WATER_Y + 0.01;
        land[k] = isLand ? 1 : 0;
        water[k] = isLand ? 0 : 1;
      }
    }
    const toLand = edt2d(land, w, h), toWater = edt2d(water, w, h);
    for (let k = 0; k < w * h; k++) {
      const sd = land[k] ? -(toWater[k]! - 0.5) * cell : (toLand[k]! - 0.5) * cell;
      if (sd < shore[k]!) shore[k] = sd;
    }
  }
  const pad = 2.5;
  for (const c of plan.foam) {
    const i0 = Math.max(0, Math.floor((Math.min(c.a.x, c.b.x) - c.r - pad - minX) / cell));
    const i1 = Math.min(w - 1, Math.ceil((Math.max(c.a.x, c.b.x) + c.r + pad - minX) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(c.a.z, c.b.z) - c.r - pad - minZ) / cell));
    const j1 = Math.min(h - 1, Math.ceil((Math.max(c.a.z, c.b.z) + c.r + pad - minZ) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        const d = capsuleDist({ x: minX + (i + 0.5) * cell, z }, c);
        if (d < objects[k]!) objects[k] = d;
      }
    }
  }
  return { minX, minZ, cell, w, h, shore, objects };
}

/** Bilinear sample of the field at (x, z), like the GPU does. */
export function sampleField(f: ShoreField, x: number, z: number): { shore: number; objects: number } {
  const fx = Math.max(0, Math.min(f.w - 1.001, (x - f.minX) / f.cell - 0.5));
  const fz = Math.max(0, Math.min(f.h - 1.001, (z - f.minZ) / f.cell - 0.5));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const at = (a: Float32Array, ii: number, jj: number) => a[jj * f.w + ii]!;
  const lerp2 = (a: Float32Array) =>
    (at(a, i, j) * (1 - u) + at(a, i + 1, j) * u) * (1 - v) + (at(a, i, j + 1) * (1 - u) + at(a, i + 1, j + 1) * u) * v;
  return { shore: lerp2(f.shore), objects: lerp2(f.objects) };
}
