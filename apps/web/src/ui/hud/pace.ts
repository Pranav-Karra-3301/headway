// Owner: T3b. Live pace vs the AI (Play): the Web Worker's champion / baseline jSoFar curves arrive on a 30 sim-s grid
// in store.play.pace (T3c game.ts); the HUD compares them with the live run's jSoFar at the current sim time.
// `you` in the samples may be NaN (future) and is not used here.
import type { PaceSample } from '../../state/store';

type Key = 'you' | 'champion' | 'baseline';

/** J of `key` at sim time t, linearly interpolated between samples (clamped to the sampled range). */
export function jAt(samples: readonly PaceSample[], key: Key, t: number): number | null {
  const n = samples.length;
  if (n === 0) return null;
  const first = samples[0]!;
  if (t <= first.t) return first[key];
  let lo = 0;
  let hi = n - 1;
  if (t >= samples[hi]!.t) return samples[hi]![key];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo]!;
  const b = samples[hi]!;
  const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return a[key] + (b[key] - a[key]) * f;
}

/** Below this many passenger-hours either way the race reads as even. */
export const EVEN_PAX_H = 0.05;

export interface PaceModel {
  /** Passenger-hours the player is ahead of the champion (positive = ahead; J is lower-is-better). */
  vsAiPaxH: number;
  vsBaselinePaxH: number | null;
  ahead: boolean;
  tone: 'ahead' | 'behind' | 'even';
  t: number;
}

export function paceModel(samples: readonly PaceSample[], t: number, youJ: number): PaceModel | null {
  const ai = jAt(samples, 'champion', t);
  if (ai == null || !Number.isFinite(ai) || !Number.isFinite(youJ)) return null;
  const base = jAt(samples, 'baseline', t);
  const vsAiPaxH = (ai - youJ) / 3600;
  const tone = Math.abs(vsAiPaxH) < EVEN_PAX_H ? 'even' : vsAiPaxH > 0 ? 'ahead' : 'behind';
  return {
    vsAiPaxH, vsBaselinePaxH: base == null || !Number.isFinite(base) ? null : (base - youJ) / 3600,
    ahead: tone === 'ahead', tone, t,
  };
}
