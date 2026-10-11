// Owner: T3b. Inspector card for the current selection (spec §10): vehicle (occupancy, next stop, the rule that
// fired), stop (queue by route, longest wait, next arrivals), person (journey and why they are waiting).
// Re-renders with the 4 Hz HUD feed; reads the latest snapshot / passenger from frame.runner at that moment.
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PassengerInfo, RouteId, StopId } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import type { PaletteId, Pick as RenderPick } from '../../render/types';
import { hudVars, mmss, routeColor } from './format';
import { personModel, stopModel, vehicleModel } from './inspect';
import type { PersonModel, StopModel, VehicleModel } from './inspect';
import { BusIcon, CloseIcon, PersonIcon, StopIcon, TrainIcon } from './icons';
import './hud.css';

export type InspectorModel =
  | { kind: 'vehicle'; m: VehicleModel }
  | { kind: 'stop'; m: StopModel }
  | { kind: 'person'; m: PersonModel }
  | { kind: 'missing'; title: string; text: string; icon: 'bus' | 'train' | 'stop' | 'person' };

const tone = (sev: string) => (sev === 'bad' ? 'bad' : sev === 'warn' ? 'warn' : 'ok');
const loadTone = (pct: number) => (pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : undefined);
const eta = (s: number | null) => (s == null ? '—' : s <= 0 ? 'now' : mmss(s));

