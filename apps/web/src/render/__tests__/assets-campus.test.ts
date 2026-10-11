// Owner: A2. Campus family (cp.*): registration, budgets, footprints, kit-only parts, palette roles, fronts.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG } from '../assets/catalog';
import * as campus from '../assets/families/campus';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';

const KINDS = CATALOG.filter((c) => c.family === 'campus');
/** Shared kit roles campus may use (they exist in both basicKit and the T2.1 palettes, and some glow at dusk). */
const SHARED_ROLES = new Set(['window', 'lamp', 'leaf']);

function registry(): AssetRegistry {
  const r = new AssetRegistry();
  campus.register(r);
  return r;
}

interface Spy { k: KitContext; roles: Map<string, Set<number>>; mats: Map<THREE.Material, string> }
/** basicKit wrapper that records requested roles/materials and tags every mesh the kit itself creates. */
function spyKit(seed = 1, palette: 0 | 1 | 2 = 0): Spy {
  const base = createBasicKit(campus.ROLES, palette, seed);
  const roles = new Map<string, Set<number>>();
  const mats = new Map<THREE.Material, string>();
  const tag = <T extends THREE.Mesh>(m: T): T => { m.userData.fromKit = true; return m; };
  const k: KitContext = {
    mat(role, idx = 0) {
      if (!roles.has(role)) roles.set(role, new Set());
      roles.get(role)!.add(idx);
      const m = base.mat(role, idx);
      mats.set(m, role);
      return m;
    },
    rbox: (w, h, d, r, m) => tag(base.rbox(w, h, d, r, m)),
    cyl: (rt, rb, h, m, seg) => tag(base.cyl(rt, rb, h, m, seg)),
    sphere: (r, m, seg) => tag(base.sphere(r, m, seg)),
    cone: (r, h, m, seg) => tag(base.cone(r, h, m, seg)),
    detail: base.detail,
    rand: base.rand,
  };
  return { k, roles, mats };
}

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}
const tris = (o: THREE.Object3D) => meshes(o).reduce((s, m) => {
  const g = m.geometry;
  return s + (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}, 0);
function bounds(o: THREE.Object3D, onlyBase = false): THREE.Box3 {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3();
  const visit = (c: THREE.Object3D, hidden: boolean) => {
    const h = hidden || (onlyBase && !!c.userData.detail);
    if ((c as THREE.Mesh).isMesh && !h) b.expandByObject(c);
    for (const ch of c.children) visit(ch, h);
  };
  visit(o, false);
  return b;
}
function isDetail(o: THREE.Object3D): boolean {
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (c.userData.detail) return true;
  return false;
}

/** Every kind with every documented variant (plus defaults) across several placement seeds. */
function cases(): Array<{ kind: string; params: AssetParams; seed: number }> {
  const out: Array<{ kind: string; params: AssetParams; seed: number }> = [];
  for (const c of KINDS) {
    const variants = [{}, ...(campus.VARIANTS[c.kind] ?? [])];
    for (const params of variants) for (const seed of [1, 7, 42]) out.push({ kind: c.kind, params, seed });
  }
  return out;
}

describe('campus family registration', () => {
  it('registers every cp.* catalog kind with the catalog footprint and height', () => {
    const r = registry();
    expect(KINDS.length).toBe(7);
    for (const c of KINDS) {
      const def = r.get(c.kind);
      expect(def, c.kind).toBeDefined();
      expect(def!.family).toBe('campus');
      expect(def!.footprint).toEqual({ w: c.w, d: c.d });
      expect(def!.height).toBe(c.h);
      expect(def!.instanced ?? false).toBe(false);
    }
    expect(r.kinds().filter((k) => k.startsWith('cp.')).sort()).toEqual(KINDS.map((c) => c.kind).sort());
  });

  it('declares every campus role for all three palettes as hex colours', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    const entries = Object.entries(campus.ROLES);
    expect(entries.length).toBeGreaterThan(5);
    for (const [role, pal] of entries) {
      expect(role.startsWith('cp'), role).toBe(true);
      expect(pal.length).toBe(3);
      for (const v of pal) for (const c of Array.isArray(v) ? v : [v]) expect(c, role).toMatch(hex);
    }
    expect(registry().roles).toMatchObject(campus.ROLES);
  });

  it('documents its params as variant lists for districts', () => {
    for (const [kind, list] of Object.entries(campus.VARIANTS)) {
      expect(KINDS.some((c) => c.kind === kind), kind).toBe(true);
      expect(list.length).toBeGreaterThan(0);
    }
    expect(campus.VARIANTS['cp.hall']!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('campus builds', () => {
  const r = registry();

  it.each(cases())('$kind $params seed $seed: within footprint ±10 %, height ±25 %, centred, on the ground, ≤ 3,000 tris', ({ kind, params, seed }) => {
    const c = KINDS.find((e) => e.kind === kind)!;
    const { k } = spyKit(seed);
    const obj = r.get(kind)!.build(k, params);
    const b = bounds(obj);
    const w = b.max.x - b.min.x, d = b.max.z - b.min.z, h = b.max.y;
    expect(w, 'width').toBeGreaterThanOrEqual(c.w * 0.9);
    expect(w, 'width').toBeLessThanOrEqual(c.w * 1.1);
    expect(d, 'depth').toBeGreaterThanOrEqual(c.d * 0.9);
    expect(d, 'depth').toBeLessThanOrEqual(c.d * 1.1);
    expect(h, 'height').toBeGreaterThanOrEqual(c.h * 0.75);
    expect(h, 'height').toBeLessThanOrEqual(c.h * 1.25);
    expect(Math.abs((b.max.x + b.min.x) / 2), 'centre x').toBeLessThanOrEqual(c.w * 0.05);
    expect(Math.abs((b.max.z + b.min.z) / 2), 'centre z').toBeLessThanOrEqual(c.d * 0.05);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(b.min.y).toBeLessThanOrEqual(0.05);
    expect(tris(obj)).toBeLessThanOrEqual(3000);
    expect(obj.position.length() + obj.rotation.y + Math.abs(obj.scale.x - 1)).toBe(0);
  });

  it.each(KINDS.map((c) => c.kind))('%s uses only kit parts, kit materials and declared roles', (kind) => {
    for (const params of [{}, ...(campus.VARIANTS[kind] ?? [])]) {
      const { k, roles, mats } = spyKit(3);
      const obj = r.get(kind)!.build(k, params);
      const ms = meshes(obj);
      expect(ms.length).toBeGreaterThan(5);
      for (const m of ms) {
        expect(m.userData.fromKit, `${kind} mesh made outside the kit`).toBe(true);
        expect(Array.isArray(m.material)).toBe(false);
        expect(mats.has(m.material as THREE.Material), `${kind} material not from k.mat`).toBe(true);
        // Mergeable like the kit primitives: position + normal + uv.
        const g = m.geometry;
        for (const a of ['position', 'normal', 'uv']) expect(g.getAttribute(a), `${kind} missing ${a}`).toBeDefined();
      }
      for (const role of roles.keys()) expect(SHARED_ROLES.has(role) || role in campus.ROLES, `${kind} role ${role}`).toBe(true);
    }
  });

  it.each(KINDS.map((c) => c.kind))('%s keeps its silhouette at detail = min and marks small parts as detail', (kind) => {
    const c = KINDS.find((e) => e.kind === kind)!;
    const obj = r.get(kind)!.build(spyKit(5).k, {});
    const all = bounds(obj), base = bounds(obj, true);
    expect(base.max.y).toBeGreaterThanOrEqual(all.max.y * 0.8);
    expect(base.max.x - base.min.x).toBeGreaterThanOrEqual(c.w * 0.8);
    const ms = meshes(obj);
    const detailParts = ms.filter(isDetail).length;
    expect(detailParts).toBeGreaterThan(0);
    expect(detailParts).toBeLessThan(ms.length);
  });

  it.each(KINDS.filter((c) => c.kind !== 'cp.gate').map((c) => c.kind))('%s has dark and dusk-lit windows', (kind) => {
    const { k, roles } = spyKit(11);
    r.get(kind)!.build(k, {});
    expect(roles.get('window')?.has(0), 'dark window').toBe(true);
    expect(roles.get('window')?.has(1), 'lit window').toBe(true);
  });

  it('gate carries lanterns that glow at dusk', () => {
    const { k, roles } = spyKit(2);
    r.get('cp.gate')!.build(k, {});
    expect(roles.has('lamp')).toBe(true);
  });

  it.each(KINDS.filter((c) => c.kind !== 'cp.gate').map((c) => c.kind))('%s faces +z: its main door is on the front', (kind) => {
    const { k, mats } = spyKit(4);
    const obj = r.get(kind)!.build(k, {});
    obj.updateMatrixWorld(true);
    const doors = meshes(obj).filter((m) => mats.get(m.material as THREE.Material) === 'cpDoor');
    expect(doors.length, 'door meshes').toBeGreaterThan(0);
    const z = doors.map((m) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).z);
    const b = bounds(obj);
    expect(Math.max(...z), 'a door on the front half').toBeGreaterThan((b.max.z + b.min.z) / 2 + (b.max.z - b.min.z) * 0.15);
  });

  it('is deterministic for the same seed and varies across placements', () => {
    const a = tris(r.get('cp.hall')!.build(spyKit(9).k, {}));
    const b = tris(r.get('cp.hall')!.build(spyKit(9).k, {}));
    expect(a).toBe(b);
    const counts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => tris(r.get('cp.hall')!.build(spyKit(s).k, {}))));
    expect(counts.size).toBeGreaterThan(1);
  });

  it('builds in every palette', () => {
    for (const p of [0, 1, 2] as const) for (const c of KINDS) expect(() => r.get(c.kind)!.build(spyKit(1, p).k, {})).not.toThrow();
  });
});
