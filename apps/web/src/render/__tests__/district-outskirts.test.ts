// Owner: D5 outskirts. The land outside the four neighbourhoods: tree belts along the board edges and arterials, a
// few houses, the water tower, fields/gardens as areas, hedges and fences, a lakeside promenade. Checks the district
// contract (region, registered kinds that build, validatePlacements, 2 u around stops/platforms/queues, stations and
// level crossings left to D4, no overlap with the other districts), the composition rules (nothing tall on the
// camera/water side, nothing hiding a stop, platform or queue line from the default camera) and the content.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { stationPlacement, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG_BY_KIND, createRegistry } from '../assets/index';
import type { PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { DISTRICTS } from '../districts/index';
import { buildOutskirts, OUTSKIRTS } from '../districts/outskirts';

// ---------------------------------------------------------------- geometry helpers (independent of the module)
interface Rect { x0: number; x1: number; z0: number; z1: number }
const rectOf = (it: PlacedAsset): Rect => {
  const f = footprintOf(it);
  return { x0: it.x - f.w / 2, x1: it.x + f.w / 2, z0: it.z - f.d / 2, z1: it.z + f.d / 2 };
};
const corners = (r: Rect): Vec2[] => [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x0, z: r.z1 }, { x: r.x1, z: r.z1 }];
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
const inRect = (p: Vec2, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
/** Distance from segment ab to rectangle r (0 when they touch). */
function segRectDist(a: Vec2, b: Vec2, r: Rect): number {
  if (inRect(a, r) || inRect(b, r)) return 0;
  const cs = corners(r), edges: Array<[Vec2, Vec2]> = [[cs[0]!, cs[1]!], [cs[1]!, cs[3]!], [cs[3]!, cs[2]!], [cs[2]!, cs[0]!]];
  if (edges.some(([c, d]) => segsCross(a, b, c, d))) return 0;
  const ex = (p: Vec2) => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1));
  return Math.min(ex(a), ex(b), ...cs.map((c) => segDist(c, a, b)));
}
function polyRectDist(pts: Vec2[], closed: boolean, r: Rect): number {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, segRectDist(pts[i]!, pts[(i + 1) % pts.length]!, r));
  return best;
}
function rectCircleDist(r: Rect, c: Vec2, radius: number): number {
  const dx = Math.max(r.x0 - c.x, 0, c.x - r.x1), dz = Math.max(r.z0 - c.z, 0, c.z - r.z1);
  return Math.hypot(dx, dz) - radius;
}
function pipEvenOdd(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function windingNumber(p: Vec2, poly: Vec2[]): number {
  let w = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z);
    if (a.z <= p.z) { if (b.z > p.z && cross > 0) w++; } else if (b.z <= p.z && cross < 0) w--;
  }
  return w;
}

