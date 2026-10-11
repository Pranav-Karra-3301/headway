// Owner: T2. The 3 kit palettes (from .superpowers/wip/kit-sheet.html) + roles added for kit v2.
import type { DetailMode, LightMode, PaletteId } from './types';

export interface Palette {
  name: string;
  bg: string; duskBg: string;
  board: string; boardEdge: string; lawn: string; road: string; mark: string; curb: string;
  ballast: string; ties: string; rail: string;
  wall: string[]; brick: string[]; roof: string[]; window: string; windowGlow: string; frame: string; door: string; trim: string;
  awning: string[]; stripe: string; metal: string;
  hall: string; hallRoof: string; column: string; dome: string;
  tower: string; towerRoof: string; clock: string; hands: string;
  stadium: string; seats: string[]; field: string; mast: string; lamp: string;
  trunk: string; leaf: string[]; pine: string[];
  bus: string; busRoof: string; glass: string; tire: string; hub: string; display: string; headlight: string; taillight: string;
  car: string[];
  train: string; trainStripe: string; trainRoof: string; bogie: string;
  stop: string; post: string; panel: string; bench: string; platform: string; safety: string; canopy: string;
  shirt: string[]; skin: string; route: string[];
  ink: string; paper: string; accent: string;
}

/** Every colour key of a palette is a material role. */
export type Role = Exclude<keyof Palette, 'name'>;

export const DEFAULT_PALETTE: PaletteId = 'a';
export const DEFAULT_DETAIL: DetailMode = 'toy';
export const DEFAULT_LIGHT: LightMode = 'day';

