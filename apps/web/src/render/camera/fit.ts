// Owner: C2 (camera rig). Pure framing math for the orthographic game camera (art bible §1.4):
// fit a set of world points into a HUD-safe rect (CSS px, canvas-relative) with a margin, put their centre on the
// rect's centre, nudge zoom out when a stop lands under a corner panel, and clamp panning so no void shows.
// No DOM, no WebGL: everything works on an image-plane basis (iso.ts viewBasis), so it is unit-testable.
import * as THREE from 'three';
import { pointAt } from '@headway/sim';
import type { TownMap } from '@headway/sim';
import { CAMERA, viewBasis, type V3, type ViewBasis } from './iso';

/** CSS px, canvas-relative: x0/y0 top-left, x1/y1 bottom-right. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
/** World plan rectangle (x east, z south). */
export interface PlanRect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Viewport { w: number; h: number }

export interface FitResult {
  /** Camera zoom for a frustum `viewH` tall at zoom 1. */
  zoom: number;
  /** CSS px per world unit on the image plane. */
  pxPerUnit: number;
  /** Ground look-at point (y = 0). */
  target: V3;
}

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Safe rect from per-edge HUD insets; falls back to the whole canvas if what is left is < 30 % in either direction. */
export function insetsToRect(vp: Viewport, insets: Partial<Insets>): Rect {
  const c = (v: number | undefined) => (Number.isFinite(v) ? Math.max(0, v!) : 0);
  const t = c(insets.top), r = c(insets.right), b = c(insets.bottom), l = c(insets.left);
  if (vp.w - l - r < 0.3 * vp.w || vp.h - t - b < 0.3 * vp.h) return { x0: 0, y0: 0, x1: vp.w, y1: vp.h };
  return { x0: l, y0: t, x1: vp.w - r, y1: vp.h - b };
}

/**
 * The bible's HUD-safe rect: 14 px from the edges, below the top bar plus 36 px of queue-marker headroom; the open
 * inspector cuts the right side, the Play dock the bottom. Pass the live values when the HUD knows them.
 */
export function hudSafeRect(vp: Viewport, o: { top?: number; markers?: number; gap?: number; inspectorLeft?: number | null; dockTop?: number | null } = {}): Rect {
  const g = o.gap ?? CAMERA.hudGap;
  return {
    x0: g,
    y0: (o.top ?? CAMERA.hudTop) + (o.markers ?? CAMERA.hudMarkers),
    x1: o.inspectorLeft != null ? o.inspectorLeft - g : vp.w - g,
    y1: o.dockTop != null ? o.dockTop - g : vp.h - g,
  };
}

/** A safe rect that is too small or inverted becomes the whole canvas (tiny canvases, stale HUD numbers). */
export function sanitizeRect(vp: Viewport, r: Rect | null | undefined): Rect {
  if (!r || ![r.x0, r.y0, r.x1, r.y1].every(Number.isFinite)) return { x0: 0, y0: 0, x1: vp.w, y1: vp.h };
  const x0 = Math.max(0, Math.min(r.x0, vp.w)), x1 = Math.max(0, Math.min(r.x1, vp.w));
  const y0 = Math.max(0, Math.min(r.y0, vp.h)), y1 = Math.max(0, Math.min(r.y1, vp.h));
  if (x1 - x0 < 0.3 * vp.w || y1 - y0 < 0.3 * vp.h) return { x0: 0, y0: 0, x1: vp.w, y1: vp.h };
  return { x0, y0, x1, y1 };
}

const inside = (clip: PlanRect | null | undefined, p: { x: number; z: number }) =>
  !clip || (p.x >= clip.minX && p.x <= clip.maxX && p.z >= clip.minZ && p.z <= clip.maxZ);

/**
 * Overview points (bible §1.4): the rail loop every 2 u plus its vertices at y 0 and 2.6, every stop and platform at
 * y 0 and 2.2. `clip` (default: the board) drops loop samples outside it, so a rail detour through a mountain tunnel
 * beyond the board edge does not shrink the Overview (C1 finding). Pass `null` to keep everything.
 */
export function networkPoints(map: TownMap, clip: PlanRect | null = map.bounds): V3[] {
  const pts: V3[] = [];
  const loop = map.rail.loop;
  const add = (x: number, z: number, top: number) => { pts.push({ x, y: 0, z }, { x, y: top, z }); };
  for (let d = 0; d < loop.length; d += 2) { const p = pointAt(loop, d); if (inside(clip, p)) add(p.x, p.z, 2.6); }
  for (const p of loop.points) if (inside(clip, p)) add(p.x, p.z, 2.6);
  for (const s of map.stops) add(s.p.x, s.p.z, 2.2);
  for (const st of map.rail.stations) add(st.platform.x, st.platform.z, 2.2);
  return pts;
}

