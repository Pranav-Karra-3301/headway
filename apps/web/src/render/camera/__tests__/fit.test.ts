// C2 camera rig: framing math (art bible §1.4) against a real three.js OrthographicCamera.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import { worldLayout } from '../../world/layout';
import { CAMERA, ISO_ELEVATION_DEG, placeCamera, viewBasis, viewDir } from '../iso';
import {
  avoidCorners, boxPoints, clampTarget, ensureVisibleDelta, fitPoints, fitToSafeArea, fromScreen, hudSafeRect, insetsToRect,
  networkPoints, sanitizeRect, toScreen, type Rect,
} from '../fit';
import { omegaFor, SpringSet, stepSpring } from '../spring';
import { PRESETS, presetPoints } from '../presets';

const VP = { w: 1440, h: 900 };
const B = viewBasis();

/** A real camera framed by a fit; returns CSS px for world points (three's own projection). */
function cameraFor(fit: { zoom: number; target: { x: number; y: number; z: number } }, vp = VP, el = CAMERA.elevationDeg, az = CAMERA.azimuthDeg) {
  const h = CAMERA.viewH / 2, a = vp.w / vp.h;
  const cam = new THREE.OrthographicCamera(-h * a, h * a, h, -h, CAMERA.near, CAMERA.far);
  cam.zoom = fit.zoom;
  cam.updateProjectionMatrix();
  placeCamera(cam, fit.target, el, az);
  const px = (p: { x: number; y: number; z: number }) => {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
    return { x: ((v.x + 1) / 2) * vp.w, y: ((1 - v.y) / 2) * vp.h };
  };
  return { cam, px };
}

function screenBounds(px: (p: { x: number; y: number; z: number }) => { x: number; y: number }, pts: { x: number; y: number; z: number }[]): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { const s = px(p); r.x0 = Math.min(r.x0, s.x); r.x1 = Math.max(r.x1, s.x); r.y0 = Math.min(r.y0, s.y); r.y1 = Math.max(r.y1, s.y); }
  return r;
}

