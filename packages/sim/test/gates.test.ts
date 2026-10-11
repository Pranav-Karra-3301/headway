// Owner: sim tuning (after Wave 1 integration). Spec §12 sanity gates plus the tuning targets in
// docs/research/sim-tuning.md, on the real engine, passengers, metrics and TOWN:
// (a) the stadium crowd uses the train and transfers between train and bus at Central, and misses connections there;
// (b) g0 completes the crowd; (c) REF beats g0; (d) Play is fair (idle = g0) and winnable by a sensible human but not
// trivially; (e) runs stay fast. Thresholds are deliberately a little looser than the measured values (see the doc).
import { describe, expect, it } from 'vitest';
import type { Itinerary, Policy, RunResult, ScenarioInstance, Sim } from '../src/contracts';
import { PolicyController } from '../src/controllers/policy';
import { __setEngineTestHooks, createSim, runSync } from '../src/engine/index';
import { TOWN } from '../src/map/town';
import { createCollector } from '../src/metrics/index';
import { createTripPlanner } from '../src/passengers/index';
import { G0, REF } from '../src/policy/builtin';
import { SEEDS, playInstance } from '../src/scenarios';

const run = (p: Policy, inst: ScenarioInstance): RunResult => runSync({ map: TOWN, scenario: inst, controller: new PolicyController(p) });
const maxGap = (r: RunResult) => Math.max(...r.stops.flatMap((s) => Object.values(s.maxGapS) as number[]));
const GATES = new Set(['z_stadium_east', 'z_stadium_south', 'z_stadium_north']);
const CENTRAL_UNIVERSITY = new Set(['stop_central_stn', 'stn_central', 'stop_university_stn', 'stn_university']);

interface Probe { r: RunResult; stadium: number; walk: number; train: number; trainBus: number; missedCU: number }
/** One run with the real planner and collector wrapped (read-only) to see itineraries, boardings and missed places. */
function probe(policy: Policy, inst: ScenarioInstance, script?: (sim: Sim) => void): Probe {
  const origin = new Map<number, string>();
  const plans = new Map<number, Itinerary>();
  const modes = new Map<number, string[]>();
  let missedCU = 0;
  __setEngineTestHooks({
    planner: (map, cfg) => {
      const p = createTripPlanner(map, cfg);
      return {
        plan: (s) => { const it = p.plan(s); origin.set(s.id, s.origin); plans.set(s.id, it); return it; },
        reconsider: (...a) => p.reconsider(...a),
      };
    },
    collector: (init) => {
      const c = createCollector(init);
      return {
        ...c,
        queueJoin: (pid, at, accepts, from, t) => {
          const e = c.queueJoin(pid, at, accepts, from, t);
          if (e && CENTRAL_UNIVERSITY.has(at.id)) missedCU++;
          return e;
        },
        board: (pid, vid, mode, at, t, waited, wasTransfer) => {
          const m = modes.get(pid) ?? [];
          m.push(mode === 'train' ? 'train' : 'bus');
          modes.set(pid, m);
          return c.board(pid, vid, mode, at, t, waited, wasTransfer);
        },
      };
    },
  });
  let r: RunResult;
  try {
    const sim = createSim({ map: TOWN, scenario: inst, controller: new PolicyController(policy) });
    while (!sim.done) { script?.(sim); sim.step(); }
    r = sim.result();
  } finally {
    __setEngineTestHooks(null);
  }
  let stadium = 0, walk = 0, train = 0, trainBus = 0;
  for (const [pid, it] of plans) {
    if (!GATES.has(origin.get(pid)!)) continue;
    stadium++;
    if (it.legs.every((l) => l.kind === 'walk')) walk++;
    const m = modes.get(pid) ?? [];
    if (m.includes('train')) train++;
    if (m.some((x, i) => i > 0 && x !== m[i - 1])) trainBus++;
  }
  return { r, stadium, walk, train, trainBus, missedCU };
}
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** A sensible Play human: pre-stage a Campus Loop bus (b1) for the 600 s closing, then hold the r2 bus at Central so
 *  the first post-closing trains' Apartments transfers make it (at most two holds, observation only). */
function sensibleHuman(prestage: string = 'b1'): (sim: Sim) => void {
  let holds = 0;
  let lastT = -999;
  return (sim) => {
    if (sim.t === 420) sim.intent({ type: 'reassign', vehicleId: prestage, to: 'r3' });
    if (holds >= 2 || sim.t < 600 || sim.t - lastT < 120) return;
    const o = sim.observe();
    const tr = o.train;
    if (tr.stationId !== 'stn_central' || tr.state !== 'moving' || tr.etaS > 45 || (tr.transfersNext.r2 ?? 0) < 8) return;
    const bus = o.buses.find((b) => b.routeId === 'r2' && b.nextStopId === 'stop_apts_north' && b.state !== 'moving' && b.state !== 'deadhead');
    if (!bus || (bus.holdUntil !== null && bus.holdUntil >= o.t + tr.etaS + 25)) return;
    sim.intent({ type: 'hold', vehicleId: bus.id, seconds: Math.min(90, tr.etaS + 30) });
    holds++;
    lastT = o.t;
  };
}

