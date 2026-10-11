import { describe, expect, it } from 'vitest';
import type { DecisionRecord, Observation } from '@headway/sim';
import { addIntent, badgeFor, describeIntent, expirePending, resolveWithDecisions, resolveWithObservation, type TrackedIntent } from '../intents';

type Bus = Observation['buses'][number];
const bus = (id: string, p: Partial<Bus> = {}): Bus => ({
  id, routeId: 'r1', state: 'moving', onboard: 10, capacity: 40, nextStopId: 'stop_downtown', etaNextStopS: 40,
  holdUntil: null, headwayAheadS: 300, headwayBehindS: 300, holdUsedS: 0, ...p,
});
const obs = (t: number, buses: Bus[], train: Partial<Observation['train']> = {}): Observation => ({
  t, phase: 'running',
  scenario: { id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900, advertised: [] },
  buses,
  train: { state: 'moving', stationId: 'stn_central', etaS: 80, onboard: 50, capacity: 160, departAt: null, alightingNext: 0,
    transfersNext: {}, platformQueue: { stn_stadium: 0, stn_university: 0, stn_central: 0 }, ...train },
  stops: [], routes: [],
  running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
});
const human = (p: Partial<DecisionRecord>): DecisionRecord => ({
  dpId: 9, t: 0, kind: 'bus_at_stop', vehicleId: 'b1', features: {}, action: { type: 'continue' },
  ruleId: 'human', explanation: '', source: 'human', ...p,
});

describe('intent tracking', () => {
  it('describes intents', () => {
    expect(describeIntent({ type: 'dispatch', vehicleId: 'b2' })).toBe('Dispatch b2');
    expect(describeIntent({ type: 'hold', vehicleId: 'b3', seconds: 30 })).toBe('Hold b3 30 s');
    expect(describeIntent({ type: 'reassign', vehicleId: 'b1', to: 'r3' })).toBe('Move b1 to r3');
    expect(describeIntent({ type: 'setTrainDeparture', dwellS: 75 })).toBe('Train dwell 75 s');
  });

  it('marks immediate intents applied and keeps deferred ones pending with a badge', () => {
    let l: TrackedIntent[] = [];
    l = addIntent(l, { id: 1, t: 100, intent: { type: 'dispatch', vehicleId: 'b1' } }, { applied: true, result: 'Dispatched' });
    l = addIntent(l, { id: 2, t: 110, intent: { type: 'hold', vehicleId: 'b2', seconds: 60 } }, { applied: false });
    expect(l.map((x) => x.status)).toEqual(['applied', 'pending']);
    expect(l[0]!.appliedT).toBe(100);
    expect(badgeFor(l, 'b2')).toBe('H60');
    expect(badgeFor(l, 'b1')).toBeNull();
  });

  it('a newer pending intent of the same type for the same vehicle replaces the older one', () => {
    let l: TrackedIntent[] = [];
    l = addIntent(l, { id: 1, t: 100, intent: { type: 'hold', vehicleId: 'b2', seconds: 30 } }, { applied: false });
    l = addIntent(l, { id: 2, t: 105, intent: { type: 'hold', vehicleId: 'b2', seconds: 60 } }, { applied: false });
    expect(l.map((x) => x.status)).toEqual(['replaced', 'pending']);
  });

  it('resolves pending intents from human decision records', () => {
    let l: TrackedIntent[] = [];
    l = addIntent(l, { id: 1, t: 100, intent: { type: 'reassign', vehicleId: 'b1', to: 'r3' } }, { applied: false });
    l = addIntent(l, { id: 2, t: 100, intent: { type: 'setTrainDeparture', dwellS: 75 } }, { applied: false });
    // a policy decision or an earlier one does not count
    l = resolveWithDecisions(l, [
      human({ vehicleId: 'b1', t: 90, kind: 'bus_at_terminal', action: { type: 'reassign', to: 'r3' } }),
      human({ vehicleId: 'b1', t: 150, kind: 'bus_at_terminal', action: { type: 'dispatch' }, source: 'policy' }),
    ]);
    expect(l.every((x) => x.status === 'pending')).toBe(true);
    l = resolveWithDecisions(l, [
      human({ vehicleId: 'b1', t: 160, kind: 'bus_at_terminal', action: { type: 'reassign', to: 'r3' }, explanation: 'Moving to r3' }),
      human({ vehicleId: 't1', t: 170, kind: 'train_at_station', action: { type: 'setTrainDeparture', dwellS: 75 }, explanation: 'Train waits 75 s' }),
    ]);
    expect(l.map((x) => [x.status, x.appliedT, x.result])).toEqual([
      ['applied', 160, 'Moving to r3'],
      ['applied', 170, 'Train waits 75 s'],
    ]);
  });

  it('falls back to observed state for deferred holds, reassigns and train departures', () => {
    let l: TrackedIntent[] = [];
    l = addIntent(l, { id: 1, t: 100, intent: { type: 'hold', vehicleId: 'b2', seconds: 30 } }, { applied: false });
    l = addIntent(l, { id: 2, t: 100, intent: { type: 'reassign', vehicleId: 'b3', to: 'r2' } }, { applied: false });
    l = addIntent(l, { id: 3, t: 100, intent: { type: 'setTrainDeparture', dwellS: 75 } }, { applied: false });
    // still at the place where the intent was issued: holding here does not count yet
    l = resolveWithObservation(l, obs(105, [bus('b2', { state: 'holding', holdUntil: 140 }), bus('b3')], { state: 'dwelling', departAt: 130 }));
    expect(l.map((x) => x.status)).toEqual(['pending', 'pending', 'pending']);
    // they move on …
    l = resolveWithObservation(l, obs(120, [bus('b2'), bus('b3')], { state: 'moving' }));
    // … then the effects show up
    l = resolveWithObservation(l, obs(200, [bus('b2', { state: 'holding', holdUntil: 230 }), bus('b3', { state: 'deadhead' })], { state: 'dwelling', departAt: 275 }));
    expect(l.map((x) => [x.status, x.appliedT])).toEqual([['applied', 200], ['applied', 200], ['applied', 200]]);
  });

  it('expires whatever is still pending at the end of the run', () => {
    let l: TrackedIntent[] = [];
    l = addIntent(l, { id: 1, t: 100, intent: { type: 'hold', vehicleId: 'b2', seconds: 30 } }, { applied: false });
    l = expirePending(l);
    expect(l[0]!.status).toBe('expired');
  });
});
