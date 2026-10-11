// Engine-internal seams between T1a (engine), T1b (passengers) and T1c (metrics). Frozen after Wave 0b.
import type {
  ControllerRef, DecisionRecord, Itinerary, Leg, PassengerSpec, QueuePlace, RouteId, RunResult,
  RunningMetrics, ScenarioDef, SimConfig, SimEvent, TownMap, Vec2,
} from './contracts';

/** A vehicle "mode" for queueing and boarding: a bus route or the train. */
export type Mode = RouteId | 'train';

// ---------- T1b passengers ----------
export interface TripPlanner {
  /** Choose the itinerary at spawn (spec §5.4). Walk legs use spec.walkSpeed. Pure + deterministic. */
  plan(spec: PassengerSpec): Itinerary;
  /** Patience check (spec §5.4). Return a walk leg from `from` to the destination door if walking now is
   *  cheaper than the remaining plan (+ switchPenaltyS), else null. The engine calls it at most once per passenger. */
  reconsider(spec: PassengerSpec, from: Vec2, waitedS: number, remaining: Leg[]): Extract<Leg, { kind: 'walk' }> | null;
}

// ---------- T1c metrics ----------
export interface CollectorInit {
  map: TownMap; scenario: ScenarioDef; seed: number; cfg: SimConfig;
  targetHeadwayS: (r: RouteId) => number;
}
export interface Collector {
  spawn(pid: number, t: number): void;
  /** Passenger joins a queue. `transferFrom` is the mode they just left (null if they walked from home).
   *  Returns a `missed_connection` event when a vehicle of an accepted mode left this place < missedWindowS ago. */
  queueJoin(pid: number, at: QueuePlace, accepts: Mode[], transferFrom: Mode | null, t: number): SimEvent | null;
  /** Returns a `transfer_made` event when wasTransfer. */
  board(pid: number, vehicleId: string, mode: Mode, at: QueuePlace, t: number, waitedS: number, wasTransfer: boolean): SimEvent | null;
  /** Counted once per (pid, place). Returns a `left_behind` event the first time. */
  leftBehind(pid: number, at: QueuePlace, mode: Mode, t: number): SimEvent | null;
  alight(pid: number, vehicleId: string, at: QueuePlace, t: number): void;
  walkaway(pid: number, at: QueuePlace, t: number): void;
  arrive(pid: number, t: number): void;
  departure(vehicleId: string, mode: Mode, at: QueuePlace, t: number, onboard: number, capacity: number): void;
  hold(vehicleId: string, at: QueuePlace, seconds: number, onboard: number, transfersExpected: number, t: number): void;
  decision(rec: DecisionRecord): void;
  distance(vehicleId: string, du: number, deadhead: boolean): void;
  trainDwell(seconds: number): void;
  /** Engine calls every 30 s for every stop and platform. */
  queueSample(t: number, at: QueuePlace, byMode: Partial<Record<Mode, number>>): void;
  running(): RunningMetrics;
  finalize(
    tEnd: number,
    unfinished: Array<{ pid: number; spawnT: number }>,
    meta: { controller: ControllerRef; simVersion: string; mapVersion: string; scenarioId: string; seed: number },
  ): RunResult;
}
