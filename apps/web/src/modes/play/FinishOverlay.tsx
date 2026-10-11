// Owner: T3c. "Finish" fast-forward progress (the town visibly races to the end underneath).
import { clock } from './logic';
import { usePlay } from './playStore';
import { FastIcon } from './ui';

export function FinishOverlay() {
  const f = usePlay((s) => s.finishing);
  const clockStart = usePlay((s) => s.obs?.scenario.clockStart ?? '00:00');
  const pct = f ? Math.min(1, Math.max(0, (f.t - f.from) / Math.max(1, f.to - f.from))) : 1;
  return (
    <div className="pl-finishing hw-card" role="status">
      <FastIcon />
      <span>Fast-forwarding to <b className="hw-num">{clock(clockStart, f?.to ?? 0)}</b></span>
      <span className="pl-bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct})` }} /></span>
      <span className="hw-num pl-finishing__pct">{Math.round(pct * 100)}%</span>
    </div>
  );
}
