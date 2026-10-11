// Owner: D2. Downtown: a dense red-brick college-town main street between Atherton St and Station Rd.
//
// Layout (x east, z south; the default camera looks from +x/+z, so fronts face south or east wherever possible):
// - Main St north side, Atherton → Allen: an unbroken street wall (2-storey shop, 4-storey midrise across from the
//   Downtown stop, the turreted corner building on the Main/Allen corner) behind a wide paved sidewalk with
//   lamps, planters, a bench and a bike rack. These are the tallest buildings: they sit on the far side of the
//   busiest street, so they never hide a bus.
// - Beaver Ave north side: a storefront row and a café facing the street.
// - East of Allen: the theater on Main St with its marquee over the sidewalk, and behind it Central Plaza, a
//   small square with a fountain, benches, café tables, cherry trees and flags, open to North Rd and to
//   Central Station across Station Rd (so buses heading for the station stay visible).
// - South side of Main St: Downtown Square, the paved forecourt of the Downtown stop. The queue lane is left
//   clear all the way to Park Ave; only low things (kiosk, café, umbrellas) sit on the camera side of the stop.
//
// Rules: big footprints keep ≥ 1.55 u from road centrelines, street furniture stands on the 1.47 u lamp line,
// 2 u stay clear around stops and queue lines, and colour variants are pinned so neighbours never clash.
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { AssetParams, PlacedAsset } from '../assets/types';
import type { DistrictScenery, FootPath, GroundArea } from './types';

// ------------------------------------------------------------------------------------------------ street frame

const node = (id: string, fx: number, fz: number): Vec2 => TOWN.roads?.nodes.find((n) => n.id === id)?.p ?? { x: fx, z: fz };
const X_ATH = node('j_main_atherton', -2, 0).x;
const X_ALLEN = node('j_main_allen', 12, 0).x;
const X_STN = node('j_main_east', 22.6, 0).x;
const Z_MAIN = node('j_main_allen', 12, 0).z;
const Z_BEAVER = node('j_beaver_allen', 12, -8).z;
const Z_NORTH = node('j_north_allen', 12, -14.6).z;
const Z_PARK = node('j_park_allen', 12, 6.8).z;

/** Road half-width (kerb line) and the line street furniture stands on, both from the centreline. */
const KERB = 1.2;
const LAMP = 1.47;
/** Big footprints keep this far from road centrelines (validate needs 1.5). */
const EDGE = 1.55;

const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const v = (x: number, z: number): Vec2 => ({ x, z });

const items: PlacedAsset[] = [];
const put = (kind: string, x: number, z: number, rot = 0, params?: AssetParams): void => {
  items.push({ kind, x: round(x), z: round(z), rot, ...(params ? { params } : {}) });
};
const round = (n: number): number => Math.round(n * 1000) / 1000;
const lamp = (x: number, z: number) => put('st.lamp', x, z);
const planter = (x: number, z: number, variant: number) => put('veg.planter', x, z, 0, { variant });
const signal = (x: number, z: number, rot: number) => put('st.trafficLight', x, z, rot);

// ------------------------------------------------------------------------------------------------ Main St, north side

// Footprint fronts sit 2.35 u back from the centreline: facades line up ~2.8 u back, leaving a wide sidewalk.
const MAIN_N = Z_MAIN - 2.35;
put('dt.shop', X_ATH + EDGE + 1.5, MAIN_N - 1.5, S, { variant: 1, storeys: 2 });
put('dt.midrise', X_ATH + EDGE + 3 + 2 - 0.05, MAIN_N - 2, S, { variant: 2 });
put('dt.corner', X_ALLEN - EDGE - 2, MAIN_N - 2, S, { variant: 1 }); // turret on the Main/Allen corner

{
  const z = Z_MAIN - LAMP;
  signal(X_ATH + LAMP, z, Math.PI * 0.75);
  planter(0.95, Z_MAIN - 1.8, 0);
  lamp(2.2, z);
  put('st.bench', 3.5, Z_MAIN - 1.85, S);
  planter(4.85, Z_MAIN - 1.8, 1);
  lamp(6.1, z);
  put('st.bikeRack', 7.45, Z_MAIN - 1.85, S, { color: 2, color2: 0 });
  planter(8.85, Z_MAIN - 1.8, 2);
  signal(X_ALLEN - LAMP, z, Math.PI * 0.25);
}

// Back of the Main St row on Beaver Ave: a slim poplar at the Atherton end and a couple of lamps.
put('veg.poplar', 0.5, Z_BEAVER + 2.05, 0, { variant: 1 });
lamp(3.0, Z_BEAVER + LAMP);
lamp(7.6, Z_BEAVER + LAMP);
lamp(X_ALLEN - LAMP, Z_BEAVER + LAMP);

// ------------------------------------------------------------------------------------------------ Beaver Ave, north side

const BEAVER_N = Z_BEAVER - 1.6;
put('dt.shopRow', X_ATH + EDGE + 3.5, BEAVER_N - 1.5, S, { variant: 5 });
put('dt.cafe', X_ATH + EDGE + 7 + 1.5 - 0.05, BEAVER_N - 1.5, S, { variant: 6 });
put('veg.poplar', X_ALLEN - 2.05, BEAVER_N - 0.65, 0, { variant: 2 });
lamp(0.3, Z_BEAVER - LAMP);
lamp(5.1, Z_BEAVER - LAMP);
// North Rd behind the row, Allen St beside it.
lamp(1.5, Z_NORTH + LAMP);
lamp(7.5, Z_NORTH + LAMP);
lamp(X_ALLEN - LAMP, -12.2);

