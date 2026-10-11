// Owner: E1. Terrain layer contract: cheap (≤ 5 draw calls, bounded triangles), forests and rocks only on land
// (never on the board, the lake or in front of a portal), portals baked in, palettes repaint in place, disposes.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { worldLayout } from '../../layout';
import { createTerrainField, WATER_LEVEL } from '../field';
import { createTerrainLayer } from '../index';

const layout = worldLayout(TOWN);
const field = createTerrainField(TOWN, layout);
const layer = createTerrainLayer(TOWN, layout);
const B = TOWN.bounds;

function drawables(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}
const tris = (m: THREE.Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
function positions(m: THREE.InstancedMesh): THREE.Vector3[] {
  const out: THREE.Vector3[] = [], m4 = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, m4); out.push(new THREE.Vector3().setFromMatrixPosition(m4)); }
  return out;
}
const byName = (n: string) => layer.object.getObjectByName(n) as THREE.Mesh;

describe('terrain layer', () => {
  it('is cheap: ≤ 5 draw calls, bounded triangles, instanced flora', () => {
    const ms = drawables(layer.object);
    expect(layer.name).toBe('terrain');
    expect(ms.length).toBeLessThanOrEqual(5);
    const static_ = ms.filter((m) => !(m as THREE.InstancedMesh).isInstancedMesh).reduce((a, m) => a + tris(m), 0);
    expect(static_).toBeLessThan(160_000);
    const pines = byName('terrain:pines') as THREE.InstancedMesh;
    expect(pines.isInstancedMesh).toBe(true);
    expect(pines.count).toBeGreaterThan(250);
    expect(tris(pines)).toBeLessThan(400);
    for (const m of ms) expect((m.material as THREE.Material).type).toBe('MeshStandardMaterial');
  });

  it('puts trees and rocks on land only: off the board, above the lake, clear of portals', () => {
    for (const name of ['terrain:pines', 'terrain:broadleaf', 'terrain:rocks']) {
      const m = byName(name) as THREE.InstancedMesh;
      for (const p of positions(m)) {
        const onBoard = p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ;
        expect(onBoard, `${name} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
        expect(field.region(p.x, p.z)).toBe(0);
        expect(field.height(p.x, p.z)).toBeGreaterThan(name === 'terrain:rocks' ? WATER_LEVEL - 0.5 : WATER_LEVEL + 0.5);
        for (const s of field.portals) {
          const rx = p.x - s.x, rz = p.z - s.z;
          const front = rx * s.face.x + rz * s.face.z, side = Math.abs(rx * s.face.z - rz * s.face.x);
          expect(front > -1 && front < 3 && side < s.half + 1.2, `${name} over portal ${s.id}`).toBe(false);
        }
      }
    }
  });

  it('bakes the portals into the terrain meshes (lamps glow at dusk)', () => {
    const mountains = byName('terrain:mountains');
    const glow = mountains.geometry.getAttribute('aGlow') as THREE.BufferAttribute;
    let lit = 0;
    for (let i = 0; i < glow.count; i++) if (glow.getX(i) + glow.getY(i) + glow.getZ(i) > 0.5) lit++;
    expect(lit).toBeGreaterThan(0);
    const spur = byName('terrain:railTunnel');
    expect(spur.userData.occluder).toBe('railTunnel');
    expect(tris(spur)).toBeGreaterThan(1000);
  });

  it('repaints in place on palette change and back', () => {
    const m = byName('terrain:mountains');
    const col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
    const before = Float32Array.from(col.array as Float32Array);
    layer.setPalette!('c');
    const after = col.array as Float32Array;
    let diff = 0;
    for (let i = 0; i < before.length; i += 97) diff += Math.abs(before[i]! - after[i]!);
    expect(diff).toBeGreaterThan(1);
    layer.setPalette!('a');
    for (let i = 0; i < before.length; i += 97) expect(after[i]).toBeCloseTo(before[i]!, 5);
  });

  it('is deterministic and disposes cleanly', () => {
    const again = createTerrainLayer(TOWN, layout);
    const a = byName('terrain:mountains').geometry.getAttribute('position').array as Float32Array;
    const b = (again.object.getObjectByName('terrain:mountains') as THREE.Mesh).geometry.getAttribute('position').array as Float32Array;
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i += 101) expect(b[i]).toBe(a[i]);
    expect(() => again.dispose()).not.toThrow();
  });
});
