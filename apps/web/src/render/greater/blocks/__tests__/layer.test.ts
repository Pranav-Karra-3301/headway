// Owner: G2. The outer-neighbourhood layer without Kenney models (kit fallbacks): draw-call budget, trees instanced,
// palette swaps recolour in place, highlight fade eases, everything sits on land.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { greaterGrid, isWater } from '../../grid';
import { createGreaterBlocksLayer } from '../layer';

describe('greater blocks layer (fallback, no Kenney preload)', () => {
  const layer = createGreaterBlocksLayer(TOWN, { palette: 'a' });
  const drawables: THREE.Object3D[] = [];
  layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) drawables.push(o); });

  it('stays within 20 draw calls', () => {
    expect(drawables.length).toBeLessThanOrEqual(20);
    expect(layer.stats.meshes).toBe(drawables.length);
    expect(layer.stats.items).toBe(layer.plan.items.length);
  });

  it('instances the trees (one InstancedMesh per kind × variant)', () => {
    const inst = drawables.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && o.name.startsWith('greater-blocks:trees'));
    expect(inst.length).toBeGreaterThan(4);
    const total = inst.reduce((n, o) => n + (o as THREE.InstancedMesh).count, 0);
    expect(total).toBe(layer.stats.trees);
    expect(total).toBeGreaterThan(100);
  });

  it('bakes statics and ground with geometry, wires between poles', () => {
    const statics = layer.object.getObjectByName('greater-blocks:statics') as THREE.Mesh;
    const ground = layer.object.getObjectByName('greater-blocks:ground') as THREE.Mesh;
    const wires = layer.object.getObjectByName('greater-blocks:wires') as THREE.LineSegments;
    expect(statics.geometry.getAttribute('position').count).toBeGreaterThan(5000);
    expect(ground.castShadow).toBe(false);
    expect(wires.geometry.getAttribute('position').count).toBeGreaterThan(100);
    // ground lots stay off the bay
    const g = greaterGrid(TOWN), P = ground.geometry.getAttribute('position');
    let wet = 0;
    for (let i = 0; i < P.count; i += 24) if (isWater(g, P.getX(i), P.getZ(i))) wet++;
    expect(wet).toBe(0);
  });

  it('recolours in place on palette swaps and eases the highlight fade', () => {
    const statics = layer.object.getObjectByName('greater-blocks:statics') as THREE.Mesh;
    const col = statics.geometry.getAttribute('color');
    const before = Array.from((col.array as Float32Array).slice(0, 300));
    layer.setPalette!('c');
    const after = Array.from((col.array as Float32Array).slice(0, 300));
    expect(after).not.toEqual(before);
    layer.setPalette!('a');
    layer.update({ dtS: 0.5, highlightedRoute: 'r1' });
    const mat = statics.material as THREE.Material & { fade: { value: number } };
    expect(mat.fade.value).toBeGreaterThan(0.4);
    layer.update({ dtS: 2, highlightedRoute: null });
    expect(mat.fade.value).toBeLessThan(0.01);
  });
});
