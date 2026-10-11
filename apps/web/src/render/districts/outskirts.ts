// Owner: D5. The outskirts: every bit of land outside the four neighbourhoods — the frame that makes the town carry
// on past the board edge and keeps it from reading as a rectangle.
//   Back (north + west, toward the Nittany Ridge): a ragged forest edge (pines at the rim, broadleaf clumps and
//   clearings toward town) that runs on into the mountain forests, a water-tower knoll in the north-west with a path
//   from the road, a strip of farm fields, meadow orchards and hedgerows along the west road, a hamlet on Main St.
//   Front (south + east, toward the lake): a lakeside promenade with benches that look out over the water and lamps
//   that glow at dusk, a lakeside café, picnic lawns, birch/cherry clumps and bushes — nothing tall on the camera side.
//   Along the streets outside the ring road: cottages facing the street with mailboxes, side hedges and back fences;
//   avenues of trees along every arterial that leaves the board.
// Everything is derived from TOWN and the other districts' items (no hard-coded rail or road positions): one placer
// rejects anything on a road or sidewalk, the rail, inside a neighbourhood (inside the ring road), within 2 u of a
// stop/platform/queue line, crowding a station or level crossing (D4) or a road exit (tunnel/bridge), on another
// district's items/paths/areas, or hiding a stop, platform or bus route from the camera. So the scenery adapts when
// the town layout changes (the v9 regional rail line included). Deterministic.
// NB: this module imports the other four district modules (to stay clear of their items); they must not import it.
import { stationPlacement, TOWN } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import { CATALOG_BY_KIND } from '../assets/catalog';
import type { PlacedAsset } from '../assets/types';
import { footprintOf } from '../assets/validate';
import { APARTMENTS } from './apartments';
import { CAMPUS } from './campus';
import { DOWNTOWN } from './downtown';
import { STADIUM } from './stadium';
import type { DistrictScenery, FootPath, GroundArea } from './types';

// ---------------------------------------------------------------- small geometry
interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Capsule { a: Vec2; b: Vec2; r: number }
const v = (x: number, z: number): Vec2 => ({ x, z });
const rectAt = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const inRect = (p: Vec2, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
const corners = (r: Rect): Vec2[] => [v(r.x0, r.z0), v(r.x1, r.z0), v(r.x1, r.z1), v(r.x0, r.z1)];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const itemRect = (it: PlacedAsset): Rect => { const f = footprintOf(it); return rectAt(it.x, it.z, f.w, f.d); };

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
function segsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
const ptRectDist = (p: Vec2, r: Rect) => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1));
/** Distance from segment ab to rectangle r (0 when they touch). */
function segRectDist(a: Vec2, b: Vec2, r: Rect): number {
  if (inRect(a, r) || inRect(b, r)) return 0;
  const cs = corners(r);
  for (let i = 0; i < 4; i++) if (segsCross(a, b, cs[i]!, cs[(i + 1) % 4]!)) return 0;
  return Math.min(ptRectDist(a, r), ptRectDist(b, r), ...cs.map((c) => segDist(c, a, b)));
}
function lineRectDist(pts: Vec2[], closed: boolean, r: Rect): number {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n && best > 0; i++) best = Math.min(best, segRectDist(pts[i]!, pts[(i + 1) % pts.length]!, r));
  return best;
}
function pip(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function rectHitsPoly(r: Rect, poly: Vec2[]): boolean {
  if (corners(r).some((c) => pip(c, poly)) || poly.some((p) => inRect(p, r))) return true;
  return lineRectDist(poly, true, r) === 0;
}
/** Segments with bounding boxes, so "is anything within d of this rect?" only measures the nearby ones. */
interface Seg { a: Vec2; b: Vec2; box: Rect; r: number }
const segsOf = (pts: Vec2[], closed: boolean, r = 0): Seg[] => {
  const out: Seg[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    out.push({ a, b, r, box: { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) } });
  }
  return out;
};
/** Is any segment closer than d (+ its own radius) to rect r? */
const nearSegs = (segs: Seg[], r: Rect, d: number) => segs.some((s) => overlaps(grow(s.box, d + s.r), r) && segRectDist(s.a, s.b, r) < d + s.r);
interface Poly { pts: Vec2[]; box: Rect }
const polyOf = (pts: Vec2[]): Poly => ({ pts, box: { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) } });
const hitsPoly = (r: Rect, p: Poly) => overlaps(grow(p.box, 0.01), r) && rectHitsPoly(r, p.pts);
const shoelace = (poly: Vec2[]) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]!; return s + p.x * q.z - q.x * p.z; }, 0) / 2;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Smooth value noise in [0, 1] (clumps and clearings for the woodland belts). */
function noise2(x: number, z: number): number {
  const h = (i: number, j: number) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sz;
}

// ---------------------------------------------------------------- the region: board minus the union of the circles
/** Boundary loops of a union of circles (arcs not inside another circle, chained at the intersections). */
function unionLoops(cs: Array<{ c: Vec2; r: number }>): Vec2[][] {
  const arcs: Array<{ pts: Vec2[]; closed: boolean }> = [];
  cs.forEach(({ c, r }, i) => {
    const n = Math.max(48, Math.ceil((2 * Math.PI * r) / 0.35));
    const pts = Array.from({ length: n }, (_, k) => v(r3(c.x + r * Math.cos((2 * Math.PI * k) / n)), r3(c.z + r * Math.sin((2 * Math.PI * k) / n))));
    const free = pts.map((p) => !cs.some((o, j) => j !== i && dist(p, o.c) < o.r));
    if (!free.some(Boolean)) return;
    if (free.every(Boolean)) { arcs.push({ pts, closed: true }); return; }
    const start = free.findIndex((f, k) => f && !free[(k - 1 + n) % n]);
    let cur: Vec2[] | null = null;
    for (let s = 0; s < n; s++) {
      const k = (start + s) % n;
      if (free[k]) (cur ??= []).push(pts[k]!);
      else if (cur) { arcs.push({ pts: cur, closed: false }); cur = null; }
    }
    if (cur) arcs.push({ pts: cur, closed: false });
  });
  const loops = arcs.filter((a) => a.closed).map((a) => a.pts);
  const open = arcs.filter((a) => !a.closed);
  const used = new Set<number>();
  for (let i = 0; i < open.length; i++) {
    if (used.has(i)) continue;
    const loop: Vec2[] = [];
    for (let j = i; ;) {
      used.add(j);
      loop.push(...open[j]!.pts);
      const end = open[j]!.pts[open[j]!.pts.length - 1]!;
      let best = -1, bd = Infinity;
      open.forEach((a, k) => { if ((used.has(k) && k !== i) || k === j) return; const d = dist(a.pts[0]!, end); if (d < bd) { bd = d; best = k; } });
      if (best < 0 || best === i) break;
      j = best;
    }
    loops.push(loop);
  }
  return loops;
}
/** One polygon: the board with every neighbourhood hole bridged in (zero-width slits), holes wound against the board,
 *  so even-odd and non-zero point-in-polygon tests both read "board outside the neighbourhoods". */
