// Owner: D1. Campus district: placement validity, gameplay clearances (stops, queues, sight lines), composition.
import type { Vec2 } from '@headway/sim';
import { TOWN } from '@headway/sim';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG_BY_KIND } from '../assets/catalog';
import { createRegistry } from '../assets/index';
import type { PlacedAsset } from '../assets/types';
import { footprintOf, validatePlacements } from '../assets/validate';
import { CAMPUS } from '../districts/campus';
import { DISTRICTS } from '../districts/index';
import { SCENERY } from '../scenery';

const items = CAMPUS.items;
const TREES = new Set(['veg.oak', 'veg.maple', 'veg.pine', 'veg.birch', 'veg.poplar', 'veg.cherry']);
const isBuilding = (a: PlacedAsset) => a.kind.startsWith('cp.') || a.kind.startsWith('lm.');
const count = (pred: (a: PlacedAsset) => boolean) => items.filter(pred).length;
/** Queue slots the renderer lays out along queueDir: 0.9 + i·0.45 (keep the first QUEUE_SLOTS clear). */
const QUEUE_SLOTS = 9;
const QUEUE_LEN = 0.9 + (QUEUE_SLOTS - 1) * 0.45;

interface Box { x0: number; x1: number; z0: number; z1: number }
function boxOf(a: PlacedAsset, shrink = 0): Box {
  const f = footprintOf(a);
  return { x0: a.x - f.w / 2 + shrink, x1: a.x + f.w / 2 - shrink, z0: a.z - f.d / 2 + shrink, z1: a.z + f.d / 2 - shrink };
}
const inBox = (p: Vec2, b: Box) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
/** Distance from a segment to an axis-aligned box (0 if they touch). */
function segBoxDist(a: Vec2, b: Vec2, bx: Box): number {
  if (inBox(a, bx) || inBox(b, bx)) return 0;
  const corners: Vec2[] = [{ x: bx.x0, z: bx.z0 }, { x: bx.x1, z: bx.z0 }, { x: bx.x1, z: bx.z1 }, { x: bx.x0, z: bx.z1 }];
  let best = Infinity;
  for (let i = 0; i < 4; i++) best = Math.min(best, segDist(corners[i]!, a, b), segSegDist(a, b, corners[i]!, corners[(i + 1) % 4]!));
  return best;
}
function segSegDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Built scene of every campus item (basic kit), for raycast sight-line checks against real geometry. */
function builtItems(): Array<{ it: PlacedAsset; obj: THREE.Object3D }> {
  const r = createRegistry();
  const k = createBasicKit(r.roles);
  return items.map((it) => { const obj = r.build(k, it); obj.updateMatrixWorld(true); return { it, obj }; });
}
/** Items hiding a person standing at q from an iso camera at azimuth 45° (looking from +x/+z): all three rays
 *  (person centre and ±0.2 u sideways, at 0.45 u up) blocked by the same item. Thin posts cannot hide a person. */
function hiders(built: ReturnType<typeof builtItems>, q: Vec2, elevDeg: number): PlacedAsset[] {
  const dir = new THREE.Vector3(1, Math.SQRT2 * Math.tan((elevDeg * Math.PI) / 180), 1).normalize();
  const side = new THREE.Vector3(1, 0, -1).normalize().multiplyScalar(0.2);
  const rc = new THREE.Raycaster();
  const out: PlacedAsset[] = [];
  for (const { it, obj } of built) {
    let blocked = 0;
    for (const s of [-1, 0, 1]) {
      rc.set(new THREE.Vector3(q.x + side.x * s, 0.45, q.z + side.z * s), dir);
      if (rc.intersectObject(obj, true).length > 0) blocked++;
    }
    if (blocked === 3) out.push(it);
  }
  return out;
}
const queuePoints = (p: Vec2, dir: Vec2): Vec2[] =>
  [p, ...Array.from({ length: QUEUE_SLOTS }, (_, i) => ({ x: p.x + dir.x * (0.9 + i * 0.45), z: p.z + dir.z * (0.9 + i * 0.45) }))];

