// A4 landmarks: every lm.* catalog kind is registered, builds with the basic kit, fits its catalog box,
// stays within its triangle budget, uses only resolvable palette roles, and carries the features the brief asks for.
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG } from '../assets/catalog';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';
import * as landmarks from '../assets/families/landmarks';
import { PALETTES } from '../palettes';

const KINDS = CATALOG.filter((c) => c.family === 'landmarks');
const GREY = 0x9aa0a6; // basicKit fallback for unknown roles

function registry(): AssetRegistry {
  const r = new AssetRegistry();
  landmarks.register(r);
  return r;
}

/** Build with the basic kit; every material is tagged with the role it was requested as (userData.role). */
function build(kind: string, params: AssetParams = {}, seed = 7, palette: 0 | 1 | 2 = 0): THREE.Object3D {
  const r = registry();
  const def = r.get(kind)!;
  const base = createBasicKit(r.roles, palette, seed);
  const kit: KitContext = { ...base, mat: (role, idx) => { const m = base.mat(role, idx); m.userData.role = role; return m; } };
  const o = def.build(kit, params);
  o.updateMatrixWorld(true);
  return o;
}

function meshes(o: THREE.Object3D, visibleOnly = true): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const walk = (n: THREE.Object3D, hidden: boolean) => {
    const h = hidden || !n.visible;
    if ((n as THREE.Mesh).isMesh && !(visibleOnly && h)) out.push(n as THREE.Mesh);
    for (const c of n.children) walk(c, h);
  };
  walk(o, false);
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

/** Exact bounds of every mesh vertex (optionally skipping detail-tagged subtrees). */
function bounds(o: THREE.Object3D, skipDetail = false): THREE.Box3 {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const walk = (n: THREE.Object3D) => {
    if (skipDetail && n.userData.detail) return;
    const m = n as THREE.Mesh;
    if (m.isMesh) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
    }
    for (const c of n.children) walk(c);
  };
  walk(o);
  return box;
}

function rolesUsed(kind: string, params: AssetParams = {}): Set<string> {
  const r = registry();
  const base = createBasicKit(r.roles, 0, 3);
  const roles = new Set<string>();
  const kit: KitContext = { ...base, mat: (role, idx) => { roles.add(role); return base.mat(role, idx); } };
  r.get(kind)!.build(kit, params);
  return roles;
}

function named(o: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  o.traverse((c) => { if (c.name === name) out.push(c); });
  return out;
}

/** Visible meshes under `o` whose material was requested with `role`. */
function withRole(o: THREE.Object3D, role: string): THREE.Mesh[] {
  return meshes(o).filter((m) => (m.material as THREE.Material).userData.role === role);
}

describe('landmarks registry', () => {
  it('registers exactly the lm.* catalog kinds with catalog footprints and heights', () => {
    const r = registry();
    expect(r.kinds()).toEqual(KINDS.map((c) => c.kind).sort());
    for (const c of KINDS) {
      const def = r.get(c.kind)!;
      expect(def.family).toBe('landmarks');
      expect(def.footprint).toEqual({ w: c.w, d: c.d });
      expect(def.height).toBe(c.h);
    }
  });

  it('declares ROLES as [a, b, c] hex colours and adds them to the registry', () => {
    const r = registry();
    const hex = /^#[0-9a-fA-F]{6}$/;
    expect(Object.keys(landmarks.ROLES).length).toBeGreaterThan(0);
    for (const [role, v] of Object.entries(landmarks.ROLES)) {
      expect(v, role).toHaveLength(3);
      for (const p of v) for (const c of Array.isArray(p) ? p : [p]) expect(c, role).toMatch(hex);
      expect(r.roles[role]).toBe(v);
    }
  });

  it('marks the rail signal as instanced (many identical copies along the loop)', () => {
    expect(registry().get('lm.railSignal')!.instanced).toBe(true);
  });
});