describe('iso angles (C1 recommendation)', () => {
  it('defaults to true iso 35.264° at azimuth 45°, looking from the south-east', () => {
    expect(CAMERA.elevationDeg).toBeCloseTo(35.264, 3);
    expect(ISO_ELEVATION_DEG).toBeCloseTo(35.26439, 4);
    expect(CAMERA.azimuthDeg).toBe(45);
    const d = viewDir();
    expect(d.x).toBeCloseTo(1 / Math.sqrt(3), 9);
    expect(d.y).toBeCloseTo(1 / Math.sqrt(3), 9);
    expect(d.z).toBeCloseTo(1 / Math.sqrt(3), 9);
  });

  it('matches three.js lookAt: basis is the camera matrix columns', () => {
    const { cam } = cameraFor({ zoom: 1, target: { x: 3, y: 0, z: -2 } });
    const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const U = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const D = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2);
    for (const [a, b] of [[R, B.right], [U, B.up], [D, B.dir]] as const) {
      expect(a.x).toBeCloseTo(b.x, 9); expect(a.y).toBeCloseTo(b.y, 9); expect(a.z).toBeCloseTo(b.z, 9);
    }
  });

  it('draws a straight E–W road as a 30° line on screen (bible check 1)', () => {
    const { px } = cameraFor({ zoom: 1, target: { x: 0, y: 0, z: 0 } });
    const a = px({ x: -10, y: 0, z: 0 }), b = px({ x: 10, y: 0, z: 0 });
    const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI;
    expect(deg).toBeCloseTo(30, 1);
    // east goes screen-right and down (the board's NW corner is the top of the screen, SE the bottom)
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe('safe rects', () => {
  it('builds the bible default rect: 14 px edges, below the top bar + 36 px', () => {
    expect(hudSafeRect(VP)).toEqual({ x0: 14, y0: 116, x1: 1426, y1: 886 });
    expect(hudSafeRect(VP, { inspectorLeft: 1094, dockTop: 740 })).toEqual({ x0: 14, y0: 116, x1: 1080, y1: 726 });
  });

  it('turns insets into a rect and ignores silly ones', () => {
    expect(insetsToRect(VP, { top: 116, left: 14, right: 14, bottom: 14 })).toEqual({ x0: 14, y0: 116, x1: 1426, y1: 886 });
    expect(insetsToRect(VP, { top: 800 })).toEqual({ x0: 0, y0: 0, x1: 1440, y1: 900 });
    expect(sanitizeRect(VP, { x0: 10, y0: 10, x1: 20, y1: 20 })).toEqual({ x0: 0, y0: 0, x1: 1440, y1: 900 });
    expect(sanitizeRect(VP, { x0: -50, y0: 100, x1: 2000, y1: 880 })).toEqual({ x0: 0, y0: 100, x1: 1440, y1: 880 });
  });
});

describe('fitPoints', () => {
  const pts = networkPoints(TOWN);

  it('samples the network inside the board (the west rail detour does not shrink Overview)', () => {
    const b = TOWN.bounds;
    expect(pts.length).toBeGreaterThan(200);
    for (const p of pts) { expect(p.x).toBeGreaterThanOrEqual(b.minX); expect(p.x).toBeLessThanOrEqual(b.maxX); expect(p.z).toBeGreaterThanOrEqual(b.minZ); expect(p.z).toBeLessThanOrEqual(b.maxZ); }
    for (const s of TOWN.stops) expect(pts.some((p) => p.x === s.p.x && p.z === s.p.z)).toBe(true);
    for (const s of TOWN.rail.stations) expect(pts.some((p) => p.x === s.platform.x && p.z === s.platform.z)).toBe(true);
    expect(networkPoints(TOWN, null).length).toBeGreaterThanOrEqual(pts.length);
  });

  for (const [name, safe] of [
    ['watch', hudSafeRect(VP)],
    ['play + inspector', hudSafeRect(VP, { inspectorLeft: VP.w - 14 - 332, dockTop: VP.h - 14 - 140 })],
    ['odd off-centre rect', { x0: 300, y0: 60, x1: 1200, y1: 700 }],
  ] as const) {
    it(`puts every network point inside the padded safe rect, centred, touching on one axis (${name})`, () => {
      const fit = fitPoints(B, pts, VP, safe);
      const { px } = cameraFor(fit);
      const got = screenBounds(px, pts);
      const padX = (safe.x1 - safe.x0) * CAMERA.pad, padY = (safe.y1 - safe.y0) * CAMERA.pad;
      expect(got.x0).toBeGreaterThanOrEqual(safe.x0 + padX - 0.5);
      expect(got.x1).toBeLessThanOrEqual(safe.x1 - padX + 0.5);
      expect(got.y0).toBeGreaterThanOrEqual(safe.y0 + padY - 0.5);
      expect(got.y1).toBeLessThanOrEqual(safe.y1 - padY + 0.5);
      // centred in the safe rect
      expect((got.x0 + got.x1) / 2).toBeCloseTo((safe.x0 + safe.x1) / 2, 3);
      expect((got.y0 + got.y1) / 2).toBeCloseTo((safe.y0 + safe.y1) / 2, 3);
      // tight: the binding axis fills the padded rect exactly
      const fillX = (got.x1 - got.x0) / ((safe.x1 - safe.x0) * (1 - 2 * CAMERA.pad));
      const fillY = (got.y1 - got.y0) / ((safe.y1 - safe.y0) * (1 - 2 * CAMERA.pad));
      expect(Math.max(fillX, fillY)).toBeCloseTo(1, 6);
      // target on the ground; px/u consistent with zoom
      expect(fit.target.y).toBeCloseTo(0, 9);
      expect(fit.pxPerUnit).toBeCloseTo((fit.zoom * VP.h) / CAMERA.viewH, 9);
      // toScreen agrees with three's projection
      for (const p of pts.slice(0, 20)) { const a = toScreen(B, fit.target, fit.pxPerUnit, VP, p), b = px(p); expect(a.x).toBeCloseTo(b.x, 6); expect(a.y).toBeCloseTo(b.y, 6); }
    });
  }

  it('frames the town large at 1440 × 900 (≈ 15 px/u for today\'s network; ≥ 12 with the inspector open)', () => {
    const watch = fitPoints(B, pts, VP, hudSafeRect(VP));
    const insp = fitPoints(B, pts, VP, hudSafeRect(VP, { inspectorLeft: VP.w - 14 - 332 }));
    expect(watch.pxPerUnit).toBeGreaterThan(14);
    expect(watch.pxPerUnit).toBeLessThan(20);
    expect(insp.pxPerUnit).toBeGreaterThan(12);
    expect(insp.pxPerUnit).toBeLessThan(watch.pxPerUnit);
  });

  it('agrees with the three.js entry point fitToSafeArea(cam, …)', () => {
    const safe = hudSafeRect(VP);
    const { cam } = cameraFor({ zoom: 1, target: { x: 5, y: 0, z: 5 } });
    const a = fitToSafeArea(cam, VP.w, VP.h, pts, safe), b = fitPoints(B, pts, VP, safe);
    expect(a.zoom).toBeCloseTo(b.zoom, 9);
    expect(a.target.x).toBeCloseTo(b.target.x, 6);
    expect(a.target.z).toBeCloseTo(b.target.z, 6);
  });

  it('is independent of the frustum height: zoom scales with viewH, px/u does not', () => {
    const safe = hudSafeRect(VP);
    const a = fitPoints(B, pts, VP, safe, 40), b = fitPoints(B, pts, VP, safe, 80);
    expect(b.zoom / a.zoom).toBeCloseTo(2, 9);
    expect(b.pxPerUnit).toBeCloseTo(a.pxPerUnit, 9);
  });

  it('handles a single point (focus) without blowing up', () => {
    const f = fitPoints(B, [{ x: 4, y: 0, z: 4 }], VP, hudSafeRect(VP));
    expect(Number.isFinite(f.zoom)).toBe(true);
    const s = toScreen(B, f.target, f.pxPerUnit, VP, { x: 4, y: 0, z: 4 });
    expect(s.x).toBeCloseTo(720, 6);
    expect(s.y).toBeCloseTo((116 + 886) / 2, 6);
  });

  it('works at other angles (peek at 25° / 65°)', () => {
    for (const az of [25, 65]) {
      const b = viewBasis(CAMERA.elevationDeg, az), safe = hudSafeRect(VP);
      const fit = fitPoints(b, pts, VP, safe);
      const got = screenBounds(cameraFor(fit, VP, CAMERA.elevationDeg, az).px, pts);
      expect(got.x0).toBeGreaterThan(safe.x0);
      expect(got.x1).toBeLessThan(safe.x1);
      expect(got.y0).toBeGreaterThan(safe.y0);
      expect(got.y1).toBeLessThan(safe.y1);
    }
  });
});

describe('corner panels', () => {
  it('zooms out 3 % at a time (≤ 5) while a stop sits under a corner panel', () => {
    const safe = hudSafeRect(VP), pts = networkPoints(TOWN);
    const fit = fitPoints(B, pts, VP, safe);
    const keep = TOWN.stops.map((s) => ({ x: s.p.x, y: 0, z: s.p.z }));
    const s0 = toScreen(B, fit.target, fit.pxPerUnit, VP, keep[0]!);
    const panel: Rect = { x0: s0.x - 10, y0: s0.y - 10, x1: s0.x + 10, y1: s0.y + 10 };
    const out = avoidCorners(B, fit, pts, keep, VP, safe, [panel]);
    expect(out.refits).toBeGreaterThanOrEqual(1);
    expect(out.refits).toBeLessThanOrEqual(5);
    expect(out.pxPerUnit).toBeCloseTo(fit.pxPerUnit * 0.97 ** out.refits, 9);
    // no panel → untouched
    expect(avoidCorners(B, fit, pts, keep, VP, safe, []).refits).toBe(0);
  });
});

describe('pan clamp', () => {
  const world = worldLayout(TOWN);
  const safe = hudSafeRect(VP);
  const fit = fitPoints(B, networkPoints(TOWN), VP, safe);

  it('leaves the Overview target alone (no void at Overview)', () => {
    const t = clampTarget(B, fit.target, fit.pxPerUnit, VP, safe, { extent: world.extent, board: world.board, zoomK: 1, home: fit.target });
    expect(t.x).toBeCloseTo(fit.target.x, 6);
    expect(t.z).toBeCloseTo(fit.target.z, 6);
    // a small pan away from Overview at Overview zoom springs back no further than home
    const back = clampTarget(B, { x: fit.target.x - 40, y: 0, z: fit.target.z + 40 }, fit.pxPerUnit, VP, safe, { extent: world.extent, board: world.board, zoomK: 1, home: fit.target });
    expect(Math.hypot(back.x - fit.target.x, back.z - fit.target.z)).toBeLessThan(40 * Math.SQRT2);
  });

  it('pulls a far pan back so the safe rect corners stay over the world extent', () => {
    const far = { x: fit.target.x + 200, y: 0, z: fit.target.z + 200 };
    const k = fit.pxPerUnit * 1.5;
    const t = clampTarget(B, far, k, VP, safe, { extent: world.extent, board: world.board, zoomK: 1.5, home: fit.target });
    const e = world.extent, m = CAMERA.extentInset;
    const bottom = [fromScreen(B, t, k, VP, safe.x0, safe.y1), fromScreen(B, t, k, VP, safe.x1, safe.y1)];
    const top = [fromScreen(B, t, k, VP, safe.x0, safe.y0, CAMERA.ridgeY), fromScreen(B, t, k, VP, safe.x1, safe.y0, CAMERA.ridgeY)];
    for (const c of [...bottom, ...top]) {
      expect(c.x).toBeGreaterThanOrEqual(e.minX + m - 1e-6); expect(c.x).toBeLessThanOrEqual(e.maxX - m + 1e-6);
      expect(c.z).toBeGreaterThanOrEqual(e.minZ + m - 1e-6); expect(c.z).toBeLessThanOrEqual(e.maxZ - m + 1e-6);
    }
  });

  it('below 0.85× Overview clamps the target to the board instead', () => {
    const t = clampTarget(B, { x: 500, y: 0, z: -500 }, fit.pxPerUnit * 0.8, VP, safe, { extent: world.extent, board: world.board, zoomK: 0.8 });
    expect(t).toEqual({ x: world.board.maxX, y: 0, z: world.board.minZ });
  });
});

describe('ensure visible / follow dead zone', () => {
  const safe = hudSafeRect(VP), fit = fitPoints(B, networkPoints(TOWN), VP, safe);

  it('does nothing for a point well inside', () => {
    expect(ensureVisibleDelta(B, fit.target, fit.pxPerUnit, VP, safe, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, z: 0 });
  });

  it('pans the minimum so the point ends 48 px inside the safe rect', () => {
    const k = fit.pxPerUnit * 3, p = { x: 30, y: 0, z: 20 };
    const d = ensureVisibleDelta(B, fit.target, k, VP, safe, p);
    const t = { x: fit.target.x + d.x, y: 0, z: fit.target.z + d.z };
    const s = toScreen(B, t, k, VP, p);
    expect(s.x).toBeGreaterThanOrEqual(safe.x0 + 48 - 1e-6); expect(s.x).toBeLessThanOrEqual(safe.x1 - 48 + 1e-6);
    expect(s.y).toBeGreaterThanOrEqual(safe.y0 + 48 - 1e-6); expect(s.y).toBeLessThanOrEqual(safe.y1 - 48 + 1e-6);
    const onEdge = Math.min(Math.abs(s.x - (safe.x0 + 48)), Math.abs(s.x - (safe.x1 - 48)), Math.abs(s.y - (safe.y0 + 48)), Math.abs(s.y - (safe.y1 - 48)));
    expect(onEdge).toBeLessThan(1e-6);
  });
});

describe('presets', () => {
  it('frames every preset box zoomed in from Overview, inside the safe rect', () => {
    const safe = hudSafeRect(VP), over = fitPoints(B, networkPoints(TOWN), VP, safe);
    for (const p of PRESETS) {
      const pts = presetPoints(TOWN, p.id), f = fitPoints(B, pts, VP, safe);
      const got = screenBounds(cameraFor(f).px, pts);
      expect(got.x0).toBeGreaterThan(safe.x0 - 0.5); expect(got.x1).toBeLessThan(safe.x1 + 0.5);
      expect(got.y0).toBeGreaterThan(safe.y0 - 0.5); expect(got.y1).toBeLessThan(safe.y1 + 0.5);
      const k = f.zoom / over.zoom;
      if (p.id === 'overview') expect(k).toBeCloseTo(1, 9);
      else { expect(k).toBeGreaterThan(1.5); expect(k).toBeLessThan(CAMERA.maxZoomK); }
    }
    expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length);
    expect(boxPoints({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }).length).toBe(8);
  });
});

describe('springs', () => {
  it('settles critically damped (no overshoot) within the settle time, frame-rate independent', () => {
    const settle = CAMERA.springS, w = omegaFor(settle);
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const s = { x: 0, v: 0 };
      let t = 0, max = 0;
      while (t < settle) { stepSpring(s, 1, w, dt); t += dt; max = Math.max(max, s.x); }
      expect(max).toBeLessThanOrEqual(1 + 1e-9);
      expect(s.x).toBeGreaterThan(0.985);
    }
    const a = { x: 0, v: 0 }, b = { x: 0, v: 0 };
    for (let i = 0; i < 30; i++) stepSpring(a, 1, w, 1 / 30);
    for (let i = 0; i < 144; i++) stepSpring(b, 1, w, 1 / 144);
    expect(a.x).toBeCloseTo(b.x, 9);
  });

  it('SpringSet moves keys together and reports settled', () => {
    const s = new SpringSet({ x: 0, z: 0 }, 0.5);
    s.start({ x: 0, z: 0 }, { x: 10, z: -4 });
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    expect(s.settled()).toBe(true);
    expect(s.value('x')).toBeCloseTo(10, 2);
  });
});
