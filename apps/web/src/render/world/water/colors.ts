// Owner: E2. Lake colours per palette (a Wooden Toy, b Miniature Railway, c State College Autumn) and the extra
// material roles the beach, marina, causeways, lighthouse and boats use (resolved per palette at bake time).
import { PALETTES, type Palette } from '../../palettes';
import type { PaletteId } from '../../types';

export interface WaterColors {
  /** Day: shallows over sand → open water → the deep middle of the bay. */
  shallow: string;
  mid: string;
  deep: string;
  foam: string;
  /** Dusk sky reflection (added as light, so the lake glows indigo rather than going black). */
  duskNear: string;
  duskFar: string;
  /** Warm reflections of lamps / the lighthouse / the lit town. */
  glow: string;
  /** Beach sand: dry, wet (just above the waterline), and under the water. */
  sand: string;
  wetSand: string;
  bedSand: string;
}

export const WATER_COLORS: Record<PaletteId, WaterColors> = {
  a: {
    shallow: '#A3E4D7', mid: '#68C7D3', deep: '#4A9FCC', foam: '#FFFDF7',
    duskNear: '#5B5E96', duskFar: '#2E3A72', glow: '#FFC77A',
    sand: '#F5E2BC', wetSand: '#E3C796', bedSand: '#CDB487',
  },
  b: {
    shallow: '#B4D8CB', mid: '#86B9B6', deep: '#5D8E9E', foam: '#FBF7EE',
    duskNear: '#5E5B82', duskFar: '#30385A', glow: '#FFCB86',
    sand: '#EBD8B4', wetSand: '#D5BC93', bedSand: '#BFA683',
  },
  c: {
    shallow: '#AFD9E4', mid: '#7AB3CF', deep: '#4F7FAD', foam: '#FFFFFF',
    duskNear: '#575C8C', duskFar: '#283463', glow: '#FFC983',
    sand: '#EDE0C5', wetSand: '#D7C4A2', bedSand: '#C0AD8D',
  },
};

type Tri = [string | string[], string | string[], string | string[]];

/** Extra roles (palette a, b, c) for the lake's props and boats; palette roles (wall, roof, lamp, window, …) work too. */
export const WATER_ROLES: Record<string, Tri> = {
  rock: [['#CFC6B8', '#BBB2A5', '#DDD5C8', '#AEA69A'], ['#BDB3A3', '#A99F90', '#CCC3B4', '#9B9284'], ['#C9C4BA', '#B4AFA6', '#D9D4CB', '#A5A098']],
  plank: [['#E2C394', '#D6B583'], ['#CDAE86', '#C1A27A'], ['#D5B68E', '#C9A982']],
  pile: ['#8E6A49', '#6E543E', '#64483A'],
  stone: ['#EFE6D4', '#DED2BA', '#E6E0D4'],
  stoneDark: ['#D9CBB2', '#C4B69C', '#CEC6B6'],
  hutPaint: [
    ['#E9785A', '#3FA796', '#F2C14E', '#5A8BD6', '#E8A2A8'],
    ['#8F3F2C', '#2F7F7A', '#D9A441', '#22407A', '#B87D4B'],
    ['#A8483A', '#2E5B8A', '#E9B03B', '#2E8B57', '#E07A2E'],
  ],
  hull: [['#FFFDF7', '#F3EEE3'], ['#F7F2E8', '#E9E1D2'], ['#FFFFFF', '#EEF0F2']],
  sail: [
    ['#FFF8EC', '#E9785A', '#F2C14E', '#3FA796', '#5A8BD6'],
    ['#F7F2E8', '#8F3F2C', '#D9A441', '#2F7F7A', '#22407A'],
    ['#FFFFFF', '#A8483A', '#E9B03B', '#2E8B57', '#0B2A5B'],
  ],
  lhStripe: ['#E5574A', '#8C2F39', '#0B2A5B'],
  dune: [['#94C47C', '#A9CB84', '#80B37A'], ['#9FB37F', '#B0BF89', '#8CA474'], ['#B9BA72', '#CDAA5C', '#9FB06C']],
  drift: ['#D3C6B1', '#BCAE96', '#C7BBA8'],
  duck: ['#F6C945', '#D9A441', '#E9B03B'],
  beak: ['#F08A3C', '#C8623A', '#E07A2E'],
  buoy: [['#E5574A', '#3FA796'], ['#A9454F', '#2F7F7A'], ['#C9452E', '#2E8B57']],
  sandRole: ['#F5E2BC', '#EBD8B4', '#EDE0C5'],
};

const IDS: PaletteId[] = ['a', 'b', 'c'];

/** Palette id of a Palette object (identity, then name), defaulting to 'a'. */
export function paletteIdOf(P: Palette): PaletteId {
  return IDS.find((k) => PALETTES[k] === P) ?? IDS.find((k) => PALETTES[k].name === P.name) ?? 'a';
}

/** bakeGeometry resolver for the lake's custom roles. */
export function resolveWaterRole(role: string, idx: number, P: Palette): string | undefined {
  const tri = WATER_ROLES[role];
  if (!tri) return undefined;
  const v = tri[IDS.indexOf(paletteIdOf(P))]!;
  return Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length] : v;
}
