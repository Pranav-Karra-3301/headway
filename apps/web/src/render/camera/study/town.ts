// Owner: C1 (camera study). The town the study measures: district items where districts are populated, the base
// SCENERY (Task M) elsewhere — mapped to their v3 catalog kinds so sizes are honest — plus the kit stations.
// Everything becomes upright occluder boxes sized from the shared catalog (footprint × height).
import type { StationId, TownMap, Vec2 } from '@headway/sim';
import { stationPlacement } from '@headway/sim';
import { CATALOG_BY_KIND } from '../../assets/catalog';
import type { PlacedAsset } from '../../assets/types';
import type { DistrictScenery, GroundArea } from '../../districts/types';
import type { SceneryItem } from '../../scenery';
import type { Box, OccluderClass } from './occlusion';

export interface StudyStation { id: StationId; x: number; z: number; rot: number; kitBuilding: boolean }
export interface StudyTown {
  placements: PlacedAsset[];
  stations: StudyStation[];
  /** Flat ground dressing (lawns, plazas, …) for the preview render; never occludes. */
  areas: GroundArea[];
  sources: { districtItems: number; baseItems: number; populatedDistricts: string[] };
}

const TREE_KINDS = ['veg.oak', 'veg.maple', 'veg.pine', 'veg.poplar', 'veg.bush'] as const;

function neighborhoodAt(map: TownMap, x: number, z: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const n of map.neighborhoods) {
    const d = Math.hypot(x - n.center.x, z - n.center.z);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

/** v3 catalog kind standing in for a base-scenery item (null for lawns and stations). */
export function sceneryToPlacement(it: SceneryItem, map: TownMap): PlacedAsset | null {
  const at = (kind: string, extra: Partial<PlacedAsset> = {}): PlacedAsset => ({ kind, x: it.x, z: it.z, rot: it.rot ?? 0, ...extra });
  switch (it.kind) {
    case 'lawn':
    case 'station':
      return null;
    case 'tree':
      return at(TREE_KINDS[(((it.variant ?? 0) % 5) + 5) % 5]!, { rot: 0, ...(it.scale ? { scale: it.scale } : {}) });
    case 'clockTower': return at('lm.clockTower');
    case 'stadium': return at('lm.stadium');
    default: break;
  }
  switch (it.building ?? it.kind) {
    case 'shop': case 'small': return at('dt.shop');
    case 'cafe': return at('dt.cafe');
    case 'house': return at('res.house');
    case 'townhouses': return at('res.townhouses');
    case 'dorm': return at('cp.dorm');
    case 'hall': return at('cp.hall');
    case 'library': return at('cp.library');
    case 'tall': return at(neighborhoodAt(map, it.x, it.z) === 'apartments' ? 'res.tower' : 'dt.midrise');
    default: return at('dt.shop');
  }
}

export function regionContains(region: DistrictScenery['region'], p: Vec2): boolean {
  if ('center' in region) return Math.hypot(p.x - region.center.x, p.z - region.center.z) <= region.radius;
  const poly = region.polygon;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function composeStudyTown(map: TownMap, districts: readonly DistrictScenery[], scenery: readonly SceneryItem[]): StudyTown {
  const populated = districts.filter((d) => d.items.length > 0);
  const owned = (p: Vec2) => populated.some((d) => regionContains(d.region, p));
  const placements: PlacedAsset[] = [];
  const areas: GroundArea[] = [];
  let baseItems = 0;
  for (const it of scenery) {
    if (owned(it)) continue;
    if (it.kind === 'lawn') {
      const w = (it.w ?? 2) / 2, d = (it.d ?? 2) / 2;
      areas.push({ kind: 'lawn', polygon: [{ x: it.x - w, z: it.z - d }, { x: it.x + w, z: it.z - d }, { x: it.x + w, z: it.z + d }, { x: it.x - w, z: it.z + d }] });
      continue;
    }
    const p = sceneryToPlacement(it, map);
    if (p) { placements.push(p); baseItems++; }
  }
  let districtItems = 0;
  for (const d of populated) {
    placements.push(...d.items);
    districtItems += d.items.length;
    areas.push(...d.areas);
  }
  const stations = map.rail.stations.map((s) => {
    const sp = stationPlacement(s.id);
    return { id: s.id, ...sp, kitBuilding: !owned(sp) };
  });
  return { placements, stations, areas, sources: { districtItems, baseItems, populatedDistricts: populated.map((d) => d.id) } };
}

/** Kinds too thin, low or sparse to hide a 0.8 u person (their bounding box would overstate them). */
const NOT_OCCLUDERS = new Set([
  'st.lamp', 'st.bench', 'st.bin', 'st.bikeRack', 'st.hydrant', 'st.mailbox', 'st.trafficLight', 'st.fence', 'st.flag',
  'st.tableUmbrella', 'st.fountain', 'lm.railSignal', 'lm.levelCrossing', 'res.parking', 'res.playground', 'veg.flowerbed',
]);

/** Upright catalog boxes (footprint × height, scaled; `params.length` stretches hedges along x). */
export function placementBoxes(items: readonly PlacedAsset[]): Box[] {
  const out: Box[] = [];
  for (const it of items) {
    const c = CATALOG_BY_KIND.get(it.kind);
    if (!c || NOT_OCCLUDERS.has(it.kind)) continue;
    const s = it.scale ?? 1;
    const len = typeof it.params?.length === 'number' ? it.params.length : null;
    const w = (len ?? c.w) * s, d = c.d * s;
    const cls: OccluderClass = c.family === 'vegetation' ? 'tree' : c.family === 'landmarks' ? 'landmark' : 'building';
    // trees are crown boxes (bible §2.3: y 0.9 to h); bushes, hedges and planters are solid from the ground
    const crown = cls === 'tree' && c.h * s > 1.5 ? 0.9 * s : 0;
    out.push({ cx: it.x, cz: it.z, hx: w / 2, hz: d / 2, y0: crown, y1: c.h * s, rot: it.rot ?? 0, cls, kind: it.kind });
  }
  return out;
}

/** The kit station (render/kit/transit.ts makeStation) as occluders: the station house and the platform canopy. */
export function stationBoxes(id: StationId): Box[] {
  const sp = stationPlacement(id);
  const c = Math.cos(sp.rot), s = Math.sin(sp.rot);
  const at = (lx: number, lz: number) => ({ cx: sp.x + lx * c + lz * s, cz: sp.z - lx * s + lz * c });
  return [
    { ...at(-1.6, -2.6), hx: 1.8, hz: 1.2, y0: 0, y1: 2.63, rot: sp.rot, cls: 'station', kind: 'station.building' },
    { ...at(0, -0.25), hx: 3.6, hz: 0.95, y0: 2.42, y1: 2.58, rot: sp.rot, cls: 'station', kind: 'station.canopy' },
  ];
}

export function studyBoxes(t: StudyTown): Box[] {
  return [...placementBoxes(t.placements), ...t.stations.filter((s) => s.kitBuilding).flatMap((s) => stationBoxes(s.id))];
}
