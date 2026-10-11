// Owner: E3. Sky looks per palette × light (art bible §6.5).
// The sky is world-anchored: its parameter t is the height (u) above the horizon line at which a view ray crosses the
// farthest distant-ridge curtain, so the lightest haze band always sits just above the ridge line (whatever the pan,
// zoom or peek azimuth) and deepens toward the top: day mint over a pale cream horizon, dusk indigo #2F3A5E over a
// peach horizon. Below the horizon (behind misty ridge feet and around the base in the beauty shot) it settles into
// a soft haze: pale by day; at dusk a deep plum → indigo, so the lit town is the brightest thing on screen (bible
// §2.5 dusk order) and the peach glow only hugs the ridge line. Distant ridge layers are flat silhouettes: mix(ridgeBase, haze, t) in sRGB with t = 0.35 / 0.55 / 0.75
// (bible: #89B3A0, #A2C5B5, #BCD8CA by day in palette A).
import * as THREE from 'three';
import type { PaletteId } from '../../types';
import { RIDGE_FOOT_Y } from './ridges';

/** Positions (u above the horizon) of the five gradient stops: deep haze, haze, horizon (lightest), upper, top. */
export const SKY_T = [-50, -14, 0, 9, 26] as const;
/** Valley mist on the distant ridges glows like the sky at this height (never darker): see `ridgeMist`. */
export const MIST_T = -6;
/** Aerial perspective of the three distant ridge layers, near → far. */
export const RIDGE_HAZE = [0.35, 0.55, 0.75] as const;

export interface SkyLook {
  stops: [string, string, string, string, string];
  ridgeBase: string;
  haze: string;
  /** Thin rim on the far ridge tops (dusk). */
  rim: string;
  rimAmt: number;
  cloudLit: string;
  cloudShade: string;
  /** Drop-shadow multiply tint + strength. */
  shadow: string;
  shadowAmt: number;
  /** Star brightness (0 by day). */
  stars: number;
}

export const SKY_LOOKS: Record<PaletteId, { day: SkyLook; dusk: SkyLook }> = {
  a: {
    day: {
      stops: ['#EDF0E2', '#E4F1E8', '#F7F7EC', '#DDEFE5', '#C6E4D6'],
      ridgeBase: '#5C947C', haze: '#DDEFE5', rim: '#FFFFFF', rimAmt: 0,
      cloudLit: '#FFFFFF', cloudShade: '#C9DDD5', shadow: '#A3BDB3', shadowAmt: 0.5, stars: 0,
    },
    dusk: {
      stops: ['#3A3D62', '#655779', '#E6A78C', '#8A6E96', '#2F3A5E'],
      ridgeBase: '#3B3F68', haze: '#D49B8E', rim: '#F7C0A0', rimAmt: 0.85,
      cloudLit: '#F4BEA2', cloudShade: '#8B7CA6', shadow: '#77708F', shadowAmt: 0.45, stars: 1,
    },
  },
  b: {
    day: {
      stops: ['#F0E9D9', '#EEEADB', '#FAF5E9', '#EAE8D9', '#D8DFCB'],
      ridgeBase: '#7C8C6B', haze: '#F3ECDD', rim: '#FFFFFF', rimAmt: 0,
      cloudLit: '#FFFDF8', cloudShade: '#DAD3C1', shadow: '#BDB4A0', shadowAmt: 0.45, stars: 0,
    },
    dusk: {
      stops: ['#383A5A', '#625672', '#E2A68B', '#856C86', '#2E3550'],
      ridgeBase: '#3D3E5C', haze: '#CF9C8C', rim: '#F4C19F', rimAmt: 0.8,
      cloudLit: '#EFBEA3', cloudShade: '#857993', shadow: '#76708A', shadowAmt: 0.45, stars: 1,
    },
  },
  c: {
    day: {
      stops: ['#EEEDEB', '#E6EAF0', '#F8F5EF', '#E3E9F1', '#CCD8E8'],
      ridgeBase: '#7F7E95', haze: '#EEF0F4', rim: '#FFFFFF', rimAmt: 0,
      cloudLit: '#FFFFFF', cloudShade: '#CFD7E4', shadow: '#ADB4C1', shadowAmt: 0.45, stars: 0,
    },
    dusk: {
      stops: ['#363A62', '#615679', '#E5A68A', '#856B94', '#262E48'],
      ridgeBase: '#383C66', haze: '#D29A8D', rim: '#F6BF9F', rimAmt: 0.85,
      cloudLit: '#F3BDA1', cloudShade: '#8879A5', shadow: '#736E8E', shadowAmt: 0.45, stars: 1,
    },
  },
};

