// Owner: T3b (v13: U2). Route legend (bottom-left): colour, name, bus icons × N, waiting count; click to highlight.
// In Play each route also gets "Move a bus here" (a reassign intent for a bus from the busiest other route).
import type { CSSProperties } from 'react';
import type { Observation, RouteId } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { issue, nudge } from '../../modes/play/game';
import { usePlay } from '../../modes/play/playStore';
import type { TrackedIntent } from '../../modes/play/intents';
import { ROUTE_IDS, hudVars, routeColor, routeName } from './format';
import { BusIcon, PersonIcon } from './icons';
import './hud.css';
import './RouteLegend.css';

export interface LegendRoute {
  id: RouteId; name: string; color: string; buses: number | null; queue: number | null;
  /** Play only: reassigns heading to this route that have not applied yet. */
  pending?: number;
  /** Play only: a bus that can move here (null = none can). Undefined hides the button. */
  move?: string | null;
}

export interface LegendViewProps {
  routes: LegendRoute[];
  highlighted: RouteId | null;
  onToggle(id: RouteId): void;
  onMove?(id: RouteId): void;
  style?: CSSProperties;
}

const busesLabel = (n: number) => `${n} ${n === 1 ? 'bus' : 'buses'}`;
const MAX_ICONS = 5;

/** Pick a bus to move to `to`: from the other route with the most buses (never its last), preferring one at its terminal. */
export function pickBusFor(obs: Observation | null, to: RouteId, tracked: readonly TrackedIntent[] = []): string | null {
  if (!obs) return null;
  const pendingIds = new Set(tracked.filter((x) => x.status === 'pending' && x.intent.type === 'reassign')
    .map((x) => (x.intent.type === 'reassign' ? x.intent.vehicleId : '')));
  const rank: Record<string, number> = { layover: 0, holding: 1, dwelling: 2 };
  let best: { id: string; left: number; r: number } | null = null;
  for (const from of ROUTE_IDS) {
    if (from === to) continue;
    const onRoute = obs.buses.filter((b) => b.routeId === from);
    const left = onRoute.filter((b) => !pendingIds.has(b.id)).length;
    if (left <= 1) continue;
    const cands = onRoute.filter((b) => !pendingIds.has(b.id) && b.state !== 'deadhead')
      .sort((a, b) => (rank[a.state] ?? 3) - (rank[b.state] ?? 3) || (a.etaNextStopS ?? 0) - (b.etaNextStopS ?? 0));
    const c = cands[0];
    if (!c) continue;
    const r = rank[c.state] ?? 3;
    if (!best || left > best.left || (left === best.left && r < best.r)) best = { id: c.id, left, r };
  }
  return best?.id ?? null;
}

function BusCount({ n }: { n: number }) {
  return (
    <span className="hud-lg-buses">
      <span className="hud-lg-icons" aria-hidden="true">
        {Array.from({ length: Math.min(n, MAX_ICONS) }, (_, i) => <BusIcon key={i} size={14} />)}
      </span>
      <span className="hud-lg-n" aria-hidden="true">×{n}</span>
      <span className="hw-sr-only">{busesLabel(n)}</span>
    </span>
  );
}

export function LegendView({ routes, highlighted, onToggle, onMove, style }: LegendViewProps) {
  return (
    <div className="hud-root hud-surface hud-legend hud-lg" style={style} role="group" aria-label="Routes">
      {routes.map((r) => (
        <div key={r.id} className="hud-lg-row" style={{ '--rc': r.color } as CSSProperties}>
          <button type="button" className="hud-route" aria-pressed={highlighted === r.id}
            data-dim={highlighted !== null && highlighted !== r.id} onClick={() => onToggle(r.id)}
            title="Highlight this route">
            <span className="hud-lg-sw" aria-hidden="true" />
            <span className="hud-route-name">{r.name}</span>
            {r.buses != null && <BusCount n={r.buses} />}
            {r.queue != null && (
              <span className="hud-lg-q" data-hot={r.queue >= 30 || undefined}>
                <PersonIcon size={13} aria-hidden="true" /><span aria-hidden="true">{r.queue}</span>
                <span className="hw-sr-only">{`${r.queue} waiting`}</span>
              </span>
            )}
          </button>
          {onMove && r.move !== undefined && (
            <button type="button" className="hud-lg-move" disabled={!r.move}
              title={r.move ? `Move a bus here (${r.move}, at its next terminal)` : 'No spare bus on the other routes'}
              onClick={() => onMove(r.id)}>
              <span aria-hidden="true">+</span><BusIcon size={14} />
              <span className="hw-sr-only">Move a bus here</span>
              {!!r.pending && <span className="hud-lg-pending" title="Waiting to reach its terminal">{r.pending}</span>}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function RouteLegend() {
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);
  const highlighted = useApp((s) => s.highlightedRoute);
  const appObs = useApp((s) => s.observation);
  const playObs = usePlay((s) => s.obs);
  const tracked = usePlay((s) => s.tracked);
  if (mode === 'lab') return null;
  const play = mode === 'play';
  const obs = (play ? playObs : null) ?? appObs;
  const routes: LegendRoute[] = ROUTE_IDS.map((id) => {
    const r = obs?.routes.find((x) => x.id === id);
    const out: LegendRoute = {
      id, name: routeName(id), color: routeColor(id, palette),
      buses: r ? r.buses.length : obs ? obs.buses.filter((b) => b.routeId === id).length : null,
      queue: r ? r.queue : null,
    };
    if (play && obs) {
      out.move = pickBusFor(obs, id, tracked);
      out.pending = tracked.filter((x) => x.status === 'pending' && x.intent.type === 'reassign' && x.intent.to === id).length;
    }
    return out;
  });
  const onToggle = (id: RouteId) => {
    const next = useApp.getState().highlightedRoute === id ? null : id;
    useApp.getState().highlightRoute(next);
    frame.renderer?.highlightRoute(next);
  };
  const onMove = (to: RouteId) => {
    const { obs: o, tracked: t } = usePlay.getState();
    const busId = pickBusFor(o ?? useApp.getState().observation, to, t);
    if (!busId) { nudge('No spare bus: every other route is down to one', 'warn'); return; }
    if (issue({ type: 'reassign', vehicleId: busId, to })) nudge(`${busId} moves to ${routeName(to)} at its next terminal`);
  };
  return <LegendView routes={routes} highlighted={highlighted} onToggle={onToggle} onMove={play ? onMove : undefined} style={hudVars(palette)} />;
}
