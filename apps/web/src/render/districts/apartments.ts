// Owner: D3. Final scenery for the 'apartments' district: the south-east of the town.
//
// Anchors come from TOWN (packages/sim/src/map/town.ts), so small map tweaks carry over: Main St, Park Ave (ends at
// Allen St), South Rd, Atherton St, Allen St and Station Rd; the rail's east straight; the four apartment zone doors;
// the Apartments North/South stops on Station Rd's west kerb, whose queues grow west.
//
// Composition follows the art bible (docs/research/iso-art-direction.md): the camera looks from +x/+z, so heights
// step down toward the south and east, and route r2 (Station Rd → South Rd → Atherton St) keeps its camera side low.
// - Tower block (Allen ↔ Station Rd, the tall west side of Station Rd): Eastview (door on Main St) and Parkside (door
//   on South Rd) towers open east onto a paved promenade where both bus queues stand (2 u kept clear around each); a
//   pocket green between them ends the Park Ave vista and carries it on as a footpath to the promenade.
// - South side (Park Ave ↔ South Rd, west of Allen St; the back of the district): the garden walk-up and the Allen
//   Court tower on South Rd's tall north side, the tower 1.5 u off Allen St and well clear of Atherton St.
// - East band (Station Rd ↔ rail, the camera side of the stops): Garden Row, two cottages with a shared garden, a low
//   hedge to the street, a picket fence along the rail.
// - South band (South Rd ↔ lakeside, camera side of South Rd): two townhouse rows with picket-fenced back gardens,
//   the playground park on Allen St's axis, the residents' parking lot opposite Parkside; tall crowns only at the back.
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { AssetParams, PlacedAsset } from '../assets/types';
import type { DistrictScenery, FootPath, GroundArea } from './types';

const v = (x: number, z: number): Vec2 => ({ x, z });
const node = (id: string, fb: Vec2): Vec2 => TOWN.roads.nodes.find((n) => n.id === id)?.p ?? fb;
const door = (id: string, fb: Vec2): Vec2 => TOWN.zones.find((z) => z.id === id)?.door ?? fb;
const stop = (id: string, fb: Vec2): Vec2 => TOWN.stops.find((s) => s.id === id)?.p ?? fb;
const railPts = TOWN.rail.loop.points;

// Street lines and the rail.
const XA = node('j_main_atherton', v(-2, 0)).x;     // Atherton St
const XL = node('j_main_allen', v(12, 0)).x;        // Allen St
const XS = node('j_south_east', v(22.6, 14.6)).x;   // Station Rd
const ZM = node('j_main_allen', v(12, 0)).z;        // Main St
const ZP = node('j_park_allen', v(12, 6.8)).z;      // Park Ave
const ZS = node('j_south_allen', v(12, 14.6)).z;    // South Rd
// The rail's east straight bounds the east band; the south band ends 7.4 u past South Rd, or sooner if the rail runs
// there (the regional line now leaves the board south-east, so beyond that line is D5's lakeside outskirts).
const railNear = (pick: (p: Vec2) => boolean, get: (p: Vec2) => number, fb: number): number =>
  Math.min(fb, ...railPts.filter(pick).map(get));
const RX = railNear((p) => p.x > XS && p.z > ZM && p.z < ZS + 7.4, (p) => p.x, XS + 7.4);   // rail, east straight
const RZ = railNear((p) => p.z > ZS && p.x > XA && p.x < RX, (p) => p.z, ZS + 7.4);        // rail (or the lakeside)
// Doors and stops.
const D_EAST = door('z_eastview', v(15.3, 1.6));
const D_PARK = door('z_parkside', v(15.3, 12.5));
const D_COURT = door('z_southside', v(26.6, 4.3));
const D_GARDEN = door('z_garden_row', v(26.6, 12.9));
const S_NORTH = stop('stop_apts_north', v(21.45, 5.0));
const S_SOUTH = stop('stop_apts_south', v(21.45, 10.6));

// Rotations: the asset's front (+z) faces south (S), north (N), east (E) or west (W).
const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [v(x0, z0), v(x1, z0), v(x1, z1), v(x0, z1)];
const r2 = (n: number): number => Math.round(n * 100) / 100;

const items: PlacedAsset[] = [];
const put = (kind: string, x: number, z: number, rot = 0, params?: AssetParams, scale?: number): void => {
  const a: PlacedAsset = { kind, x: r2(x), z: r2(z), rot };
  if (params) a.params = params;
  if (scale !== undefined) a.scale = scale;
  items.push(a);
};
/** Trees take a free yaw; their shape, tone and size come from the placement seed. */
const tree = (kind: string, x: number, z: number, yaw = 0, scale?: number): void => put(`veg.${kind}`, x, z, yaw, undefined, scale);
const paths: FootPath[] = [];
const areas: GroundArea[] = [];

