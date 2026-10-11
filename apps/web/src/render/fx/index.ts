// Owner: T2.4. Town shader FX: flowing route ribbons, lamps, clock hands, ground variation, dusk glows. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../layers';

export function createTownFxLayer(map: TownMap): RenderLayer {
  const object = new THREE.Group();
  object.name = `fx:${map.version}`;
  return { name: 'fx', object, update() {}, dispose() {} };
}
