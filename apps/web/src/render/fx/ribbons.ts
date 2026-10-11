// Owner: T2.4. Route ribbons: one painted stripe per bus route along its loop, in its own lane to the right of
// travel (routes sharing a road sit side by side; opposite directions take opposite sides), with chevron dashes
// flowing in the direction of travel. The highlighted route widens, brightens and glows; the others desaturate and
// fade 60 % toward the background. One draw call for all routes; at dusk the ribbons glow softly.
import * as THREE from 'three';
import type { Polyline, RouteId, TownMap, Vec2 } from '@headway/sim';
import { shared } from '../materials';
import { colorOf, PALETTES } from '../palettes';
import type { PaletteId } from '../types';

export const RIBBON = {
  /** Visible stripe width (u); the highlighted route draws 1.4× wider. */
  width: 0.2,
  /** Geometry half-width (u): room for the highlight halo around the stripe. */
  half: 0.3,
  /** Lane centre offsets right of travel (u), by route index (r1, r2, r3). Road half-width is 1.2. */
  lanes: [0.3, 0.62, 0.94] as readonly number[],
  /** Height above the board: over the road (0.06) and its centre dashes (0.08). */
  y: 0.09,
  /** Target chevron spacing (u); quantised per loop so the closing seam is invisible. */
  period: 1.6,
  /** Flow speed of the chevrons (u per real second). */
  speed: 1.15,
} as const;

/** Palette `route` index of a route: r1 → 0, r2 → 1, r3 → 2 (falls back to map order). */
export function routeIndex(map: TownMap, id: RouteId | string): number {
  const m = /^r(\d+)$/.exec(id);
  if (m) return Number(m[1]) - 1;
  return Math.max(0, map.routes.findIndex((r) => r.id === id));
}

export interface OffsetPath { points: Vec2[]; /** Unit-length mitre directions (right of travel), scaled so p + m·d is the offset. */ miters: Vec2[]; cum: number[]; length: number }

/** Offset a polyline `d` units to the right of travel (negative = left), with mitred joints. */
export function offsetPath(poly: Polyline, d: number): OffsetPath {
  const pts = poly.points, n = pts.length, closed = poly.closed;
  const dir = (i: number): Vec2 => {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };
  const points: Vec2[] = [], miters: Vec2[] = [], cum: number[] = [];
  for (let i = 0; i < n; i++) {
    const dIn = closed || i > 0 ? dir((i - 1 + n) % n) : dir(0);
    const dOut = closed || i < n - 1 ? dir(i) : dir(Math.max(0, n - 2));
    // right of travel = (−dz, dx)
    const ax = -dIn.z + -dOut.z, az = dIn.x + dOut.x;
    const al = Math.hypot(ax, az);
    let mx = -dOut.z, mz = dOut.x;
    if (al > 1e-6) {
      const ux = ax / al, uz = az / al;
      const k = 1 / Math.max(0.3, ux * -dOut.z + uz * dOut.x);
      mx = ux * k; mz = uz * k;
    }
    miters.push({ x: mx, z: mz });
    points.push({ x: pts[i]!.x + mx * d, z: pts[i]!.z + mz * d });
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
    cum.push(acc);
  }
  const length = closed && n > 1 ? acc + Math.hypot(points[0]!.x - points[n - 1]!.x, points[0]!.z - points[n - 1]!.z) : acc;
  return { points, miters, cum, length };
}

export interface RibbonData {
  position: Float32Array; normal: Float32Array;
  /** Per vertex: route index, arc length u, side (−1 | +1), dash period. */
  rib: Float32Array;
  /** Per vertex: mitre direction (xz) the vertex shader pushes the edge along. */
  side: Float32Array;
  index: Uint32Array;
  routes: Array<{ id: RouteId; length: number; period: number }>;
}

