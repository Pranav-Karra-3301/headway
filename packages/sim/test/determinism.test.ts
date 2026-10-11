import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioInstance } from '../src/contracts';
import { PolicyController } from '../src/controllers/policy';
import { __setEngineTestHooks, createSim, runSync } from '../src/engine/index';
import { TOWN } from '../src/map/town';
import { G0, REF } from '../src/policy/builtin';
import { engineHooks } from './fakes';

const SE: ScenarioInstance = { scenarioId: 'stadium_exit', seed: 1001, split: 'train' };

beforeEach(() => __setEngineTestHooks(engineHooks()));
afterEach(() => __setEngineTestHooks(null));

describe('determinism', () => {
  it('two runs of stadium_exit seed 1001 with g0 give the identical hash', () => {
    const a = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    const b = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    expect(b.hash).toBe(a.hash);
    expect(b.metrics).toEqual(a.metrics);
    expect(b.findings).toEqual(a.findings);
    expect(b.ruleFires).toEqual(a.ruleFires);
  });

  it('class_change is deterministic too, and seeds / controllers change the outcome', () => {
    const cc = { ...SE, scenarioId: 'class_change' };
    const a = runSync({ map: TOWN, scenario: cc, controller: new PolicyController(G0) });
    const b = runSync({ map: TOWN, scenario: cc, controller: new PolicyController(G0) });
    expect(b.hash).toBe(a.hash);
    const other = runSync({ map: TOWN, scenario: { ...SE, seed: 1002 }, controller: new PolicyController(G0) });
    const base = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    expect(other.hash).not.toBe(base.hash);
    const ref = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(REF) });
    expect(ref.metrics.spawned).toBe(base.metrics.spawned); // identical crowd for every controller
    expect(ref.hash).not.toBe(base.hash);
  });

  it('observing (snapshot / observe / passenger) never perturbs the run', () => {
    const quiet = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    const sim = createSim({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    while (!sim.done) {
      sim.step();
      if (sim.t % 7 === 0) { sim.snapshot(); sim.observe(); sim.passenger(sim.t % 500); }
    }
    expect(sim.result().hash).toBe(quiet.hash);
    expect(sim.result()).toBe(sim.result()); // cached once done
    expect(sim.snapshot().phase).toBe('done');
    expect(sim.step()).toEqual({ pending: null });
  });
});
