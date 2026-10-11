// Test fixtures for the HUD: a minimal, contract-shaped Observation / SimSnapshot builder.
import type { Observation, RouteId, SimSnapshot, StopId, VehicleView } from '@headway/sim';

export const STOP_IDS: StopId[] = [
  'stop_stadium_gate', 'stop_stadium_stn', 'stop_university_stn', 'stop_old_main',
  'stop_downtown', 'stop_central_stn', 'stop_apts_north', 'stop_apts_south',
];

type Bus = Observation['buses'][number];
type ObsStop = Observation['stops'][number];

export function bus(id: string, routeId: RouteId, patch: Partial<Bus> = {}): Bus {
  return {
    id, routeId, state: 'moving', onboard: 10, capacity: 40, nextStopId: null, etaNextStopS: null, holdUntil: null,
    headwayAheadS: null, headwayBehindS: null, holdUsedS: 0, ...patch,
  };
}

export function obsAt(t: number, patch: Partial<Observation> = {}): Observation {
  return {
    t,
    phase: t < 1800 ? 'running' : 'clearing',
    scenario: {
      id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900,
      advertised: [{ kind: 'stadium_closing', t: 600, label: 'Stadium closing' }],
    },
    buses: [
      bus('b1', 'r1'), bus('b2', 'r1'), bus('b3', 'r2'), bus('b4', 'r2'), bus('b5', 'r3'), bus('b6', 'r3'),
    ],
    train: {
      state: 'moving', stationId: 'stn_central', etaS: 200, onboard: 40, capacity: 160, departAt: null,
      alightingNext: 10, transfersNext: {}, platformQueue: { stn_stadium: 0, stn_university: 0, stn_central: 0 },
    },
    stops: STOP_IDS.map((id): ObsStop => ({ id, queue: 0, queueByRoute: {}, longestWaitS: 0, lastDepartureT: {} })),
    routes: [
      { id: 'r1', buses: ['b1', 'b2'], targetHeadwayS: 210, queue: 0 },
      { id: 'r2', buses: ['b3', 'b4'], targetHeadwayS: 210, queue: 0 },
      { id: 'r3', buses: ['b5', 'b6'], targetHeadwayS: 240, queue: 0 },
    ],
    running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
    ...patch,
  };
}

/** Returns a copy of `o` with one stop patched. */
export function withStop(o: Observation, id: StopId, patch: Partial<ObsStop>): Observation {
  return { ...o, stops: o.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Returns a copy of `o` with one bus patched. */
export function withBus(o: Observation, id: string, patch: Partial<Bus>): Observation {
  return { ...o, buses: o.buses.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
}

export function vehicle(id: string, patch: Partial<VehicleView> = {}): VehicleView {
  const isTrain = id.startsWith('t');
  return {
    id, kind: isTrain ? 'train' : 'bus', routeId: isTrain ? null : 'r2',
    path: isTrain ? { kind: 'rail' } : { kind: 'route', routeId: 'r2' }, dist: 0,
    state: 'moving', onboard: 10, capacity: isTrain ? 160 : 40, nextStopId: null, holdUntil: null, lastDecision: null,
    ...patch,
  };
}

export function snapAt(t: number, vehicles: VehicleView[] = [], patch: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    t, phase: 'running', vehicles, people: [], queues: [],
    running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
    events: [], ...patch,
  };
}