const items = OUTSKIRTS.items;
const B = TOWN.bounds;
const H = (it: PlacedAsset) => (CATALOG_BY_KIND.get(it.kind)?.h ?? 1) * (it.scale ?? 1);
const isVeg = (k: string) => k.startsWith('veg.');
const TREES = new Set(['veg.oak', 'veg.maple', 'veg.pine', 'veg.birch', 'veg.poplar', 'veg.cherry']);
const HOUSES = new Set(['res.house', 'res.townhouses']);
const insideCircle = (p: Vec2) => TOWN.neighborhoods.some((n) => Math.hypot(p.x - n.center.x, p.z - n.center.z) < n.radius);
/** Road/rail crossings (where D4 puts its level crossings). */
function railCrossings(): Vec2[] {
  const out: Vec2[] = [];
  const rail = TOWN.rail.loop.points;
  for (const e of TOWN.roads.edges) {
    const pts = e.path.points;
    for (let i = 0; i + 1 < pts.length; i++) for (let j = 0; j < rail.length; j++) {
      const a = pts[i]!, b = pts[i + 1]!, c = rail[j]!, d = rail[(j + 1) % rail.length]!;
      if (!segsCross(a, b, c, d)) continue;
      const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
      const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}
/** Points the player must always see: every stop, platform and its queue line. */
function watchPoints(): Vec2[] {
  const out: Vec2[] = [];
  const add = (p: Vec2, dir: Vec2) => { for (let k = 0; k <= 4; k++) out.push({ x: p.x + dir.x * k, z: p.z + dir.z * k }); };
  for (const s of TOWN.stops) add(s.p, s.queueDir);
  for (const s of TOWN.rail.stations) add(s.platform, s.queueDir);
  return out;
}

describe('D5 outskirts: district contract', () => {
  it('is the last district and has items, paths and areas', () => {
    expect(OUTSKIRTS.id).toBe('outskirts');
    expect(DISTRICTS[DISTRICTS.length - 1]).toBe(OUTSKIRTS);
    expect(items.length).toBeGreaterThan(120);
    expect(OUTSKIRTS.paths.length).toBeGreaterThanOrEqual(2);
    expect(OUTSKIRTS.areas.length).toBeGreaterThanOrEqual(4);
  });

  it('region is the board outside the four neighbourhoods (even-odd and winding rules agree)', () => {
    expect('polygon' in OUTSKIRTS.region).toBe(true);
    const poly = (OUTSKIRTS.region as { polygon: Vec2[] }).polygon;
    let checked = 0;
    for (let x = B.minX + 0.75; x < B.maxX; x += 1.5) for (let z = B.minZ + 0.75; z < B.maxZ; z += 1.5) {
      const p = { x, z };
      const nearRim = TOWN.neighborhoods.some((n) => Math.abs(Math.hypot(x - n.center.x, z - n.center.z) - n.radius) < 0.6);
      if (nearRim) continue;
      const want = !insideCircle(p);
      expect(pipEvenOdd(p, poly), `even-odd at ${x},${z}`).toBe(want);
      expect(windingNumber(p, poly) !== 0, `winding at ${x},${z}`).toBe(want);
      checked++;
    }
    expect(checked).toBeGreaterThan(1200);
  });

  it('places only registered catalog kinds, and every item builds with the basic kit', () => {
    const registry = createRegistry();
    const kit = createBasicKit(registry.roles);
    for (const it of items) {
      expect(CATALOG_BY_KIND.has(it.kind), it.kind).toBe(true);
      expect(registry.get(it.kind), `${it.kind} registered`).toBeDefined();
      expect(Number.isFinite(it.x) && Number.isFinite(it.z)).toBe(true);
      if (!isVeg(it.kind)) expect(Math.abs(((it.rot ?? 0) / (Math.PI / 2)) % 1), `${it.kind} quarter turns`).toBeLessThan(1e-9);
    }
    const seen = new Set<string>();
    for (const it of items) {
      const key = it.kind + JSON.stringify(it.params ?? {});
      if (seen.has(key)) continue;
      seen.add(key);
      const obj = registry.build(kit, it);
      expect(obj.userData.placeholder, it.kind).toBeUndefined();
      expect(new THREE.Box3().setFromObject(obj).isEmpty()).toBe(false);
    }
  });

  it('passes validatePlacements(TOWN) with no errors', () => {
    expect(validatePlacements(TOWN, items)).toEqual([]);
  });

  it('keeps 2 u clear around stops, platforms and their queue lines', () => {
    const lines: Array<[Vec2, Vec2]> = [
      ...TOWN.stops.map((s) => [s.p, { x: s.p.x + s.queueDir.x * 4, z: s.p.z + s.queueDir.z * 4 }] as [Vec2, Vec2]),
      ...TOWN.rail.stations.map((s) => [s.platform, { x: s.platform.x + s.queueDir.x * 4, z: s.platform.z + s.queueDir.z * 4 }] as [Vec2, Vec2]),
    ];
    for (const it of items) for (const [a, b] of lines) expect(segRectDist(a, b, rectOf(it)), `${it.kind} at ${it.x},${it.z}`).toBeGreaterThanOrEqual(2);
  });

  it('leaves the station buildings and level crossings to D4', () => {
    for (const s of TOWN.rail.stations) {
      const pl = stationPlacement(s.id);
      const c = CATALOG_BY_KIND.get(s.id === 'stn_central' ? 'lm.stationCentral' : 'lm.stationHalt')!;
      const station = rectOf({ kind: c.kind, x: pl.x, z: pl.z, rot: pl.rot });
      const keep = { x0: station.x0 - 2, x1: station.x1 + 2, z0: station.z0 - 2, z1: station.z1 + 2 };
      for (const it of items) {
        const r = rectOf(it);
        const hit = r.x0 < keep.x1 && r.x1 > keep.x0 && r.z0 < keep.z1 && r.z1 > keep.z0;
        expect(hit, `${it.kind} at ${it.x},${it.z} crowds ${s.id}`).toBe(false);
      }
    }
    const crossings = railCrossings();
    expect(crossings.length).toBeGreaterThanOrEqual(1);
    for (const c of crossings) {
      const keep = { x0: c.x - 2.5, x1: c.x + 2.5, z0: c.z - 2.5, z1: c.z + 2.5 };
      for (const it of items) {
        const r = rectOf(it);
        expect(r.x0 < keep.x1 && r.x1 > keep.x0 && r.z0 < keep.z1 && r.z1 > keep.z0, `${it.kind} on crossing ${c.x},${c.z}`).toBe(false);
      }
    }
  });

  it('stays out of the neighbourhoods (only beyond a street from a neighbourhood centre)', () => {
    const roads = TOWN.roads.edges.map((e) => e.path.points);
    const crossesRoad = (a: Vec2, b: Vec2) => roads.some((pts) => pts.some((p, i) => i + 1 < pts.length && segsCross(a, b, p, pts[i + 1]!)));
    for (const it of items) for (const n of TOWN.neighborhoods) for (const c of [...corners(rectOf(it)), { x: it.x, z: it.z }]) {
      if (Math.hypot(c.x - n.center.x, c.z - n.center.z) >= n.radius) continue;
      expect(crossesRoad(n.center, c), `${it.kind} at ${it.x},${it.z} inside ${n.id}`).toBe(true);
    }
  });

  it('never overlaps the other districts', () => {
    const others = DISTRICTS.filter((d) => d.id !== 'outskirts').flatMap((d) => d.items);
    for (const a of items) for (const b of others) {
      const fa = footprintOf(a), fb = footprintOf(b);
      const hit = Math.abs(a.x - b.x) * 2 < fa.w + fb.w - 0.2 && Math.abs(a.z - b.z) * 2 < fa.d + fb.d - 0.2;
      expect(hit, `${a.kind} at ${a.x},${a.z} overlaps ${b.kind}`).toBe(false);
    }
  });

  it('paths and areas stay on the board, off roads and rails', () => {
    const roadPts = TOWN.roads.edges.map((e) => e.path.points);
    const rail = TOWN.rail.loop.points;
    const nearest = (p: Vec2) => Math.min(...roadPts.map((pts) => Math.min(...pts.slice(1).map((q, i) => segDist(p, pts[i]!, q)))));
    const railD = (p: Vec2) => Math.min(...rail.map((q, i) => segDist(p, q, rail[(i + 1) % rail.length]!)));
    const sample = (pts: Vec2[], closed: boolean): Vec2[] => {
      const out: Vec2[] = [];
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!, k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
        for (let j = 0; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k });
      }
      return out;
    };
    for (const p of OUTSKIRTS.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      for (const q of sample(p.points, false)) {
        expect(q.x >= B.minX && q.x <= B.maxX && q.z >= B.minZ && q.z <= B.maxZ).toBe(true);
        expect(railD(q), `path on rail at ${q.x},${q.z}`).toBeGreaterThan(1.2 + p.width / 2);
        expect(nearest(q), `path in road at ${q.x},${q.z}`).toBeGreaterThan(1.2 + p.width / 2 - 0.35);
      }
    }
    for (const a of OUTSKIRTS.areas) {
      expect(a.polygon.length).toBeGreaterThanOrEqual(3);
      for (const q of sample(a.polygon, true)) {
        expect(q.x >= B.minX && q.x <= B.maxX && q.z >= B.minZ && q.z <= B.maxZ).toBe(true);
        expect(railD(q), `${a.kind} on rail at ${q.x},${q.z}`).toBeGreaterThan(1.2);
        expect(nearest(q), `${a.kind} on road at ${q.x},${q.z}`).toBeGreaterThan(1.6);
      }
    }
  });

  it('is deterministic and derived from the town + the other districts', () => {
    const others = DISTRICTS.filter((d) => d.id !== 'outskirts');
    const again = buildOutskirts(TOWN, others);
    expect(again.items).toEqual(items);
    expect(again.paths).toEqual(OUTSKIRTS.paths);
    expect(again.areas).toEqual(OUTSKIRTS.areas);
  });
});

