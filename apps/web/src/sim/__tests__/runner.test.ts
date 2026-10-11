import { describe, expect, it } from 'vitest';
import { SimRunner } from '../runner';
import { fakeSim } from './fakeSim';

describe('SimRunner.frame step accounting', () => {
  it('speed 8, dt 0.5 s → 4 steps and one snapshot', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 8);
    const snapsBefore = sim.snapshots;
    r.frame(0.5);
    expect(sim.steps).toBe(4);
    expect(sim.snapshots - snapsBefore).toBe(1);
    expect(r.next.t).toBe(4);
    expect(r.prev.t).toBe(0);
  });

  it('defaults to 8×', () => {
    const r = new SimRunner(() => fakeSim());
    expect(r.speed).toBe(8);
  });

  it('caps at 64 steps per frame and drops the backlog', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 16);
    r.frame(10); // 160 owed
    expect(sim.steps).toBe(64);
    r.frame(0); // backlog is not carried over
    expect(sim.steps).toBe(64);
  });

  it('accumulates fractional steps across frames', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 1);
    for (let i = 0; i < 63; i++) r.frame(1 / 64);
    expect(sim.steps).toBe(0);
    r.frame(1 / 64);
    expect(sim.steps).toBe(1);
    for (let i = 0; i < 64; i++) r.frame(1 / 64);
    expect(sim.steps).toBe(2);
  });

  it('alpha stays in [0, 1] and interpolated simT never runs backwards', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 4);
    let last = -1;
    for (let i = 0; i < 320; i++) {
      r.frame(1 / 64);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThanOrEqual(1);
      expect(r.simT).toBeGreaterThanOrEqual(last - 1e-9);
      last = r.simT;
    }
    expect(sim.steps).toBe(20); // 5 s × 4
  });

  it('does not step while paused, resumes after', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 8);
    r.pause();
    r.frame(0.5);
    expect(sim.steps).toBe(0);
    r.resume();
    r.frame(0.5);
    expect(sim.steps).toBe(4);
  });

  it('stops at done', () => {
    const sim = fakeSim({ endT: 10 });
    const r = new SimRunner(() => sim, 16);
    for (let i = 0; i < 10; i++) r.frame(0.5);
    expect(sim.steps).toBe(10);
    expect(r.sim.done).toBe(true);
    expect(r.next.phase).toBe('done');
  });

  it('halts the frame on a pending async decision', () => {
    const sim = fakeSim();
    sim.pendingAt.add(2);
    const r = new SimRunner(() => sim, 8);
    r.frame(0.5);
    expect(sim.steps).toBe(2);
  });

  it('setSpeed changes the step rate; reset swaps the sim and zeroes the clock', () => {
    const a = fakeSim();
    const r = new SimRunner(() => a, 8);
    r.setSpeed(16);
    r.frame(0.5);
    expect(a.steps).toBe(8);
    const b = fakeSim();
    r.reset(() => b);
    expect(r.sim).toBe(b);
    expect(r.next.t).toBe(0);
    expect(r.prev.t).toBe(0);
    r.frame(0.25);
    expect(b.steps).toBe(4);
  });

  it('forwards intents to the sim', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim);
    r.intent({ type: 'dispatch', vehicleId: 'b1' });
    expect(sim.intents).toEqual([{ type: 'dispatch', vehicleId: 'b1' }]);
  });

  it('ignores negative and non-finite dt', () => {
    const sim = fakeSim();
    const r = new SimRunner(() => sim, 8);
    r.frame(-1);
    r.frame(Number.NaN);
    r.frame(Number.POSITIVE_INFINITY);
    expect(sim.steps).toBe(0);
  });
});
