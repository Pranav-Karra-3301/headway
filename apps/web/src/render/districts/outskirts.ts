// Owner: D5. The outskirts: every bit of land outside the four neighbourhoods — the frame that makes the town carry
// on past the board edge.
//   Back (north + west, toward the Nittany Ridge): woodland belts of pine and oak that run on into the mountain
//   forests, a water-tower knoll in the north-west corner, farm fields with hedgerows and a trail along the railway.
//   Front (south + east, toward the lake): a lakeside promenade with benches that look out over the water and lamps
//   that glow at dusk, a marina café on the south-east corner, birches and cherries — nothing tall on the camera side.
//   Between the railway and the ring road and in the leftover town blocks: cottages facing the street with mailboxes,
//   side hedges, back fences and allotment gardens; orchards in the rail-corner pockets; avenues along the arterials.
// Everything is derived from TOWN and the other districts' items: one placer rejects anything on a road or sidewalk,
// the rail, inside a neighbourhood (inside the ring road), within 2 u of a stop/platform/queue line, crowding a
// station or level crossing (D4) or a road exit (tunnel/bridge), on another district's items/paths/areas, or hiding a
// stop, platform or bus route from the camera. So the scenery adapts when the town layout changes. Deterministic.
// NB: this module imports the other four district modules (to stay clear of their items); they must not import it.
import { stationPlacement, TOWN } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import { CATALOG_BY_KIND } from '../assets/catalog';
import type { AssetParams, PlacedAsset } from '../assets/types';
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
}

/** The town as seen by the outskirts placer (exported for dev tooling). */
export class OutskirtsTown {
  readonly b: TownMap['bounds'];
  readonly roads: Vec2[][];
  readonly inner: Vec2[][];
  readonly rail: Vec2[];
  readonly railBox: Rect;
  readonly circles: Array<{ c: Vec2; r: number }>;
  readonly keepRects: Rect[] = [];
  readonly keepCaps: Capsule[] = [];
  readonly foreign: Rect[] = [];
  readonly foreignCaps: Capsule[] = [];
  readonly foreignAreas: Vec2[][] = [];
  readonly watch: Array<{ p: Vec2; eye: number; tan: number }> = [];
  readonly exits: Array<{ p: Vec2; dir: Vec2; side: 'n' | 's' | 'e' | 'w'; edge: Vec2[] }> = [];
  readonly items: PlacedAsset[] = [];
  readonly paths: FootPath[] = [];
  readonly areas: GroundArea[] = [];
  private readonly ownRects: Rect[] = [];
  private readonly ringCache = new Map<string, boolean>();

