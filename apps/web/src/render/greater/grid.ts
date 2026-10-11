// Owner: G0. Greater-town grid seam: the visual-only town around the playable board, laid out on Kenney
// city-kit-roads tiles and shaped by the town map (rail, ridge, bay). Pure data — no three.js, no DOM, deterministic.
// Every G track builds on it; the sim never sees it.
//
//   import { greaterGrid, cellCenter, cellOf, isWater } from '../grid';
//   const g = greaterGrid(TOWN);                 // memoised per map
//
// FRAME  x east, z south, y up (board top y = 0). One road tile = g.tile = 4 u. Cell (c, r) spans
//        x ∈ [origin.x + 4c, origin.x + 4c + 4), z likewise with r. 32 cols × 27 rows, origin = bounds.min − 28 u
//        → g.bounds = x −64..64, z −54..54. The board covers g.board (cols 7–24 × rows 7–19).
// USE    g.use[r][c]: 'board' | 'highway' (rows 0–3, G1's band) | 'road' | 'rail' (off-board rail on the beach: keep
//        clear) | 'hill' (ridge spur over the rail tunnel: E1 terrain / forest) | 'water' (the bay) | 'free'.
//        Only 'free' cells may be built on (G2 / G3, via g.blocks).
// LAND   v9 organic city: the BAY (water south-east of g.shore, polygon g.water, isWater()) holds the rail bridge; the
//        shore hugs the board's south-east 4 u out (the beach the rail runs on), leaves an NE headland and SW land.
//        The RIDGE SPUR covers the rail's west tunnel from the rail to the board edge (portals there); Main St cuts it.
// ROADS  g.roads: every placed tile — Kenney model id (or null for the procedural east-exit S-bend), footprint, centre
//        + rotation about +y, open sides; `bridge` = causeway over the bay, `railCrossing` = level crossing (square-on).
//        Rendered by ./roads (createGreaterRoadsLayer, 3 draw calls).
// NETWORK every board exit continues into a roundabout: North Gate Circle (its north arm → G1's highway), Foothill
//        Circle (Main St, beyond the spur; west arm → off the grid into the mountains), South Gate Circle (Atherton
//        St, after crossing the rail on the beach; south arm → causeway off the grid), Lakeside Circle (South Rd via
//        an S-bend; east arm → causeway off the grid). Ring Rd (north + east), Foothill Rd (west), Lakeshore Pkwy
//        (south-west shore), locals (Hillside Ave, Quarry Rd, Stadium Way, Mill St, Harbor St, Marina Rd, Bayview Ave).
// STREETS g.streets: named centrelines per stretch (lamps, poles, trees along the kerb). Cross-section: lanes at
//        ±KERB.lane, curb at ±KERB.carriage, sidewalk outer edge at ±KERB.walk (sidewalk top y = KERB.walkTop).
// JUNCTIONS g.junctions (tee / cross / roundabout / end, with arms; `signals` marks junctions for traffic lights) and
//        g.roundabouts (centre, island radius for a statue / tree / fountain, lane + kerb radii).
// LANES  g.lanes: directed lane centrelines for visual traffic (right-hand; roundabouts run anticlockwise seen from
//        above), each with a cruise speed hint, `next` successors and `yield` at give-way points. Lanes join where
//        one ends and another starts: add your own (G1 highway, ramps) and call linkLanes(all) to relink.
// PORTS  g.ports — v9 traffic: cars enter / leave ONLY at 'edge' (w: mountain road tunnel, s + e: causeways over the
//        bay) and 'highway' (G1 connects to the north roundabout's north arm at the band edge). 'board' ports are the
//        town's exit roads (`townEdge` = TOWN.roads edge id): pass through onto the town's streets, never spawn there.
// BLOCKS g.blocks: dressable rectangles of free cells: street frontage sides, zone hint (suburb NW / NE, commercial
//        S, industrial W / SW, frontage strips beside the board, verges, waterfront strips), `shore` (touches the
//        bay), `density` 0..1 (thins out with noise away from the board: below ~0.35 dress as park / field / forest)
//        and a `seed`.
//
// MAP (TOWN today; # board, = highway band, ^ ridge spur, + rail, ~ bay, X level crossing, B causeway, O roundabout,
//      ◜ 2×2 curve, S S-bend, e cul-de-sac, ≡ zebra; letters = block zones: s suburb, c commercial, i industrial,
//      f frontage, v verge, w waterfront, p park):
//          0         1         2         3
//          01234567890123456789012345678901
//       0  ================================
//       4  vvvvvvvvvvvvvvOOOvvvvvvvvvvvssss
//       5  v◜◜───────────OOO─────────◜◜ssss
//       6  v◜◜fffffffffffOOOfffffffff◜◜ssss
//       7  v│ss^^^##################ff│ssss
//       9  v┬─e^^^##################ff│ssss
//      10  v│ss^^^##################ff┬─epp
//      12  OOOp^^^##################ff│ssss
//      13  OOO≡───##################ff│ssss
//      14  OOOp^^^##################ff│ssss
//      15  v│ii^^^##################ff│www~
//      16  v│ii^^^##################SOOOw~~
//      17  v┬─e^^^##################SOOO≡BB
//      18  v│pp^^^##################wOOOw~~
//      19  v│fffff##################wwew~~~
//      20  v┬─────────┐ff+X+++www++ww~~~~~~
//      21  v│pcccccccc│ffp≡++++++++~~~~~~~~
//      22  v◜◜cccccccc│ffOOO+++++++~~~~~~~~
//      23  v◜◜──≡──┬──┬─≡OOOe~~~~~~~~~~~~~~
//      24  wwwwwwww│wwwwwOOOw~~~~~~~~~~~~~~
//      25  wwwwwwwwewwwwww≡w~~~~~~~~~~~~~~~
//      26  ~~~~~~~~~~w~~~~B~~~~~~~~~~~~~~~~
//      (G0_DUMP=1 vitest run src/render/greater/roads/__tests__/debug-dump.test.ts --silent=false prints it live.)
import { polyline } from '@headway/sim';
import type { Polyline, TownMap, Vec2 } from '@headway/sim';
import type { KenneyId } from '../assets/kenney/index';
import { findBlocks } from './roads/blocks';
import { cellOf, gridFrame, inGrid, type CellRect, type Dir, type GridFrame, type Rect } from './roads/cells';
import { pointInPolygon } from './roads/land';
import { buildLanes } from './roads/lanes';
import { planNetwork } from './roads/plan';

