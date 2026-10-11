// Owner: T2.1. The LOOK material layer.
// - `shared`: uniforms shared by every kit/clay material. TownRenderer drives uTime / uSimT each frame;
//   Stage (post/stage.ts) eases uDusk / rim / ground AO / fade colour with the light mode and palette.
// - `KitMaterial`: the one material for baked kit geometry (vertex colours + aGlow dusk emission + aTint
//   instance tint) with the "clay" tweak: wrapped diffuse, soft camera rim, height-based contact darkening.
//   Options: `sway` (tree crowns sway in the wind, phase per instance), `instanceFade` (per-instance
//   `iFade` attribute, 0..1, lerps that instance toward the background).
// - `applyClay(m)`: the same clay tweak for any other MeshStandardMaterial (ribbons, lamps, custom FX).
import * as THREE from 'three';
import { PALETTES } from './palettes';

export const shared = {
  /** Real seconds since start (idle animation: sway, bob, dashes). */
  uTime: { value: 0 },
  /** Interpolated sim seconds (clock hands, sim-driven effects). */
  uSimT: { value: 0 },
  /** 0 = day … 1 = dusk. Scales aGlow emission (windows, lamps, headlights). */
  uDusk: { value: 0 },
  /** Colour that faded (non-highlighted) things lerp toward: the palette background. */
  uFadeColor: { value: new THREE.Color(PALETTES.a.bg) },
  /** Camera-facing rim light strength and colour. */
  uRim: { value: 0.14 },
  uRimColor: { value: new THREE.Color('#fff4e0') },
  /** Brightness multiplier at ground level on vertical faces (contact darkening), 1 = off. */
  uGroundAO: { value: 0.8 },
  /** Wind strength for sway materials. */
  uWind: { value: 1 },
};

/** Wrapped diffuse amount (0 = Lambert). */
const WRAP = 0.22;

export interface ClayOptions {
  /** Vertex colours from a baked kit geometry + aGlow/aTint (KitMaterial). */
  kit?: boolean;
  sway?: boolean;
  instanceFade?: boolean;
  /** Per-material highlight fade uniform (0..1). */
  fade?: { value: number };
}

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
attribute vec3 aGlow;
attribute float aTint;
varying vec3 vHwGlow;
varying float vHwY;
varying float vHwNy;
#ifdef HW_INSTANCE_FADE
attribute float iFade;
varying float vHwFade;
#endif
`;

const COLOR_VERTEX = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb = mix( vColor.rgb, instanceColor.rgb, aTint );
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif
`;

const SWAY = /* glsl */ `
#ifdef HW_SWAY
{
	#ifdef USE_INSTANCING
	vec2 hwBase = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
	#else
	vec2 hwBase = vec2( modelMatrix[3][0], modelMatrix[3][2] );
	#endif
	float hwPh = dot( hwBase, vec2( 0.37, 0.61 ) );
	float hwH = max( transformed.y - 0.45, 0.0 );
	float hwA = hwH * hwH * 0.028 * uWind;
	transformed.x += sin( uTime * 1.7 + hwPh ) * hwA;
	transformed.z += sin( uTime * 1.31 + hwPh * 1.7 ) * hwA * 0.6;
}
#endif
`;

const WORLD_VARYINGS = /* glsl */ `
{
	vec4 hwW = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
	hwW = instanceMatrix * hwW;
	#endif
	hwW = modelMatrix * hwW;
	vHwY = hwW.y;
	vHwNy = inverseTransformDirection( transformedNormal, viewMatrix ).y;
	vHwGlow = aGlow;
	#ifdef HW_INSTANCE_FADE
	vHwFade = iFade;
	#endif
}
`;

const FRAG_PARS = /* glsl */ `
uniform float uDusk;
uniform float uFade;
uniform vec3 uFadeColor;
uniform float uRim;
uniform vec3 uRimColor;
uniform float uGroundAO;
varying vec3 vHwGlow;
varying float vHwY;
varying float vHwNy;
#ifdef HW_INSTANCE_FADE
varying float vHwFade;
#endif
`;

const FADE = /* glsl */ `
float hwFade = uFade;
#ifdef HW_INSTANCE_FADE
hwFade = max( hwFade, vHwFade );
#endif
diffuseColor.rgb = mix( diffuseColor.rgb, uFadeColor, hwFade );
`;

const GLOW = /* glsl */ `
totalEmissiveRadiance += vHwGlow * uDusk * ( 1.0 - 0.75 * hwFade );
`;

