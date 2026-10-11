// Play seeds (spec §7): stadium_exit × (50000 + UTC days since 2026-10-11). The leaderboard accepts the last 7 days.
import { playInstance } from '@headway/sim';

export const PLAY_EPOCH_UTC = Date.UTC(2026, 9, 11);
export const PLAY_SCENARIO = 'stadium_exit';
export const PLAY_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

/** Same as the web's `playDayIndex`: 0 on 2026-10-11 (UTC), +1 per UTC day, never negative. */
export function playDayIndex(nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - PLAY_EPOCH_UTC) / DAY_MS));
}

export function todayPlaySeed(nowMs: number): number {
  return playInstance(playDayIndex(nowMs)).seed;
}

/** True for today's play seed and the 6 days before it. */
export function isRecentPlaySeed(seed: number, nowMs: number): boolean {
  const today = playDayIndex(nowMs);
  for (let d = today; d >= 0 && d > today - PLAY_WINDOW_DAYS; d--) if (playInstance(d).seed === seed) return true;
  return false;
}
