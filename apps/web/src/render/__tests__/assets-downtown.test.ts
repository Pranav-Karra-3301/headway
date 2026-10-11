// A1 downtown asset family: every dt.* kind registered, builds cleanly, fits its catalog box, stays in budget.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG, CATALOG_BY_KIND } from '../assets/catalog';
import * as downtown from '../assets/families/downtown';
import { AssetRegistry } from '../assets/registry';
import { PALETTES } from '../palettes';

const KINDS = CATALOG.filter((c) => c.family === 'downtown').map((c) => c.kind);
const TRI_BUDGET = 3000;
const FALLBACK_GREY = '9aa0a6';

function registry(): AssetRegistry {
  const r = new AssetRegistry();
  downtown.register(r);
  return r;
}

function isDetail(o: THREE.Object3D): boolean {
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (c.userData.detail) return true;
  return false;
}

function measure(o: THREE.Object3D, coreOnly = false) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let tris = 0;
  const meshes: THREE.Mesh[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    if (coreOnly && isDetail(m)) return;
    meshes.push(m);
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
    box.expandByObject(m, true);
  });
  const size = box.getSize(new THREE.Vector3());
  return { box, size, tris, meshes };
}

function build(kind: string, params = {}, seed = 1, palette: 0 | 1 | 2 = 0): THREE.Object3D {
  const def = registry().get(kind)!;
  return def.build(createBasicKit(downtown.ROLES, palette, seed), params);
}

describe('downtown family registration', () => {
  it('the catalog has the eight downtown kinds', () => {
    expect(KINDS.sort()).toEqual(['dt.bank', 'dt.cafe', 'dt.corner', 'dt.garage', 'dt.midrise', 'dt.shop', 'dt.shopRow', 'dt.theater']);
  });

  it('registers every dt.* kind with the catalog footprint and height', () => {
    const r = registry();
    for (const kind of KINDS) {
      const def = r.get(kind);
      expect(def, kind).toBeDefined();
      const c = CATALOG_BY_KIND.get(kind)!;
      expect(def!.family).toBe('downtown');
      expect(def!.footprint).toEqual({ w: c.w, d: c.d });
      expect(def!.height).toBe(c.h);
    }
    expect(r.kinds().every((k) => k.startsWith('dt.'))).toBe(true);
  });

  it('adds its palette roles (3 palettes each, valid hex) under a dt prefix that never shadows a base role', () => {
    const r = registry();
    const roles = Object.keys(downtown.ROLES);
    expect(roles.length).toBeGreaterThan(5);
    for (const role of roles) {
      expect(role.startsWith('dt')).toBe(true);
      expect(role in PALETTES.a).toBe(false);
      expect(r.roles[role]).toBeDefined();
      const v = downtown.ROLES[role]!;
      expect(v).toHaveLength(3);
      for (const p of v) for (const hex of Array.isArray(p) ? p : [p]) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe.each(KINDS)('%s', (kind) => {
  const c = CATALOG_BY_KIND.get(kind)!;

  it('builds with the basic kit, sits on the ground and fits its catalog footprint (±10%) and height (±25%)', () => {
    const { box, size } = measure(build(kind));
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(size.x).toBeLessThanOrEqual(c.w * 1.1);
    expect(size.z).toBeLessThanOrEqual(c.d * 1.1);
    expect(size.x).toBeGreaterThanOrEqual(c.w * 0.85);
    expect(size.z).toBeGreaterThanOrEqual(c.d * 0.85);
    // Centred on the placement point: stays inside the footprint rectangle (+10%).
    expect(Math.max(-box.min.x, box.max.x)).toBeLessThanOrEqual((c.w / 2) * 1.1);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual((c.d / 2) * 1.1);
    expect(box.max.y).toBeGreaterThanOrEqual(c.h * 0.75);
    expect(box.max.y).toBeLessThanOrEqual(c.h * 1.25);
  });

  it(`stays within ${TRI_BUDGET} triangles`, () => {
    expect(measure(build(kind)).tris).toBeLessThanOrEqual(TRI_BUDGET);
  });

  it('every variant (params.variant and per-placement seeds) stays in bounds and budget', () => {
    const builds = [
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((v) => build(kind, { variant: v })),
      ...[2, 3, 5, 8, 13, 21].map((s) => build(kind, {}, s)),
    ];
    for (const o of builds) {
      const { box, size, tris } = measure(o);
      expect(tris).toBeLessThanOrEqual(TRI_BUDGET);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.02);
      expect(Math.max(-box.min.x, box.max.x)).toBeLessThanOrEqual((c.w / 2) * 1.1);
      expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual((c.d / 2) * 1.1);
      expect(size.x).toBeGreaterThanOrEqual(c.w * 0.85);
      expect(size.z).toBeGreaterThanOrEqual(c.d * 0.85);
      expect(box.max.y).toBeGreaterThanOrEqual(c.h * 0.75);
      expect(box.max.y).toBeLessThanOrEqual(c.h * 1.25);
    }
  });

  it('variants actually differ, and the same variant is deterministic', () => {
    const sig = (o: THREE.Object3D) => {
      const m = measure(o);
      const colours = new Set(m.meshes.map((x) => (x.material as THREE.MeshStandardMaterial).color.getHexString()));
      return `${m.tris}|${m.size.toArray().map((n) => n.toFixed(3))}|${[...colours].sort().join(',')}`;
    };
    expect(sig(build(kind, { variant: 3 }))).toBe(sig(build(kind, { variant: 3 })));
    const distinct = new Set([0, 1, 2, 3, 4, 5].map((v) => sig(build(kind, { variant: v }))));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('uses only declared roles (family ROLES or base roles both kits know), so previews match the composer', () => {
    const kit = createBasicKit(downtown.ROLES);
    const { meshes } = measure(build(kind));
    expect(meshes.length).toBeGreaterThan(10);
    for (const m of meshes) {
      const part = m.userData.part as { role: string; idx: number } | undefined;
      expect(part, `untagged mesh in ${kind}`).toBeDefined();
      const ok = part!.role in downtown.ROLES
        || (part!.role in PALETTES.a && (kit.mat(part!.role) as THREE.MeshStandardMaterial).color.getHexString() !== FALLBACK_GREY);
      expect(ok, `${kind} uses undeclared role ${part!.role}`).toBe(true);
      expect(m.castShadow).toBe(true);
    }
  });

  it('marks small parts as detail, and the core massing alone still reads as the building', () => {
    const o = build(kind);
    const all = measure(o), core = measure(o, true);
    expect(core.meshes.length).toBeLessThan(all.meshes.length);
    expect(core.meshes.length).toBeGreaterThan(0);
    expect(core.box.max.y).toBeGreaterThanOrEqual(c.h * 0.6);
  });

  it('faces +z: an entrance sits on the front half', () => {
    const o = build(kind);
    o.updateMatrixWorld(true);
    const fronts: number[] = [];
    o.traverse((m) => {
      if (!m.userData.entrance) return;
      const p = new THREE.Box3().setFromObject(m, true).getCenter(new THREE.Vector3());
      fronts.push(p.z);
    });
    expect(fronts.length).toBeGreaterThan(0);
    expect(Math.max(...fronts)).toBeGreaterThan(c.d * 0.15);
  });

  it('builds in palettes b and c', () => {
    expect(() => build(kind, {}, 1, 1)).not.toThrow();
    expect(() => build(kind, {}, 1, 2)).not.toThrow();
  });
});
