// Owner: E2. Lake/bay on south+east: water shader, shoreline foam, beach, marina + boats, lighthouse, bridges for road exits. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../../layers';
import type { WorldLayout } from '../layout';

export function createWaterLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'water:' + map.version + ':' + layout.exits.length;
  return { name: 'water', object, update() {}, dispose() {} };
}
