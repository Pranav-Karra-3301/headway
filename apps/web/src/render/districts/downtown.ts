// Owner: D2. Downtown: a dense red-brick college-town main street between Atherton St and Station Rd.
//
// Layout (x east, z south; the default camera looks from +x/+z, so fronts face south or east wherever possible):
// - Main St, north side, Atherton → Allen: an unbroken street wall (a 2-storey shop for Main St Market, a 4-storey
//   midrise, the turreted corner building on the Main/Allen corner) behind a wide paved sidewalk with lamps,
//   planters, a bench and a bike rack. The tallest buildings stand here, on the far side of the busiest street,
//   so they never hide a bus or a queue.
// - Beaver Ave, north side: a storefront row and a café.
// - East of Allen: the theater on Main St (marquee over the sidewalk, facing Central Station's approach), and behind
//   it Central Plaza: a fountain ringed by benches, café umbrellas, cherry trees and flags, open to North Rd and
//   Station Rd so buses running to Central Station stay in view.
// - Main St, south side: Downtown Square, the paved forecourt of the Downtown stop. The queue lane stays clear to
//   Park Ave; only low pieces (kiosk, umbrellas, a tree) sit on the camera side of the stop.
//
// Rules: big footprints keep ≥ 1.55 u from road centrelines; street furniture stands on the 1.47 u lamp line;
// 2 u stay clear around stops, platforms and queue lines; colour variants are pinned so neighbours never clash.
// Anchors come from TOWN; a final pass drops any furniture that would break a clearance if TOWN moves.
import { TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { footprintOf } from '../assets/validate';
import type { AssetParams, PlacedAsset } from '../assets/types';
import type { DistrictScenery, FootPath, GroundArea } from './types';

// ------------------------------------------------------------------------------------------------ street frame

const v = (x: number, z: number): Vec2 => ({ x, z });
const node = (id: string, fallback: Vec2): Vec2 => TOWN.roads?.nodes.find((n) => n.id === id)?.p ?? fallback;
const X_ATH = node('j_main_atherton', v(-2, 0)).x;
const X_ALLEN = node('j_main_allen', v(12, 0)).x;
const X_STN = node('j_main_east', v(22.6, 0)).x;
const Z_MAIN = node('j_main_allen', v(12, 0)).z;
const Z_BEAVER = node('j_beaver_allen', v(12, -8)).z;
const Z_NORTH = node('j_north_allen', v(12, -14.6)).z;
const Z_PARK = node('j_park_allen', v(12, 6.8)).z;
const STOP = TOWN.stops?.find((s) => s.id === 'stop_downtown')?.p ?? v(6.5, 1.15);

/** Kerb line, street-furniture line and the setback of big footprints, all measured from road centrelines. */
const KERB = 1.2;
const LAMP = 1.47;
const EDGE = 1.55;

const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;
const round = (n: number): number => Math.round(n * 1000) / 1000;

const placed: PlacedAsset[] = [];
const put = (kind: string, x: number, z: number, rot = 0, params?: AssetParams): void => {
  placed.push({ kind, x: round(x), z: round(z), rot, ...(params ? { params } : {}) });
};
const lamp = (x: number, z: number) => put('st.lamp', x, z);
const planter = (x: number, z: number, variant: number) => put('veg.planter', x, z, 0, { variant });
/** Traffic light on an intersection corner, heads turned toward the crossing. */
const signal = (x: number, z: number, cx: number, cz: number) => put('st.trafficLight', x, z, Math.atan2(cx - x, cz - z));

// ------------------------------------------------------------------------------------------------ Main St, north side

// Footprint fronts sit 2.35 u back from the centreline, so facades line up ~2.8 u back behind a wide sidewalk.
const MAIN_N = Z_MAIN - 2.35;
put('dt.shop', X_ATH + EDGE + 1.5, MAIN_N - 1.5, S, { variant: 1, storeys: 2 }); // Main St Market
put('dt.midrise', X_ATH + EDGE + 3 + 2 - 0.05, MAIN_N - 2, S, { variant: 2 });
put('dt.corner', X_ALLEN - EDGE - 2, MAIN_N - 2, S, { variant: 1 }); // turret on the Main/Allen corner
{
  const z = Z_MAIN - LAMP;
  signal(X_ATH + LAMP, z, X_ATH, Z_MAIN);
  planter(0.95, Z_MAIN - 1.8, 0);
  lamp(2.2, z);
  put('st.bench', 3.5, Z_MAIN - 1.85, S);
  planter(4.85, Z_MAIN - 1.8, 1);
  lamp(6.1, z);
  put('st.bikeRack', 7.45, Z_MAIN - 1.85, S, { color: 2, color2: 0 });
  planter(8.85, Z_MAIN - 1.8, 2);
  signal(X_ALLEN - LAMP, z, X_ALLEN, Z_MAIN);
}
// Behind the row, on Beaver Ave: a slim poplar at the Atherton end and the street lamps.
put('veg.poplar', X_ATH + 2.5, Z_BEAVER + 2.05, 0, { variant: 1 });
put('st.bikeRack', X_ATH + 3.8, Z_BEAVER + 1.8, S, { color: 3, color2: 2 });
lamp(3.0, Z_BEAVER + LAMP);
lamp(7.6, Z_BEAVER + LAMP);
lamp(X_ALLEN - LAMP, Z_BEAVER + LAMP);

// ------------------------------------------------------------------------------------------------ Beaver Ave, north side

const BEAVER_N = Z_BEAVER - 1.6;
put('dt.shopRow', X_ATH + EDGE + 3.5, BEAVER_N - 1.5, S, { variant: 5 }); // Beaver Ave Shops
put('dt.cafe', X_ATH + EDGE + 7 + 1.5 - 0.05, BEAVER_N - 1.5, S, { variant: 6 });
put('veg.poplar', X_ALLEN - 2.05, BEAVER_N - 0.65, 0, { variant: 2 });
lamp(0.3, Z_BEAVER - LAMP);
lamp(5.1, Z_BEAVER - LAMP);
// North Rd behind the row, Allen St beside it.
lamp(1.5, Z_NORTH + LAMP);
lamp(7.5, Z_NORTH + LAMP);
lamp(X_ALLEN - LAMP, Z_NORTH + 2.4);

// ------------------------------------------------------------------------------------------------ East of Allen: theater + Central Plaza

put('dt.theater', X_ALLEN + EDGE + 2.5, Z_MAIN - 2 - 2, S, { variant: 2 }); // Allen Corner: red brick, teal blade sign
put('dt.cafe', X_ALLEN + EDGE + 1.5, Z_NORTH + EDGE + 1.5, E, { variant: 0 }); // terrace on the plaza
signal(X_ALLEN + LAMP, Z_MAIN - LAMP, X_ALLEN, Z_MAIN);
signal(X_STN - LAMP, Z_MAIN - LAMP, X_STN, Z_MAIN);

// The plaza: a fountain ringed by four benches, café umbrellas on the café side, cherry trees on the station side,
// two flags on Station Rd facing Central Station.
const FX = 18.85, FZ = -9.4;
put('st.fountain', FX, FZ);
put('st.bench', FX, FZ - 1.95, S);
put('st.bench', FX, FZ + 1.95, N);
put('st.bench', FX - 1.9, FZ, E);
put('st.bench', FX + 1.9, FZ, W);
put('st.tableUmbrella', 17.15, -12.35, 0, { color: 0 });
put('st.tableUmbrella', 17.15, -7.0, 0, { color: 2 });
planter(17.2, -10.9, 3);
put('veg.cherry', 20.2, -12.0, 0, { variant: 0 });
put('veg.cherry', 20.2, -6.85, 0, { variant: 1 });
put('st.flag', X_STN - 1.45, -10.9, 0, { color: 0 });
put('st.flag', X_STN - 1.45, -7.9, 0, { color: 2 });
lamp(X_STN - LAMP, -4.6);
lamp(X_ALLEN + LAMP, -7.0);
lamp(X_ALLEN + LAMP, -9.6);
lamp(18.4, Z_NORTH + LAMP);
// A green strip behind the theater: two shade trees either side of a lane from Allen St into the plaza.
put('veg.oak', 15.35, -7.05, 0, { variant: 1 });
put('veg.maple', 15.35, -9.2, 0, { variant: 2 });
// The Main/Station corner, facing Central Station: a big tree, a kiosk, a planter; bikes by the theater.
put('veg.oak', 20.05, -3.15, 0, { variant: 3 });
put('st.kiosk', 19.95, -5.0, E, { color: 1 });
planter(19.2, Z_MAIN - 1.85, 4);
put('st.bikeRack', 14.6, Z_MAIN - 1.8, S, { color: 1, color2: 3 });

// ------------------------------------------------------------------------------------------------ Downtown Square (south side of Main St)

// The stop's queue lane (STOP.x ± 2) stays open from the kerb to Park Ave.
put('dt.cafe', X_ATH + EDGE + 1.5, 3.7, E, { variant: 7 }); // terrace opens onto the square
put('st.tableUmbrella', 3.55, 2.45, 0, { color: 1 });
put('st.bench', 3.75, 4.45, E);
put('st.kiosk', STOP.x + 3.05, 2.45, S, { color: 0 });
put('veg.oak', STOP.x + 3.05, 4.35, 0, { variant: 0 });
signal(X_ATH + LAMP, Z_MAIN + LAMP, X_ATH, Z_MAIN);
signal(X_ALLEN - LAMP, Z_MAIN + LAMP, X_ALLEN, Z_MAIN);
lamp(3.0, Z_MAIN + LAMP);
lamp(3.1, Z_PARK - LAMP);
lamp(STOP.x + 1.9, Z_PARK - LAMP);

// ------------------------------------------------------------------------------------------------ clearance pass

/** Rect of a placement's footprint. */
const rectOf = (a: PlacedAsset) => {
  const f = footprintOf(a);
  return { minX: a.x - f.w / 2, maxX: a.x + f.w / 2, minZ: a.z - f.d / 2, maxZ: a.z + f.d / 2, w: f.w, d: f.d };
};
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.z + vz * t - p.z);
}
const QUEUES = [
  ...(TOWN.stops ?? []).map((s) => [s.p, s.queueDir] as const),
  ...(TOWN.rail?.stations ?? []).map((s) => [s.platform, s.queueDir] as const),
].map(([p, d]) => [p, v(p.x + d.x * 2.4, p.z + d.z * 2.4)] as const);
/** True when a street-furniture placement keeps clear of roads (validate's rule), stops and queue lines. */
function clear(a: PlacedAsset): boolean {
  const r = rectOf(a);
  const pts = [v(r.minX, r.minZ), v(r.maxX, r.minZ), v(r.minX, r.maxZ), v(r.maxX, r.maxZ), v(a.x, a.z)];
  const need = Math.max(r.w, r.d) <= 1.3 ? 1.25 : 1.5;
  for (const e of TOWN.roads?.edges ?? []) {
    const q = e.path.points;
    for (let i = 0; i + 1 < q.length; i++) for (const p of pts) if (segDist(p, q[i]!, q[i + 1]!) < need + 0.01) return false;
  }
  // 2 u around every queue line: sample the rect's edges against each segment.
  for (const [p0, p1] of QUEUES) {
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      if (i > 0 && i < 8 && j > 0 && j < 8) continue;
      if (segDist(v(r.minX + (r.w * i) / 8, r.minZ + (r.d * j) / 8), p0, p1) < 2.01) return false;
    }
    if (a.x > Math.min(p0.x, p1.x) - r.w / 2 - 2 && a.x < Math.max(p0.x, p1.x) + r.w / 2 + 2 &&
      a.z > Math.min(p0.z, p1.z) - r.d / 2 - 2 && a.z < Math.max(p0.z, p1.z) + r.d / 2 + 2 &&
      segDist(v(a.x, a.z), p0, p1) < 2.01 + Math.min(r.w, r.d) / 2) return false;
  }
  return true;
}
const overlaps = (a: PlacedAsset, b: PlacedAsset): boolean => {
  const fa = footprintOf(a), fb = footprintOf(b);
  return Math.abs(a.x - b.x) * 2 < fa.w + fb.w - 0.2 && Math.abs(a.z - b.z) * 2 < fa.d + fb.d - 0.2;
};
const items: PlacedAsset[] = [];
/** Furniture the clearance pass had to drop (empty for the current TOWN; the district test keeps it that way). */
export const DOWNTOWN_DROPPED: PlacedAsset[] = [];
for (const a of placed) {
  if (!a.kind.startsWith('dt.') && (!clear(a) || items.some((b) => overlaps(a, b)))) DOWNTOWN_DROPPED.push(a);
  else items.push(a);
}

