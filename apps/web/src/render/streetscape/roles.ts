// Owner: S1. Streetscape colour roles (palettes a / b / c). Palette roles the kit already has (road, lawn, field,
// mark, car, …) come from render/palettes.ts so ground and roads always agree; the `ss*` roles are ours.
// Street paving adapts to the palette's road value: on dark asphalt the sidewalks are light stone (the same
// colours as G0's Kenney road tiles in the greater town) with white zebras; on a light (cream) road they step a
// value darker so carriageway, curb and sidewalk still read as three bands.
import { PALETTES, type Palette } from '../palettes';
import type { RoleColors } from '../assets/types';

export const SS_ROLES: RoleColors = {
  /** Sidewalk paving (dark-road look): warm light stone, = greater/roads WALK. */
  ssWalk: ['#E9DECB', '#CBBDA4', '#D2CDC2'],
  /** Curb faces and the chamfered sidewalk edge: pale stone that catches the light, = greater/roads CURB. */
  ssCurb: ['#FBF5EA', '#E4D9C4', '#ECEAE4'],
  /** Paving joints across the sidewalk (detail). */
  ssJoint: ['#D9CBB4', '#BBAC92', '#C3BDB1'],
  /** Gravel / sand footpaths through lawns and quads. */
  ssPath: ['#EBD9B8', '#D4C29F', '#DCD0B8'],
  /** Plaza flagstones: a warm sandstone checker (base, alternate flag), and the darker border band. */
  ssPlaza: [['#E8D8C3', '#EEE0CD'], ['#CDBDA2', '#D4C5AB'], ['#D3CDBF', '#DAD5CA']],
  ssPlazaEdge: ['#D6C3AA', '#BBAA8E', '#C2BBAC'],
  /** Parking lot surface (dark-road look: a lighter asphalt than the street) and painted lines. */
  ssLot: ['#7C8191', '#7B7D84', '#7A7E89'],
  ssLine: ['#FFFFFF', '#F7F2E8', '#FFFFFF'],
  /** Zebra stripes (dark-road look: crisp white). */
  ssZebra: ['#FFFFFF', '#F7F2E8', '#FFFFFF'],
  /** Bus-stop bay paint (the stop sign yellow). */
  ssBay: ['#F6C945', '#D9A441', '#E9B03B'],
  /** Garden kerb, planted bed (two greens for alternating rows) and flowers. */
  ssRim: ['#E8DCC6', '#CDBFA6', '#D6D1C6'],
  ssBed: [['#6DBB7E', '#5FAE73'], ['#7E9F6B', '#6F9160'], ['#7E9B52', '#6E8C47']],
  /** Allotment soil between planted rows in big gardens. */
  ssSoil: ['#C9A684', '#A98B6B', '#B39573'],
  ssFlower: [
    ['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2', '#E9785A'],
    ['#C96F5B', '#D9A441', '#F5EFE3', '#8F7AA6', '#B5553C'],
    ['#E9B03B', '#A8483A', '#F5F2EA', '#8B5FB0', '#E07A2E'],
  ],
};

/** Overrides when the palette's road is light (cream streets): darker sidewalk, stone zebras, pale lot. */
export const SS_LIGHT_ROAD: RoleColors = {
  ssWalk: ['#D8D2C6', '#BDB3A2', '#C6C1B6'],
  ssJoint: ['#C9C2B5', '#AFA593', '#B8B3A8'],
  ssLot: ['#CFCAC0', '#B9B1A2', '#BEBBB3'],
  ssZebra: ['#D3C9B8', '#B8AD99', '#C2BDB2'],
};

/** OKLab lightness of a #rrggbb colour. */
export function okL(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** True when the palette's streets are light (cream) rather than asphalt. */
export const lightRoad = (p: Palette): boolean => okL(p.road) > 0.7;

const paletteIndex = (p: Palette): 0 | 1 | 2 => (p === PALETTES.b || p.name === PALETTES.b.name ? 1 : p === PALETTES.c || p.name === PALETTES.c.name ? 2 : 0);

/** The colour (or colour list) of an `ss*` role in a palette, after the light-road overrides. */
export function roleValue(role: string, p: Palette): string | string[] | undefined {
  const i = paletteIndex(p);
  return (lightRoad(p) ? SS_LIGHT_ROAD[role]?.[i] : undefined) ?? SS_ROLES[role]?.[i];
}

/** Bake resolver for the `ss*` roles. */
export function resolveRole(role: string, idx: number, p: Palette): string | undefined {
  const v = roleValue(role, p);
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length] : v;
}

/** Number of colours of an array role (palette a). */
export function roleCount(role: string): number {
  const v = SS_ROLES[role]?.[0];
  return Array.isArray(v) ? v.length : 1;
}