export { TILE, RING_CELLS, HIGHWAY_ROWS, KERB, DIRS, DIR_VEC, OPPOSITE, cellCenter, cellOf, cellRect, inGrid, rightOf, sideMid } from './roads/cells';
export type { CellRect, Dir, GridFrame, Rect } from './roads/cells';

/** board = the playable town; highway = G1's band; road = a placed tile; rail = the off-board rail on the beach;
 *  hill = the ridge spur over the rail tunnel (E1 terrain); water = the bay; free = dressable land (G2 / G3). */
export type CellUse = 'board' | 'highway' | 'road' | 'rail' | 'hill' | 'water' | 'free';
export type RoadClass = 'ring' | 'parkway' | 'avenue' | 'radial' | 'local';
export type RoadTileKind = 'straight' | 'crossing' | 'bend' | 'curve' | 'tee' | 'cross' | 'roundabout' | 'end' | 'connector';
export type LaneKind = RoadClass | 'junction' | 'roundabout' | 'uturn' | 'highway' | 'ramp';
export type ZoneHint = 'suburb' | 'commercial' | 'industrial' | 'park' | 'frontage' | 'verge' | 'waterfront';

/** A placed road tile (1×1, a 2×2 curve or a 3×3 roundabout). */
export interface RoadCell {
  id: string;
  kind: RoadTileKind;
  cells: CellRect;
  /** Footprint centre (world). */
  center: Vec2;
  /** Rotation about +y (radians, multiple of π/2) applied to the Kenney model, which is scaled to g.tile per kit unit. */
  rot: number;
  /** 'city-kit-roads/<name>', or null for a procedural piece. */
  model: KenneyId | null;
  /** Sides of the footprint a road leaves through (pieces: their arms' sides). */
  open: Dir[];
  street: string;
  /** Causeway over the bay (the layer adds an embankment under it). */
  bridge?: boolean;
  /** The off-board rail crosses this tile square-on (level crossing: barriers / signals go here). */
  railCrossing?: boolean;
}

/** A named street: centreline polylines, one per stretch between junctions (no direction implied). */
export interface Street { id: string; name: string; cls: RoadClass; paths: Polyline[] }

export interface JunctionArm { dir: Vec2; p: Vec2; street: string }
export interface Junction {
  id: string;
  kind: 'tee' | 'cross' | 'roundabout' | 'end';
  center: Vec2;
  /** Arm boundary midpoints with outward directions. */
  arms: JunctionArm[];
  /** Major junction: a good place for traffic lights / signs. */
  signals: boolean;
}

export interface Roundabout {
  id: string;
  name: string;
  center: Vec2;
  /** Planted island radius (keep statues / trees / fountains inside it). */
  islandR: number;
  /** Circulating lane radius (traffic). */
  laneR: number;
  /** Outer curb radius. */
  outerR: number;
}

export interface Lane {
  id: string;
  kind: LaneKind;
  /** Directed centreline at y = 0: cars drive points[0] → points[n − 1]. */
  path: Polyline;
  /** Suggested cruise speed (u/s). */
  speed: number;
  /** Lanes that continue from this lane's end (empty = leaves the network: despawn). */
  next: string[];
  /** Give way at the end (entering a roundabout). */
  yield?: boolean;
  street?: string;
}

export interface Port {
  id: string;
  kind: 'board' | 'edge' | 'highway';
  /** Side of the network the road leaves through. */
  side: Dir;
  /** Road centre at the boundary, and the outward unit direction. */
  p: Vec2;
  dir: Vec2;
  /** Lane entering the grid network here, and the lane leaving it here. */
  inLane: string | null;
  outLane: string | null;
  street: string;
  /** 'board' ports: the town road edge (TOWN.roads.edges id) that continues the street onto the board. */
  townEdge?: string;
}

