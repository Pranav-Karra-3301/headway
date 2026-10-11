// Owner: E1. Terrain mesher: samples the field on a tensor grid whose lines include the board edges and the portal
// planes (so cliffs and retaining walls are crisp), keeps only cells with visible land, and closes every cut with a
// vertical skirt: masonry courses on the rail-tunnel walls, rock at the road-portal cliffs, soil strata on the
// diorama's outer edges. Output = two parts (mountain band, rail spur) with per-vertex paint info for `paint.ts`.
import { LAKE_BED, fbm, type TerrainField } from './field';

/** Per-vertex paint info: [kind, a, b, c, d, e, f, g]. */
export const INFO = 8;
export const KIND = { surface: 0, stone: 1, rock: 2, strata: 3 } as const;

export interface TerrainPart {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  /** INFO floats per vertex (see `paint.ts`). */
  info: Float32Array;
  count: number;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  info: number[] = [];
  idx: number[] = [];
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, info: ArrayLike<number>): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    for (let k = 0; k < INFO; k++) this.info.push(info[k] ?? 0);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  done(): TerrainPart {
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), index: new Uint32Array(this.idx),
      info: new Float32Array(this.info), count: this.pos.length / 3,
    };
  }
}

/** Sorted grid coordinates: a base step, halved inside `fine` ranges, plus exact `special` lines. */
export function gridLines(min: number, max: number, step: number, fine: Array<[number, number]>, special: number[]): number[] {
  const raw: number[] = [];
  const n = Math.max(1, Math.round((max - min) / step));
  const st = (max - min) / n;
  for (let i = 0; i <= n; i++) {
    const v = i === n ? max : min + i * st;
    raw.push(v);
    if (i < n) {
      const mid = v + st / 2;
      if (fine.some(([a, b]) => mid >= a && mid <= b)) raw.push(mid);
    }
  }
  const sp = special.filter((s) => s > min + 1e-6 && s < max - 1e-6);
  const near = st * 0.26;
  const kept = raw.filter((v) => !sp.some((s) => Math.abs(s - v) < near));
  return [...kept, ...sp].sort((a, b) => a - b).filter((v, i, arr) => i === 0 || v - arr[i - 1]! > 1e-6);
}

const hash01 = (a: number, b: number): number => {
  let h = Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x297a2d39);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

