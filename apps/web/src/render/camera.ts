// Owner: T2.1. Orthographic isometric camera rig: pan + zoom only (no rotation), damping, zoom-to-cursor,
// target clamped to the board bounds. Built on OrbitControls with rotation disabled.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export interface CameraRigOptions {
  /** World units visible vertically at zoom 1 (default 34). */
  view?: number;
  /** Pan limits for the look-at target (default: unlimited). */
  bounds?: Bounds;
  target?: { x: number; z: number };
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Set false for a fixed camera (screenshots, scissored viewports). */
  interactive?: boolean;
}

/** Iso direction from target to camera: matches the kit sheet (70, 62, 70). */
export const ISO_DIR = new THREE.Vector3(70, 62, 70).normalize();
const DIST = 160;

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly controls: OrbitControls | null;
  view: number;
  bounds: Bounds | null;
  private width = 1;
  private height = 1;
  private goal: { x: number; z: number; zoom: number } | null = null;

  constructor(dom: HTMLElement, opts: CameraRigOptions = {}) {
    this.view = opts.view ?? 34;
    this.bounds = opts.bounds ?? null;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    this.camera.zoom = opts.zoom ?? 1;
    const t = opts.target ?? { x: 0, z: 0 };
    this.camera.position.set(t.x, 0, t.z).addScaledVector(ISO_DIR, DIST);
    this.camera.lookAt(t.x, 0, t.z);
    if (opts.interactive ?? true) {
      const c = new OrbitControls(this.camera, dom);
      c.target.set(t.x, 0, t.z);
      c.enableRotate = false;
      c.screenSpacePanning = true;
      c.zoomToCursor = true;
      c.enableDamping = true;
      c.dampingFactor = 0.12;
      c.zoomSpeed = 1.1;
      c.minZoom = opts.minZoom ?? 0.55;
      c.maxZoom = opts.maxZoom ?? 4.5;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      c.addEventListener('start', () => { this.goal = null; });
      this.controls = c;
    } else {
      this.controls = null;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Current look-at point on the ground. */
  get target(): THREE.Vector3 {
    return this.controls ? this.controls.target : new THREE.Vector3().copy(this.camera.position).addScaledVector(ISO_DIR, -DIST);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const a = this.width / this.height, v = this.view;
    Object.assign(this.camera, { left: (-v * a) / 2, right: (v * a) / 2, top: v / 2, bottom: -v / 2 });
    this.camera.updateProjectionMatrix();
  }

  /** Smoothly move the view to look at (x, z), optionally at a zoom. */
  focus(x: number, z: number, zoom?: number): void {
    this.goal = { x, z, zoom: zoom ?? this.camera.zoom };
  }

  /** Jump immediately (no easing). */
  set(x: number, z: number, zoom?: number): void {
    this.goal = null;
    this.moveTarget(x, z);
    if (zoom !== undefined) { this.camera.zoom = zoom; this.camera.updateProjectionMatrix(); }
  }

  /** Call once per frame. */
  update(dtS = 1 / 60): void {
    if (this.goal) {
      const k = 1 - Math.exp(-dtS * 6), t = this.target;
      this.moveTarget(t.x + (this.goal.x - t.x) * k, t.z + (this.goal.z - t.z) * k);
      this.camera.zoom += (this.goal.zoom - this.camera.zoom) * k;
      this.camera.updateProjectionMatrix();
      if (Math.abs(this.goal.x - t.x) + Math.abs(this.goal.z - t.z) < 0.01 && Math.abs(this.goal.zoom - this.camera.zoom) < 1e-3) this.goal = null;
    }
    this.controls?.update(dtS);
    this.clamp();
  }

  dispose(): void { this.controls?.dispose(); }

  private moveTarget(x: number, z: number): void {
    const t = this.target, dx = x - t.x, dz = z - t.z;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
    if (this.controls) { this.controls.target.x += dx; this.controls.target.z += dz; }
    else this.camera.lookAt(x, 0, z);
  }

  private clamp(): void {
    const t = this.target;
    if (this.controls && Math.abs(t.y) > 1e-6) {
      // Screen-space panning lifts the target off the ground; slide target + camera along the view ray
      // back to y = 0 (the orthographic image is unchanged).
      const k = t.y / ISO_DIR.y;
      t.addScaledVector(ISO_DIR, -k);
      this.camera.position.addScaledVector(ISO_DIR, -k);
    }
    const b = this.bounds;
    if (!b) return;
    const x = Math.min(b.maxX, Math.max(b.minX, t.x)), z = Math.min(b.maxZ, Math.max(b.minZ, t.z));
    if (x !== t.x || z !== t.z) this.moveTarget(x, z);
  }
}
