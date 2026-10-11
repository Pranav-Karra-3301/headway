import { describe, expect, it } from 'vitest';
import { crowdWalkAt, personJitter, PLATFORM_QUEUE, QUEUE_VISIBLE, queueSlot, queueVisible, STOP_QUEUE, walkAt } from './interp';

describe('people sanity', () => {
  it('draws at most QUEUE_VISIBLE waiting figures per place, head of the line first', () => {
    const shown = Array.from({ length: 200 }, (_, i) => i).filter((s) => queueVisible(s));
    expect(shown.length).toBe(QUEUE_VISIBLE);
    expect(shown[0]).toBe(0);
    expect(queueVisible(undefined)).toBe(true);
  });

  it('keeps the visible queue compact (no spill far from the stop)', () => {
    const p = { x: 0, z: 0 }, dir = { x: 0, z: 1 };
    for (const opts of [STOP_QUEUE, PLATFORM_QUEUE]) {
      for (let i = 0; i < QUEUE_VISIBLE; i++) {
        const s = queueSlot(p, dir, i, opts);
        expect(Math.hypot(s.x, s.z)).toBeLessThan(7);
        expect(Math.abs(s.x)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spreads a crowd sideways mid-walk but starts at the door and ends at the stop', () => {
    const from = { x: 0, z: 0 }, to = { x: 20, z: 0 };
    expect(crowdWalkAt(from, to, 0, 20, 0, 7)).toEqual(walkAt(from, to, 0, 20, 0));
    expect(crowdWalkAt(from, to, 0, 20, 20, 7)).toEqual({ x: 20, z: 0 });
    const zs = Array.from({ length: 50 }, (_, id) => crowdWalkAt(from, to, 0, 20, 10, id).z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.6);
    expect(Math.max(...zs.map(Math.abs))).toBeLessThanOrEqual(0.55 + 1e-9);
    for (let id = 0; id < 50; id++) expect(crowdWalkAt(from, to, 0, 20, 10, id).x).toBeCloseTo(10, 9);
  });

  it('jitter is deterministic and in [-1, 1)', () => {
    for (let id = 0; id < 500; id++) {
      const j = personJitter(id);
      expect(j).toBe(personJitter(id));
      expect(j).toBeGreaterThanOrEqual(-1);
      expect(j).toBeLessThan(1);
    }
  });
});
