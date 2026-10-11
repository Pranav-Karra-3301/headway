// Owner: D1. Final scenery for the 'campus' district (NW): the Old Main quad.
//
// Two blocks: the quad block (Burrowes St–Atherton St × North Rd–Main St) and the West Halls block (West Rd–Burrowes St).
// Composition (camera looks from +x/+z, so south and east faces show):
// - The Old Main bus stop opens onto the quad; its queue runs north up the central walk, which is kept clear (2 u) and
//   ends at Pattee Library's forecourt. Nothing tall stands south-east of the queue.
// - Willard Hall (west side) and Pattee Library (north side) face the quad; the Old Main clock tower stands in the NW
//   corner at the head of a diagonal walk from Main St. An E–W walk runs from the arch gate on Atherton St to Willard's
//   portico; the two diagonals and both walks cross at a paved hub on the queue axis.
// - The north edge stays low (beds and bushes only by the University stop's sight line).
// - West Halls dorm faces Burrowes St; the chapel faces Main St.
import type { Vec2 } from '@headway/sim';
import type { AssetParams, PlacedAsset } from '../assets/types';
import type { DistrictScenery, FootPath, GroundArea } from './types';

const S = 0, E = Math.PI / 2, N = Math.PI, W = -Math.PI / 2;
const v = (x: number, z: number): Vec2 => ({ x, z });
const put = (kind: string, x: number, z: number, rot = 0, params?: AssetParams): PlacedAsset =>
  ({ kind, x, z, ...(rot ? { rot } : {}), ...(params ? { params } : {}) });
const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [v(x0, z0), v(x1, z0), v(x1, z1), v(x0, z1)];
const disc = (c: Vec2, r: number, n = 20): Vec2[] =>
  Array.from({ length: n }, (_, i) => v(c.x + r * Math.cos((i / n) * Math.PI * 2), c.z + r * Math.sin((i / n) * Math.PI * 2)));
/** Point at parameter s along a → b. */
const lerp = (a: Vec2, b: Vec2, s: number): Vec2 => v(a.x + (b.x - a.x) * s, a.z + (b.z - a.z) * s);

// ---------------------------------------------------------------- key points
const HUB = v(-9, -5);                 // where the walks cross (on the Old Main queue axis)
const TOWER = v(-14.9, -11.2);         // Old Main clock tower (door faces south)
const TOWER_DOOR = v(TOWER.x, TOWER.z + 1.15);
const DIAG = v(TOWER_DOOR.x - HUB.x, TOWER_DOOR.z - HUB.z); // hub → tower door
const MAIN_KERB = -1.65, NORTH_KERB = -13.0, ATHERTON_KERB = -3.65;
/** The diagonals run at the same angle (hub → tower) mirrored about the walk. */
const along = (dx: number, dz: number, z: number): Vec2 => { const s = (z - HUB.z) / dz; return v(HUB.x + dx * s, z); };
const SE_START = along(-DIAG.x, -DIAG.z, MAIN_KERB);
const SW_START = along(DIAG.x, -DIAG.z, MAIN_KERB);
const NE_END = along(-DIAG.x, DIAG.z, -7.95);

// ---------------------------------------------------------------- buildings
const BUILDINGS: PlacedAsset[] = [
  put('cp.hall', -15.72, -5.02, E, { variant: 0, brick: 0, roof: 0, door: 0 }), // Willard Hall, portico on the E–W walk
  put('lm.clockTower', TOWER.x, TOWER.z, S),                                     // Old Main
  put('cp.library', -7.05, -10.55, S, { brick: 0, roof: 1 }),                    // Pattee Library, heads the walk
  put('cp.gate', -4.05, HUB.z, E, { brick: 0, banner: 0 }),                      // arch gate on Atherton St
  put('cp.dorm', -22.4, -10.05, E, { brick: 1, roof: 1, door: 1 }),              // West Halls, faces Burrowes St
  put('cp.chapel', -22.4, -4.05, S, { brick: 2, roof: 0, door: 2 }),             // chapel, faces Main St
];

// ---------------------------------------------------------------- paths + ground
const WALK = 1.4, PATH = 0.9, LANE = 0.8;
const PATHS: FootPath[] = [
  { kind: 'footpath', width: WALK, points: [v(HUB.x, MAIN_KERB), v(HUB.x, -7.3)] },        // Old Main walk (queue axis)
  { kind: 'footpath', width: PATH, points: [v(ATHERTON_KERB, HUB.z), v(-13.95, HUB.z)] },  // gate → Willard portico
  { kind: 'footpath', width: PATH, points: [SE_START, TOWER_DOOR] },                       // Main St → clock tower
  { kind: 'footpath', width: PATH, points: [SW_START, NE_END] },                           // Main St → library
  { kind: 'footpath', width: LANE, points: [v(-12.2, NORTH_KERB), lerp(HUB, TOWER_DOOR, (-12.2 - HUB.x) / DIAG.x)] }, // North Rd entrance
];
const AREAS: GroundArea[] = [
  { kind: 'lawn', polygon: rect(-17.3, NORTH_KERB, ATHERTON_KERB, MAIN_KERB) },     // the quad block
  { kind: 'lawn', polygon: [v(-24.3, -12.0), v(-23.3, NORTH_KERB), v(-20.7, NORTH_KERB), v(-20.7, MAIN_KERB), v(-24.3, MAIN_KERB)] },
  { kind: 'plaza', polygon: disc(HUB, 1.25) },                                      // hub
  { kind: 'plaza', polygon: rect(-10.5, -8.15, -3.65, -7.2) },                      // library forecourt
  { kind: 'plaza', polygon: rect(-16.5, -12.75, -13.3, -9.6) },                     // tower plinth court
];

// ---------------------------------------------------------------- trees, beds, furniture
const TREES: PlacedAsset[] = [
  // around the tower
  put('veg.pine', -16.85, -12.3), put('veg.birch', -16.9, -10.3), put('veg.oak', -13.2, -12.2),
  // quad panels
  put('veg.oak', -12.95, -3.4), put('veg.maple', -12.9, -6.5), put('veg.cherry', -6.2, -2.5),
  put('veg.maple', -5.0, -6.5),
  // west block
  put('veg.poplar', -24.0, -6.9),
];
const BEDS: PlacedAsset[] = [
  put('veg.flowerbed', -11.2, -12.4), put('veg.bush', -10.9, -11.4),
];
const FURNITURE: PlacedAsset[] = [
  put('st.flag', -11.4, -2.2, S, { color: 0 }), put('st.flag', -6.6, -2.2, S, { color: 1 }),
  put('st.lamp', -11.2, -4.0), put('st.lamp', -6.8, -4.0), put('st.lamp', -11.2, -7.0), put('st.lamp', -6.8, -7.0),
  put('st.bench', -11.6, -6.4, E), put('st.bench', -6.3, -6.9, W),
];

export const CAMPUS: DistrictScenery = {
  id: 'campus',
  region: { center: { x: -13.5, z: -7.3 }, radius: 11 },
  items: [...BUILDINGS, ...TREES, ...BEDS, ...FURNITURE],
  paths: PATHS,
  areas: AREAS,
};
void N; void W;
