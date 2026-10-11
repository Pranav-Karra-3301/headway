// Owner: T1c. Finding sentences (spec §8.4 templates, real names from the map) and HUD clock times.
import type { FailureFinding, QueuePlace, RouteId, StationId, StopId, TownMap } from '../contracts';
import { TOWN } from '../map/town';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'HH:MM' = clockStart + whole sim minutes of `t`, wrapping at midnight: clockAt('21:30', 125) → '21:32'. */
export function clockAt(clockStart: string, t: number): string {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(clockStart);
  const start = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const add = Number.isFinite(t) ? Math.floor(t / 60) : 0;
  const mins = (((start + add) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
}

/** 'stop_apts_south' → 'Apts South' (only if a map lacks the id). */
function humanize(id: string): string {
  return id.replace(/^(stop|stn)_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const stopOf = (map: TownMap, id: StopId) => map?.stops?.find((s) => s.id === id);
const stopName = (map: TownMap, id: StopId): string => stopOf(map, id)?.name ?? humanize(id);
const stationName = (map: TownMap, id: StationId): string =>
  map?.rail?.stations?.find((s) => s.id === id)?.name ?? humanize(id);
const placeName = (map: TownMap, at: QueuePlace): string =>
  at.kind === 'stop' ? stopName(map, at.id) : `${stationName(map, at.id)} platform`;
const routeLabel = (r: RouteId): string => `Route ${r.replace(/^r/, '')}`;
const modeLabel = (m: RouteId | 'train'): string => (m === 'train' ? 'the train' : routeLabel(m));
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The §8.4 sentence for `f`, with stop, station and route names from `map`. */
export function sentenceFor(f: FailureFinding, clockStart: string, map: TownMap): string {
  switch (f.kind) {
    case 'service_gap':
      return `${stopName(map, f.stopId)} went ${Math.round(f.gapS / 60)} min without a ${routeLabel(f.routeId)} bus ` +
        `(${clockAt(clockStart, f.fromT)}–${clockAt(clockStart, f.toT)}).`;
    case 'missed_transfer':
      return `${count(f.count, 'rider', 'riders')} reached ${placeName(map, f.at)} from ${modeLabel(f.from)} ` +
        `just after ${modeLabel(f.to)} left.`;
    case 'bunching':
      return `${routeLabel(f.routeId)} buses bunched ${f.events}× (as close as ${Math.round(f.minHeadwayS)} s).`;
    case 'overload': {
      const at = f.at;
      // Name the route only where several routes share the stop (otherwise the template reads as is).
      const shared = at.kind === 'stop' && (stopOf(map, at.id)?.servedRoutes.length ?? 0) > 1;
      const who = f.leftBehind === 1 ? '1 person' : `${f.leftBehind} people`;
      return `${who}${shared ? ` waiting for ${modeLabel(f.routeId)}` : ''} ${f.leftBehind === 1 ? 'was' : 'were'} ` +
        `left behind at ${placeName(map, at)}; the queue peaked at ${f.peakQueue}.`;
    }
    case 'unused_capacity':
      return `${routeLabel(f.routeId)} ran ${Math.round((1 - f.meanLoad) * 100)}% empty while ` +
        `${stopName(map, f.elsewhere.stopId)} queued ${f.elsewhere.queue}.`;
    case 'long_hold':
      return `Holding ${f.vehicleId} ${Math.round(f.holdS)} s at ${stopName(map, f.stopId)} gained ` +
        `${count(f.transfersGained, 'transfer', 'transfers')} but delayed ${count(f.delayedOnboard, 'rider', 'riders')}.`;
  }
}

/** The §8.4 sentence for `f` using the canonical town's names (what RunResult findings carry as `text`). */
export function findingSentence(f: FailureFinding, clockStart: string): string {
  return sentenceFor(f, clockStart, TOWN);
}
