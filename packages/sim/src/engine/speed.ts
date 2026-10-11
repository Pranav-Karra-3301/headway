// Owner: T1a. Per-path speed lookup: which road edge each 1 u bin of a bus path runs along (for the per-edge traffic
// multipliers, spec §5.3) and where the path is. Sampled once per (map, path) and cached.
import type { Polyline, TownMap, Vec2 } from '../contracts';
import { pointAt, projectOnPolyline } from '../map/geometry';

export interface PathProfile {
  /** Road edge index per 1 u bin (-1 when the map has no roads). */
  edge: Int16Array;
  /** Bin centre positions. */
  pts: Vec2[];
}

const cache = new WeakMap<TownMap, Map<string, PathProfile>>();

export function pathProfile(map: TownMap, key: string, path: Polyline): PathProfile {
  let c = cache.get(map);
  if (!c) { c = new Map(); cache.set(map, c); }
  const hit = c.get(key);
  if (hit) return hit;
  const bins = Math.max(1, Math.ceil(path.length));
  const edge = new Int16Array(bins);
  const pts: Vec2[] = [];
  const edges = map.roads.edges;
  for (let i = 0; i < bins; i++) {
    const p = pointAt(path, Math.min(i + 0.5, path.length));
    pts.push({ x: p.x, z: p.z });
    let best = -1;
    let bestD = Infinity;
    for (let e = 0; e < edges.length; e++) {
      const d = projectOnPolyline(edges[e]!.path, p).d;
      if (d < bestD - 1e-9) { bestD = d; best = e; }
    }
    edge[i] = best;
  }
  const prof = { edge, pts };
  c.set(key, prof);
  return prof;
}

/** Bin index for arc length `d` on a path of `bins` bins. */
export function binAt(prof: PathProfile, d: number): number {
  const i = Math.floor(d);
  return i < 0 ? 0 : i >= prof.edge.length ? prof.edge.length - 1 : i;
}
