// Owner: E2. The lake surface: ONE flat mesh (south + east strips) on a MeshStandardMaterial with a stylised water
// tweak, so scene lights, shadows and tone mapping apply like everywhere else:
//   colour   — shallows → open water → deep bay from the shore field, slow current patches, faint ripple strokes;
//   foam     — a soft lapping line at the waterline (follows the tide), wave lines rolling in, rings around piers,
//              piles, rocks and moored hulls, V-wakes + hull foam behind moving boats (and ducks), soft contact shade;
//   emissive — twinkling sun glints by day; at dusk the lake holds the sky's indigo, a warm band along the lit shore
//              and wobbly vertical streaks under every lamp / the lighthouse (reflections offset toward the camera).
import * as THREE from 'three';
import { clayTweak } from '../../materials';
import type { ShoreField } from './field';
import type { Box2 } from './plan';

export const MAX_LIGHTS = 16;
export const MAX_WAKES = 8;

export interface WaterUniforms {
  uTime: { value: number };
  uDusk: { value: number };
  uTideShift: { value: number };
  uWaterY: { value: number };
  uField: { value: THREE.DataTexture };
  uFieldRect: { value: THREE.Vector4 };
  uShallow: { value: THREE.Color };
  uMid: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uFoam: { value: THREE.Color };
  uDuskNear: { value: THREE.Color };
  uDuskFar: { value: THREE.Color };
  uGlow: { value: THREE.Color };
  uLights: { value: THREE.Vector4[] };
  uLightCount: { value: number };
  uWake: { value: THREE.Vector4[] };
  uWakeCount: { value: number };
  uView: { value: THREE.Vector2 };
  uViewCot: { value: number };
}

