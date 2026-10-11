// Owner: T2.1. Post shaders: tilt-shift (separable, focus band at screen centre) and the warm grade
// (lift, saturation, warmth, soft vignette, faint grain). Both run in linear HDR before OutputPass.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;

/** One axis of a separable tilt-shift blur. Blur radius grows outside a horizontal focus band. */
export function tiltShiftShader(axis: 'x' | 'y') {
  return {
    name: `TiltShift${axis.toUpperCase()}`,
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uFocus: { value: 0.5 },      // focus line (uv.y)
      uBand: { value: 0.2 },       // half height of the sharp band
      uRamp: { value: 0.32 },      // distance over which blur reaches full strength
      uMaxPx: { value: 2.6 },      // full blur radius in pixels
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uFocus, uBand, uRamp, uMaxPx;
varying vec2 vUv;
void main() {
  float d = max( abs( vUv.y - uFocus ) - uBand, 0.0 );
  float r = smoothstep( 0.0, uRamp, d ) * uMaxPx;
  vec2 dir = ${axis === 'x' ? 'vec2( uTexel.x, 0.0 )' : 'vec2( 0.0, uTexel.y )'} * r;
  vec4 sum = texture2D( tDiffuse, vUv ) * 0.2270270270;
  sum += texture2D( tDiffuse, vUv + dir * 1.3846153846 ) * 0.3162162162;
  sum += texture2D( tDiffuse, vUv - dir * 1.3846153846 ) * 0.3162162162;
  sum += texture2D( tDiffuse, vUv + dir * 3.2307692308 ) * 0.0702702703;
  sum += texture2D( tDiffuse, vUv - dir * 3.2307692308 ) * 0.0702702703;
  gl_FragColor = sum;
}
`,
  };
}

/** Warm grade: lift shadows toward a warm tint, nudge saturation, warm/cool balance, vignette, grain. */
export function gradeShader() {
  return {
    name: 'WarmGrade',
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      uLift: { value: new THREE.Color(0.018, 0.014, 0.022) },
      uGain: { value: new THREE.Color(1.0, 1.0, 1.0) },
      uSaturation: { value: 1.06 },
      uWarmth: { value: 0.035 },
      uVignette: { value: 0.22 },
      uGrain: { value: 0.018 },
      uTime: { value: 0 },
      /** Grain cell size in uv (set from the render size so the grain is pixel-locked). */
      uTexelGrain: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uAspect: { value: 1.6 },
      /** Split-tone multipliers: shadows → uShadowTint, highlights → uHighlightTint. */
      uShadowTint: { value: new THREE.Color(0.985, 0.995, 1.025) },
      uHighlightTint: { value: new THREE.Color(1.02, 1.0, 0.975) },
    },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uLift, uGain, uShadowTint, uHighlightTint;
uniform float uSaturation, uWarmth, uVignette, uGrain, uTime, uAspect;
uniform vec2 uTexelGrain;
varying vec2 vUv;
float hash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
void main() {
  vec4 c = texture2D( tDiffuse, vUv );
  vec3 col = c.rgb * uGain;
  col += uLift * ( 1.0 - clamp( col, 0.0, 1.0 ) );
  float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
  col = mix( vec3( l ), col, uSaturation );
  col *= vec3( 1.0 + uWarmth, 1.0 + uWarmth * 0.3, 1.0 - uWarmth * 0.6 );
  col *= mix( uShadowTint, uHighlightTint, smoothstep( 0.05, 0.75, l ) );
  vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
  float v = smoothstep( 0.55, 1.35, length( q ) );
  col *= 1.0 - uVignette * v;
  // static paper grain (v13): no per-frame reseed and capped on bright pixels, so lamps / windows glow steady
  float n = hash( floor( vUv / uTexelGrain ) ) - 0.5;
  col += n * uGrain * ( 0.35 + min( l, 0.65 ) );
  gl_FragColor = vec4( max( col, 0.0 ), c.a );
}
`,
  };
}
