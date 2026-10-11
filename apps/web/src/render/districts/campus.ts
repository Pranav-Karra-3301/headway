// Owner: D1. Final scenery for the 'campus' district (NW): the Old Main quad and West Halls.
//
// Two blocks, both derived from TOWN's road nodes so small map edits move the layout with them:
// - The quad block (Burrowes St–Atherton St × North Rd–Main St). The Old Main bus stop opens onto the quad; its queue
//   runs north up the central walk, which is kept clear (2 u) up to Pattee Library's forecourt. Willard Hall faces the
//   quad from the west, the library from the north; the Old Main clock tower stands in the NW corner, reached by a walk
//   from the quad's north-west node. The walks form a "Union Jack": the central walk, an E–W walk from the arch gate on
//   Atherton St to Willard's portico, and two diagonals, all crossing at a paved hub on the queue axis.
// - The West Halls block (West Rd–Burrowes St): the dorm faces Burrowes St, the chapel faces Main St.
// Camera rules (it looks from +x/+z): nothing tall stands south-east of a queue; the strip south-east of the University
// Station stop stays low, so the stop and its queue never hide behind the campus. Route 1 runs up Burrowes St and
// along North Rd, the quad's camera-hidden edges: only hedges, bushes and beds there (no tree crowns), and the clock
// tower keeps lawn on its north and west. Willard (pinned to Burrowes St by its zone door), the tower and the library
// still hide short stretches of those streets; x-ray covers them (art bible §2.4).
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { AssetParams, PlacedAsset } from '../assets/types';
import type { DistrictScenery, FootPath, GroundArea } from './types';

const S = 0, E = Math.PI / 2, N = Math.PI, W = -Math.PI / 2;
const v = (x: number, z: number): Vec2 => ({ x, z });
const put = (kind: string, x: number, z: number, rot = 0, params?: AssetParams): PlacedAsset =>
  ({ kind, x, z, ...(rot ? { rot } : {}), ...(params ? { params } : {}) });
const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [v(x0, z0), v(x1, z0), v(x1, z1), v(x0, z1)];
const disc = (c: Vec2, r: number, n = 24): Vec2[] =>
  Array.from({ length: n }, (_, i) => v(c.x + r * Math.cos((i / n) * Math.PI * 2), c.z + r * Math.sin((i / n) * Math.PI * 2)));
const must = <T>(x: T | undefined, what: string): T => { if (x === undefined) throw new Error(`campus: no ${what} in TOWN`); return x; };
const node = (id: string): Vec2 => must(TOWN.roads.nodes.find((n) => n.id === id), 'road node ' + id).p;

// ---------------------------------------------------------------- anchors (from TOWN)
const X_WEST = node('j_main_west').x, X_BURROWES = node('j_main_burrowes').x, X_ATHERTON = node('j_main_atherton').x;
const Z_NORTH = node('j_north_burrowes').z, Z_MAIN = node('j_main_burrowes').z;
const OLD_MAIN = must(TOWN.stops.find((s) => s.id === 'stop_old_main'), 'stop_old_main').p;
const WEST_HALLS = must(TOWN.zones.find((z) => z.id === 'z_west_halls'), 'z_west_halls').door;
const CAMPUS_N = must(TOWN.neighborhoods.find((n) => n.id === 'campus'), 'campus neighbourhood');
/** Clearance from road centrelines (validatePlacements wants 1.5) and the road's visual half-width. */
const M = 1.55, ROAD = 1.2;
const Q = { w: X_BURROWES + M, e: X_ATHERTON - M, n: Z_NORTH + M, s: Z_MAIN - M }; // quad block interior
const WB = { w: X_WEST + M, e: X_BURROWES - M, n: Z_NORTH + M, s: Z_MAIN - M };   // West Halls block interior

