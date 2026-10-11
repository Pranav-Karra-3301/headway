import { describe, expect, it } from 'vitest';
import type { DecisionRecord, FailureFinding, Observation, VehicleView } from '@headway/sim';
import {
  cleanName, differenceFindings, findingKey, fmtMMSS, fmtPaxH, fmtPct, legalActions, lerpDist, localClock,
  paceAt, paceDelta, trainDwellFor, verdict,
} from '../logic';

type Bus = Observation['buses'][number];
const bus = (id: string, p: Partial<Bus> = {}): Bus => ({
  id, routeId: 'r1', state: 'moving', onboard: 10, capacity: 40, nextStopId: 'stop_downtown', etaNextStopS: 40,
  holdUntil: null, headwayAheadS: 300, headwayBehindS: 300, holdUsedS: 0, ...p,
});

const obsWith = (buses: Bus[], train: Partial<Observation['train']> = {}, t = 600): Observation => ({
  t, phase: 'running',
  scenario: { id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900, advertised: [] },
  buses,
  train: { state: 'moving', stationId: 'stn_central', etaS: 80, onboard: 50, capacity: 160, departAt: null, alightingNext: 10,
    transfersNext: {}, platformQueue: { stn_stadium: 0, stn_university: 0, stn_central: 0 }, ...train },
  stops: [],
  routes: (['r1', 'r2', 'r3'] as const).map((r) => ({ id: r, buses: buses.filter((b) => b.routeId === r).map((b) => b.id), targetHeadwayS: 240, queue: 0 })),
  running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
});

const rec = (p: Partial<DecisionRecord>): DecisionRecord => ({
  dpId: 1, t: 500, kind: 'bus_at_terminal', vehicleId: 'b1', features: {},
  action: { type: 'dispatch' }, ruleId: 'default', explanation: '', source: 'policy', ...p,
});

const view = (id: string, lastDecision: DecisionRecord | null): VehicleView => ({
  id, kind: 'bus', routeId: 'r1', path: { kind: 'route', routeId: 'r1' }, dist: 0, state: 'holding', onboard: 0, capacity: 40,
  nextStopId: null, holdUntil: 700, lastDecision,
});

const fleet = () => [
  bus('b1', { routeId: 'r1' }), bus('b2', { routeId: 'r1' }), bus('b3', { routeId: 'r2' }),
  bus('b4', { routeId: 'r2' }), bus('b5', { routeId: 'r3' }), bus('b6', { routeId: 'r3' }),
];

