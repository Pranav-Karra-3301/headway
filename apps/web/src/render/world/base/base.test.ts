// Owner: E3. Diorama base: the cut-edge profile (land on the mountain sides, a water column over the lake bed on
// the lake sides), sampling sibling terrain/water so the cut follows them, the merged geometry (never over the
// board, inside the plinth footprint, cheap) and the layer contract (one draw call, adapts at runtime).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import type { FrameContext } from '../../layers';
import { worldLayout } from '../layout';
import { buildBaseGeometry } from './geometry';
import { createBaseLayer } from './index';
import { adaptProfile, BASE, defaultProfile, floorAt, groundAt, isWater, modeLevel, samplePoints, sampleTops } from './profile';

const layout = worldLayout(TOWN);
const E = layout.extent, B = layout.board;

describe('default profile', () => {
  const sides = defaultProfile(layout);
  it('walks the four cut edges clockwise with shared corners and ≤ 1 u spacing', () => {
    expect(sides.map((s) => s.side)).toEqual(['north', 'east', 'south', 'west']);
    for (let i = 0; i < 4; i++) {
      const s = sides[i]!, next = sides[(i + 1) % 4]!;
      const last = s.samples[s.samples.length - 1]!, first = next.samples[0]!;
      expect(last.x).toBeCloseTo(first.x, 6);
      expect(last.z).toBeCloseTo(first.z, 6);
      for (let k = 1; k < s.samples.length; k++) {
        const a = s.samples[k - 1]!, b = s.samples[k]!;
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(BASE.step + 1e-9);
      }
    }
    expect(sides[0]!.samples[0]).toMatchObject({ x: E.minX, z: E.minZ });
    expect(sides[2]!.samples[0]).toMatchObject({ x: E.maxX, z: E.maxZ });
  });

  it('mountain sides are dry board-level land; lake sides are a deep water column', () => {
    const [north, east, south, west] = sides;
    for (const p of north!.samples) {
      if (p.x < layout.shore.east) { expect(p.water).toBeNull(); expect(p.ground).toBeCloseTo(BASE.landY, 6); }
      else if (p.x > layout.shore.east + 1) expect(p.water).toBe(BASE.waterLevel);
    }
    for (const p of [...east!.samples, ...south!.samples]) {
      expect(p.water).toBe(BASE.waterLevel);
      expect(p.ground).toBeLessThan(BASE.waterLevel - 1.5);
      expect(p.ground).toBeGreaterThan(BASE.bottom + 1);
    }
    for (const p of west!.samples) {
      if (p.z > layout.shore.south + 1) expect(p.water).toBe(BASE.waterLevel);
      if (p.z < layout.shore.south) expect(p.water).toBeNull();
    }
  });

  it('ground: board level on land, a beach sloping to the shore, a lake bed deepening away from it', () => {
    expect(groundAt(layout, -50, -40)).toBeCloseTo(BASE.landY, 6);
    expect(groundAt(layout, 0, 0)).toBeCloseTo(BASE.landY, 6);
    let prev = Infinity;
    for (let z = B.maxZ; z <= E.maxZ; z += 0.5) {
      const y = groundAt(layout, 0, z);
      expect(y).toBeLessThanOrEqual(prev + 1e-9);
      prev = y;
    }
    expect(groundAt(layout, 0, B.maxZ + 2)).toBeLessThan(BASE.landY);
    expect(groundAt(layout, 0, B.maxZ + 2)).toBeGreaterThan(BASE.waterLevel - 0.6);
    // the safety floor always stays under the expected ground
    for (const [x, z] of [[-50, -40], [0, B.maxZ + 2], [0, E.maxZ], [E.maxX, -50]] as const) expect(floorAt(layout, x, z)).toBeLessThan(groundAt(layout, x, z) - 0.5);
    expect(groundAt(layout, 0, E.maxZ)).toBeCloseTo(BASE.bedY, 6);
    expect(groundAt(layout, E.maxX, 0)).toBeCloseTo(BASE.bedY, 6);
    expect(isWater(layout, 0, layout.shore.south + 0.1)).toBe(true);
    expect(isWater(layout, 0, layout.shore.south - 0.1)).toBe(false);
  });
});

