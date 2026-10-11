import { afterEach, describe, expect, it } from 'vitest';
import type { PassengerInfo } from '@headway/sim';
import { frame } from '../../../state/frame';
import { useApp } from '../../../state/store';
import type { SimRunner } from '../../../sim/runner';
import { buildInspectorModel } from '../Inspector';
import { setPaused, setSpeed } from '../SpeedControls';
import { obsAt } from './fixtures';

const fakeRunner = (passenger: (id: number) => PassengerInfo | null) => {
  const calls: string[] = [];
  const r = {
    next: { t: 10, phase: 'running', vehicles: [], people: [], queues: [], events: [], running: obsAt(10).running },
    sim: { passenger },
    setSpeed: (s: number) => calls.push(`speed:${s}`),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  };
  return { runner: r as unknown as SimRunner, calls };
};

afterEach(() => { frame.runner = null; });

describe('speed controls drive the store and the live runner', () => {
  it('setSpeed / setPaused write both', () => {
    const { runner, calls } = fakeRunner(() => null);
    frame.runner = runner;
    setSpeed(4);
    setPaused(true);
    setPaused(false);
    expect(useApp.getState().speed).toBe(4);
    expect(useApp.getState().paused).toBe(false);
    expect(calls).toEqual(['speed:4', 'pause', 'resume']);
  });
});

describe('buildInspectorModel', () => {
  it('builds a person card from sim.passenger and degrades when the sim throws or the trip is over', () => {
    const info: PassengerInfo = {
      id: 5, origin: 'zone_a', dest: 'zone_b', legIndex: 0, status: 'walking', waitedS: 0, patienceS: 600, reason: 'Walking to Downtown',
      itinerary: { legs: [{ kind: 'walk', from: { x: 0, z: 0 }, to: { x: 1, z: 1 }, durationS: 60 }], expectedCostS: 60, transfers: 0 },
    };
    frame.runner = fakeRunner(() => info).runner;
    expect(buildInspectorModel({ kind: 'person', id: '5' }, obsAt(10))).toMatchObject({ kind: 'person', m: { title: 'Rider #5' } });
    frame.runner = fakeRunner(() => { throw new Error('not implemented yet'); }).runner;
    expect(buildInspectorModel({ kind: 'person', id: '5' }, obsAt(10))).toMatchObject({ kind: 'missing', title: 'Rider #5' });
    frame.runner = fakeRunner(() => null).runner;
    expect(buildInspectorModel({ kind: 'person', id: '5' }, obsAt(10))).toMatchObject({ kind: 'missing', text: 'Trip finished' });
  });
  it('builds stop and vehicle cards from the observation, and a placeholder before the first feed', () => {
    expect(buildInspectorModel({ kind: 'stop', id: 'stop_downtown' }, obsAt(10))).toMatchObject({ kind: 'stop' });
    expect(buildInspectorModel({ kind: 'bus', id: 'b2' }, obsAt(10))).toMatchObject({ kind: 'vehicle', m: { title: 'Bus b2' } });
    expect(buildInspectorModel({ kind: 'stop', id: 'stop_downtown' }, null)).toMatchObject({ kind: 'missing' });
  });
});
