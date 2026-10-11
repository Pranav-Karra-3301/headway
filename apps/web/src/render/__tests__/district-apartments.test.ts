// D3 apartments: the south-east district (towers, garden apartments, townhouses, parking, a playground park, hedges,
// trees). Checks placement rules against the real TOWN: the shared validator, a claimed region that keeps other
// neighbourhoods' doors and stops out, clear stops/queues/doors/walk lines, buildings set back with fronts to a
// street, room for D4's level crossings, sight lines from the camera to every stop, and well-formed paths/areas.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG_BY_KIND } from '../assets/catalog';
import * as residential from '../assets/families/residential';
import * as street from '../assets/families/street';
import * as vegetation from '../assets/families/vegetation';
import { AssetRegistry } from '../assets/registry';
import type { PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { APARTMENTS } from '../districts/apartments';

type Rect = { x0: number; x1: number; z0: number; z1: number };
const D = APARTMENTS;
const BUILDINGS = new Set(['res.tower', 'res.garden', 'res.townhouses', 'res.house']);
const TREES = new Set(['veg.oak', 'veg.maple', 'veg.pine', 'veg.birch', 'veg.poplar', 'veg.cherry']);
const QUEUE_LEN = 2.4; // queue line: slots from 0.8 to 2.4 u along queueDir (renderer), extra rows stack sideways
const CLEAR = 2.0;     // plan: keep 2 u clear around stops, platforms and their queue lines

const rectOf = (a: PlacedAsset): Rect => {
  const f = footprintOf(a);
  return { x0: a.x - f.w / 2, x1: a.x + f.w / 2, z0: a.z - f.d / 2, z1: a.z + f.d / 2 };
};
const ptRect = (p: Vec2, r: Rect): number => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1));
const rectGap = (a: Rect, b: Rect): number => Math.hypot(Math.max(a.x0 - b.x1, 0, b.x0 - a.x1), Math.max(a.z0 - b.z1, 0, b.z0 - a.z1));
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
function polyDist(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i]!, pts[i + 1]!));
  if (closed && pts.length > 2) best = Math.min(best, segDist(p, pts[pts.length - 1]!, pts[0]!));
  return best;
}
const roadDist = (p: Vec2): number => Math.min(...TOWN.roads.edges.map((e) => polyDist(p, e.path.points, e.path.closed)));
const railDist = (p: Vec2): number => polyDist(p, TOWN.rail.loop.points, true);
/** Points along a rectangle's outline every ~0.1 u. */
function outline(r: Rect): Vec2[] {
  const out: Vec2[] = [];
  const n = (len: number) => Math.max(1, Math.ceil(len / 0.1));
  for (let i = 0, k = n(r.x1 - r.x0); i <= k; i++) { const x = r.x0 + ((r.x1 - r.x0) * i) / k; out.push({ x, z: r.z0 }, { x, z: r.z1 }); }
  for (let i = 0, k = n(r.z1 - r.z0); i <= k; i++) { const z = r.z0 + ((r.z1 - r.z0) * i) / k; out.push({ x: r.x0, z }, { x: r.x1, z }); }
  return out;
}
function inPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
/** Grid samples inside a polygon (every `step` u) plus its vertices. */
function fill(poly: Vec2[], step = 0.25): Vec2[] {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const out: Vec2[] = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) if (inPoly({ x, z }, poly)) out.push({ x, z });
  return out;
}
/** Points along a polyline every ~0.1 u. */
function along(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let j = 1; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, z: a.z + ((b.z - a.z) * j) / k });
  }
  return out;
}
const region = (): Vec2[] => {
  if (!('polygon' in D.region)) throw new Error('apartments claims a polygon region');
  return D.region.polygon;
};
const frontDir = (rot = 0): Vec2 => ({ x: Math.round(Math.sin(rot)), z: Math.round(Math.cos(rot)) });
/** Queue lines of every stop and platform: from the stop along queueDir. */
const QUEUES = [
  ...TOWN.stops.map((s) => ({ id: s.id, p: s.p, dir: s.queueDir })),
  ...TOWN.rail.stations.map((s) => ({ id: s.id, p: s.platform, dir: s.queueDir })),
];
/** Every item built once with the basic kit: world bounding boxes of the real geometry. */
let cache: Array<{ it: PlacedAsset; box: THREE.Box3; placeholder: boolean }> | null = null;
function built(): Array<{ it: PlacedAsset; box: THREE.Box3; placeholder: boolean }> {
  if (cache) return cache;
  const r = new AssetRegistry();
  for (const f of [residential, vegetation, street]) f.register(r);
  const k = createBasicKit(r.roles);
  cache = D.items.map((it) => {
    const o = r.build(k, it);
    o.updateMatrixWorld(true);
    return { it, box: new THREE.Box3().setFromObject(o, true), placeholder: o.userData.placeholder === true };
  });
  return cache;
}
/** Where roads cross the rail (D4 puts a 3 × 3 level crossing on each). */
function railCrossings(): Vec2[] {
  const out: Vec2[] = [];
  const rail = TOWN.rail.loop.points;
  for (const e of TOWN.roads.edges) {
    const pts = e.path.points;
    for (let i = 0; i + 1 < pts.length; i++) for (let j = 0; j < rail.length; j++) {
      const a = pts[i]!, b = pts[i + 1]!, c = rail[j]!, d = rail[(j + 1) % rail.length]!;
      const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

describe('apartments district: identity and region', () => {
  it('is the apartments district with items, paths and areas', () => {
    expect(D.id).toBe('apartments');
    expect(D.items.length).toBeGreaterThan(40);
    expect(D.paths.length).toBeGreaterThan(0);
    expect(D.areas.length).toBeGreaterThan(2);
  });

  it('claims a south-east polygon holding its items and doors, and no other neighbourhood’s doors or stops', () => {
    const poly = region();
    expect(poly.length).toBeGreaterThanOrEqual(4);
    const hood = TOWN.neighborhoods.find((n) => n.id === 'apartments')!;
    expect(inPoly(hood.center, poly)).toBe(true);
    for (const it of D.items) expect(inPoly(it, poly), `${it.kind} at ${it.x},${it.z}`).toBe(true);
    for (const z of TOWN.zones) expect(inPoly(z.door, poly), z.id).toBe(z.neighborhood === 'apartments');
    for (const s of TOWN.stops) if (s.neighborhood !== 'apartments') expect(inPoly(s.p, poly), s.id).toBe(false);
    for (const s of TOWN.rail.stations) expect(inPoly(s.platform, poly), s.id).toBe(false);
  });
});

describe('apartments district: placements', () => {
  it('passes the shared placement validator (board, roads, rail, overlaps)', () => {
    expect(validatePlacements(TOWN, D.items)).toEqual([]);
  });

  it('places only catalog kinds that the families implement (no placeholder boxes)', () => {
    const r = new AssetRegistry();
    for (const f of [residential, vegetation, street]) f.register(r);
    for (const it of D.items) {
      expect(CATALOG_BY_KIND.has(it.kind), it.kind).toBe(true);
      expect(r.get(it.kind), it.kind).toBeDefined();
    }
  });

  it('has the full apartment mix: towers, garden apartments, townhouses, houses, parking, a playground, hedges, trees', () => {
    const n = (k: string) => D.items.filter((i) => i.kind === k).length;
    expect(n('res.tower')).toBeGreaterThanOrEqual(3);
    expect(n('res.garden')).toBeGreaterThanOrEqual(1);
    expect(n('res.townhouses')).toBeGreaterThanOrEqual(2);
    expect(n('res.house')).toBeGreaterThanOrEqual(1);
    expect(n('res.parking')).toBeGreaterThanOrEqual(1);
    expect(n('res.playground')).toBeGreaterThanOrEqual(1);
    expect(n('veg.hedge')).toBeGreaterThanOrEqual(3);
    expect(D.items.filter((i) => TREES.has(i.kind)).length).toBeGreaterThanOrEqual(14);
    expect(n('st.lamp')).toBeGreaterThanOrEqual(4);
    expect(n('st.bench')).toBeGreaterThanOrEqual(2);
  });

  it('keeps 2 u clear around every stop, platform and queue line', () => {
    for (const q of QUEUES) {
      const end = { x: q.p.x + q.dir.x * QUEUE_LEN, z: q.p.z + q.dir.z * QUEUE_LEN };
      for (const it of D.items) {
        const d = Math.min(...outline(rectOf(it)).map((p) => segDist(p, q.p, end)));
        expect(d, `${it.kind} at ${it.x},${it.z} vs ${q.id}`).toBeGreaterThanOrEqual(CLEAR - 1e-6);
      }
    }
  });

  it('never covers a zone door, and every apartments door sits at a building', () => {
    for (const z of TOWN.zones) for (const it of D.items) {
      // a door sits on its building's face (just outside the footprint); nothing else may stand on it
      expect(ptRect(z.door, rectOf(it)), `${z.id} under ${it.kind}`).toBeGreaterThan(BUILDINGS.has(it.kind) ? 0.02 : 0.25);
    }
    for (const z of TOWN.zones.filter((zz) => zz.neighborhood === 'apartments')) {
      const near = Math.min(...D.items.filter((i) => BUILDINGS.has(i.kind)).map((i) => ptRect(z.door, rectOf(i))));
      expect(near, z.id).toBeLessThanOrEqual(1.0);
    }
  });

  it('keeps the walk from every door to its nearest stop or platform free of items', () => {
    const access = [...TOWN.stops.map((s) => s.p), ...TOWN.rail.stations.map((s) => s.platform)];
    for (const z of TOWN.zones) {
      const to = access.reduce((a, b) => (Math.hypot(b.x - z.door.x, b.z - z.door.z) < Math.hypot(a.x - z.door.x, a.z - z.door.z) ? b : a));
      // people step out along their own building's face, so its footprint is exempt
      const others = D.items.filter((i) => !(BUILDINGS.has(i.kind) && ptRect(z.door, rectOf(i)) <= 1.0));
      for (const p of along([z.door, to])) {
        if (Math.hypot(p.x - z.door.x, p.z - z.door.z) < 0.35) continue;
        for (const it of others) expect(ptRect(p, rectOf(it)), `${z.id} walks through ${it.kind} at ${it.x},${it.z}`).toBeGreaterThan(0.05);
      }
    }
  });

  it('sets buildings back from roads and rail, on quarter turns, with fronts facing a street', () => {
    for (const it of D.items.filter((i) => BUILDINGS.has(i.kind) || i.kind === 'res.parking' || i.kind === 'res.playground')) {
      const r = rectOf(it), tag = `${it.kind} at ${it.x},${it.z}`;
      expect(Math.abs(Math.round((it.rot ?? 0) / (Math.PI / 2)) * (Math.PI / 2) - (it.rot ?? 0)), tag).toBeLessThan(1e-9);
      const pts = outline(r);
      expect(Math.min(...pts.map(roadDist)), tag).toBeGreaterThanOrEqual(1.5 - 1e-6);
      expect(Math.min(...pts.map(railDist)), tag).toBeGreaterThanOrEqual(1.4);
      if (it.kind === 'res.playground') continue;
      const f = frontDir(it.rot), depth = CATALOG_BY_KIND.get(it.kind)!.d;
      const mid = { x: it.x + (f.x * depth) / 2, z: it.z + (f.z * depth) / 2 };
      let faces = false;
      for (let s = 0; s <= 6.0 && !faces; s += 0.1) faces = roadDist({ x: mid.x + f.x * s, z: mid.z + f.z * s }) <= 1.25;
      expect(faces, `${tag} faces a street`).toBe(true);
    }
  });

  it('gives buildings breathing room from each other', () => {
    const b = D.items.filter((i) => BUILDINGS.has(i.kind) || i.kind === 'res.parking' || i.kind === 'res.playground');
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++)
      expect(rectGap(rectOf(b[i]!), rectOf(b[j]!)), `${b[i]!.kind}@${b[i]!.x} vs ${b[j]!.kind}@${b[j]!.x}`).toBeGreaterThanOrEqual(0.8);
  });

  it('leaves room for a 3 × 3 level crossing wherever a road crosses the rail', () => {
    const xs = railCrossings();
    expect(xs.length).toBeGreaterThanOrEqual(2);
    for (const c of xs) for (const it of D.items) {
      const box: Rect = { x0: c.x - 2, x1: c.x + 2, z0: c.z - 2, z1: c.z + 2 };
      expect(rectGap(rectOf(it), box), `${it.kind} at ${it.x},${it.z} near crossing ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBeGreaterThan(0);
    }
  });

  // The shipped rig looks down at ≈ 32.05° from +x/+z (render/camera.ts ISO_DIR); C1 studies 30°, 35.26° and 45°.
  // Every stop, platform and queue slot must stay in view from the shipped rig and the steeper study views.
  it('never hides a stop, platform or queue slot from the camera (32°, 35.26° and 45° from +x/+z)', () => {
    const hit = new THREE.Vector3();
    for (const deg of [Math.atan2(62, Math.hypot(70, 70)) * (180 / Math.PI), 35.26, 45]) {
      const el = (deg * Math.PI) / 180, dir = new THREE.Vector3(Math.cos(el) * Math.SQRT1_2, Math.sin(el), Math.cos(el) * Math.SQRT1_2);
      for (const q of QUEUES) for (let slot = -1; slot < 5; slot++) {
        const s = slot < 0 ? 0 : 0.8 + slot * 0.4;
        const ray = new THREE.Ray(new THREE.Vector3(q.p.x + q.dir.x * s, 0.6, q.p.z + q.dir.z * s), dir);
        for (const { it, box } of built()) expect(ray.intersectBox(box, hit), `${deg.toFixed(1)}°: ${q.id} slot ${slot} hidden by ${it.kind} at ${it.x},${it.z}`).toBeNull();
      }
    }
  });
});

describe('apartments district: paths and areas', () => {
  const solids = () => D.items.filter((i) => !TREES.has(i.kind) && i.kind !== 'veg.bush').map(rectOf);

  it('draws footpaths off the roads and between buildings, inside the region', () => {
    for (const p of D.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      expect(p.width).toBeGreaterThanOrEqual(0.5);
      expect(p.width).toBeLessThanOrEqual(1.4);
      for (const q of along(p.points)) {
        expect(inPoly(q, region())).toBe(true);
        expect(roadDist(q), `path at ${q.x},${q.z}`).toBeGreaterThanOrEqual(1.85);
        expect(railDist(q)).toBeGreaterThanOrEqual(1.2);
        for (const r of solids()) expect(ptRect(q, r), `path at ${q.x.toFixed(2)},${q.z.toFixed(2)}`).toBeGreaterThanOrEqual(p.width / 2 - 0.05);
      }
    }
  });

  it('lays ground areas (plazas, lawns, gardens) off the roads, rail and building footprints', () => {
    const kinds = new Set(D.areas.map((a) => a.kind));
    for (const k of ['plaza', 'lawn', 'garden'] as const) expect(kinds.has(k), k).toBe(true);
    const buildings = D.items.filter((i) => BUILDINGS.has(i.kind) || i.kind === 'res.parking' || i.kind === 'res.playground').map(rectOf);
    for (const a of D.areas) {
      expect(a.polygon.length).toBeGreaterThanOrEqual(3);
      const pts = [...a.polygon, ...fill(a.polygon)];
      expect(pts.length).toBeGreaterThan(a.polygon.length);
      for (const q of pts) {
        expect(inPoly(q, region()) || a.polygon.includes(q)).toBe(true);
        expect(roadDist(q), `${a.kind} at ${q.x},${q.z}`).toBeGreaterThanOrEqual(1.85);
        expect(railDist(q), `${a.kind} at ${q.x},${q.z}`).toBeGreaterThanOrEqual(1.0);
      }
      for (const q of fill(a.polygon)) for (const r of buildings) expect(ptRect(q, r), `${a.kind} under a building at ${q.x},${q.z}`).toBeGreaterThan(0);
    }
  });
});

describe('apartments district: builds', () => {
  it('builds every item with the basic kit, and real building boxes stay off the roads and apart', () => {
    for (const b of built()) expect(b.placeholder, b.it.kind).toBe(false);
    const bs = built().filter((b) => BUILDINGS.has(b.it.kind));
    for (const { it, box } of bs) {
      const rr: Rect = { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z };
      expect(Math.min(...outline(rr).map(roadDist)), `${it.kind} at ${it.x},${it.z}`).toBeGreaterThanOrEqual(1.3);
    }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!.box, b = bs[j]!.box;
      expect(a.min.x < b.max.x && b.min.x < a.max.x && a.min.z < b.max.z && b.min.z < a.max.z, `${bs[i]!.it.kind} touches ${bs[j]!.it.kind}`).toBe(false);
    }
  });
});