// ---------------------------------------------------------------- tower block (Allen St ↔ Station Rd)
// Towers stand 1.5 u off Allen St (the tall, west side of Station Rd); their east faces stop 2 u short of the queue
// lines (queue slots reach 2.4 u). Butter roofs with slate-blue or coral balconies: the district's roof family.
const TX = Math.min(XL + 3.27, S_NORTH.x - 2.4 - 2.0 - 1.78);
const EAST_Z = D_EAST.z + 0.1 + 1.75, PARK_Z = D_PARK.z - 0.05 - 1.75;
put('res.tower', TX, EAST_Z, E, { floors: 5, accent: 3, roof: 2, wall: 0 });   // Eastview Towers
put('res.tower', TX, PARK_Z, S, { floors: 5, accent: 0, roof: 2, wall: 1 });   // Parkside Towers, lobby to South Rd at its door
// Promenade: one paved forecourt along Station Rd holding both queues; a birch and a lamp between the two stops (the
// quiet zone keeps one lamp within 3 u of each stop).
const PX0 = TX + 1.88, PX1 = XS - 1.9;
areas.push({ kind: 'plaza', polygon: rect(PX0, ZM + 1.9, PX1, ZS - 1.9) });
const midZ = (S_NORTH.z + S_SOUTH.z) / 2;
tree('birch', PX0 + 1.3, midZ, 0.7);
put('st.lamp', XS - 1.55, midZ, W);
put('st.lamp', XS - 1.55, ZM + 1.75, W);
put('st.bikeRack', PX0 + 2.3, ZM + 2.25, S);
// Pocket green between the towers on the Park Ave axis; Park Ave carries on as a path to the promenade.
const G0 = EAST_Z + 1.75, G1 = PARK_Z - 1.75; // green spans z between the towers
areas.push({ kind: 'lawn', polygon: rect(XL + 1.9, G0 + 0.2, PX0 - 0.2, G1 - 0.2) });
paths.push({ points: [v(XL + 1.9, ZP), v(PX0 + 0.3, ZP)], width: 0.8, kind: 'footpath' });
put('veg.flowerbed', TX - 0.5, G0 + 0.6, S);
tree('birch', TX + 1.0, G0 + 0.75, 1.4);
put('st.bench', TX + 0.85, ZP + 0.95, N);

// ---------------------------------------------------------------- east band (Station Rd ↔ rail): Garden Row
// The camera side of Station Rd and its stops, so only cottages (≤ 2.4 u), low hedges and bushes face the street;
// the one tree stands by the rail. Southside cottage (door on its north end) faces Station Rd; the Garden Row cottage
// faces the South Rd spur. A picket fence runs along the rail behind both gardens.
const HX = D_COURT.x;
const HA_Z = D_COURT.z + 0.05 + 1.25, HB_Z = D_GARDEN.z - 0.05 - 1.25;
put('res.house', HX, HA_Z, W, { porch: 'left', style: 'side', roof: 0 });   // Southside cottage
put('res.house', HX, HB_Z, S, { porch: 'right', style: 'front' }); // Garden Row cottage
const gz0 = HA_Z + 1.25 + 0.4, gz1 = HB_Z - 1.25 - 0.4;
areas.push({ kind: 'garden', polygon: rect(XS + 2.0, gz0, RX - 1.5, gz1) });
put('veg.hedge', XS + 1.95, (gz0 + gz1) / 2, E, { length: r2(gz1 - gz0) });
put('veg.flowerbed', HX - 0.4, gz0 + 0.65, S);
put('veg.bush', HX - 1.0, gz1 - 0.6, 0);
put('veg.bush', HX + 0.4, gz1 - 0.5, 1.1);
tree('birch', RX - 2.0, (gz0 + gz1) / 2, 2.8);
put('st.fence', RX - 1.15, (HA_Z + HB_Z) / 2, E, { length: 7, style: 'picket' });
put('st.lamp', XS + 1.55, gz0 - 0.65, E);
put('st.lamp', XS + 1.55, ZS - 1.55, E);

// ---------------------------------------------------------------- south side (Park Ave ↔ South Rd, west of Allen)
// The back of the district (x + z ≈ 14–20) on South Rd's tall north side: the garden walk-up and the Allen Court
// tower. Nothing tall within reach of Atherton St (a bus route): the walk-up keeps 2.2 u off it.
const SIDE_Z = ZS - 1.6 - 1.75;
const AC_X = XL - 1.5 - 1.75;                 // Allen Court, 1.5 u off Allen St
const WU_X = AC_X - 1.75 - 0.8 - 3.0;         // walk-up, 0.8 u west of the tower
put('res.garden', WU_X, SIDE_Z, S, { scheme: 'brick', roof: 0, accent: 1 });
put('res.tower', AC_X, SIDE_Z, S, { floors: 6, accent: 3, roof: 2, wall: 2 });  // Allen Court
put('veg.hedge', WU_X, ZP + 1.95, S, { length: 5 });
put('veg.bush', XA + 2.0, ZP + 2.0, 0.6);
put('st.lamp', AC_X - 2.15, ZS - 1.55, S);
put('st.lamp', AC_X - 2.15, ZP + 1.55, N);