describe('legalActions', () => {
  it('disables bus actions with a reason when nothing is selected, but the train stays available', () => {
    const l = legalActions(obsWith(fleet()), null);
    expect(l.dispatch).toEqual({ ok: false, why: 'Select a bus first' });
    expect(l.hold.ok).toBe(false);
    expect(l.reassign.ok).toBe(false);
    expect(l.train.ok).toBe(true);
  });

  it('allows dispatch only at a terminal', () => {
    const buses = fleet();
    buses[0] = bus('b1', { state: 'layover', routeId: 'r1' });
    buses[1] = bus('b2', { state: 'moving', routeId: 'r1' });
    const o = obsWith(buses);
    expect(legalActions(o, { kind: 'bus', id: 'b1' }).dispatch.ok).toBe(true);
    expect(legalActions(o, { kind: 'bus', id: 'b2' }).dispatch).toEqual({ ok: false, why: 'Only at a terminal' });
  });

  it('treats a hold raised at the terminal as at-terminal, and a stop hold as not', () => {
    const buses = fleet();
    buses[0] = bus('b1', { state: 'holding', holdUntil: 700 });
    const o = obsWith(buses);
    const atTerminal = legalActions(o, { kind: 'bus', id: 'b1' }, { view: view('b1', rec({ kind: 'bus_at_terminal' })) });
    const atStop = legalActions(o, { kind: 'bus', id: 'b1' }, { view: view('b1', rec({ kind: 'bus_at_stop' })) });
    expect(atTerminal.dispatch.ok).toBe(true);
    expect(atStop.dispatch.ok).toBe(false);
  });

  it('blocks reassign of the last bus on a route and to its own route', () => {
    const buses = fleet();
    buses[1] = bus('b2', { routeId: 'r2' }); // r1 now has only b1
    const o = obsWith(buses);
    const last = legalActions(o, { kind: 'bus', id: 'b1' });
    expect(last.reassign).toEqual({ ok: false, why: 'Last bus on r1' });
    const ok = legalActions(o, { kind: 'bus', id: 'b3' });
    expect(ok.reassign.ok).toBe(true);
    expect(ok.reassignTo.r2).toEqual({ ok: false, why: 'Already on r2' });
    expect(ok.reassignTo.r1.ok).toBe(true);
  });

  it('counts pending reassigns away from a route', () => {
    const o = obsWith(fleet());
    const l = legalActions(o, { kind: 'bus', id: 'b1' }, { pendingAway: { r1: 1 } });
    expect(l.reassign).toEqual({ ok: false, why: 'Last bus on r1' });
  });

  it('blocks holds once the per-loop budget is spent and everything while deadheading', () => {
    const buses = fleet();
    buses[0] = bus('b1', { holdUsedS: 180 });
    buses[2] = bus('b3', { state: 'deadhead', routeId: 'r2' });
    const o = obsWith(buses);
    expect(legalActions(o, { kind: 'bus', id: 'b1' }).hold).toEqual({ ok: false, why: 'Hold budget used this loop' });
    const dh = legalActions(o, { kind: 'bus', id: 'b3' });
    expect(dh.hold.ok).toBe(false);
    expect(dh.reassign.ok).toBe(false);
    expect(dh.dispatch.ok).toBe(false);
  });

  it('disables everything once the run is done', () => {
    const l = legalActions(obsWith(fleet()), { kind: 'bus', id: 'b1' }, { done: true });
    for (const g of [l.dispatch, l.hold, l.reassign, l.train]) expect(g).toEqual({ ok: false, why: 'Run finished' });
  });

  it('selecting the train keeps bus actions disabled', () => {
    const l = legalActions(obsWith(fleet()), { kind: 'train', id: 't1' });
    expect(l.target).toEqual({ kind: 'train', id: 't1' });
    expect(l.hold.ok).toBe(false);
    expect(l.train.ok).toBe(true);
  });
});

describe('trainDwellFor', () => {
  it('extends the current dwell by 30 s while dwelling, using the arrival time from the last decision', () => {
    const o = obsWith(fleet(), { state: 'dwelling', departAt: 560 }, 530);
    const last = rec({ kind: 'train_at_station', vehicleId: 't1', t: 520, features: { dwell_s: 5 }, action: { type: 'setTrainDeparture', dwellS: 45 } });
    // arrival = 520 - 5 = 515; current dwell = 560 - 515 = 45 → 75
    expect(trainDwellFor(o, 'extend', last)).toEqual({ dwellS: 75, departAt: 590, immediate: true, capped: false });
    // depart now: t - arrival = 15 → clamped to the 30 s minimum
    expect(trainDwellFor(o, 'now', last)).toEqual({ dwellS: 30, departAt: 545, immediate: true, capped: false });
  });

  it('caps the dwell at 120 s', () => {
    const o = obsWith(fleet(), { state: 'dwelling', departAt: 615 }, 560);
    const last = rec({ kind: 'train_at_station', vehicleId: 't1', t: 500, features: { dwell_s: 5 } });
    expect(trainDwellFor(o, 'extend', last)).toMatchObject({ dwellS: 120, capped: true });
  });

  it('plans for the next station while the train is moving', () => {
    const o = obsWith(fleet(), { state: 'moving', departAt: null });
    expect(trainDwellFor(o, 'extend', null)).toEqual({ dwellS: 75, departAt: null, immediate: false, capped: false });
    expect(trainDwellFor(o, 'now', null)).toEqual({ dwellS: 30, departAt: null, immediate: false, capped: false });
  });
});

describe('pace', () => {
  const s = [{ t: 0, j: 0 }, { t: 30, j: 300 }, { t: 60, j: 900 }];
  it('interpolates linearly and clamps at the ends', () => {
    expect(paceAt(s, 15)).toBe(150);
    expect(paceAt(s, 45)).toBe(600);
    expect(paceAt(s, -5)).toBe(0);
    expect(paceAt(s, 999)).toBe(900);
    expect(paceAt([], 10)).toBeNull();
  });
  it('reports passenger-hours ahead (green) or behind', () => {
    expect(paceDelta(10_000, 32_320)).toMatchObject({ ahead: true, even: false, text: '+6.2 pax-h' });
    expect(paceDelta(32_320, 10_000)).toMatchObject({ ahead: false, even: false, text: '−6.2 pax-h' });
    expect(paceDelta(1000, 1100)).toMatchObject({ even: true, text: 'even' });
  });
});