const FINISH = /* glsl */ `
{
	float hwUp = clamp( vHwNy, 0.0, 1.0 );
	float hwAO = mix( uGroundAO, 1.0, smoothstep( 0.0, 1.2, vHwY ) );
	outgoingLight *= mix( hwAO, 1.0, hwUp * hwUp );
	float hwRim = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 3.0 );
	outgoingLight += uRimColor * hwRim * uRim * ( 0.35 + 0.65 * diffuseColor.rgb ) * ( 1.0 - hwFade );
}
`;

const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const DIFFUSE_WRAP = /* glsl */ `
	float hwNL = dot( geometryNormal, directLight.direction );
	vec3 hwIrr = saturate( ( hwNL + ${WRAP.toFixed(3)} ) / ${(1 + WRAP).toFixed(3)} ) * directLight.color;
	reflectedLight.directDiffuse += hwIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
`;

function inject(src: string, anchor: string, code: string, where: 'before' | 'after' | 'replace'): string {
  if (!src.includes(anchor)) return src;
  if (where === 'replace') return src.replace(anchor, code);
  return src.replace(anchor, where === 'before' ? `${code}\n${anchor}` : `${anchor}\n${code}`);
}

/** The clay tweak as an onBeforeCompile body. Safe on MeshStandardMaterial / MeshPhysicalMaterial. */
export function clayTweak(shader: THREE.WebGLProgramParametersWithUniforms, o: ClayOptions = {}): void {
  const u = shader.uniforms;
  u.uTime = shared.uTime;
  u.uWind = shared.uWind;
  u.uDusk = shared.uDusk;
  u.uFadeColor = shared.uFadeColor;
  u.uRim = shared.uRim;
  u.uRimColor = shared.uRimColor;
  u.uGroundAO = shared.uGroundAO;
  u.uFade = o.fade ?? { value: 0 };
  const defs = [o.sway ? '#define HW_SWAY' : '', o.instanceFade ? '#define HW_INSTANCE_FADE' : ''].join('\n');

  let vs = shader.vertexShader;
  vs = inject(vs, '#include <common>', `${defs}\n${VERT_PARS}`, 'after');
  if (o.kit) vs = inject(vs, '#include <color_vertex>', COLOR_VERTEX, 'replace');
  vs = inject(vs, '#include <begin_vertex>', SWAY, 'after');
  vs = inject(vs, '#include <project_vertex>', WORLD_VARYINGS, 'after');
  shader.vertexShader = vs;

  let fs = shader.fragmentShader;
  fs = inject(fs, '#include <common>', `${defs}\n${FRAG_PARS}`, 'after');
  fs = inject(fs, '#include <color_fragment>', FADE, 'after');
  fs = inject(fs, '#include <emissivemap_fragment>', GLOW, 'after');
  fs = inject(fs, '#include <opaque_fragment>', FINISH, 'before');
  const lights = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (lights.includes(DIFFUSE_LINE)) {
    fs = fs.replace('#include <lights_physical_pars_fragment>', lights.replace(DIFFUSE_LINE, DIFFUSE_WRAP));
  }
  shader.fragmentShader = fs;
}

/** Install the clay tweak on any MeshStandardMaterial (keeps its own colour/maps). Returns the material. */
export function applyClay<M extends THREE.MeshStandardMaterial>(m: M, o: Omit<ClayOptions, 'kit'> = {}): M {
  const key = `hw-clay:${o.sway ? 1 : 0}${o.instanceFade ? 1 : 0}`;
  m.onBeforeCompile = (shader) => clayTweak(shader, o);
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
  return m;
}

export interface KitMaterialOptions {
  sway?: boolean;
  instanceFade?: boolean;
  roughness?: number;
  side?: THREE.Side;
}

/** The shared material for baked kit geometry. Create one per draw group that needs its own `fade`. */
export class KitMaterial extends THREE.MeshStandardMaterial {
  /** Highlight fade for everything drawn with this material: 0 = normal, 0.6 = 60 % toward the background. */
  readonly fade = { value: 0 };
  readonly sway: boolean;
  readonly instanceFade: boolean;

  constructor(opts: KitMaterialOptions = {}) {
    super({ vertexColors: true, roughness: opts.roughness ?? 0.8, metalness: 0, side: opts.side ?? THREE.FrontSide });
    this.sway = !!opts.sway;
    this.instanceFade = !!opts.instanceFade;
    const key = `hw-kit:${this.sway ? 1 : 0}${this.instanceFade ? 1 : 0}`;
    this.onBeforeCompile = (shader) => clayTweak(shader, { kit: true, sway: this.sway, instanceFade: this.instanceFade, fade: this.fade });
    this.customProgramCacheKey = () => key;
  }
}

/** Per-instance fade attribute for `KitMaterial({ instanceFade: true })` on an InstancedMesh. */
export function addInstanceFade(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count), 1);
  attr.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('iFade', attr);
  return attr;
}
