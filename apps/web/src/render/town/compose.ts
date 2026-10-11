// Owner: T2.2. Which scenery the town shows (pure; unit-tested): base SCENERY (Task M) everywhere except inside the
// region of a district that provides items; every district item; and the stations that keep only their platform
// because a district put its own station building beside them. Stations (platforms are gameplay) always stay.
import type { StationId, Vec2 } from '@headway/sim';
import type { PlacedAsset } from '../assets/types';
import type { DistrictScenery } from '../districts/types';
import type { SceneryItem } from '../scenery';

export interface ComposedScenery {
  base: SceneryItem[];
  items: PlacedAsset[];
  /** Stations drawn without the kit's own station building. */
  platformOnly: Set<StationId>;
}

/** A district station building closer than this to a station's model origin replaces the kit building. */
const STATION_BUILDING_NEAR = 8;

export function inRegion(region: DistrictScenery['region'], p: Vec2): boolean {
  if ('center' in region) {
    if (!(region.radius > 0)) return false;
    const dx = p.x - region.center.x, dz = p.z - region.center.z;
    return dx * dx + dz * dz <= region.radius * region.radius;
  }
  const poly = region.polygon;
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function composeScenery(scenery: readonly SceneryItem[], districts: readonly DistrictScenery[]): ComposedScenery {
  const active = districts.filter((d) => d.items.length > 0);
  const items = active.flatMap((d) => d.items);
  const base = scenery.filter((it) => it.kind === 'station' || !active.some((d) => inRegion(d.region, it)));
  const platformOnly = new Set<StationId>();
  for (const it of scenery) {
    if (it.kind !== 'station' || !it.stationId) continue;
    const near = items.some((a) => a.kind.startsWith('lm.station') && Math.hypot(a.x - it.x, a.z - it.z) < STATION_BUILDING_NEAR);
    if (near) platformOnly.add(it.stationId);
  }
  return { base, items, platformOnly };
}
