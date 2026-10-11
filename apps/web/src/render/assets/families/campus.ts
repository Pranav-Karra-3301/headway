// Owner: A2. The campus family: every 'cp.*' kind from catalog.ts. Georgian brick + limestone, white trim, porticos,
// a domed library, a chapel spire. Builders live in ./campus/*; shared vocabulary in ./campus/parts.ts.
//
// Params (all optional; unset params vary per placement via k.rand()). Colour indices pick from the cp* roles below.
//   cp.hall     variant 0 hip roof + cupola + portico | 1 gable + paired end chimneys + portico | 2 hip + dormers + porch;
//               brick 0..2, roof 0..2, door 0..2
//   cp.library  brick 0..2 (wings), roof 0..2 (decks; default 1 slate so the copper dome pops)
//   cp.chapel   brick 0..2, roof 0..2, door 0..2
//   cp.science  brick 0..2 (stair core), door 0..2
//   cp.dorm     brick 0..2, roof 0..2 (flat-roof deck), door 0..2
//   cp.union    brick 0..2, roof 0..2, door 0..2, banner 0..2 (flag; the hanging banners take the next colour)
//   cp.gate     brick 0..2, banner 0..2 (crest). Piers at the ends; the path runs along z through x in [-1.2, 1.2].
// Every kind faces +z (entrance), fills its catalog footprint and sits centred on the origin.
// Dev close-up: /src/render/assets/families/campus/preview.html?k=cp.hall (or ?show=1, &palette=1|2, &detail=min, &rot=0..3).
import type * as THREE from 'three';
import { CATALOG_BY_KIND } from '../catalog';
import type { AssetRegistry } from '../registry';
import type { AssetParams, KitContext, RoleColors } from '../types';
import { buildChapel } from './campus/chapel';
import { buildDorm } from './campus/dorm';
import { buildGate } from './campus/gate';
import { buildHall } from './campus/hall';
import { buildLibrary } from './campus/library';
import { buildScience } from './campus/science';
import { buildUnion } from './campus/union';

/** Extra palette roles this family needs (palette a Wooden Toy, b Miniature Railway, c State College Autumn). */
export const ROLES: RoleColors = {
  cpBrick: [['#E39579', '#D9876E', '#EAA389'], ['#A9503A', '#96452F', '#B8634A'], ['#A8483A', '#93392E', '#B65A48']],
  cpStone: ['#F2E7D2', '#E3D6BC', '#E9E1CF'],
  cpTrim: ['#FFFDF7', '#F5EFE3', '#FFFFFF'],
  cpRoof: [['#4E8E86', '#5C6E8A', '#3FA796'], ['#5E6B73', '#4A4F55', '#6E7F6A'], ['#3E4B5C', '#1E3A6E', '#5B6573']],
  cpCopper: ['#7FCDB4', '#7FA08A', '#6FA39B'],
  cpGold: ['#F2C14E', '#D9A441', '#E9B03B'],
  cpDoor: [['#2F5C7E', '#2F6B57', '#3B4A6B'], ['#2F4A3A', '#22407A', '#5A3A2A'], ['#0B2A5B', '#2E4E3F', '#7A2E2A']],
  cpBanner: [['#2E5BDA', '#F2C14E', '#E9785A'], ['#22407A', '#D9A441', '#8C2F39'], ['#0B2A5B', '#FFFFFF', '#E9B03B']],
  cpGlass: ['#9FD3E3', '#A9C2C4', '#B7CFE0'],
  cpPanel: ['#F8F6F1', '#E6DFD1', '#EEF0F2'],
  cpIron: ['#3D4250', '#3E3A36', '#2B3340'],
  cpSolar: ['#3C5A86', '#36475A', '#2C4466'],
  cpMetal: ['#BFC6CE', '#B3AEA4', '#BFC5CD'],
  cpCurtain: [['#F28CA8', '#F6C945', '#7FB8E6', '#9CD8A6'], ['#C98B6B', '#D9A441', '#8FA6B8', '#9DB97E'], ['#E9B03B', '#FFFFFF', '#7FA6D9', '#C9452E']],
};

type Builder = (k: KitContext, p: AssetParams) => THREE.Object3D;
const BUILDERS: Record<string, Builder> = {
  'cp.hall': buildHall,
  'cp.library': buildLibrary,
  'cp.chapel': buildChapel,
  'cp.science': buildScience,
  'cp.dorm': buildDorm,
  'cp.union': buildUnion,
  'cp.gate': buildGate,
};

/** Representative params per kind (documentation for districts; the tests build every one). */
export const VARIANTS: Record<string, AssetParams[]> = {
  'cp.hall': [{ variant: 0 }, { variant: 1 }, { variant: 2 }, { variant: 0, brick: 2, roof: 1, door: 2 }],
  'cp.library': [{ brick: 0, roof: 0 }, { brick: 2, roof: 1 }],
  'cp.chapel': [{ brick: 1, roof: 1 }, { brick: 2, roof: 0 }],
  'cp.science': [{ brick: 0 }, { brick: 1 }],
  'cp.dorm': [{ brick: 0, roof: 0 }, { brick: 1, roof: 2, door: 1 }],
  'cp.union': [{ banner: 0 }, { banner: 1, brick: 2 }],
  'cp.gate': [{ brick: 0 }, { brick: 2, banner: 1 }],
};

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const [kind, build] of Object.entries(BUILDERS)) {
    const c = CATALOG_BY_KIND.get(kind)!;
    r.register({ kind, family: 'campus', footprint: { w: c.w, d: c.d }, height: c.h, build });
  }
}