const HUB = v(OLD_MAIN.x, Q.s - 3.5);           // walks cross here; Willard's portico faces it
const WILLARD = v(Q.w + 1.75, HUB.z);          // cp.hall 7 × 3.5, turned to face east
const LIBRARY = v(Q.e - 3.5, Q.n + 2.5);       // cp.library 7 × 5, faces south down the walk
const GATE = v(Q.e - 0.5, HUB.z);              // cp.gate 4 × 1, turned to face Atherton St
const TOWER = v(Q.w + 2.4, Q.n + 1.8);         // lm.clockTower 2.3 × 2.3, door south
const DORM = v(WEST_HALLS.x - 1.8, WB.n + 3);  // cp.dorm 6 × 3.5, turned to face Burrowes St (front at the zone door)
const CHAPEL = v(WB.e - 1.55, WB.s - 2.5);     // cp.chapel 3 × 5, faces Main St
const FRONT = LIBRARY.z + 2.5;                 // the library's front line
const FORECOURT_Z = FRONT + 0.45;              // where the walk and the NE diagonal meet the library's apron
const TOWER_DOOR = v(TOWER.x, TOWER.z + 1.15);
/** Diagonals through the hub, meeting Main St 2.9 u either side of the walk: sign +1 runs SE→NW, −1 SW→NE. */
const SLOPE = 2.9 / (Q.s - HUB.z);
const diag = (sign: 1 | -1, z: number): Vec2 => v(HUB.x + sign * SLOPE * (z - HUB.z), z);
const NW_NODE = diag(1, FRONT - 0.25);         // the quad's north-west corner, beside the library
const LANE_X = NW_NODE.x - 0.3;                // north lane from North Rd (University Station side)
const towerWalkZ = (x: number) => NW_NODE.z + ((TOWER_DOOR.z - NW_NODE.z) * (x - NW_NODE.x)) / (TOWER_DOOR.x - NW_NODE.x);

// ---------------------------------------------------------------- buildings
const BUILDINGS: PlacedAsset[] = [
  put('cp.hall', WILLARD.x, WILLARD.z, E, { variant: 0, brick: 0, roof: 0, door: 0 }), // Willard Hall
  put('lm.clockTower', TOWER.x, TOWER.z, S),                                           // Old Main
  put('cp.library', LIBRARY.x, LIBRARY.z, S, { brick: 0, roof: 1 }),                   // Pattee Library
  put('cp.gate', GATE.x, GATE.z, E, { brick: 0, banner: 0 }),                          // the Atherton St gate
  put('cp.dorm', DORM.x, DORM.z, E, { brick: 1, roof: 1, door: 1 }),                   // West Halls
  put('cp.chapel', CHAPEL.x, CHAPEL.z, S, { brick: 2, roof: 0, door: 2 }),             // the chapel
];

// ---------------------------------------------------------------- walks + ground
const WALK = 1.4, PATH = 0.9, LANE = 0.8;
const PATHS: FootPath[] = [
  { kind: 'footpath', width: WALK, points: [v(HUB.x, Z_MAIN - ROAD), v(HUB.x, FORECOURT_Z)] },     // Old Main walk
  { kind: 'footpath', width: PATH, points: [v(X_ATHERTON - ROAD, HUB.z), v(WILLARD.x + 1.8, HUB.z)] }, // gate → Willard
  { kind: 'footpath', width: PATH, points: [diag(1, Z_MAIN - ROAD), NW_NODE] },                     // SE corner → NW
  { kind: 'footpath', width: PATH, points: [diag(-1, Z_MAIN - ROAD), diag(-1, FORECOURT_Z)] },      // SW corner → library
  { kind: 'footpath', width: PATH, points: [NW_NODE, TOWER_DOOR] },                                  // → clock tower
  { kind: 'footpath', width: LANE, points: [v(LANE_X, Z_NORTH + ROAD), v(LANE_X, towerWalkZ(LANE_X))] }, // North Rd lane
];
const AREAS: GroundArea[] = [
  { kind: 'lawn', polygon: rect(Q.w, Q.n, Q.e, Q.s) },
  { kind: 'lawn', polygon: [v(WB.w, WB.n + 1.6), v(WB.w + 1.6, WB.n), v(WB.e, WB.n), v(WB.e, WB.s), v(WB.w, WB.s)] },
  { kind: 'plaza', polygon: disc(HUB, 1.3) },
  { kind: 'plaza', polygon: rect(LIBRARY.x - 3.4, FRONT - 0.1, LIBRARY.x + 3.3, FRONT + 0.85) },            // forecourt
  { kind: 'plaza', polygon: rect(TOWER.x - 1.6, TOWER.z - 1.45, TOWER.x + 1.6, TOWER.z + 1.7) },             // tower court
];

