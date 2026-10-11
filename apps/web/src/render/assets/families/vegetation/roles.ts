// Owner: A5. Vegetation colour roles for palettes a (Wooden Toy), b (Miniature Railway), c (State College Autumn).
// `trunk`, `leaf` and `pine` are T2 palette roles, mirrored here so the basic kit previews match the game exactly;
// every other role is family-only and namespaced `veg*`.
import { PALETTES } from '../../../palettes';
import type { RoleColors } from '../../types';

const shared = (role: 'trunk' | 'leaf' | 'pine'): RoleColors[string] => [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]];

export const VEG_ROLES: RoleColors = {
  trunk: shared('trunk'),
  leaf: shared('leaf'),
  pine: shared('pine'),
  /** Maple crowns: limes in a, olive in b, flaming reds/oranges in the autumn palette. */
  vegMaple: [['#8CC65C', '#A4D166', '#74B957'], ['#98AC63', '#AAB972', '#869C58'], ['#C9452E', '#DA6A2C', '#E58A2E']],
  /** Columnar poplars: deep greens, gold in autumn. */
  vegPoplar: [['#3D9466', '#4BA372'], ['#5E7F5A', '#6B8B63'], ['#E2A93B', '#D3922F']],
  vegBirchLeaf: [['#A6D670', '#B9DE7E'], ['#A5B67A', '#B4C387'], ['#EEC24C', '#F3D26A']],
  vegBirchBark: ['#F7F3EA', '#EFE8D8', '#F6F3EC'],
  vegBirchMark: ['#4A4F5C', '#3E3A36', '#2B3340'],
  /** Cherry: blossom pinks (a), dusty rose (b), red-bronze autumn foliage (c). */
  vegBlossom: [['#F5A9BF', '#F8C4D3', '#EE93AE'], ['#D9A3AA', '#E5BCBE', '#C98F99'], ['#B8483E', '#C9603F', '#A83D3A']],
  vegHedge: [['#3E9A5F', '#47A468'], ['#5A7A52', '#64835A'], ['#4E7849', '#587F4F']],
  vegBush: [['#56B06F', '#64BC78', '#4AA466'], ['#71925F', '#7E9F6B', '#668857'], ['#8DA35A', '#B8823C', '#A35A3A']],
  vegFlower: [
    ['#F28CA8', '#F6C945', '#FFFFFF', '#B58CF2', '#E9785A'],
    ['#C96F5B', '#D9A441', '#F5EFE3', '#8F7AA6', '#B5553C'],
    ['#E9B03B', '#A8483A', '#F5F2EA', '#8B5FB0', '#E07A2E'],
  ],
  vegSoil: ['#8A6448', '#7E604A', '#6E5240'],
  /** Stone/timber edging of beds. */
  vegEdge: ['#EADFCB', '#D8CBB2', '#DCD7CC'],
  /** Planter pots: terracotta, cream, sage, timber. */
  vegPot: [['#E28A6A', '#F2E8D8', '#7FB8A4', '#B58256'], ['#B5553C', '#E3CBA8', '#6E7F6A', '#8C6B4E'], ['#A8483A', '#EADFC9', '#3E4B5C', '#7B5B43']],
};

/** Variant counts per role (palette a), for picking tones. */
export const TONES = {
  leaf: 3, pine: 2, vegMaple: 3, vegPoplar: 2, vegBirchLeaf: 2, vegBlossom: 3, vegHedge: 2, vegBush: 3, vegFlower: 5, vegPot: 4,
} as const;
