// Owner: T2.1. Stage = everything around the town: WebGLRenderer (shadows, tone mapping), scene, iso camera rig,
// lights, gradient sky + board drop shadow, post chain, shared look uniforms and day ↔ dusk easing.
// TownRenderer (T2.2) and the dev page both build on it:
//   const stage = new Stage(canvas, { bounds, palette, light });
//   stage.scene.add(townObject);
//   per frame: stage.render(dtS, simT);   on resize: stage.resize();
import * as THREE from 'three';
import { CameraRig, type Bounds, type CameraRigOptions } from '../camera';
import { createLights, type LightRig } from '../lights';
import { shared } from '../materials';
import { DEFAULT_LIGHT, DEFAULT_PALETTE } from '../palettes';
import type { LightMode, PaletteId } from '../types';
import { createBackdrop, type Backdrop } from './backdrop';
import { Look, type Quality } from './look';

export interface StageOptions {
  palette?: PaletteId;
  light?: LightMode;
  quality?: Quality;
  autoQuality?: boolean;
  /** Board slab top bounds (shadow fit, drop shadow, camera pan limits). */
  bounds?: Bounds;
  /** Tallest thing on the board (shadow frustum), default 10. */
  maxHeight?: number;
  camera?: CameraRigOptions;
  /** false = plain renderer.render (no composer), e.g. for tests or very weak GPUs. */
  post?: boolean;
  preserveDrawingBuffer?: boolean;
  onQualityChange?: (q: Quality) => void;
}

const DPR_HIGH = 2;
const RIM_DUSK = new THREE.Color('#ffc59a');

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly lights: LightRig;
  readonly backdrop: Backdrop;
  readonly look: Look | null;
  palette: PaletteId;
  light: LightMode;
  bounds: Bounds;
  /** Eased 0..1 dusk amount (follows `light`). */
  dusk: number;
  private duskGoal: number;
  private readonly onQualityChange: ((q: Quality) => void) | undefined;
  private readonly tmpV = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement, opts: StageOptions = {}) {
    this.palette = opts.palette ?? DEFAULT_PALETTE;
    this.light = opts.light ?? DEFAULT_LIGHT;
    this.bounds = opts.bounds ?? { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };
    this.dusk = this.duskGoal = this.light === 'dusk' ? 1 : 0;
    this.onQualityChange = opts.onQualityChange;
    const post = opts.post ?? true;
    const quality = opts.quality ?? 'high';

    const r = new THREE.WebGLRenderer({ canvas, antialias: !post, powerPreference: 'high-performance', preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false });
    r.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio || 1, DPR_HIGH) : 1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;

    const b = this.bounds;
    this.rig = new CameraRig(canvas, {
      bounds: { minX: b.minX * 0.8, maxX: b.maxX * 0.8, minZ: b.minZ * 0.8, maxZ: b.maxZ * 0.8 },
      view: Math.max(b.maxZ - b.minZ, (b.maxX - b.minX) * 0.62) * 1.05,
      ...opts.camera,
    });
    this.lights = createLights({ bounds: b, palette: this.palette, dusk: this.dusk, shadowMapSize: quality === 'high' ? 4096 : 2048 });
    this.lights.fit(b, opts.maxHeight ?? 10);
    this.scene.add(this.lights.group);
    this.backdrop = createBackdrop(this.scene, { palette: this.palette, dusk: this.dusk, bounds: b });
    this.look = post
      ? new Look(r, this.scene, this.rig.camera, { quality, autoQuality: opts.autoQuality ?? true, onQualityChange: (q) => this.qualityChanged(q) })
      : null;
    this.applyDusk();
    this.resize();
  }

  get camera(): THREE.OrthographicCamera { return this.rig.camera; }
  get quality(): Quality { return this.look?.quality ?? 'low'; }

  setPalette(p: PaletteId): void {
    this.palette = p;
    this.lights.setPalette(p);
    this.backdrop.setPalette(p);
    this.applyDusk();
  }

  /** Switch day/dusk; eases over ~1 s unless `instant`. */
  setLight(l: LightMode, instant = false): void {
    this.light = l;
    this.duskGoal = l === 'dusk' ? 1 : 0;
    if (instant) { this.dusk = this.duskGoal; this.applyDusk(); }
  }

  setQuality(q: Quality): void { this.look?.setQuality(q); if (!this.look) this.qualityChanged(q); }

  /** Re-read the canvas CSS size (call on window/container resize). */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width), h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
    this.look?.setSize(w, h);
  }

  /** Advance shared uniforms + easing and draw one frame. */
  render(dtS: number, simT?: number): void {
    const dt = Math.min(Math.max(dtS, 0), 0.1);
    shared.uTime.value += dt;
    if (simT !== undefined) shared.uSimT.value = simT;
    if (this.dusk !== this.duskGoal) {
      const k = 1 - Math.exp(-dt * 3.2);
      this.dusk += (this.duskGoal - this.dusk) * k;
      if (Math.abs(this.duskGoal - this.dusk) < 0.003) this.dusk = this.duskGoal;
      this.applyDusk();
    }
    this.rig.update(dt);
    if (this.look) this.look.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
  }

  /** World → CSS pixels relative to the canvas. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = this.tmpV.set(x, y, z).project(this.rig.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 };
  }

  dispose(): void {
    this.look?.dispose();
    this.backdrop.dispose();
    this.lights.dispose();
    this.rig.dispose();
    this.renderer.dispose();
  }

  private qualityChanged(q: Quality): void {
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, DPR_HIGH) : 1);
    this.lights.setShadowMapSize(q === 'high' ? 4096 : 2048);
    this.resize();
    this.onQualityChange?.(q);
  }

  private applyDusk(): void {
    const t = this.dusk, e = t * t * (3 - 2 * t);
    shared.uDusk.value = e;
    this.lights.setDusk(e);
    this.backdrop.setDusk(e);
    this.look?.setDusk(e);
    this.backdrop.color(shared.uFadeColor.value);
    shared.uRim.value = 0.14 + 0.1 * e;
    shared.uRimColor.value.set('#fff4e0').lerp(RIM_DUSK, e);
    shared.uGroundAO.value = 0.8 - 0.06 * e;
    this.renderer.toneMappingExposure = 1.0 + 0.08 * e;
  }
}
