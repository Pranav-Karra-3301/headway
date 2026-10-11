// Owner: A6 street. Palette roles for street furniture.
// - Palette roles (render/palettes.ts) that the basic preview kit lacks are copied from PALETTES, so the asset
//   preview and the game agree: posts and bench wood match the bus stops, tyres/hubs match the cars.
// - Family-only roles are prefixed `st` so they never collide with other families' roles.
import { PALETTES } from '../../../palettes';
import type { RoleColors } from '../../types';

type PaletteRole = 'post' | 'bench' | 'stripe' | 'tire' | 'hub' | 'taillight';
const fromPalette = (role: PaletteRole): [string, string, string] => [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]];

export const ROLES: RoleColors = {
  post: fromPalette('post'), // dark iron: lamp posts, signal poles, bench frames
  bench: fromPalette('bench'), // warm wood: bench slats, kiosk counter
  stripe: fromPalette('stripe'), // cream awning stripe: umbrella + kiosk awnings
  tire: fromPalette('tire'),
  hub: fromPalette('hub'),
  taillight: fromPalette('taillight'), // red signal lens (glows at dusk like tail lights)
  stPaint: ['#FFFBF3', '#F7F2E8', '#FFFFFF'], // white paint: pickets, café tables, emblems
  stStone: ['#EEE5D4', '#DCCFB6', '#E3DED2'], // light stone: fountain, flag plinth
  stWater: ['#8FD5EA', '#9CC9C8', '#A3C7E2'],
  stFoam: ['#E6F7FB', '#EAF2EE', '#F1F7FB'], // falling water, jets
  stBin: ['#3E9A7C', '#4F6F4F', '#3E4B5C'],
  stHydrant: ['#E5574A', '#B5553C', '#C9452E'],
  stBrass: ['#F2C14E', '#D9A441', '#E9B03B'], // hydrant caps, finials, push buttons
  stMail: ['#3F6DD6', '#2F4E7E', '#1E3A6E'],
  stAmber: ['#F7B538', '#E0A23B', '#FFB547'],
  stGreen: ['#3FC48A', '#3F9E6E', '#2E8B57'],
  stSteel: ['#C3CAD3', '#B9B4AA', '#BFC5CD'], // bike rack
  stPole: ['#F4F1EA', '#EDE6D6', '#F5F5F2'], // flag pole
  stRanch: ['#B98A5E', '#8C6B4E', '#7B5B43'], // post-and-rail fence wood
  stFlag: [['#E9785A', '#3FA796', '#2E5BDA', '#F2C14E'], ['#8C2F39', '#2F7F7A', '#22407A', '#D9A441'], ['#0B2A5B', '#A8483A', '#E07A2E', '#2E8B57']],
  stKiosk: [['#3FA796', '#E9785A', '#5A8BD6'], ['#2F7F7A', '#8F3F2C', '#22407A'], ['#0B2A5B', '#A8483A', '#3E4B5C']],
  stBike: [['#E9785A', '#2E5BDA', '#3FA796', '#F2C14E'], ['#8F3F2C', '#22407A', '#2F7F7A', '#D9A441'], ['#A8483A', '#0B2A5B', '#2E8B57', '#E9B03B']],
};

/** Number of colours of an array role (palette a). */
export const variants = (role: 'stFlag' | 'stKiosk' | 'stBike' | 'awning'): number =>
  role === 'awning' ? 3 : (ROLES[role]![0] as string[]).length;
