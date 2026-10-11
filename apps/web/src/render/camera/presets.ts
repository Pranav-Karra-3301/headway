// Owner: C2 (camera rig). Camera presets are world boxes, not zoom numbers, so they survive any viewport or HUD
// state (bible §1.5). Overview is the transit network (fit.ts networkPoints). Edit the boxes here.
import type { TownMap } from '@headway/sim';
import { boxPoints, networkPoints, type PlanRect } from './fit';
import type { V3 } from './iso';

export type PresetId = 'overview' | 'stadium' | 'downtown' | 'campus' | 'central';

export interface PresetDef {
  id: PresetId;
  label: string;
  /** Hotkey shown in the HUD (1–5). */
  key: string;
  /** World box to frame (null = the transit network). */
  box: PlanRect | null;
  /** Height of the box's top corners (keeps roofs and the stadium masts in frame). */
  top: number;
}

export const PRESETS: readonly PresetDef[] = [
  { id: 'overview', label: 'Overview', key: '1', box: null, top: 2.6 },
  { id: 'stadium', label: 'Stadium', key: '2', box: { minX: -26, maxX: -4, minZ: 2, maxZ: 24 }, top: 3 },
  { id: 'downtown', label: 'Downtown hub', key: '3', box: { minX: -4, maxX: 14, minZ: -10, maxZ: 8 }, top: 3 },
  { id: 'campus', label: 'Campus', key: '4', box: { minX: -22, maxX: 0, minZ: -22, maxZ: 0 }, top: 3 },
  { id: 'central', label: 'Central Station', key: '5', box: { minX: 16, maxX: 32, minZ: -10, maxZ: 12 }, top: 3 },
] as const;

export const PRESET_BY_ID: ReadonlyMap<PresetId, PresetDef> = new Map(PRESETS.map((p) => [p.id, p] as const));

/** The world points a preset frames. */
export function presetPoints(map: TownMap, id: PresetId): V3[] {
  const def = PRESET_BY_ID.get(id);
  if (!def || !def.box) return networkPoints(map);
  return boxPoints(def.box, def.top);
}