describe.each(KINDS)('$kind', (c) => {
  it('builds with the basic kit in every palette without throwing, on the ground, finite', () => {
    for (const p of [0, 1, 2] as const) {
      const o = build(c.kind, {}, 11, p);
      const b = bounds(o);
      expect(b.isEmpty()).toBe(false);
      expect(b.min.y).toBeGreaterThan(-0.02);
      expect(b.min.y).toBeLessThan(0.08);
      for (const m of meshes(o, false)) {
        const a = m.geometry.getAttribute('position').array as ArrayLike<number>;
        for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i]!)).toBe(true);
      }
    }
  });

  it('fits the catalog footprint (±10 %, centred) and height (±25 %)', () => {
    const b = bounds(build(c.kind));
    const tol = 1.1;
    expect(b.min.x, 'minX').toBeGreaterThanOrEqual((-c.w / 2) * tol);
    expect(b.max.x, 'maxX').toBeLessThanOrEqual((c.w / 2) * tol);
    expect(b.min.z, 'minZ').toBeGreaterThanOrEqual((-c.d / 2) * tol);
    expect(b.max.z, 'maxZ').toBeLessThanOrEqual((c.d / 2) * tol);
    expect(b.max.x - b.min.x, 'width').toBeGreaterThanOrEqual(c.w * 0.9);
    expect(b.max.z - b.min.z, 'depth').toBeGreaterThanOrEqual(c.d * 0.9);
    expect(b.max.y, 'height').toBeGreaterThanOrEqual(c.h * 0.75);
    expect(b.max.y, 'height').toBeLessThanOrEqual(c.h * 1.25);
  });

  it('keeps its silhouette without detail parts (details are small extras)', () => {
    const o = build(c.kind);
    let details = 0;
    o.traverse((n) => { if (n.userData.detail) details++; });
    expect(details).toBeGreaterThan(0);
    const b = bounds(o, true);
    expect(b.max.x - b.min.x).toBeGreaterThanOrEqual(c.w * 0.7);
    expect(b.max.z - b.min.z).toBeGreaterThanOrEqual(c.d * 0.6);
    expect(b.max.y).toBeGreaterThanOrEqual(c.h * 0.6);
  });

  it('stays within the triangle budget', () => {
    const def = registry().get(c.kind)!;
    const budget = def.instanced ? 600 : 8000;
    expect(triangles(build(c.kind))).toBeLessThanOrEqual(budget);
  });

  it('uses only roles the composer palette or the family ROLES resolve (never the grey fallback)', () => {
    const known = new Set([...Object.keys(PALETTES.a), ...Object.keys(landmarks.ROLES)]);
    for (const role of rolesUsed(c.kind)) expect(known.has(role), role).toBe(true);
    for (const m of meshes(build(c.kind), false)) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) expect((mat as THREE.MeshStandardMaterial).color.getHex()).not.toBe(GREY);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = build(c.kind, {}, 5), b = build(c.kind, {}, 5);
    expect(triangles(a)).toBe(triangles(b));
    expect(bounds(a).equals(bounds(b))).toBe(true);
  });
});

describe('lm.stadium showpiece', () => {
  let s: THREE.Object3D;
  beforeAll(() => { s = build('lm.stadium'); });
  it('has stepped seating tiers in two seat colours', () => {
    expect(named(s, 'tier').length).toBeGreaterThanOrEqual(3);
    const roles = rolesUsed('lm.stadium');
    expect(roles.has('seats')).toBe(true);
  });
  it('has 4 light towers with glowing lamp heads', () => {
    const towers = named(s, 'lightTower');
    expect(towers).toHaveLength(4);
    for (const t of towers) expect(withRole(t, 'lamp').length).toBeGreaterThan(0);
    // towers stand at the four corners
    const quads = new Set(towers.map((t) => `${Math.sign(t.position.x)},${Math.sign(t.position.z)}`));
    expect(quads.size).toBe(4);
  });
  it('has a scoreboard with a display, a press box, >= 3 gates, banners and flags', () => {
    expect(named(s, 'scoreboard')).toHaveLength(1);
    expect(withRole(named(s, 'scoreboard')[0]!, 'display').length).toBeGreaterThan(0);
    expect(named(s, 'pressBox')).toHaveLength(1);
    expect(named(s, 'gate').length).toBeGreaterThanOrEqual(3);
    expect(named(s, 'banner').length).toBeGreaterThanOrEqual(8);
    expect(named(s, 'flag').length).toBeGreaterThanOrEqual(6);
  });
  it('has a main gate on the front (+z) side', () => {
    expect(named(s, 'gate').some((g) => g.position.z > 3)).toBe(true);
  });
  it('has a marked pitch with goalposts', () => {
    expect(named(s, 'goalpost')).toHaveLength(2);
    expect(rolesUsed('lm.stadium').has('field')).toBe(true);
  });
});

