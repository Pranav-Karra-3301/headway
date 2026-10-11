// World-framing seam (coordinator): where mountains, water, tunnels and bridges go around the town board.
// Camera looks from +x/+z, so mountains sit at the back (north, west) and water at the front (south, east).
import { pointAt, RAIL_SPANS, TOWN } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';

export type Side = 'north' | 'south' | 'east' | 'west';
export interface WorldExit { edgeId: string; side: Side; p: Vec2; dir: Vec2; kind: 'tunnel' | 'bridge' }
export interface WorldLayout {
  board: TownMap['bounds'];
  /** Whole diorama footprint including terrain beyond the board. */
  extent: { minX: number; maxX: number; minZ: number; maxZ: number };
  mountainSides: Side[];
  waterSides: Side[];
  /** Roads leaving the board: tunnel portals on mountain sides, bridges/causeways on water sides. */
  exits: WorldExit[];
  /** Arc-distance span of the rail loop hidden in a foothill tunnel (west half, far from stations), or null. */
  railTunnel: { fromDist: number; toDist: number; center: Vec2 } | null;
  /** Shorelines: water starts at z > shore.south and x > shore.east (a beach strip lies between board edge and shore). */
  shore: { south: number; east: number };
}

const MOUNTAIN: Side[] = ['north', 'west'];
const WATER: Side[] = ['south', 'east'];
export const WORLD_MARGIN = { mountains: 34, water: 30, beach: 4 } as const;

export function worldLayout(map: TownMap): WorldLayout {
  const b = map.bounds;
  const eps = 0.75;
  const exits: WorldExit[] = [];
  for (const e of map.roads.edges) {
    const pts = e.path.points;
    if (pts.length < 2) continue;
    const ends: Array<[Vec2, Vec2]> = [[pts[0]!, pts[1]!], [pts[pts.length - 1]!, pts[pts.length - 2]!]];
    for (const [end, prev] of ends) {
      const side: Side | null =
        end.z <= b.minZ + eps ? 'north' : end.z >= b.maxZ - eps ? 'south' : end.x <= b.minX + eps ? 'west' : end.x >= b.maxX - eps ? 'east' : null;
      if (!side) continue;
      const len = Math.hypot(end.x - prev.x, end.z - prev.z) || 1;
      exits.push({ edgeId: e.id, side, p: { x: end.x, z: end.z }, dir: { x: (end.x - prev.x) / len, z: (end.z - prev.z) / len }, kind: MOUNTAIN.includes(side) ? 'tunnel' : 'bridge' });
    }
  }
  const L = map.rail.loop.length;
  const stations = map.rail.stations.map((s) => s.dist);
  const midX = (b.minX + b.maxX) / 2;
  let best: { d: number; gap: number } | null = null;
  for (let d = 0; d < L; d += 0.5) {
    const p = pointAt(map.rail.loop, d);
    if (p.x > midX) continue;
    const gap = Math.min(...stations.map((s) => { const x = Math.abs(d - s) % L; return Math.min(x, L - x); }));
    if (gap >= 15 && (!best || gap > best.gap)) best = { d, gap };
  }
  const half = 9;
  // TOWN (and its play instances): the sim's exact ridge-tunnel span (the whole off-board run through the NW ridge).
  const [t0, t1] = RAIL_SPANS.tunnel;
  const sameLoop = Math.abs(L - TOWN.rail.loop.length) < 1e-6 && t1 > t0;
  const railTunnel = sameLoop
    ? { fromDist: t0, toDist: t1, center: (({ x, z }) => ({ x, z }))(pointAt(map.rail.loop, (t0 + t1) / 2)) }
    : best
    ? { fromDist: (best.d - half + L) % L, toDist: (best.d + half) % L, center: (({ x, z }) => ({ x, z }))(pointAt(map.rail.loop, best.d)) }
    : null;
  return {
    board: b,
    extent: { minX: b.minX - WORLD_MARGIN.mountains, maxX: b.maxX + WORLD_MARGIN.water, minZ: b.minZ - WORLD_MARGIN.mountains, maxZ: b.maxZ + WORLD_MARGIN.water },
    mountainSides: MOUNTAIN,
    waterSides: WATER,
    exits,
    railTunnel,
    shore: { south: b.maxZ + WORLD_MARGIN.beach, east: b.maxX + WORLD_MARGIN.beach },
  };
}
