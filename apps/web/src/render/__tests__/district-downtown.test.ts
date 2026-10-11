// D2 downtown district: a dense, legible main street that respects the transit layer.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG_BY_KIND } from '../assets/catalog';
import { createRegistry } from '../assets/index';
import type { PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { DOWNTOWN, DOWNTOWN_DROPPED } from '../districts/downtown';
import { DISTRICTS } from '../districts/index';

// ------------------------------------------------------------------------------------------------ geometry helpers

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
const rectOf = (a: PlacedAsset): Rect => {
  const f = footprintOf(a);
  return { minX: a.x - f.w / 2, maxX: a.x + f.w / 2, minZ: a.z - f.d / 2, maxZ: a.z + f.d / 2 };
};
const corners = (r: Rect): Vec2[] => [
  { x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ },
];
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
const inRect = (p: Vec2, r: Rect): boolean => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
/** Distance between a segment and an axis-aligned rectangle (0 when they touch). */
function rectSegDist(r: Rect, a: Vec2, b: Vec2): number {
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    if (inRect({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, r)) return 0;
  }
  const c = corners(r);
  let best = Math.min(...c.map((p) => segDist(p, a, b)));
  for (let i = 0; i < 4; i++) best = Math.min(best, segDist(a, c[i]!, c[(i + 1) % 4]!), segDist(b, c[i]!, c[(i + 1) % 4]!));
  return best;
}
const rectPointDist = (r: Rect, p: Vec2): number =>
  Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
function inPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const polyEdgeDist = (p: Vec2, poly: Vec2[]): number =>
  Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]!)));
function roadDist(p: Vec2): number {
  let best = Infinity;
  for (const e of TOWN.roads.edges) {
    const pts = e.path.points;
    for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i]!, pts[i + 1]!));
  }
  return best;
}

const items = DOWNTOWN.items;
const isBuilding = (a: PlacedAsset) => a.kind.startsWith('dt.');
const buildings = items.filter(isBuilding);
const count = (kind: string) => items.filter((a) => a.kind === kind).length;
const regionPoly = 'polygon' in DOWNTOWN.region ? DOWNTOWN.region.polygon : [];
const plazas = DOWNTOWN.areas.filter((a) => a.kind === 'plaza');
const downtownStop = TOWN.stops.find((s) => s.id === 'stop_downtown')!;
const downtownZones = TOWN.zones.filter((z) => z.neighborhood === 'downtown' && !z.tags.includes('station'));
/** Unit vector a placement's front faces (rot 0 → +z; three.js rotation.y). */
const frontDir = (rot = 0): Vec2 => ({ x: Math.round(Math.sin(rot) * 1e6) / 1e6, z: Math.round(Math.cos(rot) * 1e6) / 1e6 });

// ------------------------------------------------------------------------------------------------ tests

