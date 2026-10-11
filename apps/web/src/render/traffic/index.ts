// Owner: T2.3. Visual-only ambient cars on all road edges. Stub until filled.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { RenderLayer } from '../layers';

export function createTrafficLayer(map: TownMap, opts: { seed: number; carCount?: number }): RenderLayer {
  const object = new THREE.Group();
  object.name = `traffic:${map.version}:${opts.seed}`;
  return { name: 'traffic', object, update() {}, dispose() {} };
}
