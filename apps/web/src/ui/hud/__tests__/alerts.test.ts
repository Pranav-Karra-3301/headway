import { describe, expect, it } from 'vitest';
import { createAlerts } from '../alerts';
import { obsAt, withBus, withStop } from './fixtures';

const quiet = (t: number) => obsAt(t, {
  scenario: { ...obsAt(0).scenario, advertised: [] },
});

describe('alerts: advertised events', () => {
  it('warns 2:00 before the stadium closes, exactly once', () => {
    const a = createAlerts({ map: null });
    expect(a.update(obsAt(400))).toEqual([]);
    expect(a.update(obsAt(480))).toEqual([{ kind: 'alert', text: 'Stadium closing in 2:00', simT: 480 }]);
    expect(a.update(obsAt(484))).toEqual([]);
    expect(a.update(obsAt(560))).toEqual([]);
  });
  it('rounds the lead time up to 10 s so a coarse HUD tick still reads 2:00', () => {
    const a = createAlerts({ map: null });
    expect(a.update(obsAt(484))[0]?.text).toBe('Stadium closing in 2:00');
  });
  it('announces the event itself, and never warns about the past when joining late', () => {
    const a = createAlerts({ map: null });
    expect(a.update(obsAt(605))).toEqual([{ kind: 'alert', text: 'Stadium closing now', simT: 605 }]);
    expect(a.update(obsAt(609))).toEqual([]);
    const late = createAlerts({ map: null });
    expect(late.update(obsAt(900))).toEqual([]);
  });
  it('starts over when sim time goes backwards (a new run)', () => {
    const a = createAlerts({ map: null });
    expect(a.update(obsAt(480))).toHaveLength(1);
    expect(a.update(obsAt(0))).toEqual([]);
    expect(a.update(obsAt(480))).toHaveLength(1);
  });
});

describe('alerts: service gaps', () => {
  it('flags a stop with a queue and no bus for 8+ minutes, with a per-stop cooldown', () => {
    const a = createAlerts({ map: null });
    const gap = (t: number) => withStop(quiet(t), 'stop_apts_south', {
      queue: 8, queueByRoute: { r2: 8 }, longestWaitS: 400, lastDepartureT: { r2: 100 },
    });
    expect(a.update(gap(500))).toEqual([]); // 400 s gap: not yet
    expect(a.update(gap(600))).toEqual([{ kind: 'alert', text: 'Apartments South: 8 min without a bus', simT: 600 }]);
    expect(a.update(gap(700))).toEqual([]); // cooling down
    expect(a.update(gap(860))).toEqual([{ kind: 'alert', text: 'Apartments South: 12 min without a bus', simT: 860 }]);
  });
  it('ignores small queues', () => {
    const a = createAlerts({ map: null });
    const o = withStop(quiet(900), 'stop_downtown', { queue: 2, longestWaitS: 600, lastDepartureT: {} });
    expect(a.update(o)).toEqual([]);
  });
  it('counts from the start of the run when no bus has left the stop yet', () => {
    const a = createAlerts({ map: null });
    const o = withStop(quiet(540), 'stop_old_main', { queue: 6, longestWaitS: 500, lastDepartureT: {} });
    expect(a.update(o)[0]?.text).toBe('Old Main: 9 min without a bus');
  });
});

describe('alerts: train and full vehicles', () => {
  it('announces a train arriving with many transfers, once per station visit', () => {
    const a = createAlerts({ map: null });
    const base = quiet(700);
    const o = { ...base, train: { ...base.train, state: 'moving' as const, stationId: 'stn_central' as const, etaS: 45, transfersNext: { r1: 14, r2: 9 } } };
    expect(a.update(o)).toEqual([{ kind: 'alert', text: 'Train arriving Central with 23 transfers', simT: 700 }]);
    expect(a.update({ ...o, t: 704, train: { ...o.train, etaS: 41 } })).toEqual([]);
  });
  it('stays quiet for a train with few transfers', () => {
    const a = createAlerts({ map: null });
    const base = quiet(700);
    const o = { ...base, train: { ...base.train, etaS: 30, transfersNext: { r1: 3 } } };
    expect(a.update(o)).toEqual([]);
  });
  it('reports a full bus when people are left behind', () => {
    const a = createAlerts({ map: null });
    a.update(quiet(800));
    let o = withBus(quiet(804), 'b4', { onboard: 40, capacity: 40 });
    o = { ...o, running: { ...o.running, leftBehind: 12 } };
    expect(a.update(o)).toEqual([{ kind: 'alert', text: 'Bus b4 full — 12 left behind', simT: 804 }]);
  });
  it('reports a full train when no bus is full', () => {
    const a = createAlerts({ map: null });
    a.update(quiet(800));
    const base = quiet(804);
    const o = { ...base, train: { ...base.train, onboard: 160 }, running: { ...base.running, leftBehind: 30 } };
    expect(a.update(o)[0]?.text).toBe('Train full — 30 left behind');
  });
});

describe('alerts: rate limit', () => {
  it('spaces non-event alerts by minGapS and keeps a blocked alert for later', () => {
    const a = createAlerts({ map: null, minGapS: 40 });
    const both = (t: number) => {
      const o = withStop(quiet(t), 'stop_apts_south', { queue: 8, longestWaitS: 500, lastDepartureT: { r2: 0 } });
      return { ...o, train: { ...o.train, etaS: 30, transfersNext: { r1: 20 } } };
    };
    const first = a.update(both(600));
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toMatch(/^Train arriving/);
    expect(a.update(both(620))).toEqual([]);
    expect(a.update(both(640))[0]?.text).toBe('Apartments South: 10 min without a bus');
  });
});
