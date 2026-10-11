// Human intents (spec §5.6) and replays.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DecisionRecord, ScenarioInstance, Sim, SimEvent } from '../src/contracts';
import { PolicyController } from '../src/controllers/policy';
import { __setEngineTestHooks, createSim, runSync } from '../src/engine/index';
import { TOWN } from '../src/map/town';
import { G0 } from '../src/policy/builtin';
import { engineHooks } from './fakes';

const PLAY: ScenarioInstance = { scenarioId: 'stadium_exit', seed: 50000, split: 'play' };
const g0 = () => new PolicyController(G0);

beforeEach(() => __setEngineTestHooks(engineHooks()));
afterEach(() => __setEngineTestHooks(null));

/** Steps until `pred` holds for a fresh decision record (returns it), collecting events. */
function stepUntilDecision(sim: Sim, pred: (r: DecisionRecord) => boolean, maxSteps = 2700): DecisionRecord {
  for (let i = 0; i < maxSteps && !sim.done; i++) {
    sim.step();
    for (const e of sim.snapshot().events) if (e.kind === 'decision' && pred(e.record)) return e.record;
  }
  throw new Error('no matching decision');
}
const eventsOf = (sim: Sim): SimEvent[] => sim.snapshot().events;

describe('intents', () => {
  it('a hold for a moving bus applies at its next bus_at_stop (source human)', () => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    while (sim.observe().buses.find((b) => b.id === 'b3')!.state !== 'moving') sim.step();
    eventsOf(sim);
    sim.intent({ type: 'hold', vehicleId: 'b3', seconds: 30 });
    const rec = stepUntilDecision(sim, (r) => r.vehicleId === 'b3' && r.kind === 'bus_at_stop');
    expect(rec).toMatchObject({ source: 'human', ruleId: 'human', action: { type: 'hold', seconds: 30 } });
    expect(sim.observe().buses.find((b) => b.id === 'b3')).toMatchObject({ state: 'holding', holdUntil: rec.t + 30 });
  });

  it('a hold while the bus dwells at a stop applies now (holdUntil = t + seconds, clamped)', () => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    let id = '';
    while (!id) {
      sim.step();
      const v = sim.snapshot().vehicles.find((x) => x.kind === 'bus' && x.state === 'dwelling' && x.dist > 1);
      if (v) id = v.id;
    }
    const t = sim.t;
    sim.intent({ type: 'hold', vehicleId: id, seconds: 500 });
    sim.step();
    const rec = eventsOf(sim).flatMap((e) => (e.kind === 'decision' ? [e.record] : [])).find((r) => r.vehicleId === id)!;
    expect(rec).toMatchObject({ kind: 'bus_at_stop', source: 'human', action: { type: 'hold', seconds: 60 } }); // g0 maxHoldS
    expect(rec.dpId).toBeLessThan(0);
    expect(sim.observe().buses.find((b) => b.id === id)).toMatchObject({ state: 'holding', holdUntil: t + 60 });
  });

  it('dispatch applies now to a bus holding at its terminal', () => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    sim.step(); // t=0: b2 holds toward the target headway
    expect(sim.observe().buses.find((b) => b.id === 'b2')!.state).toBe('holding');
    eventsOf(sim);
    sim.intent({ type: 'dispatch', vehicleId: 'b2' });
    sim.step();
    const rec = eventsOf(sim).flatMap((e) => (e.kind === 'decision' ? [e.record] : [])).find((r) => r.vehicleId === 'b2')!;
    expect(rec).toMatchObject({ kind: 'bus_at_terminal', source: 'human', action: { type: 'dispatch' } });
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.observe().buses.find((b) => b.id === 'b2')!.state).toBe('moving');
    // dispatch is ignored for a bus that is not at a terminal
    sim.intent({ type: 'dispatch', vehicleId: 'b2' });
    sim.step();
    expect(eventsOf(sim).some((e) => e.kind === 'decision' && e.record.vehicleId === 'b2' && e.record.source === 'human')).toBe(false);
  });

  it('a reassign applies at the bus\'s next terminal and deadheads it to the new route', () => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.observe().buses.find((b) => b.id === 'b1')!.state).toBe('moving');
    eventsOf(sim);
    sim.intent({ type: 'reassign', vehicleId: 'b1', to: 'r3' });
    const rec = stepUntilDecision(sim, (r) => r.vehicleId === 'b1' && r.kind === 'bus_at_terminal');
    expect(rec).toMatchObject({ source: 'human', action: { type: 'reassign', to: 'r3' } });
    const v = sim.snapshot().vehicles.find((x) => x.id === 'b1')!;
    expect(v).toMatchObject({ state: 'deadhead', routeId: 'r3', path: { kind: 'deadhead', from: 'r1', to: 'r3' } });
    const obs = sim.observe();
    expect(obs.routes.find((r) => r.id === 'r3')!.buses).toEqual(['b1', 'b5', 'b6']);
  });

  it('setTrainDeparture applies now while the train dwells, otherwise at the next station', () => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    sim.step();
    expect(sim.observe().train).toMatchObject({ state: 'dwelling', departAt: 45 });
    sim.intent({ type: 'setTrainDeparture', dwellS: 90 });
    sim.step();
    expect(sim.observe().train.departAt).toBe(90);
    while (sim.observe().train.state !== 'moving') sim.step();
    eventsOf(sim);
    sim.intent({ type: 'setTrainDeparture', dwellS: 200 });
    const rec = stepUntilDecision(sim, (r) => r.kind === 'train_at_station' && r.dpId > 0);
    expect(rec).toMatchObject({ source: 'human', action: { type: 'setTrainDeparture', dwellS: 120 } });
  });
});

