// Owner: S1. District ground areas: lawn, plaza (border band), parking (painted bays), sports (pitch lines) and
// garden (stone kerb, planted bed, flowers). Corners are softened; each area is a bevelled slab at its own height.
import { roundCorners } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { GroundArea } from '../districts/types';
import { area as loopArea, type Loop, pointInLoop } from './field';
import { type Mesher, offsetLoop, paintDisc, paintQuad, paintRing, slab } from './slab';
import { roleCount } from './roles';

export type PartFn = (role: string, idx?: number, detail?: boolean) => Mesher;

export interface AreaHeights { lawn: number; plaza: number; parking: number; sports: number; garden: number }
export interface AreaStats { parkingBays: number; sportsLines: number }
/** Outline of a built area (for walking-surface height queries). */
export interface AreaOutline { kind: GroundArea['kind']; loop: Loop; top: number }

const PAINT = 0.006;

/** Counter-clockwise copy of a polygon with rounded corners. */
function soften(poly: Vec2[], r: number): Loop {
  let pts = poly.map((p) => ({ x: p.x, z: p.z }));
  if (loopArea(pts) < 0) pts = pts.reverse();
  const out = roundCorners(pts, r, true, 5);
  return loopArea(out) < 0 ? out.reverse() : out;
}

/** Frame along the polygon's longest edge: u along it, v into the polygon, and the polygon's extents. */
function frameOf(poly: Loop): { o: Vec2; u: Vec2; v: Vec2; u0: number; u1: number; v0: number; v1: number; fill: number } {
  let best = 0, bi = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > best) { best = L; bi = i; }
  }
  const a = poly[bi]!, b = poly[(bi + 1) % poly.length]!;
  const u = { x: (b.x - a.x) / best, z: (b.z - a.z) / best };
  const v = { x: -u.z, z: u.x }; // left of the edge = inside (CCW polygon)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of poly) {
    const pu = (p.x - a.x) * u.x + (p.z - a.z) * u.z, pv = (p.x - a.x) * v.x + (p.z - a.z) * v.z;
    u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
  }
  const fill = Math.abs(loopArea(poly)) / Math.max(1e-6, (u1 - u0) * (v1 - v0));
  return { o: a, u, v, u0, u1, v0, v1, fill };
}

const at = (f: ReturnType<typeof frameOf>, pu: number, pv: number): Vec2 =>
  ({ x: f.o.x + f.u.x * pu + f.v.x * pv, z: f.o.z + f.u.z * pu + f.v.z * pv });

