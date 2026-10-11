// Owner: A5 vegetation. Every `veg.*` kind: registered + instanced, crowns sway, builds with the basic kit for
// many seeds inside its catalog footprint (±10 %) and height (±25 %), ≤ 600 triangles, only kit materials with
// roles the composer can colour, real per-instance variety from k.rand(), deterministic per placement.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG } from '../assets/catalog';
import { ROLES, register } from '../assets/families/vegetation';
import { createRegistry } from '../assets/index';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';
import { PALETTES } from '../palettes';

const ENTRIES = CATALOG.filter((c) => c.family === 'vegetation');
const TREES = ['veg.oak', 'veg.maple', 'veg.pine', 'veg.birch', 'veg.poplar', 'veg.cherry'];
const SWAYS = new Set([...TREES, 'veg.bush']);
const BUDGET = 600;
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 17);

function vegRegistry(): AssetRegistry {
  const r = new AssetRegistry();
  register(r);
  return r;
}

/** Basic kit that records every role + material it hands out and counts rand() calls. */
function trackingKit(seed = 1, palette: 0 | 1 | 2 = 0) {
  const base = createBasicKit(ROLES, palette, seed);
  const roles = new Set<string>();
  const mats = new Map<THREE.Material, string>();
  const calls = { rand: 0 };
  const k: KitContext = {
    ...base,
    mat(role, idx) {
      roles.add(role);
      const m = base.mat(role, idx);
      mats.set(m, role);
      return m;
    },
    rand() { calls.rand++; return base.rand(); },
  };
  return { k, roles, mats, calls };
}

function build(kind: string, params: AssetParams = {}, seed = 1, palette: 0 | 1 | 2 = 0) {
  const def = vegRegistry().get(kind)!;
  const t = trackingKit(seed, palette);
  const obj = def.build(t.k, params);
  return { obj, def, ...t };
}

function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
}

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}

function triangles(o: THREE.Object3D): number {
  let n = 0;
  for (const m of meshes(o)) {
    const g = m.geometry;
    const count = g.index ? g.index.count : g.getAttribute('position').count;
    n += (count / 3) * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
  }
  return n;
}

const isDetail = (m: THREE.Object3D) => { for (let o: THREE.Object3D | null = m; o; o = o.parent) if (o.userData.detail) return true; return false; };
const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);
const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
const colours = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

describe('vegetation family registration', () => {
  it('registers every veg.* catalog kind with its catalog footprint and height (and nothing else)', () => {
    const r = vegRegistry();
    expect(ENTRIES.length).toBe(10);
    for (const e of ENTRIES) {
      const def = r.get(e.kind);
      expect(def, e.kind).toBeDefined();
      expect(def!.kind).toBe(e.kind);
      expect(def!.family).toBe('vegetation');
      expect(def!.footprint).toEqual({ w: e.w, d: e.d });
      expect(def!.height).toBe(e.h);
    }
    expect(r.kinds()).toEqual(ENTRIES.map((e) => e.kind).sort());
  });

  it('every kind is instanced; tree and bush crowns sway, clipped/ground pieces stay still', () => {
    const r = vegRegistry();
    for (const e of ENTRIES) {
      expect(r.get(e.kind)!.instanced, e.kind).toBe(true);
      expect(r.get(e.kind)!.sway ?? false, e.kind).toBe(SWAYS.has(e.kind));
    }
  });

  it('is part of createRegistry() and adds its roles there', () => {
    const r = createRegistry();
    for (const e of ENTRIES) expect(r.get(e.kind)?.family, e.kind).toBe('vegetation');
    for (const role of Object.keys(ROLES)) expect(r.roles[role], role).toBeDefined();
  });
});