/** The 8 corners of a plan box from the ground up to `top` (presets, focus). */
export function boxPoints(b: PlanRect, top = 2): V3[] {
  const out: V3[] = [];
  for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) out.push({ x, y: 0, z }, { x, y: top, z });
  return out;
}

/** Image-plane bounds (world units) of points under a basis. */
export function imageBounds(basis: ViewBasis, points: readonly V3[]): { u0: number; u1: number; v0: number; v1: number } {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of points) {
    const u = dot(p, basis.right), v = dot(p, basis.up);
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  return { u0, u1, v0, v1 };
}

/** Ground point (y = 0) on the view ray through image-plane point (u, v). */
export function groundAt(basis: ViewBasis, u: number, v: number, y = 0): V3 {
  const { right: R, up: U, dir: D } = basis;
  const p = { x: R.x * u + U.x * v, y: R.y * u + U.y * v, z: R.z * u + U.z * v };
  const s = (y - p.y) / D.y;
  return { x: p.x + D.x * s, y, z: p.z + D.z * s };
}

/**
 * Zoom + ground target that put `points` inside `safe` shrunk by `pad` of its size per side, with the content's
 * centre on the safe rect's centre. Content smaller than `minSpan` world units is treated as `minSpan` wide.
 */
export function fitPoints(basis: ViewBasis, points: readonly V3[], vp: Viewport, safe: Rect, viewH: number = CAMERA.viewH, pad: number = CAMERA.pad, minSpan = 1): FitResult {
  const b = points.length ? imageBounds(basis, points) : { u0: -minSpan / 2, u1: minSpan / 2, v0: -minSpan / 2, v1: minSpan / 2 };
  const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
  const du = Math.max(b.u1 - b.u0, minSpan), dv = Math.max(b.v1 - b.v0, minSpan);
  const k = Math.min(((safe.x1 - safe.x0) * (1 - 2 * pad)) / du, ((safe.y1 - safe.y0) * (1 - 2 * pad)) / dv);
  return { zoom: (k * viewH) / vp.h, pxPerUnit: k, target: targetFor(basis, cu, cv, k, vp, safe) };
}

/** Ground target that puts image point (cu, cv) on the safe rect's centre at scale k (px/u). */
export function targetFor(basis: ViewBasis, cu: number, cv: number, k: number, vp: Viewport, safe: Rect): V3 {
  const u = cu - ((safe.x0 + safe.x1) / 2 - vp.w / 2) / k;
  const v = cv + ((safe.y0 + safe.y1) / 2 - vp.h / 2) / k;
  return groundAt(basis, u, v, 0);
}

/** CSS px of a world point for a camera looking at `target` with scale k (px/u). */
export function toScreen(basis: ViewBasis, target: V3, k: number, vp: Viewport, p: V3): { x: number; y: number } {
  const d = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z };
  return { x: vp.w / 2 + dot(d, basis.right) * k, y: vp.h / 2 - dot(d, basis.up) * k };
}

/** World point on the horizontal plane `y` under CSS pixel (sx, sy). */
export function fromScreen(basis: ViewBasis, target: V3, k: number, vp: Viewport, sx: number, sy: number, y = 0): V3 {
  const tu = dot(target, basis.right), tv = dot(target, basis.up);
  return groundAt(basis, tu + (sx - vp.w / 2) / k, tv - (sy - vp.h / 2) / k, y);
}

const inRect = (p: { x: number; y: number }, r: Rect) => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;

/**
 * Corner panels (legend, Watch card) are test-only exclusions (bible §1.4): after fitting, while any `keep` point
 * projects inside one, zoom out 3 % (around the safe rect's centre) and refit, up to 5 times.
 */
export function avoidCorners(basis: ViewBasis, fit: FitResult, points: readonly V3[], keep: readonly V3[], vp: Viewport, safe: Rect, corners: readonly Rect[], viewH: number = CAMERA.viewH): FitResult & { refits: number } {
  if (!corners.length || !keep.length) return { ...fit, refits: 0 };
  const b = imageBounds(basis, points);
  const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
  let out = fit, refits = 0;
  while (refits < 5 && keep.some((p) => { const s = toScreen(basis, out.target, out.pxPerUnit, vp, p); return corners.some((r) => inRect(s, r)); })) {
    const k = out.pxPerUnit * 0.97;
    out = { zoom: (k * viewH) / vp.h, pxPerUnit: k, target: targetFor(basis, cu, cv, k, vp, safe) };
    refits++;
  }
  return { ...out, refits };
}

