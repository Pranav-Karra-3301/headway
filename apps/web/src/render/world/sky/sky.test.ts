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

describe('sky colours (bible §6.5)', () => {
  const ts = Array.from({ length: 41 }, (_, i) => -60 + i * 2.5);
  it.each(PALS)('palette %s by day: the lightest band sits on the horizon, deepening toward the top', (p) => {
    const day = mixSky(p, 0);
    const h = lum(skyAt(day, 0));
    for (const t of ts) expect(lum(skyAt(day, t))).toBeLessThanOrEqual(h + 1e-6);
    expect(lum(skyAt(day, 30))).toBeLessThan(h - 0.05);
    const bottom = srgb(skyAt(day, -60));
    expect(bottom.r + bottom.g + bottom.b).toBeGreaterThan(2.6); // pale haze around the base
  });

  it('palette A by day: mint above the horizon, the bible ridge colours', () => {
    const top = srgb(skyAt(mixSky('a', 0), 30));
    expect(top.g).toBeGreaterThan(top.r);
    expect(top.g).toBeGreaterThan(top.b);
    const want = ['#89b3a0', '#a2c5b5', '#bcd8ca'];
    mixSky('a', 0).ridges.forEach((c, i) => {
      const got = srgb(c), w = new THREE.Color(want[i]!).convertLinearToSRGB();
      expect(Math.abs(got.r - w.r) + Math.abs(got.g - w.g) + Math.abs(got.b - w.b)).toBeLessThan(0.02);
    });
  });

  it.each(PALS)('palette %s at dusk: indigo top → peach horizon, brightening down to the horizon', (p) => {
    const dusk = mixSky(p, 1);
    const top = skyAt(dusk, 30), horizon = skyAt(dusk, 0);
    expect(top.b).toBeGreaterThan(top.r);
    expect(lum(top)).toBeLessThan(0.05);
    expect(horizon.r).toBeGreaterThan(horizon.g);
    expect(horizon.g).toBeGreaterThan(horizon.b);
    let prev = -1;
    for (let t = 30; t >= 0; t -= 1) { const l = lum(skyAt(dusk, t)); expect(l).toBeGreaterThan(prev - 1e-6); prev = l; }
  });

  it('ridges haze progressively: each farther layer is closer to the sky', () => {
    for (const p of PALS) for (const k of [0, 1]) {
      const m = mixSky(p, k), haze = skyAt(m, -14);
      const dist = (c: THREE.Color) => Math.abs(c.r - haze.r) + Math.abs(c.g - haze.g) + Math.abs(c.b - haze.b);
      expect(dist(m.ridges[1])).toBeLessThan(dist(m.ridges[0]));
      expect(dist(m.ridges[2])).toBeLessThan(dist(m.ridges[1]));
    }
  });

  it('blends smoothly between day and dusk', () => {
    const a = skyAt(mixSky('a', 0), 30), b = skyAt(mixSky('a', 0.5), 30), c = skyAt(mixSky('a', 1), 30);
    expect(lum(b)).toBeLessThan(lum(a));
    expect(lum(b)).toBeGreaterThan(lum(c));
  });
});

/** Screen-up coordinate of a world point for the true-iso camera (looking down (−1, −1, −1)). */
const screenY = (x: number, y: number, z: number) => { const up = new THREE.Vector3(-1, 2, -1).normalize(); return up.x * x + up.y * y + up.z * z; };

describe('distant ridges', () => {
  it('has 2–3 layers, farther ones authored lower and flatter', () => {
    expect(RIDGE_LAYERS.length).toBeGreaterThanOrEqual(2);
    expect(RIDGE_LAYERS.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < RIDGE_LAYERS.length; i++) {
      const a = RIDGE_LAYERS[i - 1]!, b = RIDGE_LAYERS[i]!;
      expect(b.offset).toBeGreaterThan(a.offset);
      expect(b.base).toBeLessThanOrEqual(a.base);
      expect(b.amp).toBeLessThan(a.amp);
      expect(b.wave).toBeGreaterThan(a.wave);
    }
    expect(RIDGE_LAYERS[RIDGE_LAYERS.length - 1]!.trees).toBe(0); // no trees on the farthest
  });

  it('each farther layer still peeks above the nearer one on screen', () => {
    const bands = RIDGE_LAYERS.map((s) => ridgeBand(layout, s));
    const mean = (b: ReturnType<typeof ridgeBand>) => {
      const pts = b.filter((p) => p.nz === -1 && p.x > -40 && p.x < 40);
      return pts.reduce((a, p) => a + screenY(p.x, p.h, p.z), 0) / pts.length;
    };
    for (let i = 1; i < bands.length; i++) expect(mean(bands[i]!)).toBeGreaterThan(mean(bands[i - 1]!) + 2);
  });

  it.each(RIDGE_LAYERS.map((s, i) => [i, s] as const))('layer %i stays behind the mountain sides and tapers at both ends', (_i, spec) => {
    const band = ridgeBand(layout, spec);
    expect(band.length).toBeGreaterThan(100);
    for (const p of band) {
      expect(behindMountains(p.x, p.z, 0)).toBe(true);
      expect(outside(p.x, p.z)).toBeGreaterThan(spec.offset - 0.01);
      expect(outside(p.x, p.z)).toBeGreaterThan(BASE.plinthOut + 1);
      expect(p.h).toBeGreaterThanOrEqual(0);
      expect(p.h).toBeLessThanOrEqual(spec.base + spec.amp + 2);
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 5);
    }
    expect(band[0]!.h).toBeLessThan(spec.base * 0.3);
    expect(band[band.length - 1]!.h).toBeLessThan(spec.base * 0.3);
    expect(Math.max(...band.map((p) => p.h))).toBeGreaterThan(spec.base);
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
