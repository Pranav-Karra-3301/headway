// Owner: G4. The traffic render layer: ≤ 4 draw calls, instance counts follow the model, beams only at dusk.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { shared } from '../../../materials';
import { createGreaterTrafficLayer } from '../layer';

describe('greater traffic layer', () => {
  it('draws every visible vehicle in ≤ 4 instanced meshes, beams only at dusk', () => {
    const layer = createGreaterTrafficLayer(TOWN, { kenney: false, seed: 4, warm: 60 });
    const meshes: THREE.InstancedMesh[] = [];
    layer.object.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.InstancedMesh); });
    expect(meshes.length).toBeLessThanOrEqual(4);
    expect(layer.vehicles).toBe('kit');
    shared.uDusk.value = 0;
    layer.tick(0.5);
    const beams = meshes.find((m) => m.name.endsWith('beams'))!;
    const cars = meshes.filter((m) => m !== beams);
    const visible = layer.model.cars.filter((c) => c.scale > 0.001).length;
    expect(cars.reduce((n, m) => n + m.count, 0)).toBe(visible);
    expect(visible).toBeGreaterThan(20);
    expect(beams.visible).toBe(false);
    shared.uDusk.value = 1;
    layer.tick(0.1);
    expect(beams.visible).toBe(true);
    expect(beams.count).toBe(layer.model.cars.filter((c) => c.scale > 0.001).length);
    shared.uDusk.value = 0;
    layer.setPalette?.('b');
    layer.tick(0.1);
    layer.dispose();
    expect(layer.object.children.length).toBe(0);
  });
});
