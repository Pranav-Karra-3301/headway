// Owner: E3. The base material: one MeshStandardMaterial (lit like the town, receives shadows) whose colour is
// computed per fragment from `aKind`:
//   strata  — a grass (or sand, under the lake) lip and topsoil that follow the cut's surface, then gently wavy
//             horizontal bands: dark soil, ochre clay, warm rock, bedrock; sliced mountains show layered rock;
//   water   — a luminous column, light aqua at the surface (bright meniscus line) to deep blue at the bed, with
//             slow drifting light bands;
//   plinth  — warm wood with soft grain; floor — board green → wet sand → lake-bed teal by depth; pebbles — 3 tints.
import * as THREE from 'three';
import type { PaletteId } from '../../types';

export interface BaseLook {
  grass: string; soil: string; soilDark: string; clay: string; rock: string; bedrock: string; mountain: string;
  sand: string; waterTop: string; waterDeep: string; foam: string;
  wood: string; woodDark: string; floor: string; bedDeep: string;
  pebbles: [string, string, string];
}

export const BASE_LOOKS: Record<PaletteId, BaseLook> = {
  a: {
    grass: '#86C99A', soil: '#A9784F', soilDark: '#8E6244', clay: '#D6AD80', rock: '#B4A296', bedrock: '#93837A', mountain: '#A99A90',
    sand: '#EBD5A6', waterTop: '#8FDDD5', waterDeep: '#3F8CC0', foam: '#F2FFFC',
    wood: '#CDA172', woodDark: '#B58658', floor: '#A8D8B9', bedDeep: '#5FA3AE',
    pebbles: ['#CFC3B8', '#8C7D74', '#A68F7B'],
  },
  b: {
    grass: '#B6C797', soil: '#94704F', soilDark: '#7C5D44', clay: '#D1B489', rock: '#ABA095', bedrock: '#877C72', mountain: '#A39A91',
    sand: '#E6D4AD', waterTop: '#A8D6CB', waterDeep: '#4E8698', foam: '#F8FBF2',
    wood: '#946F50', woodDark: '#7A5A40', floor: '#EADFC8', bedDeep: '#6E9EA3',
    pebbles: ['#CEC6BA', '#857A71', '#A08A74'],
  },
  c: {
    grass: '#A6C288', soil: '#956446', soilDark: '#7C533B', clay: '#CF9F6F', rock: '#ACA098', bedrock: '#83776F', mountain: '#A2968E',
    sand: '#E5D2AA', waterTop: '#9DCBDB', waterDeep: '#3C6D9E', foam: '#F6FBFF',
    wood: '#A97E58', woodDark: '#8C6542', floor: '#E7E2CF', bedDeep: '#5E8FA6',
    pebbles: ['#CBC4BE', '#80746E', '#9E8370'],
  },
};

const COLOR_KEYS = ['grass', 'soil', 'soilDark', 'clay', 'rock', 'bedrock', 'mountain', 'sand', 'waterTop', 'waterDeep', 'foam', 'wood', 'woodDark', 'floor', 'bedDeep'] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
const uname = (k: string) => 'uB' + k[0]!.toUpperCase() + k.slice(1);

