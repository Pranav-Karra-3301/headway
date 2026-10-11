// Owner: E3. The base material (art bible §6.6): one MeshStandardMaterial, lit like the town, whose colour is chosen
// per fragment from `aKind`:
//   strata — flat soil bands (#AE8A6D, #94725B, #766558 in palette A) with gently wavy boundaries; a grass lip on
//            land, a sand lip under the lake; sliced mountains show warm rock;
//   water  — flat bands #80C5CD, #53A6B9, #3285A2 down to the bed, under a lighter 0.3 u surface band; a faint inner
//            glow keeps it clear on the shaded east face;
//   plinth — warm wood with soft grain; floor — a quiet ground tone (it is normally hidden).
import * as THREE from 'three';
import type { PaletteId } from '../../types';

export interface BaseLook {
  grass: string; sand: string; rock: string;
  soil: [string, string, string];
  waterSurface: string;
  water: [string, string, string];
  wood: string; woodDark: string; floor: string;
}

export const BASE_LOOKS: Record<PaletteId, BaseLook> = {
  a: {
    grass: '#86C597', sand: '#D5BD8E', rock: '#B7AE9E',
    soil: ['#AE8A6D', '#94725B', '#766558'],
    waterSurface: '#A8DEDC', water: ['#80C5CD', '#53A6B9', '#3285A2'],
    wood: '#CFA77B', woodDark: '#B98E62', floor: '#9DBFA6',
  },
  b: {
    grass: '#B4C595', sand: '#C9AF86', rock: '#B2A590',
    soil: ['#A88767', '#8E6F56', '#715F51'],
    waterSurface: '#BDDCD2', water: ['#93C3BB', '#6FA3A6', '#4F7F90'],
    wood: '#9A7552', woodDark: '#83603F', floor: '#C9C2AA',
  },
  c: {
    grass: '#A6C288', sand: '#CBB792', rock: '#B3AA9B',
    soil: ['#AA8569', '#8F6F58', '#716155'],
    waterSurface: '#B6DCE7', water: ['#8CBFD3', '#5E98C0', '#3E6E9E'],
    wood: '#B08660', woodDark: '#966D48', floor: '#C7C6B8',
  },
};

/** Band boundaries (u): water bands by depth below the surface; soil bands by world height. */
export const BANDS = { surface: 0.3, water: [0.75, 1.2], lip: 0.3, soil: [-1.6, -3.3] } as const;

const SCALARS = ['grass', 'sand', 'rock', 'waterSurface', 'wood', 'woodDark', 'floor'] as const;
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
${SCALARS.map((k) => `uniform vec3 ${uname(k)};`).join('\n')}
uniform vec3 uBSoil0;
uniform vec3 uBSoil1;
uniform vec3 uBSoil2;
uniform vec3 uBWater0;
uniform vec3 uBWater1;
uniform vec3 uBWater2;
uniform float uBWaterGlow;
varying float vHwKind;
varying float vHwTop;
varying vec3 vHwW;
float hwWave( float s, float f, float ph ) {
  return sin( s * f + ph ) * 0.62 + sin( s * f * 2.31 + ph * 1.7 ) * 0.26 + sin( s * f * 5.13 + ph * 2.9 ) * 0.12;
}
// a above the boundary x = 0, b below; anti-aliased over aa
vec3 hwBand( vec3 below, vec3 above, float x, float aa ) { return mix( below, above, smoothstep( -aa, aa, x ) ); }
vec3 hwStrata( vec3 w, float top ) {
  float s = w.x + w.z;
  float aa = fwidth( w.y ) * 0.75 + 0.003;
  float wet = step( top, -0.5 );
  float y = w.y + 0.17 * hwWave( s, 0.21, 4.0 );
  vec3 c = uBSoil2;
  c = hwBand( c, uBSoil1, y - ( ${BANDS.soil[1].toFixed(2)} ), aa );
  c = hwBand( c, uBSoil0, y - ( ${BANDS.soil[0].toFixed(2)} ), aa );
  c = hwBand( c, uBRock, y - 0.45, aa );
  float lip = ${BANDS.lip.toFixed(2)} + 0.05 * hwWave( s, 1.1, 1.0 );
  return mix( c, mix( uBGrass, uBSand, wet ), smoothstep( aa, -aa, top - w.y - lip ) );
}
vec3 hwWater( vec3 w, float level ) {
  float aa = fwidth( w.y ) * 0.75 + 0.003;
  float d = level - w.y;
  vec3 c = uBWater2;
  c = hwBand( c, uBWater1, ${BANDS.water[1].toFixed(2)} - d, aa );
  c = hwBand( c, uBWater0, ${BANDS.water[0].toFixed(2)} - d, aa );
  return hwBand( c, uBWaterSurface, ${BANDS.surface.toFixed(2)} - d, aa );
}
vec3 hwWood( vec3 w ) {
  float s = w.x + w.z;
  float g = sin( w.y * 9.0 + sin( s * 0.17 ) * 1.6 + sin( s * 0.043 + 1.3 ) * 3.0 );
  return mix( uBWood, uBWoodDark, smoothstep( 0.4, 1.0, g ) * 0.45 );
}
`;

const FRAG_COLOR = /* glsl */ `
float hwIsWater = 1.0 - step( 0.5, abs( vHwKind - 1.0 ) );
{
  vec3 hwC;
  if ( vHwKind < 0.5 ) hwC = hwStrata( vHwW, vHwTop );
  else if ( vHwKind < 1.5 ) hwC = hwWater( vHwW, vHwTop );
  else if ( vHwKind < 2.5 ) hwC = hwWood( vHwW );
  else hwC = uBFloor;
  diffuseColor.rgb = hwC;
}
`;
const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix( roughnessFactor, 0.6, hwIsWater );
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
  dispose(): void;
}

export function createBaseMaterial(palette: PaletteId = 'a'): BaseMaterial {
  const uniforms: Record<string, THREE.IUniform> = { uBWaterGlow: { value: 0.12 } };
  for (const k of SCALARS) uniforms[uname(k)] = { value: new THREE.Color() };
  for (let i = 0; i < 3; i++) { uniforms['uBSoil' + i] = { value: new THREE.Color() }; uniforms['uBWater' + i] = { value: new THREE.Color() }; }
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
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
    for (const k of SCALARS) (uniforms[uname(k)]!.value as THREE.Color).set(L[k]);
    for (let i = 0; i < 3; i++) {
      (uniforms['uBSoil' + i]!.value as THREE.Color).set(L.soil[i]!);
      (uniforms['uBWater' + i]!.value as THREE.Color).set(L.water[i]!);
    }
  };
  setPalette(palette);
  return {
    material,
    setPalette,
    setDusk: (t) => { uniforms.uBWaterGlow!.value = 0.12 + 0.1 * Math.max(0, Math.min(1, t)); },
    dispose: () => material.dispose(),
  };
}
