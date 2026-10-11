// Owner: S1. Sidewalks, curbs, crosswalks, district footpaths, plazas, lawns and parking surfaces. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { DistrictScenery } from '../districts/types';
import type { RenderLayer } from '../layers';

export function createStreetscapeLayer(map: TownMap, districts: DistrictScenery[]): RenderLayer {
  const object = new THREE.Group();
  object.name = `streetscape:${map.version}:${districts.length}`;
  return { name: 'streetscape', object, update() {}, dispose() {} };
}
