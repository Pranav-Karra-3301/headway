// Owner: Task M. Base scenery for TOWN: every kit module placed off the roads and rails, fronts facing streets.
// v3 districts (render/districts/*) replace this inside their regions; the composer keeps base items elsewhere.
//
// Frame: x east, z south; `rot` turns a model whose front (door side) faces +z: 0 → south, π → north,
// π/2 → east, −π/2 → west. Footprints are the T2.1 kit's (`render/kit/buildings.ts`): small 3×3, tall 3.2×3.2,
// hall 6.6×3.2 (+1.1 portico in front), shop 2.6×2.4, house 2.8×2.2, townhouses 4.5×2.4, cafe 2.8×2.3,
// dorm 4.6×3.2, library 5.4×4.0, clockTower 2.3×2.3, stadium bowl 10.8×8.4, station (kit) 11×6.1.
// Zone doors in TOWN sit at these buildings' fronts.
import type { StationId } from '@headway/sim';
import { stationPlacement } from '@headway/sim';

/** T2.1 kit building types (`BUILDING_TYPES`); optional refinement of `kind` for small/tall/hall items. */
export type KitBuilding = 'small' | 'tall' | 'hall' | 'shop' | 'house' | 'townhouses' | 'cafe' | 'dorm' | 'library';

export interface SceneryItem {
  kind: 'small' | 'tall' | 'hall' | 'clockTower' | 'stadium' | 'station' | 'tree' | 'lawn';
  x: number; z: number; rot?: number;          // rot in radians, multiples of π/2 for buildings
  w?: number; d?: number;                      // lawn size
  wall?: number; roof?: number; leaf?: number; // palette array indices
  scale?: number; stationId?: StationId;
  /** Finer kit building type; renderers that ignore it draw `kind` (a same-sized stand-in). */
  building?: KitBuilding;
  /** Tree variant index into the kit's TREE_VARIANTS (round, cluster, pine, poplar, bush). */
  variant?: number;
}

const S = 0, N = Math.PI, E = Math.PI / 2, W = -Math.PI / 2;

const b = (kind: 'small' | 'tall' | 'hall', building: KitBuilding, x: number, z: number, rot: number, wall = 0, roof = 0): SceneryItem =>
  ({ kind, building, x, z, rot, wall, roof });
const tree = (x: number, z: number, variant: number, leaf = 0, scale = 1): SceneryItem => ({ kind: 'tree', x, z, variant, leaf, scale });
const lawn = (x: number, z: number, w: number, d: number): SceneryItem => ({ kind: 'lawn', x, z, w, d });
const station = (stationId: StationId): SceneryItem => ({ kind: 'station', stationId, ...stationPlacement(stationId) });