describe('replays', () => {
  function playWithIntents() {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: g0() });
    while (!sim.done) {
      if (sim.t === 100) sim.intent({ type: 'hold', vehicleId: 'b3', seconds: 40 });
      if (sim.t === 300) sim.intent({ type: 'reassign', vehicleId: 'b1', to: 'r3' });
      if (sim.t === 650) sim.intent({ type: 'setTrainDeparture', dwellS: 90 });
      if (sim.t === 800) sim.intent({ type: 'hold', vehicleId: 'b4', seconds: 25 });
      if (sim.t === 900) sim.intent({ type: 'dispatch', vehicleId: 'b2' });
      sim.step();
    }
    return sim;
  }

  it('run with intents → replay() → re-run gives the same hash', () => {
    const sim = playWithIntents();
    const res = sim.result();
    const rep = sim.replay();
    expect(rep).toMatchObject({ scenarioId: 'stadium_exit', seed: 50000, simVersion: '1', mapVersion: TOWN.version, controller: { kind: 'human', basePolicyId: 'g0' } });
    expect(rep.intents!.map((x) => x.t)).toEqual([100, 300, 650, 800, 900]);
    expect(rep.decisions).toBeUndefined();
    const again = createSim({ map: TOWN, scenario: PLAY, controller: g0(), intents: rep.intents });
    while (!again.done) again.step();
    expect(again.result().hash).toBe(res.hash);
    expect(again.replay().intents).toEqual(rep.intents);
    const headless = runSync({ map: TOWN, scenario: PLAY, controller: g0(), intents: rep.intents });
    expect(headless.hash).toBe(res.hash);
    expect(headless.controller).toEqual({ kind: 'human', basePolicyId: 'g0' });
    const baseline = runSync({ map: TOWN, scenario: PLAY, controller: g0() });
    expect(res.hash).not.toBe(baseline.hash);
  });

  it('doing nothing reproduces g0 exactly', () => {
    const baseline = runSync({ map: TOWN, scenario: PLAY, controller: g0() });
    const idle = createSim({ map: TOWN, scenario: PLAY, controller: g0(), intents: [] });
    while (!idle.done) idle.step();
    expect(idle.result().hash).toBe(baseline.hash);
    expect(idle.result().metrics.J).toBe(baseline.metrics.J);
    expect(idle.replay().controller).toEqual({ kind: 'policy', policyId: 'g0' });
  });
});
