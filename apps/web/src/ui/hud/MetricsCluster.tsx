// Owner: T3b. Top-bar metrics, decluttered to the essentials (mean wait, completion %, missed connections; p95 lives in Results/Lab) + Play's live
// "You vs AI" pace chip (fed by store.play.pace from modes/play/game.ts, T3c), which floats at top-centre under the
// clock so the bar never overflows on 1280–1440 px screens.
// Reads the 4 Hz HUD feed only; numbers spring between ticks (Ticker), never re-render per frame.
import type { CSSProperties } from 'react';
import { useApp } from '../../state/store';
import type { HudMetrics } from '../../state/store';
import { hudVars, localClock, mmss, pct, severityOf, signed } from './format';
import { paceModel } from './pace';
import type { PaceModel } from './pace';
import { Ticker } from './Ticker';
import './hud.css';

const round = (v: number) => String(Math.max(0, Math.round(v)));
const DASH = '—';

function Stat({ label, short, value, format, sev, title }: { label: string; short: string; value: number | null; format: (v: number) => string; sev?: string; title?: string }) {
  return (
    <div className="hud-stat" data-sev={sev} title={title}>
      <span className="hud-label"><span className="hud-l-long">{label}</span><span className="hud-l-short" aria-hidden>{short}</span></span>
      {value == null
        ? <span className="hud-stat-value hud-stat-dim">{DASH}</span>
        : <Ticker className="hud-stat-value" value={value} format={format} />}
    </div>
  );
}

export interface MetricsViewProps {
  hud: HudMetrics | null;
  pace?: PaceModel | null;
  paceClock?: string | null;
  style?: CSSProperties;
}

export function MetricsView({ hud, pace, paceClock, style }: MetricsViewProps) {
  return (
    <div className="hud-root hud-metrics" style={style}>
      <div className="hud-surface hud-stats">
        <Stat label="Mean wait" short="Wait" value={hud?.meanWaitS ?? null} format={mmss} sev={hud ? severityOf(hud.meanWaitS) : undefined}
          title="Mean wait so far" />
        <Stat label="Completed" short="Done" value={hud?.completionPct ?? null} format={pct} title="Riders who reached their destination" />
        <Stat label="Missed" short="Missed" value={hud?.missedConnections ?? null} format={round} title="Missed connections" />
      </div>
      {pace && (
        <div className="hud-pace" data-tone={pace.tone} data-ahead={pace.ahead} role="status"
          title="Passenger-hours you have saved so far compared with the AI dispatcher on the same crowd">
          <span className="hud-label">{paceClock ? `You vs AI · ${paceClock}` : 'You vs AI'}</span>
          <span className="hud-pace-value">
            {pace.tone === 'even' ? 'even' : <Ticker value={pace.vsAiPaxH} format={(v) => signed(v)} />}
          </span>
          {pace.tone !== 'even' && <span className="hud-pace-unit">pax-h</span>}
        </div>
      )}
    </div>
  );
}

export function MetricsCluster() {
  const hud = useApp((s) => s.hud);
  const palette = useApp((s) => s.palette);
  const mode = useApp((s) => s.mode);
  const samples = useApp((s) => s.play.pace);
  const playPhase = useApp((s) => s.play.phase);
  const clockStart = useApp((s) => s.observation?.scenario.clockStart ?? null);
  const live = mode === 'play' && playPhase === 'playing'; // Finish shows its own progress banner at top-centre
  const pace = live && hud && samples.length > 0 ? paceModel(samples, hud.t, hud.jSoFar) : null;
  const paceClock = pace && hud ? hud.clock || (clockStart ? localClock(clockStart, hud.t) : null) : null;
  return <MetricsView hud={hud} pace={pace} paceClock={paceClock} style={hudVars(palette)} />;
}
