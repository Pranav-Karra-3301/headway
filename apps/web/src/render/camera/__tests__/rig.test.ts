// C2 camera rig: the CameraRig class without a DOM (interactive: false) — Overview fit, refits, presets, focus,
// springs, peek, ensure-visible, follow and the pan clamp, checked through three.js's own projection.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { CameraRig } from '../rig';
import { CAMERA } from '../iso';
import { hudSafeRect, networkPoints, type Rect } from '../fit';
import { PRESETS, presetPoints } from '../presets';

const W = 1440, H = 900;

function rig(opts: ConstructorParameters<typeof CameraRig>[1] = {}) {
  const r = new CameraRig(null, { map: TOWN, interactive: false, ...opts });
  r.resize(W, H);
  return r;
}

/** CSS px through three's projection (the real camera, not the rig's own math). */
function px(r: CameraRig, p: { x: number; y: number; z: number }) {
  r.camera.updateMatrixWorld(true);
  const v = new THREE.Vector3(p.x, p.y, p.z).project(r.camera);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

function bounds(r: CameraRig, pts: { x: number; y: number; z: number }[]): Rect {
  const o = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { const s = px(r, p); o.x0 = Math.min(o.x0, s.x); o.x1 = Math.max(o.x1, s.x); o.y0 = Math.min(o.y0, s.y); o.y1 = Math.max(o.y1, s.y); }
  return o;
}

const run = (r: CameraRig, s: number, dt = 1 / 60) => { for (let t = 0; t < s; t += dt) r.update(dt); };
const within = (b: Rect, safe: Rect, tol = 0.75) => b.x0 >= safe.x0 - tol && b.x1 <= safe.x1 + tol && b.y0 >= safe.y0 - tol && b.y1 <= safe.y1 + tol;

describe('CameraRig', () => {
  it('starts at Overview: true iso, the network inside the default HUD-safe rect', () => {
    const r = rig();
    expect(r.mode).toBe('overview');
    expect(r.elevationDeg).toBeCloseTo(35.264, 3);
    expect(r.azimuthDeg).toBe(45);
    const d = r.viewDir;
    expect(d.x).toBeCloseTo(d.y, 9);
    expect(d.z).toBeCloseTo(d.y, 9);
    const safe = hudSafeRect({ w: W, h: H });
    expect(r.safeRect).toEqual(safe);
    expect(within(bounds(r, networkPoints(TOWN)), safe)).toBe(true);
    expect(r.zoomK).toBeCloseTo(1, 9);
    expect(r.camera.near).toBe(CAMERA.near);
    expect(r.camera.far).toBe(CAMERA.far);
    expect(r.camera.position.distanceTo(r.target)).toBeCloseTo(CAMERA.distance, 6);
  });

  it('fitToSafeArea(rect) frames the network inside any HUD rect and becomes the Overview', () => {
    const r = rig();
    const rect = { x0: 40, y0: 140, x1: W - 14 - 332 - 14, y1: H - 14 - 140 - 14 };
    const f = r.fitToSafeArea(rect);
    const b = bounds(r, networkPoints(TOWN));
    expect(within(b, rect)).toBe(true);
    expect((b.x0 + b.x1) / 2).toBeCloseTo((rect.x0 + rect.x1) / 2, 3);
    expect((b.y0 + b.y1) / 2).toBeCloseTo((rect.y0 + rect.y1) / 2, 3);
    expect(r.camera.zoom).toBeCloseTo(f.zoom, 9);
    expect(r.pxPerUnit).toBeCloseTo(f.pxPerUnit, 9);
    expect(r.mode).toBe('overview');
    expect(r.overviewZoom).toBeCloseTo(f.zoom, 9);
  });

  it('refits on resize while at Overview and keeps zoom limits at 0.8×–4× of the fit', () => {
    const r = rig();
    r.resize(1000, 700);
    const f = r.fitToSafeArea(null);
    expect(r.camera.zoom).toBeCloseTo(f.zoom, 9);
    r.resize(1600, 1000);
    const z = r.overviewZoom!;
    expect(r.camera.zoom).toBeCloseTo(z, 9);
    r.set(r.target.x, r.target.z, z * 100);
    expect(r.camera.zoom).toBeCloseTo(z * CAMERA.maxZoomK, 9);
    r.set(r.target.x, r.target.z, z * 0.01);
    expect(r.camera.zoom).toBeCloseTo(z * CAMERA.minZoomK, 9);
  });

  it('springs to a new safe rect when the inspector opens at Overview (no jump)', () => {
    const r = rig();
    r.update(1 / 60);
    const z0 = r.camera.zoom;
    const insp = hudSafeRect({ w: W, h: H }, { inspectorLeft: W - 14 - 332 });
    r.setSafeRect(insp);
    r.update(1 / 60);
    expect(r.camera.zoom).toBeLessThan(z0);
    expect(r.camera.zoom).toBeGreaterThan(r.overviewZoom! + 1e-4); // still easing
    run(r, 1.2);
    expect(r.moving).toBe(false);
    expect(within(bounds(r, networkPoints(TOWN)), insp)).toBe(true);
  });

  it('springs to each preset box and lands with it inside the safe rect, without overshoot', () => {
    for (const p of PRESETS) {
      const r = rig();
      r.update(1 / 60);
      const z0 = r.camera.zoom;
      r.preset(p.id);
      let maxZ = 0;
      for (let t = 0; t < 1.2; t += 1 / 60) { r.update(1 / 60); maxZ = Math.max(maxZ, r.camera.zoom); }
      expect(r.moving).toBe(false);
      expect(r.mode).toBe(p.id === 'overview' ? 'overview' : 'preset');
      expect(within(bounds(r, presetPoints(TOWN, p.id)), r.safeRect)).toBe(true);
      expect(maxZ).toBeLessThanOrEqual(r.camera.zoom + 1e-6);
      if (p.id !== 'overview') expect(r.camera.zoom).toBeGreaterThan(z0 * 1.5);
    }
  });

  it('settles a preset move in about the spring time (0.5–0.8 s, bible §1.5)', () => {
    const r = rig();
    r.update(1 / 60);
    r.preset('central');
    let t = 0;
    while (r.moving && t < 3) { r.update(1 / 60); t += 1 / 60; }
    expect(t).toBeGreaterThan(0.45);
    expect(t).toBeLessThan(0.85);
  });

  it('focusOn puts the entity on the safe-rect centre at ≥ 2.5× Overview', () => {
    const r = rig();
    r.update(1 / 60);
    const stop = TOWN.stops.find((s) => s.id === 'stop_downtown')!;
    const p = { x: stop.p.x, y: 0.4, z: stop.p.z };
    r.focusOn(p);
    run(r, 1.5);
    const s = px(r, p), safe = r.safeRect;
    expect(s.x).toBeCloseTo((safe.x0 + safe.x1) / 2, 1);
    expect(s.y).toBeCloseTo((safe.y0 + safe.y1) / 2, 1);
    expect(r.zoomK).toBeGreaterThanOrEqual(CAMERA.focusZoomK - 1e-6);
    expect(r.mode).toBe('focus');
  });

  it('peek swings the azimuth to 25° / 65° and springs back; the target never moves', () => {
    const r = rig();
    r.update(1 / 60);
    const t0 = r.target.clone();
    r.peek(-1);
    run(r, 1);
    expect(r.azimuthDeg).toBeCloseTo(25, 1);
    expect(r.camera.position.distanceTo(r.target)).toBeCloseTo(CAMERA.distance, 6);
    r.peek(1);
    run(r, 1);
    expect(r.azimuthDeg).toBeCloseTo(65, 1);
    r.peek(0);
    run(r, 1);
    expect(r.azimuthDeg).toBeCloseTo(45, 2);
    expect(r.target.distanceTo(t0)).toBeLessThan(1e-6);
    // the camera always looks at the target
    const fwd = r.camera.getWorldDirection(new THREE.Vector3());
    const toT = r.target.clone().sub(r.camera.position).normalize();
    expect(fwd.dot(toT)).toBeCloseTo(1, 9);
  });

  it('ensureVisible pans the minimum to keep a selection 48 px inside the safe rect', () => {
    const r = rig();
    r.set(-20, -10, r.overviewZoom! * 3);
    const p = { x: 25, y: 0.5, z: 8 };
    r.ensureVisible(p, 48, false);
    const s = px(r, p), safe = r.safeRect;
    expect(s.x).toBeGreaterThanOrEqual(safe.x0 + 48 - 0.01); expect(s.x).toBeLessThanOrEqual(safe.x1 - 48 + 0.01);
    expect(s.y).toBeGreaterThanOrEqual(safe.y0 + 48 - 0.01); expect(s.y).toBeLessThanOrEqual(safe.y1 - 48 + 0.01);
  });

  it('follow keeps a moving point inside the inner 60 % of the safe rect', () => {
    const r = rig();
    r.set(0, 0, r.overviewZoom! * 3);
    const p = { x: 0, y: 0.5, z: 0 };
    r.follow(() => p);
    for (let i = 0; i < 240; i++) { p.x += 0.08; r.update(1 / 60); }
    for (let i = 0; i < 60; i++) r.update(1 / 60); // catch up
    const s = px(r, p), safe = r.safeRect;
    const mx = (safe.x1 - safe.x0) * 0.2, my = (safe.y1 - safe.y0) * 0.2;
    expect(s.x).toBeGreaterThan(safe.x0 + mx - 2); expect(s.x).toBeLessThan(safe.x1 - mx + 2);
    expect(s.y).toBeGreaterThan(safe.y0 + my - 2); expect(s.y).toBeLessThan(safe.y1 - my + 2);
    r.follow(null);
  });

  it('clamps a wild pan back over the world (no void inside the safe rect when zoomed in)', () => {
    const r = rig();
    r.set(400, 400, r.overviewZoom! * 2);
    r.update(1 / 60);
    expect(Math.abs(r.target.x)).toBeLessThan(100);
    expect(Math.abs(r.target.z)).toBeLessThan(100);
    expect(r.target.y).toBeCloseTo(0, 9);
  });

  it('drives an adopted camera (dev pages, Stage) and stays a drop-in for the old rig API', () => {
    const cam = new THREE.OrthographicCamera();
    const r = new CameraRig(null, { map: TOWN, interactive: false, camera: cam });
    r.resize(W, H);
    expect(r.camera).toBe(cam);
    r.set(3, 4, 2);
    expect(r.target.x).toBeCloseTo(3, 9);
    expect(r.target.z).toBeCloseTo(4, 9);
    r.focus(-5, 6);
    run(r, 1.5);
    expect(r.target.x).toBeCloseTo(-5, 3);
    expect(r.target.z).toBeCloseTo(6, 3);
    // legacy: no map, bounds-only clamp
    const legacy = new CameraRig(null, { interactive: false, bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, view: 34 });
    legacy.resize(800, 600);
    legacy.set(50, -50);
    legacy.update(1 / 60);
    expect(legacy.target.x).toBeCloseTo(10, 9);
    expect(legacy.target.z).toBeCloseTo(-10, 9);
    legacy.dispose();
    r.dispose();
  });

  it('reports mode changes for the HUD (preset highlight)', () => {
    const r = rig();
    const seen: string[] = [];
    r.onModeChange = (m, p) => seen.push(p ? `${m}:${p}` : m);
    r.preset('stadium');
    r.focusOn({ x: 0, y: 0, z: 0 });
    r.overview();
    expect(seen).toEqual(['preset:stadium', 'focus', 'overview']);
  });
});
