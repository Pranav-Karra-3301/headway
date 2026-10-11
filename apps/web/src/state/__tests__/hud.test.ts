import { describe, expect, it } from 'vitest';
import type { Observation, PersonView, SimSnapshot } from '@headway/sim';
import { WaitTracker, buildHud, formatClock } from '../hud';

const running = { spawned: 200, completed: 50, waitingNow: 80, ridingNow: 30, meanWaitS: 123.4, missedConnections: 7, leftBehind: 3, jSoFar: 99_000 };
function snap(t: number, people: PersonView[] = [], phase: SimSnapshot['phase'] = 'running'): SimSnapshot {
  return { t, phase, vehicles: [], people, queues: [], running, events: [] };
}
const waiting = (id: number, since: number): PersonView =>
  ({ id, state: 'waiting', tint: 0, at: { kind: 'stop', id: 'stop_downtown' }, slot: 0, since });

describe('formatClock', () => {
  it('adds whole sim minutes to the scenario clock', () => {
    expect(formatClock('21:30', 125)).toBe('21:32');
    expect(formatClock('21:30', 0)).toBe('21:30');
    expect(formatClock('23:50', 1200)).toBe('00:10');
    expect(formatClock('11:45', 2700)).toBe('12:30');
  });
  it('survives a malformed clock', () => {
    expect(formatClock('', 60)).toBe('00:01');
  });
});

describe('buildHud', () => {
  it('maps running metrics, completion and clock', () => {
    const obs = { scenario: { clockStart: '21:30' } } as unknown as Observation;
    const h = buildHud(snap(600), obs, 240);
    expect(h).toMatchObject({ t: 600, clock: '21:40', phase: 'running', meanWaitS: 123.4, missedConnections: 7, waitingNow: 80, ridingNow: 30, jSoFar: 99_000, p95WaitS: 240 });
    expect(h.completionPct).toBeCloseTo(25, 5);
  });
  it('reports 0 % completion before anyone spawns', () => {
    const h = buildHud({ ...snap(0), running: { ...running, spawned: 0, completed: 0 } }, null, 0);
    expect(h.completionPct).toBe(0);
    expect(h.clock).toBe('00:00');
  });
});

describe('WaitTracker', () => {
  it('p95 covers finished waits and people still waiting', () => {
    const w = new WaitTracker();
    // 20 people wait 10..200 s and board; one person is still waiting for 1,000 s.
    const people: PersonView[] = [];
    for (let i = 0; i < 20; i++) people.push(waiting(i, 0));
    w.observe(snap(0, people));
    for (let i = 0; i < 20; i++) {
      const still = people.filter((p) => p.id > i);
      w.observe(snap((i + 1) * 10, still));
    }
    expect(w.p95(200)).toBe(190);
    w.observe(snap(1000, [waiting(97, 0), waiting(98, 0), waiting(99, 0)]));
    expect(w.p95(1000)).toBe(1000);
  });
  it('is 0 with no data and resets', () => {
    const w = new WaitTracker();
    expect(w.p95(0)).toBe(0);
    w.observe(snap(0, [waiting(1, 0)]));
    w.observe(snap(50, []));
    expect(w.p95(50)).toBe(50);
    w.reset();
    expect(w.p95(50)).toBe(0);
  });
});
