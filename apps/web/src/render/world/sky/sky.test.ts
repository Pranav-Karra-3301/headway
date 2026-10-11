// Owner: E3. Sky: gradient looks per palette, distant ridge bands + clouds only ever sit behind the mountain sides
// (never over the board or the water), and the layer contract (≤ 2 draw calls, day ↔ dusk, palettes, no picks).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import type { FrameContext } from '../../layers';
import { PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { BASE } from '../base/profile';
import { worldLayout } from '../layout';
import { mixSky, skyAt } from './colors';
import { cloudOffset, cloudSpecs } from './clouds';
import { createSkyLayer } from './index';
import { RIDGE_LAYERS, ridgeBand } from './ridges';

const layout = worldLayout(TOWN);
const E = layout.extent;
const PALS: PaletteId[] = ['a', 'b', 'c'];
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const srgb = (c: THREE.Color) => c.clone().convertLinearToSRGB();

/** Behind the mountains as seen from the default camera: beyond the north or west edge, never off the water sides. */
function behindMountains(x: number, z: number, margin: number): boolean {
  const north = z < E.minZ - margin;
  const west = x < E.minX - margin;
  return north || west;
}
/** Distance from a point to the diorama extent rectangle (0 inside). */
function outside(x: number, z: number): number {
  return Math.hypot(Math.max(E.minX - x, 0, x - E.maxX), Math.max(E.minZ - z, 0, z - E.maxZ));
}

describe('sky colours', () => {
  it.each(PALS)('palette %s: day mint → cream with the palette background in the middle', (p) => {
    const day = mixSky(p, 0);
    const mid = srgb(skyAt(day, 0.5));
    const bg = new THREE.Color(PALETTES[p].bg);
    expect(Math.abs(mid.r - srgb(bg).r) + Math.abs(mid.g - srgb(bg).g) + Math.abs(mid.b - srgb(bg).b)).toBeLessThan(0.09);
    const top = srgb(skyAt(day, 1)), bottom = srgb(skyAt(day, 0));
    expect(bottom.r).toBeGreaterThan(bottom.b); // warm cream at the bottom
    expect(top.b - top.r).toBeGreaterThan(bottom.b - bottom.r); // cooler at the top
  });

  it.each(PALS)('palette %s: dusk indigo → peach, brightening toward the bottom', (p) => {
    const dusk = mixSky(p, 1);
    const top = skyAt(dusk, 1), bottom = skyAt(dusk, 0);
    expect(top.b).toBeGreaterThan(top.r);
    expect(lum(top)).toBeLessThan(0.05);
    expect(bottom.r).toBeGreaterThan(bottom.g);
    expect(bottom.g).toBeGreaterThan(bottom.b);
    let prev = -1;
    for (let t = 1; t >= 0; t -= 0.1) { const l = lum(skyAt(dusk, t)); expect(l).toBeGreaterThan(prev - 1e-6); prev = l; }
  });

  it('blends smoothly between day and dusk', () => {
    const a = skyAt(mixSky('a', 0), 1), b = skyAt(mixSky('a', 0.5), 1), c = skyAt(mixSky('a', 1), 1);
    expect(lum(b)).toBeLessThan(lum(a));
    expect(lum(b)).toBeGreaterThan(lum(c));
  });
});

describe('distant ridges', () => {
  it('has 2–3 layers, farther ones taller and hazier', () => {
    expect(RIDGE_LAYERS.length).toBeGreaterThanOrEqual(2);
    expect(RIDGE_LAYERS.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < RIDGE_LAYERS.length; i++) {
      const a = RIDGE_LAYERS[i - 1]!, b = RIDGE_LAYERS[i]!;
      expect(b.offset).toBeGreaterThan(a.offset);
      expect(b.peak[1]).toBeGreaterThan(a.peak[1]);
      expect(b.aerial).toBeGreaterThan(a.aerial);
    }
  });

  it.each(RIDGE_LAYERS.map((s, i) => [i, s] as const))('layer %i stays behind the mountain sides and tapers at both ends', (_i, spec) => {
    const band = ridgeBand(layout, spec);
    expect(band.length).toBeGreaterThan(20);
    for (const p of band) {
      // the whole slope (crest + front foot toward the diorama) stays outside the diorama and its plinth
      const fx = p.x - p.nx * spec.run, fz = p.z - p.nz * spec.run;
      expect(behindMountains(p.x, p.z, 0)).toBe(true);
      expect(outside(p.x, p.z)).toBeGreaterThan(spec.offset - 0.01);
      expect(behindMountains(fx, fz, 0)).toBe(true);
      expect(outside(fx, fz)).toBeGreaterThan(BASE.plinthOut + 0.5);
      expect(p.h).toBeGreaterThanOrEqual(0);
      expect(p.h).toBeLessThanOrEqual(spec.peak[1] + 1e-6);
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 5);
    }
    expect(band[0]!.h).toBeLessThan(spec.peak[0] * 0.3);
    expect(band[band.length - 1]!.h).toBeLessThan(spec.peak[0] * 0.3);
    expect(Math.max(...band.map((p) => p.h))).toBeGreaterThan(spec.peak[0]);
    // covers the whole back of the diorama: from past the NE corner to past the SW corner
    expect(Math.max(...band.map((p) => p.x))).toBeGreaterThan(E.maxX);
    expect(Math.max(...band.map((p) => p.z))).toBeGreaterThan(E.maxZ);
  });

  it('is deterministic', () => {
    expect(ridgeBand(layout, RIDGE_LAYERS[0]!)).toEqual(ridgeBand(layout, RIDGE_LAYERS[0]!));
  });
});