// ---------------------------------------------------------------- trees, beds, furniture
const TREES: PlacedAsset[] = [
  // the tower corner: one birch beside it (the North Rd / Burrowes St edges stay low, see BEDS)
  put('veg.birch', TOWER.x + 2.15, TOWER.z + 0.75),
  // the quad's west panels: an oak (south) and a maple (north) by Willard, birches by the walk, either side of the portico walk
  put('veg.oak', Q.w + 4.5, Q.s - 1.15), put('veg.birch', HUB.x - 2.75, HUB.z + 1.65),
  put('veg.maple', Q.w + 4.5, HUB.z - 2.2), put('veg.birch', HUB.x - 2.75, HUB.z - 1.95),
  // the quad's east panels: a birch on the Main St corner and one behind the gate walk's north bench (nothing tall
  // right behind the gate, so its arch reads clearly from the camera)
  put('veg.birch', Q.e - 1.5, Q.s - 1.05), put('veg.birch', HUB.x + 2.95, HUB.z - 1.75),
  // West Halls block: poplars along West Rd beside the chapel
  put('veg.poplar', WB.w + 0.55, Q.s - 0.6), put('veg.poplar', WB.w + 0.55, Q.s - 2.4), put('veg.poplar', WB.w + 0.55, Q.s - 4.2),
];
const BEDS: PlacedAsset[] = [
  // Burrowes St and North Rd carry route 1 past the quad on its camera-hidden sides: only low planting there, so
  // buses stay readable and the clock tower keeps its calm, with lawn on its north and west (art bible §2.2, §5.2)
  put('veg.hedge', Q.w + 0.42, TOWER.z - 0.55, E, { length: 2.4 }),          // clipped hedge along Burrowes St
  put('veg.bush', LANE_X - 1.0, Q.n + 0.75),                                 // by the North Rd lane
  put('veg.flowerbed', TOWER.x - 1.1, TOWER.z + 1.6),                        // beside the tower door
  put('veg.bush', LANE_X + 1.0, Q.n + 0.6), put('veg.bush', LANE_X + 1.0, Q.n + 2.2), // low by the University stop's sight line
];
const FURNITURE: PlacedAsset[] = [
  // flags at the ends of the library forecourt
  put('st.flag', LIBRARY.x - 3.2, FRONT + 0.25, S, { color: 0 }), put('st.flag', LIBRARY.x + 3.15, FRONT + 0.25, S, { color: 1 }),
  // benches, lamps and a bin along Willard's walk, facing it
  put('st.bench', Q.w + 5.05, HUB.z + 0.75, N), put('st.bench', Q.w + 5.05, HUB.z - 0.75, S), put('st.bin', Q.w + 4.2, HUB.z + 0.75),
  put('st.lamp', HUB.x - 2.6, HUB.z + 0.75), put('st.lamp', HUB.x - 2.6, HUB.z - 0.75),
  // lamps and benches along the gate walk, mirroring Willard's side
  put('st.lamp', HUB.x + 2.4, HUB.z + 0.75), put('st.lamp', HUB.x + 2.4, HUB.z - 0.75),
  put('st.bench', HUB.x + 3.75, HUB.z + 0.75, N), put('st.bench', HUB.x + 3.75, HUB.z - 0.75, S),
  // the tower court and the North Rd lane
  put('st.lamp', TOWER.x + 1.45, Q.n + 0.45), put('st.lamp', LANE_X + 0.6, Q.n + 1.4),
  // the forecourt's east side: a bench facing the quad and the bikes
  put('st.bench', LIBRARY.x + 1.0, FRONT + 0.45, S), put('st.bikeRack', LIBRARY.x + 2.3, FRONT + 0.5, S),
  // Main St corner by the gate, and the chapel's corner
  put('st.bench', Q.e - 0.75, Q.s - 0.45, W), put('st.lamp', WB.e + 0.1, Q.s - 0.2),
];

export const CAMPUS: DistrictScenery = {
  id: 'campus',
  region: { center: CAMPUS_N.center, radius: CAMPUS_N.radius + 0.5 },
  items: [...BUILDINGS, ...TREES, ...BEDS, ...FURNITURE],
  paths: PATHS,
  areas: AREAS,
};
void W;
