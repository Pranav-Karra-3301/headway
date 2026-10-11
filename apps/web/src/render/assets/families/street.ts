// Owner: A6. Street furniture: every 'st.*' kind from catalog.ts, Wooden Toy look, ≤ 600 triangles each.
// All kinds are `instanced` (fixed geometry per placement seed) except the fence, whose geometry depends on
// params.length. Lamp heads use role `lamp` (FX makes them glow at dusk); the flag `sway`s.
// Params: st.fence { length = 3, style: 'picket' | 'rail' }; st.tableUmbrella / st.flag / st.kiosk { color }
// (colour variant, else seeded per placement); st.bikeRack { color, color2 } (bike colours).
import { CATALOG } from '../catalog';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';
import { buildFence } from './street/fence';
import { buildLamp, buildTrafficLight } from './street/lights';
import { buildFlag, buildFountain, buildKiosk } from './street/plaza';
import { ROLES as STREET_ROLES } from './street/roles';
import { buildBench, buildTableUmbrella } from './street/seating';
import { buildBikeRack, buildBin, buildHydrant, buildMailbox } from './street/small';
import type * as THREE from 'three';

export { LAMP_HEAD } from './street/lights';

/** Extra palette roles this family needs (palette a, b, c). */
export const ROLES: RoleColors = STREET_ROLES;

type Builder = (k: KitContext, p: AssetParams) => THREE.Object3D;
const BUILDERS: Record<string, Builder> = {
  'st.lamp': buildLamp,
  'st.bench': buildBench,
  'st.bin': buildBin,
  'st.bikeRack': buildBikeRack,
  'st.hydrant': buildHydrant,
  'st.mailbox': buildMailbox,
  'st.trafficLight': buildTrafficLight,
  'st.fence': buildFence,
  'st.tableUmbrella': buildTableUmbrella,
  'st.flag': buildFlag,
  'st.kiosk': buildKiosk,
  'st.fountain': buildFountain,
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const c of CATALOG) {
    if (c.family !== 'street') continue;
    const build = BUILDERS[c.kind];
    if (!build) continue;
    const def: AssetDef = {
      kind: c.kind, family: 'street', footprint: { w: c.w, d: c.d }, height: c.h, build,
      instanced: c.kind !== 'st.fence',
      ...(c.kind === 'st.flag' ? { sway: true } : {}),
    };
    r.register(def);
  }
}