export const PALETTES: Record<PaletteId, Palette> = {
  a: {
    name: 'Wooden Toy',
    bg: '#DDEFE5', duskBg: '#2F3A5E',
    board: '#A8D8B9', boardEdge: '#7FBF98', lawn: '#8FCB9B', road: '#F4EBDD', mark: '#FFFFFF', curb: '#E6DCCB',
    ballast: '#D9CBB3', ties: '#B08B63', rail: '#7E848E',
    wall: ['#F6EEDC', '#F1E4C8', '#FBF6EA'], brick: ['#D98A6C', '#C97A5E'], roof: ['#E9785A', '#3FA796', '#F2C14E'],
    window: '#2C3A55', windowGlow: '#FFD27A', frame: '#FFFFFF', door: '#9B6B43', trim: '#E6D8BE',
    awning: ['#E9785A', '#3FA796', '#F2C14E'], stripe: '#FFF8EC', metal: '#C9CFD6',
    hall: '#F3E6CF', hallRoof: '#3FA796', column: '#FFFFFF', dome: '#5DBB9F',
    tower: '#F6EEDC', towerRoof: '#E9785A', clock: '#FFFFFF', hands: '#1F2A44',
    stadium: '#F3EDE2', seats: ['#5A8BD6', '#7FA6E6'], field: '#6FC07F', mast: '#4A4F5C', lamp: '#FFF3C4',
    trunk: '#9B6B43', leaf: ['#4FAF6E', '#66BF7A', '#3E9A5F'], pine: ['#2F8A5E', '#3A9A68'],
    bus: '#2E5BDA', busRoof: '#F4F1EA', glass: '#22304A', tire: '#2A2D33', hub: '#D9DCE2', display: '#FFD45C', headlight: '#FFF6D8', taillight: '#E5484D',
    car: ['#D9665B', '#F4D58D', '#8FB8DE', '#EFE6D6', '#E8A2A8', '#6B7280'],
    train: '#D7443E', trainStripe: '#FFF1D6', trainRoof: '#F4E9D8', bogie: '#3A3D44',
    stop: '#F6C945', post: '#3D4250', panel: '#CFE3EE', bench: '#9B6B43', platform: '#E8DCC8', safety: '#F6C945', canopy: '#D7443E',
    shirt: ['#3D5A80', '#E07A5F', '#81B29A', '#F2CC8F', '#6D597A', '#3D405B'], skin: '#F1CFB0', route: ['#1FA99A', '#F0A830', '#8A6BD8'],
    ink: '#1F2A44', paper: '#FFFBF2', accent: '#2E5BDA',
  },
  b: {
    name: 'Miniature Railway',
    bg: '#F3ECDD', duskBg: '#30354A',
    board: '#EADFC8', boardEdge: '#D6C6A6', lawn: '#B9C99A', road: '#D3CABA', mark: '#F7F2E8', curb: '#C7BCA8',
    ballast: '#C9BBA2', ties: '#8C6B4E', rail: '#6F7279',
    wall: ['#C8694C', '#B5553C', '#E3CBA8'], brick: ['#A9503A', '#93452F'], roof: ['#5E6B73', '#8F3F2C', '#4A4F55'],
    window: '#2A2F3A', windowGlow: '#FFD68A', frame: '#F5EFE3', door: '#5A3A2A', trim: '#EADCC4',
    awning: ['#8F3F2C', '#2F7F7A', '#D9A441'], stripe: '#F5EFE3', metal: '#B9B4AA',
    hall: '#E6DCC6', hallRoof: '#6E7F6A', column: '#F5EFE3', dome: '#6E8F7A',
    tower: '#E6DCC6', towerRoof: '#5E6B73', clock: '#FBF7EE', hands: '#2B2A28',
    stadium: '#E9E0CF', seats: ['#8C2F39', '#A9454F'], field: '#9DB97E', mast: '#4A4F55', lamp: '#FFF0C2',
    trunk: '#7A5A40', leaf: ['#7E9F6B', '#93AE7A', '#6B8C5C'], pine: ['#4F6F4F', '#5B7B58'],
    bus: '#22407A', busRoof: '#EDE6D6', glass: '#1E2633', tire: '#26282C', hub: '#CFC8BA', display: '#F2C14E', headlight: '#FFF3D6', taillight: '#C8423B',
    car: ['#7D3A3F', '#2F5D50', '#D9C9A3', '#4A5A75', '#B87D4B', '#6E6A64'],
    train: '#F1E7CF', trainStripe: '#8C2F39', trainRoof: '#D9CDB4', bogie: '#3A3A3A',
    stop: '#D9A441', post: '#3E3A36', panel: '#D8E0DC', bench: '#7A5A40', platform: '#DCCFB6', safety: '#D9A441', canopy: '#2F7F7A',
    shirt: ['#2F3E5C', '#9C4A3A', '#6E8B5E', '#D9A441', '#7A6A8C', '#3E3A36'], skin: '#EAC7A6', route: ['#2F8F86', '#E0A23B', '#9A4E8C'],
    ink: '#2B2A28', paper: '#FBF7EE', accent: '#22407A',
  },
  c: {
    name: 'State College Autumn',
    bg: '#EEF0F4', duskBg: '#262E48',
    board: '#E7E2CF', boardEdge: '#CFC6AE', lawn: '#A9C48A', road: '#DAD7D0', mark: '#FFFFFF', curb: '#C9C5BC',
    ballast: '#CBC4B4', ties: '#7B5B43', rail: '#6B7280',
    wall: ['#A8483A', '#EADFC9', '#F5F2EA'], brick: ['#A8483A', '#8F3C30'], roof: ['#3E4B5C', '#1E3A6E', '#5B6573'],
    window: '#1F2A3C', windowGlow: '#FFD889', frame: '#FFFFFF', door: '#6B4A35', trim: '#F5F2EA',
    awning: ['#0B2A5B', '#A8483A', '#E9B03B'], stripe: '#FFFFFF', metal: '#BFC5CD',
    hall: '#EADFC9', hallRoof: '#3E4B5C', column: '#FFFFFF', dome: '#5E7F8A',
    tower: '#EADFC9', towerRoof: '#1E3A6E', clock: '#FFFFFF', hands: '#0B2A5B',
    stadium: '#F5F5F2', seats: ['#0B2A5B', '#1E3A6E'], field: '#7DB06A', mast: '#3E4B5C', lamp: '#FFF6D5',
    trunk: '#6B4A35', leaf: ['#E07A2E', '#C9452E', '#E9B03B', '#8DA35A'], pine: ['#3F6B45', '#4A7A50'],
    bus: '#0B2A5B', busRoof: '#F5F5F2', glass: '#1A2232', tire: '#25272B', hub: '#D5D8DE', display: '#FFB547', headlight: '#FFF6D8', taillight: '#E5484D',
    car: ['#7A8B99', '#CDBF9F', '#8B3A3A', '#3F4E5C', '#ECE8DE', '#9C7A5B'],
    train: '#F7F5EF', trainStripe: '#0B2A5B', trainRoof: '#C9CED6', bogie: '#33363C',
    stop: '#E9B03B', post: '#2B3340', panel: '#DCE6F0', bench: '#6B4A35', platform: '#E2DDD0', safety: '#E9B03B', canopy: '#0B2A5B',
    shirt: ['#0B2A5B', '#F4F4F4', '#3B5B92', '#0B2A5B', '#E9B03B', '#A8483A'], skin: '#EBC9A9', route: ['#E07A2E', '#2E8B57', '#7B4FC0'],
    ink: '#0B2A5B', paper: '#FFFFFF', accent: '#0B2A5B',
  },
};

/** Hex colour of a role (array roles are indexed modulo their length). */
export function colorOf(p: Palette, role: Role, idx = 0): string {
  const v = p[role];
  if (Array.isArray(v)) return v[((idx % v.length) + v.length) % v.length]!;
  return v;
}

/** Number of colours a role has (1 for scalar roles). */
export function roleSize(p: Palette, role: Role): number {
  const v = p[role];
  return Array.isArray(v) ? v.length : 1;
}

/** Roles that light up at dusk (emissive colour + intensity). `onlyIdx` limits the glow to one variant of an array role. */
export interface Glow { color: string; intensity: number; onlyIdx?: number }
export const GLOW: Partial<Record<Role, Glow>> = {
  window: { color: '#FFD27A', intensity: 0.9 },
  lamp: { color: '#FFF3C4', intensity: 1.4 },
  headlight: { color: '#FFF6D8', intensity: 1.6 },
  taillight: { color: '#FF5A5A', intensity: 1.2 },
  display: { color: '#FFD45C', intensity: 0.9 },
  clock: { color: '#FFF4D6', intensity: 0.5 },
};
