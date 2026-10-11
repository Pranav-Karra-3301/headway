// Owner: G1. The highway layer without Kenney models (primitive fallbacks): draw calls, face orientation, the
// overpass height, staying inside the band, palette + dusk glow.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { greaterGrid } from '../../grid';
import { createGreaterHighwayLayer } from '../layer';
import { HW } from '../plan';

describe('greater highway layer (fallback, no Kenney preload)', () => {
  const layer = createGreaterHighwayLayer(TOWN, { palette: 'a' });
  const g = greaterGrid(TOWN);

  it('is two merged meshes within budget', () => {
    const meshes: THREE.Mesh[] = [];
    layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(2);
    expect(layer.kenney).toBe(false);
    const tris = meshes.reduce((n, m) => n + m.geometry.getIndex()!.count / 3, 0);
    expect(tris).toBeGreaterThan(5000);
    expect(tris).toBeLessThan(200_000);
  });

  it('road surfaces face up and the carriageways climb onto the overpass', () => {
    const geo = layer.surface.geometry, P = geo.getAttribute('position'), I = geo.getIndex()!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let up = 0, down = 0;
    for (let t = 0; t < I.count; t += 3) {
      a.fromBufferAttribute(P, I.getX(t)); b.fromBufferAttribute(P, I.getX(t + 1)); c.fromBufferAttribute(P, I.getX(t + 2));
      const n = b.clone().sub(a).cross(c.clone().sub(a));
      if (n.length() < 1e-6) continue;
      n.normalize();
      if (n.y > 0.9) up++;
      if (n.y < -0.9) down++;
    }
    expect(up).toBeGreaterThan(1000);
    expect(down).toBe(0);
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y).toBeGreaterThan(HW.H);
    expect(geo.boundingBox!.max.y).toBeLessThan(HW.H + 0.2);
  });

  it('keeps the road surfaces inside the band and off the board; the deck has a soffit', () => {
    const plan = layer.plan;
    const P = layer.surface.geometry.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const z = P.getZ(i);
      expect(z).toBeGreaterThanOrEqual(plan.z0 - 1e-3);
      expect(z).toBeLessThanOrEqual(plan.z1 + 1e-3);
    }
    const S = layer.structures.geometry.getAttribute('position');
    for (let i = 0; i < S.count; i++) if (S.getX(i) >= g.bounds.minX) expect(S.getZ(i)).toBeLessThan(TOWN.bounds.minZ);
    const N = layer.structures.geometry.getAttribute('normal');
    let soffit = 0;
    for (let i = 0; i < N.count; i++) if (N.getY(i) < -0.99 && Math.abs(S.getY(i) - (HW.H - HW.deckT)) < 0.01) soffit++;
    expect(soffit).toBeGreaterThan(8);
  });

  it('recolours in place and glows only where lamps are (dusk)', () => {
    const col = layer.structures.geometry.getAttribute('color') as THREE.BufferAttribute;
    const before = Array.from(col.array.slice(0, 60));
    layer.setPalette!('c');
    expect(Array.from(col.array.slice(0, 60))).not.toEqual(before);
    layer.setPalette!('a');
    expect(Array.from(col.array.slice(0, 60))).toEqual(before);
    const glow = layer.surface.geometry.getAttribute('aGlow') as THREE.BufferAttribute;
    let lit = 0;
    for (let i = 0; i < glow.count; i++) if (glow.getX(i) > 0.01) lit++;
    expect(lit).toBeGreaterThan(50);
    expect(lit).toBeLessThan(glow.count / 4);
  });
});
