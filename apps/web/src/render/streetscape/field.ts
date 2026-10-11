// Owner: S1. Sampled distance fields on a regular grid and marching-squares contours → closed loops.
// Every ground surface is the zero set of a field (negative inside), so road/sidewalk/path unions, rounded curb
// corners, rail cut-outs and board clipping are just min/max of fields. Straight edges come out exact (the fields
// are linear there); curves are resolved at the grid spacing.
import type { Vec2 } from '@headway/sim';

/** Sample (i, j) sits at (x0 + i·c, z0 + j·c); i < nx, j < nz. */
export interface Grid { x0: number; z0: number; c: number; nx: number; nz: number }
/** Closed loop (no repeated end point). Contours keep the region on the LEFT (x right, z up): outer loops are
 *  counter-clockwise (positive area), holes clockwise. */
export type Loop = Vec2[];
export interface Poly { outer: Loop; holes: Loop[] }

export function makeGrid(b: { minX: number; maxX: number; minZ: number; maxZ: number }, c: number, pad = 3): Grid {
  return {
    x0: b.minX - pad * c,
    z0: b.minZ - pad * c,
    c,
    nx: Math.ceil((b.maxX - b.minX) / c - 1e-9) + 2 * pad + 1,
    nz: Math.ceil((b.maxZ - b.minZ) / c - 1e-9) + 2 * pad + 1,
  };
}

export function field(g: Grid, fill: number): Float32Array {
  return new Float32Array(g.nx * g.nz).fill(fill);
}

export function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
  let t = L > 0 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + vx * t - p.x, dz = a.z + vz * t - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function polyDist(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i]!, pts[i + 1]!));
  if (closed && pts.length > 2) best = Math.min(best, segDist(p, pts[pts.length - 1]!, pts[0]!));
  return best;
}

/** Cell window [i0, j0, i1, j1] (inclusive sample indices) covering a box grown by `reach`. */
export function windowOf(g: Grid, minX: number, minZ: number, maxX: number, maxZ: number, reach: number): [number, number, number, number] {
  return [
    Math.max(0, Math.floor((minX - reach - g.x0) / g.c)),
    Math.max(0, Math.floor((minZ - reach - g.z0) / g.c)),
    Math.min(g.nx - 1, Math.ceil((maxX + reach - g.x0) / g.c)),
    Math.min(g.nz - 1, Math.ceil((maxZ + reach - g.z0) / g.c)),
  ];
}

/** f = min(f, |p − ab| + bias) for samples within `reach` of segment ab. */
export function stampSegment(g: Grid, f: Float32Array, a: Vec2, b: Vec2, reach: number, bias = 0): void {
  const [i0, j0, i1, j1] = windowOf(g, Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z), reach);
  const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
  for (let j = j0; j <= j1; j++) {
    const z = g.z0 + j * g.c;
    for (let i = i0; i <= i1; i++) {
      const x = g.x0 + i * g.c;
      let t = L > 0 ? ((x - a.x) * vx + (z - a.z) * vz) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = a.x + vx * t - x, dz = a.z + vz * t - z;
      const d = Math.sqrt(dx * dx + dz * dz) + bias;
      const k = j * g.nx + i;
      if (d < f[k]!) f[k] = d;
    }
  }
}

/** Stamp every segment of a polyline. */
export function stampPolyline(g: Grid, f: Float32Array, pts: Vec2[], closed: boolean, reach: number, bias = 0): void {
  for (let i = 0; i + 1 < pts.length; i++) stampSegment(g, f, pts[i]!, pts[i + 1]!, reach, bias);
  if (closed && pts.length > 2) stampSegment(g, f, pts[pts.length - 1]!, pts[0]!, reach, bias);
}

/** Polynomial smooth minimum (k = blend width): rounds the joint where two fields meet. */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Closed loops where f crosses 0 (region f < 0 on the left). Cells are scanned inside the sample window
 * [i0, j0, i1, j1]; the window border samples must be ≥ 0 so every loop closes. Saddles resolve by the cell mean.
 */
