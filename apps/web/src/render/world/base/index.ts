// Owner: E3. Diorama base = 1 draw call (art bible §6.6): the world is a "slice of a world" model — a 5.2 u cut
// showing banded water over a sand lip and soil on the lake sides (S, E: the only faces the camera sees), soil under
// a grass lip on land — with a rounded top edge, resting on a thin rounded wooden plinth; plus a sunken safety floor
// beyond the board so no gap can ever show the void (it stays under E1's terrain and E2's beach and water).
// The cut follows the siblings: once the terrain (E1) / water (E2) layers exist next to it in the world group, the
// walls are re-sampled from their meshes (mountains and headlands are sliced through; the water column tops out at
// the water mesh's level). Checked about once a second; re-cut only when their meshes change.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { FrameContext, RenderLayer } from '../../layers';
import type { LightMode, PaletteId } from '../../types';
import type { WorldLayout } from '../layout';
import { DuskEase } from '../sky/ease';
import { buildBaseGeometry } from './geometry';
import { createBaseMaterial } from './material';
import { adaptProfile, defaultProfile, samplePoints, sampleTops, type EdgeProfile } from './profile';

export { BASE, floorAt, groundAt, isWater } from './profile';
export { BASE_LOOKS } from './material';

const TERRAIN = /terrain|mountain/i;
const WATER = /water|lake/i;

function signature(roots: THREE.Object3D[]): string {
  const parts: string[] = [];
  for (const r of roots) {
    r.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      const pos = m.geometry?.getAttribute('position');
      if (pos) parts.push(`${m.geometry.uuid}:${pos.count}`);
    });
  }
  return parts.join(',');
}

export function createBaseLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const object = new THREE.Group();
  object.name = 'base';
  object.userData.mapVersion = map.version;
  const mat = createBaseMaterial();
  let profile: EdgeProfile[] = defaultProfile(layout);
  const mesh = new THREE.Mesh(buildBaseGeometry(layout, profile), mat.material);
  mesh.name = 'base:diorama';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  object.add(mesh);

  const ease = new DuskEase();
  let lastSig = '';
  let nextCheck = -Infinity;

  /** Re-cut the walls to the sibling terrain / water layers when their meshes changed. */
  const refit = () => {
    const parent = object.parent;
    if (!parent) return;
    const terrain: THREE.Object3D[] = [], water: THREE.Object3D[] = [];
    for (const c of parent.children) {
      if (c === object) continue;
      const tag = String(c.userData?.worldPart ?? c.name ?? '');
      if (TERRAIN.test(tag)) terrain.push(c);
      else if (WATER.test(tag)) water.push(c);
    }
    const sig = signature(terrain) + '|' + signature(water);
    if (sig === lastSig) return;
    lastSig = sig;
    const base = defaultProfile(layout);
    const pts = samplePoints(base);
    profile = adaptProfile(base, sampleTops(terrain, pts), sampleTops(water, pts));
    mesh.geometry.dispose();
    mesh.geometry = buildBaseGeometry(layout, profile);
  };

  return {
    name: 'base',
    object,
    update(ctx: FrameContext) {
      if (ctx.timeS >= nextCheck || ctx.timeS < nextCheck - 2) {
        nextCheck = ctx.timeS + 1;
        refit();
      }
      mat.setDusk(ease.step(ctx.light, ctx.dtS));
    },
    setPalette(p: PaletteId) { mat.setPalette(p); },
    setLight(l: LightMode) { ease.set(l); mat.setDusk(ease.amount); },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
