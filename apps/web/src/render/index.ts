// Owner: T2. Stub renderer: draws nothing until T2 lands, so the app shell can mount it safely.
import type { TownMap } from '@headway/sim';
import type { Pick, TownRendererApi, TownRendererOptions } from './types';

export class TownRenderer implements TownRendererApi {
  constructor(readonly canvas: HTMLCanvasElement, readonly map: TownMap, readonly opts: TownRendererOptions = {}) {}
  render(): void {}
  pick(): Pick | null { return null; }
  select(): void {}
  highlightRoute(): void {}
  setPalette(): void {}
  setDetail(): void {}
  setLight(): void {}
  project(): { x: number; y: number; visible: boolean } { return { x: 0, y: 0, visible: false }; }
  resize(): void {}
  dispose(): void {}
}
export * from './types';