describe('tuning targets on the train split', () => {
  const se = SEEDS.train.filter((i) => i.scenarioId === 'stadium_exit').map((inst) => ({ inst, p: probe(G0, inst) }));
  const cc = SEEDS.train.filter((i) => i.scenarioId === 'class_change').map((inst) => ({ inst, r: run(G0, inst) }));

  it('(a) the stadium crowd rides the train and transfers between train and bus; few walk all the way', () => {
    const riders = sum(se, (x) => x.p.stadium);
    expect(sum(se, (x) => x.p.trainBus) / riders).toBeGreaterThanOrEqual(0.08);
    expect(sum(se, (x) => x.p.train) / riders).toBeGreaterThanOrEqual(0.2);
    expect(sum(se, (x) => x.p.walk) / riders).toBeLessThanOrEqual(0.35);
    for (const { inst, p } of se) {
      expect(p.trainBus / p.stadium, `seed ${inst.seed}`).toBeGreaterThanOrEqual(0.065);
      expect(p.train / p.stadium, `seed ${inst.seed}`).toBeGreaterThanOrEqual(0.18);
      expect(p.walk / p.stadium, `seed ${inst.seed}`).toBeLessThanOrEqual(0.35);
    }
  });

  it('(a) g0 misses ≥ 30 connections per run at Central / University, so holding for the train matters', () => {
    for (const { inst, p } of se) expect(p.missedCU, `seed ${inst.seed}`).toBeGreaterThanOrEqual(30);
    for (const { inst, p } of se) expect(p.r.metrics.missedConnections, `seed ${inst.seed}`).toBeGreaterThanOrEqual(60);
  });

  it('(b) g0 completes ≥ 85% of every stadium_exit run and ≥ 95% of every class_change run; the crunch is visible', () => {
    for (const { inst, p } of se) {
      expect(p.r.metrics.completionPct, `seed ${inst.seed}`).toBeGreaterThanOrEqual(85);
      expect(p.r.metrics.completionPct, `seed ${inst.seed}`).toBeLessThan(95); // still a crunch
      expect(Math.max(...p.r.stops.map((s) => s.maxQueue)), `seed ${inst.seed}`).toBeGreaterThan(150);
      expect(p.r.metrics.leftBehind, `seed ${inst.seed}`).toBeGreaterThan(100);
    }
    for (const { inst, r } of cc) expect(r.metrics.completionPct, `seed ${inst.seed}`).toBeGreaterThanOrEqual(95);
  });

  it('g0 is a respectable baseline: every route keeps service (no gap over 2× its ~220 s target)', () => {
    for (const { inst, p } of se) expect(maxGap(p.r), `stadium_exit ${inst.seed}`).toBeLessThan(480);
    for (const { inst, r } of cc) expect(maxGap(r), `class_change ${inst.seed}`).toBeLessThan(480);
  });

  it('(c) REF beats g0 by ≥ 3% J over the train split', () => {
    const g0J = sum(se, (x) => x.p.r.metrics.J) + sum(cc, (x) => x.r.metrics.J);
    const refJ = sum(SEEDS.train, (inst) => run(REF, inst).metrics.J);
    console.log(`[gates] REF vs g0 on train: ${((100 * (g0J - refJ)) / g0J).toFixed(2)}%`);
    expect(refJ).toBeLessThanOrEqual(g0J * 0.97);
  });

  it('(e) a stadium_exit run is fast (spec: < 150 ms in Node; generous bound for a loaded CI box)', () => {
    run(G0, SEEDS.train[0]!);
    let ms = Infinity; // best of 5 (shared box)
    for (let i = 0; i < 5 && ms >= 150; i++) {
      const t0 = performance.now();
      run(G0, SEEDS.train[1]!);
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`[gates] stadium_exit g0 run: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(400);
  });
});

describe('(d) Play is fair and winnable (stadium_exit, seed 50000)', () => {
  const PLAY = playInstance(0);
  const play = (script: (sim: Sim) => void): RunResult => {
    const sim = createSim({ map: TOWN, scenario: PLAY, controller: new PolicyController(G0) });
    while (!sim.done) { script(sim); sim.step(); }
    return sim.result();
  };
  const g0 = run(G0, PLAY);
  const gain = (r: RunResult) => (g0.metrics.J - r.metrics.J) / g0.metrics.J;

  it('doing nothing reproduces g0 exactly', () => {
    const idle = play(() => {});
    expect(idle.metrics.J).toBe(g0.metrics.J);
    expect(idle.hash).toBe(g0.hash);
  });

  it('a sensible human (pre-stage a Campus Loop bus, hold r2 at Central for the train) beats g0 by 3–12%', () => {
    const human = probe(G0, PLAY, sensibleHuman('b1'));
    expect(human.r.controller).toEqual({ kind: 'human', basePolicyId: 'g0' });
    console.log(`[gates] sensible human vs g0 on play: ${(100 * gain(human.r)).toFixed(2)}%`);
    expect(gain(human.r)).toBeGreaterThanOrEqual(0.03);
    expect(gain(human.r)).toBeLessThanOrEqual(0.12);
    expect(human.r.metrics.completionPct).toBeGreaterThan(g0.metrics.completionPct);
  });

  it('the move matters: pre-staging the r2 bus instead (it carries the train transfers) does not pay', () => {
    expect(gain(play(sensibleHuman('b3')))).toBeLessThan(0.01);
  });
});