describe('lm.clockTower', () => {
  it('has 4 clock faces, one per side, matching CLOCK_TOWER_FACES', () => {
    const o = build('lm.clockTower');
    const faces = named(o, 'clockFace');
    expect(faces).toHaveLength(4);
    expect(landmarks.CLOCK_TOWER_FACES).toHaveLength(4);
    for (const f of landmarks.CLOCK_TOWER_FACES) {
      expect(faces.some((c) => c.position.distanceTo(new THREE.Vector3(f.x, f.y, f.z)) < 1e-6 && Math.abs(c.rotation.y - f.rotY) < 1e-6)).toBe(true);
    }
    const normals = landmarks.CLOCK_TOWER_FACES.map((f) => `${Math.round(Math.sin(f.rotY))},${Math.round(Math.cos(f.rotY))}`);
    expect(new Set(normals).size).toBe(4);
  });
  it('has static hands by default and none with params.hands = false (FX animates them)', () => {
    expect(named(build('lm.clockTower'), 'clockHand').length).toBe(8);
    expect(named(build('lm.clockTower', { hands: false }), 'clockHand').length).toBe(0);
  });
});

describe('stations face the platform (+z)', () => {
  for (const kind of ['lm.stationCentral', 'lm.stationHalt']) {
    it(`${kind}: canopy over the front, building mass behind it`, () => {
      const o = build(kind);
      const canopy = named(o, 'canopy');
      expect(canopy.length).toBeGreaterThanOrEqual(1);
      const cb = bounds(canopy[0]!);
      const ob = bounds(o);
      expect(cb.max.z).toBeGreaterThan(ob.max.z - 0.4);
      expect(named(o, 'bench').length).toBeGreaterThanOrEqual(1);
    });
  }
  it('lm.stationCentral has a clock', () => {
    expect(named(build('lm.stationCentral'), 'clockFace').length).toBeGreaterThanOrEqual(1);
  });
});

describe('rail pieces', () => {
  it('lm.levelCrossing: two barrier posts on opposite corners with red warning lights', () => {
    const o = build('lm.levelCrossing');
    const posts = named(o, 'crossingPost');
    expect(posts).toHaveLength(2);
    expect(Math.sign(posts[0]!.position.x)).toBe(-Math.sign(posts[1]!.position.x));
    expect(Math.sign(posts[0]!.position.z)).toBe(-Math.sign(posts[1]!.position.z));
    expect(withRole(o, 'taillight').length).toBeGreaterThanOrEqual(4);
    expect(named(o, 'barrierArm')).toHaveLength(2);
  });
  it('lm.railSignal: lights face +z', () => {
    const o = build('lm.railSignal');
    const head = named(o, 'signalHead')[0]!;
    const lights = withRole(head, 'taillight');
    expect(lights.length).toBeGreaterThan(0);
    const b = bounds(lights[0]!);
    expect((b.min.z + b.max.z) / 2).toBeGreaterThan(0);
  });
});

describe('lm.waterTower', () => {
  it('stands on legs with a tank in town colours on top', () => {
    const o = build('lm.waterTower');
    expect(named(o, 'leg').length).toBeGreaterThanOrEqual(4);
    const tank = named(o, 'tank')[0]!;
    expect(bounds(tank).min.y).toBeGreaterThan(3.5);
    expect(rolesUsed('lm.waterTower').has('lmTank')).toBe(true);
  });
});
