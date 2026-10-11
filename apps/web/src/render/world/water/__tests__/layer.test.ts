// E2 water: the RenderLayer contract — cheap (draw calls), covers the lake, animates, eases to dusk, recolours, disposes.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import type { FrameContext } from '../../../layers';
import { worldLayout } from '../../layout';
import { createWaterLayer, WATER_LEVEL } from '../index';

const layout = worldLayout(TOWN);
const camera = new THREE.OrthographicCamera(-50, 50, 30, -30, 0.1, 2000);
camera.position.set(120, 100, 120);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const snap = { t: 0, vehicles: [], people: [], queues: [], events: [] } as unknown as SimSnapshot;
const ctx = (timeS: number, light: 'day' | 'dusk' = 'day', dtS = 1 / 60): FrameContext => ({
  prev: snap, next: snap, alpha: 1, simT: 0, dtS, timeS, map: TOWN, camera, light, highlightedRoute: null,
});
const drawables = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.visible) out.push(c as THREE.Mesh); });
  return out;
};

describe('water layer', () => {
  const layer = createWaterLayer(TOWN, layout);

  it('draws the whole lake (water, beach, props, boats) in at most 4 draw calls', () => {
    expect(layer.name).toBe('water');
    const meshes = drawables(layer.object);
    expect(meshes.length).toBeGreaterThanOrEqual(3);
    expect(meshes.length).toBeLessThanOrEqual(4);
    for (const m of meshes) expect(Array.isArray(m.material)).toBe(false);
  });

  it('lays the water at WATER_LEVEL out to the diorama edges on the south and east', () => {
    expect(WATER_LEVEL).toBeLessThan(-0.3);
    const water = layer.object.getObjectByName('water:surface') as THREE.Mesh;
    expect(water).toBeTruthy();
    water.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(water);
    expect(box.max.x).toBeCloseTo(layout.extent.maxX, 3);
    expect(box.max.z).toBeCloseTo(layout.extent.maxZ, 3);
    expect(box.min.x).toBeLessThanOrEqual(layout.extent.minX + 1e-3);
    expect(box.min.z).toBeLessThanOrEqual(layout.extent.minZ + 1e-3);
    expect(Math.abs(box.max.y - WATER_LEVEL)).toBeLessThan(0.1);
  });

  it('keeps every vertex off the playable board (nothing pokes up through the town)', () => {
    const b = TOWN.bounds, v = new THREE.Vector3();
    for (const m of drawables(layer.object)) {
      if (m.name === 'water:boats') continue; // boat vertices are boat-local; their poses are checked in plan tests
      m.updateMatrixWorld(true);
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.x < b.maxX - 0.7 && v.z < b.maxZ - 0.7) expect(v.y).toBeLessThan(0.0);
      }
    }
  });

  it('animates the water clock and the boats', () => {
    layer.update(ctx(1));
    const u = layer.uniforms;
    const t1 = u.uTime.value;
    const boat1 = u.uBoatPose.value[u.movingIndex].clone();
    layer.update(ctx(3));
    expect(u.uTime.value).toBeGreaterThan(t1);
    expect(u.uBoatPose.value[u.movingIndex].distanceTo(boat1)).toBeGreaterThan(0.05);
  });

  it('eases into dusk and back, following the frame light', () => {
    for (let i = 0; i < 10; i++) layer.update(ctx(4 + i / 60, 'dusk'));
    const mid = layer.uniforms.uDusk.value;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    for (let i = 0; i < 400; i++) layer.update(ctx(5 + i / 60, 'dusk'));
    expect(layer.uniforms.uDusk.value).toBeGreaterThan(0.99);
    layer.setLight?.('day');
    for (let i = 0; i < 400; i++) layer.update(ctx(12 + i / 60, 'day'));
    expect(layer.uniforms.uDusk.value).toBeLessThan(0.01);
  });

  it('recolours for a palette without rebuilding geometry', () => {
    const statics = layer.object.getObjectByName('water:statics') as THREE.Mesh;
    const geo = statics.geometry;
    const before = Float32Array.from(geo.getAttribute('color').array as Float32Array);
    const shallow = layer.uniforms.uShallow.value.clone();
    layer.setPalette?.('c');
    expect(statics.geometry).toBe(geo);
    const after = geo.getAttribute('color').array as Float32Array;
    let diff = 0;
    for (let i = 0; i < after.length; i++) diff += Math.abs(after[i]! - before[i]!);
    expect(diff).toBeGreaterThan(1);
    expect(layer.uniforms.uShallow.value.equals(shallow)).toBe(false);
    layer.setPalette?.('a');
  });

  it('disposes its geometries, materials and textures', () => {
    const l2 = createWaterLayer(TOWN, layout);
    let disposed = 0;
    l2.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.addEventListener('dispose', () => disposed++);
      (m.material as THREE.Material).addEventListener('dispose', () => disposed++);
    });
    l2.uniforms.uField.value.addEventListener('dispose', () => disposed++);
    l2.dispose();
    expect(disposed).toBeGreaterThanOrEqual(drawables(l2.object).length * 2 + 1);
  });
});
