// Owner: T7. First-visit title card over the live town: wordmark, one-line pitch, three mode cards.
// Shows on a first human visit to `/` (or with `?intro`), never over /play or /lab deep links and never for
// automated browsers (smoke tests, screenshots). Enter → Watch, Esc or a click outside → close, cards → setMode.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, type Mode } from '../../state/store';
import { paletteVars, reducedMotion } from '../about/paletteVars';
import { LandingCard } from './LandingCard';
import { cleanIntroSearch, markSeen, readSeen, shouldShowLanding } from './landingLogic';
import './landing.css';

const LEAVE_MS = 200;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** WebDriver/CDP sessions and `--headless` screenshots (whose UA says HeadlessChrome; navigator.webdriver stays false). */
function isAutomated(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.webdriver === true || /HeadlessChrome/.test(navigator.userAgent);
}

function initialOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return shouldShowLanding({
    pathname: window.location.pathname,
    search: window.location.search,
    seen: readSeen(storage()),
    automated: isAutomated(),
  });
}

export function Landing() {
  const [open, setOpen] = useState(initialOpen);
  const [leaving, setLeaving] = useState(false);
  const palette = useApp((s) => s.palette);
  const light = useApp((s) => s.light);
  const champion = useApp((s) => s.champion);
  const generations = useApp((s) => s.lab.generations);
  const mode = useApp((s) => s.mode);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback((next: Mode | null) => {
    if (leaving) return;
    markSeen(storage());
    const { pathname, search, hash } = window.location;
    const clean = cleanIntroSearch(search);
    if (clean !== search) window.history.replaceState(window.history.state, '', pathname + clean + hash);
    if (next) useApp.getState().setMode(next);
    setLeaving(true);
    window.setTimeout(() => setOpen(false), reducedMotion() ? 0 : LEAVE_MS);
  }, [leaving]);

  // Back/forward (or any other route change) away from Watch retires the card.
  useEffect(() => {
    if (open && !leaving && mode !== 'watch') {
      markSeen(storage());
      setOpen(false);
    }
  }, [open, leaving, mode]);

  useEffect(() => {
    if (open) rootRef.current?.focus({ preventScroll: true });
  }, [open]);

  // While the card is up it is modal: Enter watches, Escape closes, other keys never reach the HUD behind it.
  // The About panel (opened from here) handles its own keys first.
  useEffect(() => {
    if (!open || leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (useApp.getState().about || e.key === 'Tab' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        close('watch');
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, leaving, close]);

  if (!open) return null;
  return (
    <div
      ref={rootRef}
      className="hwl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hwl-title"
      tabIndex={-1}
      data-leaving={leaving || undefined}
      data-light={light}
      style={paletteVars(palette, 'hwl')}
    >
      <div className="hwl-scrim" onClick={() => close(null)} />
      <LandingCard
        onChoose={(m) => close(m)}
        onAbout={() => useApp.getState().setAbout(true)}
        champion={champion}
        generations={generations}
      />
    </div>
  );
}