// ------------------------------------------------------------------------------------------------ ground

const areas: GroundArea[] = [
  // Downtown Square: kerb to kerb between Main St and Park Ave.
  {
    kind: 'plaza',
    polygon: [v(X_ATH + KERB + 0.05, Z_MAIN + KERB + 0.05), v(X_ALLEN - KERB - 0.05, Z_MAIN + KERB + 0.05), v(X_ALLEN - KERB - 0.05, Z_PARK - KERB - 0.05), v(X_ATH + KERB + 0.05, Z_PARK - KERB - 0.05)],
  },
  // Central Plaza: the open east half of the Allen–Station block, wrapping the theater's flank.
  {
    kind: 'plaza',
    polygon: [
      v(16.6, Z_NORTH + KERB + 0.05), v(20.6, Z_NORTH + KERB + 0.05), v(21.05, -13.25), v(X_STN - KERB - 0.05, -12.6),
      v(X_STN - KERB - 0.05, Z_MAIN - KERB - 0.05), v(18.6, Z_MAIN - KERB - 0.05), v(18.6, -6.0), v(16.6, -6.0),
    ],
  },
  // The wide Main St sidewalk in front of the north row.
  {
    kind: 'plaza',
    polygon: [v(X_ATH + KERB + 0.05, Z_MAIN - KERB - 0.05), v(X_ALLEN - KERB - 0.05, Z_MAIN - KERB - 0.05), v(X_ALLEN - KERB - 0.05, MAIN_N - 0.05), v(X_ATH + KERB + 0.05, MAIN_N - 0.05)],
  },
  // The green strip behind the theater.
  { kind: 'garden', polygon: [v(X_ALLEN + KERB + 0.05, -10.05), v(16.6, -10.05), v(16.6, -6.0), v(X_ALLEN + KERB + 0.05, -6.0)] },
];

const paths: FootPath[] = [
  // The lane from Allen St into Central Plaza, between the two shade trees.
  { kind: 'footpath', width: 0.9, points: [v(X_ALLEN + KERB + 0.05, -8.15), v(16.6, -8.15)] },
];

export const DOWNTOWN: DistrictScenery = {
  id: 'downtown',
  // Street-bounded: Atherton St → North Rd → Station Rd → Main St, plus the Downtown Square block down to Park Ave.
  region: { polygon: [v(X_ATH, Z_NORTH), v(X_STN, Z_NORTH), v(X_STN, Z_MAIN), v(X_ALLEN, Z_MAIN), v(X_ALLEN, Z_PARK), v(X_ATH, Z_PARK)] },
  items,
  paths,
  areas,
};
