// Owner: A5. Registers every 'vegetation' kind from catalog.ts: six trees, bushes, hedges, flowerbeds, planters.
// All kinds are instanced; tree and bush crowns sway. Per-instance variety: each build draws ONE k.rand() (or uses
// params.variant) for discrete shape/tone/size/yaw choices, named in root.userData.variant (equal key = identical
// geometry). veg.hedge takes params.length (x extent, default 3).
import { CATALOG } from '../catalog';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';
import type * as THREE from 'three';
import { buildBush, buildFlowerbed, buildHedge, buildPlanter } from './vegetation/garden';
import { VEG_ROLES } from './vegetation/roles';
import { buildBirch, buildCherry, buildMaple, buildOak, buildPine, buildPoplar } from './vegetation/trees';

/** Extra palette roles this family needs (palette a, b, c). */
export const ROLES: RoleColors = VEG_ROLES;

type Builder = (k: KitContext, params: AssetParams) => THREE.Object3D;
const BUILDERS: Record<string, { build: Builder; sway: boolean }> = {
  'veg.oak': { build: buildOak, sway: true },
  'veg.maple': { build: buildMaple, sway: true },
  'veg.pine': { build: buildPine, sway: true },
  'veg.birch': { build: buildBirch, sway: true },
  'veg.poplar': { build: buildPoplar, sway: true },
  'veg.cherry': { build: buildCherry, sway: true },
  'veg.bush': { build: buildBush, sway: true },
  'veg.hedge': { build: buildHedge, sway: false },
  'veg.flowerbed': { build: buildFlowerbed, sway: false },
  'veg.planter': { build: buildPlanter, sway: false },
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const c of CATALOG) {
    if (c.family !== 'vegetation') continue;
    const b = BUILDERS[c.kind];
    if (!b) continue;
    const def: AssetDef = { kind: c.kind, family: 'vegetation', footprint: { w: c.w, d: c.d }, height: c.h, build: b.build, instanced: true };
    if (b.sway) def.sway = true;
    r.register(def);
  }
}
