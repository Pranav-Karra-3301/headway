import { describe, expect, it } from 'vitest';
import { lerpDist, queueSlot, walkAt } from '../interp';

describe('lerpDist', () => {
  it('interpolates forward along a path', () => {
    expect(lerpDist(10, 20, 0, 100, true)).toBeCloseTo(10);
    expect(lerpDist(10, 20, 0.5, 100, true)).toBeCloseTo(15);
    expect(lerpDist(10, 20, 1, 100, true)).toBeCloseTo(20);
  });
  it('wraps on closed paths (short way forward across the seam)', () => {
    expect(lerpDist(95, 5, 0.5, 100, true)).toBeCloseTo(0);
    expect(lerpDist(98, 4, 0.25, 100, true)).toBeCloseTo(99.5);
    expect(lerpDist(98, 4, 0.75, 100, true)).toBeCloseTo(2.5);
    const v = lerpDist(99, 1, 0.9, 100, true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(100);
  });
  it('never wraps on open paths and clamps to the path', () => {
    expect(lerpDist(10, 20, 0.5, 30, false)).toBeCloseTo(15);
    expect(lerpDist(25, 5, 0.5, 30, false)).toBeCloseTo(15);
    expect(lerpDist(28, 40, 1, 30, false)).toBeCloseTo(30);
  });
});

describe('queueSlot', () => {
  const p = { x: 4, z: -2 };
  const dir = { x: 0, z: 1 };
  it('puts slot 0 just off the stop along queueDir and grows the line along queueDir', () => {
    const s0 = queueSlot(p, dir, 0);
    const s1 = queueSlot(p, dir, 1);
    expect(s0.x).toBeCloseTo(4);
    expect(s0.z).toBeGreaterThan(p.z);
    expect(s1.z).toBeGreaterThan(s0.z);
    expect(s1.x).toBeCloseTo(s0.x);
  });
  it('starts a parallel line after perRow slots and keeps every slot distinct', () => {
    const opts = { spacing: 0.4, perRow: 5, rowGap: 0.45, offset: 0.8 };
    const pts = Array.from({ length: 40 }, (_, i) => queueSlot(p, dir, i, opts));
    expect(pts[5]!.x).not.toBeCloseTo(4);
    expect(pts[5]!.z).toBeCloseTo(pts[0]!.z);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(0.3);
    for (const q of pts) expect((q.x - p.x) * dir.x + (q.z - p.z) * dir.z).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });
});

describe('walkAt', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 10, z: -4 };
  it('interpolates a straight walk over [t0, t1] and clamps outside it', () => {
    expect(walkAt(from, to, 100, 110, 90)).toEqual({ x: 0, z: 0 });
    expect(walkAt(from, to, 100, 110, 105)).toEqual({ x: 5, z: -2 });
    expect(walkAt(from, to, 100, 110, 200)).toEqual({ x: 10, z: -4 });
    expect(walkAt(from, to, 100, 100, 100)).toEqual({ x: 10, z: -4 });
  });
});