/**
 * Pan clamp (bible §1.4). At ≥ `edgeClampK` × Overview the safe rect's corners, unprojected (bottom corners at y 0,
 * top corners at y `ridgeY`), stay inside the world extent shrunk by `extentInset`; below it the target stays on the
 * board. `home` (the Overview target) is always allowed. Returns the clamped ground target. Translating the target on the ground moves every unprojected point by the
 * same amount, so the clamp is a per-axis interval intersection.
 */
export function clampTarget(basis: ViewBasis, target: V3, k: number, vp: Viewport, safe: Rect, o: { extent?: PlanRect | null; board?: PlanRect | null; zoomK: number; home?: V3 | null }): V3 {
  if (o.zoomK < CAMERA.edgeClampK || !o.extent) {
    const b = o.board;
    if (!b) return { x: target.x, y: 0, z: target.z };
    return { x: Math.min(b.maxX, Math.max(b.minX, target.x)), y: 0, z: Math.min(b.maxZ, Math.max(b.minZ, target.z)) };
  }
  const e = o.extent, m = CAMERA.extentInset;
  const lim = { minX: e.minX + m, maxX: e.maxX - m, minZ: e.minZ + m, maxZ: e.maxZ - m };
  const corners = [
    fromScreen(basis, target, k, vp, safe.x0, safe.y0, CAMERA.ridgeY), fromScreen(basis, target, k, vp, safe.x1, safe.y0, CAMERA.ridgeY),
    fromScreen(basis, target, k, vp, safe.x0, safe.y1, 0), fromScreen(basis, target, k, vp, safe.x1, safe.y1, 0),
  ];
  // `home` (the Overview target) is always reachable: the fit never fights the clamp, even when the world is too
  // small for the viewport on an axis (then that axis stays at home).
  const axis = (vals: number[], lo: number, hi: number, home: number | null) => {
    let a = Math.max(...vals.map((v) => lo - v)), b = Math.min(...vals.map((v) => hi - v));
    if (home !== null) { if (a > b) a = b = home; else { a = Math.min(a, home); b = Math.max(b, home); } }
    return a > b ? (a + b) / 2 : Math.min(b, Math.max(a, 0));
  };
  const h = o.home ?? null;
  const dx = axis(corners.map((c) => c.x), lim.minX, lim.maxX, h ? h.x - target.x : null);
  const dz = axis(corners.map((c) => c.z), lim.minZ, lim.maxZ, h ? h.z - target.z : null);
  return { x: target.x + dx, y: 0, z: target.z + dz };
}

/**
 * Minimal pan (ground delta) that brings world point `p` at least `margin` px inside `safe`; {0,0} when it already is.
 * `margin` may be a fraction (< 1) of the rect's size instead of px (follow dead zone: 0.2 = inner 60 %).
 */
export function ensureVisibleDelta(basis: ViewBasis, target: V3, k: number, vp: Viewport, safe: Rect, p: V3, margin: number = CAMERA.ensureMarginPx): { x: number; z: number } {
  const mx = margin < 1 ? (safe.x1 - safe.x0) * margin : margin, my = margin < 1 ? (safe.y1 - safe.y0) * margin : margin;
  const r = { x0: safe.x0 + mx, x1: safe.x1 - mx, y0: safe.y0 + my, y1: safe.y1 - my };
  if (r.x0 > r.x1) { const c = (safe.x0 + safe.x1) / 2; r.x0 = r.x1 = c; }
  if (r.y0 > r.y1) { const c = (safe.y0 + safe.y1) / 2; r.y0 = r.y1 = c; }
  const s = toScreen(basis, target, k, vp, p);
  const ex = s.x < r.x0 ? s.x - r.x0 : s.x > r.x1 ? s.x - r.x1 : 0;
  const ey = s.y < r.y0 ? s.y - r.y0 : s.y > r.y1 ? s.y - r.y1 : 0;
  if (!ex && !ey) return { x: 0, z: 0 };
  // moving the target by image delta (ex/k right, -ey/k up), slid back to the ground
  const g = groundAt(basis, ex / k, -ey / k, 0);
  return { x: g.x, z: g.z };
}

/**
 * The bible's three.js entry point: zoom + ground target that put `points` into `safe` for `cam`'s current angle.
 * Does not move the camera. (CameraRig.fitToSafeArea uses the same math and applies it.)
 */
export function fitToSafeArea(cam: THREE.OrthographicCamera, cssW: number, cssH: number, points: readonly V3[], safe: Rect, pad: number = CAMERA.pad): FitResult {
  cam.updateMatrixWorld(true);
  const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const U = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  const D = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2);
  const basis: ViewBasis = { right: R, up: U, dir: D };
  return fitPoints(basis, points, { w: cssW, h: cssH }, safe, cam.top - cam.bottom, pad);
}

export { viewBasis };
