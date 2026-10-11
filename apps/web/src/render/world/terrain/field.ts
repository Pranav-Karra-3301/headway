// Owner: E1. Terrain field: pure math (no three.js) for the land around the town board.
//  - Nittany Ridge: layered ridges (foothills → mid ridge → crest with named peaks) on the north + west sides,
//    rising from the board edge and tapering into rocky headlands where it meets Nittany Lake (NE + SW corners).
//  - The rail-tunnel spur: a loaf-shaped foothill over `layout.railTunnel` on the board's west strip, split into
//    separate tunnels wherever a road crosses the track (a stone-lined cutting keeps the road and crossing open).
//  - Portal sites: one stone portal per road exit on a mountain side, two per rail tunnel.
// Everything that draws terrain (mesh, forests, rocks) and the tests reads these functions.
import { pointAt, polyline, projectOnPolyline } from '@headway/sim';
import type { Polyline, TownMap, Vec2 } from '@headway/sim';
import type { WorldLayout } from '../layout';

/** Lake surface (E2's WATER_Y): land is wherever the terrain stands above it. */
export const WATER_LEVEL = -0.75;
/** Lake bed under the headland shores (E2's LAKE_BED_Y). */
export const LAKE_BED = -2.4;
export const MAX_HEIGHT = 22;
/** Half the width of TOWN's roads (2.4 u). */
export const ROAD_HALF = 1.2;

export interface PortalDims {
  /** Facade half-width. */ half: number;
  /** Opening half-width (= arch radius). */ open: number;
  /** Height where the arch springs. */ spring: number;
  /** Facade (parapet) height. */ top: number;
  /** Facade depth in front of the cut. */ depth: number;
}
/** Rail portal: 2.3 u opening for the 1.36 u × 1.82 u train. */
export const RAIL_PORTAL: PortalDims = { half: 2.05, open: 1.15, spring: 1.55, top: 3.4, depth: 0.6 };
/** Road portal: 3.4 u opening for the 2.4 u road. */
export const ROAD_PORTAL: PortalDims = { half: 2.8, open: 1.7, spring: 1.35, top: 4.0, depth: 0.7 };

export interface PortalSite {
  kind: 'road' | 'rail';
  /** Exit edge id (road) or `rail:<from>:<end>`. */
  id: string;
  /** Centre of the cut plane at ground level; the facade stands in front of it (toward `face`). */
  x: number;
  z: number;
  /** Unit normal of the portal front, pointing out of the tunnel. */
  face: Vec2;
  half: number;
  top: number;
}
export interface TunnelSpan { fromDist: number; toDist: number }

export interface TerrainField {
  readonly board: TownMap['bounds'];
  readonly extent: WorldLayout['extent'];
  readonly portals: PortalSite[];
  /** Covered rail spans (arc distance along the loop); a portal stands at both ends of each. */
  readonly tunnels: TunnelSpan[];
  /** Headland tips (a little inland of the point) where the ridge meets the lake: NE, then SW. */
  readonly headlands: Vec2[];
  /** Terrain surface height (board top = 0). Board and lake-side ground are below 0 (no terrain drawn there). */
  height(x: number, z: number): number;
  /** Signed distance to the headland coastline (> 0 inland). */
  coast(x: number, z: number): number;
  /** Distance beyond the board on the mountain sides (< 0 on the board and the lake sides). */
  depth(x: number, z: number): number;
  /** 0 = mountain band (outside the board), 1 = rail-tunnel spur (on the board), -1 = no terrain. */
  region(x: number, z: number): -1 | 0 | 1;
  /** True in front of a portal, where terrain must stay open (the facade covers the cut). */
  cut(x: number, z: number): boolean;
  /** Tree density 0..1 (forest patches, thinning toward the summits); pass `h` when already known. */
  forest(x: number, z: number, h?: number): number;
  /** |∇h| by central differences. */
  slope(x: number, z: number): number;
}

