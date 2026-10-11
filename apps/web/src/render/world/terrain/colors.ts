// Owner: E1. Terrain colours per palette: the hillside ramp (board-matching foot → meadow → forest floor → cool
// upper slopes → bare rock), aerial haze toward E3's distant ridges, sand at the headland shores, cut-face strata,
// and the custom roles of the portals and rocks (resolved for bakeGeometry).
import * as THREE from 'three';
import { PALETTES, type Palette } from '../../palettes';
import type { PaletteId } from '../../types';

export interface TerrainColors {
  /** Ground at the foot of the hills (= palette board, so the board bends up into the hills seamlessly). */
  foot: string;
  grass: string;
  meadow: string;
  /** Forest floor under the pine patches. */
  forest: string;
  /** Cool upper slopes. */
  upper: string;
  rock: string;
  cliff: string;
  sand: string;
  /** Aerial-perspective target (E3's lit distant ridge colour). */
  haze: string;
  /** Autumn accents on the slopes (palette c only; others reuse meadow). */
  accent: string;
  /** Diorama cut face, top → bottom. */
  strata: [string, string, string, string];
}

export const TERRAIN_COLORS: Record<PaletteId, TerrainColors> = {
  a: {
    foot: PALETTES.a.board, grass: '#97CFA3', meadow: '#78BB8A', forest: '#4C9469', upper: '#68A08A',
    rock: '#C2B8A8', cliff: '#A99F90', sand: '#EFE3C6', haze: '#A5D3C3', accent: '#78BB8A',
    strata: ['#7E9F6B', '#A88560', '#C9A97E', '#9C8F80'],
  },
  b: {
    foot: PALETTES.b.board, grass: '#CDD2A6', meadow: '#AEBC8A', forest: '#84996B', upper: '#93A385',
    rock: '#C6BAA6', cliff: '#B2A590', sand: '#EEE3CA', haze: '#C3C9B2', accent: '#B6C392',
    strata: ['#8C9A6C', '#9C7A58', '#C2A47E', '#948876'],
  },
  c: {
    foot: PALETTES.c.board, grass: '#C8D2A2', meadow: '#ABBA7F', forest: '#89975A', upper: '#9E9878',
    rock: '#C8C0B2', cliff: '#B3AA9B', sand: '#EEE6D2', haze: '#C7B6AA', accent: '#D99A4E',
    strata: ['#8C9A5E', '#9A7656', '#C2A27C', '#928878'],
  },
};

/** Custom roles of the portals, lamps and rocks: role → [a, b, c] colour or colour list. */
export const TERRAIN_ROLES: Record<string, [string | string[], string | string[], string | string[]]> = {
  /** Portal masonry: light, mid, dark (voussoirs alternate 0/1, cornice 2). */
  trStone: [['#EEE5D2', '#DED2BB', '#CDBFA4'], ['#E6DAC2', '#D3C4A7', '#BEAD8D'], ['#ECE6D8', '#D9D0BE', '#C3B8A3']],
  /** Tunnel darkness. */
  trMouth: ['#283048', '#2A2A33', '#1E2538'],
  /** Boulders: warm greys. */
  trRock: [['#C9C1B2', '#B6AD9C', '#D8D1C4'], ['#C0B4A0', '#AEA18C', '#CFC5B3'], ['#C4BCAE', '#B0A798', '#D3CCC0']],
  /** Lantern housings. */
  trIron: ['#3D4250', '#3E3A36', '#2B3340'],
};

const ROLE_INDEX: Record<string, number> = {};
for (const id of ['a', 'b', 'c'] as PaletteId[]) ROLE_INDEX[PALETTES[id].name] = id === 'a' ? 0 : id === 'b' ? 1 : 2;

/** Resolver for bakeGeometry / recolorBaked: custom terrain roles per palette. */
export function resolveTerrainRole(role: string, idx: number, palette: Palette): string | undefined {
  const r = TERRAIN_ROLES[role];
  if (!r) return undefined;
  const v = r[ROLE_INDEX[palette.name] ?? 0]!;
  return Array.isArray(v) ? v[((idx % v.length) + v.length) % v.length] : v;
}

/** Linear-space colour set for painting vertices quickly. */
export interface TerrainRamp {
  foot: THREE.Color; grass: THREE.Color; meadow: THREE.Color; forest: THREE.Color; upper: THREE.Color;
  rock: THREE.Color; cliff: THREE.Color; sand: THREE.Color; haze: THREE.Color; accent: THREE.Color;
  strata: THREE.Color[];
  stone: THREE.Color[];
}
export function terrainRamp(p: PaletteId): TerrainRamp {
  const t = TERRAIN_COLORS[p];
  const c = (h: string) => new THREE.Color(h);
  const stone = TERRAIN_ROLES.trStone![p === 'a' ? 0 : p === 'b' ? 1 : 2] as string[];
  return {
    foot: c(t.foot), grass: c(t.grass), meadow: c(t.meadow), forest: c(t.forest), upper: c(t.upper),
    rock: c(t.rock), cliff: c(t.cliff), sand: c(t.sand), haze: c(t.haze), accent: c(t.accent),
    strata: t.strata.map(c), stone: stone.map(c),
  };
}