// ------------------------------------------------------------------------------------------------ East of Allen: theater + Central Plaza

put('dt.theater', X_ALLEN + EDGE + 2.5, Z_MAIN - 2 - 2, S, { variant: 3 });
put('dt.cafe', X_ALLEN + EDGE + 1.5, Z_NORTH + EDGE + 1.5, E, { variant: 0 }); // terrace on the plaza
signal(X_ALLEN + LAMP, Z_MAIN - LAMP, -Math.PI * 0.25);
signal(X_STN - LAMP, Z_MAIN - LAMP, Math.PI * 0.25);

// The plaza: a fountain ringed by benches, café umbrellas by the café, cherry trees, a kiosk, flags toward the station.
const FX = 18.85, FZ = -10.4;
put('st.fountain', FX, FZ);
put('st.bench', FX, FZ - 1.95, S);
put('st.bench', FX, FZ + 1.95, N);
put('st.bench', FX + 1.9, FZ, W);
put('st.bench', FX - 1.9, FZ, E);
put('st.tableUmbrella', 17.3, -12.55, 0, { color: 0 });
put('st.tableUmbrella', 17.3, -8.3, 0, { color: 2 });
put('veg.cherry', 20.25, -7.0, 0, { variant: 0 });
put('st.kiosk', 20.4, -5.6, E, { color: 1 });
put('st.bikeRack', 17.4, -6.7, S, { color: 1, color2: 3 });
put('st.flag', 19.7, -12.95, 0, { color: 0 });
put('st.flag', 20.6, -12.45, 0, { color: 1 });
put('st.flag', 21.05, -11.55, 0, { color: 2 });
planter(20.85, -8.9, 3);
lamp(X_STN - LAMP, -5.0);
lamp(X_ALLEN + LAMP, -7.0);
lamp(X_ALLEN + LAMP, -9.5);
// A green strip behind the theater with two shade trees and a lane from Allen St into the plaza.
put('veg.oak', 15.4, -7.25, 0, { variant: 1 });
put('veg.maple', 15.4, -9.15, 0, { variant: 2 });
// The Main/Station corner: a big tree and a planter by the theater.
put('veg.oak', 20.0, -3.5, 0, { variant: 3 });
planter(19.2, Z_MAIN - 1.85, 4);

// ------------------------------------------------------------------------------------------------ Downtown Square (south side of Main St)

put('dt.cafe', X_ALLEN - EDGE - 1.5, 3.7, E, { variant: 7 }); // terrace faces Allen St and the camera
put('st.kiosk', 6.65, 2.35, S, { color: 0 });
put('st.tableUmbrella', 6.65, 4.4, 0, { color: 1 });
put('veg.maple', 0.45, 4.35, 0, { variant: 0 });
put('st.bench', -0.05, 2.75, E);
put('st.bikeRack', 0.95, 2.75, E, { color: 0, color2: 1 });
signal(X_ATH + LAMP, Z_MAIN + LAMP, -Math.PI * 0.75 + Math.PI);
signal(X_ALLEN - LAMP, Z_MAIN + LAMP, Math.PI * 1.25);
lamp(6.3, Z_MAIN + LAMP);
lamp(5.9, Z_PARK - LAMP);

// ------------------------------------------------------------------------------------------------ ground

const areas: GroundArea[] = [
  // Downtown Square: kerb to kerb between Main St and Park Ave.
  { kind: 'plaza', polygon: [v(X_ATH + KERB + 0.05, Z_MAIN + KERB + 0.05), v(X_ALLEN - KERB - 0.05, Z_MAIN + KERB + 0.05), v(X_ALLEN - KERB - 0.05, Z_PARK - KERB - 0.05), v(X_ATH + KERB + 0.05, Z_PARK - KERB - 0.05)] },
  // Central Plaza: the open east half of the Allen–Station block, wrapping the theater's side.
  {
    kind: 'plaza',
    polygon: [
      v(16.6, Z_NORTH + KERB + 0.05), v(20.6, Z_NORTH + KERB + 0.05), v(21.05, -13.25), v(X_STN - KERB - 0.05, -12.6),
      v(X_STN - KERB - 0.05, Z_MAIN - KERB - 0.05), v(18.6, Z_MAIN - KERB - 0.05), v(18.6, -6.0), v(16.6, -6.0),
    ],
  },
  // The wide Main St sidewalk in front of the north row.
  { kind: 'plaza', polygon: [v(X_ATH + KERB + 0.05, Z_MAIN - KERB - 0.05), v(X_ALLEN - KERB - 0.05, Z_MAIN - KERB - 0.05), v(X_ALLEN - KERB - 0.05, MAIN_N - 0.05), v(X_ATH + KERB + 0.05, MAIN_N - 0.05)] },
  // The green strip behind the theater.
  { kind: 'garden', polygon: [v(X_ALLEN + KERB + 0.05, -10.0), v(16.6, -10.0), v(16.6, -6.0), v(X_ALLEN + KERB + 0.05, -6.0)] },
];

const paths: FootPath[] = [
  { kind: 'footpath', width: 0.9, points: [v(X_ALLEN + KERB + 0.05, -8.2), v(16.6, -8.2)] },
];

export const DOWNTOWN: DistrictScenery = {
  id: 'downtown',
  // Street-bounded: Atherton St → North Rd → Station Rd → Main St, plus the Downtown Square block down to Park Ave.
  region: { polygon: [v(X_ATH, Z_NORTH), v(X_STN, Z_NORTH), v(X_STN, Z_MAIN), v(X_ALLEN, Z_MAIN), v(X_ALLEN, Z_PARK), v(X_ATH, Z_PARK)] },
  items,
  paths,
  areas,
};
