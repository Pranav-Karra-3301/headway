// Owner: K0. Kenney → Wooden Toy recolouring tables (pure data + colour math, no DOM; unit-tested).
// - Nature kit: every named material maps to a role (`NATURE_REMAP`).
// - Colormap kits (car, watercraft, city-*, train, survival): every Kenney swatch block of the shared 512×512
//   colormap maps to a role by its flat colour (`SWATCH_ROLE`); each part keeps a small OKLab lightness `shade`
//   so Kenney's light/dark contrast survives the flat recolour.
// Roles are T2 palette roles (leaf, pine, trunk, …: they follow palette switches everywhere, also through
// bakeGeometry) or the `kn*` roles in `KENNEY_ROLES` (colours for palettes a, b, c).
import { PALETTES, type Palette } from '../../palettes';
import type { PaletteId } from '../../types';
import type { RoleColors } from '../types';

export interface RoleRef { role: string; idx: number }

/** `kn*` roles: [palette a (Wooden Toy), b (Miniature Railway), c (State College Autumn)]. */
export const KENNEY_ROLES: RoleColors = {
  // colormap swatch families
  knWhite: ['#FBF7EE', '#F5EFE3', '#F7F5EF'],
  knCream: ['#F3E6CF', '#E6DCC6', '#EADFC9'],
  knTan: ['#E9C9A2', '#D8BE98', '#D6C2A2'],
  knPeach: ['#EFA07C', '#C98B6B', '#D39572'],
  knBrown: ['#A8704C', '#7A5A40', '#7A5340'],
  knOrange: ['#E9785A', '#B8693F', '#E07A2E'],
  knYellow: ['#F2C14E', '#D9A441', '#E9B03B'],
  knRed: ['#D9584E', '#A9503A', '#A8483A'],
  knGreen: ['#4FAF7A', '#6E8F6A', '#5E7F5A'],
  knBlue: ['#6B93D2', '#4A6A8F', '#3B5B92'],
  knIndigo: ['#3E5AA8', '#2F4470', '#1E3A6E'],
  knSky: ['#A9C9E6', '#A7B9C2', '#B4C8DC'],
  knPurple: ['#9F86D8', '#7A6A8C', '#7B4FC0'],
  knPink: ['#E8A2A8', '#C98F99', '#D9A0A8'],
  knDark: ['#3D4250', '#3E3A36', '#2B3340'],
  knSlate: ['#555B6B', '#4F4C48', '#3E4B5C'],
  knGrey: ['#737A88', '#6E6A64', '#5B6573'],
  knGreyLight: ['#9CA2AE', '#9A958C', '#8F98A3'],
  knSilver: ['#C3C8D0', '#B9B4AA', '#BFC5CD'],
  // nature kit materials
  knGrass: ['#6CBE84', '#8FAB78', '#9DAE62'],
  knFall: [['#F2C14E', '#EE9A4E', '#E9785A'], ['#D9A441', '#C98B4A', '#B5553C'], ['#E07A2E', '#C9452E', '#E9B03B']],
  knBarkDark: ['#7E5537', '#5F4632', '#553A2A'],
  knBirch: ['#F4EEE2', '#EFE8D8', '#F6F3EC'],
  knWood: ['#C99A6B', '#A07A55', '#A88560'],
  knWoodDark: ['#9B6B43', '#7A5A40', '#6B4A35'],
  knWoodInner: ['#EBD3AE', '#E0CBA8', '#E2CDB0'],
  knStone: ['#CFCBC2', '#BDB7AC', '#C3C4C4'],
  knStoneDark: ['#ABA79E', '#9C968B', '#9EA1A5'],
  knDirt: ['#D9AE84', '#BF9F7B', '#C4A27C'],
  knDirtDark: ['#B98B63', '#A0805F', '#9C7E5E'],
  knWater: ['#8FD0E6', '#9CC3C8', '#9BC4D8'],
  knFlowerRed: ['#EE7A6E', '#B5553C', '#C9452E'],
  knFlowerRedDark: ['#C9554A', '#93452F', '#A8483A'],
  knFlowerYellow: ['#F6C945', '#D9A441', '#E9B03B'],
  knFlowerPurple: ['#B58CF2', '#8F7AA6', '#8B5FB0'],
  knFlowerTan: ['#F0C08C', '#D8BE98', '#D9C3A0'],
};

const r = (role: string, idx = 0): RoleRef => ({ role, idx });

/** Nature-kit material name → role. leafsGreen/leafsDark/woodBark follow the T2 palette (autumn in palette c). */
export const NATURE_REMAP: Record<string, RoleRef> = {
  leafsGreen: r('leaf'), leafsDark: r('pine'), leafsFall: r('knFall'), grass: r('knGrass'),
  woodBark: r('trunk'), woodBarkDark: r('knBarkDark'), woodBirch: r('knBirch'),
  wood: r('knWood'), woodDark: r('knWoodDark'), woodInner: r('knWoodInner'),
  stone: r('knStone'), stoneDark: r('knStoneDark'), dirt: r('knDirt'), dirtDark: r('knDirtDark'),
  water: r('knWater'), corn: r('knYellow'),
  colorRed: r('knFlowerRed'), colorRedDark: r('knFlowerRedDark'), colorYellow: r('knFlowerYellow'),
  colorPurple: r('knFlowerPurple'), colorWhite: r('knWhite'), colorTan: r('knFlowerTan'), _defaultMat: r('knWhite'),
};