describe('clouds', () => {
  const clouds = cloudSpecs(layout);
  it('a few clouds, high up behind the mountains', () => {
    expect(clouds.length).toBeGreaterThanOrEqual(4);
    expect(clouds.length).toBeLessThanOrEqual(9);
    for (const c of clouds) {
      expect(behindMountains(c.x, c.z, 4)).toBe(true);
      expect(c.y).toBeGreaterThanOrEqual(20);
      expect(c.y).toBeLessThanOrEqual(50);
    }
  });

  it('rests at their authored spot at t = 0 and drift slowly without ever crossing over the diorama', () => {
    for (const c of clouds) {
      const o = cloudOffset(c, 0);
      expect(Math.hypot(o.dx, o.dz)).toBeLessThan(1e-6);
      expect(o.grow).toBeCloseTo(1, 5);
      const o1 = cloudOffset(c, 1);
      expect(Math.hypot(o1.dx, o1.dz)).toBeLessThan(1); // slow: < 1 u/s
      for (let t = 0; t < 4000; t += 7) {
        const d = cloudOffset(c, t);
        expect(behindMountains(c.x + d.dx, c.z + d.dz, c.size * 0.5)).toBe(true);
        expect(d.grow).toBeGreaterThanOrEqual(0);
        expect(d.grow).toBeLessThanOrEqual(1);
      }
    }
  });
});

const empty = { t: 0, phase: 'running', vehicles: [], people: [], queues: [], events: [] } as unknown as SimSnapshot;
function ctx(camera: THREE.Camera, timeS: number, dtS = 1 / 60, light: 'day' | 'dusk' = 'day'): FrameContext {
  return { prev: empty, next: empty, alpha: 1, simT: 0, dtS, timeS, map: TOWN, camera, light, highlightedRoute: null };
}
function isoCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-80, 80, 50, -50, 1, 600);
  cam.position.set(95, 85, 95);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}
const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse((c) => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); }); return out; };
function uniformColor(o: THREE.Object3D, name: string): THREE.Color {
  for (const m of meshes(o)) {
    const u = (m.material as THREE.ShaderMaterial).uniforms?.[name];
    if (u) return (u.value as THREE.Color).clone();
  }
  throw new Error('no uniform ' + name);
}

describe('createSkyLayer', () => {
  it('is cheap: at most 2 draw calls, nothing casts shadows', () => {
    const layer = createSkyLayer(TOWN, layout);
    expect(layer.name).toBe('sky');
    const ms = meshes(layer.object);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.length).toBeLessThanOrEqual(2);
    for (const m of ms) expect(m.castShadow).toBe(false);
    layer.dispose();
  });

  it('never catches picks (the screen-space backdrop is not a real quad at the origin)', () => {
    const layer = createSkyLayer(TOWN, layout);
    const cam = isoCamera();
    layer.update(ctx(cam, 0));
    layer.object.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    for (const [x, y] of [[0, 0], [0.5, 0.8], [-0.7, 0.9], [0.2, -0.3]] as const) {
      rc.setFromCamera(new THREE.Vector2(x, y), cam);
      expect(rc.intersectObject(layer.object, true)).toHaveLength(0);
    }
    layer.dispose();
  });

  it('eases to dusk and back, and follows ctx.light even without setLight', () => {
    const layer = createSkyLayer(TOWN, layout);
    const cam = isoCamera();
    layer.update(ctx(cam, 0));
    const day = uniformColor(layer.object, 'uSky0');
    layer.setLight?.('dusk');
    for (let i = 0; i < 4; i++) layer.update(ctx(cam, i * 0.1, 0.1, 'dusk'));
    const between = uniformColor(layer.object, 'uSky0');
    for (let i = 0; i < 120; i++) layer.update(ctx(cam, 1 + i * 0.1, 0.1, 'dusk'));
    const dusk = uniformColor(layer.object, 'uSky0');
    expect(lum(between)).toBeLessThan(lum(day));
    expect(lum(dusk)).toBeLessThan(lum(between));
    expect(dusk.getHexString()).toBe(mixSky('a', 1).stops[0].getHexString());
    for (let i = 0; i < 120; i++) layer.update(ctx(cam, 20 + i * 0.1, 0.1, 'day'));
    expect(uniformColor(layer.object, 'uSky0').getHexString()).toBe(day.getHexString());
    layer.dispose();
  });

  it('starts at dusk without easing when created for dusk', () => {
    const layer = createSkyLayer(TOWN, layout);
    layer.setLight?.('dusk');
    layer.update(ctx(isoCamera(), 0, 1 / 60, 'dusk'));
    expect(uniformColor(layer.object, 'uSky0').getHexString()).toBe(mixSky('a', 1).stops[0].getHexString());
    layer.dispose();
  });

  it('switches palettes', () => {
    const layer = createSkyLayer(TOWN, layout);
    const cam = isoCamera();
    layer.update(ctx(cam, 0));
    layer.setPalette?.('c');
    layer.update(ctx(cam, 0.016));
    expect(uniformColor(layer.object, 'uSky3').getHexString()).toBe(mixSky('c', 0).stops[3].getHexString());
    layer.dispose();
  });
});