const VERT_PARS = /* glsl */ `
attribute float aKind;
attribute float aTop;
varying float vHwKind;
varying float vHwTop;
varying vec3 vHwW;
`;
const VERT_MAIN = /* glsl */ `
vHwKind = aKind;
vHwTop = aTop;
vHwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAG_PARS = /* glsl */ `
${COLOR_KEYS.map((k) => `uniform vec3 ${uname(k)};`).join('\n')}
uniform vec3 uBPebble0;
uniform vec3 uBPebble1;
uniform vec3 uBPebble2;
uniform float uBTime;
uniform float uBWaterGlow;
varying float vHwKind;
varying float vHwTop;
varying vec3 vHwW;
float hwWave( float s, float f, float ph ) {
  return sin( s * f + ph ) * 0.6 + sin( s * f * 2.31 + ph * 1.7 ) * 0.28 + sin( s * f * 5.13 + ph * 2.9 ) * 0.12;
}
// step from a to b where x crosses 0, anti-aliased over aa
vec3 hwBand( vec3 a, vec3 b, float x, float aa ) { return mix( a, b, smoothstep( -aa, aa, x ) ); }
vec3 hwStrata( vec3 w, float top ) {
  float s = w.x + w.z;
  float aa = fwidth( w.y ) * 0.75 + 0.004;
  float d = top - w.y;
  float wet = step( top, -0.25 );
  float y = w.y + 0.42 * hwWave( s, 0.11, 4.0 );
  vec3 c = uBBedrock;
  c = hwBand( c, uBRock, y + 7.4, aa );
  c = hwBand( c, uBClay, y + 4.9, aa );
  c = hwBand( c, uBSoilDark, y + 3.1, aa );
  // sliced mountains: layered rock with soft alternating beds
  float bed = smoothstep( 0.42, 0.5, abs( fract( ( w.y - 0.12 * s * 0.1 ) * 0.22 ) - 0.5 ) );
  vec3 mtn = mix( uBMountain, uBBedrock, 0.28 * bed );
  c = hwBand( c, mtn, y - 0.7, aa );
  // surface-following topsoil + lip (grass on land, sand under the lake)
  float lip = mix( 0.42, 0.58, wet ) + 0.07 * hwWave( s, 1.3, 1.0 );
  float soil = lip + 1.25 + 0.3 * hwWave( s, 0.33, 2.0 );
  c = mix( c, uBSoil, ( 1.0 - wet ) * smoothstep( aa, -aa, d - soil ) );
  c = mix( c, mix( uBGrass, uBSand, wet ), smoothstep( aa, -aa, d - lip ) );
  // a whisper of shading toward the bottom
  c *= 0.9 + 0.1 * smoothstep( -10.0, -2.0, w.y );
  return c;
}
vec3 hwWater( vec3 w, float level ) {
  float s = w.x + w.z;
  float d = max( level - w.y, 0.0 );
  float k = smoothstep( 0.0, 4.4, d );
  vec3 c = mix( uBWaterTop, uBWaterDeep, k );
  float band = sin( d * 2.6 - s * 0.32 + uBTime * 0.7 ) * sin( s * 0.83 + uBTime * 0.37 );
  c *= 1.0 + 0.07 * band * ( 1.0 - k * 0.7 );
  float aa = fwidth( w.y ) + 0.004;
  c = mix( c, uBFoam, smoothstep( 0.17 + aa, 0.1, d ) );
  return c;
}
vec3 hwWood( vec3 w ) {
  float s = w.x + w.z;
  float g = sin( w.y * 7.5 + sin( s * 0.17 ) * 1.6 + sin( s * 0.043 + 1.3 ) * 3.0 );
  return mix( uBWood, uBWoodDark, smoothstep( 0.45, 1.0, g ) * 0.5 );
}
vec3 hwFloor( vec3 w ) {
  vec3 c = mix( uBFloor, uBSand, smoothstep( -0.1, -0.55, w.y ) );
  return mix( c, uBBedDeep, smoothstep( -1.0, -4.2, w.y ) );
}
`;

const FRAG_COLOR = /* glsl */ `
float hwIsWater = 1.0 - step( 0.5, abs( vHwKind - 1.0 ) );
{
  vec3 hwC;
  if ( vHwKind < 0.5 ) hwC = hwStrata( vHwW, vHwTop );
  else if ( vHwKind < 1.5 ) hwC = hwWater( vHwW, vHwTop );
  else if ( vHwKind < 2.5 ) hwC = hwWood( vHwW );
  else if ( vHwKind < 3.5 ) hwC = hwFloor( vHwW );
  else hwC = vHwTop < 0.5 ? uBPebble0 : ( vHwTop < 1.5 ? uBPebble1 : uBPebble2 );
  diffuseColor.rgb = hwC;
}
`;
const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix( roughnessFactor, 0.42, hwIsWater );
`;
const FRAG_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * uBWaterGlow * hwIsWater;
`;

function inject(src: string, anchor: string, code: string): string {
  if (!src.includes(anchor)) throw new Error(`base material: shader anchor ${anchor} missing`);
  return src.replace(anchor, `${anchor}\n${code}`);
}

export interface BaseMaterial {
  readonly material: THREE.MeshStandardMaterial;
  setPalette(p: PaletteId): void;
  /** 0 = day … 1 = dusk (eased): dims the water's inner glow. */
  setDusk(t: number): void;
  setTime(t: number): void;
  dispose(): void;
}

export function createBaseMaterial(palette: PaletteId = 'a'): BaseMaterial {
  const uniforms: Record<string, THREE.IUniform> = { uBTime: { value: 0 }, uBWaterGlow: { value: 0.4 } };
  for (const k of COLOR_KEYS) uniforms[uname(k)] = { value: new THREE.Color() };
  for (let i = 0; i < 3; i++) uniforms['uBPebble' + i] = { value: new THREE.Color() };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  material.name = 'world-base';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', VERT_PARS);
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', VERT_MAIN);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', FRAG_PARS);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', FRAG_COLOR);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <roughnessmap_fragment>', FRAG_ROUGH);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'hw-world-base';
  const setPalette = (p: PaletteId) => {
    const L = BASE_LOOKS[p];
    for (const k of COLOR_KEYS) (uniforms[uname(k)]!.value as THREE.Color).set(L[k as ColorKey]);
    L.pebbles.forEach((h, i) => (uniforms['uBPebble' + i]!.value as THREE.Color).set(h));
  };
  setPalette(palette);
  return {
    material,
    setPalette,
    setDusk: (t) => { uniforms.uBWaterGlow!.value = 0.4 - 0.22 * Math.max(0, Math.min(1, t)); },
    setTime: (t) => { uniforms.uBTime!.value = t; },
    dispose: () => material.dispose(),
  };
}
