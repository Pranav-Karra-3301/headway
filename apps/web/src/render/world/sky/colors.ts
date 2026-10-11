// Owner: E3. Sky looks per palette × light: the screen-space gradient (4 stops, top → bottom), distant-ridge and
// cloud tints, sun glow and the soft drop shadow the diorama casts on the void below it.
// Day reads mint → cream, dusk indigo → peach (matches the approved look-v1 screens); the gradient's middle stop is
// the palette background, so `shared.uFadeColor` (highlight fades) and the HTML page still match the sky.
import * as THREE from 'three';
import type { PaletteId } from '../../types';

export interface SkyLook {
  /** Gradient stops from the top of the screen to the bottom. */
  stops: [string, string, string, string];
  ridgeLit: string;
  ridgeShade: string;
  cloudLit: string;
  cloudShade: string;
  /** Sun glow tint + strength (screen space, upper left by day, lower left at dusk). */
  glow: string;
  glowAmt: number;
  /** Drop-shadow multiply tint + strength. */
  shadow: string;
  shadowAmt: number;
}

export const SKY_LOOKS: Record<PaletteId, { day: SkyLook; dusk: SkyLook }> = {
  a: {
    day: {
      stops: ['#BFE3D3', '#D3ECE1', '#E6F2E5', '#FBF3E3'],
      ridgeLit: '#93C7B2', ridgeShade: '#6FA894', cloudLit: '#FFFFFF', cloudShade: '#D2E6DE',
      glow: '#FFF3D6', glowAmt: 0.16, shadow: '#9FB9AF', shadowAmt: 0.55,
    },
    dusk: {
      stops: ['#1C2250', '#3A3D78', '#8A6A94', '#F0A889'],
      ridgeLit: '#4C4B85', ridgeShade: '#33356A', cloudLit: '#F8C2A6', cloudShade: '#7B74A6',
      glow: '#FFB487', glowAmt: 0.3, shadow: '#6B6A8E', shadowAmt: 0.5,
    },
  },
  b: {
    day: {
      stops: ['#DDE3D2', '#EAEADC', '#F3EDE0', '#FAF3E6'],
      ridgeLit: '#AEB99F', ridgeShade: '#909E86', cloudLit: '#FFFDF8', cloudShade: '#E4E0D2',
      glow: '#FFF1D2', glowAmt: 0.14, shadow: '#BDB5A2', shadowAmt: 0.5,
    },
    dusk: {
      stops: ['#20253D', '#403E62', '#8A6C7F', '#E3A487'],
      ridgeLit: '#4B4768', ridgeShade: '#363450', cloudLit: '#F0BFA4', cloudShade: '#7C7290',
      glow: '#FFB487', glowAmt: 0.28, shadow: '#6E6A80', shadowAmt: 0.5,
    },
  },
  c: {
    day: {
      stops: ['#CFDAEA', '#E2E8F1', '#EEF0F2', '#F8F2E9'],
      ridgeLit: '#B49C90', ridgeShade: '#977F77', cloudLit: '#FFFFFF', cloudShade: '#D9E0EB',
      glow: '#FFF1D8', glowAmt: 0.15, shadow: '#AEB5C2', shadowAmt: 0.5,
    },
    dusk: {
      stops: ['#1A2142', '#383D6C', '#866A8B', '#ECA585'],
      ridgeLit: '#4B4672', ridgeShade: '#353359', cloudLit: '#F6C0A3', cloudShade: '#7A73A3',
      glow: '#FFB487', glowAmt: 0.3, shadow: '#6A6890', shadowAmt: 0.5,
    },
  },
};

/** A sky look blended between day and dusk, as linear THREE colours ready for uniforms. */
export interface SkyMix {
  stops: [THREE.Color, THREE.Color, THREE.Color, THREE.Color];
  ridgeLit: THREE.Color;
  ridgeShade: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  glow: THREE.Color;
  glowAmt: number;
  shadow: THREE.Color;
  shadowAmt: number;
}

export function createSkyMix(): SkyMix {
  const c = () => new THREE.Color();
  return { stops: [c(), c(), c(), c()], ridgeLit: c(), ridgeShade: c(), cloudLit: c(), cloudShade: c(), glow: c(), glowAmt: 0, shadow: c(), shadowAmt: 0 };
}

const tmp = new THREE.Color();
const mixInto = (out: THREE.Color, a: string, b: string, t: number) => out.set(a).lerp(tmp.set(b), t);

/** Resolve palette `p` at dusk amount `t` (0 = day … 1 = dusk) into `out` (allocation-free). */
export function mixSky(p: PaletteId, t: number, out: SkyMix = createSkyMix()): SkyMix {
  const { day, dusk } = SKY_LOOKS[p];
  const k = Math.max(0, Math.min(1, t));
  for (let i = 0; i < 4; i++) mixInto(out.stops[i]!, day.stops[i]!, dusk.stops[i]!, k);
  mixInto(out.ridgeLit, day.ridgeLit, dusk.ridgeLit, k);
  mixInto(out.ridgeShade, day.ridgeShade, dusk.ridgeShade, k);
  mixInto(out.cloudLit, day.cloudLit, dusk.cloudLit, k);
  mixInto(out.cloudShade, day.cloudShade, dusk.cloudShade, k);
  mixInto(out.glow, day.glow, dusk.glow, k);
  mixInto(out.shadow, day.shadow, dusk.shadow, k);
  out.glowAmt = day.glowAmt + (dusk.glowAmt - day.glowAmt) * k;
  out.shadowAmt = day.shadowAmt + (dusk.shadowAmt - day.shadowAmt) * k;
  return out;
}

/** Same stop placement as the GLSL `hwSky` (t: 0 = bottom of the screen … 1 = top). For tests and CSS. */
export function skyAt(m: SkyMix, t: number, out = new THREE.Color()): THREE.Color {
  const s = (e0: number, e1: number, x: number) => { const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
  const [s0, s1, s2, s3] = m.stops;
  out.copy(s3).lerp(s2, s(0.0, 0.4, t));
  out.lerp(s1, s(0.3, 0.72, t));
  out.lerp(s0, s(0.62, 1.0, t));
  return out;
}