export function meshTerrain(field: TerrainField, step = 0.75): { band: TerrainPart; spur: TerrainPart } {
  const E = field.extent, B = field.board;
  const xSp = [B.minX, B.maxX], zSp = [B.minZ, B.maxZ];
  const fineX: Array<[number, number]> = [], fineZ: Array<[number, number]> = [];
  for (const p of field.portals) {
    if (Math.abs(p.face.z) > 0.999) zSp.push(p.z);
    if (Math.abs(p.face.x) > 0.999) xSp.push(p.x);
    fineX.push([p.x - 7, p.x + 7]);
    fineZ.push([p.z - 7, p.z + 7]);
  }
  const xs = gridLines(E.minX, E.maxX, step, fineX, xSp);
  const zs = gridLines(E.minZ, E.maxZ, step, fineZ, zSp);
  const nx = xs.length, nz = zs.length;
  const gi = (i: number, j: number) => j * nx + i;

  // ---- heights + validity per grid vertex
  const H = new Float32Array(nx * nz);
  const valid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i]!, z = zs[j]!;
    const h = field.height(x, z);
    H[gi(i, j)] = h;
    valid[gi(i, j)] = h > -2.9 && field.region(x, z) >= 0 && !field.cut(x, z) ? 1 : 0;
  }

  // ---- cells: -1 empty, 0 band, 1 spur; `lake` marks empties on the lake side (no skirts toward them)
  const ncx = nx - 1, ncz = nz - 1;
  const cell = new Int8Array(ncx * ncz).fill(-1);
  const lakeSide = new Uint8Array(ncx * ncz);
  const ci = (i: number, j: number) => j * ncx + i;
  for (let j = 0; j < ncz; j++) for (let i = 0; i < ncx; i++) {
    const mx = (xs[i]! + xs[i + 1]!) / 2, mz = (zs[j]! + zs[j + 1]!) / 2;
    const hmax = Math.max(H[gi(i, j)]!, H[gi(i + 1, j)]!, H[gi(i, j + 1)]!, H[gi(i + 1, j + 1)]!);
    const onBoard = mx > B.minX && mx < B.maxX && mz > B.minZ && mz < B.maxZ;
    if (onBoard) {
      if (hmax > 0.02 && !field.cut(mx, mz)) cell[ci(i, j)] = 1;
    } else if (field.depth(mx, mz) < 0) {
      lakeSide[ci(i, j)] = 1;
    } else if (hmax > LAKE_BED + 0.15) {
      cell[ci(i, j)] = 0;
    }
  }

  // ---- smooth normals from the grid (one-sided next to cuts and edges); returns |grad h|
  const grad1 = (h: number, ha: number, hb: number, va: boolean, vb: boolean, xa: number, x0: number, xb: number): number => {
    if (va && vb) return (hb - ha) / (xb - xa);
    if (vb) return (hb - h) / (xb - x0);
    if (va) return (h - ha) / (x0 - xa);
    return 0;
  };
  const normal = (i: number, j: number, out: number[]): number => {
    const h = H[gi(i, j)]!;
    const iL = Math.max(0, i - 1), iR = Math.min(nx - 1, i + 1), jU = Math.max(0, j - 1), jD = Math.min(nz - 1, j + 1);
    const gx = grad1(h, H[gi(iL, j)]!, H[gi(iR, j)]!, iL !== i && valid[gi(iL, j)] === 1, iR !== i && valid[gi(iR, j)] === 1, xs[iL]!, xs[i]!, xs[iR]!);
    const gz = grad1(h, H[gi(i, jU)]!, H[gi(i, jD)]!, jU !== j && valid[gi(i, jU)] === 1, jD !== j && valid[gi(i, jD)] === 1, zs[jU]!, zs[j]!, zs[jD]!);
    const l = Math.hypot(gx, 1, gz);
    out[0] = -gx / l; out[1] = 1 / l; out[2] = -gz / l;
    return Math.hypot(gx, gz);
  };

  const parts = [new Builder(), new Builder()];
  const vmap = [new Int32Array(nx * nz).fill(-1), new Int32Array(nx * nz).fill(-1)];
  const n3 = [0, 0, 0];
  const info = new Array<number>(INFO).fill(0);
  const surfaceVertex = (m: number, i: number, j: number): number => {
    const k = gi(i, j);
    const have = vmap[m]![k]!;
    if (have >= 0) return have;
    const x = xs[i]!, z = zs[j]!, h = H[k]!;
    const s = normal(i, j, n3);
    info[0] = KIND.surface;
    info[1] = h;
    info[2] = s;
    info[3] = Math.max(0, field.depth(x, z));
    info[4] = field.coast(x, z);
    info[5] = m === 1 ? 0.35 * field.forest(x, z, h) : field.forest(x, z, h);
    info[6] = fbm(x / 3.1, z / 3.1, 91);
    info[7] = fbm(x / 9, z / 9, 97);
    const v = parts[m]!.vertex(x, h, z, n3[0]!, n3[1]!, n3[2]!, info);
    vmap[m]![k] = v;
    return v;
  };

  for (let j = 0; j < ncz; j++) for (let i = 0; i < ncx; i++) {
    const m = cell[ci(i, j)]!;
    if (m < 0) continue;
    const a = surfaceVertex(m, i, j), b = surfaceVertex(m, i + 1, j), c = surfaceVertex(m, i, j + 1), d = surfaceVertex(m, i + 1, j + 1);
    const P = parts[m]!;
    const h00 = H[gi(i, j)]!, h10 = H[gi(i + 1, j)]!, h01 = H[gi(i, j + 1)]!, h11 = H[gi(i + 1, j + 1)]!;
    if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) { P.tri(a, c, d); P.tri(a, d, b); }
    else { P.tri(a, c, b); P.tri(b, c, d); }
  }

  // ---- skirts on cut boundaries: horizontal courses (crisp colour bands), each clipped under the sloped top edge
  /** Sutherland–Hodgman: keep the part of a (t, y) polygon under the line y = c0 + (c1 − c0)·t. */
  const clipUnder = (poly: Array<[number, number]>, c0: number, c1: number): Array<[number, number]> => {
    const f = (p: [number, number]) => c0 + (c1 - c0) * p[0] - p[1];
    const out: Array<[number, number]> = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!, b = poly[(k + 1) % poly.length]!, fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  };
  const skirt = (m: number, kind: number, x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, onx: number, onz: number, seg: number) => {
    const P = parts[m]!;
    const bottom = kind === KIND.strata ? -0.05 : -0.6;
    const top = Math.max(h0, h1);
    if (top <= bottom + 0.02) return;
    // (t, y) CCW polygons face along (edge × up); flip when that is not the outward normal
    const ex = x1 - x0, ez = z1 - z0;
    const flip = -ez * onx + ex * onz < 0;
    const emit = (poly: Array<[number, number]>, row: number, lip: boolean) => {
      if (poly.length < 3) return;
      const vs = poly.map(([t, y]) => {
        info[0] = kind; info[1] = row; info[2] = seg; info[3] = y; info[4] = lip ? 1 : 0;
        info[5] = hash01(seg * 7 + row * 131, kind); info[6] = 0; info[7] = 0;
        return P.vertex(x0 + ex * t, y, z0 + ez * t, onx, 0, onz, info);
      });
      for (let k = 1; k + 1 < vs.length; k++) {
        if (flip) P.tri(vs[0]!, vs[k + 1]!, vs[k]!);
        else P.tri(vs[0]!, vs[k]!, vs[k + 1]!);
      }
    };
    const lip = kind === KIND.strata ? 0.3 : 0;
    const levels: number[] = [];
    if (kind === KIND.strata) levels.push(bottom, 0.9, 2.6, 4.9, 7.6, 10.8, 14.4, 18.6, 30);
    else { const course = kind === KIND.stone ? 0.46 : 0.62; for (let y = bottom; y < top + course; y += course) levels.push(y); }
    const c0 = h0 - lip, c1 = h1 - lip;
    for (let r = 0; r + 1 < levels.length && levels[r]! < Math.max(c0, c1); r++) {
      const y0 = levels[r]!, y1 = levels[r + 1]!;
      emit(clipUnder([[0, y0], [1, y0], [1, y1], [0, y1]], c0, c1), r, false);
    }
    if (lip > 0) {
      const band = clipUnder([[0, Math.max(bottom, c0)], [1, Math.max(bottom, c1)], [1, top + 1], [0, top + 1]], h0, h1);
      emit(band, 99, true);
    }
  };

  let seg = 0;
  for (let j = 0; j < ncz; j++) for (let i = 0; i < ncx; i++) {
    const m = cell[ci(i, j)]!;
    if (m < 0) continue;
    // [di, dj, corner a (i, j offsets), corner b, outward normal]
    const sides: Array<[number, number, number, number, number, number, number, number]> = [
      [-1, 0, 0, 0, 0, 1, -1, 0], [1, 0, 1, 0, 1, 1, 1, 0], [0, -1, 0, 0, 1, 0, 0, -1], [0, 1, 0, 1, 1, 1, 0, 1],
    ];
    for (const [di, dj, ai, aj, bi, bj, onx, onz] of sides) {
      const ni = i + di, nj = j + dj;
      const outside = ni < 0 || nj < 0 || ni >= ncx || nj >= ncz;
      if (!outside) {
        const nk = ci(ni, nj);
        if (cell[nk]! >= 0 || lakeSide[nk] === 1) continue;
      }
      const ka = gi(i + ai, j + aj), kb = gi(i + bi, j + bj);
      const ha = H[ka]!, hb = H[kb]!;
      let kind: number;
      if (outside) kind = KIND.strata;
      else {
        const nmx = (xs[ni]! + xs[ni + 1]!) / 2, nmz = (zs[nj]! + zs[nj + 1]!) / 2;
        // spur walls facing a portal cut are masonry; everything else (road-portal cliffs) is rock
        kind = m === 1 && field.cut(nmx, nmz) ? KIND.stone : KIND.rock;
        if (Math.max(ha, hb) < 0.08) continue; // feet that meet the board flush need no wall
      }
      skirt(m, kind, xs[i + ai]!, zs[j + aj]!, ha, xs[i + bi]!, zs[j + bj]!, hb, onx, onz, seg++);
    }
  }
  return { band: parts[0]!.done(), spur: parts[1]!.done() };
}