describe('sampleTops', () => {
  const flat = (w: number, d: number, y: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    m.position.set(x, y, z);
    return m;
  };
  it('reads the highest visible non-instanced surface above each point, in world space', () => {
    const g = new THREE.Group();
    g.position.y = 1;
    g.add(flat(10, 10, 2, 5, 5)); // y = 3 over [0,10]²
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(10, 10, 4, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    slope.geometry.translate(25, 0, 5);
    const pos = slope.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setY(i, 0.5 * (pos.getX(i) - 20)); // y = 0.5 (x − 20) over x ∈ [20, 30]
    g.add(slope);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 50, 1), new THREE.MeshBasicMaterial(), 1);
    inst.position.set(5, 0, 5);
    g.add(inst);
    const hidden = flat(10, 10, 40, 5, 5);
    hidden.visible = false;
    g.add(hidden);
    const out = sampleTops([g], [{ x: 5, z: 5 }, { x: 50, z: 50 }, { x: 24, z: 5 }, { x: 28, z: 2 }]);
    expect(out[0]).toBeCloseTo(3, 5);
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(1 + 0.5 * 4, 5);
    expect(out[3]).toBeCloseTo(1 + 0.5 * 8, 5);
  });

  it('modeLevel picks the water surface, not a bridge deck crossing it', () => {
    expect(modeLevel([-0.35, -0.35, 1.2, -0.35, null, 1.2, -0.36])).toBeCloseTo(-0.35, 6);
    expect(modeLevel([null, null])).toBeNull();
  });
});

describe('adaptProfile', () => {
  it('slices through terrain on the land sides and tops the water column at the water layer level', () => {
    const sides = defaultProfile(layout);
    const pts = samplePoints(sides);
    const terrain = pts.map((p) => (p.z < E.minZ + 1 && p.x < 20 ? 8 : null));
    const water = pts.map((p) => (isWater(layout, p.x, p.z) ? -0.5 : null));
    const out = adaptProfile(sides, terrain, water);
    const north = out[0]!.samples, south = out[2]!.samples;
    const mid = north.find((p) => Math.abs(p.x) < 0.5)!;
    expect(mid.ground).toBeCloseTo(8, 6);
    expect(mid.water).toBeNull();
    for (const p of south) { expect(p.water).toBeCloseTo(-0.5, 6); expect(p.ground).toBeLessThan(-2); }
    // a lone spike (a rock on the cut) is filtered out
    const spiky = pts.map((_, i) => (i === 40 ? 30 : null));
    const s2 = adaptProfile(sides, spiky, water);
    expect(Math.max(...s2.flatMap((s) => s.samples.map((p) => p.ground)))).toBeLessThan(1);
  });

  it('keeps the layout lake when the water layer has nothing on the cut', () => {
    const sides = defaultProfile(layout);
    const none = samplePoints(sides).map(() => null);
    const out = adaptProfile(sides, none, none);
    expect(out[2]!.samples.every((p) => p.water === BASE.waterLevel)).toBe(true);
  });
});

function triangles(g: THREE.BufferGeometry, fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): number {
  const pos = g.getAttribute('position'), idx = g.getIndex();
  const n = (idx ? idx.count : pos.count) / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const i = idx ? idx.getX(3 * t) : 3 * t, j = idx ? idx.getX(3 * t + 1) : 3 * t + 1, k = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    fn(a.fromBufferAttribute(pos, i), b.fromBufferAttribute(pos, j), c.fromBufferAttribute(pos, k));
  }
  return n;
}

