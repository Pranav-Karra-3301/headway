// Owner: G1. Highway colours per palette: G0's Kenney road roles (asphalt, markings, kerbs, stone) so the
// expressway matches the greater-town streets, plus guardrails, concrete, signs, the portal masonry (E1's roles)
// and the hillside (E1's terrain ramp). Gameplay owns saturation: everything here stays soft and greyed.
import { PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { TERRAIN_COLORS, TERRAIN_ROLES } from '../../world/terrain/colors';
import { roadColors, type RoadRole } from '../roads/tiles';

export type HwRole =
  | RoadRole
  | 'rail' | 'post' | 'concrete' | 'concreteDark' | 'deckUnder' | 'coping' | 'signPanel' | 'signText'
  | 'portal' | 'portalRing' | 'portalCornice' | 'mouth' | 'iron' | 'lampGlass'
  | 'hillGrass' | 'hillMeadow' | 'hillForest' | 'hillRock' | 'hillSoil' | 'pine' | 'pineDark' | 'leaf' | 'trunk' | 'rock';

const PI: Record<PaletteId, 0 | 1 | 2> = { a: 0, b: 1, c: 2 };
const tr = (role: string, p: PaletteId, idx = 0): string => {
  const v = TERRAIN_ROLES[role]![PI[p]];
  return Array.isArray(v) ? v[idx % v.length]! : v;
};

const EXTRA: Record<PaletteId, Partial<Record<HwRole, string>>> = {
  a: { rail: '#D3D7DE', post: '#8C93A1', concrete: '#EEE8DC', concreteDark: '#D9D1C2', deckUnder: '#A49D92', coping: '#F4EFE6', signPanel: '#4E8F76', signText: '#F7F3EA' },
  b: { rail: '#CBC6BC', post: '#8C877E', concrete: '#E4DACA', concreteDark: '#CFC3AF', deckUnder: '#9A9183', coping: '#ECE4D6', signPanel: '#5F7F5E', signText: '#F3EEE2' },
  c: { rail: '#CDD2D8', post: '#7F8894', concrete: '#EAE6DE', concreteDark: '#D3CEC4', deckUnder: '#9C9890', coping: '#F2EFE9', signPanel: '#3F6E5C', signText: '#F6F4EE' },
};

const memo = new Map<PaletteId, Record<HwRole, string>>();

/** Hex colour of every highway role in a palette. */
export function highwayColors(p: PaletteId): Record<HwRole, string> {
  const hit = memo.get(p);
  if (hit) return hit;
  const P = PALETTES[p], T = TERRAIN_COLORS[p], R = roadColors(p);
  const out = {
    ...R,
    ...EXTRA[p],
    portal: tr('trStone', p, 0), portalRing: tr('trStone', p, 1), portalCornice: tr('trStone', p, 2),
    mouth: tr('trMouth', p), iron: tr('trIron', p), lampGlass: P.lamp,
    hillGrass: T.grass, hillMeadow: T.meadow, hillForest: T.forest, hillRock: T.rock, hillSoil: T.strata[1],
    pine: P.pine[0]!, pineDark: P.pine[1] ?? P.pine[0]!, leaf: P.leaf[0]!, trunk: P.trunk, rock: tr('trRock', p, 0),
  } as Record<HwRole, string>;
  memo.set(p, out);
  return out;
}

/** Roles that glow at dusk (aGlow = palette lamp × intensity). */
export const HW_GLOW: Partial<Record<HwRole, number>> = { lampGlass: 1.6 };
