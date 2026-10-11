// Owner: E1. Mountains/foothills on north+west, forests, rock, tunnel portals for road exits and the rail tunnel. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../../layers';
import type { WorldLayout } from '../layout';

export function createTerrainLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'terrain:' + map.version + ':' + layout.exits.length;
  return { name: 'terrain', object, update() {}, dispose() {} };
}
