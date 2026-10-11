// Owner: T2.2. TownRenderer (spec §10): composes the T2.1 Stage (renderer, iso camera rig, lights, sky, board drop
// shadow, post chain), the static town (render/town), the dynamic layer (render/dynamic: buses, train, people,
// picking, selection, highlight) and the plug-in layers (world, streetscape, traffic, town FX), and drives the
// shared look uniforms (uTime via Stage.render, uSimT = interpolated sim time).
import * as THREE from 'three';
import { pointAt } from '@headway/sim';
import type { RouteId, SimSnapshot, TownMap } from '@headway/sim';
import { createDynamicLayer, type DynamicLayer } from './dynamic/index';
import { simTimeAt } from './dynamic/interp';
import { createTownFxLayer } from './fx/index';
import type { FrameContext, RenderLayer } from './layers';
import { DEFAULT_DETAIL, DEFAULT_LIGHT, DEFAULT_PALETTE } from './palettes';
import { Stage, type Quality } from './post';
import { createStreetscapeLayer } from './streetscape/index';
import { createStaticTown, type StaticTown, type StaticTownOptions } from './town/index';
import { createTrafficLayer } from './traffic/index';
import type { DetailMode, LightMode, PaletteId, Pick, TownRendererApi, TownRendererOptions } from './types';
import { createWorldLayer } from './world/index';
import { DISTRICTS } from './districts/index';

/** Optional extras (all optional, so plain TownRendererOptions keep working). */
export interface TownRendererExtras {
  quality?: Quality;
  /** false = no post chain (plain render). */
  post?: boolean;
  autoQuality?: boolean;
  preserveDrawingBuffer?: boolean;
  /** Plug-in layers to include (default: all). */
  layers?: Partial<Record<'world' | 'streetscape' | 'traffic' | 'fx', boolean>>;
  /** Seed for renderer-local variety (ambient traffic). */
  seed?: number;
  /** Scenery overrides (tests, previews). */
  scenery?: StaticTownOptions['scenery'];
  districts?: StaticTownOptions['districts'];
}

const PAD = 0.04;

export class TownRenderer implements TownRendererApi {
  readonly stage: Stage;
  /** The WebGLRenderer (its domElement is the canvas). */
  readonly gl: THREE.WebGLRenderer;
  readonly town: StaticTown;
  readonly dynamic: DynamicLayer;
  readonly layers: RenderLayer[] = [];
  palette: PaletteId;
  detail: DetailMode;
  light: LightMode;
  private highlighted: RouteId | null = null;
  private lastMs = -1;
  private startMs = performance.now();
  private userMoved = false;
  private disposed = false;
  private readonly ndc = new THREE.Vector2();

  constructor(readonly canvas: HTMLCanvasElement, readonly map: TownMap, opts: TownRendererOptions & TownRendererExtras = {}) {
    this.palette = opts.palette ?? DEFAULT_PALETTE;
    this.detail = opts.detail ?? DEFAULT_DETAIL;
    this.light = opts.light ?? DEFAULT_LIGHT;
    this.stage = new Stage(canvas, {
      palette: this.palette, light: this.light, bounds: map.bounds, maxHeight: 10,
      ...(opts.quality ? { quality: opts.quality } : {}),
      ...(opts.post !== undefined ? { post: opts.post } : {}),
      ...(opts.autoQuality !== undefined ? { autoQuality: opts.autoQuality } : {}),
      ...(opts.preserveDrawingBuffer !== undefined ? { preserveDrawingBuffer: opts.preserveDrawingBuffer } : {}),
      camera: { minZoom: 0.5, maxZoom: 5 },
    });
    this.gl = this.stage.renderer;
    this.stage.rig.controls?.addEventListener('start', () => { this.userMoved = true; });

    this.town = createStaticTown(map, {
      palette: this.palette, detail: this.detail,
      ...(opts.scenery ? { scenery: opts.scenery } : {}),
      ...(opts.districts ? { districts: opts.districts } : {}),
    });
    this.stage.scene.add(this.town.object);
    this.dynamic = createDynamicLayer(map, { palette: this.palette, detail: this.detail });
    this.stage.scene.add(this.dynamic.object);

    const want = opts.layers ?? {};
    const tryLayer = (name: string, make: () => RenderLayer) => {
      if (want[name as keyof typeof want] === false) return;
      try {
        const l = make();
        this.layers.push(l);
        this.stage.scene.add(l.object);
        l.setPalette?.(this.palette);
        l.setLight?.(this.light);
      } catch (e) {
        console.warn(`[headway] ${name} layer unavailable:`, e);
      }
    };
    tryLayer('world', () => createWorldLayer(map));
    tryLayer('streetscape', () => createStreetscapeLayer(map, opts.districts ? [...opts.districts] : DISTRICTS));
    tryLayer('traffic', () => createTrafficLayer(map, { seed: opts.seed ?? 1 }));
    tryLayer('fx', () => createTownFxLayer(map));
    this.fit();
  }

