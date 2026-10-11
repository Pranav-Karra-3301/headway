// The world around the town: terrain (E1), water (E2), sky + base (E3), composed as one RenderLayer.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { FrameContext, RenderLayer } from '../layers';
import type { LightMode, PaletteId } from '../types';
import { createBaseLayer } from './base/index';
import { worldLayout } from './layout';
import { createSkyLayer } from './sky/index';
import { createTerrainLayer } from './terrain/index';
import { createWaterLayer } from './water/index';

export function createWorldLayer(map: TownMap): RenderLayer {
  const layout = worldLayout(map);
  const parts = [createBaseLayer(map, layout), createTerrainLayer(map, layout), createWaterLayer(map, layout), createSkyLayer(map, layout)];
  const object = new THREE.Group();
  object.name = 'world';
  for (const p of parts) object.add(p.object);
  return {
    name: 'world',
    object,
    update: (ctx: FrameContext) => parts.forEach((p) => p.update(ctx)),
    setPalette: (pal: PaletteId) => parts.forEach((p) => p.setPalette?.(pal)),
    setLight: (l: LightMode) => parts.forEach((p) => p.setLight?.(l)),
    dispose: () => parts.forEach((p) => p.dispose()),
  };
}
export { worldLayout } from './layout';
export type { WorldLayout, WorldExit, Side } from './layout';
