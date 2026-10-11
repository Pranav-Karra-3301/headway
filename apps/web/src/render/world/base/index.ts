// Owner: E3. Diorama base: ground beyond the board, cut edges showing soil/rock/water layers. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../../layers';
import type { WorldLayout } from '../layout';

export function createBaseLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'base:' + map.version + ':' + layout.exits.length;
  return { name: 'base', object, update() {}, dispose() {} };
}
