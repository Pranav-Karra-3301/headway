import { describe, expect, it } from 'vitest';
import { withConfig } from '../src/config';
import type { DecisionRecord, FailureFinding, RouteId, RunResult, StopId } from '../src/contracts';
import type { Collector, CollectorInit } from '../src/internal';
import { routeById, stationById, stopById, TOWN } from '../src/map/town';
import { canonicalJson } from '../src/metrics/hash';
import { canonicalHash, clockAt, createCollector, findingSentence } from '../src/metrics/index';
import { sentenceFor } from '../src/metrics/sentences';
import { stream } from '../src/rng';
import { SCENARIOS } from '../src/scenarios';
import { METRICS_TOWN, metricsScenario, platform, stop } from './fixtures/metricsTown';

const META = {
  controller: { kind: 'policy' as const, policyId: 'g0' }, simVersion: '1', mapVersion: 'metrics-fixture',
  scenarioId: 'stadium_exit', seed: 1001,
};

function collector(over: Partial<CollectorInit> = {}): Collector {
  return createCollector({
    map: METRICS_TOWN, scenario: metricsScenario(), seed: 1001, cfg: withConfig(), targetHeadwayS: () => 240, ...over,
  });
}
const fin = (c: Collector, unfinished: Array<{ pid: number; spawnT: number }> = [], tEnd = 2700): RunResult =>
  c.finalize(tEnd, unfinished, META);
const ofKind = <K extends FailureFinding['kind']>(r: RunResult, kind: K) =>
  r.findings.filter((f): f is Extract<FailureFinding, { kind: K }> => f.kind === kind);

/** Reference FNV-1a 32 over UTF-8 bytes (independent of the implementation under test). */
function refFnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('clockAt', () => {
  it('adds whole sim minutes to the scenario clock and wraps at midnight', () => {
    expect(clockAt('21:30', 125)).toBe('21:32');
    expect(clockAt('21:30', 0)).toBe('21:30');
    expect(clockAt('21:30', 59)).toBe('21:30');
    expect(clockAt('11:45', 2700)).toBe('12:30');
    expect(clockAt('23:50', 1200)).toBe('00:10');
    expect(clockAt('9:05', 60)).toBe('09:06');
  });
});