describe('buildBaseGeometry', () => {
  const g = buildBaseGeometry(layout, defaultProfile(layout));
  it('fills the plinth footprint from the plinth bottom up, and stays cheap', () => {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    expect(bb.min.x).toBeCloseTo(E.minX - BASE.plinthOut, 1);
    expect(bb.max.x).toBeCloseTo(E.maxX + BASE.plinthOut, 1);
    expect(bb.min.z).toBeCloseTo(E.minZ - BASE.plinthOut, 1);
    expect(bb.max.z).toBeCloseTo(E.maxZ + BASE.plinthOut, 1);
    expect(bb.min.y).toBeCloseTo(BASE.bottom - BASE.plinthH, 3);
    expect(bb.max.y).toBeLessThan(0.5);
    const tris = triangles(g, () => {});
    expect(tris).toBeLessThan(40000);
    for (const name of ['position', 'normal', 'aKind', 'aTop']) expect(g.getAttribute(name)).toBeTruthy();
  });

  it('never rises over the board', () => {
    triangles(g, (a, b, c) => {
      for (const p of [a, b, c]) {
        if (p.x > B.minX + 0.01 && p.x < B.maxX - 0.01 && p.z > B.minZ + 0.01 && p.z < B.maxZ - 0.01) expect(p.y).toBeLessThan(0);
      }
    });
  });

  it('cut walls reach exactly the profile: water level on the lake sides, board level on the mountain sides', () => {
    const top = (pred: (p: THREE.Vector3) => boolean) => {
      let m = -Infinity;
      triangles(g, (a, b, c) => { for (const p of [a, b, c]) if (pred(p)) m = Math.max(m, p.y); });
      return m;
    };
    expect(top((p) => Math.abs(p.z - E.maxZ) < 1e-4 && Math.abs(p.x) < 3)).toBeCloseTo(BASE.waterLevel, 4);
    expect(top((p) => Math.abs(p.z - E.minZ) < 1e-4 && Math.abs(p.x) < 3)).toBeCloseTo(BASE.landY, 4);
  });
});

const empty = { t: 0, phase: 'running', vehicles: [], people: [], queues: [], events: [] } as unknown as SimSnapshot;
const camera = new THREE.OrthographicCamera(-80, 80, 50, -50, 1, 600);
camera.position.set(95, 85, 95);
camera.lookAt(0, 0, 0);
const ctx = (timeS: number, light: 'day' | 'dusk' = 'day'): FrameContext =>
  ({ prev: empty, next: empty, alpha: 1, simT: 0, dtS: 1 / 60, timeS, map: TOWN, camera, light, highlightedRoute: null });
const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; };
function maxWallY(layer: { object: THREE.Object3D }, pred: (x: number, z: number) => boolean): number {
  let m = -Infinity;
  for (const mesh of meshes(layer.object)) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pred(pos.getX(i), pos.getZ(i))) m = Math.max(m, pos.getY(i));
  }
  return m;
}

describe('createBaseLayer', () => {
  it('is one draw call that receives shadows', () => {
    const layer = createBaseLayer(TOWN, layout);
    expect(layer.name).toBe('base');
    const ms = meshes(layer.object);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.receiveShadow).toBe(true);
    layer.update(ctx(0));
    layer.setPalette?.('b');
    layer.setLight?.('dusk');
    layer.update(ctx(0.5, 'dusk'));
    layer.dispose();
  });

  it('re-cuts its walls to follow sibling terrain and water once they exist', () => {
    const world = new THREE.Group();
    const layer = createBaseLayer(TOWN, layout);
    world.add(layer.object);
    const terrain = new THREE.Group();
    terrain.name = 'terrain:test';
    const ridge = new THREE.Mesh(new THREE.PlaneGeometry(60, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    ridge.position.set(-20, 6, E.minZ + 5); // a 6 u plateau sliced by the north cut for x ∈ [−50, 10]
    terrain.add(ridge);
    const water = new THREE.Group();
    water.name = 'water:test';
    const lake = new THREE.Mesh(new THREE.PlaneGeometry(E.maxX - E.minX, 30).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    lake.position.set((E.minX + E.maxX) / 2, -0.6, E.maxZ - 15);
    water.add(lake);
    world.add(terrain, water);
    const onNorth = (x: number, z: number) => Math.abs(z - E.minZ) < 1e-3 && x > -40 && x < 0;
    const onSouth = (x: number, z: number) => Math.abs(z - E.maxZ) < 1e-3 && Math.abs(x) < 10;
    expect(maxWallY(layer, onNorth)).toBeLessThan(1);
    layer.update(ctx(0));
    expect(maxWallY(layer, onNorth)).toBeCloseTo(6, 3);
    expect(maxWallY(layer, onSouth)).toBeCloseTo(-0.6, 3);
    layer.dispose();
  });
});
