// Owner: T7. When the first-visit title card shows. Pure helpers; Landing.tsx wires them to window.
export { PITCH } from '../about/facts';

export const LANDING_SEEN_KEY = 'headway.landing.seen.v1';

export interface LandingContext {
  pathname: string;
  search: string;
  /** The visitor already dismissed the card (localStorage). */
  seen: boolean;
  /** navigator.webdriver: headless smoke tests and screenshot runs. */
  automated: boolean;
}

/** `?intro` (or `?intro=1`) re-shows the card for a demo; `?intro=0` does not. */
export function isForced(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.has('intro') && p.get('intro') !== '0';
}

/** The search string without the intro flag ('' when nothing is left). */
export function cleanIntroSearch(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('intro');
  const s = p.toString().replace(/=(?=&|$)/g, '');
  return s ? `?${s}` : '';
}

/** First human visit to Watch (`/`), or forced with `?intro`. Never over a deep link to /play or /lab. */
export function shouldShowLanding(c: LandingContext): boolean {
  const path = c.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/') return false;
  if (isForced(c.search)) return true;
  return !c.seen && !c.automated;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function readSeen(s: StorageLike | null | undefined): boolean {
  try {
    return s?.getItem(LANDING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSeen(s: StorageLike | null | undefined): void {
  try {
    s?.setItem(LANDING_SEEN_KEY, '1');
  } catch {
    /* private mode: the card shows again next visit */
  }
}
