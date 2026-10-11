// Owner: T3b. Route chips (bottom-left) that toggle the renderer's route highlight, with live bus/queue counts.
import type { CSSProperties } from 'react';
import type { RouteId } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { ROUTE_IDS, hudVars, routeColor, routeName } from './format';
import './hud.css';

export interface LegendRoute { id: RouteId; name: string; color: string; buses: number | null; queue: number | null }

export interface LegendViewProps {
  routes: LegendRoute[];
  highlighted: RouteId | null;
  onToggle(id: RouteId): void;
  style?: CSSProperties;
}

const busesLabel = (n: number) => `${n} ${n === 1 ? 'bus' : 'buses'}`;

export function LegendView({ routes, highlighted, onToggle, style }: LegendViewProps) {
  return (
    <div className="hud-root hud-surface hud-legend" style={style} role="group" aria-label="Routes">
      <div className="hud-legend-head">
        <span className="hud-label">Routes</span>
        <span className="hud-legend-hint">{highlighted ? 'click again to clear' : 'click to highlight'}</span>
      </div>
      {routes.map((r) => {
        const meta = [r.buses == null ? null : busesLabel(r.buses), r.queue == null ? null : `${r.queue} waiting`]
          .filter(Boolean).join(' · ');
        return (
          <button key={r.id} type="button" className="hud-route" aria-pressed={highlighted === r.id}
            data-dim={highlighted !== null && highlighted !== r.id} style={{ '--rc': r.color } as CSSProperties}
            onClick={() => onToggle(r.id)}>
            <span className="hud-route-sw">{r.id.slice(1)}</span>
            <span className="hud-route-text">
              <span className="hud-route-name">{r.name}</span>
              {meta && <span className="hud-route-meta">{meta}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function RouteLegend() {
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);
  const highlighted = useApp((s) => s.highlightedRoute);
  const obs = useApp((s) => s.observation);
  if (mode === 'lab') return null;
  const routes: LegendRoute[] = ROUTE_IDS.map((id) => {
    const r = obs?.routes.find((x) => x.id === id);
    return {
      id, name: routeName(id), color: routeColor(id, palette),
      buses: r ? r.buses.length : obs ? obs.buses.filter((b) => b.routeId === id).length : null,
      queue: r ? r.queue : null,
    };
  });
  const onToggle = (id: RouteId) => {
    const next = useApp.getState().highlightedRoute === id ? null : id;
    useApp.getState().highlightRoute(next);
    frame.renderer?.highlightRoute(next);
  };
  return <LegendView routes={routes} highlighted={highlighted} onToggle={onToggle} style={hudVars(palette)} />;
}
