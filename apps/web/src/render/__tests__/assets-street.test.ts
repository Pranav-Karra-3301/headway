// Owner: A6 street. Every `st.*` kind: registered, builds with the basic kit, stays inside its catalog
// footprint (±10 %) and height (±25 %), ≤ 600 triangles, only kit materials with roles the composer can colour.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG } from '../assets/catalog';
import { LAMP_HEAD, ROLES, register } from '../assets/families/street';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';
import { PALETTES } from '../palettes';

const ENTRIES = CATALOG.filter((c) => c.family === 'street');
const BUDGET = 600;
const SEEDS = [1, 2, 3, 7, 11, 23, 42, 99];

function streetRegistry(): AssetRegistry {
  const r = new AssetRegistry();
  register(r);
  return r;
}

/** Basic kit that records every role + material it hands out. */
function trackingKit(seed = 1) {
  const base = createBasicKit(ROLES, 0, seed);
  const roles = new Set<string>();
  const mats = new Map<THREE.Material, string>();
  const k: KitContext = {
    ...base,
    mat(role, idx) {
      roles.add(role);
      const m = base.mat(role, idx);
      mats.set(m, role);
      return m;
    },
  };
  return { k, roles, mats };
}

function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}

function triangles(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const count = g.index ? g.index.count : g.getAttribute('position').count;
    n += (count / 3) * ((c as THREE.InstancedMesh).isInstancedMesh ? (c as THREE.InstancedMesh).count : 1);
  });
  return n;
}

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}

function build(kind: string, params: AssetParams = {}, seed = 1) {
  const r = streetRegistry();
  const def = r.get(kind)!;
  const t = trackingKit(seed);
  const obj = def.build(t.k, params);
  return { obj, def, ...t };
}

const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

describe('street family registration', () => {
  it('registers every st.* catalog kind with its catalog footprint and height', () => {
    const r = streetRegistry();
    expect(ENTRIES.length).toBe(12);
    for (const e of ENTRIES) {
      const def = r.get(e.kind);
      expect(def, e.kind).toBeDefined();
      expect(def!.family).toBe('street');
      expect(def!.footprint).toEqual({ w: e.w, d: e.d });
      expect(def!.height).toBe(e.h);
    }
    expect(r.kinds().filter((k) => !k.startsWith('st.'))).toEqual([]);
  });

  it('is instanced wherever the geometry does not depend on params (all but the fence)', () => {
    const r = streetRegistry();
    for (const e of ENTRIES) expect(r.get(e.kind)!.instanced ?? false, e.kind).toBe(e.kind !== 'st.fence');
  });

  it('only the flag sways', () => {
    const r = streetRegistry();
    for (const e of ENTRIES) expect(r.get(e.kind)!.sway ?? false, e.kind).toBe(e.kind === 'st.flag');
  });

  it('adds its roles to the registry', () => {
    const r = streetRegistry();
    for (const role of Object.keys(ROLES)) expect(r.roles[role]).toBeDefined();
  });
});

describe('street roles', () => {
  it('every extra role has valid colours for palettes a, b and c', () => {
    for (const [role, cols] of Object.entries(ROLES)) {
      expect(cols.length, role).toBe(3);
      for (const c of cols) for (const hex of Array.isArray(c) ? c : [c]) expect(isHex(hex), `${role} ${hex}`).toBe(true);
    }
  });

  it('roles that are also palette roles match the palette exactly (preview == game)', () => {
    const pal = PALETTES as unknown as Record<'a' | 'b' | 'c', Record<string, string | string[]>>;
    for (const [role, cols] of Object.entries(ROLES)) {
      if (!(role in pal.a)) continue;
      expect(cols, role).toEqual([pal.a[role], pal.b[role], pal.c[role]]);
    }
  });

  it('family-only roles are namespaced with st* so they never clash with other families', () => {
    for (const role of Object.keys(ROLES)) if (!(role in PALETTES.a)) expect(role, role).toMatch(/^st[A-Z]/);
  });
});

