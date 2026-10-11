// Owner: E3. Sky shaders. `hwSky(t)` is the one screen-space gradient (t: 0 = bottom … 1 = top of the screen); the
// backdrop draws it (plus sun glow, dusk stars and the diorama's soft drop shadow on the void below), and the
// ridge/cloud props blend toward it for aerial perspective, so misty feet melt exactly into the sky behind them.

export const SKY_FN = /* glsl */ `
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform vec3 uSky2;
uniform vec3 uSky3;
vec3 hwSky( float t ) {
  vec3 c = mix( uSky3, uSky2, smoothstep( 0.0, 0.4, t ) );
  c = mix( c, uSky1, smoothstep( 0.3, 0.72, t ) );
  return mix( c, uSky0, smoothstep( 0.62, 1.0, t ) );
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
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform vec2 uGlowPos;
uniform float uAspect;
uniform float uDusk;
uniform float uTime;
uniform float uPixel;       // device pixels per CSS pixel
varying vec2 vNdc;
void main() {
  float t = vNdc.y * 0.5 + 0.5;
  vec3 col = hwSky( t );
  vec2 g = ( vNdc - uGlowPos ) * vec2( uAspect, 1.0 );
  col += uGlow * uGlowAmt * exp( -dot( g, g ) * 1.4 );
  // soft drop shadow of the diorama on an imaginary table below it
  vec4 a = uInvViewProj * vec4( vNdc, -1.0, 1.0 );
  vec4 b = uInvViewProj * vec4( vNdc, 1.0, 1.0 );
  a.xyz /= a.w; b.xyz /= b.w;
  float dy = b.y - a.y;
  if ( abs( dy ) > 1e-5 ) {
    vec3 hit = mix( a.xyz, b.xyz, ( uShadowParams.x - a.y ) / dy );
    vec2 q = abs( hit.xz - uShadowRect.xy ) - uShadowRect.zw + uShadowParams.y;
    float sd = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uShadowParams.y;
    float sh = 1.0 - smoothstep( -uShadowParams.z * 0.45, uShadowParams.z, sd );
    col = mix( col, col * uShadowTint, sh * sh * uShadowParams.w );
  }
  // a few twinkling stars high up at dusk
  if ( uDusk > 0.01 ) {
    float cell = 22.0 * uPixel;
    vec2 id = floor( gl_FragCoord.xy / cell );
    float r = hwHash( id );
    if ( r < 0.075 ) {
      vec2 c = ( id + 0.2 + 0.6 * vec2( hwHash( id + 3.1 ), hwHash( id + 7.7 ) ) ) * cell;
      float d = length( gl_FragCoord.xy - c ) / uPixel;
      float tw = 0.65 + 0.35 * sin( uTime * ( 1.2 + r * 20.0 ) + r * 80.0 );
      float star = smoothstep( 1.9, 0.0, d ) * tw * smoothstep( 0.45, 0.85, t ) * uDusk;
      col += vec3( 1.0, 0.94, 0.86 ) * star * ( 0.35 + r * 6.0 );
    }
  }
  col *= 1.0 + ( hwHash( gl_FragCoord.xy + fract( uTime ) ) - 0.5 ) * 0.012;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const PROPS_VERT = /* glsl */ `
attribute vec4 aInfo;   // aerial, kind (0 ridge, 1 cloud), band normal x, z
attribute vec3 aCenter; // cloud centre
attribute vec4 aDrift;  // span start, span, phase, speed
attribute vec2 aMist;   // mist lo, hi (world y)
uniform float uTime;
uniform vec2 uCamFwd;
varying vec3 vW;
varying float vSkyT;
varying float vAerial;
varying float vKind;
varying vec2 vMist;
void main() {
  vec3 p = position;
  vec2 side = aInfo.zw;
  if ( aInfo.y > 0.5 ) {
    vec2 dir = vec2( -side.y, side.x );
    float u = fract( aDrift.z + uTime * aDrift.w / aDrift.y );
    float delta = ( u - aDrift.z ) * aDrift.y;
    float grow = smoothstep( 0.0, 0.08, u ) * ( 1.0 - smoothstep( 0.92, 1.0, u ) );
    p = aCenter + ( p - aCenter ) * grow + vec3( dir.x * delta, 0.0, dir.y * delta );
  }
  // only bands behind the diorama (seen from the camera) show; a band swung in front sinks into the haze
  float vis = smoothstep( 0.12, 0.42, dot( side, uCamFwd ) );
  vec4 wp = modelMatrix * vec4( p, 1.0 );
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  vSkyT = gl_Position.y / gl_Position.w * 0.5 + 0.5;
  vAerial = mix( 1.0, aInfo.x, vis );
  vKind = aInfo.y;
  vMist = aMist;
  if ( vis < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`;

export const PROPS_FRAG = /* glsl */ `
${SKY_FN}
uniform vec3 uRidgeLit;
uniform vec3 uRidgeShade;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uLightDir;
uniform vec3 uCamBack;
varying vec3 vW;
varying float vSkyT;
varying float vAerial;
varying float vKind;
varying vec2 vMist;
void main() {
  vec3 n = normalize( cross( dFdx( vW ), dFdy( vW ) ) );
  if ( dot( n, uCamBack ) < 0.0 ) n = -n;
  float l = clamp( dot( n, uLightDir ) * 0.6 + 0.45, 0.0, 1.0 );
  vec3 base;
  float mist = 0.0;
  if ( vKind < 0.5 ) {
    base = mix( uRidgeShade, uRidgeLit, l );
    mist = 1.0 - smoothstep( vMist.x, vMist.y, vW.y );
  } else {
    base = mix( uCloudShade, uCloudLit, smoothstep( 0.2, 0.85, l ) );
  }
  float a = clamp( vAerial + ( 1.0 - vAerial ) * mist, 0.0, 1.0 );
  gl_FragColor = vec4( mix( base, hwSky( vSkyT ), a ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