export const SCENERY: SceneryItem[] = [
  // ---- campus (NW): Old Main clock tower on its lawn, Willard Hall, Pattee Library, West Halls dorms
  lawn(-10.5, -4.6, 5.6, 4.0),
  lawn(-10.5, -11.6, 5.0, 2.6),
  { kind: 'clockTower', x: -10.5, z: -9.0, rot: S },
  b('hall', 'hall', -15.3, -7.0, W, 0, 1),
  b('hall', 'library', -5.8, -8.2, E, 1, 1),
  b('tall', 'dorm', -23.15, -10.5, E, 0, 0),
  b('tall', 'dorm', -23.15, -4.5, E, 1, 2),
  tree(-13.2, -12.4, 0, 0), tree(-7.8, -12.4, 1, 1), tree(-16.6, -2.6, 3, 2, 0.9), tree(-4.6, -3.0, 0, 1, 0.9),

  // ---- downtown (Main St, Beaver Ave, Allen St)
  b('small', 'small', 1.2, -11.3, S, 1, 0),
  b('small', 'shop', 5.0, -11.3, S, 0, 2),
  b('small', 'cafe', 8.6, -11.4, S, 2, 1),
  b('small', 'small', 1.4, -3.4, S, 0, 2),
  b('tall', 'tall', 5.2, -3.4, S, 2, 1),
  b('small', 'shop', 8.9, -3.3, S, 1, 0),
  b('small', 'cafe', 1.8, 3.3, N, 0, 0),
  b('tall', 'tall', 15.3, -5.2, W, 1, 2),
  b('tall', 'tall', 19.0, -11.2, N, 0, 1),
  b('small', 'small', 15.2, -11.0, N, 2, 0),
  b('small', 'small', 19.4, -3.2, S, 1, 1),
  tree(20.2, -7.2, 4, 0, 1.0),

  // ---- south side (between Park Ave and the South Rd): small homes
  b('small', 'townhouses', 3.0, 10.7, S, 1, 1),
  b('small', 'house', 8.5, 10.8, S, 2, 2),
  tree(6.2, 8.9, 1, 0, 0.8),

  // ---- apartments (SE, around Central Station): four towers
  b('tall', 'tall', 15.3, 3.4, N, 2, 0),
  b('tall', 'tall', 15.3, 10.7, S, 0, 2),
  b('tall', 'tall', 26.6, 6.2, N, 1, 1),
  b('tall', 'tall', 26.6, 11.0, S, 2, 2),
  lawn(15.3, 7.0, 3.0, 2.2),

  // ---- north band (along the North Rd, east of the arterial) and south band (along the South Rd)
  b('small', 'house', 2.6, -18.4, S, 1, 0),
  b('small', 'townhouses', 8.2, -18.3, S, 0, 2),
  b('small', 'house', 13.8, -18.4, S, 2, 1),
  b('small', 'small', 18.8, -18.3, S, 0, 0),
  b('small', 'townhouses', 5.0, 18.3, N, 1, 1),
  b('small', 'house', 10.2, 18.4, N, 2, 2),
  b('small', 'house', 14.2, 18.4, N, 0, 1),
  b('small', 'townhouses', 19.4, 18.3, N, 2, 0),

  // ---- stadium (SW)
  { kind: 'stadium', x: -19.8, z: 7.3, rot: S },
  tree(-5.4, 3.0, 3, 1, 0.9), tree(-8.8, 4.2, 0, 0), tree(-5.6, 9.6, 1, 2, 0.9),

  // ---- stations (kit station models; districts may swap in their own buildings)
  station('stn_stadium'),
  station('stn_university'),
  station('stn_central'),

  // ---- outskirts (outside the railway): sparse trees so the town feels like it continues
  tree(-33.5, -23.5, 2, 2), tree(-34.0, -13.0, 0, 0), tree(-33.4, 9.0, 1, 1), tree(-34.2, 21.5, 2, 0),
  tree(33.5, -23.0, 0, 1), tree(34.0, -6.0, 2, 2), tree(33.6, 5.0, 1, 0), tree(34.2, 22.8, 0, 2),
  tree(-22.0, 24.6, 4, 1), tree(12.0, 24.6, 2, 0), tree(22.0, -24.6, 1, 2), tree(-14.0, -24.6, 0, 1),
];

/** Axis-aligned footprint of an item (kit sizes; fronts include porticos/awnings). Trees: crown radius. */
export function sceneryFootprint(it: SceneryItem): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const SIZES: Record<string, [w: number, d: number, front: number]> = {
    small: [3.2, 3.2, 0], tall: [3.36, 3.36, 0], hall: [6.9, 3.2, 1.1], shop: [2.6, 2.4, 0.5], house: [2.8, 2.2, 0.3],
    townhouses: [4.5, 2.4, 0.3], cafe: [2.8, 2.3, 0], dorm: [4.6, 3.2, 0], library: [5.4, 4.0, 0.3],
    clockTower: [2.3, 2.3, 0], stadium: [10.8, 8.4, 0],
  };
  if (it.kind === 'tree') { const r = 0.8 * (it.scale ?? 1); return { minX: it.x - r, maxX: it.x + r, minZ: it.z - r, maxZ: it.z + r }; }
  if (it.kind === 'lawn') { const w = it.w ?? 2, d = it.d ?? 2; return { minX: it.x - w / 2, maxX: it.x + w / 2, minZ: it.z - d / 2, maxZ: it.z + d / 2 }; }
  // local box: x ∈ [-w/2, w/2], z ∈ [-d/2, d/2 + front]; station: track at +1.75, building at -3.7
  let lx0: number, lx1: number, lz0: number, lz1: number;
  if (it.kind === 'station') { lx0 = -5.5; lx1 = 5.5; lz0 = -3.7; lz1 = 2.4; }
  else {
    const [w, d, front] = SIZES[it.building ?? it.kind] ?? SIZES[it.kind]!;
    lx0 = -w / 2; lx1 = w / 2; lz0 = -d / 2; lz1 = d / 2 + front;
  }
  const q = Math.round((it.rot ?? 0) / (Math.PI / 2)) & 3; // quarter turns
  // rotation.y by q·π/2 maps local (x, z) → world: q0 (x, z), q1 (z, −x), q2 (−x, −z), q3 (−z, x)
  const xs = q === 0 ? [lx0, lx1] : q === 1 ? [lz0, lz1] : q === 2 ? [-lx1, -lx0] : [-lz1, -lz0];
  const zs = q === 0 ? [lz0, lz1] : q === 1 ? [-lx1, -lx0] : q === 2 ? [-lz1, -lz0] : [lx0, lx1];
  return { minX: it.x + xs[0]!, maxX: it.x + xs[1]!, minZ: it.z + zs[0]!, maxZ: it.z + zs[1]! };
}
