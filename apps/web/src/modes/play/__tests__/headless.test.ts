import { describe, expect, it } from 'vitest';
import type { Controller, Policy, RunResult, ScenarioInstance, Sim } from '@headway/sim';
import { runHeadless, runJob } from '../headless';

/** A fake sim: done after `end` ticks; jSoFar grows by t each tick. */
function fakeSim(end: number, label = 'x'): Sim & { observed: number } {
  let t = 0;
  let j = 0;
  const s = {
    observed: 0,
    get t() { return t; },
    get done() { return t >= end; },
    step() { t += 1; j += t; return { pending: null }; },
    resolve() {},
    intent() {},
    observe() {
      s.observed += 1;
      return { t, running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: j } } as never;
    },
    snapshot() { return { t } as never; },
    passenger() { return null; },
    result() { return { scenarioId: label, metrics: { J: j } } as unknown as RunResult; },
    replay() { return {} as never; },
  };
  return s;
}

describe('runHeadless', () => {
  it('samples jSoFar every N sim-seconds plus the start and the end', () => {
    const sim = fakeSim(100);
    const out = runHeadless(() => sim, 30);
    expect(out.samples.map((p) => p.t)).toEqual([0, 30, 60, 90, 100]);
    // j at t = 30 is 1 + 2 + … + 30
    expect(out.samples[1]!.j).toBe(465);
    expect(out.result.metrics.J).toBe(5050);
    expect(sim.observed).toBe(5); // observe() only at sample points, never per tick
  });
});

describe('runJob', () => {
  const policy = (id: string) => ({ meta: { id } }) as unknown as Policy;
  const scenario: ScenarioInstance = { scenarioId: 'stadium_exit', seed: 50000, split: 'play' };

  it('runs each requested policy on the same scenario and labels the runs', () => {
    const seen: string[] = [];
    const runs = runJob(
      { id: 7, scenario, sampleEveryS: 30, runs: [{ who: 'champion', policy: policy('g5') }, { who: 'baseline', policy: policy('g0') }] },
      {
        makeController: (p) => ({ id: p.meta.id, decide: () => { throw new Error('unused'); } }) as Controller,
        createSim: (a) => { seen.push(`${a.controller.id}@${a.scenario.seed}`); return fakeSim(60, a.controller.id); },
      },
    );
    expect(seen).toEqual(['g5@50000', 'g0@50000']);
    expect(runs.map((r) => [r.who, r.policyId, r.result.scenarioId, r.samples.length])).toEqual([
      ['champion', 'g5', 'g5', 3],
      ['baseline', 'g0', 'g0', 3],
    ]);
  });
});
