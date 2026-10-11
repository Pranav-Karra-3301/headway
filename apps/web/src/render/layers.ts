// Renderer layer seam: TownRenderer (T2.2) composes layers; traffic (T2.3) and town FX (T2.4) plug in here.
import type * as THREE from 'three';
import type { SimSnapshot, TownMap } from '@headway/sim';
import type { LightMode, PaletteId } from './types';

export interface FrameContext {
  prev: SimSnapshot;
  next: SimSnapshot;
  alpha: number;
  /** Interpolated sim time in seconds. */
  simT: number;
  /** Real seconds since the last frame, and since start (for idle animation). */
  dtS: number;
  timeS: number;
  map: TownMap;
  camera: THREE.Camera;
  light: LightMode;
  highlightedRoute: string | null;
}

export interface RenderLayer {
  readonly name: string;
  readonly object: THREE.Object3D;
  update(ctx: FrameContext): void;
  setPalette?(p: PaletteId): void;
  setLight?(l: LightMode): void;
  dispose(): void;
}
