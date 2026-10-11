// Owner: G0. Kenney city-kit-roads → Wooden Toy road roles (pure, no DOM).
// Road tiles use a handful of colormap swatches (8 × 4 blocks, each a flat left half + a gradient right half):
//   block (0,3) flat  #515566 gutter strip by the curb      block (0,3) gradient  gutter/curb side faces
//   block (2,3) flat  #666b80 lanes                          block (2,3) gradient  carriageway end/side faces
//   block (3,3) flat  #8e95b3 lane markings, zebras          block (3,2) gradient  sidewalk top + curb + base faces
// Triangles are classified by UV centroid + face normal (bottom faces are dropped: they lie on the ground).
import { colorOf, PALETTES, type Palette } from '../../palettes';
import type { PaletteId } from '../../types';

export type RoadRole = 'lane' | 'gutter' | 'mark' | 'walk' | 'curb' | 'roadSide' | 'island' | 'islandEdge' | 'shrub' | 'ground';
export const ROAD_ROLES: readonly RoadRole[] = ['lane', 'gutter', 'mark', 'walk', 'curb', 'roadSide', 'island', 'islandEdge', 'shrub', 'ground'];

/** Role of one Kenney road triangle, or null to drop it. `ny` = world-space face normal y. */
export function classifyRoadTri(u: number, v: number, ny: number): RoadRole | null {
  if (ny < -0.5) return null;
  const fu = u - Math.floor(u), fv = v - Math.floor(v);
  const bx = Math.min(7, Math.floor(fu * 8)), by = Math.min(3, Math.floor(fv * 4));
  const grad = fu * 8 - bx >= 0.5;
  const up = ny > 0.5;
  if (by === 3 && bx === 3) return up ? 'mark' : 'roadSide';
  if (by === 3 && bx === 0) return up && !grad ? 'gutter' : 'curb';
  if (by === 3 && bx === 2) return up && !grad ? 'lane' : 'roadSide';
  if (by === 2 && bx === 3) return up ? 'walk' : 'curb';
  return up ? 'lane' : 'roadSide';
}

/** Sidewalk + curb colours shared with the town streetscape (S1), per palette. */
const WALK: Record<PaletteId, string> = { a: '#E9DECB', b: '#CBBDA4', c: '#D2CDC2' };
const CURB: Record<PaletteId, string> = { a: '#FBF5EA', b: '#E4D9C4', c: '#ECEAE4' };

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

/** Hex colour of every road role in a palette (roads match the town's cream streets). */
export function roadColors(p: PaletteId): Record<RoadRole, string> {
  const P: Palette = PALETTES[p];
  const walk = WALK[p], road = P.road;
  return {
    lane: road,
    gutter: mix(road, walk, 0.5),
    mark: P.mark,
    walk,
    curb: CURB[p],
    roadSide: mix(road, walk, 0.7),
    island: P.lawn,
    islandEdge: mix(walk, CURB[p], 0.5),
    shrub: colorOf(P, 'leaf', 0),
    ground: P.board,
  };
}
