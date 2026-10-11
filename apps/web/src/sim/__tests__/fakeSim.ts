// Minimal contract-shaped Sim for runner/host tests (no engine, no map).
import type { DecisionPoint, Intent, Observation, PassengerInfo, Replay, RunResult, Sim, SimSnapshot } from '@headway/sim';

export interface FakeSim extends Sim {
  steps: number;
  snapshots: number;
  intents: Intent[];
  /** Make step() report a pending decision at these tick numbers. */
  pendingAt: Set<number>;
}

export function fakeSim(opts: { endT?: number } = {}): FakeSim {
  const endT = opts.endT ?? 2700;
  let t = 0;
  const sim: FakeSim = {
    steps: 0, snapshots: 0, intents: [], pendingAt: new Set(),
    get t() { return t; },
    get done() { return t >= endT; },
    step() {
      if (t >= endT) return { pending: null };
      t += 1; sim.steps += 1;
      if (sim.pendingAt.has(t)) {
        const dp: DecisionPoint = { id: t, t, kind: 'bus_at_stop', vehicleId: 'b1', features: {} };
        return { pending: dp };
      }
      return { pending: null };
    },
    resolve() {},
    intent(i) { sim.intents.push(i); },
    observe() { return { t } as unknown as Observation; },
    snapshot(): SimSnapshot {
      sim.snapshots += 1;
      return {
        t, phase: t >= endT ? 'done' : 'running', vehicles: [], people: [], queues: [], events: [],
        running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
      };
    },
    passenger(): PassengerInfo | null { return null; },
    result() { return {} as RunResult; },
    replay() { return {} as Replay; },
  };
  return sim;
}