/** Deterministic 0..1 hash of a position (flower colours, parked-car choices). */
export function hash2(x: number, z: number, k = 0): number {
  let h = Math.imul(Math.round(x * 100) | 0, 73856093) ^ Math.imul(Math.round(z * 100) | 0, 19349663) ^ Math.imul(k + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function buildAreas(areas: GroundArea[], H: AreaHeights, part: PartFn): { stats: AreaStats; outlines: AreaOutline[] } {
  const stats: AreaStats = { parkingBays: 0, sportsLines: 0 };
  const outlines: AreaOutline[] = [];
  for (const a of areas) {
    if (a.polygon.length < 3 || Math.abs(loopArea(a.polygon)) < 0.5) continue;
    const raw = loopArea(a.polygon) < 0 ? [...a.polygon].reverse() : a.polygon;
    switch (a.kind) {
      case 'lawn': {
        const loop = soften(raw, 0.45);
        slab([{ outer: loop, holes: [] }], { top: H.lawn, bevel: 0.018 }, part('lawn'), part('lawn'));
        outlines.push({ kind: a.kind, loop, top: H.lawn });
        break;
      }
      case 'plaza': {
        const loop = soften(raw, 0.3);
        slab([{ outer: loop, holes: [] }], { top: H.plaza, bevel: 0.016 }, part('ssPlazaEdge'), part('ssCurb'));
        const inner = offsetLoop(loop, 0.3);
        slab([{ outer: inner, holes: [] }], { top: H.plaza + 0.004, base: H.plaza }, part('ssPlaza'), part('ssPlaza'));
        outlines.push({ kind: a.kind, loop, top: H.plaza });
        break;
      }
      case 'parking': {
        const loop = soften(raw, 0.25);
        slab([{ outer: loop, holes: [] }], { top: H.parking, bevel: 0.014 }, part('ssLot'), part('ssCurb'));
        stats.parkingBays += parkingBays(raw, H.parking + PAINT, part('ssLine'));
        outlines.push({ kind: a.kind, loop, top: H.parking });
        break;
      }
      case 'sports': {
        const loop = soften(raw, 0.3);
        slab([{ outer: loop, holes: [] }], { top: H.sports, bevel: 0.014 }, part('field'), part('field'));
        stats.sportsLines += pitchLines(raw, H.sports + PAINT, part('ssLine'));
        outlines.push({ kind: a.kind, loop, top: H.sports });
        break;
      }
      case 'garden': {
        const loop = soften(raw, 0.35);
        const inner = offsetLoop(loop, 0.13);
        const rimTop = H.garden + 0.025;
        slab([{ outer: loop, holes: [[...inner].reverse()] }], { top: rimTop, bevel: 0.015 }, part('ssRim'), part('ssRim'));
        slab([{ outer: inner, holes: [] }], { top: H.garden }, part('ssBed'), part('ssRim'));
        flowers(inner, H.garden + PAINT, part);
        outlines.push({ kind: a.kind, loop, top: H.garden });
        break;
      }
    }
  }
  return { stats, outlines };
}

/** Bays along the long side (two rows facing an aisle when the lot is deep enough). Returns the bay count. */
function parkingBays(poly: Loop, y: number, line: Mesher): number {
  const f = frameOf(poly);
  const BAY_W = 1.05, BAY_D = 1.8, AISLE = 1.4, M = 0.2, LW = 0.06;
  const len = f.u1 - f.u0 - 2 * M, depth = f.v1 - f.v0;
  const n = Math.floor(len / BAY_W);
  if (n < 1 || depth < BAY_D + 0.3) return 0;
  const rows: Array<[number, number]> = [[f.v0 + 0.15, f.v0 + 0.15 + BAY_D]];
  if (depth >= 2 * BAY_D + AISLE + 0.3) rows.push([f.v1 - 0.15 - BAY_D, f.v1 - 0.15]);
  const start = f.u0 + (f.u1 - f.u0 - n * BAY_W) / 2;
  let bays = 0;
  for (const [va, vb] of rows) {
    let drawn = 0;
    for (let k = 0; k <= n; k++) {
      const pu = start + k * BAY_W;
      const p0 = at(f, pu, va), p1 = at(f, pu, vb);
      if (!pointInLoop(p0, poly) || !pointInLoop(p1, poly)) continue;
      const c = at(f, pu, (va + vb) / 2);
      paintQuad(line, c.x, c.z, f.v, vb - va, LW, y);
      drawn++;
    }
    bays += Math.max(0, drawn - 1);
  }
  return bays;
}

/** Pitch markings inside a roughly rectangular field: touchline box, halfway line, centre circle + spot, two
 *  goal boxes. Returns the number of line pieces painted. */
function pitchLines(poly: Loop, y: number, line: Mesher): number {
  const f = frameOf(poly);
  if (f.fill < 0.82) return 0;
  const LW = 0.07, I = 0.3;
  const u0 = f.u0 + I, u1 = f.u1 - I, v0 = f.v0 + I, v1 = f.v1 - I;
  const L = u1 - u0, D = v1 - v0;
  if (L < 1.5 || D < 1.2) return 0;
  const mid = (a: number, b: number) => (a + b) / 2;
  let n = 0;
  const seg = (pa: number, va: number, pb: number, vb: number) => {
    const a = at(f, pa, va), b = at(f, pb, vb);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const u = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    paintQuad(line, (a.x + b.x) / 2, (a.z + b.z) / 2, u, len + LW, LW, y);
    n++;
  };
  seg(u0, v0, u1, v0); seg(u1, v0, u1, v1); seg(u1, v1, u0, v1); seg(u0, v1, u0, v0);
  const um = mid(u0, u1), vm = mid(v0, v1);
  seg(um, v0, um, v1);
  const c = at(f, um, vm);
  const r = Math.min(D * 0.2, L * 0.14, 1.0);
  paintRing(line, c.x, c.z, r, LW, y, 28); n++;
  paintDisc(line, c.x, c.z, LW * 1.1, y, 10);
  const bw = D * 0.44, bd = Math.min(L * 0.13, 1.1);
  for (const [ue, s] of [[u0, 1], [u1, -1]] as const) {
    seg(ue, vm - bw / 2, ue + s * bd, vm - bw / 2);
    seg(ue + s * bd, vm - bw / 2, ue + s * bd, vm + bw / 2);
    seg(ue + s * bd, vm + bw / 2, ue, vm + bw / 2);
  }
  return n;
}

/** Flower dots scattered over a planted bed (deterministic per position). */
function flowers(bed: Loop, y: number, part: PartFn): void {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of bed) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const step = 0.34, colours = roleCount('ssFlower');
  for (let z = z0 + step / 2; z < z1; z += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const jx = (hash2(x, z, 1) - 0.5) * step * 0.7, jz = (hash2(x, z, 2) - 0.5) * step * 0.7;
      const p = { x: x + jx, z: z + jz };
      if (hash2(x, z, 3) < 0.35 || !pointInLoop(p, bed)) continue;
      // keep clear of the kerb
      const idx = Math.floor(hash2(x, z, 4) * colours) % colours;
      paintDisc(part('ssFlower', idx, true), p.x, p.z, 0.065 + hash2(x, z, 5) * 0.03, y, 7);
    }
  }
}