/** A sky look blended between day and dusk, as linear THREE colours ready for uniforms. */
export interface SkyMix {
  stops: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color];
  /** Flat colour of each distant ridge layer (near → far). */
  ridges: [THREE.Color, THREE.Color, THREE.Color];
  rim: THREE.Color;
  rimAmt: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  shadow: THREE.Color;
  shadowAmt: number;
  stars: number;
}

export function createSkyMix(): SkyMix {
  const c = () => new THREE.Color();
  return { stops: [c(), c(), c(), c(), c()], ridges: [c(), c(), c()], rim: c(), rimAmt: 0, cloudLit: c(), cloudShade: c(), shadow: c(), shadowAmt: 0, stars: 0 };
}

const ta = new THREE.Color(), tb = new THREE.Color(), tc = new THREE.Color(), td = new THREE.Color();
const mixInto = (out: THREE.Color, a: string, b: string, t: number) => out.set(a).lerp(tb.set(b), t);
/** Mix two hex colours in sRGB (like the bible's hex maths), result in the linear working space. */
function srgbMix(out: THREE.Color, a: string, b: string, t: number): THREE.Color {
  ta.set(a).convertLinearToSRGB();
  tc.set(b).convertLinearToSRGB();
  return out.setRGB(ta.r + (tc.r - ta.r) * t, ta.g + (tc.g - ta.g) * t, ta.b + (tc.b - ta.b) * t, THREE.SRGBColorSpace);
}

/** Resolve palette `p` at dusk amount `t` (0 = day … 1 = dusk) into `out` (allocation-free). */
export function mixSky(p: PaletteId, t: number, out: SkyMix = createSkyMix()): SkyMix {
  const { day, dusk } = SKY_LOOKS[p];
  const k = Math.max(0, Math.min(1, t));
  for (let i = 0; i < 5; i++) mixInto(out.stops[i]!, day.stops[i]!, dusk.stops[i]!, k);
  for (let i = 0; i < 3; i++) {
    srgbMix(out.ridges[i]!, day.ridgeBase, day.haze, RIDGE_HAZE[i]!);
    srgbMix(td, dusk.ridgeBase, dusk.haze, RIDGE_HAZE[i]!);
    out.ridges[i]!.lerp(td, k);
  }
  mixInto(out.rim, day.rim, dusk.rim, k);
  mixInto(out.cloudLit, day.cloudLit, dusk.cloudLit, k);
  mixInto(out.cloudShade, day.cloudShade, dusk.cloudShade, k);
  mixInto(out.shadow, day.shadow, dusk.shadow, k);
  out.rimAmt = day.rimAmt + (dusk.rimAmt - day.rimAmt) * k;
  out.shadowAmt = day.shadowAmt + (dusk.shadowAmt - day.shadowAmt) * k;
  out.stars = day.stars + (dusk.stars - day.stars) * k;
  return out;
}

const smooth = (e0: number, e1: number, x: number) => { const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };

/** Sky colour at height t above the horizon — the same curve as the GLSL `hwSky`. */
export function skyAt(m: SkyMix, t: number, out = new THREE.Color()): THREE.Color {
  out.copy(m.stops[0]);
  for (let i = 1; i < 5; i++) out.lerp(m.stops[i]!, smooth(SKY_T[i - 1]!, SKY_T[i]!, t));
  return out;
}

/** World heights over which a ridge curtain's mist turns from the backdrop (at its foot) to the glowing valley haze. */
export const MIST_FOOT = [RIDGE_FOOT_Y + 4, RIDGE_FOOT_Y + 20] as const;

/** What a distant ridge mists into at world height `y`, where the backdrop behind it is at horizon height `t` — the
 *  same curve as the props shader (for a band facing the camera): the sky, lifted to at least the glow at `MIST_T`,
 *  except down at the curtain's foot, where it is exactly the backdrop so the curtain never shows an edge. */
export function ridgeMist(m: SkyMix, t: number, y: number, out = new THREE.Color()): THREE.Color {
  skyAt(m, t, out);
  const glow = skyAt(m, Math.max(t, MIST_T), new THREE.Color());
  return out.lerp(glow, smooth(MIST_FOOT[0], MIST_FOOT[1], y));
}
