// Owner: G0. Cell math for the greater-town grid (pure, no three.js). Re-exported by ../grid.ts.
import type { TownMap, Vec2 } from '@headway/sim';

/** One Kenney city-kit-roads tile in board units. */
export const TILE = 4;
/** Width of the greater-town ring around the board, in cells (7 × 4 u = 28 u). */
export const RING_CELLS = 7;
/** Northern rows reserved for G1's highway band. */
export const HIGHWAY_ROWS = 4;

/** Street cross-section (u from the centreline): lanes, carriageway edge (curb), sidewalk outer edge. */
export const KERB = { lane: 0.6, carriage: 1.6, walk: 2.0, walkTop: 0.08, roadTop: 0.04 } as const;

export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRS: readonly Dir[] = ['n', 'e', 's', 'w'];
/** Unit vectors (x east, z south). */
export const DIR_VEC: Readonly<Record<Dir, Vec2>> = { n: { x: 0, z: -1 }, e: { x: 1, z: 0 }, s: { x: 0, z: 1 }, w: { x: -1, z: 0 } };
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { n: 's', s: 'n', e: 'w', w: 'e' };
/** Cell step per direction. */
export const STEP: Readonly<Record<Dir, { dc: number; dr: number }>> = {
  n: { dc: 0, dr: -1 }, e: { dc: 1, dr: 0 }, s: { dc: 0, dr: 1 }, w: { dc: -1, dr: 0 },
};

export interface CellRect { c: number; r: number; w: number; h: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

/** The grid frame: what cellCenter / cellOf need. GreaterGrid extends it. */
export interface GridFrame {
  tile: number;
  cols: number;
  rows: number;
  /** World position of the min corner of cell (0, 0). */
  origin: Vec2;
  /** Cells covered by the playable board. */
  board: CellRect;
  /** Rows reserved for the highway band (G1). */
  highway: CellRect;
  /** Whole grid in world units. */
  bounds: Rect;
}

export function gridFrame(map: TownMap): GridFrame {
  const b = map.bounds;
  const ring = RING_CELLS * TILE;
  const bw = Math.round((b.maxX - b.minX) / TILE), bh = Math.round((b.maxZ - b.minZ) / TILE);
  const cols = bw + 2 * RING_CELLS, rows = bh + 2 * RING_CELLS;
  const origin = { x: b.minX - ring, z: b.minZ - ring };
  return {
    tile: TILE, cols, rows, origin,
    board: { c: RING_CELLS, r: RING_CELLS, w: bw, h: bh },
    highway: { c: 0, r: 0, w: cols, h: HIGHWAY_ROWS },
    bounds: { minX: origin.x, maxX: origin.x + cols * TILE, minZ: origin.z, maxZ: origin.z + rows * TILE },
  };
}

/** World centre of cell (c, r). Fractional cells are fine (e.g. c + 0.5 = the cell's east edge). */
export function cellCenter(g: GridFrame, c: number, r: number): Vec2 {
  return { x: g.origin.x + (c + 0.5) * g.tile, z: g.origin.z + (r + 0.5) * g.tile };
}

/** Cell containing world point (x, z) (may lie outside 0..cols−1 / 0..rows−1). */
export function cellOf(g: GridFrame, x: number, z: number): { c: number; r: number } {
  return { c: Math.floor((x - g.origin.x) / g.tile), r: Math.floor((z - g.origin.z) / g.tile) };
}

/** World rectangle of a w × h cell block starting at (c, r). */
export function cellRect(g: GridFrame, c: number, r: number, w = 1, h = 1): Rect {
  return { minX: g.origin.x + c * g.tile, maxX: g.origin.x + (c + w) * g.tile, minZ: g.origin.z + r * g.tile, maxZ: g.origin.z + (r + h) * g.tile };
}

export function inGrid(g: GridFrame, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows;
}

export function inRect(cr: CellRect, c: number, r: number): boolean {
  return c >= cr.c && r >= cr.r && c < cr.c + cr.w && r < cr.r + cr.h;
}

/** Midpoint of a cell side (where a road crosses into the neighbour). */
export function sideMid(g: GridFrame, c: number, r: number, d: Dir): Vec2 {
  const ctr = cellCenter(g, c, r), v = DIR_VEC[d], h = g.tile / 2;
  return { x: ctr.x + v.x * h, z: ctr.z + v.z * h };
}

/** Right-hand normal of a travel direction (cars keep right): right(d) = (−d.z, d.x). */
export function rightOf(d: Vec2): Vec2 {
  return { x: -d.z, z: d.x };
}