// ---------------------------------------------------------------- south band (South Rd ↔ rail), fronts north
// Camera side of South Rd (a bus route): townhouses (≤ 2.8 u) 2 u back, tall crowns only in the back gardens.
const ZF = ZS + 2.0;            // building fronts
const ZB = ZF + 2.5;            // townhouse backs
const FENCE_Z = RZ - 1.15;      // back-garden fences
// Townhouse row A with back gardens; birches and a poplar at the Atherton St end (not a bus route south of South Rd).
const TA = XA + 6.0;
put('res.townhouses', TA, ZF + 1.25, N);
put('st.fence', TA, FENCE_Z, S, { length: 6, style: 'picket' });
areas.push({ kind: 'garden', polygon: rect(TA - 2.9, ZB + 0.2, TA + 2.9, FENCE_Z - 0.2) });
tree('cherry', TA - 2.0, ZB + 0.9, 0.6);
put('veg.flowerbed', TA + 0.0, ZB + 0.75, S);
tree('birch', TA + 1.9, ZB + 0.9, 2.2);
tree('birch', XA + 2.1, ZF + 0.75, 0.3);
tree('birch', XA + 2.2, ZF + 2.45, 1.9);
tree('poplar', XA + 2.2, FENCE_Z, 0.9);
// The playground park on Allen St's axis: a U of lawn, birches behind, bushes at the front, a bench for parents.
const PG_X = TA + 3.0 + 1.3 + 2.0, PG_Z = ZF + 1.5;
put('res.playground', PG_X, PG_Z, S);
const UX0 = PG_X - 2.8, UX1 = PG_X + 2.9, UZ0 = ZS + 1.9, UZ1 = RZ - 1.4;
areas.push({
  kind: 'lawn',
  polygon: [v(UX0, UZ0), v(PG_X - 2.2, UZ0), v(PG_X - 2.2, PG_Z + 1.7), v(PG_X + 2.2, PG_Z + 1.7), v(PG_X + 2.2, UZ0), v(UX1, UZ0), v(UX1, UZ1), v(UX0, UZ1)],
});
tree('birch', PG_X - 2.55, ZB + 0.9, 1.2);
tree('birch', PG_X + 2.55, ZB + 0.9, 2.4);
put('veg.bush', PG_X - 2.5, ZF + 0.45, 0.4);
put('veg.bush', PG_X + 2.55, ZF + 0.45, 2.0);
put('st.bench', PG_X, ZB + 1.15, N);
// Residents' parking opposite Parkside, hedged toward the townhouses.
const LOT_X = XL + 4.5;
put('res.parking', LOT_X, ZS + 1.85 + 2.0, N, { cars: 4 });
put('veg.hedge', LOT_X + 3.45, ZS + 3.85, E, { length: 3.6 });
// Townhouse row B with back gardens, a birch at the corner by the rail.
const TB = XS + 0.9;
put('res.townhouses', TB, ZF + 1.25, N);
put('st.fence', TB - 0.5, RZ - 1.5, S, { length: 5, style: 'picket' });
areas.push({ kind: 'garden', polygon: rect(TB - 2.9, ZB + 0.2, TB + 1.9, RZ - 1.7) });
tree('birch', TB - 2.0, ZB + 0.7, 1.0);
put('veg.bush', TB + 0.2, ZB + 0.9, 0);
tree('birch', TB + 1.4, ZB + 0.65, 2.6);
tree('birch', TB + 3.9, ZF + 0.8, 2.2);
// Street furniture along South Rd's south side.
for (const x of [XA + 2.8, TA + 3.4, XL + 1.1, LOT_X + 3.5, TB + 3.4]) put('st.lamp', x, ZS + 1.55, N);
put('st.mailbox', TA - 1.4, ZS + 1.6, N);
put('st.hydrant', TB - 1.5, ZS + 1.65, N);

// Region: the tower block, the east band south of the Central Station building, the south side and the south band
// (Block Main/Park/Atherton/Allen stays with downtown and its Downtown stop; west of Atherton is the stadium's).
const REGION: Vec2[] = [
  v(XL, ZM), v(XS, ZM), v(XS, D_COURT.z - 1.3), v(RX, D_COURT.z - 1.3), v(RX, RZ), v(XA, RZ), v(XA, ZP), v(XL, ZP),
];

export const APARTMENTS: DistrictScenery = {
  id: 'apartments',
  region: { polygon: REGION },
  items,
  paths,
  areas,
};
