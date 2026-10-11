import { describe, expect, it } from 'vitest';
import type { DecisionRecord, PassengerInfo } from '@headway/sim';
import { personModel, stopModel, vehicleModel } from '../inspect';
import { obsAt, snapAt, vehicle, withBus, withStop } from './fixtures';

const holdRecord: DecisionRecord = {
  dpId: 7, t: 690, kind: 'bus_at_stop', vehicleId: 'b4', features: {},
  action: { type: 'hold', seconds: 45 }, ruleId: 'hold_for_train', source: 'policy',
  explanation: 'Holding 45 s for the train (34 s away, 14 transfers)',
};

describe('vehicleModel', () => {
  it('builds a bus card from the snapshot and the observation', () => {
    let obs = withBus(obsAt(700), 'b4', {
      state: 'holding', onboard: 28, nextStopId: 'stop_apts_north', etaNextStopS: 80,
      holdUntil: 730, headwayAheadS: 240, headwayBehindS: 200,
    });
    obs = { ...obs };
    const snap = snapAt(700, [vehicle('b4', { routeId: 'r2', state: 'holding', onboard: 28, holdUntil: 730, lastDecision: holdRecord })]);
    const m = vehicleModel('b4', obs, snap, null)!;
    expect(m.kind).toBe('bus');
    expect(m.title).toBe('Bus b4');
    expect(m.routeId).toBe('r2');
    expect(m.subtitle).toBe('Apartments');
    expect(m.stateLabel).toBe('Holding');
    expect(m.onboard).toBe(28);
    expect(m.capacity).toBe(40);
    expect(m.loadPct).toBe(70);
    expect(m.holdLeftS).toBe(30);
    expect(m.next).toEqual({ name: 'Apartments North', etaS: 80 });
    expect(m.headway).toEqual({ aheadS: 240, behindS: 200, targetS: 210 });
    expect(m.decision).toMatchObject({
      text: 'Holding 45 s for the train (34 s away, 14 transfers)', ruleId: 'hold_for_train', source: 'policy',
      action: 'Hold 45 s', clock: '21:41',
    });
  });

  it('builds a train card with transfers sorted by size and a departure countdown', () => {
    const base = obsAt(700);
    const obs = {
      ...base,
      train: {
        ...base.train, state: 'dwelling' as const, stationId: 'stn_central' as const, etaS: 0, onboard: 120, departAt: 745,
        alightingNext: 30, transfersNext: { r1: 4, r2: 11 }, platformQueue: { stn_stadium: 50, stn_university: 3, stn_central: 9 },
      },
    };
    const snap = snapAt(700, [vehicle('t1', { state: 'dwelling', onboard: 120 })]);
    const m = vehicleModel('t1', obs, snap, null)!;
    expect(m.kind).toBe('train');
    expect(m.title).toBe('Train');
    expect(m.next).toEqual({ name: 'Central', etaS: 0 });
    expect(m.train?.departInS).toBe(45);
    expect(m.train?.transfers).toEqual([{ routeId: 'r2', n: 11 }, { routeId: 'r1', n: 4 }]);
    expect(m.train?.platforms.map((p) => [p.name, p.queue])).toEqual([['Stadium', 50], ['University', 3], ['Central', 9]]);
  });

  it('returns null for an unknown vehicle and tolerates a missing snapshot', () => {
    expect(vehicleModel('b9', obsAt(10), snapAt(10), null)).toBeNull();
    const m = vehicleModel('b1', obsAt(10), null, null)!;
    expect(m.title).toBe('Bus b1');
    expect(m.decision).toBeNull();
  });
});

describe('stopModel', () => {
  it('summarises the queue by route, next arrivals and last departures', () => {
    let obs = withStop(obsAt(900), 'stop_downtown', {
      queue: 17, queueByRoute: { r3: 5, r1: 12 }, longestWaitS: 300, lastDepartureT: { r1: 780, r2: 870 },
    });
    obs = withBus(obs, 'b2', { nextStopId: 'stop_downtown', etaNextStopS: 140 });
    obs = withBus(obs, 'b5', { nextStopId: 'stop_downtown', etaNextStopS: 30 });
    const m = stopModel('stop_downtown', obs, null)!;
    expect(m.name).toBe('Downtown');
    expect(m.queue).toBe(17);
    expect(m.severity).toBe('warn');
    expect(m.byRoute).toEqual([{ routeId: 'r1', n: 12 }, { routeId: 'r3', n: 5 }]);
    expect(m.arrivals).toEqual([
      { vehicleId: 'b5', routeId: 'r3', kind: 'bus', etaS: 30 },
      { vehicleId: 'b2', routeId: 'r1', kind: 'bus', etaS: 140 },
    ]);
    expect(m.lastDeparture).toEqual([{ routeId: 'r1', agoS: 120 }, { routeId: 'r2', agoS: 30 }]);
    expect(m.platform).toBeNull();
  });

  it('includes the paired platform and the train for station stops', () => {
    const base = obsAt(900);
    const obs = { ...base, train: { ...base.train, stationId: 'stn_central' as const, etaS: 75, platformQueue: { stn_stadium: 0, stn_university: 0, stn_central: 21 } } };
    const m = stopModel('stop_central_stn', obs, null)!;
    expect(m.platform).toEqual({ stationId: 'stn_central', name: 'Central', queue: 21 });
    expect(m.arrivals[0]).toEqual({ vehicleId: 't1', routeId: null, kind: 'train', etaS: 75 });
  });

  it('returns null without an observation', () => {
    expect(stopModel('stop_downtown', null, null)).toBeNull();
  });
});

describe('personModel', () => {
  const info: PassengerInfo = {
    id: 1234, origin: 'zone_stadium_north', dest: 'zone_apts_tower', legIndex: 1, status: 'waiting',
    waitedS: 300, patienceS: 600, reason: 'Waiting for r2: the last bus left 6 min ago',
    itinerary: {
      expectedCostS: 1500, transfers: 0,
      legs: [
        { kind: 'walk', from: { x: 0, z: 0 }, to: { x: 1, z: 1 }, durationS: 150 },
        { kind: 'bus', routes: ['r2'], board: 'stop_central_stn', alight: 'stop_apts_south' },
        { kind: 'walk', from: { x: 1, z: 1 }, to: { x: 2, z: 2 }, durationS: 200 },
      ],
    },
  };
  it('turns the itinerary into a stepper with the current leg marked', () => {
    const m = personModel(info, null)!;
    expect(m.title).toBe('Rider #1234');
    expect(m.from).toBe('Stadium North');
    expect(m.to).toBe('Apts Tower');
    expect(m.legs.map((l) => [l.label, l.detail, l.state])).toEqual([
      ['Walk', '3 min', 'done'],
      ['Bus r2', 'Central Station → Apartments South', 'now'],
      ['Walk', '4 min', 'next'],
    ]);
    expect(m.patiencePct).toBe(50);
    expect(m.reason).toBe('Waiting for r2: the last bus left 6 min ago');
  });
  it('returns null for no info', () => {
    expect(personModel(null, null)).toBeNull();
  });
});
