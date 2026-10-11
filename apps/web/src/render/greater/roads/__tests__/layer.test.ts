// Owner: G0. The greater-roads layer without Kenney models (procedural fallback): draw calls, face orientation,
// ground clipped to the shore, causeway embankments, palette swaps.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { isWater } from '../../grid';
import { createGreaterRoadsLayer } from '../layer';

describe('greater roads layer (fallback, no Kenney preload)', () => {
  const layer = createGreaterRoadsLayer(TOWN, { palette: 'a' });

  it('is at most 3 meshes (tiles, islands + embankments, ground)', () => {
    const meshes: THREE.Mesh[] = [];
    layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeLessThanOrEqual(3);
    expect(layer.kenney).toBe(false);
    expect(layer.roads.geometry.getIndex()!.count).toBeGreaterThan(1000);
  });

  it('road surfaces face up (no culled sidewalks / lanes)', () => {
    const geo = layer.roads.geometry, P = geo.getAttribute('position'), I = geo.getIndex()!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let flat = 0, down = 0;
    for (let t = 0; t < I.count; t += 3) {
      a.fromBufferAttribute(P, I.getX(t)); b.fromBufferAttribute(P, I.getX(t + 1)); c.fromBufferAttribute(P, I.getX(t + 2));
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.length() < 0.02) continue; // slivers where an inner kerb collapses on a 1×1 bend (fallback only)
      n.normalize();
      if (Math.abs(n.y) > 0.9) { flat++; if (n.y < 0) down++; }
    }
    expect(flat).toBeGreaterThan(100);
    expect(down).toBe(0);
  });

  it('draws ground only on land (none over the bay) and embankments under causeways', () => {
    const geo = layer.ground!.geometry, P = geo.getAttribute('position'), I = geo.getIndex()!;
    const g = layer.grid;
    for (let t = 0; t < I.count; t += 3) {
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) { x += P.getX(I.getX(t + k)) / 3; z += P.getZ(I.getX(t + k)) / 3; }
      expect(isWater(g, x, z), `ground tri at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
    }
    const isl = layer.islands.geometry;
    isl.computeBoundingBox();
    expect(isl.boundingBox!.min.y).toBeLessThan(-0.9);
  });

  it('recolours in place on palette change', () => {
    const col = layer.roads.geometry.getAttribute('color') as THREE.BufferAttribute;
    const before = Array.from(col.array.slice(0, 30));
    layer.setPalette!('b');
    expect(Array.from(col.array.slice(0, 30))).not.toEqual(before);
    layer.setPalette!('a');
    expect(Array.from(col.array.slice(0, 30))).toEqual(before);
  });
});
