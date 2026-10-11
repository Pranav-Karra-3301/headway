// Owner: E3. Sky shaders.
// `hwHorizonT(p, f)`: the height above the horizon line at which the view ray through world point p (direction f)
// crosses the farthest ridge curtain (north plane, the arc round the NW corner, west plane). The backdrop paints
// `hwSky(t)` from it, and the ridges/clouds blend toward the same colour for aerial perspective, so misty feet melt
// exactly into the sky behind them and the lightest haze band hugs the ridge line at any pan, zoom or azimuth.
import { MIST_FOOT, MIST_T, SKY_T } from './colors';

const f = (x: number) => x.toFixed(2);

export const SKY_FN = /* glsl */ `
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform vec3 uSky2;
uniform vec3 uSky3;
uniform vec3 uSky4;
uniform vec4 uFar;      // west plane x, north plane z, arc radius, horizon height
uniform vec2 uCorner;   // the diorama's NW corner (x, z): centre of the arc
uniform vec3 uViewDir;  // camera forward (world)
vec3 hwSky( float t ) {
  vec3 c = uSky0;
  c = mix( c, uSky1, smoothstep( ${f(SKY_T[0])}, ${f(SKY_T[1])}, t ) );
  c = mix( c, uSky2, smoothstep( ${f(SKY_T[1])}, ${f(SKY_T[2])}, t ) );
  c = mix( c, uSky3, smoothstep( ${f(SKY_T[2])}, ${f(SKY_T[3])}, t ) );
  return mix( c, uSky4, smoothstep( ${f(SKY_T[3])}, ${f(SKY_T[4])}, t ) );
}
float hwHorizonT( vec3 p, vec3 fd ) {
  float best = 1e6;
  if ( abs( fd.z ) > 1e-4 ) {
    float s = ( uFar.y - p.z ) / fd.z;
    if ( p.x + s * fd.x >= uCorner.x ) best = min( best, s );
  }
  if ( abs( fd.x ) > 1e-4 ) {
    float s = ( uFar.x - p.x ) / fd.x;
    if ( p.z + s * fd.z >= uCorner.y ) best = min( best, s );
  }
  vec2 o = p.xz - uCorner;
  vec2 d = fd.xz;
  float a = dot( d, d );
  if ( a > 1e-8 ) {
    float b = dot( o, d ), c = dot( o, o ) - uFar.z * uFar.z;
    float disc = b * b - a * c;
    if ( disc >= 0.0 ) {
      float s = ( -b + sqrt( disc ) ) / a;
      vec2 q = o + s * d;
      if ( q.x <= 0.0 && q.y <= 0.0 ) best = min( best, s );
    }
  }
  if ( best > 1e5 ) return -1e3;
  return p.y + best * fd.y - uFar.w;
}
float hwHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
`;

