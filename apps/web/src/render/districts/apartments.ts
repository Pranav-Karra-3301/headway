// Owner: D3. Final scenery for the 'apartments' district: the south-east of the town inside the railway.
//
// Anchors come from TOWN (packages/sim/src/map/town.ts), so small map tweaks carry over: Main St, Park Ave (ends at
// Allen St), South Rd, Atherton St, Allen St and Station Rd; the rail's south and east straights; the four apartment
// zone doors; the Apartments North/South stops on Station Rd's west kerb, whose queues grow west.
//
// Composition (camera looks from +x/+z, so things step down toward the south and east):
// - Tower block (Allen ↔ Station Rd): Eastview (door on Main St) and Parkside (door on South Rd) towers open east onto
//   a paved promenade where both bus queues stand (2 u kept clear around each); a pocket green between them ends
//   the Park Ave vista and carries it on as a footpath to the promenade.
// - East band (Station Rd ↔ rail): the Station Court tower facing the stops, Garden Row cottage in its garden.
// - South side (Park Ave ↔ South Rd, west of Allen St): a garden walk-up and its playground.
// - South band (South Rd ↔ rail): two townhouse rows with picket-fenced back gardens (the side the camera sees),
//   a green with a big tree on Allen St's axis, the residents' parking lot opposite Parkside, trees in the rail bend.
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
const RX = Math.max(...railPts.map((p) => p.x));    // rail, east straight
const RZ = Math.max(...railPts.map((p) => p.z));    // rail, south straight
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
// Towers stand 1.5 u off Allen St; their east faces stop 2 u short of the queue lines (queue slots reach 2.4 u).
const TX = Math.min(XL + 3.27, S_NORTH.x - 2.4 - 2.0 - 1.78);
const EAST_Z = D_EAST.z + 0.1 + 1.75, PARK_Z = D_PARK.z - 0.05 - 1.75;
put('res.tower', TX, EAST_Z, E, { floors: 5, accent: 1, wall: 0 });   // Eastview Towers
put('res.tower', TX, PARK_Z, E, { floors: 6, accent: 2, wall: 1 });   // Parkside Towers
// Promenade: one paved forecourt along Station Rd holding both queues; a birch and a lamp between the two stops.
const PX0 = TX + 1.88, PX1 = XS - 1.9;
areas.push({ kind: 'plaza', polygon: rect(PX0, ZM + 1.9, PX1, ZS - 1.9) });
const midZ = (S_NORTH.z + S_SOUTH.z) / 2;
tree('birch', PX0 + 1.3, midZ, 0.7);
put('st.lamp', XS - 1.55, midZ, W);
put('st.lamp', XS - 1.55, ZM + 1.75, W);
put('st.lamp', XS - 1.55, ZS - 1.55, W);
put('st.bikeRack', PX0 + 2.3, ZM + 2.25, S);
// Pocket green between the towers on the Park Ave axis; Park Ave carries on as a path to the promenade.
const G0 = EAST_Z + 1.75, G1 = PARK_Z - 1.75; // green spans z between the towers
areas.push({ kind: 'lawn', polygon: rect(XL + 1.9, G0 + 0.2, PX0 - 0.2, G1 - 0.2) });
paths.push({ points: [v(XL + 1.85, ZP), v(PX0 + 0.3, ZP)], width: 0.8, kind: 'footpath' });
put('veg.flowerbed', TX, G0 + 0.6, S);
tree('birch', TX - 0.7, G1 - 0.85, 2.1);
put('st.bench', TX + 0.85, ZP + 0.95, N);

// ---------------------------------------------------------------- east band (Station Rd ↔ rail)
const COURT_Z = D_COURT.z + 0.05 + 1.75, GARDEN_Z = D_GARDEN.z - 0.05 - 1.25;
put('res.tower', D_COURT.x, COURT_Z, W, { floors: 7, accent: 0, wall: 2 }); // Station Court, lobby to the stops
put('res.house', D_GARDEN.x, GARDEN_Z, S, { porch: 'right', style: 'front' }); // Garden Row cottage
const gz0 = COURT_Z + 1.95, gz1 = GARDEN_Z - 1.4;
areas.push({ kind: 'garden', polygon: rect(XS + 2.0, gz0, RX - 1.5, gz1) });
tree('maple', D_COURT.x + 0.3, (gz0 + gz1) / 2, 1.3);
put('st.lamp', XS + 1.55, D_COURT.z - 0.7, E);
put('st.lamp', XS + 1.55, (gz0 + gz1) / 2, E);
put('st.lamp', XS + 1.55, ZS - 1.55, E);

