// Owner: A1. Downtown family: a red-brick college-town main street. Registers every 'downtown' kind from catalog.ts.
// Builders live in ./downtown/ (parts toolkit, storefront buildings, civic buildings).
//
// Params (all optional; districts can place kinds bare and get per-placement variety from k.rand()):
//   variant: number  pins the look (facade colour, awnings, signs, crest, rooftop clutter) deterministically.
//   storeys: 1 | 2   dt.shop only: one storey with a tall false front, or two storeys.
import type * as THREE from 'three';
import { CATALOG } from '../catalog';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';
import { buildBank, buildGarage, buildTheater } from './downtown/civic';
import { Dk, varietyOf } from './downtown/parts';
import { ROLES as DOWNTOWN_ROLES } from './downtown/roles';
import { buildCafe, buildCorner, buildMidrise, buildShop, buildShopRow } from './downtown/shops';

/** Extra palette roles this family needs (palette a, b, c). */
export const ROLES: RoleColors = DOWNTOWN_ROLES;

type Builder = (p: Dk, params: AssetParams) => THREE.Group;

const BUILDERS: Record<string, Builder> = {
  'dt.shop': buildShop,
  'dt.shopRow': buildShopRow,
  'dt.corner': buildCorner,
  'dt.cafe': buildCafe,
  'dt.midrise': buildMidrise,
  'dt.theater': buildTheater,
  'dt.bank': buildBank,
  'dt.garage': buildGarage,
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  CATALOG.filter((c) => c.family === 'downtown').forEach((c, i) => {
    const make = BUILDERS[c.kind];
    if (!make) return;
    const def: AssetDef = {
      kind: c.kind,
      family: 'downtown',
      footprint: { w: c.w, d: c.d },
      height: c.h,
      build(k: KitContext, params: AssetParams): THREE.Object3D {
        const g = make(new Dk(k, varietyOf(k, params, i + 1)), params);
        g.name = c.kind;
        return g;
      },
    };
    r.register(def);
  });
}
