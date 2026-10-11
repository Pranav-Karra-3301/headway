// Owner: G0. Kenney city-kit-roads → Wooden Toy road roles (pure, no DOM).
// Road tiles use a handful of colormap swatches (8 × 4 blocks, each a flat left half + a gradient right half):
//   block (0,3) flat  #515566 gutter strip by the curb      block (0,3) gradient  gutter/curb side faces
//   block (2,3) flat  #666b80 lanes                          block (2,3) gradient  carriageway end/side faces
//   block (3,3) flat  #8e95b3 lane markings, zebras          block (3,2) gradient  sidewalk top + curb + base faces
// Triangles are classified by UV centroid + face normal (bottom faces are dropped: they lie on the ground).
import { colorOf, PALETTES, type Palette } from '../../palettes';
import { SS_ROLES } from '../../streetscape/roles';
import type { PaletteId } from '../../types';

export type RoadRole = 'lane' | 'gutter' | 'mark' | 'walk' | 'curb' | 'roadSide' | 'island' | 'islandEdge' | 'shrub' | 'ground' | 'stone';
export const ROAD_ROLES: readonly RoadRole[] = ['lane', 'gutter', 'mark', 'walk', 'curb', 'roadSide', 'island', 'islandEdge', 'shrub', 'ground', 'stone'];

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

/** Sidewalk + curb colours: the town streetscape's (S1 `ssWalk` / `ssCurb`) so both towns share one kerb. */
const PI: Record<PaletteId, 0 | 1 | 2> = { a: 0, b: 1, c: 2 };
const FALLBACK_WALK: Record<PaletteId, string> = { a: '#D8D2C6', b: '#BDB3A2', c: '#C6C1B6' };
const FALLBACK_CURB: Record<PaletteId, string> = { a: '#FBF5EA', b: '#E4D9C4', c: '#ECEAE4' };
const STONE: Record<PaletteId, string> = { a: '#B9AE9B', b: '#A39684', c: '#AFA99C' };
const ssColor = (role: string, p: PaletteId, fb: string): string => {
  const v = SS_ROLES[role]?.[PI[p]];
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : fb;
};

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const m = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

/** Hex colour of every road role in a palette: Kenney asphalt (the palette's `road`, a darker gutter strip by the
 *  curb), white markings, the streetscape's stone sidewalks and pale curbs. */
export function roadColors(p: PaletteId): Record<RoadRole, string> {
  const P: Palette = PALETTES[p];
  const walk = ssColor('ssWalk', p, FALLBACK_WALK[p]), curb = ssColor('ssCurb', p, FALLBACK_CURB[p]);
  const road = P.road;
  return {
    lane: road,
    gutter: mix(road, '#000000', 0.12),
    mark: P.mark,
    walk,
    curb,
    roadSide: mix(road, '#000000', 0.2),
    island: P.lawn,
    islandEdge: curb,
    shrub: colorOf(P, 'leaf', 0),
    ground: P.board,
    stone: STONE[p],
  };
}
