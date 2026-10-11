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
  // Art bible §6.4: three flat toy bands, deep water L ≥ 0.66, hue ≤ 220°, chroma ≤ 0.10 (a light, quiet foreground
  // that never out-shouts the buses); sand #ECDCBD.
  a: {
    shallow: '#AEE4DF', mid: '#82CCD5', deep: '#5EAFC4', foam: '#FFFDF7',
    duskNear: '#5A5E8E', duskFar: '#2F3A6A', glow: '#FFC77A',
    sand: '#EEDDBD', wetSand: '#DFC9A2', bedSand: '#C9B793',
  },
  b: {
    shallow: '#B9DED3', mid: '#93C4C3', deep: '#6AA5B2', foam: '#FBF7EE',
    duskNear: '#5E5B82', duskFar: '#30385A', glow: '#FFCB86',
    sand: '#E9D8B6', wetSand: '#D7C29C', bedSand: '#C1AC8A',
  },
  c: {
    shallow: '#B5E0E4', mid: '#8AC4D3', deep: '#62A4BF', foam: '#FFFFFF',
    duskNear: '#575C8C', duskFar: '#283463', glow: '#FFC983',
    sand: '#EDE0C5', wetSand: '#DACAA8', bedSand: '#C3B293',
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
  // Pastel beach-hut paints (gameplay owns saturation: no full-strength route / stop / bus / train hues).
  hutPaint: [
    ['#E59C86', '#8CC2AE', '#EFD594', '#97B4DE', '#EDB4B8'],
    ['#B9735F', '#7FAEA6', '#DDBB78', '#7C93B8', '#CFA382'],
    ['#C9806C', '#86A9C9', '#E8C77E', '#86B394', '#E3A577'],
  ],
  boatPaint: [
    ['#E59C86', '#97B4DE', '#EFD594', '#8CC2AE', '#EDB4B8'],
    ['#B9735F', '#7C93B8', '#DDBB78', '#7FAEA6', '#CFA382'],
    ['#C9806C', '#86A9C9', '#E8C77E', '#86B394', '#E3A577'],
  ],
  hull: [['#FFFDF7', '#F3EEE3'], ['#F7F2E8', '#E9E1D2'], ['#FFFFFF', '#EEF0F2']],
  sail: [
    ['#FFF8EC', '#E59C86', '#EFD594', '#8CC2AE', '#97B4DE'],
    ['#F7F2E8', '#B9735F', '#DDBB78', '#7FAEA6', '#7C93B8'],
    ['#FFFFFF', '#C9806C', '#E8C77E', '#86B394', '#86A9C9'],
  ],
  lhStripe: ['#DE6A5C', '#9A4A4E', '#3A5A8A'],
  dune: [['#94C47C', '#A9CB84', '#80B37A'], ['#9FB37F', '#B0BF89', '#8CA474'], ['#B9BA72', '#CDAA5C', '#9FB06C']],
  drift: ['#D3C6B1', '#BCAE96', '#C7BBA8'],
  duck: ['#F6C945', '#D9A441', '#E9B03B'],
  beak: ['#F08A3C', '#C8623A', '#E07A2E'],
  buoy: [['#E5574A', '#3FA796'], ['#A9454F', '#2F7F7A'], ['#C9452E', '#2E8B57']],
  sandRole: ['#EEDDBD', '#E9D8B6', '#EDE0C5'],
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
