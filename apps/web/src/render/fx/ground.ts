// Owner: T2.4. Subtle procedural ground variation (no textures): soft sunlit/shaded patches and faint grass flecks
// on the bare board, mowing stripes + patches on lawns. A lit, transparent decal just above the board (0.004) and
// lawns (0.066), so roads, plazas and buildings simply cover it. One draw call; fades with the route highlight.
import * as THREE from 'three';
import type { TownMap, Vec2 } from '@headway/sim';
import { PALETTES } from '../palettes';
import type { PaletteId } from '../types';
import type { LawnPatch } from './anchors';

const BOARD_Y = 0.004, LAWN_Y = 0.066, INSET = 0.5;

const VERT_PARS = /* glsl */ `
attribute vec4 aGround;
varying vec4 vGround;
varying vec2 vGXZ;
`;
const VERT_MAIN = /* glsl */ `
vGround = aGround;
vGXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
`;
const FRAG_PARS = /* glsl */ `
uniform vec3 uGBoardL;
uniform vec3 uGBoardD;
uniform vec3 uGLawnL;
uniform vec3 uGLawnD;
uniform vec4 uGBounds;
uniform float uGFade;
varying vec4 vGround;
varying vec2 vGXZ;
float hwHash( vec2 p ) {
	p = fract( p * vec2( 123.34, 456.21 ) );
	p += dot( p, p + 45.32 );
	return fract( p.x * p.y );
}
float hwNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hwHash( i ), hwHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hwHash( i + vec2( 0.0, 1.0 ) ), hwHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;
const FRAG_COLOR = /* glsl */ `
{
	bool hwLawn = vGround.x > 0.5;
	vec3 hwL = hwLawn ? uGLawnL : uGBoardL;
	vec3 hwD = hwLawn ? uGLawnD : uGBoardD;
	float hwS = hwNoise( vGXZ * 0.115 ) * 0.62 + hwNoise( vGXZ * 0.31 + 17.0 ) * 0.38 - 0.5;
	float hwA = smoothstep( 0.04, 0.36, abs( hwS ) ) * 0.12;
	vec3 hwCol = hwS > 0.0 ? hwL : hwD;
	if ( hwLawn ) {
		float hwT = dot( vGXZ, vGround.yz ) / 1.25;
		float hwStripe = smoothstep( 0.25, 0.75, abs( fract( hwT ) - 0.5 ) * 2.0 ) - 0.5;
		float hwSA = abs( hwStripe ) * 0.16;
		if ( hwSA > hwA ) { hwA = hwSA; hwCol = hwStripe > 0.0 ? hwL : hwD; }
	}
	float hwPx = max( fwidth( vGXZ.x ), fwidth( vGXZ.y ) );
	float hwSpk = step( 0.9, hwHash( floor( vGXZ / 0.23 ) ) ) * ( 1.0 - smoothstep( 0.045, 0.11, hwPx ) ) * 0.08;
	if ( hwSpk > 0.0 ) { hwCol = hwD * 0.88; hwA = max( hwA, hwSpk ); }
	if ( !hwLawn ) {
		float hwE = min( min( vGXZ.x - uGBounds.x, uGBounds.y - vGXZ.x ), min( vGXZ.y - uGBounds.z, uGBounds.w - vGXZ.y ) );
		hwA *= smoothstep( 0.0, 1.6, hwE );
	}
	diffuseColor = vec4( hwCol, hwA * ( 1.0 - 0.6 * uGFade ) );
}
`;

export interface GroundFx {
  readonly mesh: THREE.Mesh;
  setPalette(p: PaletteId): void;
  setFade(f: number): void;
  dispose(): void;
}

function pushPolygon(poly: readonly Vec2[], y: number, attr: [number, number, number, number], pos: number[], ground: number[], idx: number[]): void {
  if (poly.length < 3) return;
  const base = pos.length / 3;
  const tris = THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p.x, p.z)), []);
  for (const p of poly) { pos.push(p.x, y, p.z); ground.push(...attr); }
  for (const [a, b, c] of tris) {
    const A = poly[a]!, B = poly[b]!, C = poly[c]!;
    const crossY = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
    if (crossY >= 0) idx.push(base + a, base + b, base + c);
    else idx.push(base + a, base + c, base + b);
  }
}

/** Unit direction of a polygon's longest edge (lawn mowing stripes run across it). */
function longestEdgeDir(poly: readonly Vec2[]): Vec2 {
  let best = { x: 1, z: 0 }, bl = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > bl) { bl = l; best = { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; }
  }
  return best;
}

export function createGroundFx(map: TownMap, lawns: readonly LawnPatch[], palette: PaletteId = 'a'): GroundFx {
  const b = map.bounds;
  const pos: number[] = [], ground: number[] = [], idx: number[] = [];
  const board: Vec2[] = [
    { x: b.minX + INSET, z: b.minZ + INSET }, { x: b.maxX - INSET, z: b.minZ + INSET },
    { x: b.maxX - INSET, z: b.maxZ - INSET }, { x: b.minX + INSET, z: b.maxZ - INSET },
  ];
  pushPolygon(board, BOARD_Y, [0, 1, 0, 0], pos, ground, idx);
  for (const l of lawns) {
    const d = longestEdgeDir(l.polygon);
    // stripes run along the long side: their "across" direction is the edge normal
    pushPolygon(l.polygon, LAWN_Y, [1, -d.z, d.x, 0], pos, ground, idx);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('aGround', new THREE.Float32BufferAttribute(ground, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const u = {
    uGBoardL: { value: new THREE.Color() }, uGBoardD: { value: new THREE.Color() },
    uGLawnL: { value: new THREE.Color() }, uGLawnD: { value: new THREE.Color() },
    uGBounds: { value: new THREE.Vector4(b.minX + INSET, b.maxX - INSET, b.minZ + INSET, b.maxZ - INSET) },
    uGFade: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`);
  };
  mat.customProgramCacheKey = () => 'hw-fx-ground';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:ground';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 1;

  const warm = new THREE.Color('#FFF4CF'), cool = new THREE.Color('#2E6E66');
  const setPalette = (p: PaletteId) => {
    const P = PALETTES[p];
    u.uGBoardL.value.set(P.board).lerp(warm, 0.42);
    u.uGBoardD.value.set(P.board).multiplyScalar(0.8).lerp(cool, 0.14);
    u.uGLawnL.value.set(P.lawn).lerp(warm, 0.3);
    u.uGLawnD.value.set(P.lawn).multiplyScalar(0.8).lerp(cool, 0.12);
  };
  setPalette(palette);
  return {
    mesh,
    setPalette,
    setFade(f) { u.uGFade.value = f; },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
