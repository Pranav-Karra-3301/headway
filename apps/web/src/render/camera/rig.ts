// Owner: C2 (camera rig). The game camera: orthographic at C1's recommended angle (iso.ts CAMERA), framing the
// transit network into the HUD-safe rect, presets and focus with critically damped springs, Q/E peek, follow with
// a dead zone, ensure-visible, a pan clamp that never shows a void, and wheel/drag via OrbitControls (no rotation).
//
// Drop-in for render/camera.ts (same constructor, camera, controls, view, bounds, target, resize, focus, set, update,
// dispose), so Stage can switch its import to './camera/rig' and pass `map`:
//   const rig = new CameraRig(canvas, { map: TOWN });
//   rig.resize(w, h); rig.fitToSafeArea(hudRect);   // Overview; refits itself on resize while at Overview
//   rig.preset('stadium'); rig.focusOn({ x, y, z }); rig.peek(-1); rig.update(dtS) per frame
//   x-ray: xray.update(points, rig.viewDir, dtS)    (see xray.ts)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TownMap } from '@headway/sim';
import { worldLayout } from '../world/layout';
import { CAMERA, viewBasis, viewDir, type V3, type ViewBasis } from './iso';
import {
  avoidCorners, boxPoints, clampTarget, ensureVisibleDelta, fitPoints, fromScreen, hudSafeRect, networkPoints, sanitizeRect, targetFor, toScreen,
  type FitResult, type PlanRect, type Rect, type Viewport,
} from './fit';
import { PRESET_BY_ID, presetPoints, type PresetId } from './presets';
import { omegaFor, stepSpring, type Spring } from './spring';

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export interface CameraRigOptions {
  /** World units visible vertically at zoom 1 (default CAMERA.viewH). */
  view?: number;
  /** Legacy pan limit for the look-at target, used when no `map` is given. */
  bounds?: Bounds;
  target?: { x: number; z: number };
  zoom?: number;
  /** Absolute zoom limits until an Overview fit exists (then 0.8×–4× of it). */
  minZoom?: number;
  maxZoom?: number;
  /** false = fixed camera (screenshots, tests): no OrbitControls, no DOM listeners. */
  interactive?: boolean;
  /** The town: enables Overview (network fit), presets and the world-extent pan clamp. */
  map?: TownMap;
  elevationDeg?: number;
  azimuthDeg?: number;
  /** Drive an existing camera instead of creating one. */
  camera?: THREE.OrthographicCamera;
  /** Bind Q/E peek on this target (true = window). Off by default (the HUD may own keys). */
  keys?: boolean | Window | HTMLElement;
}

export type CameraMode = 'overview' | 'preset' | 'focus' | 'free';

export interface SafeAreaOptions {
  /** Corner panels (legend, Watch card): zoom out 3 % (≤ 5×) while a stop or platform lands under one. */
  corners?: Rect[];
  /** Spring to the new framing (default true once the first frame is drawn). */
  animate?: boolean;
}

