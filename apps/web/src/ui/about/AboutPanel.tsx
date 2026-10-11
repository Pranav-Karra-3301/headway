// Owner: T7. Honest explainer of the experiment, as a sheet over the live town.
// Open state is the store's `about` flag (T3a's top-bar button calls setAbout(true)). Also: `?` toggles it,
// Esc or a click outside closes it, and `/#about` deep-links to it (handy for the demo and screenshots).
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CONFIG, SEEDS } from '@headway/sim';
import { useApp } from '../../state/store';
import { AboutSheet } from './AboutSheet';
import { aboutFacts, isAboutHotkey } from './facts';
import { paletteVars, reducedMotion } from './paletteVars';
import './about.css';

const CLOSE_MS = 160;

/** Optional inline trigger (a top-bar chip) for shells that want one; AboutPanel itself renders no trigger. */
export function AboutButton({ className }: { className?: string }) {
  const open = useApp((s) => s.about);
  return (
    <button
      type="button"
      className={className ?? 'hwa-trigger'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => useApp.getState().setAbout(!open)}
    >
      <span className="hwa-trigger-q" aria-hidden="true">?</span>
      About
    </button>
  );
}

export function AboutPanel() {
  const open = useApp((s) => s.about);
  const palette = useApp((s) => s.palette);
  const light = useApp((s) => s.light);
  const champion = useApp((s) => s.champion);
  const generations = useApp((s) => s.lab.generations);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const facts = useMemo(() => aboutFacts(DEFAULT_CONFIG, SEEDS), []);

  // Mount on open (synchronously, so focus can land on the first commit); on close play a short exit, then unmount.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const closing = shown && !open;
  useEffect(() => {
    if (!closing) return;
    const id = window.setTimeout(() => setShown(false), reducedMotion() ? 0 : CLOSE_MS);
    return () => window.clearTimeout(id);
  }, [closing]);

  // Focus the sheet on open; give focus back to whatever opened it on close.
  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      rootRef.current?.querySelector<HTMLElement>('.hwa-sheet')?.focus({ preventScroll: true });
    } else if (returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [open]);

  // `?` toggles, Esc closes. Capture phase + stopImmediatePropagation so the HUD and the title card behind
  // never also act on the same key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (isAboutHotkey(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.setAbout(!s.about);
      } else if (e.key === 'Escape' && s.about) {
        e.preventDefault();
        e.stopImmediatePropagation();
        s.setAbout(false);
      } else if (s.about && e.key !== 'Tab' && !e.metaKey && !e.ctrlKey) {
        e.stopPropagation(); // modal: game keys never reach Play/Watch behind the sheet (scrolling still works)
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // `#about` deep link; closing drops the hash again.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === '#about') useApp.getState().setAbout(true);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    if (!open && window.location.hash === '#about') {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, [open]);

  if (!shown) return null;
  const close = () => useApp.getState().setAbout(false);
  return (
    <div ref={rootRef} className="hwa" data-closing={closing || undefined} data-light={light} style={paletteVars(palette, 'hwa')}>
      <div className="hwa-scrim" onClick={close} />
      <AboutSheet facts={facts} champion={champion} generations={generations} onClose={close} />
    </div>
  );
}