describe('vegetation roles', () => {
  it('every role has valid colours for palettes a, b and c; family roles keep one variant count', () => {
    for (const [role, cols] of Object.entries(ROLES)) {
      expect(cols.length, role).toBe(3);
      const n = colours(cols[0]).length;
      for (const c of cols) {
        if (!(role in PALETTES.a)) expect(colours(c).length, `${role} variant count`).toBe(n);
        for (const hex of colours(c)) expect(isHex(hex), `${role} ${hex}`).toBe(true);
      }
    }
  });

  it('roles that are also palette roles match the palette exactly (preview == game)', () => {
    const pal = PALETTES as unknown as Record<'a' | 'b' | 'c', Record<string, string | string[]>>;
    for (const [role, cols] of Object.entries(ROLES)) {
      if (!(role in pal.a)) continue;
      expect(cols, role).toEqual([pal.a[role], pal.b[role], pal.c[role]]);
    }
  });

  it('family-only roles are namespaced veg* so they never clash with other families', () => {
    for (const role of Object.keys(ROLES)) if (!(role in PALETTES.a)) expect(role, role).toMatch(/^veg[A-Z]/);
  });

  it('cherry blossom is pink in Wooden Toy; maples turn autumn red/orange in palette c; birch bark is pale', () => {
    for (const hex of colours(ROLES.vegBlossom![0])) {
      const c = hsl(hex);
      expect(c.h > 0.88 || c.h < 0.02, `blossom ${hex}`).toBe(true);
      expect(c.l, `blossom ${hex}`).toBeGreaterThan(0.6);
    }
    for (const hex of colours(ROLES.vegMaple![2])) {
      const c = hsl(hex);
      expect(c.h, `maple c ${hex}`).toBeLessThan(0.12);
      expect(c.s, `maple c ${hex}`).toBeGreaterThan(0.45);
    }
    for (const hex of colours(ROLES.vegMaple![0])) expect(hsl(hex).h, `maple a ${hex} is green`).toBeGreaterThan(0.2);
    for (const p of [0, 1, 2]) expect(hsl(colours(ROLES.vegBirchBark![p]!)[0]!).l).toBeGreaterThan(0.85);
  });
});

describe.each(ENTRIES)('$kind', (e) => {
  it('builds for many seeds inside its footprint (±10 %) and height (±25 %), centred and on the ground', () => {
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
      // ...and fills a good share of the footprint (trees are round, so ~3/4 of a square side).
      expect(b.max.x - b.min.x, tag).toBeGreaterThanOrEqual(e.w * 0.6);
      expect(b.max.z - b.min.z, tag).toBeGreaterThanOrEqual(e.d * 0.6);
    }
  });

  it(`stays within the ${BUDGET}-triangle instanced budget for every variant`, () => {
    for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      expect(triangles(obj), `${e.kind} seed ${seed}`).toBeLessThanOrEqual(BUDGET);
    }
  });

  it('is made only of shadow-casting meshes with kit materials whose roles the composer can colour', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { obj, mats, roles } = build(e.kind, {}, seed);
      let other = 0;
      obj.traverse((c) => {
        if ((c as THREE.Light).isLight || (c as THREE.Line).isLine || (c as THREE.Points).isPoints || (c as THREE.Sprite).isSprite) other++;
      });
      expect(other).toBe(0);
      const ms = meshes(obj);
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) {
        expect(Array.isArray(m.material), e.kind).toBe(false);
        expect(mats.has(m.material as THREE.Material), `${e.kind}: mesh with a non-kit material`).toBe(true);
        expect(m.castShadow, e.kind).toBe(true);
        expect((m as THREE.InstancedMesh).isInstancedMesh ?? false, `${e.kind}: nested InstancedMesh`).toBe(false);
      }
      for (const role of roles) expect(role in PALETTES.a || role in ROLES, `${e.kind}: unknown role ${role}`).toBe(true);
    }
  });

  it('builds in every palette without falling back to the grey placeholder colour', () => {
    for (const p of [0, 1, 2] as const) for (const seed of SEEDS.slice(0, 10)) {
      const { obj } = build(e.kind, {}, seed, p);
      for (const m of meshes(obj)) {
        const hex = (m.material as THREE.MeshStandardMaterial).color.getHexString();
        expect(hex, `${e.kind} palette ${p}`).not.toBe('9aa0a6');
      }
    }
  });

  it('root carries no transform (registry.build owns position/rotation/scale)', () => {
    const { obj } = build(e.kind, {}, 3);
    expect(obj.position.length()).toBe(0);
    expect(obj.rotation.x + obj.rotation.y + obj.rotation.z).toBe(0);
    expect(obj.scale.x === 1 && obj.scale.y === 1 && obj.scale.z === 1).toBe(true);
  });

  it('keeps a readable silhouette when toy details are hidden (detail = min)', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const { obj } = build(e.kind, {}, seed);
      const base = meshes(obj).filter((m) => !isDetail(m));
      expect(base.length, e.kind).toBeGreaterThan(0);
      const full = bounds(obj), min = new THREE.Box3();
      for (const m of base) min.expandByObject(m, true);
      expect(min.max.y, e.kind).toBeGreaterThan(full.max.y * 0.8);
      expect(min.max.x - min.min.x, e.kind).toBeGreaterThan((full.max.x - full.min.x) * 0.8);
    }
  });

  it('draws one k.rand() per build and is deterministic for a given rand stream', () => {
    const a = build(e.kind, {}, 5), b = build(e.kind, {}, 5);
    expect(a.calls.rand).toBe(1);
    expect(a.obj.userData.variant).toBe(b.obj.userData.variant);
    expect(triangles(a.obj)).toBe(triangles(b.obj));
    expect(bounds(a.obj).equals(bounds(b.obj))).toBe(true);
  });

  it('varies per instance: several distinct variants across seeds, with real shape or colour differences', () => {
    const keys = new Set<string>(), looks = new Set<string>();
    for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      expect(typeof obj.userData.variant, e.kind).toBe('string');
      keys.add(obj.userData.variant as string);
      const b = bounds(obj);
      const cols = meshes(obj).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString()).sort().join(',');
      looks.add(`${b.max.y.toFixed(3)}|${(b.max.x - b.min.x).toFixed(3)}|${cols}`);
    }
    expect(keys.size, e.kind).toBeGreaterThanOrEqual(4);
    expect(looks.size, e.kind).toBeGreaterThanOrEqual(4);
  });

  it('equal variant keys mean identical geometry (safe to instance one build per key)', () => {
    const seen = new Map<string, string>();
    for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      const b = bounds(obj);
      const sig = `${triangles(obj)}|${meshes(obj).length}|${b.min.toArray().map((v) => v.toFixed(4))}|${b.max.toArray().map((v) => v.toFixed(4))}`;
      const key = obj.userData.variant as string;
      if (seen.has(key)) expect(sig, key).toBe(seen.get(key));
      else seen.set(key, sig);
    }
  });

  it('params.variant pins the variant without consuming k.rand()', () => {
    const a = build(e.kind, { variant: 3 }, 11), b = build(e.kind, { variant: 3 }, 977);
    expect(a.calls.rand).toBe(0);
    expect(a.obj.userData.variant).toBe(b.obj.userData.variant);
    const many = new Set<string>();
    for (let v = 0; v < 24; v++) many.add(build(e.kind, { variant: v }, 1).obj.userData.variant as string);
    expect(many.size, e.kind).toBeGreaterThanOrEqual(3);
  });
});