export interface Block {
  id: string;
  cells: CellRect;
  /** World rectangle (cell edges: road sidewalks end exactly at these lines). */
  rect: Rect;
  zone: ZoneHint;
  /** Sides touching a street (face buildings toward one of these). */
  frontage: Array<{ side: Dir; street: string }>;
  /** Touches the bay (or the shore is within 3.5 u): keep a promenade strip on the water side. */
  shore: boolean;
  /** Built-up density 0..1: high by the board and main roads, thinning out (with noise) toward the edges and the
   *  shore. Organic city: below ~0.35 dress as park / field / forest instead of buildings. */
  density: number;
  /** Deterministic per-block seed (rng streams for dressing). */
  seed: number;
}

export interface GreaterGrid extends GridFrame {
  /** [r][c] */
  use: CellUse[][];
  roads: RoadCell[];
  streets: Street[];
  junctions: Junction[];
  roundabouts: Roundabout[];
  lanes: Lane[];
  ports: Port[];
  blocks: Block[];
  /** Shoreline polyline (grid east edge → west edge; the bay lies south / east of it). */
  shore: Vec2[];
  /** The bay inside the grid as a closed polygon (E2 water / G3 waterfront align to it). */
  water: Vec2[];
}

const cache = new WeakMap<TownMap, GreaterGrid>();

/** The greater-town grid for a map (memoised). */
export function greaterGrid(map: TownMap): GreaterGrid {
  let g = cache.get(map);
  if (g) return g;
  const frame = gridFrame(map);
  const net = planNetwork(map, frame);
  const { lanes, ports, streets } = buildLanes(frame, net);
  const blocks = findBlocks(frame, net);
  g = {
    ...frame,
    use: net.use,
    roads: net.roads,
    streets,
    junctions: net.junctions,
    roundabouts: net.roundabouts,
    lanes,
    ports,
    blocks,
    shore: net.land.shore,
    water: net.land.water,
  };
  for (const p of ports) {
    if (p.kind !== 'board') continue;
    const e = map.roads.edges.find((ed) => {
      const pts = ed.path.points;
      return pts.length > 1 && [pts[0]!, pts[pts.length - 1]!].some((q) => Math.hypot(q.x - p.p.x, q.z - p.p.z) < 0.75);
    });
    if (e) p.townEdge = e.id;
  }
  cache.set(map, g);
  return g;
}

/** True when (x, z) lies in the bay (south / east of g.shore). */
export function isWater(g: GreaterGrid, x: number, z: number): boolean {
  return pointInPolygon(g.water, { x, z });
}

/** Use of the cell containing (x, z); 'free' outside the grid. */
export function useAt(g: GreaterGrid, x: number, z: number): CellUse {
  const { c, r } = cellOf(g, x, z);
  return inGrid(g, c, r) ? g.use[r]![c]! : 'free';
}

/** The road tile covering cell (c, r), if any. */
export function roadAt(g: GreaterGrid, c: number, r: number): RoadCell | null {
  for (const t of g.roads) {
    const k = t.cells;
    if (c >= k.c && r >= k.r && c < k.c + k.w && r < k.r + k.h) return t;
  }
  return null;
}

/**
 * Recompute every lane's `next`: lane B follows lane A when B starts where A ends (within `tol`) heading the same
 * general way. Mutates and returns `lanes`. Call after merging your lanes with g.lanes.
 */
export function linkLanes<L extends Lane>(lanes: L[], tol = 1e-3): L[] {
  const key = (p: Vec2) => `${Math.round(p.x / tol)}|${Math.round(p.z / tol)}`;
  const starts = new Map<string, L[]>();
  const keysNear = (p: Vec2): string[] => {
    const kx = Math.round(p.x / tol), kz = Math.round(p.z / tol), out: string[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(`${kx + dx}|${kz + dz}`);
    return out;
  };
  const dirAt = (pl: Polyline, end: boolean): Vec2 => {
    const pts = pl.points, n = pts.length;
    const a = end ? pts[n - 2]! : pts[0]!, b = end ? pts[n - 1]! : pts[1]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  };
  for (const l of lanes) {
    if (l.path.points.length < 2) continue;
    const k = key(l.path.points[0]!);
    const arr = starts.get(k);
    if (arr) arr.push(l); else starts.set(k, [l]);
  }
  for (const l of lanes) {
    const pts = l.path.points;
    if (pts.length < 2) { l.next = []; continue; }
    const end = pts[pts.length - 1]!, d = dirAt(l.path, true);
    const next = new Set<string>();
    for (const k of keysNear(end)) {
      for (const m of starts.get(k) ?? []) {
        if (m === l) continue;
        const s = m.path.points[0]!;
        if (Math.hypot(s.x - end.x, s.z - end.z) > tol) continue;
        const md = dirAt(m.path, false);
        if (d.x * md.x + d.z * md.z > 0.2) next.add(m.id);
      }
    }
    l.next = [...next].sort();
  }
  return lanes;
}

/** Polyline helper re-exported for tracks that build lanes (G1): polyline(points, closed=false). */
export function lanePath(points: Vec2[]): Polyline {
  return polyline(points, false);
}