const VERT_PARS = /* glsl */ `
varying vec3 vHwW;
`;
const VERT_MAIN = /* glsl */ `
vHwW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

// uDusk is declared by the shared clay tweak (the layer binds its own eased value to it).
const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uTideShift;
uniform float uWaterY;
uniform sampler2D uField;
uniform vec4 uFieldRect;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uDuskNear;
uniform vec3 uDuskFar;
uniform vec3 uGlow;
uniform vec4 uLights[ ${MAX_LIGHTS} ];
uniform int uLightCount;
uniform vec4 uWake[ ${MAX_WAKES} ];
uniform int uWakeCount;
uniform vec2 uView;
uniform float uViewCot;
varying vec3 vHwW;

float hwHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float hwNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hwHash( i ), hwHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hwHash( i + vec2( 0.0, 1.0 ) ), hwHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;

const FRAG_COLOR = /* glsl */ `
vec2 hwP = vHwW.xz;
vec2 hwF = texture2D( uField, ( hwP - uFieldRect.xy ) * uFieldRect.zw ).rg;
float hwShore = hwF.r;
float hwObj = hwF.g;
float hwS = hwShore + uTideShift;
float hwN1 = hwNoise( hwP * 0.085 + vec2( uTime * 0.011, -uTime * 0.008 ) );
float hwN2 = hwNoise( hwP * 0.31 + vec2( -uTime * 0.02, uTime * 0.016 ) );
// depth tint (wobbled so the bands are organic)
float hwD = hwShore + ( hwN1 - 0.5 ) * 2.2;
vec3 hwCol = mix( uShallow, uMid, smoothstep( 0.1, 3.6, hwD ) );
hwCol = mix( hwCol, uDeep, smoothstep( 5.0, 26.0, hwD ) );
hwCol *= 0.975 + 0.05 * hwN2;
// ripple strokes: short pale dashes drifting across open water
{
	vec2 q = vec2( hwP.x * 0.7071 - hwP.y * 0.7071, hwP.x * 0.7071 + hwP.y * 0.7071 );
	float warp = hwNoise( hwP * 0.21 + vec2( uTime * 0.025, 0.0 ) ) * 2.4;
	float band = abs( fract( q.y * 0.62 + warp + uTime * 0.035 ) - 0.5 );
	float dash = smoothstep( 0.58, 0.76, hwNoise( vec2( q.x * 0.95, floor( q.y * 0.62 + warp + uTime * 0.035 ) * 3.1 ) + uTime * 0.04 ) );
	float stroke = ( 1.0 - smoothstep( 0.035, 0.075, band ) ) * dash;
	stroke *= smoothstep( 1.8, 4.5, hwShore ) * smoothstep( 0.35, 0.65, hwN1 + 0.15 );
	hwCol = mix( hwCol, uFoam, stroke * 0.26 );
}
// shore foam: a soft lapping edge + two wave lines rolling in
float hwFoam = 0.0;
{
	float edgeN = hwNoise( hwP * 1.6 + vec2( uTime * 0.11, -uTime * 0.07 ) );
	float w = 0.22 + 0.2 * edgeN;
	hwFoam = 1.0 - smoothstep( w * 0.45, w, hwS );
	for ( int k = 0; k < 2; k ++ ) {
		float ph = fract( uTime / 5.5 + float( k ) * 0.5 + hwNoise( hwP * 0.07 + float( k ) * 4.0 ) * 0.4 );
		float lineD = mix( 2.3, 0.25, ph );
		float lw = 0.06 + 0.07 * ph;
		float ln = 1.0 - smoothstep( lw * 0.4, lw, abs( hwS - lineD ) );
		float fade = smoothstep( 0.0, 0.3, ph ) * ( 1.0 - smoothstep( 0.78, 1.0, ph ) );
		float brk = smoothstep( 0.32, 0.62, hwNoise( hwP * 0.75 + float( k ) * 13.1 + vec2( uTime * 0.05, 0.0 ) ) );
		hwFoam = max( hwFoam, ln * fade * brk * 0.85 );
	}
	// rings around piers, piles, rocks, moored hulls
	float rw = 0.13 + 0.06 * sin( uTime * 1.7 + hwP.x * 2.1 + hwP.y * 1.3 );
	float ring = 1.0 - smoothstep( rw * 0.45, rw, hwObj );
	float ph2 = fract( uTime * 0.22 + hwP.x * 0.05 );
	float ring2 = ( 1.0 - smoothstep( 0.025, 0.07, abs( hwObj - ( 0.22 + 0.5 * ph2 ) ) ) ) * ( 1.0 - ph2 ) * 0.35;
	hwFoam = max( hwFoam, max( ring * 0.9, ring2 ) );
}
// moving boats: hull foam, V-wake arms, a churned trail, and a soft shade under the hull
float hwShade = 0.0;
for ( int i = 0; i < ${MAX_WAKES}; i ++ ) {
	if ( i >= uWakeCount ) break;
	vec4 B = uWake[ i ];
	vec2 fwd = vec2( cos( B.z ), -sin( B.z ) );
	vec2 rel = hwP - B.xy;
	float a = dot( rel, fwd );
	float b = dot( rel, vec2( -fwd.y, fwd.x ) );
	float L = B.w;
	float hullD = length( vec2( a / ( L * 1.08 ), b / ( L * 0.44 ) ) ) - 1.0;
	float hullFoam = ( 1.0 - smoothstep( 0.0, 0.22, hullD ) ) * step( -0.12, hullD );
	float back = -a - L * 0.75;
	float arm = abs( abs( b ) - back * 0.34 - L * 0.22 );
	float aw = 0.035 + L * 0.04 + back * 0.012;
	float arms = ( 1.0 - smoothstep( aw * 0.45, aw, arm ) ) * step( 0.0, back ) * exp( -back / ( L * 4.0 ) );
	arms *= 0.55 + 0.45 * hwNoise( vec2( back * 2.2 - uTime * 1.3, b * 3.0 ) );
	float trail = exp( -b * b / ( L * L * 0.07 ) ) * step( 0.0, back ) * exp( -back / ( L * 2.2 ) );
	trail *= 0.4 + 0.6 * hwNoise( vec2( back * 3.5 - uTime * 2.4, b * 7.0 ) );
	hwFoam = max( hwFoam, max( hullFoam * 0.85, max( arms * 0.8, trail * 0.55 ) ) );
	hwShade = max( hwShade, 1.0 - smoothstep( -0.25, 0.5, hullD ) );
}
hwCol *= 1.0 - 0.2 * hwShade;
hwFoam = clamp( hwFoam, 0.0, 1.0 );
hwCol = mix( hwCol, uFoam, hwFoam );
diffuseColor.rgb = hwCol;
// emissive: sun glints by day, sky + warm reflections at dusk
vec3 hwEmit = vec3( 0.0 );
{
	vec2 sp = hwP * 1.25 + vec2( uTime * 0.045, uTime * 0.03 );
	vec2 id = floor( sp );
	vec2 rnd = vec2( hwHash( id ), hwHash( id + 17.31 ) );
	vec2 f = fract( sp ) - ( 0.2 + 0.6 * rnd );
	float tw = pow( max( sin( uTime * ( 1.1 + 2.0 * rnd.x ) + rnd.y * 6.2831 ), 0.0 ), 16.0 );
	float dotS = 1.0 - smoothstep( 0.02, 0.075, length( f * vec2( 0.75, 1.7 ) ) );
	float msk = smoothstep( 1.4, 4.0, hwShore ) * ( 1.0 - hwFoam ) * step( 0.6, hwHash( id + 5.71 ) );
	hwEmit += vec3( 1.0, 0.97, 0.88 ) * dotS * tw * msk * ( 1.0 - 0.85 * uDusk );
}
if ( uDusk > 0.001 ) {
	float far = smoothstep( 1.0, 24.0, hwShore + ( hwN1 - 0.5 ) * 3.0 );
	vec3 sky = mix( uDuskNear, uDuskFar, far );
	hwEmit += sky * ( 0.28 + 0.06 * hwN2 ) * uDusk * ( 1.0 - 0.7 * hwFoam );
	hwEmit += uFoam * hwFoam * 0.16 * uDusk;
	hwEmit += uGlow * uDusk * 0.1 * ( 1.0 - smoothstep( 0.0, 6.0, hwShore ) );
	vec2 v = uView, vp = vec2( -uView.y, uView.x );
	float refl = 0.0;
	for ( int i = 0; i < ${MAX_LIGHTS}; i ++ ) {
		if ( i >= uLightCount ) break;
		vec4 Lt = uLights[ i ];
		float h = max( Lt.y - uWaterY, 0.2 );
		vec2 r = hwP - ( Lt.xz - v * h * uViewCot );
		float al = dot( r, v );
		float ac = dot( r, vp ) + 0.07 * sin( al * 6.0 + uTime * 2.3 + float( i ) ) + 0.035 * sin( al * 14.0 - uTime * 3.4 );
		float len = 0.45 + 0.24 * h;
		float wid = 0.09 + 0.03 * Lt.w;
		float st = exp( -( ac * ac ) / ( wid * wid ) ) * exp( -( al * al ) / ( len * len ) );
		st *= 0.6 + 0.4 * sin( al * 9.0 + uTime * 2.1 + float( i ) * 1.7 );
		refl += st * Lt.w;
	}
	hwEmit += uGlow * refl * 1.25 * uDusk * ( 1.0 - 0.6 * hwFoam );
}
`;

const FRAG_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += hwEmit;
`;

