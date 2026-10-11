// Owner: A3. Registers every 'residential' kind from catalog.ts: painted cottages, townhouse rows, garden
// apartments, balcony towers, playgrounds and parking lots. Builders live in ./residential/*.
// Shared roles used as-is (same in the basic kit and the town palette): wall, roof, window (idx 1 glows at dusk),
// door, brick, leaf, lawn, mark, car, lamp. Everything else is a res-prefixed role below (no cross-family clashes).
// Optional params (otherwise seeded per placement via k.rand()):
//   res.tower { floors 5-7, wall, accent, roof }   res.garden { scheme 'brick'|'painted', roof, accent }
//   res.townhouses { wall, roof }                    res.house { wall, roof, style 'side'|'front', porch 'left'|'right', dormer }
//   res.parking { cars 0-5 }                         res.playground {}
// Front (doors, porches, balconies, driveway gap) faces +z; every face has windows, so any quarter turn works.
// Dev art-direction page: /src/render/assets/families/residential/preview.html (?kind=, ?palette=b|c, ?detail=min).
import type { AssetRegistry } from '../registry';
import { CATALOG } from '../catalog';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';
import { garden } from './residential/garden';
import { house } from './residential/house';
import { parking } from './residential/parking';
import { playground } from './residential/playground';
import { tower } from './residential/tower';
import { townhouses } from './residential/townhouses';

/** Extra palette roles this family needs (palette a Wooden Toy, b Miniature Railway, c State College Autumn). */
export const ROLES: RoleColors = {
  /** Painted clapboard for houses and townhouses: cream, powder blue, blush, butter (a). */
  resSiding: [['#F6EEDC', '#D3E4EE', '#F5D5C5', '#F7E3A9'], ['#E3CBA8', '#C8694C', '#D8C8A8', '#B5BFA8'], ['#F5F2EA', '#EADFC9', '#C9D3DC', '#A8483A']],
  /** Doors, balcony fronts, shutters, play equipment. */
  resAccent: [['#E9785A', '#3FA796', '#F2C14E', '#5A8BD6'], ['#8F3F2C', '#2F7F7A', '#D9A441', '#22407A'], ['#1E3A6E', '#A8483A', '#E9B03B', '#2E8B57']],
  /** Window/door frames, porch posts, rails. */
  resFrame: ['#FFFFFF', '#F5EFE3', '#FFFFFF'],
  /** Sills, floor bands, cornices, parapets. */
  resTrim: ['#FFFBF3', '#EADCC4', '#F5F2EA'],
  /** Foundations, steps, balcony slabs, kerbs, paving. */
  resStone: ['#E8DCC6', '#CDBFA6', '#D6D1C6'],
  /** Porch decks, flower boxes, timber edging, water tank. */
  resWood: [['#D3A777', '#B98C5E'], ['#9C7A58', '#7A5A40'], ['#A8845F', '#7B5B43']],
  resFlower: [['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2'], ['#C8423B', '#D9A441', '#F5EFE3', '#9A4E8C'], ['#E07A2E', '#E9B03B', '#FFFFFF', '#C9452E']],
  resBrass: ['#E8B64C', '#C9A04A', '#D9B04A'],
  resMetal: ['#7E848E', '#6F7279', '#6B7280'],
  resTire: ['#2A2D33', '#26282C', '#25272B'],
  /** Parking lot surface. */
  resLot: ['#DDD6C9', '#C4BCAE', '#CBC8C1'],
  /** Playground rubber pad and sandbox sand. */
  resPad: ['#F1BFA0', '#D9B99A', '#D9C7B0'],
  resSand: ['#F5E2AE', '#E2CFA3', '#E6D6AE'],
  /** Clipped hedges stay green in every palette (round bushes follow the seasonal leaf role). */
  resHedge: ['#5DB57A', '#7E9F6B', '#7F9C58'],
};

const BUILDERS: Record<string, (k: KitContext, p: AssetParams) => import('three').Object3D> = {
  'res.tower': tower,
  'res.garden': garden,
  'res.townhouses': townhouses,
  'res.house': house,
  'res.playground': playground,
  'res.parking': parking,
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const c of CATALOG) {
    if (c.family !== 'residential') continue;
    const build = BUILDERS[c.kind];
    if (!build) continue;
    const def: AssetDef = { kind: c.kind, family: 'residential', footprint: { w: c.w, d: c.d }, height: c.h, build };
    r.register(def);
  }
}