export function outskirtsRegion(map: TownMap): Vec2[] {
  const b = map.bounds;
  const outer = [v(b.minX, b.minZ), v(b.maxX, b.minZ), v(b.maxX, b.maxZ), v(b.minX, b.maxZ)];
  const poly = [...outer, outer[0]!];
  for (const loop of unionLoops(map.neighborhoods.map((n) => ({ c: n.center, r: n.radius })))) {
    const hole = Math.sign(shoelace(loop)) === Math.sign(shoelace(outer)) ? [...loop].reverse() : loop;
    poly.push(...hole, hole[0]!, outer[0]!);
  }
  return poly;
}

// ---------------------------------------------------------------- the town's constraints
const CAM_DIRS = [35, 45, 55].map((a) => v(Math.sin((a * Math.PI) / 180), Math.cos((a * Math.PI) / 180)));
const heightOf = (it: PlacedAsset) => (CATALOG_BY_KIND.get(it.kind)?.h ?? 1) * (it.scale ?? 1);
const SOFT = new Set(['veg.oak', 'veg.maple', 'veg.pine', 'veg.birch', 'veg.poplar', 'veg.cherry', 'veg.bush']);
const SMALL = (it: PlacedAsset) => { const f = footprintOf(it); return Math.max(f.w, f.d) <= 1.3; };

interface Opts {
  /** Clearance from road centrelines (default 2.2 for big items, 1.65 for street furniture). */
  road?: number;
  /** Clearance from the rail centreline (default 1.7). */
  rail?: number;
  /** Extra spacing to other items of this district. */
  pad?: number;
  /** May touch this district's own footpaths (benches, lamps). */
  onPath?: boolean;
  /** May stand on this district's own ground areas (contents of a plaza, field, orchard, lawn). */
  inArea?: boolean;
}

/** The town as seen by the outskirts placer (exported for dev tooling). */
export class OutskirtsTown {
  readonly b: TownMap['bounds'];
  readonly roads: Vec2[][];
  readonly inner: Vec2[][];
  readonly rail: Vec2[];
  /** Bounding box of the town streets that do not touch the board edge (the ring road and everything inside). */
  readonly ringBox: Rect;
  readonly circles: Array<{ c: Vec2; r: number }>;
  readonly keepRects: Rect[] = [];
  readonly keepCaps: Capsule[] = [];
  readonly foreign: Rect[] = [];
  readonly foreignCaps: Seg[] = [];
  readonly foreignAreas: Poly[] = [];
  private readonly roadSegs: Seg[];
  private readonly railSegs: Seg[];
  readonly watch: Array<{ p: Vec2; eye: number; tan: number }> = [];
  readonly exits: Array<{ p: Vec2; dir: Vec2; side: 'n' | 's' | 'e' | 'w'; edge: Vec2[] }> = [];
  readonly items: PlacedAsset[] = [];
  readonly paths: FootPath[] = [];
  readonly areas: GroundArea[] = [];
  /** Own footprints; vegetation crowns may interpenetrate a little (validatePlacements allows 0.2). */
  private readonly ownRects: Array<{ r: Rect; soft: boolean }> = [];
  private readonly ringCache = new Map<string, boolean>();
  private readonly ownPathSegs: Seg[] = [];
  private readonly ownAreaPolys: Poly[] = [];