/** Strip geometry data for every route loop (pure, no WebGL). */
export function buildRibbonData(map: TownMap): RibbonData {
  const pos: number[] = [], nor: number[] = [], rib: number[] = [], side: number[] = [], idx: number[] = [];
  const routes: RibbonData['routes'] = [];
  for (const r of map.routes) {
    const ri = routeIndex(map, r.id);
    const o = offsetPath(r.path, RIBBON.lanes[ri] ?? RIBBON.lanes[RIBBON.lanes.length - 1]!);
    const period = o.length / Math.max(1, Math.round(o.length / RIBBON.period));
    routes.push({ id: r.id, length: o.length, period });
    const n = o.points.length;
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) { // i = n repeats point 0 at u = length (closed seam)
      const k = i % n, p = o.points[k]!, m = o.miters[k]!, u = i === n ? o.length : o.cum[k]!;
      for (const s of [-1, 1]) {
        pos.push(p.x, RIBBON.y, p.z);
        nor.push(0, 1, 0);
        rib.push(ri, u, s, period);
        side.push(m.x, m.z);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 2;
      // left (−1) / right (+1) edges; front faces point up (+y)
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  return {
    position: new Float32Array(pos), normal: new Float32Array(nor), rib: new Float32Array(rib), side: new Float32Array(side),
    index: new Uint32Array(idx), routes,
  };
}

const VERT_PARS = /* glsl */ `
#define RIB_N __N__
attribute vec4 aRib;
attribute vec2 aSide;
uniform vec3 uRibCol[ RIB_N ];
uniform float uRibHi[ RIB_N ];
uniform float uRibFade[ RIB_N ];
varying vec4 vRib;
varying vec3 vRibCol;
varying float vRibHi;
varying float vRibFade;
`;

const VERT_MAIN = /* glsl */ `
{
	int hwR = int( aRib.x + 0.5 );
	vRibCol = uRibCol[ hwR ];
	vRibHi = uRibHi[ hwR ];
	vRibFade = uRibFade[ hwR ];
	vRib = aRib;
	transformed.xz += aSide * aRib.z * ${RIBBON.half.toFixed(3)};
}
`;

const FRAG_PARS = /* glsl */ `
uniform float uFxTime;
uniform float uDusk;
uniform vec3 uFadeColor;
varying vec4 vRib;
varying vec3 vRibCol;
varying float vRibHi;
varying float vRibFade;
`;

// After <color_fragment>: stripe + chevrons + halo → diffuseColor; emissive glow is added after <emissivemap_fragment>.
const FRAG_COLOR = /* glsl */ `
float hwAv = abs( vRib.z ) * ${RIBBON.half.toFixed(3)};
float hwHalf = ${(RIBBON.width / 2).toFixed(3)} * ( 1.0 + 0.4 * vRibHi - 0.15 * vRibFade );
float hwAA = max( fwidth( hwAv ), 1e-4 );
float hwCore = 1.0 - smoothstep( hwHalf - hwAA, hwHalf + hwAA, hwAv );
float hwPh = ( vRib.y - uFxTime * ${RIBBON.speed.toFixed(3)} ) / vRib.w + clamp( hwAv / hwHalf, 0.0, 1.0 ) * 0.24;
float hwF = fract( hwPh );
float hwFa = max( fwidth( hwPh ), 1e-4 ) * 1.25;
float hwDash = smoothstep( 0.0, hwFa, hwF ) * ( 1.0 - smoothstep( 0.36 - hwFa, 0.36 + hwFa, hwF ) );
hwDash *= 1.0 - smoothstep( hwHalf * 0.5, hwHalf * 0.78, hwAv );
vec3 hwCol = vRibCol;
float hwLum = dot( hwCol, vec3( 0.299, 0.587, 0.114 ) );
hwCol = mix( hwCol, vec3( hwLum ), 0.55 * vRibFade );
hwCol = mix( hwCol, uFadeColor, 0.6 * vRibFade );
hwCol = mix( hwCol, vec3( 1.0 ), 0.12 * vRibHi );
vec3 hwStripe = mix( hwCol, mix( hwCol, vec3( 1.0 ), 0.82 ), hwDash * ( 1.0 - 0.6 * vRibFade ) );
float hwHalo = vRibHi * 0.42 * ( 1.0 - smoothstep( hwHalf, ${RIBBON.half.toFixed(3)}, hwAv ) );
diffuseColor.rgb = mix( mix( hwCol, vec3( 1.0 ), 0.35 ), hwStripe, hwCore );
diffuseColor.a = max( hwCore * mix( 0.94, 0.5, vRibFade ), hwHalo * ( 1.0 - hwCore ) );
float hwGlowAmt = hwCore * ( ( 0.16 + 0.5 * hwDash ) * uDusk * ( 1.0 - 0.7 * vRibFade ) + vRibHi * ( 0.22 + 0.5 * uDusk ) ) + hwHalo * ( 0.4 + 0.8 * uDusk );
`;

const FRAG_GLOW = /* glsl */ `
totalEmissiveRadiance += vRibCol * hwGlowAmt;
`;

export interface Ribbons {
  readonly mesh: THREE.Mesh;
  /** Ease highlight/fade toward the highlighted route (null = none). */
  update(dtS: number, highlighted: string | null, timeS: number): void;
  setPalette(p: PaletteId): void;
  dispose(): void;
}

export function createRibbons(map: TownMap, palette: PaletteId = 'a'): Ribbons {
  const data = buildRibbonData(map);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  geo.setAttribute('aRib', new THREE.BufferAttribute(data.rib, 4));
  geo.setAttribute('aSide', new THREE.BufferAttribute(data.side, 2));
  geo.setIndex(new THREE.BufferAttribute(data.index, 1));
  geo.computeBoundingSphere();

  const n = Math.max(1, ...map.routes.map((r) => routeIndex(map, r.id) + 1));
  const ids = map.routes.map((r) => r.id as string);
  const cols = Array.from({ length: n }, () => new THREE.Color());
  const hi = new Float32Array(n), fade = new Float32Array(n);
  const uniforms = {
    uRibCol: { value: cols }, uRibHi: { value: hi }, uRibFade: { value: fade },
    uFxTime: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.75, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms, { uDusk: shared.uDusk, uFadeColor: shared.uFadeColor });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS.replace('__N__', String(n))}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_GLOW}`);
  };
  mat.customProgramCacheKey = () => `hw-fx-ribbon:${n}`;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx:ribbons';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;

  const setPalette = (p: PaletteId) => {
    for (const r of map.routes) {
      const i = routeIndex(map, r.id);
      cols[i]!.set(colorOf(PALETTES[p], 'route', i));
    }
  };
  setPalette(palette);

  return {
    mesh,
    update(dtS, highlighted, timeS) {
      uniforms.uFxTime.value = timeS;
      const k = 1 - Math.exp(-Math.max(0, dtS) * 9);
      for (const id of ids) {
        const i = routeIndex(map, id);
        const h = highlighted === id ? 1 : 0, f = highlighted && highlighted !== id ? 1 : 0;
        hi[i] = hi[i]! + (h - hi[i]!) * k;
        fade[i] = fade[i]! + (f - fade[i]!) * k;
        if (Math.abs(hi[i]! - h) < 1e-3) hi[i] = h;
        if (Math.abs(fade[i]! - f) < 1e-3) fade[i] = f;
      }
    },
    setPalette,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