// ---------------------------------------------------------------- math helpers
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const bump = (u: number): number => (u <= -1 || u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Polynomial smooth min (≤ min(a, b)). */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** Soft union of two heights that never lifts bare ground (a zero stays zero). */
function sunion(a: number, b: number, k: number): number {
  const m = Math.max(a, b), lo = Math.min(a, b);
  if (lo <= 0) return m;
  const g = Math.max(0, k - Math.abs(a - b)) / k;
  return m + g * g * k * 0.25 * smooth(0, k, lo);
}

function hash(i: number, j: number, s: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(s + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [-1, 1]. */
export function noise2(x: number, z: number, s: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(x: number, z: number, s: number, oct = 3): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise2(x * f + o * 17.31, z * f - o * 9.13, s + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- shape constants
/** Named peaks along the crest: x, z, extra height, radius. Mount Nittany sits right of centre on screen. */
const PEAKS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-12, -51, 7.5, 10],
  [-58, -13, 5.0, 9],
  [-50, -47, 3.0, 11],
  [21, -50, 2.5, 10],
  [-60, 21, 1.5, 9],
];
/** Rocky islets off the headland points: x, z, height, radius (they ignore the coastal fade). */
const STACKS: ReadonlyArray<readonly [number, number, number, number]> = [
  [57.5, -36.5, 0.5, 2.1],
  [-48.5, 49, 0.4, 1.9],
];
const SPUR = { top: 3.7, edge: 4.9, gap: 1.7, minLen: 2.4, sidewalk: 0.6, maxIn: 2.6, wing: 2.6 } as const;
const MOUND = { top: 3.75, reach: 8.5, behind: 14 } as const;
const COVER = { top: 4.6, flat: 2.4, fall: 6 } as const;

interface Span {
  from: number;
  to: number;
  poly: Polyline;
  /** +1 when the left normal (-t.z, t.x) points into town. */
  side: number;
  /** Inward foot distance (stays clear of the next road's sidewalk). */
  win: number;
  /** Track → board edge along the outward normal. */
  edgeDist: number;
  /** Off the board (a tunnel under the mountain band, covered by `cover`) rather than an on-board spur. */
  band: boolean;
}

export function createTerrainField(map: TownMap, layout: WorldLayout): TerrainField {
  const B = map.bounds, E = layout.extent;
  const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;

  // ---- roads as segments (for clearance)
  const segs: number[] = [];
  for (const e of map.roads.edges) {
    const p = e.path.points;
    for (let i = 0; i + 1 < p.length; i++) segs.push(p[i]!.x, p[i]!.z, p[i + 1]!.x, p[i + 1]!.z);
  }
  const roadDist = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i += 4) {
      const ax = segs[i]!, az = segs[i + 1]!, dx = segs[i + 2]! - ax, dz = segs[i + 3]! - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / l2) : 0;
      const ex = x - ax - dx * t, ez = z - az - dz * t;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
  const inBoard = (x: number, z: number) => x > B.minX && x < B.maxX && z > B.minZ && z < B.maxZ;

  // ---- rail tunnel spans: the layout span minus road crossings (each crossing becomes an open cutting)
  const loop = map.rail.loop;
  const spans: Span[] = [];
  const tangent = (poly: Polyline, d: number): Vec2 => {
    const h = pointAt(poly, d).heading;
    return { x: Math.cos(h), z: -Math.sin(h) };
  };
  if (layout.railTunnel) {
    let from = layout.railTunnel.fromDist, to = layout.railTunnel.toDist;
    if (to < from) to += loop.length;
    // An end that lies off the board (in the mountains) grows to the board edge, so the whole off-board run is
    // underground and both portals stand at the board edge, facing the town (and the camera).
    const off = (d: number) => { const p = pointAt(loop, d); return p.x < B.minX || p.z < B.minZ; };
    const grow = (d: number, dir: 1 | -1): number => {
      if (!off(d)) return d;
      let a = d;
      for (let k = 0; k < 2000 && off(a + dir * 0.1); k++) a += dir * 0.1;
      let b = a + dir * 0.1; // first on-board sample: bisect to the board edge
      for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (off(m)) a = m; else b = m; }
      return a;
    };
    from = grow(from, -1);
    to = grow(to, 1);
    if (from < 0) { from += loop.length; to += loop.length; }
    const need = ROAD_HALF + SPUR.gap;
    const free = (d: number) => { const p = pointAt(loop, d); return roadDist(p.x, p.z) >= need; };
    const edge = (a: number, b: number) => { // a free, b blocked (or vice versa): bisect to the boundary
      const fa = free(a);
      for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (free(m) === fa) a = m; else b = m; }
      return (a + b) / 2;
    };
    const step = 0.1, n = Math.max(1, Math.ceil((to - from) / step));
    let runStart: number | null = null;
    let prev = from;
    const close = (end: number) => {
      if (runStart !== null && end - runStart >= SPUR.minLen) spans.push(makeSpan(runStart, end));
      runStart = null;
    };
    for (let i = 0; i <= n; i++) {
      const d = i === n ? to : from + i * step;
      const ok = free(d);
      if (ok && runStart === null) runStart = i === 0 ? from : edge(prev, d);
      if (!ok && runStart !== null) close(edge(prev, d));
      prev = d;
    }
    close(to);
  }
  // Band (off-board) tunnels: slide each end's portal into the ridge until the back corners of a facade set square to
  // the track stand off the board, so the hill rises right behind it (and a short open forecourt runs to the edge).
  const offB = (x: number, z: number) => x < B.minX || z < B.minZ;
  function bandInset(d0: number, dir: 1 | -1): number {
    const w = RAIL_PORTAL.half + 0.15;
    for (let k = 0; k <= 5; k += 0.05) {
      const p = pointAt(loop, d0 + dir * k), t = tangent(loop, d0 + dir * k);
      const fx = -dir * t.x, fz = -dir * t.z; // out of the tunnel
      const bx = p.x - fx * 0.35, bz = p.z - fz * 0.35;
      if (offB(bx - fz * w, bz + fx * w) && offB(bx + fz * w, bz - fx * w)) return k;
    }
    return 5;
  }
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!;
    if (!s.band) continue;
    const a = s.from + bandInset(s.from, 1), b = s.to - bandInset(s.to, -1);
    if (b - a >= SPUR.minLen) spans[i] = makeSpan(a, b);
  }

  function makeSpan(from: number, to: number): Span {
    const pts: Vec2[] = [];
    const n = Math.max(2, Math.ceil((to - from) / 0.5));
    for (let i = 0; i <= n; i++) { const p = pointAt(loop, from + ((to - from) * i) / n); pts.push({ x: p.x, z: p.z }); }
    const poly = polyline(pts, false);
    const mid = pointAt(poly, poly.length / 2), t = tangent(poly, poly.length / 2);
    const side = (-t.z * (cx - mid.x) + t.x * (cz - mid.z)) >= 0 ? 1 : -1;
    const nIn = { x: -t.z * side, z: t.x * side };
    // inward foot: march toward town until the next road's sidewalk
    let win: number = SPUR.maxIn;
    for (let s = 0; s <= poly.length; s += 0.5) {
      const p = pointAt(poly, s), tt = tangent(poly, s), ni = { x: -tt.z * side, z: tt.x * side };
      for (let u = 0.5; u <= SPUR.maxIn; u += 0.05) {
        if (roadDist(p.x + ni.x * u, p.z + ni.z * u) < ROAD_HALF + SPUR.sidewalk) { win = Math.min(win, u); break; }
      }
    }
    // outward: distance to the board edge
    const ox = -nIn.x, oz = -nIn.z;
    const tx = ox < -1e-9 ? (mid.x - B.minX) / -ox : ox > 1e-9 ? (B.maxX - mid.x) / ox : Infinity;
    const tz = oz < -1e-9 ? (mid.z - B.minZ) / -oz : oz > 1e-9 ? (B.maxZ - mid.z) / oz : Infinity;
    const band = mid.x < B.minX || mid.z < B.minZ;
    return { from, to, poly, side, win, edgeDist: Math.max(0, Math.min(tx, tz)), band };
  }

  /** Rail portal at one end of a span (0 = from, 1 = to): square to the track, facing out along it. */
  function railFace(s: Span, end: 0 | 1): { p: Vec2; face: Vec2 } {
    const d = end === 0 ? 0 : s.poly.length, sign = end === 0 ? -1 : 1;
    const p = pointAt(s.poly, d), t = tangent(s.poly, d);
    return { p: { x: p.x, z: p.z }, face: { x: t.x * sign, z: t.z * sign } };
  }
  const spurSpans = spans.filter((s) => !s.band), bandSpans = spans.filter((s) => s.band);
  // spur bounding box (quick reject)
  const sb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const s of spurSpans) for (const p of s.poly.points) {
    const r = s.edgeDist + 10;
    sb.minX = Math.min(sb.minX, p.x - r); sb.maxX = Math.max(sb.maxX, p.x + r);
    sb.minZ = Math.min(sb.minZ, p.z - r); sb.maxZ = Math.max(sb.maxZ, p.z + r);
  }

  /** Spur height (0 = none) and whether (x, z) lies in a rail portal's open cut. */
  const spurOut = { h: 0, cut: false };
  function spur(x: number, z: number): typeof spurOut {
    spurOut.h = 0;
    spurOut.cut = false;
    if (x < sb.minX || x > sb.maxX || z < sb.minZ || z > sb.maxZ) return spurOut;
    let h = 0;
    for (const s of spurSpans) {
      const pr = projectOnPolyline(s.poly, { x, z });
      const t = tangent(s.poly, pr.dist);
      const rx = x - pr.x, rz = z - pr.z;
      let beyond = 0;
      if (pr.dist <= 1e-6) beyond = Math.max(0, -(rx * t.x + rz * t.z));
      else if (pr.dist >= s.poly.length - 1e-6) beyond = Math.max(0, rx * t.x + rz * t.z);
      const u = (rx * -t.z + rz * t.x) * s.side; // + toward town
      if (beyond > 0 && Math.abs(u) <= RAIL_PORTAL.half && beyond < 4) { spurOut.cut = true; continue; }
      let lat: number;
      if (u >= 0) lat = u >= s.win ? 0 : SPUR.top * (1 - Math.pow(smooth(0.25, 1, u / s.win), 1.6));
      else lat = (SPUR.top + (SPUR.edge - SPUR.top) * smooth(0, s.edgeDist, -u)) * smooth(s.edgeDist + 9, s.edgeDist + 3, -u);
      const along = beyond <= 0 ? 1 : u < 0 ? smooth(SPUR.wing, 0, beyond) : 0;
      h = Math.max(h, lat * along);
    }
    if (h > 0) h *= smooth(ROAD_HALF + 0.25, ROAD_HALF + 1.1, roadDist(x, z));
    spurOut.h = h;
    return spurOut;
  }

  /** Roof over the off-board (band) tunnels: a broad loaf along the buried track, so the mountains never dip low
   *  enough over it to show the train. Applied only beyond the board edge, and never in front of a portal. */
  const cb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const s of bandSpans) for (const p of s.poly.points) {
    const r = COVER.flat + COVER.fall + 1;
    cb.minX = Math.min(cb.minX, p.x - r); cb.maxX = Math.max(cb.maxX, p.x + r);
    cb.minZ = Math.min(cb.minZ, p.z - r); cb.maxZ = Math.max(cb.maxZ, p.z + r);
  }
  function cover(x: number, z: number): number {
    if (x < cb.minX || x > cb.maxX || z < cb.minZ || z > cb.maxZ) return 0;
    let h = 0;
    for (const s of bandSpans) {
      const pr = projectOnPolyline(s.poly, { x, z });
      const t = tangent(s.poly, pr.dist);
      const rx = x - pr.x, rz = z - pr.z;
      if (pr.dist <= 1e-6 && rx * t.x + rz * t.z < -1e-6) continue;
      if (pr.dist >= s.poly.length - 1e-6 && rx * t.x + rz * t.z > 1e-6) continue;
      const u = Math.abs(rx * -t.z + rz * t.x);
      h = Math.max(h, COVER.top * (1 - smooth(COVER.flat, COVER.flat + COVER.fall, u)));
    }
    return h;
  }

  // ---- portal mounds: road exits on the mountain sides, and band tunnels whose portals stand at the board edge
  const exits = layout.exits.filter((e) => e.kind === 'tunnel');
  const moundSites: Array<{ p: Vec2; dir: Vec2; half: number }> = exits.map((e) => ({ p: e.p, dir: e.dir, half: ROAD_PORTAL.half }));
  for (const s of bandSpans) for (const end of [0, 1] as const) {
    const f = railFace(s, end);
    moundSites.push({ p: f.p, dir: { x: -f.face.x, z: -f.face.z }, half: RAIL_PORTAL.half });
  }
  function mound(x: number, z: number): number {
    let m = 0;
    for (const e of moundSites) {
      const rx = x - e.p.x, rz = z - e.p.z;
      const o = rx * e.dir.x + rz * e.dir.z;
      if (o < 0) continue;
      const a = Math.abs(-rx * e.dir.z + rz * e.dir.x);
      const along = a <= e.half + 0.4 ? 1 : smooth(MOUND.reach, e.half + 0.4, a);
      if (along <= 0) continue;
      m = Math.max(m, MOUND.top * along * (1 + 0.3 * smooth(0, 6, o)) * smooth(MOUND.behind, 7, o));
    }
    return m;
  }
  /** 0 on the open forecourt in front of a band rail portal (the ridge kept off the track up to the board edge). */
  const railMouths = moundSites.slice(exits.length);
  function forecourt(x: number, z: number): number {
    let k = 1;
    for (const e of railMouths) {
      const rx = x - e.p.x, rz = z - e.p.z;
      const o = -(rx * e.dir.x + rz * e.dir.z);
      if (o < 0 || o > 7) continue;
      const a = Math.abs(-rx * e.dir.z + rz * e.dir.x);
      k = Math.min(k, Math.max(smooth(RAIL_PORTAL.half + 0.3, RAIL_PORTAL.half + 2.6, a), smooth(4.5, 7, o)));
    }
    return k;
  }
  function roadPortalCut(x: number, z: number): boolean {
    for (const e of exits) {
      const rx = x - e.p.x, rz = z - e.p.z;
      const o = rx * e.dir.x + rz * e.dir.z;
      if (o >= 0 || o < -4.5) continue;
      if (Math.abs(-rx * e.dir.z + rz * e.dir.x) <= ROAD_PORTAL.half + 0.3) return true;
    }
    return false;
  }

  // ---- coast: the shore lines of the layout, bulging out into headlands beyond the board's NE / SW corners
  const xCoast = (t: number) => layout.shore.east + 3.5 * smooth(0, 10, t) + 12 * bump((t - 18) / 11) + 4 * bump((t - 21.5) / 5);
  const zCoast = (t: number) => layout.shore.south + 3 * smooth(0, 10, t) + 11 * bump((t - 17) / 10) + 4 * bump((t - 20) / 5);
  function coast(x: number, z: number): number {
    const tN = B.minZ - z, tW = B.minX - x;
    const le = (tN > 0 ? xCoast(tN) : layout.shore.east) - x;
    const ls = (tW > 0 ? zCoast(tW) : layout.shore.south) - z;
    return Math.min(le, ls);
  }
  const tipOf = (fn: (t: number) => number) => {
    let bt = 0, bv = -Infinity;
    for (let t = 0; t <= 34; t += 0.25) { const v = fn(t); if (v > bv) { bv = v; bt = t; } }
    return { t: bt, v: bv };
  };
  const ne = tipOf(xCoast), sw = tipOf(zCoast);

  /** 1 where E2's beach strips extend past the board's NE / SW corners (8 u), fading out beyond. */
  const beachZone = (x: number, z: number): number =>
    Math.max(smooth(B.maxX - 1, B.maxX + 1, x) * smooth(B.minZ - 10, B.minZ - 7, z), smooth(B.maxZ - 1, B.maxZ + 1, z) * smooth(B.minX - 10, B.minX - 7, x));

  // ---- Nittany Ridge
  const depth = (x: number, z: number): number => {
    const dN = B.minZ - z, dW = B.minX - x;
    return dN > 0 && dW > 0 ? Math.hypot(dN, dW) : Math.max(dN, dW);
  };
  function ridge(x: number, z: number, d: number): number {
    // three layers (foothills → mid ridge → crest), each broken into a chain of hills by an along-band
    // modulation, with real valleys between the layers so the iso view reads them as stacked silhouettes
    const t = d + 3.4 * fbm(x / 17, z / 17, 11);
    const a1 = 0.55 + 0.45 * fbm(x / 8.5, z / 8.5, 21), a2 = 0.6 + 0.4 * fbm(x / 12, z / 12, 31), a3 = 0.7 + 0.3 * fbm(x / 17, z / 17, 41);
    let pk = 0;
    for (const [px, pz, ph, pr] of PEAKS) { const dx = x - px, dz = z - pz; pk += ph * Math.exp(-(dx * dx + dz * dz) / (pr * pr)); }
    const r1 = 5.4 * a1 * bump((t - 6.6) / 4.8);
    const r2 = (10.8 * a2 + 0.35 * pk) * bump((t - 15.6) / 6);
    const r3 = (15 * a3 + pk) * bump((t - 26.5) / 9.2);
    let h = sunion(sunion(r1, r2, 1.6), r3, 2.2) + 1.1 * smooth(0, 12, t);
    h += (0.42 * fbm(x / 5, z / 5, 51) + 0.14 * fbm(x / 2.2, z / 2.2, 61)) * smooth(0.5, 5, h);
    return Math.max(0, h) * smooth(0, 2.6, d);
  }

  function height(x: number, z: number): number {
    if (x < E.minX || x > E.maxX || z < E.minZ || z > E.maxZ) return -3;
    if (inBoard(x, z)) { const s = spur(x, z); return s.h > 0 ? s.h : -0.6; }
    const d = depth(x, z);
    if (d < 0) return -3;
    let h = ridge(x, z, d);
    h = sunion(h, mound(x, z), 1.2);
    h = sunion(h, spur(x, z).h, 1.5);
    h = sunion(h, cover(x, z), 1.5);
    if (railMouths.length) h *= forecourt(x, z);
    const L = coast(x, z);
    const land = Math.pow(smooth(0, 9, L), 0.7);
    // Where E2's beach strips run on past the board corners, stay a hair above its sand (BEACH_Y = -0.04) so the
    // two never z-fight; elsewhere the foothills start flush with the board. Then a short bank down to the lake bed.
    const lift = 0.1 * beachZone(x, z);
    const base = lerp(LAKE_BED, lift, smooth(-2, 1.2, L));
    let stack = -Infinity;
    for (const [sx, sz, sh, sr] of STACKS) { const dx = x - sx, dz = z - sz; stack = Math.max(stack, LAKE_BED + (sh - LAKE_BED) * Math.exp(-(dx * dx + dz * dz) / (sr * sr))); }
    return smin(Math.max(base + h * land, stack), MAX_HEIGHT, 2.5);
  }

  function region(x: number, z: number): -1 | 0 | 1 {
    if (x < E.minX || x > E.maxX || z < E.minZ || z > E.maxZ) return -1;
    if (inBoard(x, z)) return spur(x, z).h > 0 ? 1 : -1;
    return depth(x, z) >= 0 ? 0 : -1;
  }

  function cut(x: number, z: number): boolean {
    if (!inBoard(x, z)) return false;
    return spur(x, z).cut || roadPortalCut(x, z);
  }

  function forest(x: number, z: number, hh?: number): number {
    const h = hh ?? height(x, z);
    const n = fbm(x / 14, z / 14, 71) + 0.3 * fbm(x / 4.5, z / 4.5, 81);
    return smooth(-0.32, 0.02, n) * smooth(0.4, 1.4, h) * (1 - smooth(14.5, 18, h));
  }

  function slope(x: number, z: number): number {
    const e = 0.35;
    const gx = (height(x + e, z) - height(x - e, z)) / (2 * e), gz = (height(x, z + e) - height(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  // ---- portal sites
  const portals: PortalSite[] = [];
  for (const e of exits) portals.push({ kind: 'road', id: e.edgeId, x: e.p.x, z: e.p.z, face: { x: -e.dir.x, z: -e.dir.z }, half: ROAD_PORTAL.half, top: ROAD_PORTAL.top });
  for (const s of spans) {
    for (const end of [0, 1] as const) {
      const { p, face } = railFace(s, end);
      portals.push({ kind: 'rail', id: `rail:${s.from.toFixed(2)}:${end ? 'to' : 'from'}`, x: p.x, z: p.z, face, half: RAIL_PORTAL.half, top: RAIL_PORTAL.top });
    }
  }

  return {
    board: B,
    extent: E,
    portals,
    tunnels: spans.map((s) => ({ fromDist: s.from, toDist: s.to })),
    headlands: [
      { x: ne.v - 2.5, z: B.minZ - ne.t },
      { x: B.minX - sw.t, z: sw.v - 2.5 },
    ],
    height, coast, depth, region, cut, forest, slope,
  };
}