/** Flat colour of a Kenney colormap block (shared by every colormap kit) → role. */
export const SWATCH_ROLE: Record<string, string> = {
  '#ffffff': 'knWhite', '#d0d0e1': 'knWhite', '#fde4c7': 'knCream', '#f2bf99': 'knTan', '#e2c3ab': 'knTan',
  '#f1976c': 'knPeach', '#faae8a': 'knPeach', '#b06041': 'knBrown', '#9f6a52': 'knBrown',
  '#ff7e44': 'knOrange', '#ff7a4c': 'knOrange', '#ffc044': 'knYellow', '#ffc214': 'knYellow', '#faba2d': 'knYellow',
  '#cf534f': 'knRed', '#de433e': 'knRed', '#e7585e': 'knRed', '#cf735b': 'knRed', '#d4745d': 'knRed', '#ca707b': 'knRed',
  '#61cb8b': 'knGreen', '#61c8af': 'knGreen', '#6794d9': 'knBlue', '#6895d9': 'knBlue', '#474aac': 'knIndigo',
  '#d0e8ff': 'knSky', '#b5ccec': 'knSky', '#a878e8': 'knPurple', '#c7b6ff': 'knPurple',
  '#f378f0': 'knPink', '#f5c8f0': 'knPink', '#ff8aae': 'knPink',
  '#38383d': 'knDark', '#3a3c3f': 'knDark', '#4f5260': 'knSlate', '#515566': 'knSlate',
  '#666b80': 'knGrey', '#737e9b': 'knGrey', '#868ba1': 'knGreyLight', '#8e95b3': 'knGreyLight', '#a0a8c9': 'knSilver',
};

/** Saturated swatch families that can be a vehicle's paint. */
export const PAINT_ROLES = new Set(['knRed', 'knOrange', 'knYellow', 'knGreen', 'knBlue', 'knIndigo', 'knPurple', 'knPink', 'knPeach']);

export const PALETTE_IDS: readonly PaletteId[] = ['a', 'b', 'c'];
const PI: Record<PaletteId, 0 | 1 | 2> = { a: 0, b: 1, c: 2 };

/** True when `role` is a T2 palette role (colour comes from PALETTES and follows bake/recolour). */
export function isPaletteRole(role: string): boolean {
  return role !== 'name' && role in PALETTES.a;
}

/** Hex colour of a role/variant in a palette (palette roles, then KENNEY_ROLES, else grey). */
export function kenneyColor(role: string, idx: number, palette: PaletteId): string {
  let v: string | string[] | undefined;
  if (isPaletteRole(role)) v = (PALETTES[palette] as unknown as Record<string, string | string[]>)[role];
  else v = KENNEY_ROLES[role]?.[PI[palette]];
  if (v === undefined) return '#9aa0a6';
  if (Array.isArray(v)) return v[((idx % v.length) + v.length) % v.length]!;
  return v;
}

/** Number of variants of a role (for picking idx with k.rand()). */
export function roleVariants(role: string, palette: PaletteId = 'a'): number {
  const v = isPaletteRole(role) ? (PALETTES[palette] as Palette & Record<string, unknown>)[role] : KENNEY_ROLES[role]?.[PI[palette]];
  return Array.isArray(v) ? v.length : 1;
}

// ---------- colour math (sRGB hex ⇄ OKLab) ----------
export type Rgb = [number, number, number];
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex([r, g, b]: Rgb): string {
  const h = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** sRGB (0..1) → OKLab [L, a, b]. */
export function oklab([r, g, b]: Rgb): Rgb {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** OKLab → sRGB (0..1, clamped). */
export function fromOklab([L, A, Bv]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * Bv) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * Bv) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * Bv) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [toSrgb(Math.min(1, Math.max(0, R))), toSrgb(Math.min(1, Math.max(0, G))), toSrgb(Math.min(1, Math.max(0, B)))];
}
/** Shift a colour's OKLab lightness by dL. */
export function shadeHex(hex: string, dL: number): string {
  if (!dL) return hex.toLowerCase();
  const [L, a, b] = oklab(hexToRgb(hex));
  return rgbToHex(fromOklab([Math.min(0.99, Math.max(0.05, L + dL)), a, b]));
}
export function lightness(hex: string): number { return oklab(hexToRgb(hex))[0]; }
export function chroma(hex: string): number { const [, a, b] = oklab(hexToRgb(hex)); return Math.sqrt(a * a + b * b); }

function dist2(x: Rgb, y: Rgb): number { return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2; }
const SWATCH_LAB = Object.keys(SWATCH_ROLE).map((h) => [h, oklab(hexToRgb(h))] as const);

/** Role of a Kenney colormap colour: exact block colour, else the nearest known swatch (OKLab). */
export function swatchRole(hex: string): string {
  const exact = SWATCH_ROLE[hex.toLowerCase()];
  if (exact) return exact;
  const lab = oklab(hexToRgb(hex));
  let best = SWATCH_LAB[0]!;
  for (const s of SWATCH_LAB) if (dist2(s[1], lab) < dist2(best[1], lab)) best = s;
  return SWATCH_ROLE[best[0]]!;
}

/** Kenney gradients → a soft flat shade: 60 % of the lightness offset, in 0.03 steps, within [-0.15, 0.1]. */
export function quantizeShade(dL: number): number {
  const s = Math.round((dL * 0.6) / 0.03) * 0.03;
  return Math.round(Math.min(0.1, Math.max(-0.15, s)) * 100) / 100;
}
