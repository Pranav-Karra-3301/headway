// Placement checks used by district tests: inside the board, off roads/rails, no overlaps.
import type { TownMap, Vec2 } from '@headway/sim';
import { CATALOG_BY_KIND } from './catalog';
import type { PlacedAsset } from './types';

const ROAD_HALF = 1.2 + 0.3; // road half-width + curb margin
const RAIL_HALF = 1.0;

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x, vz = b.z - a.z, wx = p.x - a.x, wz = p.z - a.z;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / L)) : 0;
  const dx = a.x + vx * t - p.x, dz = a.z + vz * t - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}
function polyDist(p: Vec2, pts: Vec2[], closed: boolean): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i]!, pts[i + 1]!));
  if (closed && pts.length > 2) best = Math.min(best, segDist(p, pts[pts.length - 1]!, pts[0]!));
  return best;
}
/** Approximate footprint radius (half the shorter side, so long buildings may sit close to a road along their length). */
export function footprintOf(a: PlacedAsset): { w: number; d: number } {
  const c = CATALOG_BY_KIND.get(a.kind);
  const len = typeof a.params?.length === 'number' ? (a.params.length as number) : undefined;
  const w = (len ?? c?.w ?? 1) * (a.scale ?? 1), d = (c?.d ?? 1) * (a.scale ?? 1);
  const quarter = Math.round((a.rot ?? 0) / (Math.PI / 2)) % 2 !== 0;
  return quarter ? { w: d, d: w } : { w, d };
}
export function validatePlacements(map: TownMap, items: PlacedAsset[]): string[] {
  const errs: string[] = [];
  const b = map.bounds;
  items.forEach((it, i) => {
    const f = footprintOf(it);
    const corners: Vec2[] = [
      { x: it.x - f.w / 2, z: it.z - f.d / 2 }, { x: it.x + f.w / 2, z: it.z - f.d / 2 },
      { x: it.x - f.w / 2, z: it.z + f.d / 2 }, { x: it.x + f.w / 2, z: it.z + f.d / 2 }, { x: it.x, z: it.z },
    ];
    if (corners.some((c) => c.x < b.minX || c.x > b.maxX || c.z < b.minZ || c.z > b.maxZ)) errs.push(`#${i} ${it.kind} outside board`);
    const small = Math.max(f.w, f.d) <= 1.3; // street furniture may sit on the curb
    for (const e of map.roads.edges) {
      const dmin = Math.min(...corners.map((c) => polyDist(c, e.path.points, e.path.closed)));
      if (dmin < (small ? 1.25 : ROAD_HALF)) { errs.push(`#${i} ${it.kind} on road ${e.id}`); break; }
    }
    const rd = Math.min(...corners.map((c) => polyDist(c, map.rail.loop.points, true)));
    if (rd < RAIL_HALF) errs.push(`#${i} ${it.kind} on rail`);
  });
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i]!, c = items[j]!, fa = footprintOf(a), fc = footprintOf(c);
    if (Math.abs(a.x - c.x) * 2 < fa.w + fc.w - 0.2 && Math.abs(a.z - c.z) * 2 < fa.d + fc.d - 0.2) errs.push(`#${i} ${a.kind} overlaps #${j} ${c.kind}`);
  }
  return errs;
}
