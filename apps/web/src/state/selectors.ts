// Store selectors shared across tracks (T3a).
import { policyLabel } from '../sim/session';
import type { AppState } from './store';

export type Severity = 'ok' | 'warn' | 'bad';

/** Queue-wait severity (spec §10): ok < 180 s ≤ warn < 420 s ≤ bad. */
export function severityOf(waitS: number): Severity {
  return waitS < 180 ? 'ok' : waitS < 420 ? 'warn' : 'bad';
}

/** Name of the controller running in Watch ("Champion g4", "Baseline g0", "Reference", "Replay g3"). */
export function selectWatchLabel(s: AppState): string {
  return s.watchOverride?.label ?? policyLabel(s.watchController, s.watchController === 'champion' ? s.champion?.policy ?? null : null);
}

/** Town HUD (legend, inspector, markers, sim metrics) is hidden behind the Lab panel. */
export const selectShowHud = (s: AppState): boolean => s.mode !== 'lab';

/** The sim is advancing: a feed exists, not paused, not done. */
export const selectIsLive = (s: AppState): boolean => !!s.hud && !s.paused && s.hud.phase !== 'done';

export const selectChampionId = (s: AppState): string | null => s.champion?.policy.meta.id ?? null;

export const selectPlayActive = (s: AppState): boolean => s.mode === 'play' && s.play.phase === 'playing';
