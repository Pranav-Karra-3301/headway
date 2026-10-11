// Per-frame, non-React handles. Overlays (queue markers, labels) read these inside requestAnimationFrame.
import type { TownRendererApi } from '../render/types';
import type { SimRunner } from '../sim/runner';

export const frame: { runner: SimRunner | null; renderer: TownRendererApi | null; canvas: HTMLCanvasElement | null } = {
  runner: null,
  renderer: null,
  canvas: null,
};