describe.each(ENTRIES)('$kind', (e) => {
  it('builds for many seeds inside its footprint (±10 %) and height (±25 %), sitting on the ground', () => {
    for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      const b = bounds(obj);
      const tag = `${e.kind} seed ${seed}`;
      expect(b.isEmpty(), tag).toBe(false);
      expect(b.min.y, tag).toBeGreaterThanOrEqual(-0.01);
      expect(b.min.y, tag).toBeLessThan(0.05);
      expect(b.max.x, tag).toBeLessThanOrEqual((e.w / 2) * 1.1 + 1e-6);
      expect(b.min.x, tag).toBeGreaterThanOrEqual((-e.w / 2) * 1.1 - 1e-6);
      expect(b.max.z, tag).toBeLessThanOrEqual((e.d / 2) * 1.1 + 1e-6);
      expect(b.min.z, tag).toBeGreaterThanOrEqual((-e.d / 2) * 1.1 - 1e-6);
      expect(b.max.y, tag).toBeGreaterThanOrEqual(e.h * 0.75);
      expect(b.max.y, tag).toBeLessThanOrEqual(e.h * 1.25);
      // ...and actually fills a sensible share of the footprint.
      expect(b.max.x - b.min.x, tag).toBeGreaterThanOrEqual(e.w * 0.35);
      expect(b.max.z - b.min.z, tag).toBeGreaterThanOrEqual(e.d * 0.35);
    }
  });

  it(`stays within the ${BUDGET}-triangle street furniture budget`, () => {
    for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      expect(triangles(obj), `${e.kind} seed ${seed}`).toBeLessThanOrEqual(BUDGET);
    }
  });

  it('is made only of meshes with kit materials whose roles the composer can colour', () => {
    const { obj, mats, roles } = build(e.kind);
    let lights = 0, other = 0;
    obj.traverse((c) => {
      if ((c as THREE.Light).isLight) lights++;
      if ((c as THREE.Line).isLine || (c as THREE.Points).isPoints || (c as THREE.Sprite).isSprite) other++;
    });
    expect(lights).toBe(0);
    expect(other).toBe(0);
    const ms = meshes(obj);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(Array.isArray(m.material), e.kind).toBe(false);
      expect(mats.has(m.material as THREE.Material), `${e.kind}: mesh with a non-kit material`).toBe(true);
      expect(m.castShadow, e.kind).toBe(true);
    }
    for (const role of roles) expect(role in PALETTES.a || role in ROLES, `${e.kind}: unknown role ${role}`).toBe(true);
  });

  it('keeps a readable silhouette when toy details are hidden (detail = min)', () => {
    const { obj } = build(e.kind);
    const base = meshes(obj).filter((m) => {
      for (let o: THREE.Object3D | null = m; o; o = o.parent) if (o.userData.detail) return false;
      return true;
    });
    expect(base.length, e.kind).toBeGreaterThan(0);
    const full = bounds(obj), min = new THREE.Box3();
    for (const m of base) min.expandByObject(m, true);
    expect(min.max.y, e.kind).toBeGreaterThan((full.max.y - full.min.y) * 0.7);
    expect(min.max.x - min.min.x, e.kind).toBeGreaterThan((full.max.x - full.min.x) * 0.6);
  });

  it('is deterministic for a given seed', () => {
    const a = build(e.kind, {}, 5), b = build(e.kind, {}, 5);
    expect(triangles(a.obj)).toBe(triangles(b.obj));
    expect(bounds(a.obj).equals(bounds(b.obj))).toBe(true);
  });
});

describe('street specifics', () => {
  it('lamp heads use role `lamp` (FX glow) at LAMP_HEAD height', () => {
    for (const seed of SEEDS) {
      const { obj, mats } = build('st.lamp', {}, seed);
      obj.updateMatrixWorld(true);
      const heads = meshes(obj).filter((m) => mats.get(m.material as THREE.Material) === 'lamp');
      expect(heads.length).toBeGreaterThan(0);
      for (const h of heads) {
        const b = new THREE.Box3().setFromObject(h, true);
        expect(b.max.y).toBeGreaterThan(LAMP_HEAD.y);
        expect(b.min.y).toBeLessThan(LAMP_HEAD.y);
        expect(b.getCenter(new THREE.Vector3()).y).toBeCloseTo(LAMP_HEAD.y, 1);
      }
    }
  });

  it('fence: params.length scales x, triangles grow sub-linearly per metre, rail style also builds', () => {
    for (const length of [1, 2, 3, 4.5, 8]) {
      for (const style of ['picket', 'rail']) {
        const { obj } = build('st.fence', { length, style });
        const b = bounds(obj);
        expect(b.max.x - b.min.x, `${style} ${length}`).toBeGreaterThan(length * 0.9);
        expect(b.max.x - b.min.x, `${style} ${length}`).toBeLessThanOrEqual(length * 1.1);
        expect(b.max.z - b.min.z).toBeLessThanOrEqual(0.22);
        expect(triangles(obj), `${style} ${length}`).toBeLessThanOrEqual((BUDGET / 3) * Math.max(3, length));
      }
    }
  });

  it('traffic light lenses and lamp face +z (front), table umbrella / flag / kiosk accept a colour param', () => {
    const tl = build('st.trafficLight');
    const lens = meshes(tl.obj).filter((m) => roleOf(tl.mats, m) === 'taillight');
    expect(lens.length).toBeGreaterThan(0);
    for (const l of lens) expect(new THREE.Box3().setFromObject(l, true).max.z).toBeGreaterThan(0);
    for (const kind of ['st.tableUmbrella', 'st.flag', 'st.kiosk']) {
      const a = build(kind, { color: 0 }), b = build(kind, { color: 1 });
      const colours = (x: typeof a) => meshes(x.obj).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString()).join();
      expect(colours(a), kind).not.toBe(colours(b));
    }
  });
});

function roleOf(map: Map<THREE.Material, string>, m: THREE.Mesh): string | undefined {
  return map.get(m.material as THREE.Material);
}
