// Owner: T3b. Scenario name + clock, with a mini run timeline (advertised events, clearing period).
import type { AdvertisedEvent } from '@headway/sim';
import { useApp } from '../../state/store';
import { hudVars, localClock, mmss } from './format';
import './hud.css';

export interface ScenarioViewProps {
  name: string;
  clock: string;
  t: number;
  durationS: number;
  clearingS: number;
  phase: 'running' | 'clearing' | 'done';
  events: AdvertisedEvent[];
  clockStart: string;
  paused?: boolean;
  style?: Record<string, string>;
}

export function scenarioStatus(p: Pick<ScenarioViewProps, 't' | 'durationS' | 'phase' | 'events' | 'clockStart'>): string {
  if (p.phase === 'done') return 'Run complete';
  if (p.phase === 'clearing') return 'No new riders · clearing';
  const next = [...p.events].sort((a, b) => a.t - b.t).find((e) => e.t > p.t);
  if (next) return next.t - p.t <= 600 ? `${next.label} in ${mmss(next.t - p.t)}` : `${next.label} at ${localClock(p.clockStart, next.t)}`;
  return `New riders until ${localClock(p.clockStart, p.durationS)}`;
}

export function ScenarioView(p: ScenarioViewProps) {
  const total = Math.max(1, p.durationS + p.clearingS);
  const prog = Math.min(1, Math.max(0, p.t / total));
  const clearFrom = Math.min(1, p.durationS / total);
  return (
    <div className="hud-root hud-surface hud-scenario" data-phase={p.phase} data-paused={!!p.paused} style={p.style}
      aria-label={`${p.name}, ${p.clock}`}>
      <span className="hud-scn-dot" aria-hidden />
      <span className="hud-scn-text">
        <span className="hud-label">{p.name}</span>
        <span className="hud-scn-clock hud-num">{p.clock}</span>
      </span>
      <span className="hud-scn-tl">
        <span className="hud-scn-track" aria-hidden>
          <span className="hud-scn-clear" style={{ left: `${clearFrom * 100}%` }} />
          <span className="hud-scn-fill" style={{ transform: `scaleX(${prog})` }} />
          {p.events.map((e) => (
            <span key={`${e.kind}-${e.t}`} className="hud-scn-ev" data-past={e.t <= p.t}
              style={{ left: `${Math.min(1, e.t / total) * 100}%` }} title={`${e.label} · ${localClock(p.clockStart, e.t)}`} />
          ))}
        </span>
        <span className="hud-scn-status">{p.paused && p.phase !== 'done' ? 'Paused' : scenarioStatus(p)}</span>
      </span>
    </div>
  );
}

export function ScenarioChip() {
  const hud = useApp((s) => s.hud);
  const obs = useApp((s) => s.observation);
  const paused = useApp((s) => s.paused);
  const palette = useApp((s) => s.palette);
  const sc = obs?.scenario;
  if (!sc) {
    return (
      <ScenarioView name="Loading town" clock="--:--" t={0} durationS={1} clearingS={0} phase="running" events={[]}
        clockStart="00:00" paused style={hudVars(palette)} />
    );
  }
  const t = hud?.t ?? obs.t;
  return (
    <ScenarioView name={sc.name} clock={hud?.clock || localClock(sc.clockStart, t)} t={t} durationS={sc.durationS}
      clearingS={sc.clearingS} phase={hud?.phase ?? obs.phase} events={sc.advertised ?? []} clockStart={sc.clockStart}
      paused={paused} style={hudVars(palette)} />
  );
}