  constructor(readonly map: TownMap, others: DistrictScenery[]) {
    const b = (this.b = map.bounds);
    const onEdge = (p: Vec2) => p.x <= b.minX + 0.75 || p.x >= b.maxX - 0.75 || p.z <= b.minZ + 0.75 || p.z >= b.maxZ - 0.75;
    this.roads = map.roads.edges.map((e) => e.path.points);
    this.roadSegs = this.roads.flatMap((pts) => segsOf(pts, false));
    this.inner = map.roads.edges.filter((e) => !e.path.points.some(onEdge)).map((e) => e.path.points);
    this.rail = map.rail.loop.points;
    this.railSegs = segsOf(this.rail, true);
    const ip = this.inner.flat(), xs = ip.map((p) => p.x), zs = ip.map((p) => p.z);
    this.ringBox = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    this.circles = map.neighborhoods.map((n) => ({ c: n.center, r: n.radius }));
    // road exits (tunnel portals on the mountain sides, causeways on the water sides): keep the corridor clear
    for (const e of map.roads.edges) {
      const pts = e.path.points;
      for (const [end, prev] of [[pts[0]!, pts[1]!], [pts[pts.length - 1]!, pts[pts.length - 2]!]] as const) {
        if (!onEdge(end)) continue;
        const L = dist(end, prev) || 1, dir = v((end.x - prev.x) / L, (end.z - prev.z) / L);
        const side = end.z <= b.minZ + 0.75 ? 'n' : end.z >= b.maxZ - 0.75 ? 's' : end.x <= b.minX + 0.75 ? 'w' : 'e';
        this.exits.push({ p: end, dir, side, edge: pts });
        const inward = v(end.x - dir.x * 3, end.z - dir.z * 3);
        this.keepCaps.push({ a: end, b: inward, r: 2.6 });
      }
    }
    // stations and their squares (D4 dresses them)
    for (const s of map.rail.stations) {
      const pl = stationPlacement(s.id);
      const kind = s.id === 'stn_central' ? 'lm.stationCentral' : 'lm.stationHalt';
      this.keepRects.push(grow(itemRect({ kind, x: pl.x, z: pl.z, rot: pl.rot }), 2.6));
    }
    // zone doors: every neighbourhood builds a front there
    for (const z of map.zones) this.keepCaps.push({ a: z.door, b: z.door, r: z.tags.includes('station') ? 4.2 : 3.8 });
    // level crossings (D4)
    for (const pts of this.roads) for (let i = 0; i + 1 < pts.length; i++) for (let j = 0; j < this.rail.length; j++) {
      const a = pts[i]!, c = pts[i + 1]!, p = this.rail[j]!, q = this.rail[(j + 1) % this.rail.length]!;
      if (!segsCross(a, c, p, q)) continue;
      const den = (c.x - a.x) * (q.z - p.z) - (c.z - a.z) * (q.x - p.x);
      const t = ((p.x - a.x) * (q.z - p.z) - (p.z - a.z) * (q.x - p.x)) / den;
      this.keepRects.push(rectAt(a.x + (c.x - a.x) * t, a.z + (c.z - a.z) * t, 5.4, 5.4));
    }
    // stops, platforms and their queue lines: 2 u clear, and always visible
    const queue = (p: Vec2, dir: Vec2) => {
      this.keepCaps.push({ a: p, b: v(p.x + dir.x * 4, p.z + dir.z * 4), r: 2.15 });
      for (let k = 0; k <= 4; k++) this.watch.push({ p: v(p.x + dir.x * k, p.z + dir.z * k), eye: 0.45, tan: Math.tan((27 * Math.PI) / 180) });
    };
    for (const s of map.stops) queue(s.p, s.queueDir);
    for (const s of map.rail.stations) queue(s.platform, s.queueDir);
    // buses on their routes stay visible too
    for (const r of map.routes) {
      const pts = r.path.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, c = pts[i + 1]!, n = Math.max(1, Math.ceil(dist(a, c) / 1.5));
        for (let k = 0; k < n; k++) this.watch.push({ p: v(a.x + ((c.x - a.x) * k) / n, a.z + ((c.z - a.z) * k) / n), eye: 0.8, tan: Math.tan((30 * Math.PI) / 180) });
      }
    }
    // the other districts' items, paths and areas
    for (const d of others) {
      for (const it of d.items) this.foreign.push(grow(itemRect(it), 0.25));
      for (const p of d.paths) this.foreignCaps.push(...segsOf(p.points, false, p.width / 2 + 0.15));
      for (const a of d.areas) this.foreignAreas.push(polyOf(a.polygon));
    }
  }

  /** Inside the ring road: every axis ray to the board edge crosses a town street (exit spurs excluded). */
  insideRing(p: Vec2): boolean {
    const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)}`;
    const hit = this.ringCache.get(key);
    if (hit !== undefined) return hit;
    const b = this.b;
    const rays = [v(p.x, b.minZ - 1), v(p.x, b.maxZ + 1), v(b.minX - 1, p.z), v(b.maxX + 1, p.z)];
    const res = rays.every((q) => this.inner.some((pts) => pts.some((a, i) => i + 1 < pts.length && segsCross(p, q, a, pts[i + 1]!))));
    this.ringCache.set(key, res);
    return res;
  }
  /** Distance to the nearest back (north/west, mountain) and front (south/east, water) board edge. */
  backDist(p: Vec2): number { return Math.min(p.z - this.b.minZ, p.x - this.b.minX); }
  frontDist(p: Vec2): number { return Math.min(this.b.maxZ - p.z, this.b.maxX - p.x); }
  /** Mountain side: near the north or west edge (the NE and SW corners are wooded headlands). */
  isBack(p: Vec2): boolean { const d = this.backDist(p); return d < 8 || d <= this.frontDist(p); }
  /** The free spot nearest to `target` (square spiral, radius rmax) that passes `ok`, or null. */
  spot(target: Vec2, rmax: number, step: number, ok: (c: Vec2) => boolean): Vec2 | null {
    for (const [dx, dz] of spiral(rmax, step)) { const c = v(r3(target.x + dx), r3(target.z + dz)); if (ok(c)) return c; }
    return null;
  }
  nearRoad(r: Rect, d: number): boolean { return nearSegs(this.roadSegs, r, d); }
  nearRail(r: Rect, d: number): boolean { return nearSegs(this.railSegs, r, d); }

  /** Is this patch of ground free of roads, rail, claims, keep-outs and other districts? (No own-item check.) */
  groundFree(r: Rect, road = 2.2, rail = 1.7): boolean {
    const b = this.b;
    if (r.x0 < b.minX + 0.15 || r.x1 > b.maxX - 0.15 || r.z0 < b.minZ + 0.15 || r.z1 > b.maxZ - 0.15) return false;
    if (this.nearRoad(r, road) || this.nearRail(r, rail)) return false;
    if (this.keepRects.some((k) => overlaps(k, r))) return false;
    if (this.keepCaps.some((c) => segRectDist(c.a, c.b, r) < c.r)) return false;
    const mid = v((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    if (this.insideRing(mid)) {
      for (const { c, r: rad } of this.circles) if (Math.hypot(Math.max(r.x0 - c.x, 0, c.x - r.x1), Math.max(r.z0 - c.z, 0, c.z - r.z1)) < rad + 1.2) return false;
    }
    if (this.foreign.some((f) => overlaps(f, r))) return false;
    if (nearSegs(this.foreignCaps, r, 0)) return false;
    if (this.foreignAreas.some((poly) => hitsPoly(r, poly))) return false;
    return true;
  }
  /** Would an item this tall at this footprint hide a stop, a platform, a queue line or a bus route? */
  hides(r: Rect, h: number): boolean {
    for (const w of this.watch) {
      if (h <= w.eye) continue;
      const reach = (h - w.eye) / w.tan;
      if (ptRectDist(w.p, r) > reach + 0.01) continue;
      for (const d of CAM_DIRS) if (segRectDist(w.p, v(w.p.x + d.x * reach, w.p.z + d.z * reach), r) === 0) return true;
    }
    return false;
  }
  /** Water side (south/east board edges) stays low. */
  waterSide(r: Rect): boolean { return r.z1 > this.b.maxZ - 4.6 || r.x1 > this.b.maxX - 4.6; }
  freeOfOwn(r: Rect, pad: number, onPath: boolean, inArea = false, soft = false): boolean {
    if (this.ownRects.some((o) => overlaps(grow(o.r, soft && o.soft ? -0.08 : pad), r))) return false;
    if (!onPath && nearSegs(this.ownPathSegs, r, 0.08)) return false;
    if (!inArea && this.ownAreaPolys.some((a) => hitsPoly(r, a))) return false;
    return true;
  }
  fits(it: PlacedAsset, o: Opts = {}): boolean {
    const r = itemRect(it), h = heightOf(it);
    const thin = it.kind === 'st.lamp' || it.kind === 'st.flag';
    if (!this.groundFree(r, o.road ?? (SMALL(it) ? 1.65 : 2.2), o.rail ?? 1.7)) return false;
    if (!this.freeOfOwn(r, o.pad ?? 0, o.onPath ?? false, o.inArea ?? false, SOFT.has(it.kind))) return false;
    if (!thin && this.waterSide(r) && h > 2.75) return false;
    if (!thin && h > 0.6 && this.hides(r, h)) return false;
    return true;
  }
  add(it: PlacedAsset, o: Opts = {}): boolean {
    const clean: PlacedAsset = { kind: it.kind, x: r3(it.x), z: r3(it.z) };
    if (it.rot) clean.rot = it.rot;
    if (it.scale && Math.abs(it.scale - 1) > 1e-3) clean.scale = r3(it.scale);
    if (it.params && Object.keys(it.params).length) clean.params = it.params;
    if (!this.fits(clean, o)) return false;
    this.items.push(clean);
    this.ownRects.push({ r: itemRect(clean), soft: SOFT.has(clean.kind) });
    return true;
  }
  /** Reserve ground for an area (fields, lawns, plazas): no items of others, roads or rail under it. */
  area(kind: GroundArea['kind'], r: Rect, chamfer = 0.4): boolean {
    if (!this.groundFree(r, 1.75, 1.3)) return false;
    const c = Math.min(chamfer, (r.x1 - r.x0) / 3, (r.z1 - r.z0) / 3);
    const area: GroundArea = {
      kind,
      polygon: [v(r.x0 + c, r.z0), v(r.x1 - c, r.z0), v(r.x1, r.z0 + c), v(r.x1, r.z1 - c), v(r.x1 - c, r.z1), v(r.x0 + c, r.z1), v(r.x0, r.z1 - c), v(r.x0, r.z0 + c)]
        .map((p) => v(r3(p.x), r3(p.z))),
    };
    this.areas.push(area);
    this.ownAreaPolys.push(polyOf(area.polygon));
    return true;
  }
  path(points: Vec2[], width: number): void {
    if (points.length < 2) return;
    const path: FootPath = { points: points.map((p) => v(r3(p.x), r3(p.z))), width, kind: 'footpath' };
    this.paths.push(path);
    this.ownPathSegs.push(...segsOf(path.points, false, width / 2));
  }
}

// ---------------------------------------------------------------- the dressing
const S = 0, E = Math.PI / 2, N = Math.PI, W = -Math.PI / 2;
/** Rotation that turns a model's front (+z) toward the unit direction d (snapped to quarter turns). */
const faceTo = (d: Vec2) => (Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? E : W) : d.z > 0 ? S : N);
const unitOf = (rot: number): Vec2 => v(Math.round(Math.sin(rot)), Math.round(Math.cos(rot)));
/** Curated cottage colours (siding idx, roof idx) that never clash. */
const COTTAGES: Array<[number, number]> = [[0, 0], [1, 2], [3, 1], [2, 1], [1, 0], [0, 1], [3, 0], [2, 2], [0, 2], [1, 1]];
type Pick = Array<[string, number]>;
const pick = (r: () => number, table: Pick): string => {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [k, w] of table) { x -= w; if (x < 0) return k; }
  return table[table.length - 1]![0];
};

/** Build the outskirts for a town, staying clear of the other districts. */
export function buildOutskirts(map: TownMap, others: DistrictScenery[]): DistrictScenery {
  const t = new OutskirtsTown(map, others);
  const rand = rng(0x0d5c0de);
  const exitSegs = new Set(t.exits.map((e) => e.edge));
  const budget = { houses: 11, colour: 0 };
  waterTowerKnoll(t);
  cottages(t, rand, budget, (pts) => exitSegs.has(pts)); // hamlets on the arterials leaving town
  lakesideCafe(t);
  avenues(t);
  promenades(t);
  farmFields(t, rand);
  cottages(t, rand, budget, (pts) => !exitSegs.has(pts));
  allotments(t);
  shoreAllotments(t);
  picnicLawns(t);
  forestRims(t, rand);
  woodland(t, rand);
  return { id: 'outskirts', region: { polygon: outskirtsRegion(map) }, items: t.items, paths: t.paths, areas: t.areas };
}

/** Back-left (north-west) quarter: the water tower on a fenced lawn knoll, its gate on the side facing the nearest
 *  street and a footpath from the gate to that street's kerb; the forest closes in around it later. */
function waterTowerKnoll(t: OutskirtsTown): void {
  const b = t.b, box = 4.8, h = box / 2, len = box - 0.1;
  const c = t.spot(v(b.minX + 3.6, b.minZ + 3.7), 18, 0.4, (p) => {
    if (p.x > -4 || p.z > -4) return false; // tall: back third only
    const r = rectAt(p.x, p.z, box + 0.4, box + 0.4);
    return t.groundFree(r, 2.4, 1.5) && t.freeOfOwn(r, 0, false) && t.fits({ kind: 'lm.waterTower', x: p.x, z: p.z });
  });
  if (!c || !t.add({ kind: 'lm.waterTower', x: c.x, z: c.z, rot: S })) return;
  t.area('lawn', rectAt(c.x, c.z, box - 0.1, box - 0.1), 0.6);
  // the path: from the gate to the kerb of the nearest street (2 u from its centreline), clear of everything
  let best: { p: Vec2; d: number } = { p: c, d: Infinity };
  for (const pts of t.roads) for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, q = pts[i + 1]!, vx = q.x - a.x, vz = q.z - a.z, L = vx * vx + vz * vz;
    const k = L > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * vx + (c.z - a.z) * vz) / L)) : 0;
    const p = v(a.x + vx * k, a.z + vz * k), d = dist(p, c);
    if (d < best.d) best = { p, d };
  }
  const toRoad = v((best.p.x - c.x) / best.d, (best.p.z - c.z) / best.d);
  const kerb = v(best.p.x - toRoad.x * 2.0, best.p.z - toRoad.z * 2.0);
  const gate = faceTo(toRoad), g = unitOf(gate);
  const start = v(c.x + g.x * (h + 0.05), c.z + g.z * (h + 0.05));
  const L = dist(start, kerb);
  let clear = best.d < 14 && L > 0.8;
  for (let s = 0.3; clear && s <= L; s += 0.3) {
    const p = v(start.x + ((kerb.x - start.x) * s) / L, start.z + ((kerb.z - start.z) * s) / L);
    if (!t.groundFree(rectAt(p.x, p.z, 0.6, 0.6), 1.3, 1.6)) clear = false;
  }
  if (clear) t.path([start, kerb], 0.8);
  // rail fence on three sides; the gate side is split around a 1.3 u gap with a bush either side
  const lawn = { inArea: true, onPath: true, rail: 1.3 };
  for (const rot of [S, E, N, W]) {
    const u = unitOf(rot), mid = v(c.x + u.x * h, c.z + u.z * h), along = Math.abs(u.x) > 0 ? E : S;
    const ax = Math.abs(u.x) > 0 ? v(0, 1) : v(1, 0);
    const sideLen = Math.abs(u.x) > 0 ? len - 0.5 : len; // east/west runs fit between the north/south ones
    if (rot !== gate) { t.add({ kind: 'st.fence', x: mid.x, z: mid.z, rot: along, params: { length: r3(sideLen), style: 'rail' } }, lawn); continue; }
    const seg = (sideLen - 1.3) / 2, o = sideLen / 2 - seg / 2;
    for (const k of [-1, 1]) t.add({ kind: 'st.fence', x: mid.x + ax.x * o * k, z: mid.z + ax.z * o * k, rot: along, params: { length: r3(seg), style: 'rail' } }, lawn);
    for (const k of [-1, 1]) t.add({ kind: 'veg.bush', x: mid.x + ax.x * 1.45 * k + u.x * 0.75, z: mid.z + ax.z * 1.45 * k + u.z * 0.75, scale: k > 0 ? 1 : 0.85 });
  }
}

/** SE (closest to the camera, by the lake): a little café plaza with a kiosk, umbrella tables, planters and a flag.
 *  Slides along the shore until it fits. */
function lakesideCafe(t: OutskirtsTown): void {
  const b = t.b;
  const c = t.spot(v(b.maxX - 3.2, b.maxZ - 2.4), 16, 0.25, (p) => {
    const plaza = rectAt(p.x, p.z, 5.4, 3.9);
    return t.frontDist(p) < 4 && t.groundFree(grow(plaza, 0.15), 2.2, 1.5) && t.freeOfOwn(grow(plaza, 0.1), 0, false);
  });
  if (!c) return;
  t.area('plaza', rectAt(c.x, c.z, 5.4, 3.9), 0.7);
  const IN = { inArea: true };
  t.add({ kind: 'st.kiosk', x: c.x - 1.7, z: c.z - 1.1, rot: S, params: { color: 0 } }, IN);
  t.add({ kind: 'st.tableUmbrella', x: c.x + 0.1, z: c.z - 0.75, params: { color: 1 } }, IN);
  t.add({ kind: 'st.tableUmbrella', x: c.x + 1.75, z: c.z - 0.6, params: { color: 2 } }, IN);
  t.add({ kind: 'st.tableUmbrella', x: c.x + 0.9, z: c.z + 0.9, params: { color: 0 } }, IN);
  t.add({ kind: 'st.flag', x: c.x + 2.55, z: c.z + 1.65, params: { color: 1 } }, IN);
  t.add({ kind: 'veg.planter', x: c.x - 2.35, z: c.z + 1.35 }, IN);
  t.add({ kind: 'veg.planter', x: c.x - 0.75, z: c.z + 1.45 }, IN);
  t.add({ kind: 'st.bin', x: c.x - 2.45, z: c.z + 0.2 }, IN);
  t.add({ kind: 'st.lamp', x: c.x + 2.55, z: c.z - 1.75 }, { onPath: true, inArea: true });
}

/** Promenade along the water sides (south and east board edges): a footpath at the edge, benches facing the lake,
 *  lamps between them, bins and flowerbeds. Interrupted where roads or the rail leave the board. */
function promenades(t: OutskirtsTown): void {
  const b = t.b, inset = 0.65, width = 0.9;
  const sides: Array<{ along: (s: number) => Vec2; inward: Vec2; from: number; to: number; rot: number }> = [
    { along: (s) => v(s, b.maxZ - inset), inward: v(0, -1), from: b.minX + 4.5, to: b.maxX - 0.8, rot: S },
    { along: (s) => v(b.maxX - inset, s), inward: v(-1, 0), from: b.minZ + 13, to: b.maxZ - 0.8, rot: E }, // the NE headland stays wooded
  ];
  for (const side of sides) {
    // walk the line; keep runs where a strip of path fits
    const runs: Array<[number, number]> = [];
    let start: number | null = null;
    for (let s = side.from; s <= side.to + 1e-6; s += 0.25) {
      const p = side.along(s);
      const strip = side.rot === S ? rectAt(p.x, p.z, 0.3, width) : rectAt(p.x, p.z, width, 0.3);
      const ok = t.groundFree(strip, 1.2 + width / 2 + 0.75, 1.3 + width / 2) && !t.areas.some((a) => a.kind === 'plaza' && rectHitsPoly(strip, a.polygon));
      if (ok && start === null) start = s;
      if (!ok && start !== null) { runs.push([start, s - 0.25]); start = null; }
    }
    if (start !== null) runs.push([start, side.to]);
    for (const [s0, s1] of runs) {
      if (s1 - s0 < 3) continue;
      t.path([side.along(s0), side.along(s1)], width);
      // benches every ~7.5 u facing the water, lamps halfway between, a bin by every other bench
      const n = Math.max(1, Math.floor((s1 - s0 - 1.5) / 7.5));
      const step = (s1 - s0) / (n + 0.0001);
      for (let i = 0; i < n; i++) {
        const s = s0 + step * (i + 0.5);
        const p = side.along(s), off = width / 2 + 0.3;
        const at = (d: number, a = 0) => v(p.x + side.inward.x * d + (side.rot === S ? a : 0), p.z + side.inward.z * d + (side.rot === E ? a : 0));
        const bench = at(off);
        t.add({ kind: 'st.bench', x: bench.x, z: bench.z, rot: side.rot }, { onPath: true, rail: 1.7 });
        if (i % 2 === 0) { const bin = at(off + 0.05, 1.0); t.add({ kind: 'st.bin', x: bin.x, z: bin.z }, { onPath: true }); }
        const lampS = s + step / 2;
        if (lampS < s1 - 0.6) {
          const lp = side.along(lampS), lamp = v(lp.x + side.inward.x * (width / 2 + 0.3), lp.z + side.inward.z * (width / 2 + 0.3));
          t.add({ kind: 'st.lamp', x: lamp.x, z: lamp.z }, { onPath: true });
        }
        // a flowerbed beside every other lamp
        const fb = side.along(s + step / 2 + 1.6), fbd = width / 2 + 0.55;
        if (i % 2 === 1) t.add({ kind: 'veg.flowerbed', x: fb.x + side.inward.x * fbd, z: fb.z + side.inward.z * fbd, rot: side.rot === S ? 0 : E });
      }
      // a lamp at each end of the run
      for (const s of [s0 + 0.3, s1 - 0.3]) {
        const p = side.along(s), lamp = v(p.x + side.inward.x * (width / 2 + 0.3), p.z + side.inward.z * (width / 2 + 0.3));
        t.add({ kind: 'st.lamp', x: lamp.x, z: lamp.z }, { onPath: true });
      }
    }
  }
}

/** Cottages facing the street wherever there is room outside the neighbourhoods, in groups of two or three: a
 *  mailbox at the kerb, hedges between neighbours, one picket fence along the back of the group. Lots step back a
 *  little where the kerb is busy (exit corridors), so the arterials leaving town get a hamlet too. */
function cottages(t: OutskirtsTown, rand: () => number, budget: { houses: number; colour: number }, which: (edge: Vec2[]) => boolean): void {
  for (const [a, c] of straights(t, which)) {
    const L = dist(a, c);
    const tx = (c.x - a.x) / L, tz = (c.z - a.z) / L, horiz = Math.abs(tx) > 0.5;
    for (const sideSign of [1, -1]) {
      const n = v(-tz * sideSign, tx * sideSign); // from the road toward the lots
      const base = n.x + n.z > 0.4 ? 3.75 : 3.45; // camera-side lots sit a little further back
      const rot = faceTo(v(-n.x, -n.z));
      const fwd = v(-n.x, -n.z), right = v(fwd.z, -fwd.x); // the model's +x in world
      const rightAlong = Math.sign(right.x * tx + right.z * tz) || 1;
      const at = (s: number, lat: number) => v(a.x + tx * s + n.x * lat, a.z + tz * s + n.z * lat);
      let group: Array<{ s: number; off: number }> = [];
      const flush = () => {
        for (let i = 0; i + 1 < group.length; i++) {
          if (group[i]!.off !== group[i + 1]!.off) continue;
          const hp = at((group[i]!.s + group[i + 1]!.s) / 2, group[i]!.off + 0.1);
          t.add({ kind: 'veg.hedge', x: hp.x, z: hp.z, rot: horiz ? E : S, params: { length: 2.3 } });
        }
        if (group.length) {
          const back = Math.max(...group.map((g) => g.off)) + 1.62;
          const g0 = group[0]!.s - 1.45, g1 = group[group.length - 1]!.s + 1.45;
          fence: for (let trim = 0; trim <= 2.4; trim += 0.4) {
            for (const [s0, s1] of [[g0 + trim, g1], [g0, g1 - trim], [g0 + trim / 2, g1 - trim / 2]] as const) {
              if (s1 - s0 < 1.5) continue;
              const fp = at((s0 + s1) / 2, back);
              if (t.add({ kind: 'st.fence', x: fp.x, z: fp.z, rot: horiz ? S : E, params: { length: r3(s1 - s0), style: 'picket' } }, { rail: 1.25 })) break fence;
            }
          }
        }
        group = [];
      };
      let s = 2.4;
      while (s <= L - 2.4 && budget.houses > 0) {
        const colour = budget.colour;
        const [wall, roof] = COTTAGES[colour % COTTAGES.length]!;
        const porch = colour % 2 ? 'left' : 'right';
        let off = -1;
        for (const o of [base, base + 0.4, base + 0.8]) {
          const p = at(s, o);
          const house: PlacedAsset = { kind: 'res.house', x: p.x, z: p.z, rot, params: { wall, roof, porch, style: colour % 3 === 1 ? 'front' : 'side' } };
          if (t.add(house, { pad: 0.12 })) { off = o; break; }
        }
        if (off < 0) {
          if (group.length && s - group[group.length - 1]!.s > 4.2) flush();
          s += 0.4;
          continue;
        }
        budget.houses--; budget.colour++;
        group.push({ s, off });
        // mailbox at the kerb on the porch side
        const mb = at(s + rightAlong * (porch === 'right' ? 1 : -1) * 1.05, 1.95);
        t.add({ kind: 'st.mailbox', x: mb.x, z: mb.z, rot });
        if (group.length >= 3 || (group.length === 2 && rand() < 0.55)) { flush(); s += 3.5 + 4.2 + rand() * 1.5; }
        else s += 3.55 + rand() * 0.3;
      }
      flush();
    }
  }
}

/** Allotment gardens beside streets outside the ring road (away from the board rim) where a patch is free. */
function allotments(t: OutskirtsTown): void {
  let made = 0;
  for (const [a, c] of straights(t)) {
    if (made >= 3) break;
    const L = dist(a, c), tx = (c.x - a.x) / L, tz = (c.z - a.z) / L, horiz = Math.abs(tx) > 0.5;
    for (const sgn of [1, -1]) {
      const n = v(-tz * sgn, tx * sgn);
      for (let s = 3; s <= L - 3 && made < 3; s += 0.5) {
        const mid = v(a.x + tx * s + n.x * 4.1, a.z + tz * s + n.z * 4.1);
        if (t.insideRing(mid) || Math.min(t.backDist(mid), t.frontDist(mid)) < 4.5) continue;
        const r = horiz ? rectAt(mid.x, mid.z, 4.6, 2.8) : rectAt(mid.x, mid.z, 2.8, 4.6);
        if (!t.groundFree(grow(r, 0.1)) || !t.freeOfOwn(grow(r, 0.3), 0, false)) continue;
        if (!t.area('garden', r, 0.3)) continue;
        for (const k of [-1, 1]) {
          const fb = horiz ? v(mid.x + k * 1.15, mid.z) : v(mid.x, mid.z + k * 1.15);
          t.add({ kind: 'veg.flowerbed', x: fb.x, z: fb.z, rot: horiz ? E : S }, { inArea: true });
        }
        made++;
        s += 7;
      }
    }
  }
}

/** The strip between the west board edge and the west ring road (mountain side): a run of plots — crop fields and
 *  meadow orchards — with hedgerows between them, a rail fence along the road side and the odd lone tree. The far
 *  edges are ragged so the town frays into countryside instead of ending in a straight line. */
function farmFields(t: OutskirtsTown, rand: () => number): void {
  const b = t.b;
  const x1 = t.ringBox.x0 - 2.45;
  if (x1 - (b.minX + 0.5) < 3.2) return;
  let z = b.minZ + 0.5, plot = 0;
  while (z < b.maxZ - 3.7) {
    const xa = b.minX + 0.5 + [0, 0.9, 0.35, 1.3][plot % 4]!;
    const want = 4.6 + rand() * 3.2;
    let z1 = z;
    while (z1 + 0.25 <= b.maxZ - 0.5 && z1 - z < want) {
      const r: Rect = { x0: xa, x1, z0: z, z1: z1 + 0.25 };
      if (!t.groundFree(r, 2.2, 1.7) || !t.freeOfOwn(grow(r, 0.05), 0, false)) break;
      z1 += 0.25;
    }
    if (z1 - z < 3.2) { z = Math.max(z1, z) + 0.25; continue; }
    const r: Rect = { x0: xa, x1, z0: z, z1 };
    const orchard = plot % 4 === 1;
    t.area(orchard ? 'lawn' : 'garden', r, orchard ? 0.6 : 0.3);
    const hl = r3(x1 - xa - 0.3), cx = (xa + x1) / 2;
    t.add({ kind: 'veg.hedge', x: cx, z: z - 0.45, params: { length: hl } });
    t.add({ kind: 'veg.hedge', x: cx, z: z1 + 0.45, params: { length: hl } });
    // a hedgerow on the countryside side too, where there is room before the board edge
    if (xa - b.minX > 1.05) t.add({ kind: 'veg.hedge', x: xa - 0.42, z: (z + z1) / 2, rot: E, params: { length: r3(z1 - z - 0.2) } });
    t.add({ kind: 'st.fence', x: x1 + 0.13, z: (z + z1) / 2, rot: E, params: { length: r3(z1 - z - 0.4), style: 'rail' } }, { rail: 1.25 });
    if (orchard) {
      // fruit trees in a loose grid on the meadow
      const cols = Math.max(1, Math.floor((x1 - xa - 0.4) / 2.0)), rows = Math.max(1, Math.floor((z1 - z - 0.4) / 2.0));
      const ox = (x1 - xa - (cols - 1) * 2.0) / 2, oz = (z1 - z - (rows - 1) * 2.0) / 2;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const kind = (i + j) % 3 === 2 ? 'veg.cherry' : 'veg.oak'; // apple trees, one blossom in three (gameplay owns saturation)
        t.add({ kind, x: xa + ox + i * 2.0 + (rand() - 0.5) * 0.3, z: z + oz + j * 2.0 + (rand() - 0.5) * 0.3, scale: 0.86 + rand() * 0.1 }, { inArea: true });
      }
    } else if (rand() < 0.7) {
      // a lone oak in a field corner
      const zc = rand() < 0.5 ? z + 1.1 : z1 - 1.1;
      t.add({ kind: 'veg.oak', x: xa + 1.0, z: zc, scale: 0.92 + rand() * 0.12 }, { inArea: true });
    }
    plot++;
    z = z1 + 0.95;
  }
}

/** Allotment plots in a row along the inland side of the east promenade (low, so fine on the camera side). */
function shoreAllotments(t: OutskirtsTown): void {
  const b = t.b, w = 2.3, gap = 0.7, x1 = b.maxX - 1.9, x0 = x1 - w;
  let made = 0;
  for (let z = b.minZ + 13; z < b.maxZ - 5 && made < 4; z += 0.25) {
    let z1 = z;
    while (z1 - z < 4.4 && t.groundFree({ x0: x0 - 0.1, x1: x1 + 0.05, z0: z - 0.1, z1: z1 + 0.35 }, 2.2, 1.6) && t.freeOfOwn({ x0, x1, z0: z, z1: z1 + 0.25 }, 0.1, false)) z1 += 0.25;
    if (z1 - z < 3.4) continue;
    if (t.area('garden', { x0, x1, z0: z, z1 }, 0.3)) made++;
    z = z1 + gap;
  }
}

/** Picnic lawns on the lake side: a lawn with two umbrella tables, a bin and a flowerbed. */
function picnicLawns(t: OutskirtsTown): void {
  const b = t.b;
  let made = 0;
  for (const fx of [0.62, 0.3, 0.86, 0.12]) {
    if (made >= 2) break;
    const target = v(b.minX + (b.maxX - b.minX) * fx, b.maxZ - 2.9);
    const c = t.spot(target, 5, 0.25, (p) => {
      const r = rectAt(p.x, p.z, 4.6, 2.6);
      return t.groundFree(grow(r, 0.1), 2.2, 1.6) && t.freeOfOwn(grow(r, 0.25), 0, false);
    });
    if (!c) continue;
    t.area('lawn', rectAt(c.x, c.z, 4.6, 2.6), 0.7);
    const IN = { inArea: true };
    t.add({ kind: 'st.tableUmbrella', x: c.x - 1.15, z: c.z - 0.2, params: { color: made % 3 } }, IN);
    t.add({ kind: 'st.tableUmbrella', x: c.x + 0.75, z: c.z + 0.25, params: { color: (made + 1) % 3 } }, IN);
    t.add({ kind: 'veg.flowerbed', x: c.x + 1.2, z: c.z - 0.75 }, IN);
    t.add({ kind: 'st.bin', x: c.x - 2.0, z: c.z + 0.85 }, IN);
    made++;
  }
}

/** Trees along the arterials that leave town (one species per street; low birches on the water side), filling
 *  the gaps between the hamlet lots: a tree wherever one fits at least 3 u past the previous one on that side. */
function avenues(t: OutskirtsTown): void {
  t.exits.forEach((ex, i) => {
    const back = ex.side === 'n' || ex.side === 'w';
    const kind = back ? (['veg.maple', 'veg.oak'] as const)[i % 2]! : 'veg.birch';
    const last = new Map<number, Vec2>();
    walkEdge(ex.edge, 0.5, (p, dir) => {
      for (const sgn of [1, -1]) {
        const prev = last.get(sgn);
        if (prev && dist(prev, p) < 3.0) continue;
        const n = v(-dir.z * sgn, dir.x * sgn);
        for (const off of [3.1, 3.55, 4.0]) {
          if (t.add({ kind, x: p.x + n.x * off, z: p.z + n.z * off, scale: 0.9, params: { variant: i * 3 + 1 } })) { last.set(sgn, p); break; }
        }
      }
    });
  });
}

/** Woodland over all the open land outside the ring road: a jittered scatter whose density and species follow the
 *  board edge and a smooth noise field. A dense, ragged forest rim (mostly pine) on the mountain sides, broadleaf
 *  clumps and clearings toward town, sparse low birches, cherries and bushes on the water sides. */
const RIM: Pick = [['veg.pine', 56], ['veg.oak', 13], ['veg.maple', 9], ['veg.birch', 12], ['veg.poplar', 10]];
const WOOD: Pick = [['veg.pine', 22], ['veg.oak', 26], ['veg.maple', 20], ['veg.birch', 16], ['veg.poplar', 6], ['veg.bush', 10]];
const SHORE: Pick = [['veg.birch', 36], ['veg.cherry', 12], ['veg.bush', 52]];
/** One smooth noise field for stands and clearings, shared by the rims and the scatter so their gaps line up. */
const standNoise = (x: number, z: number) => noise2(x / 6.5 + 11, z / 6.5 + 3);
const NUDGES: Array<[number, number]> = [[0, 0], [0, 0.45], [0, -0.45], [0.45, 0], [-0.45, 0]];
/** Try the chosen kind, then smaller stand-ins (and small nudges), so narrow strips still fill. */
function plant(t: OutskirtsTown, kinds: string[], x: number, z: number, scale: number, nudge = false): boolean {
  for (const [dx, dz] of nudge ? NUDGES : NUDGES.slice(0, 1)) {
    for (const k of kinds) for (const s of [scale, scale * 0.88]) if (t.add({ kind: k, x: x + dx, z: z + dz, scale: k === 'veg.bush' ? Math.max(0.85, s) : s })) return true;
  }
  return false;
}

/** Tree rows just inside the board edge, broken by noise into stands and gaps: a pine-led forest rim on the
 *  mountain (north/west) edges, a loose fringe of low shore trees and bushes on the water (south/east) edges. */
function forestRims(t: OutskirtsTown, rand: () => number): void {
  const b = t.b;
  const lines: Array<{ from: Vec2; to: Vec2; back: boolean; inset: number }> = [];
  for (const inset of [0.95, 2.35]) {
    lines.push({ from: v(b.minX + inset, b.minZ + inset), to: v(b.maxX - 0.9, b.minZ + inset), back: true, inset });
    lines.push({ from: v(b.minX + inset, b.minZ + inset), to: v(b.minX + inset, b.maxZ - 0.9), back: true, inset });
  }
  lines.push({ from: v(b.minX + 2, b.maxZ - 1.95), to: v(b.maxX - 1.95, b.maxZ - 1.95), back: false, inset: 1.95 });
  lines.push({ from: v(b.maxX - 1.95, b.minZ + 6), to: v(b.maxX - 1.95, b.maxZ - 1.95), back: false, inset: 1.95 });
  for (const ln of lines) {
    walkEdge([ln.from, ln.to], ln.back ? 1.35 : 1.7, (p, dir) => {
      const j = (rand() - 0.5) * 0.5, lat = (rand() - 0.5) * 0.35, roll = rand(), kindRoll = rand(), size = rand();
      const x = p.x + dir.x * j - dir.z * lat, z = p.z + dir.z * j + dir.x * lat;
      const q = v(x, z);
      if (t.insideRing(q)) return;
      const n = standNoise(x, z);
      if (ln.back && t.isBack(q)) {
        if (n < 0.3 || roll > (ln.inset < 2 ? 0.92 : 0.8)) return;
        const kind = pick(() => kindRoll, RIM);
        plant(t, [kind, 'veg.pine', 'veg.birch', 'veg.bush'], x, z, kind === 'veg.pine' ? 0.9 + size * 0.14 : 0.88 + size * 0.2, true);
      } else if (!ln.back && !t.isBack(q)) {
        if (n < 0.38 || roll > 0.6) return;
        const kind = pick(() => kindRoll, SHORE);
        plant(t, [kind, 'veg.bush'], x, z, kind === 'veg.bush' ? 0.9 + size * 0.3 : 0.82 + size * 0.14);
      }
    });
  }
}

function woodland(t: OutskirtsTown, rand: () => number): void {
  const b = t.b, pitch = 1.5, rowStep = pitch * 0.866;
  for (let row = 0, gz = b.minZ + 0.6; gz < b.maxZ - 0.4; row++, gz += rowStep) {
    for (let gx = b.minX + 0.6 + (row % 2 ? pitch / 2 : 0); gx < b.maxX - 0.4; gx += pitch) {
      const x = gx + (rand() - 0.5) * 0.7, z = gz + (rand() - 0.5) * 0.7;
      const roll = rand(), kindRoll = rand(), size = rand();
      const p = v(x, z);
      if (t.insideRing(p)) continue;
      const n = standNoise(x, z);
      // the NE and SW corners, where the ridge meets the lake, are wooded headlands
      const headland = (z - b.minZ < 12 && b.maxX - x < 7) || (b.maxZ - z < 12 && x - b.minX < 10);
      const clump = headland ? Math.max(0.8, n) : n < 0.3 ? 0 : n < 0.4 ? 0.5 : 1;
      if (t.isBack(p)) {
        const d = t.backDist(p);
        const dens = (d < 2.6 ? 0.95 : d < 5.5 ? 0.78 : 0.5) * clump;
        if (roll > dens) {
          if (clump > 0 && d > 1.8 && roll < dens + 0.14) plant(t, ['veg.bush'], x, z, 0.85 + size * 0.3); // undergrowth at the wood's edge
          continue;
        }
        const kind = pick(() => kindRoll, d < 2.6 ? RIM : WOOD);
        const scale = kind === 'veg.pine' ? (d < 2 ? 1.02 : 0.94) + size * 0.13 : kind === 'veg.bush' ? 0.9 + size * 0.3 : 0.88 + size * 0.2;
        plant(t, [kind, 'veg.pine', 'veg.birch', 'veg.bush'], x, z, scale, true);
      } else {
        const dens = (t.frontDist(p) < 3 ? 0.46 : 0.36) * clump;
        if (roll > dens) continue;
        const kind = pick(() => kindRoll, SHORE);
        plant(t, [kind, 'veg.bush'], x, z, kind === 'veg.bush' ? 0.9 + size * 0.3 : 0.82 + size * 0.14);
      }
    }
  }
}

// ---------------------------------------------------------------- helpers
/** Straight street segments at least 6 u long (of the streets that pass `which`). */
function straights(t: OutskirtsTown, which: (edge: Vec2[]) => boolean = () => true): Array<[Vec2, Vec2]> {
  const out: Array<[Vec2, Vec2]> = [];
  for (const pts of t.roads) if (which(pts)) for (let i = 0; i + 1 < pts.length; i++) if (dist(pts[i]!, pts[i + 1]!) >= 6) out.push([pts[i]!, pts[i + 1]!]);
  return out;
}
/** Offsets in a growing square spiral (nearest first) up to radius rmax. */
function spiral(rmax: number, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = Math.ceil(rmax / step);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) out.push([i * step, j * step]);
  return out.filter(([x, z]) => Math.hypot(x, z) <= rmax + 1e-9).sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]) || p[0] - q[0] || p[1] - q[1]);
}
/** Visit points every `pitch` along a polyline (with the local direction). */
function walkEdge(pts: Vec2[], pitch: number, f: (p: Vec2, dir: Vec2) => void): void {
  let carry = pitch / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, c = pts[i + 1]!, L = dist(a, c);
    if (L < 1e-6) continue;
    const dir = v((c.x - a.x) / L, (c.z - a.z) / L);
    for (let s = carry; s <= L; s += pitch) f(v(a.x + dir.x * s, a.z + dir.z * s), dir);
    carry = pitch - ((L - carry) % pitch);
  }
}

export const OUTSKIRTS: DistrictScenery = buildOutskirts(TOWN, [CAMPUS, DOWNTOWN, APARTMENTS, STADIUM]);