describe('verdict', () => {
  it('beats both', () => {
    const v = verdict(93, 95, 100);
    expect(v.tone).toBe('win');
    expect(v.line).toBe('You beat the baseline by 7% — the AI by 2.1%');
  });
  it('beats the baseline but not the AI', () => {
    const v = verdict(93, 90, 100);
    expect(v.tone).toBe('partial');
    expect(v.line).toBe('You beat the baseline by 7% — the AI wins by 3.2%');
  });
  it('doing nothing matches the baseline', () => {
    const v = verdict(100, 95, 100);
    expect(v.tone).toBe('loss');
    expect(v.line).toBe('You matched the baseline — the AI wins by 5%');
  });
  it('loses to both', () => {
    const v = verdict(110, 95, 100);
    expect(v.headline).toBe('The AI wins');
    expect(v.line).toBe('The AI wins by 14% — the baseline beat you by 9.1%');
  });
});

const gap = (stopId: string, impactS: number): FailureFinding =>
  ({ kind: 'service_gap', impactS, text: `gap ${stopId}`, stopId, routeId: 'r2', gapS: 600, fromT: 0, toT: 600, affected: 10 }) as FailureFinding;
const missed = (impactS: number): FailureFinding =>
  ({ kind: 'missed_transfer', impactS, text: 'missed', at: { kind: 'stop', id: 'stop_central_stn' }, from: 'train', to: 'r2', count: 5, window: [0, 60] }) as FailureFinding;

describe('differenceFindings', () => {
  it('keys findings by kind and place', () => {
    expect(findingKey(gap('stop_apts_south', 1))).toBe('service_gap:stop_apts_south:r2');
    expect(findingKey(missed(1))).toBe('missed_transfer:stop:stop_central_stn:train:r2');
  });
  it('ranks by the absolute gap between you and the AI and says who had it worse', () => {
    const you = [gap('stop_apts_south', 9000), missed(2000), gap('stop_downtown', 100)];
    const ai = [gap('stop_apts_south', 1000), missed(6000), gap('stop_old_main', 500)];
    const d = differenceFindings(you, ai, 3);
    expect(d.map((x) => [x.key, x.worse, x.deltaS])).toEqual([
      ['service_gap:stop_apts_south:r2', 'you', 8000],
      ['missed_transfer:stop:stop_central_stn:train:r2', 'ai', -4000],
      ['service_gap:stop_old_main:r2', 'ai', -500],
    ]);
    expect(d[0]!.finding.impactS).toBe(9000);
    expect(d[1]!.finding.impactS).toBe(6000);
  });
});

describe('formatting and misc', () => {
  it('formats numbers', () => {
    expect(fmtPaxH(3600 * 412.34)).toBe('412.3');
    expect(fmtMMSS(187)).toBe('3:07');
    expect(fmtMMSS(-4)).toBe('0:00');
    expect(fmtPct(7.04)).toBe('7%');
    expect(fmtPct(2.06)).toBe('2.1%');
    expect(fmtPct(13.6)).toBe('14%');
    expect(fmtPct(0.04)).toBe('0%');
  });
  it('computes the clock locally', () => {
    expect(localClock('21:30', 0)).toBe('21:30');
    expect(localClock('21:30', 659)).toBe('21:40');
    expect(localClock('23:50', 1200)).toBe('00:10');
  });
  it('validates leaderboard names', () => {
    expect(cleanName('  Ada L_1 ')).toBe('Ada L_1');
    expect(cleanName('')).toBeNull();
    expect(cleanName('x'.repeat(17))).toBeNull();
    expect(cleanName('bad!')).toBeNull();
  });
  it('interpolates distance along closed loops across the wrap', () => {
    expect(lerpDist(10, 20, 0.5, 100, true)).toBe(15);
    expect(lerpDist(98, 2, 0.5, 100, true)).toBe(0);
    expect(lerpDist(98, 2, 0.25, 100, true)).toBe(99);
    expect(lerpDist(10, 20, 0.5, 100, false)).toBe(15);
  });
});
