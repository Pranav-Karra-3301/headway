// A3 residential: every res.* kind registers, builds with the basic kit, fits its catalog box, stays in budget,
// faces +z, uses resolvable palette roles, marks details, and varies per placement.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG } from '../assets/catalog';
import { ROLES, register } from '../assets/families/residential';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';
import { PALETTES } from '../palettes';

const KINDS = CATALOG.filter((c) => c.family === 'residential');
const BUDGET = 3000;
const GREY = '9aa0a6'; // basicKit fallback colour for unknown roles

function setup(seed = 1): { r: AssetRegistry; k: KitContext; roles: Set<string> } {
  const r = new AssetRegistry();
  register(r);
  const base = createBasicKit(r.roles, 0, seed);
  const roles = new Set<string>();
  const k: KitContext = { ...base, mat: (role, idx) => { roles.add(role); return base.mat(role, idx); } };
  return { r, k, roles };
}
function build(kind: string, seed = 1, params: AssetParams = {}) {
  const { r, k, roles } = setup(seed);
  const obj = r.get(kind)!.build(k, params);
  obj.updateMatrixWorld(true);
  return { obj, roles, k };
}
const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true);
function meshes(o: THREE.Object3D, skipDetail = false): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (n: THREE.Object3D) => {
    if (skipDetail && n.userData.detail) return;
    if ((n as THREE.Mesh).isMesh) out.push(n as THREE.Mesh);
    n.children.forEach(walk);
  };
  walk(o);
  return out;
}
const tris = (o: THREE.Object3D) => meshes(o).reduce((n, m) => {
  const g = m.geometry;
  return n + (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}, 0);
const PARAMS: Record<string, AssetParams[]> = {
  'res.tower': [{}, { floors: 5 }, { floors: 6 }, { floors: 7 }],
  'res.parking': [{}, { cars: 0 }, { cars: 5 }],
};
const variants = (kind: string) => PARAMS[kind] ?? [{}];
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34];

describe('residential family (A3)', () => {
  it('registers exactly the catalog res.* kinds with catalog footprints', () => {
    const { r } = setup();
    expect(KINDS.length).toBeGreaterThanOrEqual(6);
    expect(r.kinds()).toEqual(KINDS.map((c) => c.kind).sort());
    for (const c of KINDS) {
      const d = r.get(c.kind)!;
      expect(d.family).toBe('residential');
      expect(d.footprint).toEqual({ w: c.w, d: c.d });
      expect(d.height).toBe(c.h);
    }
  });

  it('declares only res-prefixed extra roles with a colour per palette', () => {
    for (const [role, cols] of Object.entries(ROLES)) {
      expect(role.startsWith('res')).toBe(true);
      expect(cols.length).toBe(3);
    }
  });

  for (const c of KINDS) {
    describe(c.kind, () => {
      it('builds for many placements without throwing, inside its footprint (±10%) and height (±25%)', () => {
        for (const params of variants(c.kind)) for (const seed of SEEDS) {
          const b = boxOf(build(c.kind, seed, params).obj);
          const tag = `${c.kind} seed ${seed} ${JSON.stringify(params)}`;
          expect(b.min.y, tag).toBeGreaterThanOrEqual(-0.01);
          expect(b.min.x, tag).toBeGreaterThanOrEqual(-0.55 * c.w);
          expect(b.max.x, tag).toBeLessThanOrEqual(0.55 * c.w);
          expect(b.min.z, tag).toBeGreaterThanOrEqual(-0.55 * c.d);
          expect(b.max.z, tag).toBeLessThanOrEqual(0.55 * c.d);
          expect(b.max.x - b.min.x, tag).toBeGreaterThanOrEqual(0.9 * c.w);
          expect(b.max.z - b.min.z, tag).toBeGreaterThanOrEqual(0.9 * c.d);
          expect(b.max.y, tag).toBeGreaterThanOrEqual(0.75 * c.h);
          expect(b.max.y, tag).toBeLessThanOrEqual(1.25 * c.h);
        }
      });

      it(`stays within ${BUDGET} triangles`, () => {
        for (const params of variants(c.kind)) for (const seed of SEEDS) {
          expect(tris(build(c.kind, seed, params).obj), `${c.kind} seed ${seed}`).toBeLessThanOrEqual(BUDGET);
        }
      });

      it('uses only roles the basic kit and the town palette can resolve', () => {
        for (const seed of SEEDS) {
          const { obj, roles } = build(c.kind, seed);
          for (const m of meshes(obj)) {
            const mat = m.material as THREE.MeshStandardMaterial;
            expect(mat.color.getHexString(), `${c.kind} ${m.name}`).not.toBe(GREY);
          }
          for (const role of roles) expect(role in PALETTES.a || role in ROLES, `role ${role}`).toBe(true);
        }
      });

      it('marks small parts as detail and keeps a solid silhouette without them', () => {
        const { obj } = build(c.kind, 3);
        let details = 0;
        obj.traverse((o) => { if (o.userData.detail) details++; });
        expect(details).toBeGreaterThan(0);
        const core = meshes(obj, true);
        expect(core.length).toBeGreaterThan(0);
        const b = new THREE.Box3();
        for (const m of core) b.union(new THREE.Box3().setFromObject(m, true));
        expect(b.max.y).toBeGreaterThanOrEqual(c.h <= 1.2 ? 0.02 : 0.6 * c.h);
      });

      it('is deterministic for the same placement seed', () => {
        const a = build(c.kind, 7).obj, b = build(c.kind, 7).obj;
        expect(tris(a)).toBe(tris(b));
        expect(boxOf(a).equals(boxOf(b))).toBe(true);
      });
    });
  }

  for (const kind of ['res.tower', 'res.garden', 'res.townhouses', 'res.house']) {
    it(`${kind} has door(s) about 1 u tall on the +z front`, () => {
      for (const seed of SEEDS.slice(0, 4)) {
        const doors: THREE.Object3D[] = [];
        build(kind, seed).obj.traverse((o) => { if (o.name === 'door') doors.push(o); });
        expect(doors.length, kind).toBeGreaterThan(0);
        const c = CATALOG.find((e) => e.kind === kind)!;
        for (const d of doors) {
          const b = boxOf(d);
          expect(b.max.y - b.min.y).toBeGreaterThan(0.8);
          expect(b.max.y - b.min.y).toBeLessThan(1.25);
          expect((b.min.z + b.max.z) / 2).toBeGreaterThan(c.d * 0.1);
        }
      }
    });
  }

  it('varies looks per placement (colours / shapes differ across seeds)', () => {
    for (const kind of ['res.tower', 'res.garden', 'res.townhouses', 'res.house', 'res.parking']) {
      const sigs = new Set<string>();
      for (const seed of SEEDS) {
        const { obj } = build(kind, seed);
        const cols = meshes(obj).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString());
        sigs.add([...new Set(cols)].sort().join(',') + '|' + tris(obj));
      }
      expect(sigs.size, kind).toBeGreaterThanOrEqual(3);
    }
  });

  it('tower floors param sets the height; parking cars param sets the car count', () => {
    const h = (f: number) => boxOf(build('res.tower', 4, { floors: f }).obj).max.y;
    expect(h(5)).toBeLessThan(h(6));
    expect(h(6)).toBeLessThan(h(7));
    const cars = (n: number) => {
      let c = 0;
      build('res.parking', 4, { cars: n }).obj.traverse((o) => { if (o.name === 'car') c++; });
      return c;
    };
    expect(cars(0)).toBe(0);
    expect(cars(3)).toBe(3);
    expect(cars(5)).toBe(5);
  });
});