describe('D5 outskirts: composition', () => {
  it('nothing tall hides a stop, platform or queue line from the default camera', () => {
    const tan = Math.tan((30 * Math.PI) / 180), eye = 0.5;
    const dirs = [35, 45, 55].map((a) => ({ x: Math.sin((a * Math.PI) / 180), z: Math.cos((a * Math.PI) / 180) }));
    for (const it of items) {
      const h = H(it);
      if (h <= eye || it.kind === 'st.lamp' || it.kind === 'st.flag') continue;
      const reach = (h - eye) / tan, r = rectOf(it);
      for (const w of watchPoints()) for (const d of dirs) {
        const far = { x: w.x + d.x * reach, z: w.z + d.z * reach };
        expect(segRectDist(w, far, r), `${it.kind} at ${it.x},${it.z} hides ${w.x},${w.z}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the water side (south and east edges) low, and tall things at the back', () => {
    for (const it of items) {
      const h = H(it), r = rectOf(it);
      const waterSide = r.z1 > B.maxZ - 4.5 || r.x1 > B.maxX - 4.5;
      if (waterSide && it.kind !== 'st.lamp' && it.kind !== 'st.flag') expect(h, `${it.kind} at ${it.x},${it.z}`).toBeLessThanOrEqual(2.8);
      if (h > 4) expect(it.x < 0 && it.z < 0, `${it.kind} at ${it.x},${it.z} should stand at the back (north-west)`).toBe(true);
    }
  });

  it('frames every board edge with planting, densest at the mountain (north/west) edges', () => {
    const near = (side: 'n' | 's' | 'e' | 'w') => items.filter((it) => isVeg(it.kind) && (
      side === 'n' ? it.z < B.minZ + 5 : side === 's' ? it.z > B.maxZ - 5 : side === 'e' ? it.x > B.maxX - 5 : it.x < B.minX + 5));
    const n = near('n'), w = near('w'), s = near('s'), e = near('e');
    for (const side of [n, w, s, e]) expect(side.length).toBeGreaterThanOrEqual(8);
    expect(n.filter((it) => TREES.has(it.kind)).length).toBeGreaterThanOrEqual(14);
    expect(w.filter((it) => TREES.has(it.kind)).length).toBeGreaterThanOrEqual(14);
  });

  it('lines the arterials leaving town with trees', () => {
    const exits = TOWN.roads.edges.filter((e) => e.path.points.some((p) => p.x <= B.minX + 0.5 || p.x >= B.maxX - 0.5 || p.z <= B.minZ + 0.5 || p.z >= B.maxZ - 0.5));
    expect(exits.length).toBeGreaterThanOrEqual(3);
    let lined = 0;
    for (const e of exits) {
      const pts = e.path.points;
      const trees = items.filter((it) => TREES.has(it.kind) && Math.min(...pts.slice(1).map((q, i) => segDist(it, pts[i]!, q))) < 4.5);
      if (trees.length >= 2) lined++;
    }
    expect(lined).toBeGreaterThanOrEqual(exits.length - 1);
  });

  it('has the outskirts set pieces: a water tower, a few houses, fields and gardens, hedges and fences, a promenade', () => {
    const count = (pred: (it: PlacedAsset) => boolean) => items.filter(pred).length;
    expect(count((it) => it.kind === 'lm.waterTower')).toBe(1);
    const houses = count((it) => HOUSES.has(it.kind));
    expect(houses).toBeGreaterThanOrEqual(5);
    expect(houses).toBeLessThanOrEqual(22);
    expect(count((it) => TREES.has(it.kind))).toBeGreaterThanOrEqual(70);
    expect(count((it) => it.kind === 'veg.hedge')).toBeGreaterThanOrEqual(4);
    expect(count((it) => it.kind === 'st.fence')).toBeGreaterThanOrEqual(6);
    expect(count((it) => it.kind === 'st.bench')).toBeGreaterThanOrEqual(6);
    expect(count((it) => it.kind === 'st.lamp')).toBeGreaterThanOrEqual(6);
    expect(OUTSKIRTS.areas.filter((a) => a.kind === 'garden').length).toBeGreaterThanOrEqual(3);
    // benches along the shore look out over the water
    for (const b of items.filter((it) => it.kind === 'st.bench')) {
      const toS = B.maxZ - b.z, toE = B.maxX - b.x;
      if (Math.min(toS, toE) > 3) continue;
      const facing = Math.round((b.rot ?? 0) / (Math.PI / 2));
      expect(toS < toE ? facing === 0 : facing === 1, `bench at ${b.x},${b.z} faces the water`).toBe(true);
    }
  });

  it('houses face a street', () => {
    const roads = TOWN.roads.edges.map((e) => e.path.points);
    for (const h of items.filter((it) => HOUSES.has(it.kind))) {
      const rot = h.rot ?? 0, f = { x: Math.sin(rot), z: Math.cos(rot) };
      const front = { x: h.x + f.x * 4, z: h.z + f.z * 4 };
      const d = Math.min(...roads.map((pts) => Math.min(...pts.slice(1).map((q, i) => segDist(front, pts[i]!, q)))));
      expect(d, `${h.kind} at ${h.x},${h.z} rot ${rot}`).toBeLessThan(1.6);
    }
  });
});

describe('DEBUG', () => {
  it('knoll debug', async () => {
    const { OutskirtsTown } = await import('../districts/outskirts');
    const t = new OutskirtsTown(TOWN, DISTRICTS.filter((d) => d.id !== 'outskirts'));
    for (const [x, z, rot, len] of [[-31.2, -20.3, 0, 4.7], [-33.6, -17.9, Math.PI / 2, 4.7], [-28.8, -16.425, Math.PI / 2, 1.7]] as const) {
      const it = { kind: 'st.fence', x, z, rot, params: { length: len, style: 'rail' } };
      const f = footprintOf(it); const r = { x0: x - f.w / 2, x1: x + f.w / 2, z0: z - f.d / 2, z1: z + f.d / 2 };
      console.log('KN', x, z, 'ground', t.groundFree(r, 2.2, 1.3), 'road', t.nearRoad(r, 2.2), 'rail', t.nearRail(r, 1.3), 'fits', t.fits(it, { inArea: true, rail: 1.3 }));
    }
  });
  it('dump plan', async () => {
    const fs = await import('node:fs');
    const t0 = performance.now(); buildOutskirts(TOWN, DISTRICTS.filter((d) => d.id !== 'outskirts')); console.log('build ms', performance.now() - t0);
    const by: Record<string, number> = {}; for (const it of items) by[it.kind] = (by[it.kind] ?? 0) + 1; console.log(items.length, JSON.stringify(by)); console.log('HEDGE/FENCE', items.filter((i) => i.kind === 'veg.hedge' || i.kind === 'st.fence').map((i) => `${i.kind} ${i.x},${i.z} r${(i.rot ?? 0).toFixed(2)} ${JSON.stringify(i.params)}`).join(' | ')); console.log('HOUSES', items.filter((i) => i.kind === 'res.house').map((i) => `${i.x},${i.z} r${(i.rot ?? 0).toFixed(2)}`).join(' | '));
    const fp = (it: PlacedAsset) => ({ ...it, f: footprintOf(it), h: H(it) });
    fs.writeFileSync('/tmp/d5/plan.json', JSON.stringify({
      bounds: B, roads: TOWN.roads.edges.map((e) => ({ id: e.id, pts: e.path.points })), rail: TOWN.rail.loop.points,
      stops: TOWN.stops.map((s) => ({ p: s.p, q: s.queueDir })), platforms: TOWN.rail.stations.map((s) => ({ p: s.platform, q: s.queueDir })),
      hoods: TOWN.neighborhoods, zones: TOWN.zones.map((z) => z.door),
      districts: DISTRICTS.map((d) => ({ id: d.id, region: d.region, items: d.items.map(fp), areas: d.areas, paths: d.paths })),
    }));
  });
});
