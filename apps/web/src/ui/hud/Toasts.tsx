// Owner: T3b. Toast stack (top-centre, below the top bar): transfer made, missed connection, walkaway, alerts.
// Also runs alerts.ts on every HUD observation (so the shell only pushes event toasts).
// Timers pause while hovered or while the tab is hidden; exits animate before the store drops the toast.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useApp } from '../../state/store';
import type { Toast } from '../../state/store';
import { createAlerts } from './alerts';
import { hudVars, localClock } from './format';
import { AlertIcon, CloseIcon, InfoIcon, MissedIcon, TransferIcon, WalkIcon } from './icons';
import './hud.css';

/** How long each kind stays up (real ms). */
export const TOAST_MS: Record<Toast['kind'], number> = { alert: 6000, missed: 4000, walkaway: 4000, transfer: 3200, info: 4000 };
const EXIT_MS = 160;

const ICONS: Record<Toast['kind'], ReactNode> = {
  alert: <AlertIcon />, transfer: <TransferIcon />, missed: <MissedIcon />, walkaway: <WalkIcon />, info: <InfoIcon />,
};

export interface ToastViewProps {
  toasts: Toast[];
  clockStart: string | null;
  /** Start the stack lower (the pace chip and Play's finishing / spectate banners sit at top-centre). */
  offset?: boolean;
  exiting?: ReadonlySet<number>;
  onDismiss(id: number): void;
  onHold(hold: boolean): void;
  style?: CSSProperties;
}

export function ToastView({ toasts, clockStart, offset, exiting, onDismiss, onHold, style }: ToastViewProps) {
  // Alerts first (they carry game state), then events; newest first within each group.
  const ordered = [...toasts].reverse().sort((a, b) => Number(b.kind === 'alert') - Number(a.kind === 'alert'));
  return (
    <div className="hud-root hud-toasts" data-offset={!!offset} style={style} role="status" aria-live="polite">
      {ordered.map((t, i) => (
        <div key={t.id} className="hud-toast hud-surface" data-kind={t.kind} data-i={i} data-exiting={exiting?.has(t.id) ?? false}
          style={{ '--i': i, zIndex: 10 - i } as CSSProperties}
          onPointerEnter={() => onHold(true)} onPointerLeave={() => onHold(false)}>
          <span className="hud-toast-icon" aria-hidden>{ICONS[t.kind]}</span>
          <span className="hud-toast-text">{t.text}</span>
          {clockStart && <span className="hud-toast-time">{localClock(clockStart, t.simT)}</span>}
          <button type="button" className="hud-toast-x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}><CloseIcon size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/** Feeds every new observation through the alert rules and pushes the resulting toasts. */
function useAlertFeed(): void {
  useEffect(() => {
    const alerts = createAlerts();
    let mode = useApp.getState().mode;
    return useApp.subscribe((s, prev) => {
      if (s.mode !== mode) { mode = s.mode; alerts.reset(); }
      if (!s.observation || s.observation === prev.observation || s.mode === 'lab') return;
      for (const a of alerts.update(s.observation)) useApp.getState().pushToast(a);
    });
  }, []);
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const palette = useApp((s) => s.palette);
  const offset = useApp((s) => s.mode === 'play' && s.play.phase !== 'intro');
  const clockStart = useApp((s) => s.observation?.scenario.clockStart ?? null);
  const [exiting, setExiting] = useState<ReadonlySet<number>>(() => new Set());
  const hold = useRef(false);
  const left = useRef(new Map<number, number>());

  useAlertFeed();

  const dismiss = (id: number) => {
    left.current.delete(id);
    setExiting((s) => (s.has(id) ? s : new Set(s).add(id)));
    window.setTimeout(() => {
      useApp.getState().dismissToast(id);
      setExiting((s) => {
        if (!s.has(id)) return s;
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, EXIT_MS);
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    let last = performance.now();
    const iv = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // A toast removed under the pointer never fires pointerleave: trust :hover as the source of truth.
      if (hold.current && !document.querySelector('.hud-toast:hover')) hold.current = false;
      if (hold.current || document.hidden) return;
      const live = useApp.getState().toasts;
      const ids = new Set(live.map((t) => t.id));
      for (const id of left.current.keys()) if (!ids.has(id)) left.current.delete(id);
      for (const t of live) {
        if (!left.current.has(t.id)) left.current.set(t.id, TOAST_MS[t.kind] ?? 4000);
        const ms = left.current.get(t.id)! - dt;
        if (ms <= 0) dismissRef.current(t.id);
        else left.current.set(t.id, ms);
      }
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  return (
    <ToastView toasts={toasts} clockStart={clockStart} offset={offset} exiting={exiting} style={hudVars(palette)}
      onDismiss={(id) => dismiss(id)} onHold={(h) => { hold.current = h; }} />
  );
}