describe('canonicalHash', () => {
  it('is FNV-1a 32-bit hex over the UTF-8 canonical JSON (sorted keys, 3-decimal numbers)', () => {
    expect(refFnv1a('')).toBe('811c9dc5');
    expect(refFnv1a('a')).toBe('e40c292c');
    expect(refFnv1a('foobar')).toBe('bf9cf968');
    const x = { b: 'é–×', a: [1.23456, 2, { d: null, c: true }] };
    expect(canonicalJson(x)).toBe('{"a":[1.235,2,{"c":true,"d":null}],"b":"é–×"}');
    expect(canonicalHash(x)).toBe(refFnv1a(canonicalJson(x)));
    expect(canonicalHash(x)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('is stable under key reordering', () => {
    const a = { metrics: { J: 10, spawned: 2 }, stops: [{ id: 's', maxGapS: { r1: 5, r2: 7 } }], findings: [] };
    const b = { findings: [], stops: [{ maxGapS: { r2: 7, r1: 5 }, id: 's' }], metrics: { spawned: 2, J: 10 } };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
  it('rounds numbers to 3 decimals, drops undefined properties and keeps array order', () => {
    expect(canonicalHash({ x: 0.1 + 0.2 })).toBe(canonicalHash({ x: 0.3 }));
    expect(canonicalHash({ x: 1.0004 })).toBe(canonicalHash({ x: 1 }));
    expect(canonicalHash({ x: 1.001 })).not.toBe(canonicalHash({ x: 1 }));
    expect(canonicalJson({ x: -0.0001 })).toBe('{"x":0}');
    expect(canonicalHash({ a: 1, b: undefined })).toBe(canonicalHash({ a: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
});

describe('collector: objective and journey metrics', () => {
  it('computes J = Σ completed journeys + Σ unfinished ((tEnd − spawnT) + penalty) on a hand-built sequence', () => {
    const c = collector();
    const dt = stop('stop_downtown');
    c.spawn(0, 0); c.spawn(1, 10); c.spawn(2, 20); c.spawn(3, 100);
    c.queueJoin(0, dt, ['r1'], null, 50);
    c.board(0, 'b1', 'r1', dt, 110, 60, false);
    c.queueJoin(3, dt, ['r1'], null, 150);
    c.board(3, 'b2', 'r1', dt, 170, 20, false);
    c.queueJoin(2, stop('stop_old_main'), ['r3'], null, 200);
    c.alight(0, 'b1', stop('stop_university_stn'), 300);
    c.arrive(0, 500);
    c.arrive(1, 800); // walked all the way
    const r = fin(c, [{ pid: 2, spawnT: 20 }, { pid: 3, spawnT: 100 }]);
    expect(r.metrics.J).toBe(500 + 790 + (2700 - 20 + 2700) + (2700 - 100 + 2700));
    expect(r.metrics).toMatchObject({ spawned: 4, completed: 2, unfinished: 2, completionPct: 50, meanJourneyS: 645 });
    // waits: 60 s and 20 s at boarding, plus p2 still waiting at the end (2700 − 200)
    expect(r.metrics.meanWaitS).toBe(860);
    expect(r.metrics.maxWaitS).toBe(2500);
    expect(r).toMatchObject({ simVersion: '1', mapVersion: 'metrics-fixture', scenarioId: 'stadium_exit', seed: 1001 });
    expect(r.controller).toEqual({ kind: 'policy', policyId: 'g0' });
  });

  it('counts unfinished passengers from either side (engine list or never-arrived spawns)', () => {
    const c = collector();
    c.spawn(0, 0); c.arrive(0, 100);
    c.spawn(1, 50); // never arrives and the engine forgets to list it
    const r = fin(c, [{ pid: 7, spawnT: 1000 }]); // listed but never spawned through the collector
    expect(r.metrics).toMatchObject({ spawned: 3, completed: 1, unfinished: 2 });
    expect(r.metrics.J).toBe(100 + (2700 - 50 + 2700) + (2700 - 1000 + 2700));
    expect(r.metrics.completionPct).toBeCloseTo(33.33, 2);
  });

  it('takes p95 from the sorted waits (nearest rank)', () => {
    const c = collector();
    const dt = stop('stop_downtown');
    for (let i = 99; i >= 0; i--) { // insertion order must not matter
      c.spawn(i, 0);
      c.queueJoin(i, dt, ['r1'], null, 0);
      c.board(i, 'b1', 'r1', dt, i + 1, i + 1, false);
    }
    const m = fin(c).metrics;
    expect(m.p95WaitS).toBe(95);
    expect(m.maxWaitS).toBe(100);
    expect(m.meanWaitS).toBe(50.5);

    const c20 = collector();
    for (let i = 0; i < 20; i++) { c20.spawn(i, 0); c20.queueJoin(i, dt, ['r1'], null, 0); c20.board(i, 'b1', 'r1', dt, i + 1, i + 1, false); }
    expect(fin(c20).metrics.p95WaitS).toBe(19);

    expect(fin(collector()).metrics).toMatchObject({ p95WaitS: 0, meanWaitS: 0, maxWaitS: 0, completionPct: 0, meanJourneyS: 0 });
  });
});

describe('collector: transfers and missed connections', () => {
  it('detects a missed connection only inside the window and only for transfers', () => {
    const c = collector();
    const central = stop('stop_central_stn');
    for (let i = 0; i < 6; i++) c.spawn(i, 0);
    c.departure('b3', 'r2', central, 1000, 10, 40);
    expect(c.queueJoin(0, central, ['r2'], 'train', 1050)).toEqual({ t: 1050, kind: 'missed_connection', personId: 0, at: central });
    expect(c.queueJoin(1, central, ['r2'], 'train', 1120)).toBeNull(); // exactly missedWindowS later: outside
    expect(c.queueJoin(2, central, ['r2'], null, 1010)).toBeNull(); // walked from home: not a transfer
    expect(c.queueJoin(3, central, ['r1'], 'train', 1010)).toBeNull(); // Route 1 did not leave
    c.board(0, 'b4', 'r2', central, 1495, 445, false);
    c.departure('b4', 'r2', central, 1500, 12, 40);
    expect(c.queueJoin(4, central, ['r1', 'r2'], 'train', 1610)?.kind).toBe('missed_connection');
    expect(c.running().missedConnections).toBe(2);

    const r = fin(c);
    expect(r.metrics.missedConnections).toBe(2);
    const missed = ofKind(r, 'missed_transfer');
    expect(missed).toHaveLength(1);
    // p0 waited 445 s after missing, p4 is still waiting at the end (2700 − 1610)
    expect(missed[0]).toMatchObject({ at: central, from: 'train', to: 'r2', count: 2, window: [1050, 1610], impactS: 445 + 1090 });
    expect(missed[0]!.text).toBe('2 riders reached Central from the train just after Route 2 left.');
  });

  it('does not count the vehicle the rider just stepped off as a missed connection', () => {
    const c = collector();
    const dt = stop('stop_downtown');
    c.spawn(0, 0);
    c.queueJoin(0, stop('stop_old_main'), ['r1'], null, 10);
    c.board(0, 'b1', 'r1', stop('stop_old_main'), 20, 10, false);
    c.alight(0, 'b1', dt, 300);
    c.departure('b1', 'r1', dt, 305, 0, 40);
    expect(c.queueJoin(0, dt, ['r1', 'r2'], 'r1', 310)).toBeNull();
  });

  it('returns transfer_made for transfer boardings and counts them', () => {
    const c = collector();
    const central = stop('stop_central_stn');
    c.spawn(0, 0);
    c.queueJoin(0, central, ['r2'], 'train', 100);
    expect(c.board(0, 'b3', 'r2', central, 130, 30, true)).toEqual({ t: 130, kind: 'transfer_made', personId: 0, at: central });
    c.spawn(1, 0);
    c.queueJoin(1, central, ['r2'], null, 100);
    expect(c.board(1, 'b3', 'r2', central, 130, 30, false)).toBeNull();
    expect(fin(c).metrics.transfersMade).toBe(1);
  });
});

describe('collector: left behind and overload', () => {
  it('counts left-behind once per (passenger, place) and reports overload with peak queue and extra wait', () => {
    const c = collector();
    const gate = stop('stop_stadium_gate');
    for (let i = 0; i < 5; i++) { c.spawn(i, 600); c.queueJoin(i, gate, ['r3'], null, 610 + i); }
    expect(c.leftBehind(0, gate, 'r3', 650)).toEqual({ t: 650, kind: 'left_behind', personId: 0, at: gate });
    expect(c.leftBehind(0, gate, 'r3', 900)).toBeNull();
    expect(c.leftBehind(1, gate, 'r3', 650)?.kind).toBe('left_behind');
    expect(c.leftBehind(2, gate, 'r3', 650)?.kind).toBe('left_behind');
    expect(c.running().leftBehind).toBe(3);
    c.queueSample(660, gate, { r3: 7 }); // the engine saw more than the collector tracked
    for (let i = 0; i < 5; i++) c.board(i, 'b6', 'r3', gate, 900, 900 - (610 + i), false);
    // p0 is left behind again at another place: counted again
    c.alight(0, 'b6', stop('stop_stadium_stn'), 1000);
    c.queueJoin(0, platform('stn_stadium'), ['train'], 'r3', 1010);
    expect(c.leftBehind(0, platform('stn_stadium'), 'train', 1100)?.kind).toBe('left_behind');

    const r = fin(c);
    expect(r.metrics.leftBehind).toBe(4);
    const over = ofKind(r, 'overload');
    expect(over).toHaveLength(2);
    const atGate = over.find((f) => f.at.kind === 'stop')!;
    expect(atGate).toMatchObject({ at: gate, routeId: 'r3', leftBehind: 3, peakQueue: 7, impactS: 3 * (900 - 650) });
    expect(atGate.text).toBe('3 people were left behind at Stadium Gate; the queue peaked at 7.');
    const atPlatform = over.find((f) => f.at.kind === 'platform')!;
    expect(atPlatform).toMatchObject({ at: platform('stn_stadium'), routeId: 'train', leftBehind: 1, peakQueue: 1, impactS: 2700 - 1100 });
    expect(atPlatform.text).toBe('1 person was left behind at Stadium platform; the queue peaked at 1.');
    expect(r.stops.find((s) => s.id === 'stop_stadium_gate')!.maxQueue).toBe(7);
  });
});

describe('collector: service gaps', () => {
  it('reports the gap, its clock window and the riders affected; maxGapS covers every served route', () => {
    const c = collector();
    const as = stop('stop_apts_south');
    // events in time order, as the engine reports them
    c.departure('b3', 'r2', as, 100, 20, 40);
    c.spawn(0, 300); c.spawn(2, 300);
    c.queueJoin(2, as, ['r2'], null, 350);
    c.board(2, 'b3', 'r2', as, 400, 50, false); // served before the gap
    c.departure('b3', 'r2', as, 400, 20, 40);
    c.queueJoin(0, as, ['r2'], null, 500);
    c.spawn(1, 1000);
    c.queueJoin(1, as, ['r2'], null, 1200);
    c.board(0, 'b4', 'r2', as, 1300, 800, false);
    c.board(1, 'b4', 'r2', as, 1300, 100, false);
    for (const t of [1300, 1600, 1900, 2200, 2500]) c.departure(t === 1300 ? 'b4' : 'b3', 'r2', as, t, 20, 40);

    const r = fin(c);
    const gaps = ofKind(r, 'service_gap');
    expect(gaps).toHaveLength(1); // stops nobody waited at are never served here, but affect no one
    expect(gaps[0]).toMatchObject({ stopId: 'stop_apts_south', routeId: 'r2', gapS: 900, fromT: 400, toT: 1300, affected: 2, impactS: 900 });
    expect(gaps[0]!.text).toBe('Apartments South went 15 min without a Route 2 bus (21:36–21:51).');

    const st = r.stops.find((s) => s.id === 'stop_apts_south')!;
    expect(st).toEqual({ id: 'stop_apts_south', maxQueue: 2, meanWaitS: 316.67, maxGapS: { r2: 900 } });
    expect(r.stops.map((s) => s.id)).toEqual(METRICS_TOWN.stops.map((s) => s.id));
    expect(r.stops.find((s) => s.id === 'stop_downtown')!.maxGapS).toEqual({ r1: 2700, r2: 2700, r3: 2700 });
  });
});

describe('collector: bunching, unused capacity, long holds, effort, rule fires', () => {
  it('counts bunched departures per route (different buses closer than bunchingFraction × target)', () => {
    const c = collector(); // target 240 s → bunched below 60 s
    const dt = stop('stop_downtown');
    for (let i = 0; i < 30; i++) { c.spawn(i, 0); c.queueJoin(i, dt, ['r1'], null, 0); c.board(i, 'b1', 'r1', dt, 100, 100, false); }
    c.departure('b1', 'r1', dt, 100, 30, 40);
    c.departure('b2', 'r1', dt, 130, 5, 40); // 30 s
    c.departure('b1', 'r1', dt, 400, 5, 40);
    c.departure('b2', 'r1', dt, 600, 5, 40);
    c.departure('b1', 'r1', dt, 610, 5, 40); // 10 s
    c.departure('b1', 'r1', dt, 612, 5, 40); // the same bus again: not bunching
    c.departure('b3', 'r2', dt, 615, 5, 40); // another route
    c.departure('b5', 'r3', stop('stop_old_main'), 700, 0, 40);
    c.departure('b6', 'r3', stop('stop_old_main'), 740, 0, 40); // 40 s
    const r = fin(c);
    const b = ofKind(r, 'bunching');
    expect(b.map((f) => f.routeId)).toEqual(['r1', 'r3']); // riders board at Downtown on r1, so it ranks first
    expect(b[0]).toMatchObject({ routeId: 'r1', stopId: 'stop_downtown', events: 2, minHeadwayS: 10 });
    expect(b[0]!.impactS).toBeGreaterThan(0);
    expect(b[0]!.text).toBe('Route 1 buses bunched 2× (as close as 10 s).');
    expect(b[1]).toMatchObject({ routeId: 'r3', stopId: 'stop_old_main', events: 1, minHeadwayS: 40 });
  });

  it('flags a route running nearly empty (during the spawning window) while another route queues > 40', () => {
    const c = collector();
    [300, 600, 900, 1200].forEach((t, i) => c.departure(i % 2 ? 'b6' : 'b5', 'r3', stop('stop_old_main'), t, 4, 40));
    for (const t of [300, 600, 900, 1200]) c.departure('b3', 'r2', stop('stop_apts_south'), t, 38, 40);
    for (let i = 0; i < 45; i++) { c.spawn(i, 0); c.queueJoin(i, stop('stop_apts_south'), ['r2'], null, 1000 + i); }
    c.departure('b5', 'r3', stop('stop_downtown'), 2000, 40, 40); // clearing period: not counted toward the load
    const u = ofKind(fin(c), 'unused_capacity');
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ routeId: 'r3', meanLoad: 0.1, elsewhere: { stopId: 'stop_apts_south', queue: 45 } });
    expect(u[0]!.impactS).toBe(Math.round(36 * 240 / 2)); // min(45, 40 × 0.9) riders × half the target headway
    expect(u[0]!.text).toBe('Route 3 ran 90% empty while Apartments South queued 45.');
  });

  it('reports long holds with actual transfers gained, merges contiguous holds and trims holds cut short', () => {
    const c = collector();
    const central = stop('stop_central_stn');
    c.hold('b4', central, 45, 31, 12, 1000);
    for (let i = 0; i < 3; i++) { c.spawn(i, 900); c.queueJoin(i, central, ['r2'], 'train', 1010 + i); c.board(i, 'b4', 'r2', central, 1020 + i, 10, true); }
    c.spawn(3, 900); c.queueJoin(3, central, ['r2'], null, 1015); c.board(3, 'b4', 'r2', central, 1025, 10, false);
    c.departure('b4', 'r2', central, 1046, 35, 40);
    c.hold('b5', stop('stop_downtown'), 20, 10, 0, 1000); // short
    c.hold('b6', stop('stop_old_main'), 60, 0, 0, 1000); // nobody aboard
    c.hold('b1', stop('stop_stadium_gate'), 90, 10, 0, 2000);
    c.departure('b1', 'r3', stop('stop_stadium_gate'), 2040, 10, 40); // dispatched after 40 s
    c.hold('b2', central, 30, 5, 0, 1200);
    c.hold('b2', central, 20, 6, 0, 1230); // re-raised at the end of the first hold
    c.distance('b1', 10, false); c.distance('b2', 5, true); c.distance('t1', 100, false);
    c.trainDwell(45); c.trainDwell(60);

    const r = fin(c);
    expect(r.metrics.effort).toEqual({ busDistanceU: 15, deadheadDistanceU: 5, holdS: 45 + 20 + 60 + 40 + 50, trainDwellS: 105 });
    expect(r.metrics.transfersMade).toBe(3);
    const holds = ofKind(r, 'long_hold');
    expect(holds.map((h) => h.vehicleId)).toEqual(['b4', 'b1', 'b2']); // by impact: 45×31, 40×10, 50×6
    expect(holds[0]).toMatchObject({ vehicleId: 'b4', stopId: 'stop_central_stn', holdS: 45, delayedOnboard: 31, transfersGained: 3, impactS: 45 * 31 });
    expect(holds[1]).toMatchObject({ vehicleId: 'b1', stopId: 'stop_stadium_gate', holdS: 40, delayedOnboard: 10, impactS: 400 });
    expect(holds[2]).toMatchObject({ vehicleId: 'b2', stopId: 'stop_central_stn', holdS: 50, delayedOnboard: 6, transfersGained: 0 });
    expect(holds[0]!.text).toBe('Holding b4 45 s at Central gained 3 transfers but delayed 31 riders.');
  });

  it('counts rule fires by rule id', () => {
    const c = collector();
    const rec = (ruleId: string, t: number): DecisionRecord => ({
      dpId: t, t, kind: 'bus_at_terminal', vehicleId: 'b1', features: {}, action: { type: 'dispatch' }, ruleId,
      explanation: '', source: ruleId === 'default' ? 'default' : 'policy',
    });
    c.decision(rec('even-headway', 1)); c.decision(rec('default', 2)); c.decision(rec('even-headway', 3));
    expect(fin(c).ruleFires).toEqual({ default: 1, 'even-headway': 2 });
  });
});

describe('collector: running metrics and finalize', () => {
  it('reports running metrics, counting ongoing waits and journeys up to the latest tick seen', () => {
    const c = collector();
    const dt = stop('stop_downtown');
    expect(c.running()).toEqual({ spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 });
    c.spawn(0, 0); c.spawn(1, 0); c.spawn(2, 50);
    c.queueJoin(0, dt, ['r1'], null, 60);
    c.queueJoin(1, dt, ['r1'], null, 80);
    c.board(0, 'b1', 'r1', dt, 100, 40, false);
    expect(c.running()).toEqual({ spawned: 3, completed: 0, waitingNow: 1, ridingNow: 1, meanWaitS: 30, missedConnections: 0, leftBehind: 0, jSoFar: 250 });
    c.alight(0, 'b1', stop('stop_old_main'), 300);
    c.arrive(0, 400);
    expect(c.running()).toMatchObject({ completed: 1, waitingNow: 1, ridingNow: 0, meanWaitS: 180, jSoFar: 400 + 400 + 350 });
    c.walkaway(1, dt, 500);
    expect(c.running()).toMatchObject({ waitingNow: 0, meanWaitS: (40 + 420) / 2 });
    const r = fin(c);
    expect(r.metrics.walkaways).toBe(1);
    expect(r.metrics.maxWaitS).toBe(420);
  });

  it('is idempotent, hashes metrics + stops + findings, and is deterministic for the same event sequence', () => {
    const build = (extraWaitS = 0) => {
      const c = collector();
      const as = stop('stop_apts_south');
      for (const t of [100, 400, 1300, 1600, 1900, 2200, 2500]) c.departure('b3', 'r2', as, t, 20, 40);
      c.spawn(0, 300); c.queueJoin(0, as, ['r2'], null, 500); c.board(0, 'b3', 'r2', as, 1300 + extraWaitS, 800 + extraWaitS, false);
      c.spawn(1, 0); c.queueJoin(1, stop('stop_stadium_gate'), ['r3'], null, 60); c.leftBehind(1, stop('stop_stadium_gate'), 'r3', 90);
      return c;
    };
    const c = build();
    const before = c.running();
    const r1 = fin(c);
    const r2 = fin(c);
    expect(r2).toEqual(r1);
    expect(c.running()).toEqual(before);
    expect(r1.hash).toBe(canonicalHash({ metrics: r1.metrics, stops: r1.stops, findings: r1.findings }));
    expect(fin(build()).hash).toBe(r1.hash);
    expect(fin(build(5)).hash).not.toBe(r1.hash);
    // findings ranked by impact; text is the §8.4 sentence for this map
    const impacts = r1.findings.map((f) => f.impactS);
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
    for (const f of r1.findings) expect(f.text).toBe(sentenceFor(f, '21:30', METRICS_TOWN));
  });
});

describe('sentences (spec §8.4 templates)', () => {
  const S = (f: FailureFinding) => sentenceFor(f, '21:30', METRICS_TOWN);
  it('match the templates verbatim', () => {
    expect(S({ kind: 'service_gap', impactS: 1, text: '', stopId: 'stop_apts_south', routeId: 'r2', gapS: 840, fromT: 1320, toT: 2160, affected: 41 }))
      .toBe('Apartments South went 14 min without a Route 2 bus (21:52–22:06).');
    expect(S({ kind: 'missed_transfer', impactS: 1, text: '', at: stop('stop_central_stn'), from: 'train', to: 'r2', count: 38, window: [900, 1100] }))
      .toBe('38 riders reached Central from the train just after Route 2 left.');
    expect(S({ kind: 'bunching', impactS: 1, text: '', routeId: 'r1', stopId: 'stop_downtown', events: 4, minHeadwayS: 40 }))
      .toBe('Route 1 buses bunched 4× (as close as 40 s).');
    expect(S({ kind: 'overload', impactS: 1, text: '', at: stop('stop_stadium_gate'), routeId: 'r3', leftBehind: 23, peakQueue: 140 }))
      .toBe('23 people were left behind at Stadium Gate; the queue peaked at 140.');
    expect(S({ kind: 'unused_capacity', impactS: 1, text: '', routeId: 'r3', meanLoad: 0.29, elsewhere: { stopId: 'stop_downtown', queue: 60 } }))
      .toBe('Route 3 ran 71% empty while Downtown queued 60.');
    expect(S({ kind: 'long_hold', impactS: 1, text: '', vehicleId: 'b4', stopId: 'stop_central_stn', holdS: 45, delayedOnboard: 31, transfersGained: 12 }))
      .toBe('Holding b4 45 s at Central gained 12 transfers but delayed 31 riders.');
  });
  it('handle singulars, platforms and shared stops', () => {
    expect(S({ kind: 'missed_transfer', impactS: 1, text: '', at: platform('stn_central'), from: 'r1', to: 'train', count: 1, window: [5, 5] }))
      .toBe('1 rider reached Central platform from Route 1 just after the train left.');
    expect(S({ kind: 'overload', impactS: 1, text: '', at: stop('stop_downtown'), routeId: 'r2', leftBehind: 23, peakQueue: 60 }))
      .toBe('23 people waiting for Route 2 were left behind at Downtown; the queue peaked at 60.');
    expect(S({ kind: 'long_hold', impactS: 1, text: '', vehicleId: 'b2', stopId: 'stop_old_main', holdS: 30, delayedOnboard: 1, transfersGained: 1 }))
      .toBe('Holding b2 30 s at Old Main gained 1 transfer but delayed 1 rider.');
  });
  it('findingSentence uses the real town names', () => {
    const central = stopById(TOWN, 'stop_central_stn').name;
    expect(findingSentence({ kind: 'long_hold', impactS: 1, text: '', vehicleId: 'b4', stopId: 'stop_central_stn', holdS: 45, delayedOnboard: 31, transfersGained: 12 }, '21:30'))
      .toBe(`Holding b4 45 s at ${central} gained 12 transfers but delayed 31 riders.`);
    const plat = `${stationById(TOWN, 'stn_stadium').name} platform`;
    expect(findingSentence({ kind: 'overload', impactS: 1, text: '', at: platform('stn_stadium'), routeId: 'train', leftBehind: 74, peakQueue: 236 }, '21:30'))
      .toBe(`74 people were left behind at ${plat}; the queue peaked at 236.`);
    expect(findingSentence({ kind: 'service_gap', impactS: 1, text: '', stopId: 'stop_apts_south', routeId: 'r2', gapS: 840, fromT: 1320, toT: 2160, affected: 41 }, '21:30'))
      .toBe(`${stopById(TOWN, 'stop_apts_south').name} went 14 min without a Route 2 bus (21:52–22:06).`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// End to end on the real TOWN: a tiny scripted "sim" (two buses per route on a fixed timetable, FIFO boarding,
// capacity 40, a stadium crowd with Route 3 → Route 2 transfers) feeding the collector.
const TOWN_READY = Array.isArray(TOWN?.routes) && TOWN.routes.length === 3 && Array.isArray(TOWN?.rail?.stations) && TOWN.zones?.length > 0;

function driveTown(seed: number): { result: RunResult; J: number; ms: number } {
  const t0 = performance.now();
  const cfg = withConfig();
  const target = (r: RouteId) => Math.round(routeById(TOWN, r).nominalLoopS / 2);
  const c = createCollector({ map: TOWN, scenario: SCENARIOS.stadium_exit, seed, cfg, targetHeadwayS: target });
  const rng = stream(seed, 'metrics-test');
  const T_END = 2700;
  type PLeg = { route: RouteId; board: StopId; alight: StopId };
  type P = { pid: number; spawnT: number; legs: PLeg[]; leg: number; joinT: number; arriveT: number; bus: string | null };
  const pax: P[] = [];
  const routes: RouteId[] = ['r1', 'r2', 'r3'];
  for (let pid = 0; pid < 900; pid++) {
    if (rng.next() < 0.7) {
      const legs: PLeg[] = [{ route: 'r3', board: 'stop_stadium_gate', alight: 'stop_downtown' }];
      if (rng.next() < 0.5) legs.push({ route: 'r2', board: 'stop_downtown', alight: 'stop_apts_south' });
      pax.push({ pid, spawnT: 600 + rng.int(0, 600), legs, leg: 0, joinT: 0, arriveT: -1, bus: null });
    } else {
      const route = rng.pick(routes);
      const ss = routeById(TOWN, route).stops;
      const a = rng.int(0, ss.length - 1);
      const b = (a + rng.int(1, ss.length - 1)) % ss.length;
      pax.push({ pid, spawnT: rng.int(0, 1799), legs: [{ route, board: ss[a]!, alight: ss[b]! }], leg: 0, joinT: 0, arriveT: -1, bus: null });
    }
  }
  pax.sort((x, y) => x.spawnT - y.spawnT || x.pid - y.pid);
  const at = new Map<number, Array<() => void>>();
  const later = (t: number, f: () => void) => { if (t <= T_END) (at.get(t) ?? at.set(t, []).get(t)!).push(f); };
  const queues = new Map<StopId, P[]>(TOWN.stops.map((s) => [s.id, []]));
  const join = (p: P, t: number, from: RouteId | null) => {
    p.joinT = t;
    queues.get(p.legs[p.leg]!.board)!.push(p);
    c.queueJoin(p.pid, stop(p.legs[p.leg]!.board), [p.legs[p.leg]!.route], from, t);
  };
  for (const p of pax) {
    later(p.spawnT, () => c.spawn(p.pid, p.spawnT));
    later(p.spawnT + 60 + (p.pid % 120), () => join(p, p.spawnT + 60 + (p.pid % 120), null));
  }
  // timetable: bus j of route r reaches stop k at j·L/2 + n·L + τ_k
  const deps: Array<{ t: number; bus: string; route: RouteId; k: number }> = [];
  routes.forEach((route, ri) => {
    const R = routeById(TOWN, route);
    const L = R.nominalLoopS;
    const tau = R.stopDist.map((d, k) => Math.round(d / cfg.bus.speed + 20 * k));
    for (let j = 0; j < 2; j++) {
      for (let n = 0; ; n++) {
        const base = j * Math.round(L / 2) + n * L;
        if (base > T_END) break;
        tau.forEach((tk, k) => { if (base + tk <= T_END) deps.push({ t: base + tk, bus: `b${ri * 2 + j + 1}`, route, k }); });
      }
    }
  });
  deps.sort((a, b) => a.t - b.t || a.bus.localeCompare(b.bus));
  const riders = new Map<string, P[]>();
  for (const d of deps) {
    later(d.t, () => {
      const R = routeById(TOWN, d.route);
      const s = R.stops[d.k]!;
      const place = stop(s);
      const onboard = riders.get(d.bus) ?? [];
      const stay: P[] = [];
      for (const p of onboard) {
        if (p.legs[p.leg]!.alight !== s) { stay.push(p); continue; }
        c.alight(p.pid, d.bus, place, d.t);
        p.leg++;
        if (p.leg < p.legs.length) later(d.t + 30, () => join(p, d.t + 30, d.route));
        else later(d.t + 60, () => { p.arriveT = d.t + 60; c.arrive(p.pid, d.t + 60); });
      }
      const q = queues.get(s)!;
      const left: P[] = [];
      for (const p of q) {
        if (p.legs[p.leg]!.route !== d.route) { left.push(p); continue; }
        if (stay.length < 40) {
          stay.push(p);
          c.board(p.pid, d.bus, d.route, place, d.t, d.t - p.joinT, p.leg > 0);
        } else {
          left.push(p);
          c.leftBehind(p.pid, place, d.route, d.t);
        }
      }
      queues.set(s, left);
      riders.set(d.bus, stay);
      c.departure(d.bus, d.route, place, d.t, stay.length, 40);
      c.distance(d.bus, 25, false);
    });
  }
  for (let t = 0; t <= T_END; t++) {
    for (const f of at.get(t) ?? []) f();
    if (t % 30 === 0) {
      for (const [s, q] of queues) {
        const byMode: Partial<Record<RouteId, number>> = {};
        for (const p of q) byMode[p.legs[p.leg]!.route] = (byMode[p.legs[p.leg]!.route] ?? 0) + 1;
        c.queueSample(t, stop(s), byMode);
      }
    }
  }
  const unfinished = pax.filter((p) => p.arriveT < 0).map((p) => ({ pid: p.pid, spawnT: p.spawnT }));
  const J = pax.reduce((acc, p) => acc + (p.arriveT >= 0 ? p.arriveT - p.spawnT : T_END - p.spawnT + 2700), 0);
  const result = c.finalize(T_END, unfinished, { ...META, mapVersion: TOWN.version, seed });
  return { result, J, ms: performance.now() - t0 };
}

describe.skipIf(!TOWN_READY)('collector on the real TOWN (scripted run)', () => {
  it('produces a complete, consistent, deterministic RunResult with town names in the findings', () => {
    const { result: r, J, ms } = driveTown(7);
    expect(r.metrics.J).toBe(J);
    expect(r.metrics.spawned).toBe(900);
    expect(r.metrics.completed + r.metrics.unfinished).toBe(900);
    expect(r.metrics.transfersMade).toBeGreaterThan(0);
    expect(r.metrics.leftBehind).toBeGreaterThan(0);
    expect(r.metrics.p95WaitS).toBeGreaterThanOrEqual(r.metrics.meanWaitS);
    expect(r.stops.map((s) => s.id)).toEqual(TOWN.stops.map((s) => s.id));
    for (const s of r.stops) expect(Object.keys(s.maxGapS).sort()).toEqual([...stopById(TOWN, s.id).servedRoutes].sort());
    const gate = ofKind(r, 'overload').find((f) => f.at.kind === 'stop' && f.at.id === 'stop_stadium_gate');
    expect(gate?.text).toContain(stopById(TOWN, 'stop_stadium_gate').name);
    for (const f of r.findings) expect(f.text).toBe(findingSentence(f, '21:30'));
    expect(r.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(driveTown(7).result.hash).toBe(r.hash);
    expect(driveTown(8).result.hash).not.toBe(r.hash);
    console.log(`scripted TOWN run: ${ms.toFixed(1)} ms, J=${r.metrics.J}, findings=${r.findings.map((f) => f.kind).join(',')}`);
  });
});

