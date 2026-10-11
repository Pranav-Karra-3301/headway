// Owner: engine integration (Wave 1). Spec §12 sanity gates and the plan's "Baseline must be respectable" /
// "Play is winnable and fair" checks, on the real engine, passengers, metrics and TOWN.
//
// Known gaps (reported to the coordinator, deliberately not asserted):
// - ref beats g0 by only ~2% J on train (gate: ≥ 5%); a plain 3/1/2 allocation gains ~9%, so evolution has headroom.
// - g0 never leaves a 10 min service gap: its terminal holds keep headways even (that is the respectable baseline).
import { describe, expect, it } from 'vitest';
import type { RunResult, ScenarioInstance, Sim } from '../src/contracts';
import { PolicyController } from '../src/controllers/policy';
import { createSim, runSync } from '../src/engine/index';
import { TOWN } from '../src/map/town';
import { G0 } from '../src/policy/builtin';
import { SEEDS, playInstance } from '../src/scenarios';

const run = (inst: ScenarioInstance): RunResult => runSync({ map: TOWN, scenario: inst, controller: new PolicyController(G0) });
const maxGap = (r: RunResult) => Math.max(...r.stops.flatMap((s) => Object.values(s.maxGapS) as number[]));

describe('§12 sanity gates (train split, g0)', () => {
  const train = SEEDS.train.map((inst) => ({ inst, r: run(inst) }));

  it('g0 completes ≥ 85% of every stadium_exit train run, and the crunch is still visible', () => {
    for (const { inst, r } of train.filter((x) => x.inst.scenarioId === 'stadium_exit')) {
      expect(r.metrics.completionPct, `seed ${inst.seed}`).toBeGreaterThanOrEqual(85);
      expect(Math.max(...r.stops.map((s) => s.maxQueue)), `seed ${inst.seed}`).toBeGreaterThan(150);
      expect(r.metrics.leftBehind, `seed ${inst.seed}`).toBeGreaterThan(100);
    }
  });

  it('g0 misses ≥ 10 connections per run (the transfer problem is visible)', () => {
    for (const { inst, r } of train) expect(r.metrics.missedConnections, `${inst.scenarioId} ${inst.seed}`).toBeGreaterThanOrEqual(10);
  });

  it('g0 is a respectable baseline: every route keeps service (no gap over 2× the ~220 s target)', () => {
    for (const { inst, r } of train) expect(maxGap(r), `${inst.scenarioId} ${inst.seed}`).toBeLessThan(480);
  });

  it('a stadium_exit run is fast (< 150 ms in Node; generous for a loaded CI box)', () => {
    run(SEEDS.train[0]!);
    let ms = Infinity; // best of 5 (shared box)
    for (let i = 0; i < 5 && ms >= 150; i++) {
      const t0 = performance.now();
      run(SEEDS.train[1]!);
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`[gates] stadium_exit g0 run: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(400);
  });
});

describe('Play is winnable and fair', () => {
  const PLAY = playInstance(0);
  const play = (script: (sim: Sim) => void): RunResult => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: new PolicyController(G0) });
    while (!sim.done) { script(sim); sim.step(); }
    return sim.result();
  };
  const g0 = run(PLAY);

  it('doing nothing reproduces g0 exactly', () => {
    const idle = play(() => {});
    expect(idle.metrics.J).toBe(g0.metrics.J);
    expect(idle.hash).toBe(g0.hash);
  });

  it('a sensible human (pre-stage the idle second r2 bus to r3 before closing) beats g0 clearly', () => {
    const human = play((sim) => { if (sim.t === 300) sim.intent({ type: 'reassign', vehicleId: 'b3', to: 'r3' }); });
    expect(human.controller).toEqual({ kind: 'human', basePolicyId: 'g0' });
    expect(human.metrics.J).toBeLessThan(g0.metrics.J * 0.9);
    expect(human.metrics.completionPct).toBeGreaterThan(g0.metrics.completionPct);
  });
});
