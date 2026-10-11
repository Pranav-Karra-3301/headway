// Owner: T6. JevController, situationText and holdOptions (spec §9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, withConfig } from '../src/config';
import type { Decision, DecisionKind, DecisionPoint, FeatureVector, Observation, Policy, RouteId, StopId, TownMap } from '../src/contracts';
import { JevController, holdOptions, situationText, type DecisionProvider } from '../src/controllers/advisor';
import { PolicyController } from '../src/controllers/policy';
import { createSim, runAsync } from '../src/engine/index';
import { TOWN } from '../src/map/town';
import { G0, REF } from '../src/policy/builtin';
import { validatePolicy } from '../src/policy/schema';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
type Advisor = NonNullable<Policy['advisor']>;
type Req = Parameters<DecisionProvider['choose']>[0];
type Res = Awaited<ReturnType<DecisionProvider['choose']>>;

const INSTRUCTIONS = 'Hold for an arriving train when many riders transfer and the next bus is far behind.';

function withAdvisor(a: Partial<Advisor> = {}, base: Policy = G0): Policy {
  const p = clone(base);
  p.meta.id = `${base.meta.id}-jev`;
  p.advisor = {
    provider: 'jev', enabled: true, askWhen: [{ f: 'train_eta_s', op: '<=', v: 120 }],
    holdOptionsS: [0, 20, 40, 60], instructions: INSTRUCTIONS, ...a,
  };
  return p;
}

/** The spec §9 example situation as a bus_at_stop feature vector. */
function feats(o: Partial<FeatureVector> = {}): FeatureVector {
  return {
    onboard: 18, load_factor: 0.45, queue_here: 3, headway_ahead_s: 240, headway_behind_s: 360,
    target_headway_s: 300, headway_ratio: 0.8, train_eta_s: 34, expected_transfers: 14,
    downstream_queue: 41, hold_used_s: 0, is_station: 1, event_in_s: 9999, ...o,
  } as FeatureVector;
}

let nextDp = 1;
function dpAt(stopId: StopId, routeId: RouteId, f: Partial<FeatureVector> = {}, kind: DecisionKind = 'bus_at_stop'): DecisionPoint {
  return { id: nextDp++, t: 1200, kind, vehicleId: 'b4', stopId, routeId, features: feats(f) };
}

const OBS: Observation = createSim({
  map: TOWN, scenario: { scenarioId: 'stadium_exit', seed: 1001, split: 'train' }, controller: new PolicyController(G0),
}).observe();

function fakeProvider(answer: (req: Req) => Res | Promise<Res>): DecisionProvider & { calls: Req[] } {
  const calls: Req[] = [];
  return { calls, choose: async (req) => { calls.push(req); return answer(req); } };
}
const pick = (probs: number[], index = 0): Res => ({ index, probs, latencyMs: 12 });

afterEach(() => { vi.useRealTimers(); });

