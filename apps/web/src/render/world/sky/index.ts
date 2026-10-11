// Owner: E3. Sky gradient, distant layered ridges with aerial perspective, a few drifting clouds; day + dusk. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../../layers';
import type { WorldLayout } from '../layout';

export function createSkyLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'sky:' + map.version + ':' + layout.exits.length;
  return { name: 'sky', object, update() {}, dispose() {} };
}