export function contours(g: Grid, f: Float32Array, win: [number, number, number, number] = [0, 0, g.nx - 1, g.nz - 1]): Loop[] {
  const { nx, nz } = g;
  const [i0, j0, i1, j1] = win;
  const V = nx * nz;
  const next = new Map<number, number>();
  const pt = new Map<number, Vec2>();
  const point = (id: number): Vec2 => {
    let p = pt.get(id);
    if (p) return p;
    const vert = id >= V;
    const k = vert ? id - V : id;
    const i = k % nx, j = (k - i) / nx;
    const a = f[k]!, b = f[vert ? k + nx : k + 1]!;
    const t = a / (a - b);
    p = vert ? { x: g.x0 + i * g.c, z: g.z0 + (j + t) * g.c } : { x: g.x0 + (i + t) * g.c, z: g.z0 + j * g.c };
    pt.set(id, p);
    return p;
  };
  const ids = [0, 0, 0, 0];
  const kind = [0, 0, 0, 0];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k0 = j * nx + i, k1 = k0 + 1, k2 = k0 + nx + 1, k3 = k0 + nx;
      const f0 = f[k0]!, f1 = f[k1]!, f2 = f[k2]!, f3 = f[k3]!;
      const in0 = f0 < 0, in1 = f1 < 0, in2 = f2 < 0, in3 = f3 < 0;
      if (in0 === in1 && in1 === in2 && in2 === in3) continue;
      // Cell edges in counter-clockwise order: bottom (k0→k1), right (k1→k2), top (k2→k3), left (k3→k0).
      ids[0] = k0; ids[1] = V + k1; ids[2] = k3; ids[3] = V + k0;
      kind[0] = in0 === in1 ? 0 : in0 ? 1 : -1; // 1 = leaving the region, -1 = entering it
      kind[1] = in1 === in2 ? 0 : in1 ? 1 : -1;
      kind[2] = in2 === in3 ? 0 : in2 ? 1 : -1;
      kind[3] = in3 === in0 ? 0 : in3 ? 1 : -1;
      let n = 0;
      for (let e = 0; e < 4; e++) if (kind[e] !== 0) n++;
      if (n === 2) {
        let ex = -1, en = -1;
        for (let e = 0; e < 4; e++) { if (kind[e] === 1) ex = ids[e]!; else if (kind[e] === -1) en = ids[e]!; }
        next.set(ex, en);
      } else {
        const centreIn = (f0 + f1 + f2 + f3) / 4 < 0;
        for (let e = 0; e < 4; e++) {
          if (kind[e] !== 1) continue;
          const step = centreIn ? 1 : 3; // next (centre inside) or previous (centre outside) crossing in CCW order
          let m = (e + step) % 4;
          while (kind[m] !== -1) m = (m + step) % 4;
          next.set(ids[e]!, ids[m]!);
        }
      }
    }
  }
  const loops: Loop[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec2[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(point(cur));
      cur = next.get(cur);
    }
    if (cur === start && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export function area(l: Loop): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i]!, q = l[(i + 1) % l.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function pointInLoop(p: Vec2, l: Loop): boolean {
  let inside = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const a = l[i]!, b = l[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Douglas–Peucker on a closed loop: drops points within `tol` of the simplified outline (straight runs → 2 points). */
export function simplify(loop: Loop, tol = 0.002): Loop {
  const pts: Vec2[] = [];
  for (const p of loop) {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-7 || Math.abs(last.z - p.z) > 1e-7) pts.push(p);
  }
  while (pts.length > 1 && Math.abs(pts[0]!.x - pts[pts.length - 1]!.x) <= 1e-7 && Math.abs(pts[0]!.z - pts[pts.length - 1]!.z) <= 1e-7) pts.pop();
  const n = pts.length;
  if (n < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i]!.x - pts[0]!.x) ** 2 + (pts[i]!.z - pts[0]!.z) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = 1; keep[far] = 1; keep[n] = 1;
  const at = (i: number) => pts[i % n]!;
  const stack: Array<[number, number]> = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(at(i), at(a), at(b));
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]!);
  return out;
}

/** Group loops into outer boundaries with their holes (each hole goes to the smallest outer containing it). */
export function nest(loops: Loop[]): Poly[] {
  const outers = loops.filter((l) => area(l) > 0).map((l) => ({ outer: l, holes: [] as Loop[], a: area(l) }));
  outers.sort((p, q) => p.a - q.a);
  for (const h of loops) {
    const ha = area(h);
    if (ha >= 0) continue;
    const o = outers.find((c) => c.a > -ha && pointInLoop(h[0]!, c.outer));
    if (o) o.holes.push(h);
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

/** Extract, simplify and nest the region f < 0 inside a window. Tiny specks (area < minArea) are dropped. */
export function regions(g: Grid, f: Float32Array, win?: [number, number, number, number], tol = 0.002, minArea = 0.02): Poly[] {
  const loops = contours(g, f, win).map((l) => simplify(l, tol)).filter((l) => l.length >= 3 && Math.abs(area(l)) >= minArea);
  return nest(loops);
}