export const BACKDROP_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`;

export const BACKDROP_FRAG = /* glsl */ `
${SKY_FN}
uniform mat4 uInvViewProj;
uniform vec4 uShadowRect;   // centre x, z, half size x, z
uniform vec4 uShadowParams; // plane y, corner radius, blur, strength
uniform vec3 uShadowTint;
uniform float uStars;
uniform float uTime;
uniform float uPixel;       // device pixels per CSS pixel
varying vec2 vNdc;
void main() {
  vec4 a = uInvViewProj * vec4( vNdc, -1.0, 1.0 );
  vec4 b = uInvViewProj * vec4( vNdc, 1.0, 1.0 );
  a.xyz /= a.w; b.xyz /= b.w;
  float t = hwHorizonT( a.xyz, uViewDir );
  vec3 col = hwSky( t );
  // soft contact shadow of the diorama on an imaginary table under the base
  float dy = b.y - a.y;
  if ( abs( dy ) > 1e-5 ) {
    vec3 hit = mix( a.xyz, b.xyz, ( uShadowParams.x - a.y ) / dy );
    vec2 q = abs( hit.xz - uShadowRect.xy ) - uShadowRect.zw + uShadowParams.y;
    float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uShadowParams.y;
    float sh = 1.0 - smoothstep( -uShadowParams.z * 0.5, uShadowParams.z, sd );
    col = mix( col, col * uShadowTint, sh * sh * uShadowParams.w );
  }
  // a few twinkling stars high above the ridges at dusk
  if ( uStars > 0.01 ) {
    float cell = 26.0 * uPixel;
    vec2 id = floor( gl_FragCoord.xy / cell );
    float r = hwHash( id );
    if ( r < 0.09 ) {
      vec2 c = ( id + 0.2 + 0.6 * vec2( hwHash( id + 3.1 ), hwHash( id + 7.7 ) ) ) * cell;
      float d = length( gl_FragCoord.xy - c ) / uPixel;
      float tw = 0.6 + 0.4 * sin( uTime * ( 0.8 + r * 14.0 ) + r * 90.0 );
      float star = smoothstep( 1.6, 0.2, d ) * tw * smoothstep( 6.0, 18.0, t ) * uStars;
      col += vec3( 1.0, 0.93, 0.84 ) * star * ( 0.25 + r * 4.0 );
    }
  }
  col *= 1.0 + ( hwHash( gl_FragCoord.xy + fract( uTime ) ) - 0.5 ) * 0.01;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const PROPS_VERT = /* glsl */ `
attribute vec4 aInfo;   // layer (0–2 ridge, 3 cloud), crest height, band normal x, z
attribute vec3 aCenter; // cloud centre
attribute vec4 aDrift;  // span start, span, phase, speed
attribute vec2 aMist;   // mist lo, hi (world y)
uniform float uTime;
uniform vec2 uCamFwd;
varying vec3 vW;
varying vec3 vN;
varying float vLayer;
varying float vCrest;
varying float vVis;
varying vec2 vMist;
void main() {
  vec3 p = position;
  vec2 side = aInfo.zw;
  if ( aInfo.x > 2.5 ) {
    vec2 dir = vec2( -side.y, side.x );
    float u = fract( aDrift.z + uTime * aDrift.w / aDrift.y );
    float delta = ( u - aDrift.z ) * aDrift.y;
    float grow = smoothstep( 0.0, 0.08, u ) * ( 1.0 - smoothstep( 0.92, 1.0, u ) );
    p = aCenter + ( p - aCenter ) * grow + vec3( dir.x * delta, 0.0, dir.y * delta );
  }
  // only bands behind the diorama (seen from the camera) show; one swung in front melts into the haze
  float vis = smoothstep( 0.12, 0.42, dot( side, uCamFwd ) );
  vec4 wp = modelMatrix * vec4( p, 1.0 );
  vW = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vLayer = aInfo.x;
  vCrest = aInfo.y;
  vVis = vis;
  vMist = aMist;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if ( vis < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`;

export const PROPS_FRAG = /* glsl */ `
${SKY_FN}
uniform vec3 uRidge0;
uniform vec3 uRidge1;
uniform vec3 uRidge2;
uniform vec3 uRim;
uniform float uRimAmt;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uLightDir;
varying vec3 vW;
varying vec3 vN;
varying float vLayer;
varying float vCrest;
varying float vVis;
varying vec2 vMist;
void main() {
  float ht = hwHorizonT( vW, uViewDir );
  vec3 sky = hwSky( ht );
  vec3 col;
  float haze;
  if ( vLayer < 2.5 ) {
    col = vLayer < 0.5 ? uRidge0 : ( vLayer < 1.5 ? uRidge1 : uRidge2 );
    float aa = fwidth( vW.y ) + 1e-3;
    float rim = 1.0 - smoothstep( 0.0, 0.32 + aa, vCrest - vW.y );
    col = mix( col, uRim, rim * uRimAmt * ( 0.35 + 0.325 * vLayer ) );
    haze = 1.0 - smoothstep( vMist.x, vMist.y, vW.y );
    // valley mist between the layers glows like the horizon band (at dusk the void far below is dark, and misting
    // the feet into it would read inverted); deep down the curtain it settles into the true backdrop, seamlessly
    vec3 glow = hwSky( max( ht, ${f(MIST_T)} ) );
    sky = mix( sky, glow, smoothstep( ${f(MIST_FOOT[0])}, ${f(MIST_FOOT[1])}, vW.y ) * vVis );
  } else {
    vec3 n = normalize( vN );
    float l = clamp( dot( n, uLightDir ) * 0.55 + 0.5, 0.0, 1.0 );
    col = mix( uCloudShade, uCloudLit, smoothstep( 0.25, 0.9, l ) );
    haze = 0.12;
  }
  haze = max( haze, 1.0 - vVis );
  gl_FragColor = vec4( mix( col, sky, haze ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
