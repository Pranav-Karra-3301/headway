// Owner: T2. Renderer API consumed by the app shell (T3).
import type { RouteId, SimSnapshot } from '@headway/sim';

export type PaletteId = 'a' | 'b' | 'c';
export type DetailMode = 'min' | 'toy';
export type LightMode = 'day' | 'dusk';
export type Pick = { kind: 'bus' | 'train' | 'stop' | 'person'; id: string };
export interface TownRendererOptions { palette?: PaletteId; detail?: DetailMode; light?: LightMode }
export interface TownRendererApi {
  render(prev: SimSnapshot, next: SimSnapshot, alpha: number): void;
  pick(clientX: number, clientY: number): Pick | null;
  select(p: Pick | null): void;
  highlightRoute(id: RouteId | null): void;
  setPalette(p: PaletteId): void;
  setDetail(d: DetailMode): void;
  setLight(l: LightMode): void;
  /** world → CSS pixels relative to the canvas, for HTML overlays (queue markers, labels). */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  resize(): void;
  dispose(): void;
}