  /** Default framing: the rail loop and every stop fill the canvas (4 % padding), centred. */
  fit(): void {
    const cam = this.stage.camera;
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse;
    const v = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const add = (x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(inv);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    };
    const loop = this.map.rail.loop;
    for (let d = 0; d < loop.length; d += 2) { const p = pointAt(loop, d); add(p.x, 0, p.z); add(p.x, 1.6, p.z); }
    for (const s of this.map.stops) add(s.p.x, 0, s.p.z);
    if (!Number.isFinite(minX)) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width), h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    const needH = Math.max(maxY - minY, (maxX - minX) * (h / w)) * (1 + 2 * PAD);
    const zoom = this.stage.rig.view / needH;
    // Move the target along the ground so the box centre (camera space) lands on the screen centre:
    // Δ = cx·right + cy·up + c·dir with Δ.y = 0 (orthographic, so only the camera-space x/y shift matters).
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const c = Math.abs(dir.y) > 1e-6 ? -(cx * right.y + cy * up.y) / dir.y : 0;
    const delta = right.multiplyScalar(cx).addScaledVector(up, cy).addScaledVector(dir, c);
    const t = this.stage.rig.target;
    this.stage.rig.set(t.x + delta.x, t.z + delta.z, zoom);
  }

  render(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
    if (this.disposed) return;
    const now = performance.now();
    const dtS = this.lastMs < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.lastMs) / 1000));
    this.lastMs = now;
    const timeS = (now - this.startMs) / 1000;
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    const simT = simTimeAt(prev.t, next.t, a);
    this.town.update(dtS);
    this.dynamic.update({ prev, next, alpha: a, simT, dtS, timeS });
    const ctx: FrameContext = {
      prev, next, alpha: a, simT, dtS, timeS, map: this.map, camera: this.stage.camera, light: this.light, highlightedRoute: this.highlighted,
    };
    for (const l of this.layers) {
      try { l.update(ctx); } catch (e) { if (!l.object.userData.failed) { l.object.userData.failed = true; console.warn(`[headway] ${l.name} layer update failed:`, e); } }
    }
    this.stage.render(dtS, simT);
  }

  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    this.ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    const cam = this.stage.camera;
    const hit = this.dynamic.pick(this.ndc, cam, x, y, (p) => {
      const s = this.stage.project(p.x, p.y, p.z);
      return { x: s.x, y: s.y };
    });
    if (hit) return hit;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(this.ndc, cam);
    const stop = rc.intersectObjects(this.town.stops.map((s) => s.mesh), false)[0];
    return stop ? { kind: 'stop', id: String(stop.object.userData.pick?.id ?? '') } : null;
  }

  select(p: Pick | null): void {
    this.dynamic.select(p);
  }

  highlightRoute(id: RouteId | null): void {
    this.highlighted = id;
    this.town.setHighlight(id);
    this.dynamic.setHighlight(id);
  }

  setPalette(p: PaletteId): void {
    if (p === this.palette) return;
    this.palette = p;
    this.stage.setPalette(p);
    this.town.setPalette(p);
    this.dynamic.setPalette(p);
    for (const l of this.layers) l.setPalette?.(p);
  }

  setDetail(d: DetailMode): void {
    this.detail = d;
    this.town.setDetail(d);
    this.dynamic.setDetail(d);
  }

  setLight(l: LightMode): void {
    this.light = l;
    this.stage.setLight(l);
    for (const layer of this.layers) layer.setLight?.(l);
  }

  setQuality(q: Quality): void {
    this.stage.setQuality(q);
  }

  /** Smoothly frame a picked entity (vehicles follow where they are now). */
  focus(p: Pick, zoom?: number): void {
    const at = this.dynamic.positionOf(p);
    if (at) this.stage.rig.focus(at.x, at.z, zoom ?? Math.max(this.stage.camera.zoom, 2.2));
  }

  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    return this.stage.project(x, y, z);
  }

  resize(): void {
    this.stage.resize();
    if (!this.userMoved) this.fit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const l of this.layers) { try { l.dispose(); } catch { /* layer already gone */ } }
    this.dynamic.dispose();
    this.town.dispose();
    this.stage.dispose();
  }
}

export * from './types';