  constructor(readonly map: TownMap, others: DistrictScenery[]) {
    const b = (this.b = map.bounds);
    const onEdge = (p: Vec2) => p.x <= b.minX + 0.75 || p.x >= b.maxX - 0.75 || p.z <= b.minZ + 0.75 || p.z >= b.maxZ - 0.75;
    this.roads = map.roads.edges.map((e) => e.path.points);
    this.inner = map.roads.edges.filter((e) => !e.path.points.some(onEdge)).map((e) => e.path.points);
    this.rail = map.rail.loop.points;
    const xs = this.rail.map((p) => p.x), zs = this.rail.map((p) => p.z);
    this.railBox = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
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
      for (const p of d.paths) for (let i = 0; i + 1 < p.points.length; i++) this.foreignCaps.push({ a: p.points[i]!, b: p.points[i + 1]!, r: p.width / 2 + 0.15 });
      for (const a of d.areas) this.foreignAreas.push(a.polygon);
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
  outsideRail(p: Vec2): boolean { return !pip(p, this.rail); }
  roadDist(r: Rect): number { let best = Infinity; for (const pts of this.roads) best = Math.min(best, lineRectDist(pts, false, r)); return best; }
  railDist(r: Rect): number { return lineRectDist(this.rail, true, r); }

  /** Is this patch of ground free of roads, rail, claims, keep-outs and other districts? (No own-item check.) */
  groundFree(r: Rect, road = 2.2, rail = 1.7): boolean {
    const b = this.b;
    if (r.x0 < b.minX + 0.15 || r.x1 > b.maxX - 0.15 || r.z0 < b.minZ + 0.15 || r.z1 > b.maxZ - 0.15) return false;
    if (this.roadDist(r) < road || this.railDist(r) < rail) return false;
    if (this.keepRects.some((k) => overlaps(k, r))) return false;
    if (this.keepCaps.some((c) => segRectDist(c.a, c.b, r) < c.r)) return false;
    const mid = v((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
    if (this.insideRing(mid)) {
      for (const { c, r: rad } of this.circles) if (Math.hypot(Math.max(r.x0 - c.x, 0, c.x - r.x1), Math.max(r.z0 - c.z, 0, c.z - r.z1)) < rad + 1.2) return false;
    }
    if (this.foreign.some((f) => overlaps(f, r))) return false;
    if (this.foreignCaps.some((c) => segRectDist(c.a, c.b, r) < c.r)) return false;
    if (this.foreignAreas.some((poly) => rectHitsPoly(r, poly))) return false;
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
  freeOfOwn(r: Rect, pad: number, onPath: boolean): boolean {
    if (this.ownRects.some((o) => overlaps(grow(o, pad), r))) return false;
    if (!onPath && this.paths.some((p) => p.points.some((a, i) => i + 1 < p.points.length && segRectDist(a, p.points[i + 1]!, r) < p.width / 2 + 0.08))) return false;
    return true;
  }
  fits(it: PlacedAsset, o: Opts = {}): boolean {
    const r = itemRect(it), h = heightOf(it);
    const thin = it.kind === 'st.lamp' || it.kind === 'st.flag';
    if (!this.groundFree(r, o.road ?? (SMALL(it) ? 1.65 : 2.2), o.rail ?? 1.7)) return false;
    if (!this.freeOfOwn(r, o.pad ?? 0, o.onPath ?? false)) return false;
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
    this.ownRects.push(itemRect(clean));
    return true;
  }
  /** Reserve ground for an area (fields, lawns, plazas): no items of others, roads or rail under it. */
  area(kind: GroundArea['kind'], r: Rect, chamfer = 0.4): boolean {
    if (!this.groundFree(r, 1.75, 1.3)) return false;
    const c = Math.min(chamfer, (r.x1 - r.x0) / 3, (r.z1 - r.z0) / 3);
    this.areas.push({
      kind,
      polygon: [v(r.x0 + c, r.z0), v(r.x1 - c, r.z0), v(r.x1, r.z0 + c), v(r.x1, r.z1 - c), v(r.x1 - c, r.z1), v(r.x0 + c, r.z1), v(r.x0, r.z1 - c), v(r.x0, r.z0 + c)]
        .map((p) => v(r3(p.x), r3(p.z))),
    });
    return true;
  }
  path(points: Vec2[], width: number): void {
    if (points.length >= 2) this.paths.push({ points: points.map((p) => v(r3(p.x), r3(p.z))), width, kind: 'footpath' });
  }
}

// ---------------------------------------------------------------- the dressing
const S = 0, E = Math.PI / 2, N = Math.PI, W = -Math.PI / 2;
/** Rotation that turns a model's front (+z) toward the unit direction d (snapped to quarter turns). */
const faceTo = (d: Vec2) => (Math.abs(d.x) > Math.abs(d.z) ? (d.x > 0 ? E : W) : d.z > 0 ? S : N);
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
  const tree = (kind: string, x: number, z: number, scale = 1, params?: AssetParams) =>
    t.add({ kind, x, z, scale, ...(params ? { params } : {}) });

  waterTowerKnoll(t);
  lakesideCafe(t);
  promenades(t);
  cottages(t, rand);
  allotments(t);
  pocketOrchards(t);
  farmFields(t, rand);
  avenues(t, tree);
  belts(t, rand, tree);
  return { id: 'outskirts', region: { polygon: outskirtsRegion(map) }, items: t.items, paths: t.paths, areas: t.areas };
}

/** NW corner: the water tower on a fenced lawn knoll (the woodland belt closes in around it later). */
function waterTowerKnoll(t: OutskirtsTown): void {
  const b = t.b;
  const target = v(b.minX + 3.6, b.minZ + 3.7);
  const box = 4.8;
  for (const [dx, dz] of spiral(3, 0.4)) {
    const c = v(target.x + dx, target.z + dz);
    const r = rectAt(c.x, c.z, box + 0.4, box + 0.4);
    if (!t.groundFree(r, 2.4, 1.5) || !t.freeOfOwn(r, 0, false)) continue;
    if (!t.add({ kind: 'lm.waterTower', x: c.x, z: c.z, rot: S })) continue;
    t.area('lawn', rectAt(c.x, c.z, box - 0.1, box - 0.1), 0.6);
    const h = box / 2, len = box - 0.1;
    const fence = (x: number, z: number, rot: number, length: number) =>
      t.add({ kind: 'st.fence', x, z, rot, params: { length, style: 'rail' } }, { rail: 1.3 });
    fence(c.x, c.z - h, S, len);
    fence(c.x - h, c.z, E, len);
    fence(c.x + h, c.z, E, len);
    // gate gap in the south fence, toward the town
    const seg = (len - 1.3) / 2;
    fence(c.x - h + seg / 2 + 0.05, c.z + h, S, seg);
    fence(c.x + h - seg / 2 - 0.05, c.z + h, S, seg);
    t.add({ kind: 'veg.bush', x: c.x + 1.35, z: c.z + h + 0.75 });
    t.add({ kind: 'veg.bush', x: c.x - 1.4, z: c.z + h + 0.7, scale: 0.85 });
    return;
  }
}

/** SE corner (closest to the camera, by the marina): a little café plaza with a kiosk, umbrella tables and a flag. */
function lakesideCafe(t: OutskirtsTown): void {
  const b = t.b;
  const target = v(b.maxX - 3.9, b.maxZ - 3.2);
  for (const [dx, dz] of spiral(3, 0.4)) {
    const c = v(target.x + dx, target.z + dz);
    const plaza = rectAt(c.x, c.z, 5.6, 4.0);
    if (!t.groundFree(grow(plaza, 0.2), 2.2, 1.5)) continue;
    t.area('plaza', plaza, 0.7);
    t.add({ kind: 'st.kiosk', x: c.x - 1.7, z: c.z - 1.1, rot: S, params: { color: 0 } });
    t.add({ kind: 'st.tableUmbrella', x: c.x + 0.1, z: c.z - 0.75, params: { color: 1 } });
    t.add({ kind: 'st.tableUmbrella', x: c.x + 1.75, z: c.z - 0.6, params: { color: 2 } });
    t.add({ kind: 'st.tableUmbrella', x: c.x + 0.9, z: c.z + 0.9, params: { color: 0 } });
    t.add({ kind: 'st.flag', x: c.x + 2.55, z: c.z + 1.65, params: { color: 1 } });
    t.add({ kind: 'veg.planter', x: c.x - 2.35, z: c.z + 1.35 });
    t.add({ kind: 'veg.planter', x: c.x - 0.75, z: c.z + 1.45 });
    t.add({ kind: 'st.bin', x: c.x - 2.45, z: c.z + 0.2 });
    t.add({ kind: 'st.lamp', x: c.x + 2.55, z: c.z - 1.75 }, { onPath: true });
    return;
  }
}

/** Promenade along the water sides (south and east board edges): a footpath at the edge, benches facing the lake,
 *  lamps between them, bins and flowerbeds. Interrupted where roads leave the board. */
function promenades(t: OutskirtsTown): void {
  const b = t.b, inset = 0.65, width = 0.9;
  const sides: Array<{ along: (s: number) => Vec2; inward: Vec2; from: number; to: number; rot: number }> = [
    { along: (s) => v(s, b.maxZ - inset), inward: v(0, -1), from: b.minX + 4.5, to: b.maxX - 0.8, rot: S },
    { along: (s) => v(b.maxX - inset, s), inward: v(-1, 0), from: b.minZ + 9, to: b.maxZ - 0.8, rot: E },
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
        // a flowerbed or a low bush cluster beside every other lamp
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
 *  mailbox at the kerb, hedges between neighbours, one picket fence along the back of the group. */
function cottages(t: OutskirtsTown, rand: () => number): void {
  const MAX = 16;
  let colour = 0, houses = 0;
  for (const e of t.map.roads.edges) {
    const pts = e.path.points;
    if (pts.length !== 2) continue; // straight streets only
    const a = pts[0]!, c = pts[1]!, L = dist(a, c);
    if (L < 6) continue;
    const tx = (c.x - a.x) / L, tz = (c.z - a.z) / L, horiz = Math.abs(tx) > 0.5;
    for (const sideSign of [1, -1]) {
      const n = v(-tz * sideSign, tx * sideSign); // from the road toward the lots
      const off = n.x + n.z > 0.4 ? 3.75 : 3.45; // camera-side lots sit a little further back
      const rot = faceTo(v(-n.x, -n.z));
      const fwd = v(-n.x, -n.z), right = v(fwd.z, -fwd.x); // the model's +x in world
      const at = (s: number, lat: number) => v(a.x + tx * s + n.x * lat, a.z + tz * s + n.z * lat);
      let group: number[] = [];
      const flush = () => {
        for (let i = 0; i + 1 < group.length; i++) {
          const hp = at((group[i]! + group[i + 1]!) / 2, off + 0.1);
          t.add({ kind: 'veg.hedge', x: hp.x, z: hp.z, rot: horiz ? E : S, params: { length: 2.3 } });
        }
        if (group.length) {
          const s0 = group[0]! - 1.45, s1 = group[group.length - 1]! + 1.45, fp = at((s0 + s1) / 2, off + 1.62);
          t.add({ kind: 'st.fence', x: fp.x, z: fp.z, rot: horiz ? S : E, params: { length: r3(s1 - s0), style: 'picket' } }, { rail: 1.25 });
        }
        group = [];
      };
      let s = 2.4;
      while (s <= L - 2.4 && houses < MAX) {
        const p = at(s, off);
        const [wall, roof] = COTTAGES[colour % COTTAGES.length]!;
        const porch = colour % 2 ? 'left' : 'right';
        const house: PlacedAsset = { kind: 'res.house', x: p.x, z: p.z, rot, params: { wall, roof, porch, style: colour % 3 === 1 ? 'front' : 'side' } };
        if (!t.add(house, { pad: 0.12 })) {
          if (group.length && s - group[group.length - 1]! > 4.2) flush();
          s += 0.4;
          continue;
        }
        houses++; colour++;
        group.push(s);
        // mailbox at the kerb on the porch side
        const side = porch === 'right' ? 1 : -1, mb = v(p.x + right.x * side * 1.05 - n.x * (off - 1.95), p.z + right.z * side * 1.05 - n.z * (off - 1.95));
        t.add({ kind: 'st.mailbox', x: mb.x, z: mb.z, rot });
        if (group.length >= 3 || (group.length === 2 && rand() < 0.55)) { flush(); s += 3.5 + 4.2 + rand() * 1.5; }
        else s += 3.55 + rand() * 0.3;
      }
      flush();
    }
  }
}

/** Allotment gardens in the inner bands (between the railway and the ring road) where a patch by a street is free. */
function allotments(t: OutskirtsTown): void {
  let made = 0;
  for (const e of t.map.roads.edges) {
    const pts = e.path.points;
    if (pts.length !== 2 || made >= 4) continue;
    const a = pts[0]!, c = pts[1]!, L = dist(a, c), tx = (c.x - a.x) / L, tz = (c.z - a.z) / L, horiz = Math.abs(tx) > 0.5;
    for (const sgn of [1, -1]) {
      const n = v(-tz * sgn, tx * sgn);
      for (let s = 3; s <= L - 3 && made < 4; s += 0.5) {
        const mid = v(a.x + tx * s + n.x * 4.1, a.z + tz * s + n.z * 4.1);
        if (t.outsideRail(mid) || t.insideRing(mid)) continue;
        const r = horiz ? rectAt(mid.x, mid.z, 4.6, 2.8) : rectAt(mid.x, mid.z, 2.8, 4.6);
        if (!t.groundFree(grow(r, 0.1)) || !t.freeOfOwn(grow(r, 0.3), 0, false)) continue;
        if (!t.area('garden', r, 0.3)) continue;
        for (const k of [-1, 1]) {
          const fb = horiz ? v(mid.x + k * 1.15, mid.z) : v(mid.x, mid.z + k * 1.15);
          t.add({ kind: 'veg.flowerbed', x: fb.x, z: fb.z, rot: horiz ? E : S });
        }
        made++;
        s += 7;
      }
    }
  }
}

/** Rail-corner pockets inside the loop (between the rail bend and the ring road): fenced cherry orchards. */
function pocketOrchards(t: OutskirtsTown): void {
  const R = t.railBox;
  const pockets = [v(R.x0 + 6.4, R.z0 + 4.4), v(R.x1 - 6.4, R.z0 + 4.4), v(R.x0 + 6.4, R.z1 - 4.4), v(R.x1 - 6.4, R.z1 - 4.4)];
  for (const target of pockets) {
    for (const [cols, rows] of [[3, 2], [2, 2]] as const) {
      const w = cols * 2.0 + 0.4, d = rows * 2.0 + 0.4;
      let done = false;
      for (const [dx, dz] of spiral(3.2, 0.4)) {
        const c = v(target.x + dx, target.z + dz), r = rectAt(c.x, c.z, w, d);
        if (!t.groundFree(grow(r, 0.2)) || !t.freeOfOwn(grow(r, 0.2), 0, false)) continue;
        // every tree must pass (visibility etc.)
        const trees: PlacedAsset[] = [];
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) trees.push({ kind: 'veg.cherry', x: c.x - w / 2 + 1.2 + i * 2.0, z: c.z - d / 2 + 1.2 + j * 2.0, scale: 0.92 });
        if (!trees.every((tr) => t.fits(tr))) continue;
        t.area('garden', r, 0.5);
        trees.forEach((tr) => t.add(tr));
        done = true;
        break;
      }
      if (done) break;
    }
  }
}

/** Mountain-side outer band (west): long fields with hedgerows at the ends and a rail fence along the trail. */
function farmFields(t: OutskirtsTown, rand: () => number): void {
  const b = t.b, R = t.railBox;
  const x0 = b.minX + 0.5, x1 = R.x0 - 2.4; // field strip between the board edge and the railway trail
  if (x1 - x0 < 2.4) return;
  // trail along the railway: from the knoll gate down to the fields
  const trailX = R.x0 - 1.68;
  const knoll = t.items.find((it) => it.kind === 'lm.waterTower');
  const fields: Array<[number, number]> = [];
  for (const [z0, z1] of [[-15.5, -6.5], [6.5, 15.5]] as const) {
    for (const shrink of [0, 1, 2, 3]) {
      const r: Rect = { x0, x1, z0: z0 + shrink, z1: z1 - shrink };
      if (r.z1 - r.z0 < 3.5 || !t.groundFree(r, 2.2, 1.7) || !t.freeOfOwn(r, 0, false)) continue;
      t.area('garden', r, 0.3);
      fields.push([r.z0, r.z1]);
      // hedgerows at both ends, a rail fence along the trail side
      const hl = x1 - x0 - 0.3;
      t.add({ kind: 'veg.hedge', x: (x0 + x1) / 2, z: r.z0 - 0.45, params: { length: hl } });
      t.add({ kind: 'veg.hedge', x: (x0 + x1) / 2, z: r.z1 + 0.45, params: { length: hl } });
      t.add({ kind: 'st.fence', x: x1 + 0.13, z: (r.z0 + r.z1) / 2, rot: E, params: { length: r.z1 - r.z0 - 0.4, style: 'rail' } }, { rail: 1.25 });
      // a few bushes along the field edge and a lone tree in the field corner
      t.add({ kind: 'veg.oak', x: x0 + 1.0, z: r.z0 + 1.1, scale: 0.95 + rand() * 0.15 });
      break;
    }
  }
  if (knoll) {
    const zs = [knoll.z + 2.6, ...fields.map(([z0]) => z0).filter((z) => z < 0)];
    const zEnd = Math.max(...zs);
    if (zEnd - knoll.z > 4) t.path([v(knoll.x, knoll.z + 2.45), v(knoll.x, knoll.z + 3.4), v(trailX, knoll.z + 4.6), v(trailX, zEnd)], 0.8);
  }
}

/** Trees along the arterials that leave town (one species per street), and along streets through leftover blocks. */
function avenues(t: OutskirtsTown, tree: (kind: string, x: number, z: number, scale?: number, params?: AssetParams) => boolean): void {
  const species = ['veg.maple', 'veg.oak', 'veg.birch', 'veg.maple'];
  t.exits.forEach((ex, i) => {
    const pts = ex.edge;
    const kind = species[i % species.length]!;
    walkEdge(pts, 3.2, (p, dir) => {
      for (const sgn of [1, -1]) {
        const n = v(-dir.z * sgn, dir.x * sgn);
        tree(kind, p.x + n.x * 3.1, p.z + n.z * 3.1, 0.9, { variant: i * 3 + 1 });
      }
    });
  });
  // leftover town blocks (inside the ring, outside the neighbourhoods): a street tree every few metres
  for (const e of t.map.roads.edges) {
    walkEdge(e.path.points, 3.4, (p, dir) => {
      for (const sgn of [1, -1]) {
        const n = v(-dir.z * sgn, dir.x * sgn), q = v(p.x + n.x * 3.1, p.z + n.z * 3.1);
        if (!t.insideRing(q)) continue;
        tree('veg.oak', q.x, q.z, 0.85, { variant: 4 });
      }
    });
  }
}

/** Woodland belts in the band between the railway and the board edge: dense pine/oak at the mountain sides with
 *  clumps and clearings, sparse birches, cherries and bushes on the water sides; plus fill in the inner bands. */
function belts(t: OutskirtsTown, rand: () => number, tree: (kind: string, x: number, z: number, scale?: number) => boolean): void {
  const b = t.b;
  const BACK: Pick = [['veg.pine', 50], ['veg.oak', 20], ['veg.maple', 14], ['veg.birch', 10], ['veg.poplar', 6]];
  const FRONT: Pick = [['veg.birch', 34], ['veg.cherry', 30], ['veg.bush', 36]];
  const INNER: Pick = [['veg.oak', 34], ['veg.maple', 26], ['veg.birch', 20], ['veg.bush', 20]];
  const step = 1.85;
  for (let gz = b.minZ + 0.9; gz < b.maxZ - 0.5; gz += step * 0.866) {
    const row = Math.round((gz - b.minZ) / (step * 0.866));
    for (let gx = b.minX + 0.9 + (row % 2) * step * 0.5; gx < b.maxX - 0.5; gx += step) {
      const x = gx + (rand() - 0.5) * 0.7, z = gz + (rand() - 0.5) * 0.6;
      const p = v(x, z);
      const dn = z - b.minZ, ds = b.maxZ - z, dw = x - b.minX, de = b.maxX - x;
      const outer = t.outsideRail(p);
      const back = Math.min(dn, dw) <= Math.min(ds, de);
      const clump = noise2(x / 6.5 + 11, z / 6.5 + 3);
      const roll = rand(), kindRoll = rand(), sizeRoll = rand();
      if (outer) {
        if (back) {
          if (clump < 0.24 || roll > 0.92) continue;
          const kind = pick(() => kindRoll, BACK);
          const edge = Math.min(dn, dw) < 1.6;
          tree(kind, x, z, kind === 'veg.pine' ? (edge ? 1.12 : 1.0) + sizeRoll * 0.22 : 0.9 + sizeRoll * 0.2);
        } else {
          if (clump < 0.5 || roll > 0.45) continue;
          const kind = pick(() => kindRoll, FRONT);
          tree(kind, x, z, kind === 'veg.bush' ? 0.9 + sizeRoll * 0.3 : 0.82 + sizeRoll * 0.14);
        }
      } else if (!t.insideRing(p)) {
        // inner band between rail and ring road: soft groups, more open
        if (clump < 0.42 || roll > 0.55) continue;
        const kind = pick(() => kindRoll, INNER);
        tree(kind, x, z, kind === 'veg.bush' ? 0.9 + sizeRoll * 0.3 : 0.85 + sizeRoll * 0.2);
      }
    }
  }
}

// ---------------------------------------------------------------- helpers
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