describe('vegetation specifics', () => {
  it('hedge follows params.length along x and keeps its depth and height', () => {
    const keys = new Set<string>();
    for (const len of [0.8, 1.5, 3, 4.5, 8, 14]) for (const seed of SEEDS.slice(0, 6)) {
      const { obj } = build('veg.hedge', { length: len }, seed);
      const b = bounds(obj);
      const tag = `hedge length ${len} seed ${seed}`;
      expect(b.max.x - b.min.x, tag).toBeGreaterThanOrEqual(len * 0.9);
      expect(b.max.x - b.min.x, tag).toBeLessThanOrEqual(len * 1.1);
      expect(b.max.z - b.min.z, tag).toBeLessThanOrEqual(0.8 * 1.1);
      expect(b.max.y, tag).toBeGreaterThanOrEqual(0.6);
      expect(b.max.y, tag).toBeLessThanOrEqual(1.0);
      expect(triangles(obj), tag).toBeLessThanOrEqual(BUDGET);
      keys.add(obj.userData.variant as string);
    }
    expect(keys.size).toBeGreaterThanOrEqual(6);
  });

  it('trees keep a visible trunk under the crown and carry most of their mass above the sway pivot', () => {
    for (const kind of TREES) for (const seed of SEEDS.slice(0, 10)) {
      const { obj } = build(kind, {}, seed);
      obj.updateMatrixWorld(true);
      let low = 0, high = 0;
      const v = new THREE.Vector3();
      for (const m of meshes(obj)) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); if (v.y < 0.45) low++; else high++; }
      }
      expect(low, `${kind}: trunk base`).toBeGreaterThan(0);
      expect(high / (low + high), `${kind}: crown share`).toBeGreaterThan(0.7);
    }
  });

  it('marks tasteful toy details in several kinds', () => {
    const withDetail = new Set<string>();
    for (const e of ENTRIES) for (const seed of SEEDS) {
      const { obj } = build(e.kind, {}, seed);
      if (meshes(obj).some(isDetail)) { withDetail.add(e.kind); break; }
    }
    expect(withDetail.size).toBeGreaterThanOrEqual(4);
  });

  it('a mixed grove has plenty of variety (dozens of distinct looks over 200 placements)', () => {
    const k = createBasicKit(ROLES, 0, 4242);
    const r = vegRegistry();
    const keys = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const kind = TREES[i % TREES.length]!;
      keys.add(r.build(k, { kind, x: i, z: 0 }).userData.variant as string);
    }
    expect(keys.size).toBeGreaterThanOrEqual(40);
  });
});