// ---------------------------------------------------------------- south side (Park Ave ↔ South Rd, west of Allen)
const SIDE_Z = ZS - 1.6 - 1.75;
put('res.garden', XA + 4.6, SIDE_Z, S, { scheme: 'brick', accent: 1 });
put('res.playground', XL - 3.5, ZS - 1.7 - 1.5, S);
put('veg.hedge', XL - 3.5, ZP + 2.45, S, { length: 4 });
put('st.lamp', XL - 5.95, ZS - 1.55, S);
put('st.lamp', XA + 7.9, ZP + 1.55, N);
tree('birch', XA + 1.9, ZP + 1.95, 0.4);

// ---------------------------------------------------------------- south band (South Rd ↔ rail), fronts north
const ZF = ZS + 2.0;            // building fronts
const ZB = ZF + 2.5;            // townhouse backs
const FENCE_Z = RZ - 1.15;      // back-garden fences, clear of the rail bed
// Townhouse row A with back gardens.
const TA = XA + 6.0;
put('res.townhouses', TA, ZF + 1.25, N);
put('st.fence', TA, FENCE_Z, S, { length: 6, style: 'picket' });
areas.push({ kind: 'garden', polygon: rect(TA - 2.9, ZB + 0.2, TA + 2.9, FENCE_Z - 0.2) });
tree('cherry', TA - 2.0, ZB + 0.9, 0.6);
put('veg.bush', TA + 0.1, ZB + 1.0, 0);
put('veg.flowerbed', TA + 1.9, ZB + 0.9, S);
tree('birch', XA + 2.1, ZF + 0.75, 0.3);
tree('birch', XA + 2.2, ZF + 2.45, 1.9);
// The green on Allen St's axis: a big tree ends the vista; a path leads to a bench facing the trains.
const GW0 = TA + 3.6, GW1 = XL + 1.0;
areas.push({ kind: 'lawn', polygon: rect(GW0, ZF, GW1, RZ - 1.4) });
tree('oak', XL - 0.4, ZF + 1.6, 1.2);
tree('maple', GW0 + 1.2, ZF + 2.9, 2.6);
put('veg.flowerbed', GW0 + 1.3, ZF + 0.6, S);
put('st.bench', (GW0 + GW1) / 2 + 0.2, RZ - 1.85, S);
paths.push({ points: [v((GW0 + GW1) / 2 - 0.4, ZS + 1.9), v((GW0 + GW1) / 2 - 0.3, ZF + 1.4), v((GW0 + GW1) / 2 + 0.2, RZ - 2.45)], width: 0.75, kind: 'footpath' });
// Residents' parking opposite Parkside, hedged at the sides.
const LOT_X = XL + 4.5;
put('res.parking', LOT_X, ZS + 1.85 + 2.0, N, { cars: 4 });
put('veg.hedge', LOT_X - 3.45, ZS + 3.95, E, { length: 3.6 });
put('veg.hedge', LOT_X + 3.45, ZS + 3.95, E, { length: 3.6 });
// Townhouse row B with back gardens, trees in the rail bend.
const TB = XS + 0.9;
put('res.townhouses', TB, ZF + 1.25, N);
put('st.fence', TB - 0.5, RZ - 1.5, S, { length: 5, style: 'picket' });
areas.push({ kind: 'garden', polygon: rect(TB - 2.9, ZB + 0.2, TB + 1.9, RZ - 1.7) });
tree('birch', TB - 2.0, ZB + 0.85, 1.0);
put('veg.bush', TB + 0.2, ZB + 0.9, 0);
tree('birch', TB + 3.9, ZF + 0.8, 2.2);
// Street furniture along South Rd's south side.
for (const x of [XA + 2.8, TA + 3.4, XL + 1.1, LOT_X + 3.5, TB + 3.4]) put('st.lamp', x, ZS + 1.55, N);
put('st.mailbox', TA - 1.4, ZS + 1.6, N);
put('st.hydrant', TB - 1.5, ZS + 1.65, N);

// Region: the tower block, the east band south of the Central Station building, the south side and the south band
// (Block Main/Park/Atherton/Allen stays with downtown and its Downtown stop; west of Atherton is the stadium's).
const REGION: Vec2[] = [
  v(XL, ZM), v(XS, ZM), v(XS, D_COURT.z - 1.3), v(RX, D_COURT.z - 1.3), v(RX, RZ - 6), v(RX - 0.8, RZ - 3), v(RX - 3, RZ - 0.8),
  v(RX - 6, RZ), v(XA, RZ), v(XA, ZP), v(XL, ZP),
];

export const APARTMENTS: DistrictScenery = {
  id: 'apartments',
  region: { polygon: REGION },
  items,
  paths,
  areas,
};
