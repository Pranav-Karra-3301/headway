// Owner: T3c. Small shared bits for the Play UI: icons, a springy number ticker, map names with fallbacks.
import { TOWN, scenarioDef } from '@headway/sim';
import type { RouteId, StationId, StopId } from '@headway/sim';

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const BusIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="4" y="4" width="16" height="13" rx="3" /><path d="M4 11h16M8 20v-3M16 20v-3" /></svg>
);
export const TrainIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="5" y="3.5" width="14" height="13" rx="4" /><path d="M5 10h14M9 20l-2 1.5M15 20l2 1.5M9 13.5h.01M15 13.5h.01" /></svg>
);
export const ClockIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const ScaleIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M12 4v16M6 20h12M5 8h14M5 8l-2.5 6a3.5 3.5 0 0 0 5 0L5 8Zm14 0-2.5 6a3.5 3.5 0 0 0 5 0L19 8Z" /></svg>
);
export const FastIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M4 6.5v11l7-5.5-7-5.5Zm8 0v11l7-5.5-7-5.5Z" /></svg>
);
export const PlayIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} width={14} height={14} strokeWidth={2.6} aria-hidden="true"><path d="M5 12.5l4.2 4L19 7" /></svg>
);
export const EyeIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></svg>
);
export const AgainIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8" /></svg>
);

// ---------- names ----------
const FALLBACK_ROUTES: Record<RouteId, string> = { r1: 'Campus loop', r2: 'Downtown loop', r3: 'Stadium loop' };
const pretty = (id: string) => id.replace(/^(stop|stn)_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function routeName(id: RouteId): string {
  return TOWN?.routes?.find((r) => r.id === id)?.name ?? FALLBACK_ROUTES[id] ?? id;
}
export function stopName(id: StopId | null | undefined): string {
  if (!id) return '';
  return TOWN?.stops?.find((s) => s.id === id)?.name ?? pretty(id);
}
export function stationName(id: StationId | null | undefined): string {
  if (!id) return '';
  return TOWN?.rail?.stations?.find((s) => s.id === id)?.name ?? pretty(id);
}

/** Advertised closing time (sim seconds) and crowd size for the play scenario, with spec defaults. */
export function playFacts(scenarioId: string): { closingT: number; crowd: number; clockStart: string; name: string } {
  try {
    const d = scenarioDef(scenarioId);
    const closing = d.advertised.find((a) => a.kind === 'stadium_closing') ?? d.advertised[0];
    return {
      closingT: closing?.t ?? 600,
      crowd: d.demand.reduce((n, g) => n + g.total, 0),
      clockStart: d.clockStart,
      name: d.name,
    };
  } catch {
    return { closingT: 600, crowd: 1500, clockStart: '21:30', name: 'Stadium exit' };
  }
}
