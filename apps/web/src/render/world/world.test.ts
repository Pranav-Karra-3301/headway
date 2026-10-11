// Owner: E4. World integration contract: the composed world layer stays cheap (≤ 15 draw calls), covers the board's
// rounded rim wherever terrain meets the board (no slab seam), leaves the beach sides to the water layer's sand lip,
// fades with the town when a route is highlighted, and retires the Stage's board drop shadow while it is mounted.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import type { FrameContext } from '../layers';
import { KitMaterial } from '../materials';
import { boardSeams, createWorldLayer, SEAM } from './index';
import { worldLayout } from './layout';
import { createTerrainField } from './terrain/index';

const B = TOWN.bounds;
const layout = worldLayout(TOWN);
const field = createTerrainField(TOWN, layout);
const land = (x: number, z: number) => field.region(x, z) === 0 && field.height(x, z) > -0.25;
const seams = boardSeams(TOWN.bounds, land);

/** Covered length of a board side by seam strips. */
function covered(side: 'north' | 'south' | 'east' | 'west'): number {
  return seams.filter((s) => s.side === side).reduce((a, s) => a + s.to - s.from, 0);
}

const snap = { t: 0, phase: 'running', vehicles: [], people: [], queues: [], events: [] } as unknown as SimSnapshot;
const ctx = (over: Partial<FrameContext> = {}): FrameContext => ({
  prev: snap, next: snap, alpha: 1, simT: 0, dtS: 1 / 60, timeS: 0, map: TOWN,
  camera: new THREE.OrthographicCamera(), light: 'day', highlightedRoute: null, ...over,
});

describe('board seams', () => {
  it('cover the mountain sides end to end', () => {
    expect(covered('north')).toBeGreaterThan(0.97 * (B.maxX - B.minX));
    expect(covered('west')).toBeGreaterThan(0.97 * (B.maxZ - B.minZ));
  });
  it('leave the beach sides to the sand lip (only the headland ends are terrain)', () => {
    expect(covered('south')).toBeLessThan(0.3 * (B.maxX - B.minX));
    expect(covered('east')).toBeLessThan(0.3 * (B.maxZ - B.minZ));
  });
  it('span the rounded rim: from inside the slab to just past its edge', () => {
    expect(SEAM.inside).toBeGreaterThanOrEqual(0.5); // makeBoard rounds its top edge with r = 0.5
    expect(SEAM.outside).toBeLessThan(0.2); // never over the road/rail approaches beyond the edge
    expect(SEAM.y).toBeGreaterThan(0);
    expect(SEAM.y).toBeLessThan(0.02); // under roads (0.04), rail ballast and lawns
  });
});

describe('world layer', () => {
  const world = createWorldLayer(TOWN);
  const meshes: THREE.Mesh[] = [];
  world.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

  it('composes base, terrain, water, sky and the seam in ≤ 15 draw calls', () => {
    const names = world.object.children.map((c) => c.name);
    for (const n of ['base', 'terrain', 'water', 'sky', 'world:seam']) expect(names).toContain(n);
    expect(meshes.length).toBeLessThanOrEqual(15);
  });

  it('fades with the town on highlight (ground 0.3 like the board, trees 0.6) and back', () => {
    const seam = world.object.getObjectByName('world:seam') as THREE.Mesh;
    const seamMat = seam.material as KitMaterial;
    const trees = meshes.map((m) => m.material).find((m): m is KitMaterial => m instanceof KitMaterial && m.sway);
    for (let i = 0; i < 240; i++) world.update(ctx({ highlightedRoute: 'r1', dtS: 1 / 30, timeS: i / 30 }));
    expect(seamMat.fade.value).toBeCloseTo(0.3, 2);
    expect(trees?.fade.value ?? 0.6).toBeCloseTo(0.6, 2);
    for (let i = 0; i < 240; i++) world.update(ctx({ dtS: 1 / 30, timeS: 8 + i / 30 }));
    expect(seamMat.fade.value).toBeLessThan(0.002);
  });

  it('retires the board drop shadow while mounted and restores it on dispose', () => {
    const scene = new THREE.Scene();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    shadow.name = 'boardDropShadow';
    scene.add(shadow, world.object);
    world.update(ctx({ timeS: 20 }));
    expect(shadow.visible).toBe(false);
    world.dispose();
    expect(shadow.visible).toBe(true);
  });
});
