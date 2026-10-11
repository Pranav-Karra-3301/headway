// Minimal contract-shaped Sim for runner/host tests (no engine, no map).
import type { DecisionPoint, Intent, Observation, PassengerInfo, Replay, RunResult, Sim, SimEvent, SimSnapshot } from '@headway/sim';

export interface FakeSim extends Sim {
  steps: number;
  snapshots: number;
  intents: Intent[];
  /** Make step() report a pending decision at these tick numbers. */
  pendingAt: Set<number>;
  /** Events emitted when the clock reaches t; snapshot() drains them. */
  eventsAt: Map<number, SimEvent[]>;
  /** step() throws when the clock reaches this tick. */
  throwAt: number | null;
}

export function fakeSim(opts: { endT?: number } = {}): FakeSim {
  const endT = opts.endT ?? 2700;
  let t = 0;
  let pending: SimEvent[] = [];
  const sim: FakeSim = {
    steps: 0, snapshots: 0, intents: [], pendingAt: new Set(), eventsAt: new Map(), throwAt: null,
    get t() { return t; },
    get done() { return t >= endT; },
    step() {
      if (t >= endT) return { pending: null };
      if (sim.throwAt !== null && t + 1 >= sim.throwAt) throw new Error('engine exploded');
      t += 1; sim.steps += 1;
      const evs = sim.eventsAt.get(t);
      if (evs) pending.push(...evs);
      if (sim.pendingAt.has(t)) {
        const dp: DecisionPoint = { id: t, t, kind: 'bus_at_stop', vehicleId: 'b1', features: {} };
        return { pending: dp };
      }
      return { pending: null };
    },
    resolve() {},
    intent(i) { sim.intents.push(i); },
    observe() { return { t, scenario: { clockStart: '21:30' } } as unknown as Observation; },
    snapshot(): SimSnapshot {
      sim.snapshots += 1;
      const events = pending;
      pending = [];
      return {
        t, phase: t >= endT ? 'done' : 'running', vehicles: [], people: [], queues: [], events,
        running: { spawned: 10, completed: 5, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
      };
    },
    passenger(): PassengerInfo | null { return null; },
    result() { return {} as RunResult; },
    replay() { return {} as Replay; },
  };
  return sim;
}
