// E2 water: Kenney watercraft (v5/v7 Kenney-first) replace the kit sail/motor boats once their models are loaded —
// still ONE merged boats mesh, bow along +x, sitting in the water — and the kit boats remain the fallback.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { _setKenneyTemplate, kenneyReady, type KenneyId } from '../../../assets/kenney';
import { worldLayout } from '../../layout';
import { bakeBoat, buildBoats, kenneyBoatId, WATER_KENNEY_IDS } from '../boats';
import { planWater, type Boat } from '../plan';

const plan = planWater(TOWN, worldLayout(TOWN));
const sail = plan.boats.find((b) => b.kind === 'sail')!;
const motor = plan.boats.find((b) => b.kind === 'motor')!;
const duck = plan.boats.find((b) => b.kind === 'duck')!;

/** A fake Kenney boat: a long box along +z (Kenney's facing), keel at y = 0, plus a "paint" part. */
function fakeTemplate(id: KenneyId) {
  const hull = new THREE.BoxGeometry(1.1, 0.7, 2.4).translate(0, 0.35, 0);
  const stripe = new THREE.BoxGeometry(1.12, 0.12, 2.0).translate(0, 0.5, 0);
  const part = (geometry: THREE.BufferGeometry, paint: boolean) => ({
    geometry, tris: geometry.index!.count / 3,
    info: { source: '#ffffff', role: paint ? 'knPaint' : 'trim', idx: 0, shade: 0, paint, side: THREE.FrontSide },
  });
  const box = new THREE.Box3(new THREE.Vector3(-0.56, 0, -1.2), new THREE.Vector3(0.56, 0.7, 1.2));
  return { id, parts: [part(hull, false), part(stripe, true)], box, size: box.getSize(new THREE.Vector3()), tris: 24 };
}
const sizeOf = (b: Boat) => {
  const g = bakeBoat(b, 'a').geometry;
  g.computeBoundingBox();
  return g.boundingBox!.clone();
};

describe('water boats', () => {
  it('names real watercraft-pack models for sail and motor boats only', () => {
    expect(WATER_KENNEY_IDS.length).toBeGreaterThan(2);
    for (const id of WATER_KENNEY_IDS) expect(id.startsWith('watercraft-pack/')).toBe(true);
    expect(kenneyBoatId(sail)).toMatch(/boat-sail/);
    expect(kenneyBoatId(motor)).not.toBeNull();
    expect(kenneyBoatId(duck)).toBeNull();
  });

  it('falls back to the kit boats while the models are not loaded', () => {
    for (const id of WATER_KENNEY_IDS) expect(kenneyReady(id)).toBe(false);
    const box = sizeOf(sail);
    expect(box.max.x - box.min.x).toBeGreaterThan(2); // kit sailboat: 2.4 u long along +x
    const boats = buildBoats(plan.boats, 'a', { value: 0 });
    expect(boats.mesh.geometry.getAttribute('aBoat').count).toBe(boats.mesh.geometry.getAttribute('position').count);
  });

  it('uses the Kenney model once loaded: bow along +x, keel under the waterline, deck above it', () => {
    for (const id of WATER_KENNEY_IDS) _setKenneyTemplate(id, fakeTemplate(id));
    for (const b of [sail, motor]) {
      const box = sizeOf(b);
      const len = box.max.x - box.min.x, beam = box.max.z - box.min.z;
      expect(len).toBeGreaterThan(beam * 1.5);
      expect(len).toBeLessThan(3.2);
      expect(box.min.y).toBeLessThan(-0.05);
      expect(box.min.y).toBeGreaterThan(-0.45);
      expect(box.max.y).toBeGreaterThan(0.2);
    }
  });

  it('rebuilds the single boats mesh in place when the models arrive (same mesh, same material)', () => {
    const boats = buildBoats(plan.boats, 'a', { value: 0 });
    const { mesh } = boats;
    const mat = mesh.material;
    const old = mesh.geometry;
    let disposed = false;
    old.addEventListener('dispose', () => { disposed = true; });
    boats.rebuild('a');
    expect(boats.mesh).toBe(mesh);
    expect(mesh.material).toBe(mat);
    expect(mesh.geometry).not.toBe(old);
    expect(disposed).toBe(true);
    const g = mesh.geometry;
    expect(g.getAttribute('aBoat').count).toBe(g.getAttribute('position').count);
    const ids = new Set(Array.from(g.getAttribute('aBoat').array as Float32Array));
    expect(ids.size).toBe(plan.boats.length);
  });
});