describe('campus district', () => {
  it('is the campus entry of DISTRICTS', () => {
    expect(CAMPUS.id).toBe('campus');
    expect(DISTRICTS).toContain(CAMPUS);
  });

  it('has a region consistent with the TOWN campus neighbourhood', () => {
    const n = TOWN.neighborhoods.find((h) => h.id === 'campus')!;
    expect('center' in CAMPUS.region).toBe(true);
    if (!('center' in CAMPUS.region)) return;
    const { center, radius } = CAMPUS.region;
    expect(Math.hypot(center.x - n.center.x, center.z - n.center.z)).toBeLessThan(1);
    expect(radius).toBeGreaterThanOrEqual(n.radius);
    expect(radius).toBeLessThanOrEqual(n.radius + 1);
    const inside = (p: Vec2) => Math.hypot(p.x - center.x, p.z - center.z) < radius;
    // every campus zone door except the station square (it sits by the railway) and the Old Main stop are inside
    for (const z of TOWN.zones.filter((z) => z.neighborhood === 'campus' && !z.tags.includes('station'))) expect(inside(z.door), z.id).toBe(true);
    expect(inside(TOWN.stops.find((s) => s.id === 'stop_old_main')!.p)).toBe(true);
    // the composer drops base SCENERY inside the region: only the campus's own base items may be there
    for (const s of SCENERY.filter((s) => inside(s))) {
      expect(s.kind === 'station' || s.kind === 'stadium', s.kind).toBe(false);
      expect(s.x < -2 && s.z < 0 && s.z > -14.6, `${s.kind} ${s.x},${s.z}`).toBe(true);
    }
  });

  it('places every item validly on the board (validatePlacements)', () => {
    expect(validatePlacements(TOWN, items)).toEqual([]);
  });

  it('keeps every item inside the two campus blocks (West Rd–Atherton St, North Rd–Main St)', () => {
    for (const a of items) {
      const b = boxOf(a);
      expect(b.x0 >= -26 && b.x1 <= -2 && b.z0 >= -14.6 && b.z1 <= 0, `${a.kind} @ ${a.x},${a.z}`).toBe(true);
    }
  });

  it('uses only implemented catalog kinds, and every item builds', () => {
    const r = createRegistry();
    const k = createBasicKit(r.roles);
    for (const a of items) {
      expect(CATALOG_BY_KIND.has(a.kind), a.kind).toBe(true);
      expect(r.get(a.kind), a.kind).toBeDefined();
    }
    for (const kind of new Set(items.map((a) => a.kind))) {
      const sample = items.find((a) => a.kind === kind)!;
      expect(() => r.build(k, sample)).not.toThrow();
    }
  });

  it('turns buildings by quarter turns only', () => {
    for (const a of items.filter(isBuilding)) {
      const q = (a.rot ?? 0) / (Math.PI / 2);
      expect(Math.abs(q - Math.round(q)), a.kind).toBeLessThan(1e-9);
    }
  });

  it('keeps 2 u clear around stops, platforms and their queue lines', () => {
    const places = [
      ...TOWN.stops.map((s) => ({ id: s.id, p: s.p, dir: s.queueDir })),
      ...TOWN.rail.stations.map((s) => ({ id: s.id, p: s.platform, dir: s.queueDir })),
    ];
    const bad: string[] = [];
    for (const pl of places) {
      const end = { x: pl.p.x + pl.dir.x * QUEUE_LEN, z: pl.p.z + pl.dir.z * QUEUE_LEN };
      for (const a of items) {
        const d = segBoxDist(pl.p, end, boxOf(a));
        if (d < 2) bad.push(`${a.kind} @ ${a.x.toFixed(2)},${a.z.toFixed(2)} is ${d.toFixed(2)} u from ${pl.id}'s queue`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never hides a campus stop, platform or their queues from the iso camera (az 45°, elevation 30–36°)', () => {
    const built = builtItems();
    const places = [
      ...TOWN.stops.filter((s) => s.neighborhood === 'campus').map((s) => ({ id: s.id, p: s.p, dir: s.queueDir })),
      ...TOWN.rail.stations.filter((s) => s.id === 'stn_university').map((s) => ({ id: s.id, p: s.platform, dir: s.queueDir })),
    ];
    expect(places.length).toBe(3);
    const bad = new Set<string>();
    for (const pl of places) {
      for (const q of queuePoints(pl.p, pl.dir)) {
        for (const elev of [30, 35.26]) {
          for (const a of hiders(built, q, elev)) bad.add(`${a.kind} @ ${a.x.toFixed(2)},${a.z.toFixed(2)} hides ${pl.id}`);
        }
      }
    }
    expect([...bad]).toEqual([]);
  });

  it('plants no tree crown where it hides a bus route from the iso camera (camera-side planting stays low)', () => {
    const built = builtItems().filter(({ it }) => TREES.has(it.kind));
    const bad = new Set<string>();
    for (const r of TOWN.routes) {
      const pts = r.path.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!, L = Math.hypot(b.x - a.x, b.z - a.z);
        for (let s = 0; s < L; s += 0.5) {
          const q = { x: a.x + ((b.x - a.x) * s) / L, z: a.z + ((b.z - a.z) * s) / L };
          if (q.x > 2 || q.z > 3 || q.z < -18) continue; // only the streets around the campus
          for (const elev of [30, 35.26]) for (const t of hiders(built, q, elev)) bad.add(`${t.kind} @ ${t.x.toFixed(2)},${t.z.toFixed(2)} hides ${r.id}`);
        }
      }
    }
    expect([...bad]).toEqual([]);
  });

  it('keeps zone doors outside buildings, each next to one', () => {
    const buildings = items.filter(isBuilding);
    const inside = TOWN.zones.flatMap((z) => buildings.filter((b) => inBox(z.door, boxOf(b, 0.05))).map((b) => `${z.id} inside ${b.kind}`));
    expect(inside).toEqual([]);
    for (const z of TOWN.zones.filter((z) => z.neighborhood === 'campus' && !z.tags.includes('station'))) {
      const near = Math.min(...buildings.map((b) => segBoxDist(z.door, z.door, boxOf(b))));
      expect(near, z.id).toBeLessThan(1.5);
    }
  });

  // The two blocks are saturated at the kit's footprints (a grid search finds no free 0.6 u spot clear of buildings,
  // paths and the 2 u queue clearance), so the programme counts track what fits with breathing room.
  it('has the campus programme: clock tower focal point, halls/library/chapel/dorm, many trees, furniture, flags', () => {
    expect(items.length).toBeGreaterThanOrEqual(36);
    const tower = items.filter((a) => a.kind === 'lm.clockTower');
    expect(tower).toHaveLength(1);
    const tallest = Math.max(...items.map((a) => CATALOG_BY_KIND.get(a.kind)!.h * (a.scale ?? 1)));
    expect(CATALOG_BY_KIND.get('lm.clockTower')!.h).toBe(tallest);
    for (const kind of ['cp.hall', 'cp.library', 'cp.chapel', 'cp.dorm', 'cp.gate']) expect(count((a) => a.kind === kind), kind).toBeGreaterThanOrEqual(1);
    expect(count((a) => TREES.has(a.kind))).toBeGreaterThanOrEqual(10);
    expect(count((a) => a.kind.startsWith('veg.'))).toBeGreaterThanOrEqual(15);
    expect(new Set(items.filter((a) => TREES.has(a.kind)).map((a) => a.kind)).size).toBeGreaterThanOrEqual(4);
    expect(count((a) => a.kind === 'st.bench')).toBeGreaterThanOrEqual(6);
    expect(count((a) => a.kind === 'st.lamp')).toBeGreaterThanOrEqual(7);
    expect(count((a) => a.kind === 'st.flag')).toBeGreaterThanOrEqual(2);
  });

  it('lays a lawn quad with criss-cross footpaths', () => {
    const lawns = CAMPUS.areas.filter((a) => a.kind === 'lawn');
    expect(lawns.length).toBeGreaterThanOrEqual(1);
    expect(CAMPUS.paths.length).toBeGreaterThanOrEqual(4);
    const segs = CAMPUS.paths.flatMap((p) => p.points.slice(1).map((b, i) => [p.points[i]!, b] as const));
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segmentsCross(segs[i]![0], segs[i]![1], segs[j]![0], segs[j]![1])) crossings++;
    expect(crossings).toBeGreaterThanOrEqual(2);
    for (const p of CAMPUS.paths) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
      expect(p.width).toBeGreaterThan(0.5);
      expect(p.width).toBeLessThanOrEqual(2.4);
    }
  });

  it('keeps footpaths clear: no building, tree or bed on a path (gates straddle theirs), furniture beside not on', () => {
    const bad: string[] = [];
    const at = (it: PlacedAsset) => `${it.kind} @ ${it.x.toFixed(2)},${it.z.toFixed(2)}`;
    for (const p of CAMPUS.paths) {
      for (let i = 0; i + 1 < p.points.length; i++) {
        const a = p.points[i]!, b = p.points[i + 1]!;
        for (const it of items) {
          if (it.kind === 'cp.gate') continue;
          const small = Math.max(footprintOf(it).w, footprintOf(it).d) <= 1.3 && !TREES.has(it.kind);
          if (small) { if (segDist(it, a, b) <= p.width / 2 + 0.1) bad.push(`${at(it)} on a path`); }
          else if (isBuilding(it)) { if (segBoxDist(a, b, boxOf(it, 0.3)) <= 0) bad.push(`path runs through ${at(it)}`); }
          else if (segBoxDist(a, b, boxOf(it, 0.25)) <= p.width / 2 - 0.25) bad.push(`${at(it)} on a path`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