function Bar({ pct, tone: t, color }: { pct: number; tone?: string; color?: string }) {
  return (
    <div className="hud-bar" data-tone={t} style={color ? ({ '--bar': color } as CSSProperties) : undefined}>
      <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, pct / 100))})` }} />
    </div>
  );
}

function Ring({ left, total }: { left: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const f = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  return (
    <span className="hud-ring" title={`${Math.ceil(left)} s left`}>
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
        <circle className="bg" cx="19" cy="19" r={r} />
        <circle className="fg" cx="19" cy="19" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      </svg>
      <b>{Math.ceil(left)}s</b>
    </span>
  );
}

function Swatch({ id, palette }: { id: RouteId; palette: PaletteId }) {
  return <span className="hud-route-sw" style={{ '--rc': routeColor(id, palette) } as CSSProperties}>{id.slice(1)}</span>;
}

function Head({ icon, tile, title, sub, onClose }: { icon: ReactNode; tile: string; title: string; sub: string; onClose(): void }) {
  return (
    <div className="hud-ins-head">
      <span className="hud-ins-tile" style={{ '--tile': tile } as CSSProperties}>{icon}</span>
      <span className="hud-ins-titles">
        <span className="hud-ins-title">{title}</span>
        <span className="hud-ins-sub">{sub}</span>
      </span>
      <button type="button" className="hud-ins-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><CloseIcon /></button>
    </div>
  );
}

function VehicleBody({ m, palette }: { m: VehicleModel; palette: PaletteId }) {
  const color = m.routeId ? routeColor(m.routeId, palette) : 'var(--hud-train)';
  const hold = m.holdLeftS;
  return (
    <>
      <div className="hud-ins-sec">
        <div className="hud-chips">
          <span className="hud-chip" data-tone={m.state === 'holding' ? 'accent' : undefined}>{m.stateLabel}</span>
          {m.next && <span className="hud-chip">{m.kind === 'train' && (m.next.etaS ?? 1) <= 0 ? `At ${m.next.name}` : `Next: ${m.next.name} · ${eta(m.next.etaS)}`}</span>}
          {m.train?.departInS != null && <span className="hud-chip" data-tone="accent">Departs in {mmss(m.train.departInS)}</span>}
        </div>
        <div className="hud-ins-row"><span>Occupancy</span><span className="hud-num">{m.onboard} / {m.capacity}</span></div>
        <Bar pct={m.loadPct} tone={loadTone(m.loadPct)} color={color} />
      </div>
      {(hold != null || m.headway) && (
        <div className="hud-ins-sec">
          {hold != null && (
            <div className="hud-ins-row" style={{ alignItems: 'center' }}>
              <span>Holding</span>
              <Ring left={hold} total={Math.max(hold, m.holdTotalS ?? hold)} />
            </div>
          )}
          {m.headway && (
            <>
              <div className="hud-ins-row"><span>Gap to bus ahead</span><span className="hud-num">{m.headway.aheadS == null || m.headway.aheadS >= 3600 ? '—' : mmss(m.headway.aheadS)}</span></div>
              <div className="hud-ins-row"><span>Gap to bus behind</span><span className="hud-num">{m.headway.behindS == null || m.headway.behindS >= 3600 ? '—' : mmss(m.headway.behindS)}</span></div>
              {m.headway.targetS != null && <div className="hud-ins-row"><span>Target headway</span><span className="hud-num">{mmss(m.headway.targetS)}</span></div>}
            </>
          )}
        </div>
      )}
      {m.train && (
        <div className="hud-ins-sec">
          <div className="hud-ins-row"><span>Alighting next</span><span className="hud-num">{m.train.alightingNext}</span></div>
          {m.train.transfers.length > 0 && (
            <div className="hud-chips">
              {m.train.transfers.map((x) => (
                <span key={x.routeId} className="hud-chip" style={{ '--rc': routeColor(x.routeId, palette) } as CSSProperties}>
                  <span className="hud-chip-dot" />{x.n} to {x.routeId}
                </span>
              ))}
            </div>
          )}
          <div className="hud-ins-row"><span>On platforms</span><span>{m.train.platforms.map((p) => `${p.name} ${p.queue}`).join(' · ')}</span></div>
        </div>
      )}
      <div className="hud-ins-sec">
        <span className="hud-label">Latest decision</span>
        {m.decision ? (
          <div className="hud-quote" style={{ '--q': color } as CSSProperties}>
            {m.decision.text || m.decision.action}
            <div className="hud-quote-meta">
              <span className="hud-chip">{m.decision.action}</span>
              <span className="hud-chip hud-chip--code" data-tone={m.decision.source === 'human' ? 'accent' : undefined} title="Rule that fired">{m.decision.ruleId}</span>
              <span className="hud-chip">{m.decision.source} · {m.decision.clock}</span>
            </div>
          </div>
        ) : (
          <div className="hud-quote" style={{ '--q': 'var(--hud-muted)' } as CSSProperties}>No decision yet: this vehicle is following its route.</div>
        )}
      </div>
    </>
  );
}

function StopBody({ m, palette }: { m: StopModel; palette: PaletteId }) {
  const maxQ = Math.max(1, ...m.byRoute.map((x) => x.n));
  return (
    <>
      <div className="hud-ins-sec">
        <div className="hud-ins-big">
          <span className="hud-num">{m.queue}</span><small>waiting</small>
          <span style={{ flex: 1 }} />
          <span className="hud-chip" data-tone={tone(m.severity)}>longest {mmss(m.longestWaitS)}</span>
        </div>
        {m.byRoute.length > 0 && (
          <div className="hud-qbars">
            {m.byRoute.map((x) => (
              <div key={x.routeId} className="hud-qbar" style={{ '--rc': routeColor(x.routeId, palette) } as CSSProperties}>
                <Swatch id={x.routeId} palette={palette} />
                <Bar pct={(x.n / maxQ) * 100} color={routeColor(x.routeId, palette)} />
                <span>{x.n}</span>
              </div>
            ))}
          </div>
        )}
        {m.platform && (
          <div className="hud-ins-row"><span>{m.platform.name} platform</span><span className="hud-num">{m.platform.queue} waiting</span></div>
        )}
      </div>
      <div className="hud-ins-sec">
        <span className="hud-label">Next arrivals</span>
        {m.arrivals.length === 0 ? (
          <div className="hud-ins-row"><span>Nothing on the way yet</span><span /></div>
        ) : (
          m.arrivals.map((a) => (
            <div key={a.vehicleId} className="hud-ins-row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {a.routeId ? <Swatch id={a.routeId} palette={palette} /> : <span className="hud-route-sw" style={{ '--rc': 'var(--hud-train)' } as CSSProperties}>T</span>}
                {a.kind === 'train' ? 'Train' : `Bus ${a.vehicleId}`}
              </span>
              <span className="hud-num">{eta(a.etaS)}</span>
            </div>
          ))
        )}
      </div>
      {m.lastDeparture.length > 0 && (
        <div className="hud-ins-sec">
          <span className="hud-label">Last departures</span>
          <div className="hud-chips">
            {m.lastDeparture.map((d) => (
              <span key={d.routeId} className="hud-chip hud-chip--text" style={{ '--rc': routeColor(d.routeId, palette) } as CSSProperties}>
                <span className="hud-chip-dot" />{d.routeId} left {d.agoS < 60 ? 'just now' : `${Math.floor(d.agoS / 60)} min ago`}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PersonBody({ m }: { m: PersonModel }) {
  const waiting = /wait/i.test(m.status);
  return (
    <>
      <div className="hud-ins-sec">
        <div className="hud-chips">
          <span className="hud-chip" data-tone={waiting ? (m.patiencePct >= 85 ? 'bad' : 'accent') : undefined}>{m.status}</span>
          <span className="hud-chip">trip ~{Math.round(m.expectedS / 60)} min</span>
        </div>
        {m.reason && <div className="hud-quote">{m.reason}</div>}
        {waiting && (
          <>
            <div className="hud-ins-row"><span>Waited / patience</span><span className="hud-num">{mmss(m.waitedS)} / {mmss(m.patienceS)}</span></div>
            <Bar pct={m.patiencePct} tone={m.patiencePct >= 85 ? 'bad' : m.patiencePct >= 60 ? 'warn' : undefined} />
          </>
        )}
      </div>
      <div className="hud-ins-sec">
        <span className="hud-label">Journey</span>
        <ol className="hud-steps">
          {m.legs.map((l, i) => (
            <li key={i} className="hud-step" data-state={l.state}>
              <span className="hud-step-dot" aria-hidden />
              <span>
                <div className="hud-step-label">{l.label}</div>
                <div className="hud-step-detail">{l.detail}</div>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

export interface InspectorCardProps { model: InspectorModel; palette: PaletteId; onClose(): void; style?: CSSProperties }

export function InspectorCard({ model, palette, onClose, style }: InspectorCardProps) {
  let head: ReactNode;
  let body: ReactNode = null;
  if (model.kind === 'vehicle') {
    const m = model.m;
    const tile = m.routeId ? routeColor(m.routeId, palette) : 'var(--hud-train)';
    head = <Head icon={m.kind === 'train' ? <TrainIcon size={22} /> : <BusIcon size={22} />} tile={tile} title={m.title}
      sub={m.routeId ? `${m.subtitle} · ${m.routeId}` : m.subtitle} onClose={onClose} />;
    body = <VehicleBody m={m} palette={palette} />;
  } else if (model.kind === 'stop') {
    const m = model.m;
    const sevColor = m.severity === 'bad' ? 'var(--hud-bad)' : m.severity === 'warn' ? 'var(--hud-warn)' : 'var(--hud-ink)';
    head = <Head icon={<StopIcon size={22} />} tile={sevColor} title={m.name} sub={m.platform ? 'Bus stop · train station' : 'Bus stop'} onClose={onClose} />;
    body = <StopBody m={m} palette={palette} />;
  } else if (model.kind === 'person') {
    const m = model.m;
    head = <Head icon={<PersonIcon size={22} />} tile="var(--hud-accent)" title={m.title} sub={`${m.from} → ${m.to}`} onClose={onClose} />;
    body = <PersonBody m={m} />;
  } else {
    const icon = model.icon === 'bus' ? <BusIcon size={22} /> : model.icon === 'train' ? <TrainIcon size={22} /> : model.icon === 'stop' ? <StopIcon size={22} /> : <PersonIcon size={22} />;
    head = <Head icon={icon} tile="var(--hud-muted)" title={model.title} sub={model.text} onClose={onClose} />;
  }
  return (
    <aside className="hud-root hud-surface hud-inspector" style={style} aria-label="Inspector">
      {head}
      {body}
    </aside>
  );
}

function safePassenger(id: number): PassengerInfo | null {
  try {
    return frame.runner?.sim.passenger(id) ?? null;
  } catch {
    return null;
  }
}

export function buildInspectorModel(sel: RenderPick, obs: ReturnType<typeof useApp.getState>['observation']): InspectorModel {
  const snap = frame.runner?.next ?? null;
  if (sel.kind === 'bus' || sel.kind === 'train') {
    const m = vehicleModel(sel.id, obs, snap);
    return m ? { kind: 'vehicle', m } : { kind: 'missing', title: sel.kind === 'train' ? 'Train' : `Bus ${sel.id}`, text: 'Waiting for the sim', icon: sel.kind };
  }
  if (sel.kind === 'stop') {
    const m = stopModel(sel.id as StopId, obs);
    return m ? { kind: 'stop', m } : { kind: 'missing', title: 'Stop', text: 'Waiting for the sim', icon: 'stop' };
  }
  const m = personModel(safePassenger(Number(sel.id)));
  return m ? { kind: 'person', m } : { kind: 'missing', title: `Rider #${sel.id}`, text: 'Trip finished', icon: 'person' };
}

export function Inspector() {
  const selection = useApp((s) => s.selection);
  const obs = useApp((s) => s.observation); // changes with every 4 Hz HUD tick → live card
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || el?.closest?.('input, textarea, select')) return;
      useApp.getState().select(null);
      frame.renderer?.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);

  if (!selection || mode === 'lab') return null;
  const model = buildInspectorModel(selection, obs);
  const onClose = () => {
    useApp.getState().select(null);
    frame.renderer?.select(null);
  };
  return <InspectorCard model={model} palette={palette} onClose={onClose} style={hudVars(palette)} />;
}