export interface Surface {
  mesh: THREE.Mesh;
  uniforms: WaterUniforms;
}

/** Field → RG half-float texture (shore, objects). */
export function fieldTexture(f: ShoreField): THREE.DataTexture {
  const data = new Uint16Array(f.w * f.h * 2);
  for (let k = 0; k < f.w * f.h; k++) {
    data[k * 2] = THREE.DataUtils.toHalfFloat(Math.max(-8, Math.min(60, f.shore[k]!)));
    data[k * 2 + 1] = THREE.DataUtils.toHalfFloat(f.objects[k]!);
  }
  const tex = new THREE.DataTexture(data, f.w, f.h, THREE.RGFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildSurface(regions: Box2[], field: ShoreField, waterY: number): Surface {
  const tex = fieldTexture(field);
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDusk: { value: 0 },
    uTideShift: { value: 0 },
    uWaterY: { value: waterY },
    uField: { value: tex },
    uFieldRect: { value: new THREE.Vector4(field.minX, field.minZ, 1 / (field.w * field.cell), 1 / (field.h * field.cell)) },
    uShallow: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
    uFoam: { value: new THREE.Color() },
    uDuskNear: { value: new THREE.Color() },
    uDuskFar: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uLights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
    uLightCount: { value: 0 },
    uWake: { value: Array.from({ length: MAX_WAKES }, () => new THREE.Vector4()) },
    uWakeCount: { value: 0 },
    uView: { value: new THREE.Vector2(-Math.SQRT1_2, -Math.SQRT1_2) },
    uViewCot: { value: 1.5 },
  };
  // one flat geometry for all regions (2 quads each, y = 0; the mesh sits at the water level)
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of regions) {
    const o = pos.length / 3;
    pos.push(r.minX, 0, r.minZ, r.maxX, 0, r.minZ, r.maxX, 0, r.maxZ, r.minX, 0, r.maxZ);
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    clayTweak(shader); // the town's clay lighting (wrap, rim), so the lake's lit colours match the palette like the board
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  mat.customProgramCacheKey = () => 'hw-water-surface';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water:surface';
  mesh.position.y = waterY;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, uniforms };
}
