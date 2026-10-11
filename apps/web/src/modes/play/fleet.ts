// Owner: P2 (Play UX v2). Pure model for the Fleet board: one lane per route with bus tokens placed by loop progress,
// the stops along the loop with their queues, the depot tray (reserve buses) and the train strip.
// Reads only what the player already sees (Observation + the viewer snapshot's vehicle positions).
import { TOWN } from '@headway/sim';
import type { Observation, RouteId, StopId, TownMap, VehicleState, VehicleView } from '@headway/sim';
import { badgeFor, type TrackedIntent } from './intents';
import { DEPOT_ID, ROUTES, TRAIN_ID, depotOf, fleetFacts } from './logic';

/** Token width as a fraction of the usable lane track (tokens closer than this stack into a second row). */
export const TOKEN_W = 0.15;

export type Tone = 'ok' | 'warn' | 'bad';
export interface BoardToken {
  id: string; x: number; row: 0 | 1; state: VehicleState; load: number; onboard: number; capacity: number;
  holdLeftS: number | null; badge: string | null;
  /** Driving to join this route (deadhead from another route or out of the depot). */
  incoming: boolean;
}
export interface BoardStop { id: StopId; x: number; queue: number; tone: Tone }
export interface BoardLane { id: RouteId; queue: number; tone: Tone; buses: number; tokens: BoardToken[]; stops: BoardStop[] }
export interface BoardDepot { open: boolean; reserves: string[]; leaving: Array<{ id: string; to: RouteId | null }>; badge: string | null; pending: number }
export interface BoardTrain { cars: number; load: number; onboard: number; capacity: number; badge: string | null }
export interface Board { lanes: BoardLane[]; depot: BoardDepot; train: BoardTrain | null }

const WARN_S = 180;
const BAD_S = 420;
const toneOf = (queue: number, waitS: number): Tone => (queue <= 0 || waitS < WARN_S ? 'ok' : waitS < BAD_S ? 'warn' : 'bad');
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

type Bus = Observation['buses'][number];

function progress(b: Bus, view: VehicleView | undefined, map: TownMap | null): number {
  if (b.state === 'layover') return 0;
  const route = map?.routes?.find((r) => r.id === b.routeId);
  if (!route || !(route.path.length > 0)) return 0;
  if (view && view.path.kind === 'route' && view.path.routeId === b.routeId) return clamp01(view.dist / route.path.length);
  const k = b.nextStopId ? route.stops.indexOf(b.nextStopId) : -1;
  return k >= 0 ? clamp01((route.stopDist[k] ?? 0) / route.path.length - 0.03) : 0;
}

/** Greedy two-row packing so bunched buses stay clickable. Mutates `row`. */
export function packRows(tokens: BoardToken[], w = TOKEN_W): BoardToken[] {
  const end: [number, number] = [-Infinity, -Infinity];
  for (const tk of [...tokens].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1))) {
    const row: 0 | 1 = tk.x >= end[0] + w ? 0 : tk.x >= end[1] + w ? 1 : end[0] <= end[1] ? 0 : 1;
    tk.row = row;
    end[row] = tk.x;
  }
  return tokens;
}

export function boardModel(
  obs: Observation | null,
  vehicles: readonly VehicleView[] | undefined,
  tracked: readonly TrackedIntent[],
  map: TownMap | null = (TOWN as TownMap | undefined) ?? null,
): Board {
  const views = new Map<string, VehicleView>();
  for (const v of vehicles ?? []) views.set(v.id, v);
  const depot = depotOf(obs);
  const t = obs?.t ?? 0;
  const pending = tracked.reduce((n, x) => n + (x.status === 'pending' && x.intent.type === 'deploy' ? 1 : 0), 0);

  const lanes: BoardLane[] = ROUTES.map((id) => {
    const route = map?.routes?.find((r) => r.id === id);
    const info = obs?.routes.find((r) => r.id === id);
    const buses = (obs?.buses ?? []).filter((b) => b.routeId === id && b.state !== 'depot' && !depot.reserves.includes(b.id));
    const tokens = buses.map((b): BoardToken => ({
      id: b.id, x: b.state === 'deadhead' ? 0 : progress(b, views.get(b.id), map), row: 0, state: b.state,
      load: clamp01(b.onboard / Math.max(1, b.capacity)), onboard: b.onboard, capacity: b.capacity,
      holdLeftS: b.state === 'holding' && b.holdUntil !== null ? Math.max(0, b.holdUntil - t) : null,
      badge: badgeFor(tracked, b.id), incoming: b.state === 'deadhead',
    }));
    packRows(tokens.filter((tk) => !tk.incoming));
    let k = 0;
    for (const tk of tokens) if (tk.incoming) tk.row = (k++ % 2) as 0 | 1;
    const stops: BoardStop[] = route && route.path.length > 0
      ? route.stops.map((sid, i) => {
        const s = obs?.stops.find((x) => x.id === sid);
        const queue = s?.queueByRoute[id] ?? 0;
        return { id: sid, x: clamp01((route.stopDist[i] ?? 0) / route.path.length), queue, tone: toneOf(queue, s?.longestWaitS ?? 0) };
      })
      : [];
    const worst = stops.reduce<Tone>((w, s) => (s.tone === 'bad' || w === 'bad' ? 'bad' : s.tone === 'warn' || w === 'warn' ? 'warn' : 'ok'), 'ok');
    return { id, queue: info?.queue ?? stops.reduce((n, s) => n + s.queue, 0), tone: worst, buses: info?.buses.length ?? buses.length, tokens, stops };
  });

  const onRoute = new Set((obs?.buses ?? []).map((b) => b.id));
  return {
    lanes,
    depot: {
      open: depot.open,
      reserves: depot.reserves,
      leaving: depot.deploying.filter((id) => !onRoute.has(id)).map((id) => ({ id, to: null })),
      badge: badgeFor(tracked, DEPOT_ID),
      pending,
    },
    train: obs
      ? {
        cars: fleetFacts().cars, load: clamp01(obs.train.onboard / Math.max(1, obs.train.capacity)),
        onboard: obs.train.onboard, capacity: obs.train.capacity, badge: badgeFor(tracked, TRAIN_ID),
      }
      : null,
  };
}
