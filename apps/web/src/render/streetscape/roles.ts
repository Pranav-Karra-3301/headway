// Owner: S1. Streetscape colour roles (palettes a / b / c). Palette roles the kit already has (road, lawn, field,
// mark, car, …) come from render/palettes.ts so ground and roads always agree; the `ss*` roles are ours.
import { PALETTES, type Palette } from '../palettes';
import type { RoleColors } from '../assets/types';

export const SS_ROLES: RoleColors = {
  /** Sidewalk paving: a warm stone a shade deeper than the road, so the carriageway stays the lightest band. */
  ssWalk: ['#E9DECB', '#CBBDA4', '#D2CDC2'],
  /** Curb faces and the chamfered sidewalk edge: pale stone that catches the light. */
  ssCurb: ['#FBF5EA', '#E4D9C4', '#ECEAE4'],
  /** Gravel / sand footpaths through lawns and quads. */
  ssPath: ['#EBD9B8', '#D4C29F', '#DCD0B8'],
  /** Plaza paving and its darker border band. */
  ssPlaza: ['#F3EBDD', '#DFD3BC', '#E7E3D9'],
  ssPlazaEdge: ['#E0D1B8', '#C8B99F', '#CEC8BB'],
  /** Parking lot surface (matches the residential lot asset) and painted lines. */
  ssLot: ['#DDD6C9', '#C4BCAE', '#CBC8C1'],
  ssLine: ['#FFFFFF', '#F7F2E8', '#FFFFFF'],
  /** Zebra stripes: warm white with a hint of body so they read on the cream road. */
  ssZebra: ['#FFFFFF', '#F7F2E8', '#FFFFFF'],
  /** Bus-stop bay paint (the stop sign yellow). */
  ssBay: ['#F6C945', '#D9A441', '#E9B03B'],
  /** Garden kerb, planted bed and flowers. */
  ssRim: ['#E8DCC6', '#CDBFA6', '#D6D1C6'],
  ssBed: ['#6DBB7E', '#7E9F6B', '#7E9B52'],
  ssFlower: [
    ['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2', '#E9785A'],
    ['#C96F5B', '#D9A441', '#F5EFE3', '#8F7AA6', '#B5553C'],
    ['#E9B03B', '#A8483A', '#F5F2EA', '#8B5FB0', '#E07A2E'],
  ],
};

const paletteIndex = (p: Palette): 0 | 1 | 2 => (p === PALETTES.b || p.name === PALETTES.b.name ? 1 : p === PALETTES.c || p.name === PALETTES.c.name ? 2 : 0);

/** Bake resolver for the `ss*` roles. */
export function resolveRole(role: string, idx: number, p: Palette): string | undefined {
  const v = SS_ROLES[role]?.[paletteIndex(p)];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length] : v;
}

/** Number of colours of an array role (palette a). */
export function roleCount(role: string): number {
  const v = SS_ROLES[role]?.[0];
  return Array.isArray(v) ? v.length : 1;
}
