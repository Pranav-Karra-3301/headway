// Owner: T3b. Pure HUD helpers: names (town map first, spec fallbacks), colours, time and number formatting.
import { TOWN } from '@headway/sim';
import type { Action, QueuePlace, RouteId, StationId, StopId, TownMap, VehicleState } from '@headway/sim';
import { PALETTES } from '../../render/palettes';
import type { PaletteId } from '../../render/types';

export type Severity = 'ok' | 'warn' | 'bad';
/** Queue severity thresholds (spec §10): ok < 180 s ≤ warn < 420 s ≤ bad. */
export const WARN_S = 180;
export const BAD_S = 420;
export const severityOf = (waitS: number): Severity => (waitS < WARN_S ? 'ok' : waitS < BAD_S ? 'warn' : 'bad');

export const ROUTE_IDS: readonly RouteId[] = ['r1', 'r2', 'r3'];
export const STATION_IDS: readonly StationId[] = ['stn_stadium', 'stn_university', 'stn_central'];

const STOP_NAMES: Record<StopId, string> = {
  stop_stadium_gate: 'Stadium Gate', stop_stadium_stn: 'Stadium Station', stop_university_stn: 'University Station',
  stop_old_main: 'Old Main', stop_downtown: 'Downtown', stop_central_stn: 'Central Station',
  stop_apts_north: 'Apartments North', stop_apts_south: 'Apartments South',
};
const STATION_NAMES: Record<StationId, string> = { stn_stadium: 'Stadium', stn_university: 'University', stn_central: 'Central' };
const ROUTE_NAMES: Record<RouteId, string> = { r1: 'Campus Loop', r2: 'Apartments', r3: 'Stadium' };
/** Spec §4 pairing, used until the town map is loaded. */
const STOP_STATION: Partial<Record<StopId, StationId>> = {
  stop_stadium_stn: 'stn_stadium', stop_university_stn: 'stn_university', stop_central_stn: 'stn_central',
};

/** The canonical town, or null while Task M's map is still a stub. */
export function townMap(): TownMap | null {
  const m = TOWN as Partial<TownMap> | undefined;
  return m && Array.isArray(m.stops) && m.stops.length > 0 ? (m as TownMap) : null;
}

/** "stop_apts_south" → "Apts South"; strips a stop_/stn_/zone_ prefix. */
export function humanize(id: string): string {
  return id
    .replace(/^(stop|stn|zone)_/, '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function stopName(id: StopId, map: TownMap | null = townMap()): string {
  return map?.stops?.find((s) => s.id === id)?.name ?? STOP_NAMES[id] ?? humanize(id);
}
export function stationName(id: StationId, map: TownMap | null = townMap()): string {
  return map?.rail?.stations?.find((s) => s.id === id)?.name ?? STATION_NAMES[id] ?? humanize(id);
}
export function routeName(id: RouteId, map: TownMap | null = townMap()): string {
  return map?.routes?.find((r) => r.id === id)?.name ?? ROUTE_NAMES[id] ?? id;
}
export function zoneName(id: string, map: TownMap | null = townMap()): string {
  return map?.zones?.find((z) => z.id === id)?.name ?? humanize(id);
}
export function placeName(at: QueuePlace, map: TownMap | null = townMap()): string {
  return at.kind === 'stop' ? stopName(at.id, map) : `${stationName(at.id, map)} platform`;
}
/** The station paired with a bus stop, if any. */
export function stationOfStop(id: StopId, map: TownMap | null = townMap()): StationId | null {
  const fromMap = map?.stops?.find((s) => s.id === id);
  if (fromMap) return fromMap.stationId ?? null;
  return STOP_STATION[id] ?? null;
}
/** Stations in rail travel order. */
export function stationOrder(map: TownMap | null = townMap()): StationId[] {
  const st = map?.rail?.stations;
  return st && st.length ? st.map((s) => s.id) : [...STATION_IDS];
}

/** Route colour from the renderer palette (index = route order), so chips match the ribbons. */
export function routeColor(id: RouteId, palette: PaletteId): string {
  const i = ROUTE_IDS.indexOf(id);
  return PALETTES[palette]?.route[i] ?? PALETTES.a.route[i] ?? '#888888';
}

/** CSS custom properties that theme every HUD root from the active palette. */
export function hudVars(palette: PaletteId): Record<string, string> {
  const p = PALETTES[palette] ?? PALETTES.a;
  return {
    '--hud-ink': p.ink, '--hud-paper': p.paper, '--hud-accent': p.accent, '--hud-bg': p.bg,
    '--hud-r1': p.route[0] ?? '#1FA99A', '--hud-r2': p.route[1] ?? '#F0A830', '--hud-r3': p.route[2] ?? '#8A6BD8',
    '--hud-train': p.train,
  };
}

// ---------- time & numbers ----------
const int = (s: number) => Math.max(0, Math.floor(s));

/** 125 → "2:05". Minutes are not wrapped into hours. */
export function mmss(s: number): string {
  const v = int(s);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
/** Compact wait for queue markers: "45s" under a minute, else whole minutes "3m". */
export function waitShort(s: number): string {
  const v = int(s);
  return v < 60 ? `${v}s` : `${Math.floor(v / 60)}m`;
}
/** Minutes, rounded up, for durations: 150 → "3 min". */
export function minutes(s: number): string {
  return `${Math.max(1, Math.ceil(s / 60))} min`;
}
/** Scenario wall clock: clockStart "21:30" + t seconds → "21:41" (whole minutes, wraps midnight). */
export function localClock(clockStart: string, t: number): string {
  const [h, m] = clockStart.split(':').map((x) => Number.parseInt(x, 10));
  const total = ((((h || 0) * 60 + (m || 0) + Math.floor(Math.max(0, t) / 60)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
/** Passenger-seconds → passenger-hours with one decimal. */
export const paxH = (s: number): string => (s / 3600).toFixed(1);
/** Signed number with a true minus sign: +6.2 / −3.1 / ±0.0. */
export function signed(n: number, digits = 1): string {
  const r = Number(n.toFixed(digits));
  const body = Math.abs(r).toFixed(digits);
  return r > 0 ? `+${body}` : r < 0 ? `−${body}` : `±${body}`;
}
export const pct = (x: number): string => `${Math.round(x)}%`;

export function actionLabel(a: Action): string {
  switch (a.type) {
    case 'continue': return 'Continue';
    case 'dispatch': return 'Dispatch';
    case 'hold': return 'seconds' in a ? `Hold ${Math.round(a.seconds)} s` : 'Hold to headway';
    case 'reassign': return `Reassign to ${a.to}`;
    case 'setTrainDeparture': return `Train dwell ${Math.round(a.dwellS)} s`;
  }
}

const STATE_LABELS: Record<VehicleState, string> = {
  layover: 'Layover', moving: 'Moving', dwelling: 'At stop', holding: 'Holding', deadhead: 'Deadheading',
};
export const stateLabel = (s: VehicleState): string => STATE_LABELS[s] ?? humanize(s);
