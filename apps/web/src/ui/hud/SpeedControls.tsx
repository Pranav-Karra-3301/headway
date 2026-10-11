// Owner: T3b. Pause + 1×/4×/8×/16× chips. Writes the store and the live runner (idempotent with the host's sync).
// Keys outside Play (Play owns its own keyboard map): Space pauses, 1–4 set the speed.
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import type { Speed } from '../../sim/runner';
import { hudVars } from './format';
import { PauseIcon, PlayIcon } from './icons';
import './hud.css';

export const SPEEDS: readonly Speed[] = [1, 4, 8, 16];

export interface SpeedViewProps {
  speed: Speed;
  paused: boolean;
  onSpeed(s: Speed): void;
  onToggle(): void;
  /** Skip the pill slide (keyboard-initiated change). */
  instant?: boolean;
  style?: CSSProperties;
}

export function SpeedView({ speed, paused, onSpeed, onToggle, instant, style }: SpeedViewProps) {
  const i = Math.max(0, SPEEDS.indexOf(speed));
  return (
    <div className="hud-root hud-surface hud-speed" role="group" aria-label="Simulation speed" style={style}>
      <button type="button" className="hud-playbtn" data-paused={paused} aria-label={paused ? 'Play' : 'Pause'}
        title={paused ? 'Play (Space)' : 'Pause (Space)'} onClick={onToggle}>
        {paused ? <PlayIcon size={17} /> : <PauseIcon size={17} />}
      </button>
      <div className="hud-segs" data-paused={paused} data-instant={!!instant} style={{ '--i': i } as CSSProperties}>
        <span className="hud-seg-pill" aria-hidden />
        {SPEEDS.map((s, k) => (
          <button key={s} type="button" className="hud-seg" aria-pressed={s === speed} title={`${s}× speed (${k + 1})`}
            onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
};

export function setSpeed(s: Speed): void {
  useApp.getState().setSpeed(s);
  frame.runner?.setSpeed(s);
}
export function setPaused(p: boolean): void {
  useApp.getState().setPaused(p);
  if (p) frame.runner?.pause();
  else frame.runner?.resume();
}

export function SpeedControls() {
  const speed = useApp((s) => s.speed);
  const paused = useApp((s) => s.paused);
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (mode === 'play') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.code === 'Space' || e.key === ' ') {
        if ((e.target as HTMLElement | null)?.closest?.('button')) return; // the focused button handles Space itself
        e.preventDefault();
        if (!e.repeat) setPaused(!useApp.getState().paused);
        return;
      }
      const k = ['1', '2', '3', '4'].indexOf(e.key);
      if (k >= 0) {
        e.preventDefault();
        setInstant(true);
        setSpeed(SPEEDS[k]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  return (
    <SpeedView speed={speed} paused={paused} instant={instant} style={hudVars(palette)}
      onSpeed={(s) => { setInstant(false); setSpeed(s); if (useApp.getState().paused) setPaused(false); }}
      onToggle={() => { setInstant(false); setPaused(!paused); }} />
  );
}
