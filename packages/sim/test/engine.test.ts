import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Action, AsyncController, Controller, Decision, DecisionKind, DecisionPoint, DecisionRecord, Observation, Policy,
  QueuePlace, ScenarioInstance, Sim, SimEvent,
} from '../src/contracts';
import type { Collector, CollectorInit } from '../src/internal';
import { DEFAULT_CONFIG } from '../src/config';
import { PolicyController } from '../src/controllers/policy';
import { __setEngineTestHooks, computeFeatures, createSim, runAsync, runSync } from '../src/engine/index';
import type { EngineTestHooks } from '../src/engine/engine';
import { TOWN, routeById } from '../src/map/town';
import { createCollector } from '../src/metrics/index';
import { EXAMPLE_G3, G0, REF } from '../src/policy/builtin';
import { FEATURES } from '../src/policy/features';
import { engineHooks, realModules } from './fakes';

const SE: ScenarioInstance = { scenarioId: 'stadium_exit', seed: 1001, split: 'train' };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeEach(() => __setEngineTestHooks(engineHooks()));
afterEach(() => __setEngineTestHooks(null));

/** Wraps whatever collector the hooks use and logs hold / departure calls. */
function withSpy(base: EngineTestHooks = engineHooks()) {
  const log = {
    holds: [] as Array<{ vehicleId: string; at: QueuePlace; seconds: number; t: number }>,
    departures: [] as Array<{ vehicleId: string; mode: string; at: QueuePlace; t: number; onboard: number }>,
  };
  const make = base.collector ?? createCollector;
  const hooks: EngineTestHooks = {
    ...base,
    collector: (init: CollectorInit): Collector => {
      const c = make(init);
      return new Proxy(c, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            if (prop === 'hold') log.holds.push({ vehicleId: args[0] as string, at: args[1] as QueuePlace, seconds: args[2] as number, t: args[5] as number });
            if (prop === 'departure') log.departures.push({ vehicleId: args[0] as string, mode: args[1] as string, at: args[2] as QueuePlace, t: args[3] as number, onboard: args[4] as number });
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    },
  };
  __setEngineTestHooks(hooks);
  return log;
}

/** Steps a sim to the end (or `until`), collecting every event. */
function drive(sim: Sim, until = Infinity): SimEvent[] {
  const events: SimEvent[] = [];
  while (!sim.done && sim.t < until) {
    sim.step();
    if (sim.t % 100 === 0) events.push(...sim.snapshot().events);
  }
  events.push(...sim.snapshot().events);
  return events;
}
const decisions = (ev: SimEvent[]): DecisionRecord[] => ev.flatMap((e) => (e.kind === 'decision' ? [e.record] : []));

/** A sync controller that answers with fixed actions per kind (and carries a policy for allocation/params). */
function fixed(actions: Partial<Record<DecisionKind, (dp: DecisionPoint) => Action>>, policy: Policy = clone(G0)): Controller & { policy: Policy; seen: DecisionPoint[] } {
  const seen: DecisionPoint[] = [];
  const base = new PolicyController(policy);
  return {
    id: 'fixed', policy, seen,
    decide(dp: DecisionPoint, obs: Observation): Decision {
      seen.push(dp);
      const f = actions[dp.kind];
      if (!f) return base.decide(dp, obs);
      return { action: f(dp), ruleId: 'fixed', explanation: 'fixed', source: 'policy' };
    },
  };
}

describe('engine: a full run', () => {
  it('runs stadium_exit with g0 end to end through the collector', () => {
    const t0 = performance.now();
    const r = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    const ms = performance.now() - t0;
    console.log(`[engine] stadium_exit g0 seed 1001: ${ms.toFixed(0)} ms; real modules ${JSON.stringify(realModules())}; ` +
      `spawned ${r.metrics.spawned} completed ${r.metrics.completed} (${r.metrics.completionPct.toFixed(1)}%) J ${r.metrics.J} ` +
      `meanWait ${r.metrics.meanWaitS.toFixed(0)} missed ${r.metrics.missedConnections} leftBehind ${r.metrics.leftBehind} walkaways ${r.metrics.walkaways}`);
    expect(r.scenarioId).toBe('stadium_exit');
    expect(r.seed).toBe(1001);
    expect(r.controller).toEqual({ kind: 'policy', policyId: 'g0' });
    expect(r.metrics.spawned).toBeGreaterThan(1000);
    expect(r.metrics.completed).toBeGreaterThan(r.metrics.spawned * 0.3);
    expect(r.metrics.effort.busDistanceU).toBeGreaterThan(1000);
    expect(r.metrics.effort.trainDwellS).toBeGreaterThan(0);
    expect(r.ruleFires['even-headway'] ?? 0).toBeGreaterThan(0);
    expect(r.ruleFires.default ?? 0).toBeGreaterThan(0);
    expect(typeof r.hash).toBe('string');
  });

  it('stadium_exit with g0 runs fast (< 400 ms in vitest)', () => {
    runSync({ map: TOWN, scenario: { ...SE, seed: 1002 }, controller: new PolicyController(G0) }); // warm-up
    let ms = Infinity; // best of 5: the box is shared with many agents
    for (let i = 0; i < 5 && ms >= 150; i++) {
      const t0 = performance.now();
      runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`[perf] stadium_exit g0 full run: ${ms.toFixed(1)} ms (target 150)`);
    expect(ms).toBeLessThan(400);
  });

  it('runs ref, the §6 example and class_change without errors', () => {
    for (const [p, scenarioId] of [[REF, 'stadium_exit'], [EXAMPLE_G3, 'stadium_exit'], [G0, 'class_change']] as const) {
      const r = runSync({ map: TOWN, scenario: { ...SE, scenarioId }, controller: new PolicyController(p) });
      expect(r.metrics.completed).toBeGreaterThan(0);
    }
  });
});

describe('engine: decision points', () => {
  it('carry exactly the §6 whitelist with in-range values', () => {
    const ctl = fixed({});
    runSync({ map: TOWN, scenario: SE, controller: ctl });
    const kinds = new Set(ctl.seen.map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['bus_at_stop', 'bus_at_terminal', 'train_at_station']);
    for (const dp of ctl.seen) {
      expect(Object.keys(dp.features).sort()).toEqual(Object.keys(FEATURES[dp.kind]).sort());
      for (const [k, spec] of Object.entries(FEATURES[dp.kind])) {
        const v = dp.features[k]!;
        expect(Number.isFinite(v), `${dp.kind}.${k}`).toBe(true);
        expect(v, `${dp.kind}.${k}`).toBeGreaterThanOrEqual(spec.min);
        expect(v, `${dp.kind}.${k}`).toBeLessThanOrEqual(spec.max);
      }
      if (dp.kind !== 'train_at_station') { expect(dp.routeId).toBeDefined(); expect(dp.stopId).toBeDefined(); }
      else expect(dp.stationId).toBeDefined();
    }
    // ids are sequential and times non-decreasing
    ctl.seen.forEach((d, i) => { expect(d.id).toBe(i + 1); if (i) expect(d.t).toBeGreaterThanOrEqual(ctl.seen[i - 1]!.t); });
  });

  it('g0 dispatches the first bus of each route at t = 0 and holds the second toward the target headway', () => {
    const sim = createSim({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    sim.step();
    const recs = decisions(sim.snapshot().events).filter((r) => r.kind === 'bus_at_terminal');
    expect(recs.map((r) => r.vehicleId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
    for (const [first, second] of [['b1', 'b2'], ['b3', 'b4'], ['b5', 'b6']]) {
      const a = recs.find((r) => r.vehicleId === first)!;
      const b = recs.find((r) => r.vehicleId === second)!;
      expect(a.action).toEqual({ type: 'dispatch' });
      expect(a.features.headway_ahead_s).toBe(3600);
      expect(b.ruleId).toBe('even-headway');
      expect(b.features.headway_ahead_s).toBe(0);
      expect(b.action).toEqual({ type: 'hold', seconds: 120 });
      expect(b.explanation).toMatch(/^Waiting 120s at the terminal to keep a \d+s headway$/);
    }
    const obs = sim.observe();
    expect(obs.buses.map((b) => b.routeId)).toEqual(['r1', 'r1', 'r2', 'r2', 'r3', 'r3']);
    expect(obs.routes.find((r) => r.id === 'r1')!.targetHeadwayS).toBe(Math.round(routeById(TOWN, 'r1').nominalLoopS / 2));
  });

  it('clamps stop holds to maxHoldS and the per-loop budget', () => {
    const log = withSpy();
    const policy = clone(G0);
    policy.params.maxHoldS = 90;
    const ctl = fixed({ bus_at_stop: () => ({ type: 'hold', seconds: 500 }) }, policy);
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    const ev = drive(sim, 1500);
    const stopRecs = decisions(ev).filter((r) => r.kind === 'bus_at_stop');
    const holds = stopRecs.filter((r) => r.action.type === 'hold');
    expect(holds.length).toBeGreaterThan(5);
    for (const r of holds) {
      const s = (r.action as { seconds: number }).seconds;
      expect(s).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxHoldS);
      expect(r.features.hold_used_s! + s).toBeLessThanOrEqual(DEFAULT_CONFIG.limits.maxHoldPerLoopS);
    }
    // once the 180 s budget is spent the bus just continues (policy default)
    expect(stopRecs.some((r) => r.features.hold_used_s === 180 && r.action.type === 'continue' && r.ruleId === 'default')).toBe(true);
    // the collector saw the same clamped holds, never more than 180 s per bus between terminal departures
    expect(log.holds.length).toBe(holds.length);
    for (const bus of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
      const deps = log.departures.filter((d) => d.vehicleId === bus).map((d) => d.t);
      const terminalDeps = log.departures.filter((d) => d.vehicleId === bus && d.at.kind === 'stop' &&
        TOWN.routes.some((r) => r.stops[0] === d.at.id && r.stops.indexOf(d.at.id as never) === 0)).map((d) => d.t);
      expect(deps.length).toBeGreaterThan(0);
      const bounds = [...terminalDeps, Infinity];
      let from = -Infinity;
      for (const to of bounds) {
        const sum = log.holds.filter((h) => h.vehicleId === bus && h.t > from && h.t <= to).reduce((s, h) => s + h.seconds, 0);
        expect(sum).toBeLessThanOrEqual(180);
        from = to;
      }
    }
    // a policy's own maxHoldS (g0: 60) is the tighter bound
    const ctl60 = fixed({ bus_at_stop: () => ({ type: 'hold', seconds: 500 }) });
    const ev60 = drive(createSim({ map: TOWN, scenario: SE, controller: ctl60 }), 900);
    const h60 = decisions(ev60).filter((r) => r.kind === 'bus_at_stop' && r.action.type === 'hold');
    expect(h60.length).toBeGreaterThan(0);
    for (const r of h60) expect((r.action as { seconds: number }).seconds).toBeLessThanOrEqual(60);
  });

  it('ignores illegal reassigns (own route, below minBusesPerRoute) and applies the default', () => {
    const policy = clone(G0);
    policy.params.allocation = { r1: 4, r2: 1, r3: 1 };
    policy.rules = [];
    const ctl = fixed({
      bus_at_terminal: (dp) => (dp.routeId === 'r1' ? { type: 'reassign', to: 'r1' } : { type: 'reassign', to: 'r1' }),
    }, policy);
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    const ev = drive(sim, 1200);
    const recs = decisions(ev).filter((r) => r.kind === 'bus_at_terminal');
    expect(recs.length).toBeGreaterThan(8);
    for (const r of recs) {
      expect(r.action).toEqual({ type: 'dispatch' });
      expect(r.ruleId).toBe('default');
    }
    const obs = sim.observe();
    expect(obs.buses.map((b) => b.routeId)).toEqual(['r1', 'r1', 'r1', 'r1', 'r2', 'r3']);
    expect(obs.buses.every((b) => b.state !== 'deadhead')).toBe(true);
  });

  it('applies a legal reassign: the bus deadheads to the new terminal and joins that route', () => {
    let moved = false;
    const ctl = fixed({
      bus_at_terminal: (dp) => {
        if (!moved && dp.vehicleId === 'b1' && dp.t > 0) { moved = true; return { type: 'reassign', to: 'r3' }; }
        return { type: 'dispatch' };
      },
    });
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    let sawDeadhead = false;
    while (!sim.done && sim.t < 2000) {
      sim.step();
      const v = sim.snapshot().vehicles.find((x) => x.id === 'b1')!;
      if (v.state === 'deadhead') {
        sawDeadhead = true;
        expect(v.path).toEqual({ kind: 'deadhead', from: 'r1', to: 'r3' });
        expect(v.routeId).toBe('r3');
      }
    }
    expect(moved).toBe(true);
    expect(sawDeadhead).toBe(true);
    const obs = sim.observe();
    expect(obs.routes.find((r) => r.id === 'r3')!.buses).toContain('b1');
    expect(obs.routes.find((r) => r.id === 'r1')!.buses).toEqual(['b2']);
  });

  it('auto-dispatches after maxLayoverS at the terminal', () => {
    const log = withSpy();
    const ctl = fixed({ bus_at_terminal: () => ({ type: 'hold', seconds: 120 }) });
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    const ev = drive(sim, 400);
    const b1 = decisions(ev).filter((r) => r.vehicleId === 'b1' && r.kind === 'bus_at_terminal');
    expect(b1.map((r) => [r.t, r.action])).toEqual([
      [0, { type: 'hold', seconds: 120 }],
      [120, { type: 'hold', seconds: 120 }],
      [240, { type: 'hold', seconds: 60 }],
      [300, { type: 'dispatch' }],
    ]);
    expect(b1[3]!.ruleId).toBe('max-layover');
    const dep = log.departures.find((d) => d.vehicleId === 'b1')!;
    expect(dep.t).toBeGreaterThanOrEqual(300 + DEFAULT_CONFIG.bus.minDwellS - 1);
    expect(dep.t).toBeLessThan(300 + 120);
  });
});

describe('engine: async controllers', () => {
  it('step() halts on a pending async decision until resolve()', () => {
    const asked: DecisionPoint[] = [];
    const ctl: AsyncController = { id: 'slow', async: true, decide: (dp) => { asked.push(dp); return new Promise<Decision>(() => {}); } };
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    const a = sim.step();
    expect(a.pending).not.toBeNull();
    expect(a.pending!.kind).toBe('bus_at_terminal');
    expect(sim.t).toBe(0);
    for (let i = 0; i < 5; i++) {
      const again = sim.step();
      expect(again.pending!.id).toBe(a.pending!.id);
    }
    expect(sim.t).toBe(0);
    expect(asked).toHaveLength(1);
    sim.resolve(a.pending!.id + 99, { action: { type: 'dispatch' }, ruleId: 'x', explanation: 'x', source: 'jev' }); // wrong id: ignored
    expect(sim.step().pending!.id).toBe(a.pending!.id);
    sim.resolve(a.pending!.id, { action: { type: 'dispatch' }, ruleId: 'jev-dispatch', explanation: 'go', source: 'jev' });
    const b = sim.step();
    expect(b.pending!.id).toBe(a.pending!.id + 1);
    expect(b.pending!.vehicleId).toBe('b2');
    expect(sim.t).toBe(0);
    const rec = decisions(sim.snapshot().events).find((r) => r.vehicleId === 'b1')!;
    expect(rec).toMatchObject({ source: 'jev', ruleId: 'jev-dispatch', action: { type: 'dispatch' } });
  });

  it('runAsync matches runSync for the same decisions, and async decisions replay without the advisor', async () => {
    const pc = new PolicyController(G0);
    const ctl: AsyncController & { policy: Policy } = {
      id: 'async-g0', async: true, policy: G0,
      decide: (dp, obs) => Promise.resolve({ ...pc.decide(dp, obs), source: 'jev' as const }),
    };
    const sync = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    const sim = createSim({ map: TOWN, scenario: SE, controller: ctl });
    while (!sim.done) { const { pending } = sim.step(); if (pending) await (sim as unknown as { waitPending(): Promise<void> }).waitPending(); }
    const res = sim.result();
    expect(res.metrics.J).toBe(sync.metrics.J);
    expect(res.hash).toBe(sync.hash);
    expect(res.controller).toMatchObject({ kind: 'jev', policyId: 'g0' });
    const rep = sim.replay();
    expect(rep.decisions!.length).toBeGreaterThan(50);
    const again = runSync({ map: TOWN, scenario: SE, controller: new PolicyController(G0), decisions: rep.decisions });
    expect(again.hash).toBe(sync.hash);
    const viaRunAsync = await runAsync({ map: TOWN, scenario: SE, controller: ctl });
    expect(viaRunAsync.hash).toBe(sync.hash);
  });

  it('runSync rejects async controllers', () => {
    const ctl = { id: 'a', async: true, decide: async () => ({ action: { type: 'continue' }, ruleId: 'x', explanation: '', source: 'jev' }) };
    expect(() => runSync({ map: TOWN, scenario: SE, controller: ctl as unknown as Controller })).toThrow(/sync/);
  });
});

describe('engine: invariants', () => {
  it('conserves passengers, respects capacities and keeps queues consistent through a run', () => {
    for (const p of [G0, REF, EXAMPLE_G3]) {
      const sim = createSim({ map: TOWN, scenario: { ...SE, seed: 1003 }, controller: new PolicyController(p) });
      let n = 0;
      while (!sim.done) {
        sim.step();
        if (sim.t % 150 !== 0) continue;
        const snap = sim.snapshot();
        const obs = sim.observe();
        for (const v of snap.vehicles) expect(v.onboard).toBeLessThanOrEqual(v.capacity);
        const status = new Map<string, number>();
        let spawned = 0;
        for (let id = 0; id < 2000; id++) {
          const info = sim.passenger(id);
          if (!info) continue;
          spawned++;
          status.set(info.status, (status.get(info.status) ?? 0) + 1);
        }
        const riding = snap.vehicles.reduce((s, v) => s + v.onboard, 0);
        expect(status.get('riding') ?? 0).toBe(riding);
        const queued = snap.queues.reduce((s, q) => s + q.count, 0);
        expect(status.get('waiting') ?? 0).toBe(queued);
        expect(snap.people.filter((x) => x.state === 'waiting')).toHaveLength(queued);
        expect(obs.running.spawned).toBe(spawned);
        expect(obs.running.completed).toBe(status.get('arrived') ?? 0);
        n++;
      }
      expect(n).toBeGreaterThan(10);
      const r = sim.result();
      expect(r.metrics.completed + r.metrics.unfinished).toBe(r.metrics.spawned);
    }
  });
});

describe('engine: views', () => {
  it('snapshot lists walking + waiting people with queue slots, omits riders, keeps arrivals 3 s', () => {
    const sim = createSim({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    let snap = sim.snapshot();
    let sawArrived = false;
    let riders = 0;
    while (sim.t < 1100) {
      sim.step();
      snap = sim.snapshot();
      for (const p of snap.people) {
        if (p.state === 'arrived') {
          sawArrived = true;
          expect(snap.t - p.t1!).toBeLessThanOrEqual(3);
          expect(p.to).toBeDefined();
        }
      }
    }
    expect(snap.vehicles.filter((v) => v.kind === 'bus')).toHaveLength(6);
    expect(snap.vehicles.filter((v) => v.kind === 'train')).toHaveLength(1);
    const walking = snap.people.filter((p) => p.state === 'walking');
    const waiting = snap.people.filter((p) => p.state === 'waiting');
    expect(walking.length).toBeGreaterThan(0);
    expect(waiting.length).toBeGreaterThan(0);
    for (const p of walking) { expect(p.from).toBeDefined(); expect(p.to).toBeDefined(); expect(p.t1!).toBeGreaterThan(p.t0!); }
    // slots are 0..n-1 per place and match the queue counts
    const byPlace = new Map<string, number[]>();
    for (const p of waiting) {
      const k = `${p.at!.kind}:${p.at!.id}`;
      byPlace.set(k, [...(byPlace.get(k) ?? []), p.slot!]);
      expect(p.since!).toBeLessThanOrEqual(snap.t);
    }
    for (const q of snap.queues) {
      const slots = (byPlace.get(`${q.at.kind}:${q.at.id}`) ?? []).sort((a, b) => a - b);
      expect(slots).toEqual([...Array(q.count).keys()]);
    }
    const listed = new Set(snap.people.map((p) => p.id));
    for (let id = 0; id < 2000; id++) {
      const info = sim.passenger(id);
      if (!info) continue;
      if (info.status === 'riding') { riders++; expect(listed.has(id)).toBe(false); expect(info.reason).toMatch(/^Riding (Route \d|the train) to /); }
      if (info.status === 'waiting') expect(info.reason).toMatch(/^(Waiting for (Route \d( or \d)*|the train) — (next (bus|train) in ~\d+ min|no (bus|train) on the way)|Left behind by a full bus — )/);
    }
    expect(riders).toBeGreaterThan(0);
    expect(sawArrived).toBe(true);
    expect(sim.passenger(999999)).toBeNull();
  });

  it('observation matches the contract and computeFeatures reproduces the inspector numbers', () => {
    const sim = createSim({ map: TOWN, scenario: SE, controller: new PolicyController(G0) });
    for (let i = 0; i < 700; i++) sim.step();
    const obs = sim.observe();
    expect(obs.t).toBe(700);
    expect(obs.phase).toBe('running');
    expect(obs.scenario).toMatchObject({ id: 'stadium_exit', clockStart: '21:30', durationS: 1800, clearingS: 900 });
    expect(obs.buses).toHaveLength(6);
    expect(obs.stops).toHaveLength(8);
    expect(Object.keys(obs.train.platformQueue).sort()).toEqual(['stn_central', 'stn_stadium', 'stn_university']);
    expect(obs.routes.map((r) => r.buses.length)).toEqual([2, 2, 2]);
    const totalQ = obs.stops.reduce((s, x) => s + x.queue, 0) + Object.values(obs.train.platformQueue).reduce((s, x) => s + x, 0);
    expect(totalQ).toBeGreaterThan(0);
    for (const s of obs.stops) for (const v of Object.values(s.queueByRoute)) expect(v).toBeLessThanOrEqual(s.queue);
    const f = computeFeatures('bus_at_terminal', { sim, vehicleId: 'b1' });
    expect(Object.keys(f).sort()).toEqual(Object.keys(FEATURES.bus_at_terminal).sort());
    expect(f.route_queue).toBe(obs.routes.find((r) => r.id === 'r1')!.queue);
    const ft = computeFeatures('train_at_station', { sim, vehicleId: 't1' });
    expect(ft.onboard).toBe(obs.train.onboard);
    expect(sim.result().metrics.spawned).toBeGreaterThan(0); // mid-run result is allowed
  });
});

describe('PolicyController', () => {
  const dp = (kind: DecisionKind, features: Record<string, number>, extra: Partial<DecisionPoint> = {}): DecisionPoint =>
    ({ id: 1, t: 100, kind, vehicleId: 'b1', routeId: 'r1', stopId: 'stop_central_stn', features, ...extra });
  const obs = (queues: Record<string, number>) => ({ routes: Object.entries(queues).map(([id, queue]) => ({ id, buses: [], targetHeadwayS: 240, queue })) }) as unknown as Observation;

  it('fires the first matching applicable rule by priority (ties by array order) and fills the explanation', () => {
    const c = new PolicyController(EXAMPLE_G3);
    const d = c.decide(dp('bus_at_stop', { train_eta_s: 30, expected_transfers: 12, onboard: 10, headway_behind_s: 300, headway_ratio: 0.3, downstream_queue: 10, headway_ahead_s: 70, target_headway_s: 246, hold_used_s: 0 }), obs({ r1: 0, r2: 0, r3: 0 }));
    expect(d).toEqual({ action: { type: 'hold', seconds: 45 }, ruleId: 'hold-for-connection', explanation: 'Holding 45s for the train (30s away, 12 transfers)', source: 'policy' });
    const d2 = c.decide(dp('bus_at_stop', { train_eta_s: 9999, expected_transfers: 0, onboard: 10, headway_behind_s: 300, headway_ratio: 0.3, downstream_queue: 10, headway_ahead_s: 70, target_headway_s: 246, hold_used_s: 0 }), obs({}));
    expect(d2.ruleId).toBe('anti-bunch');
    expect(d2.action).toEqual({ type: 'hold', seconds: 60 }); // 176 s to target, clamped to params.maxHoldS 60
    expect(d2.explanation).toBe('Spacing out: only 70s behind the bus ahead');
    const tie: Policy = clone(G0);
    tie.rules = [
      { id: 'first', on: 'bus_at_stop', priority: 5, when: [], do: { type: 'hold', seconds: 10 }, say: 'first' },
      { id: 'second', on: 'bus_at_stop', priority: 5, when: [], do: { type: 'hold', seconds: 20 }, say: 'second' },
    ];
    expect(new PolicyController(tie).decide(dp('bus_at_stop', { hold_used_s: 0 }), obs({})).ruleId).toBe('first');
  });

  it('falls back to defaults with ruleId "default"', () => {
    const c = new PolicyController(G0);
    const d = c.decide(dp('bus_at_terminal', { headway_ratio: 1.5, headway_ahead_s: 400, target_headway_s: 246, layover_s: 0, buses_on_route: 2 }), obs({}));
    expect(d).toMatchObject({ action: { type: 'dispatch' }, ruleId: 'default', source: 'default' });
    const t = c.decide(dp('train_at_station', { platform_queue: 0 }, { vehicleId: 't1', routeId: undefined, stationId: 'stn_central' }), obs({}));
    expect(t).toMatchObject({ action: { type: 'setTrainDeparture', dwellS: 45 }, ruleId: 'default' });
    const s = c.decide(dp('bus_at_stop', {}), obs({}));
    expect(s).toMatchObject({ action: { type: 'continue' }, ruleId: 'default' });
  });

  it('skips inapplicable reassigns and resolves "busiest" from route queues', () => {
    const p: Policy = clone(REF);
    const c = new PolicyController(p);
    const f = { route_queue: 5, max_other_route_queue: 60, queue_ratio_other: 12, buses_on_route: 2, headway_ratio: 2, headway_ahead_s: 500, target_headway_s: 246, layover_s: 0 };
    const d = c.decide(dp('bus_at_terminal', f), obs({ r1: 5, r2: 20, r3: 60 }));
    expect(d).toMatchObject({ action: { type: 'reassign', to: 'r3' }, ruleId: 'move-to-busiest' });
    expect(d.explanation).toBe('Moving to the busiest route (r3): 60 waiting there, 5 here');
    // only bus on the route → reassign not applicable → next rule (none match) → default dispatch
    const single = c.decide(dp('bus_at_terminal', { ...f, buses_on_route: 1 }), obs({ r1: 5, r2: 20, r3: 60 }));
    expect(single).toMatchObject({ action: { type: 'dispatch' }, ruleId: 'default' });
    // reassign to own route is not applicable either
    const own: Policy = clone(G0);
    own.rules = [{ id: 'stay-here', on: 'bus_at_terminal', priority: 9, when: [], do: { type: 'reassign', to: 'r1' }, say: 'x' }];
    expect(new PolicyController(own).decide(dp('bus_at_terminal', f), obs({})).ruleId).toBe('default');
    // hold until target headway that is already met is a no-op → not applicable
    const met = new PolicyController(G0).decide(dp('bus_at_terminal', { ...f, headway_ratio: 0.99, headway_ahead_s: 250, target_headway_s: 246 }), obs({}));
    expect(met.ruleId).toBe('default');
  });
});