// ------------------------------------------------------------------------------------------------ holdOptions
describe('holdOptions', () => {
  const dp = dpAt('stop_university_stn', 'r1');

  it('defaults to [0, 20, 40, 60] with the spec labels', () => {
    const p = clone(G0);
    expect(holdOptions(p, dp, DEFAULT_CONFIG)).toEqual([
      { label: 'Depart now', action: { type: 'continue' } },
      { label: 'Hold 20 s', action: { type: 'hold', seconds: 20 } },
      { label: 'Hold 40 s', action: { type: 'hold', seconds: 40 } },
      { label: 'Hold 60 s', action: { type: 'hold', seconds: 60 } },
    ]);
  });

  it('uses advisor.holdOptionsS, sorted and de-duplicated', () => {
    const p = withAdvisor({ holdOptionsS: [45, 0, 15, 45] });
    expect(holdOptions(p, dp, DEFAULT_CONFIG).map((o) => o.label)).toEqual(['Depart now', 'Hold 15 s', 'Hold 45 s']);
  });

  it('clamps to the policy maxHoldS and the config maxHoldS', () => {
    const p = withAdvisor();
    p.params.maxHoldS = 30;
    expect(holdOptions(p, dp, DEFAULT_CONFIG).map((o) => o.label)).toEqual(['Depart now', 'Hold 20 s', 'Hold 30 s']);
    const q = withAdvisor({ holdOptionsS: [0, 20, 40, 60] });
    const cfg = withConfig({ limits: { ...DEFAULT_CONFIG.limits, maxHoldS: 25 } });
    expect(holdOptions(q, dp, cfg).map((o) => o.label)).toEqual(['Depart now', 'Hold 20 s', 'Hold 25 s']);
  });

  it('clamps to the hold budget left this loop and the 5 s minimum', () => {
    const p = withAdvisor({ holdOptionsS: [0, 2, 20, 40, 60] });
    const used = dpAt('stop_university_stn', 'r1', { hold_used_s: DEFAULT_CONFIG.limits.maxHoldPerLoopS - 30 });
    expect(holdOptions(p, used, DEFAULT_CONFIG).map((o) => o.label)).toEqual(['Depart now', 'Hold 5 s', 'Hold 20 s', 'Hold 30 s']);
    const spent = dpAt('stop_university_stn', 'r1', { hold_used_s: DEFAULT_CONFIG.limits.maxHoldPerLoopS });
    expect(holdOptions(p, spent, DEFAULT_CONFIG)).toEqual([{ label: 'Depart now', action: { type: 'continue' } }]);
  });

  it('offers nothing outside bus_at_stop', () => {
    expect(holdOptions(withAdvisor(), dpAt('stop_central_stn', 'r2', {}, 'bus_at_terminal'), DEFAULT_CONFIG)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ situationText
describe('situationText', () => {
  it('renders the spec §9 example from the features', () => {
    const s = situationText(dpAt('stop_central_stn', 'r2'), OBS);
    expect(s.startsWith('Bus b4 (Route 2) at Central Station.')).toBe(true);
    for (const part of [
      '18 aboard of 40.',
      'Train arrives in 34 s with 14 riders transferring to Route 2.',
      'Next Route 2 bus is 6 min behind.',
      '3 still waiting here; 41 waiting at the next two stops.',
    ]) expect(s).toContain(part);
  });

  it('describes spacing, hold budget, no train, no bus behind and the advertised event', () => {
    const s = situationText(dpAt('stop_stadium_stn', 'r3', {
      train_eta_s: 9999, expected_transfers: 0, headway_behind_s: 3600, headway_ahead_s: 150, target_headway_s: 270,
      hold_used_s: 20, event_in_s: -1800, queue_here: 1,
    }), OBS);
    expect(s.startsWith('Bus b4 (Route 3) at Stadium Station.')).toBe(true);
    expect(s).toContain('No train due here in the next 15 min.');
    expect(s).toContain('No other Route 3 bus is behind this one.');
    expect(s).toContain('Previous Route 3 bus left 2.5 min ago (target spacing 4.5 min).');
    expect(s).toContain('This bus already held 20 s this loop.');
    expect(s).toContain('Event "Stadium closes" was 30 min ago.');
    expect(s).toContain('1 still waiting here');
  });

  it('handles a train at the platform and an upcoming event', () => {
    const s = situationText(dpAt('stop_university_stn', 'r1', { train_eta_s: 0, expected_transfers: 1, event_in_s: 240 }), OBS);
    expect(s).toContain('Train is at the platform now with 1 rider transferring to Route 1.');
    expect(s).toContain('Event "Stadium closes" in 4 min.');
  });

  it('is deterministic and fits the Jev proxy limit (1,500 chars)', () => {
    const dp = dpAt('stop_university_stn', 'r1', { onboard: 40, queue_here: 500, downstream_queue: 1000, expected_transfers: 160 });
    expect(situationText(dp, OBS)).toBe(situationText(clone(dp), clone(OBS)));
    expect(situationText(dp, OBS).length).toBeLessThanOrEqual(1500);
  });
});

// ------------------------------------------------------------------------------------------------ JevController
describe('JevController', () => {
  it('is an async controller that exposes its policy (the engine reads it)', () => {
    const p = withAdvisor();
    const jc = new JevController(p, fakeProvider(() => pick([1, 0, 0, 0])));
    expect(jc.async).toBe(true);
    expect(jc.policy).toBe(p);
    expect(jc.id).toBe('jev:g0-jev');
    expect(jc.model).toBe('typesafe/jev-1.13');
    expect(new JevController(p, Object.assign(fakeProvider(() => pick([1, 0])), { model: 'typesafe/jev-9' })).model).toBe('typesafe/jev-9');
  });

  it('asks only at station stops while askWhen holds; otherwise the rules decide unchanged', async () => {
    const policy = withAdvisor({}, REF);
    const fp = fakeProvider(() => pick([0.1, 0.2, 0.7, 0]));
    const jc = new JevController(policy, fp);
    const rules = new PolicyController(policy);
    const notAsked: DecisionPoint[] = [
      dpAt('stop_downtown', 'r1', { is_station: 0 }),                                // not a station stop
      dpAt('stop_university_stn', 'r1', { train_eta_s: 121 }),                     // askWhen fails
      dpAt('stop_university_stn', 'r1', { train_eta_s: 9999 }),                    // no train
      dpAt('stop_central_stn', 'r2', {}, 'bus_at_terminal'),                        // terminal decision
      { id: 99, t: 1200, kind: 'train_at_station', vehicleId: 'train', stationId: 'stn_central', features: {
        onboard: 80, platform_queue: 12, buses_here_or_due_60s: 1, next_bus_eta_s: 20, transfers_alighted: 4, dwell_s: 30, event_in_s: 9999,
      } },
    ];
    for (const dp of notAsked) expect(await jc.decide(dp, OBS)).toEqual(rules.decide(dp, OBS));
    expect(fp.calls).toHaveLength(0);

    const dp = dpAt('stop_university_stn', 'r1', { train_eta_s: 120 });
    const d = await jc.decide(dp, OBS);
    expect(fp.calls).toEqual([{
      instructions: INSTRUCTIONS, situation: situationText(dp, OBS), options: ['Depart now', 'Hold 20 s', 'Hold 40 s', 'Hold 60 s'],
    }]);
    expect(d).toEqual({ action: { type: 'hold', seconds: 40 }, ruleId: 'jev', explanation: 'Jev chose Hold 40 s (p 0.70)', source: 'jev' });
    expect(jc.stats).toMatchObject({ asked: 1, answered: 1, timeouts: 0, errors: 0, chosen: { 'Hold 40 s': 1 } });
  });

  it('never asks when the advisor is missing or disabled', async () => {
    const fp = fakeProvider(() => pick([0, 1, 0, 0]));
    const dp = dpAt('stop_university_stn', 'r1');
    for (const p of [clone(G0), withAdvisor({ enabled: false })]) {
      expect(await new JevController(p, fp).decide(dp, OBS)).toEqual(new PolicyController(p).decide(dp, OBS));
    }
    expect(fp.calls).toHaveLength(0);
  });

  it('uses the advisor askWhen conditions (all must hold; empty = always at stations)', async () => {
    const fp = fakeProvider(() => pick([0, 1, 0, 0]));
    const jc = new JevController(withAdvisor({ askWhen: [{ f: 'expected_transfers', op: '>=', v: 8 }, { f: 'onboard', op: '<', v: 30 }] }), fp);
    await jc.decide(dpAt('stop_university_stn', 'r1', { expected_transfers: 7, train_eta_s: 10 }), OBS);
    await jc.decide(dpAt('stop_university_stn', 'r1', { expected_transfers: 8, onboard: 30 }), OBS);
    expect(fp.calls).toHaveLength(0);
    await jc.decide(dpAt('stop_university_stn', 'r1', { expected_transfers: 8, onboard: 29, train_eta_s: 600 }), OBS);
    expect(fp.calls).toHaveLength(1);
    const always = new JevController(withAdvisor({ askWhen: [] }), fp);
    await always.decide(dpAt('stop_stadium_stn', 'r3', { train_eta_s: 9999 }), OBS);
    await always.decide(dpAt('stop_downtown', 'r3', { is_station: 0 }), OBS);
    expect(fp.calls).toHaveLength(2);
  });

  it('identifies station stops from the injected map', async () => {
    const map: TownMap = clone(TOWN);
    map.stops.find((s) => s.id === 'stop_downtown')!.stationId = 'stn_central';
    const fp = fakeProvider(() => pick([1, 0, 0, 0]));
    await new JevController(withAdvisor(), fp, { map }).decide(dpAt('stop_downtown', 'r1', { is_station: 0 }), OBS);
    expect(fp.calls).toHaveLength(1);
  });

  it('takes the argmax of the probabilities; ties go to the lowest index', async () => {
    const cases: Array<[number[], number, string]> = [
      [[0.1, 0.4, 0.4, 0.1], 3, 'Jev chose Hold 20 s (p 0.40)'],
      [[0.25, 0.25, 0.25, 0.25], 2, 'Jev chose Depart now (p 0.25)'],
      [[0.02, 0.29, 0.65, 0.04], 0, 'Jev chose Hold 40 s (p 0.65)'],
      [[0, 0, 0, 0.71], 0, 'Jev chose Hold 60 s (p 0.71)'],
    ];
    for (const [probs, index, explanation] of cases) {
      const d = await new JevController(withAdvisor(), fakeProvider(() => pick(probs, index))).decide(dpAt('stop_university_stn', 'r1'), OBS);
      expect(d.explanation).toBe(explanation);
      expect(d.source).toBe('jev');
    }
    const depart = await new JevController(withAdvisor(), fakeProvider(() => pick([0.9, 0.1, 0, 0]))).decide(dpAt('stop_university_stn', 'r1'), OBS);
    expect(depart.action).toEqual({ type: 'continue' });
  });

  it('falls back to the provider index when probabilities are unusable, else to the rules', async () => {
    const dp = dpAt('stop_university_stn', 'r1');
    const byIndex = await new JevController(withAdvisor(), fakeProvider(() => ({ index: 1, probs: [], latencyMs: 5 }))).decide(dp, OBS);
    expect(byIndex).toMatchObject({ action: { type: 'hold', seconds: 20 }, explanation: 'Jev chose Hold 20 s', source: 'jev' });
    const bad = new JevController(withAdvisor(), fakeProvider(() => ({ index: 7, probs: [0, 0, 0, 0], latencyMs: 5 })));
    expect((await bad.decide(dp, OBS)).source).toBe('fallback');
    expect(bad.stats.errors).toBe(1);
  });

  it('falls back to the rules (source fallback) when the provider errors', async () => {
    const policy = withAdvisor({}, REF);
    // REF's anti-bunch rule fires at headway_ratio < 0.4 and downstream_queue < 30: hold to the target headway.
    const dp = dpAt('stop_university_stn', 'r1', { headway_ahead_s: 60, headway_ratio: 0.2, downstream_queue: 10 });
    const rules = new PolicyController(policy).decide(dp, OBS);
    expect(rules.ruleId).toBe('anti-bunch');
    for (const fp of [fakeProvider(() => { throw new Error('boom'); }), { choose: () => { throw new Error('sync boom'); } }]) {
      const jc = new JevController(policy, fp);
      const d = await jc.decide(dp, OBS);
      expect(d).toEqual({ ...rules, source: 'fallback', explanation: `Jev error: ${rules.explanation}` });
      expect(jc.stats.errors).toBe(1);
    }
  });

  it('falls back on timeout (default 800 ms)', async () => {
    vi.useFakeTimers();
    const policy = withAdvisor();
    const jc = new JevController(policy, fakeProvider(() => new Promise<Res>(() => {})));
    const dp = dpAt('stop_university_stn', 'r1');
    let settled: Decision | null = null;
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    void jc.decide(dp, OBS).then((d) => { settled = d; });
    await vi.advanceTimersByTimeAsync(799);
    await flush();
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    const rules = new PolicyController(policy).decide(dp, OBS);
    expect(settled).toEqual({ ...rules, source: 'fallback', explanation: `Jev timed out: ${rules.explanation}` });
    expect(jc.stats.timeouts).toBe(1);
  });

  it('honours opts.timeoutMs and ignores a late answer', async () => {
    let late!: (r: Res) => void;
    const jc = new JevController(withAdvisor(), fakeProvider(() => new Promise<Res>((res) => { late = res; })), { timeoutMs: 10 });
    const d = await jc.decide(dpAt('stop_university_stn', 'r1'), OBS);
    expect(d.source).toBe('fallback');
    late(pick([0, 0, 0, 1]));
    await new Promise((r) => setTimeout(r, 0));
    expect(jc.stats).toMatchObject({ asked: 1, answered: 0, timeouts: 1 });
  });
});

// ------------------------------------------------------------------------------------------------ with the engine
describe('JevController in the engine', () => {
  const scenario = { scenarioId: 'stadium_exit', seed: 1001, split: 'train' as const };

  it('decides station holds in a full run, logs them, and replays without calling Jev', async () => {
    const policy = withAdvisor({ askWhen: [] });
    expect(validatePolicy(policy).ok).toBe(true);
    const fp = fakeProvider((req) => pick(req.options.map((_, i) => (i === 1 ? 0.6 : 0.4 / (req.options.length - 1)))));
    const sim = createSim({ map: TOWN, scenario, controller: new JevController(policy, fp) });
    while (!sim.done) {
      const { pending } = sim.step();
      if (pending) await (sim as unknown as { waitPending(): Promise<void> }).waitPending();
    }
    const res = sim.result();
    expect(fp.calls.length).toBeGreaterThan(0);
    for (const c of fp.calls) {
      expect(c.instructions).toBe(INSTRUCTIONS);
      expect(c.situation).toMatch(/^Bus b\d \(Route [13]\) at (Stadium|University) Station\./);
      expect(c.options[0]).toBe('Depart now');
    }
    expect(res.controller).toEqual({ kind: 'jev', policyId: 'g0-jev', model: 'typesafe/jev-1.13' });
    expect(res.ruleFires.jev).toBe(fp.calls.length);

    const replay = sim.replay();
    expect(replay.decisions?.length).toBeGreaterThan(0);
    const never = fakeProvider(() => { throw new Error('a replay must not call Jev'); });
    const again = await runAsync({ map: TOWN, scenario, controller: new JevController(policy, never), decisions: replay.decisions });
    expect(never.calls).toHaveLength(0);
    expect(again.metrics).toEqual(res.metrics);
    expect(again.hash).toBe(res.hash);
  });
});