type Goal = { x: number; z: number; zoom: number };

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly controls: OrbitControls | null;
  view: number;
  bounds: Bounds | null;
  /** Fixed elevation; azimuth eases while peeking. */
  readonly elevationDeg: number;
  readonly baseAzimuthDeg: number;
  mode: CameraMode = 'free';
  /** Called whenever the rig changes mode (HUD preset highlight). */
  onModeChange: ((m: CameraMode, preset: PresetId | null) => void) | null = null;

  private map: TownMap | null;
  private extent: PlanRect | null;
  private board: PlanRect | null;
  private overviewPts: V3[] = [];
  private keepPts: V3[] = [];
  private vp: Viewport = { w: 1, h: 1 };
  private safeIn: Rect | null = null;
  private corners: Rect[] = [];
  private overviewFit: FitResult | null = null;
  private presetId: PresetId | null = null;
  private goal: Goal | null = null;
  private readonly sx: Spring = { x: 0, v: 0 };
  private readonly sz: Spring = { x: 0, v: 0 };
  private readonly sLogZoom: Spring = { x: 0, v: 0 };
  private readonly sAz: Spring = { x: 0, v: 0 };
  private azGoal: number;
  private readonly omega = omegaFor(CAMERA.springS);
  private followGet: (() => V3 | null) | null = null;
  private drawn = false;
  private readonly tgt = new THREE.Vector3();
  private readonly dirV = new THREE.Vector3();
  private readonly keyTarget: Window | HTMLElement | null;
  private readonly onKeyDown = (e: Event) => this.key(e as KeyboardEvent, true);
  private readonly onKeyUp = (e: Event) => this.key(e as KeyboardEvent, false);
  private readonly onBlur = () => this.peek(0);

  constructor(dom: HTMLElement | null, opts: CameraRigOptions = {}) {
    this.view = opts.view ?? CAMERA.viewH;
    this.bounds = opts.bounds ?? null;
    this.elevationDeg = opts.elevationDeg ?? CAMERA.elevationDeg;
    this.baseAzimuthDeg = opts.azimuthDeg ?? CAMERA.azimuthDeg;
    this.azGoal = this.baseAzimuthDeg;
    this.sAz.x = this.baseAzimuthDeg;
    this.map = opts.map ?? null;
    if (this.map) {
      const w = worldLayout(this.map);
      this.extent = w.extent;
      this.board = w.board;
      this.overviewPts = networkPoints(this.map);
      this.keepPts = [...this.map.stops.map((s) => s.p), ...this.map.rail.stations.map((s) => s.platform)].map((p) => ({ x: p.x, y: 0, z: p.z }));
    } else {
      this.extent = null;
      this.board = this.bounds;
      if (this.bounds) this.overviewPts = boxPoints(this.bounds, 0);
    }

    this.camera = opts.camera ?? new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA.near, CAMERA.far);
    this.camera.near = CAMERA.near;
    this.camera.far = CAMERA.far;
    this.camera.zoom = opts.zoom ?? this.camera.zoom ?? 1;
    const t = opts.target ?? { x: 0, z: 0 };
    this.tgt.set(t.x, 0, t.z);
    this.placeAt(t.x, t.z);

    if ((opts.interactive ?? true) && dom) {
      const c = new OrbitControls(this.camera, dom);
      c.target.copy(this.tgt);
      c.enableRotate = false;
      c.screenSpacePanning = true;
      c.zoomToCursor = true;
      c.enableDamping = true;
      c.dampingFactor = 0.14;
      // OrbitControls: one wheel notch (|deltaY| ≈ 100) scales zoom by 0.95^zoomSpeed → ×1.1 per notch
      c.zoomSpeed = Math.log(CAMERA.wheelStep) / Math.log(1 / 0.95);
      c.minZoom = opts.minZoom ?? 0.3;
      c.maxZoom = opts.maxZoom ?? 6;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      c.addEventListener('start', () => this.userInput());
      this.controls = c;
    } else {
      this.controls = null;
    }
    this.minZoom = opts.minZoom ?? 0.3;
    this.maxZoom = opts.maxZoom ?? 6;

    const k = opts.keys;
    this.keyTarget = k === true ? (typeof window !== 'undefined' ? window : null) : k ? k : null;
    if (this.keyTarget) {
      this.keyTarget.addEventListener('keydown', this.onKeyDown);
      this.keyTarget.addEventListener('keyup', this.onKeyUp);
      if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
    }
    this.camera.updateProjectionMatrix();
  }

  private minZoom: number;
  private maxZoom: number;

  // ------------------------------------------------------------------ read-outs

  /** Current look-at point on the ground (live object while interactive; do not mutate). */
  get target(): THREE.Vector3 { return this.controls ? this.controls.target : this.tgt; }

  /** Current azimuth (eases while peeking). */
  get azimuthDeg(): number { return this.sAz.x; }

  /** Unit vector target → camera for the current angle (x-ray rays, picking). */
  get viewDir(): THREE.Vector3 { return viewDir(this.elevationDeg, this.sAz.x, this.dirV); }

  get basis(): ViewBasis { return viewBasis(this.elevationDeg, this.sAz.x); }

  /** CSS px per world unit at the current zoom. */
  get pxPerUnit(): number { return (this.camera.zoom * this.vp.h) / this.view; }

  /** The Overview zoom for the current viewport + safe rect (null before the first resize with a map/bounds). */
  get overviewZoom(): number | null { return this.overviewFit?.zoom ?? null; }

  /** Zoom relative to Overview (1 = Overview). */
  get zoomK(): number { return this.overviewFit ? this.camera.zoom / this.overviewFit.zoom : 1; }

  /** The preset being shown (null unless mode is 'preset'). */
  get activePreset(): PresetId | null { return this.presetId; }

  /** The safe rect in use (CSS px, canvas-relative). */
  get safeRect(): Rect { return sanitizeRect(this.vp, this.safeIn ?? hudSafeRect(this.vp)); }

  get viewport(): Viewport { return { ...this.vp }; }

  /** Is a spring move in flight? */
  get moving(): boolean { return this.goal !== null || Math.abs(this.sAz.x - this.azGoal) > 1e-3; }

  /** World → CSS px (canvas-relative). */
  project(p: V3): { x: number; y: number } {
    return toScreen(this.basis, this.target, this.pxPerUnit, this.vp, p);
  }

  /** CSS px → ground point (or a horizontal plane at `y`). */
  unproject(sx: number, sy: number, y = 0): V3 {
    return fromScreen(this.basis, this.target, this.pxPerUnit, this.vp, sx, sy, y);
  }

  // ------------------------------------------------------------------ layout

  resize(width: number, height: number): void {
    this.vp = { w: Math.max(1, width), h: Math.max(1, height) };
    const a = this.vp.w / this.vp.h, v = this.view;
    Object.assign(this.camera, { left: (-v * a) / 2, right: (v * a) / 2, top: v / 2, bottom: -v / 2 });
    this.camera.updateProjectionMatrix();
    this.refreshOverview();
    if (this.mode === 'overview' || (!this.drawn && this.mode === 'free' && this.overviewPts.length)) this.overview(false);
    else if (this.mode === 'preset' && this.presetId) this.preset(this.presetId, false);
  }

  /**
   * Tell the rig which part of the canvas the HUD leaves visible (CSS px, canvas-relative; null = bible default).
   * At Overview it refits (springing once drawn); elsewhere it only updates the zoom limits.
   */
  setSafeRect(rect: Rect | null, o: SafeAreaOptions = {}): void {
    this.safeIn = rect;
    if (o.corners) this.corners = o.corners;
    this.refreshOverview();
    if (this.mode === 'overview') this.overview(o.animate ?? this.drawn);
  }

  /**
   * Frame the transit network (Overview) inside `rect` (default: the current safe rect) with 4 % padding and make
   * it the Overview. Returns the fit (zoom, target, px/u).
   */
  fitToSafeArea(rect?: Rect | null, o: SafeAreaOptions = {}): FitResult {
    if (rect !== undefined) this.safeIn = rect;
    if (o.corners) this.corners = o.corners;
    this.refreshOverview();
    this.overview(o.animate ?? false);
    return this.overviewFit ?? { zoom: this.camera.zoom, pxPerUnit: this.pxPerUnit, target: { x: this.target.x, y: 0, z: this.target.z } };
  }

  /** Replace the Overview points (e.g. a different network or a beauty shot). */
  setOverviewPoints(points: V3[]): void {
    this.overviewPts = points;
    this.refreshOverview();
    if (this.mode === 'overview') this.overview(this.drawn);
  }

  private refreshOverview(): void {
    if (!this.overviewPts.length || this.vp.w <= 1) { this.overviewFit = null; return; }
    const basis = viewBasis(this.elevationDeg, this.baseAzimuthDeg), safe = this.safeRect;
    const fit = fitPoints(basis, this.overviewPts, this.vp, safe, this.view);
    this.overviewFit = avoidCorners(basis, fit, this.overviewPts, this.keepPts, this.vp, safe, this.corners, this.view);
    this.minZoom = this.overviewFit.zoom * CAMERA.minZoomK;
    this.maxZoom = this.overviewFit.zoom * CAMERA.maxZoomK;
    if (this.controls) { this.controls.minZoom = this.minZoom; this.controls.maxZoom = this.maxZoom; }
  }

  // ------------------------------------------------------------------ moves

  /** Overview: the network in the safe rect. */
  overview(animate = true): void {
    if (!this.overviewFit) return;
    this.setMode('overview', null);
    this.moveTo({ x: this.overviewFit.target.x, z: this.overviewFit.target.z, zoom: this.overviewFit.zoom }, animate);
  }

  /** Spring to a preset box (Stadium, Downtown hub, Campus, Central Station) or Overview. */
  preset(id: PresetId, animate = true): void {
    if (id === 'overview') { this.overview(animate); return; }
    if (!this.map || !PRESET_BY_ID.has(id)) return;
    const f = fitPoints(viewBasis(this.elevationDeg, this.baseAzimuthDeg), presetPoints(this.map, id), this.vp, this.safeRect, this.view);
    this.setMode('preset', id);
    this.moveTo({ x: f.target.x, z: f.target.z, zoom: f.zoom }, animate);
  }

  /** Frame any world box (plan rect, roofs up to `top`). */
  frameBox(box: PlanRect, top = 2, animate = true): void {
    const f = fitPoints(viewBasis(this.elevationDeg, this.baseAzimuthDeg), boxPoints(box, top), this.vp, this.safeRect, this.view);
    this.setMode('focus', null);
    this.moveTo({ x: f.target.x, z: f.target.z, zoom: f.zoom }, animate);
  }

  /** Focus (double-click / F): put `p` on the safe rect's centre at max(current, 2.5 × Overview) zoom. */
  focusOn(p: V3, o: { zoom?: number; animate?: boolean } = {}): void {
    const over = this.overviewFit?.zoom ?? this.camera.zoom;
    const want = o.zoom ?? Math.max(this.camera.zoom, over * CAMERA.focusZoomK);
    const zoom = THREE.MathUtils.clamp(want, this.minZoom, this.maxZoom);
    const k = (zoom * this.vp.h) / this.view;
    const b = viewBasis(this.elevationDeg, this.baseAzimuthDeg);
    const t = targetFor(b, p.x * b.right.x + p.y * b.right.y + p.z * b.right.z, p.x * b.up.x + p.y * b.up.y + p.z * b.up.z, k, this.vp, this.safeRect);
    this.setMode('focus', null);
    this.moveTo({ x: t.x, z: t.z, zoom }, o.animate ?? true);
  }

  /** Legacy: spring to look at (x, z), optionally at a zoom. */
  focus(x: number, z: number, zoom?: number): void {
    this.setMode('focus', null);
    this.moveTo({ x, z, zoom: zoom ?? this.camera.zoom }, true);
  }

  /** Legacy: jump immediately (no easing). */
  set(x: number, z: number, zoom?: number): void {
    this.setMode('free', null);
    this.moveTo({ x, z, zoom: zoom ?? this.camera.zoom }, false);
  }

  /** Pan the minimum so `p` sits ≥ 48 px inside the safe rect (selection in the inspector, off-screen alerts). */
  ensureVisible(p: V3, marginPx: number = CAMERA.ensureMarginPx, animate = true): void {
    const d = ensureVisibleDelta(this.basis, this.target, this.pxPerUnit, this.vp, this.safeRect, p, marginPx);
    if (!d.x && !d.z) return;
    if (this.mode === 'overview' || this.mode === 'preset') this.setMode('free', null);
    this.moveTo({ x: this.target.x + d.x, z: this.target.z + d.z, zoom: this.goal?.zoom ?? this.camera.zoom }, animate);
  }

  /** Follow a moving thing with a dead zone: pan only when it leaves the inner 60 % of the safe rect. null stops. */
  follow(get: (() => V3 | null) | null): void { this.followGet = get; }

  /** Hold-to-peek: -1 swings the azimuth to base − 20° (Q), +1 to base + 20° (E), 0 springs back. */
  peek(dir: -1 | 0 | 1): void { this.azGoal = this.baseAzimuthDeg + dir * CAMERA.peekDeg; }

  /** Set the azimuth goal directly (title-card drift); clamped to the south-east quadrant so mountains stay behind. */
  setAzimuth(deg: number, animate = true): void {
    this.azGoal = THREE.MathUtils.clamp(deg, 5, 85);
    if (!animate) { this.sAz.x = this.azGoal; this.sAz.v = 0; this.placeAt(this.target.x, this.target.z); }
  }

  /** Stop any spring (user input does this automatically). */
  cancel(): void { this.goal = null; }

  // ------------------------------------------------------------------ frame

  /** Call once per frame before rendering. */
  update(dtS = 1 / 60): void {
    const dt = Math.min(Math.max(dtS, 0), 0.1);
    this.drawn = true;
    // follow: dead zone, smooth pan
    if (this.followGet && !this.goal) {
      const p = this.followGet();
      if (p) {
        const d = ensureVisibleDelta(this.basis, this.target, this.pxPerUnit, this.vp, this.safeRect, p, (1 - CAMERA.followInner) / 2);
        if (d.x || d.z) { const k = 1 - Math.exp(-dt * 5); this.moveTarget(this.target.x + d.x * k, this.target.z + d.z * k); }
      }
    }
    if (this.goal) {
      const g = this.goal;
      stepSpring(this.sx, g.x, this.omega, dt);
      stepSpring(this.sz, g.z, this.omega, dt);
      stepSpring(this.sLogZoom, Math.log(g.zoom), this.omega, dt);
      this.moveTarget(this.sx.x, this.sz.x);
      this.setZoom(Math.exp(this.sLogZoom.x));
      const near = Math.abs(this.sx.x - g.x) + Math.abs(this.sz.x - g.z) < 0.02 && Math.abs(this.sLogZoom.x - Math.log(g.zoom)) < 1e-3;
      if (near) { this.moveTarget(g.x, g.z); this.setZoom(g.zoom); this.goal = null; }
    }
    if (Math.abs(this.sAz.x - this.azGoal) > 1e-4 || Math.abs(this.sAz.v) > 1e-4) {
      stepSpring(this.sAz, this.azGoal, this.omega * 1.3, dt);
      this.placeAt(this.target.x, this.target.z);
    }
    this.controls?.update(dt);
    this.groundTarget();
    if (!this.goal) this.clamp();
  }

  dispose(): void {
    this.controls?.dispose();
    if (this.keyTarget) {
      this.keyTarget.removeEventListener('keydown', this.onKeyDown);
      this.keyTarget.removeEventListener('keyup', this.onKeyUp);
      if (typeof window !== 'undefined') window.removeEventListener('blur', this.onBlur);
    }
  }

  // ------------------------------------------------------------------ internals

  private setMode(m: CameraMode, preset: PresetId | null): void {
    const changed = m !== this.mode || preset !== this.presetId;
    this.mode = m;
    this.presetId = preset;
    if (changed) this.onModeChange?.(m, preset);
  }

  private userInput(): void {
    this.goal = null;
    this.followGet = null;
    this.setMode('free', null);
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'q') this.peek(down ? -1 : 0);
    else if (k === 'e') this.peek(down ? 1 : 0);
  }

  private moveTo(g: Goal, animate: boolean): void {
    const zoom = THREE.MathUtils.clamp(g.zoom, this.minZoom, this.maxZoom);
    if (!animate) {
      this.goal = null;
      this.sx.v = this.sz.v = this.sLogZoom.v = 0;
      this.moveTarget(g.x, g.z);
      this.setZoom(zoom);
      return;
    }
    if (!this.goal) {
      // start from rest at the current view (velocities kept if a move was in flight)
      this.sx.x = this.target.x; this.sz.x = this.target.z; this.sLogZoom.x = Math.log(this.camera.zoom);
      this.sx.v = this.sz.v = this.sLogZoom.v = 0;
    }
    this.goal = { x: g.x, z: g.z, zoom };
  }

  private setZoom(z: number): void {
    const v = THREE.MathUtils.clamp(z, this.minZoom, this.maxZoom);
    if (v !== this.camera.zoom) { this.camera.zoom = v; this.camera.updateProjectionMatrix(); }
  }

  /** Position the camera for target (x, 0, z) at the current angle. */
  private placeAt(x: number, z: number): void {
    const d = viewDir(this.elevationDeg, this.sAz.x, this.dirV);
    this.camera.position.set(x + d.x * CAMERA.distance, d.y * CAMERA.distance, z + d.z * CAMERA.distance);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(x, 0, z);
    this.camera.updateMatrixWorld();
    if (this.controls) this.controls.target.set(x, 0, z); else this.tgt.set(x, 0, z);
  }

  private moveTarget(x: number, z: number): void { this.placeAt(x, z); }

  /** Screen-space panning / zoom-to-cursor lift the target off the ground: slide it back along the view ray. */
  private groundTarget(): void {
    const t = this.target;
    if (Math.abs(t.y) < 1e-6) return;
    const d = viewDir(this.elevationDeg, this.sAz.x, this.dirV);
    const k = t.y / d.y;
    t.addScaledVector(d, -k);
    this.camera.position.addScaledVector(d, -k);
    this.camera.updateMatrixWorld();
  }

  private clamp(): void {
    const t = this.target;
    let c: V3;
    if (this.map) {
      c = clampTarget(this.basis, { x: t.x, y: 0, z: t.z }, this.pxPerUnit, this.vp, this.safeRect, {
        extent: this.extent, board: this.board, zoomK: this.zoomK, home: this.overviewFit?.target ?? null,
      });
    } else {
      const b = this.bounds;
      if (!b) return;
      c = { x: Math.min(b.maxX, Math.max(b.minX, t.x)), y: 0, z: Math.min(b.maxZ, Math.max(b.minZ, t.z)) };
    }
    if (Math.abs(c.x - t.x) > 1e-6 || Math.abs(c.z - t.z) > 1e-6) this.moveTarget(c.x, c.z);
  }
}