describe('D2 downtown district', () => {
  it('is the downtown entry of DISTRICTS', () => {
    expect(DOWNTOWN.id).toBe('downtown');
    expect(DISTRICTS).toContain(DOWNTOWN);
  });

  it('owns a street-bounded region around the downtown neighbourhood, its stop and its zone doors', () => {
    expect(regionPoly.length).toBeGreaterThanOrEqual(4);
    const hood = TOWN.neighborhoods.find((n) => n.id === 'downtown')!;
    expect(inPoly(hood.center, regionPoly)).toBe(true);
    expect(inPoly(downtownStop.p, regionPoly)).toBe(true);
    for (const z of downtownZones) expect(inPoly(z.door, regionPoly), z.id).toBe(true);
    // Stays inside the ring road and east of Atherton St: never claims the campus, the stations or the outskirts.
    for (const p of regionPoly) {
      expect(p.x).toBeGreaterThanOrEqual(-2);
      expect(p.x).toBeLessThanOrEqual(22.6);
      expect(p.z).toBeGreaterThanOrEqual(-14.6);
      expect(p.z).toBeLessThanOrEqual(14.6);
    }
  });

  it('places only catalog kinds that the registry implements', () => {
    const registry = createRegistry();
    for (const a of items) {
      expect(CATALOG_BY_KIND.has(a.kind), a.kind).toBe(true);
      expect(registry.get(a.kind), a.kind).toBeDefined();
    }
  });

  it('authors a layout its own clearance pass leaves intact (nothing dropped)', () => {
    expect(DOWNTOWN_DROPPED.map((a) => `${a.kind} @${a.x},${a.z}`)).toEqual([]);
  });

  it('passes validatePlacements: on the board, off roads and rails, no overlaps', () => {
    expect(validatePlacements(TOWN, items)).toEqual([]);
  });

  it('keeps every footprint inside its region', () => {
    for (const a of items) for (const c of corners(rectOf(a))) expect(inPoly(c, regionPoly), `${a.kind} @${a.x},${a.z}`).toBe(true);
  });

  it('keeps 2 u clear around every stop, platform and queue line', () => {
    const places = [
      ...TOWN.stops.map((s) => ({ id: s.id, p: s.p, dir: s.queueDir })),
      ...TOWN.rail.stations.map((s) => ({ id: s.id, p: s.platform, dir: s.queueDir })),
    ];
    for (const pl of places) {
      const end = { x: pl.p.x + pl.dir.x * 2.4, z: pl.p.z + pl.dir.z * 2.4 };
      for (const a of items) expect(rectSegDist(rectOf(a), pl.p, end), `${a.kind} @${a.x},${a.z} near ${pl.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('dresses a dense main street: storefront rows, corner building, theater, cafés, a fountain plaza and street life', () => {
    expect(buildings.length).toBeGreaterThanOrEqual(8);
    expect(count('dt.corner')).toBeGreaterThanOrEqual(1);
    expect(count('dt.shopRow')).toBeGreaterThanOrEqual(1);
    expect(count('dt.theater')).toBe(1);
    expect(count('dt.midrise')).toBeGreaterThanOrEqual(1);
    expect(count('dt.cafe')).toBeGreaterThanOrEqual(2);
    expect(count('st.fountain')).toBe(1);
    expect(count('st.lamp')).toBeGreaterThanOrEqual(14);
    expect(count('veg.planter')).toBeGreaterThanOrEqual(5);
    expect(count('st.bikeRack')).toBeGreaterThanOrEqual(2);
    expect(count('st.tableUmbrella')).toBeGreaterThanOrEqual(3);
    expect(count('st.bench')).toBeGreaterThanOrEqual(4);
    const trees = items.filter((a) => /^veg\.(oak|maple|birch|poplar|cherry|pine)$/.test(a.kind));
    expect(trees.length).toBeGreaterThanOrEqual(6);
    for (const b of buildings) expect(Math.abs(((b.rot ?? 0) / (Math.PI / 2)) % 1), b.kind).toBeLessThan(1e-9);
  });

  it('lines the north side of Main St with an unbroken street wall from Atherton St to Allen St', () => {
    const front = buildings.filter((b) => { const r = rectOf(b); return r.maxZ > -3 && r.maxZ < -1.5 && r.maxX > -2 && r.minX < 12; });
    const spans = front.map((b) => { const r = rectOf(b); return [Math.max(r.minX, -0.5), Math.min(r.maxX, 10.5)] as const; }).sort((a, b) => a[0] - b[0]);
    let covered = 0, reach = -0.5;
    for (const [a, b] of spans) { if (b > reach) { covered += b - Math.max(a, reach); reach = b; } }
    expect(covered / 11).toBeGreaterThan(0.95);
  });

  it('puts the fountain on a plaza with seating around it', () => {
    const f = items.find((a) => a.kind === 'st.fountain')!;
    expect(plazas.some((a) => inPoly(f, a.polygon))).toBe(true);
    const seats = items.filter((a) => a.kind === 'st.bench' && Math.hypot(a.x - f.x, a.z - f.z) < 3);
    expect(seats.length).toBeGreaterThanOrEqual(2);
  });

  it('turns every building front to a street or a plaza', () => {
    for (const b of buildings) {
      const d = frontDir(b.rot), depth = CATALOG_BY_KIND.get(b.kind)!.d;
      const p = { x: b.x + d.x * depth / 2, z: b.z + d.z * depth / 2 };
      const onPlaza = plazas.some((a) => inPoly(p, a.polygon) || polyEdgeDist(p, a.polygon) < 0.6);
      expect(roadDist(p) < 2.8 || onPlaza, `${b.kind} @${b.x},${b.z}`).toBe(true);
    }
  });

  it('keeps the camera side of the Downtown stop low (nothing taller than a café south-east of the queue)', () => {
    const s = downtownStop.p;
    for (const a of items) {
      const r = rectOf(a);
      if (r.maxX > s.x && r.minX < s.x + 9 && r.maxZ > s.z && r.minZ < s.z + 6) {
        expect(CATALOG_BY_KIND.get(a.kind)!.h, `${a.kind} @${a.x},${a.z}`).toBeLessThanOrEqual(2.6);
      }
    }
  });

  it('gives every downtown zone door a building front or a plaza', () => {
    for (const z of downtownZones) {
      const nearBuilding = buildings.some((b) => rectPointDist(rectOf(b), z.door) < 1.0);
      const onPlaza = plazas.some((a) => inPoly(z.door, a.polygon));
      expect(nearBuilding || onPlaza, z.id).toBe(true);
    }
  });

  it('draws well-formed areas and paths that stay off the carriageway', () => {
    expect(plazas.length).toBeGreaterThanOrEqual(2);
    for (const a of DOWNTOWN.areas) {
      expect(a.polygon.length).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < a.polygon.length; i++) {
        const p = a.polygon[i]!, q = a.polygon[(i + 1) % a.polygon.length]!;
        for (let t = 0; t <= 1; t += 0.1) {
          const s = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
          expect(roadDist(s), `${a.kind} edge @${s.x.toFixed(2)},${s.z.toFixed(2)}`).toBeGreaterThanOrEqual(1.15);
          expect(inPoly(s, regionPoly) || polyEdgeDist(s, regionPoly) < 1e-6).toBe(true);
        }
      }
    }
    for (const p of DOWNTOWN.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      expect(p.width).toBeGreaterThan(0);
      expect(p.width).toBeLessThanOrEqual(2);
      for (const q of p.points) expect(inPoly(q, regionPoly)).toBe(true);
    }
  });

  it('builds with the shared kit: no placeholders, a sane triangle total', () => {
    const registry = createRegistry();
    const kit = createBasicKit(registry.roles);
    let tris = 0;
    for (const a of items) {
      const o = registry.build(kit, a);
      expect(o.userData.placeholder, a.kind).not.toBe(true);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
      });
    }
    expect(tris).toBeLessThan(160_000);
  });
});
