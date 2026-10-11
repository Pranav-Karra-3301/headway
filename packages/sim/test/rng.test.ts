import { describe, expect, it } from 'vitest';
import { cyrb128, stream } from '../src/rng';

describe('rng', () => {
  it('same (seed, name) gives the same sequence', () => {
    const a = stream(1001, 'demand');
    const b = stream(1001, 'demand');
    const xs = Array.from({ length: 5 }, () => a.next());
    const ys = Array.from({ length: 5 }, () => b.next());
    expect(xs).toEqual(ys);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('different names and seeds give different sequences', () => {
    const a = Array.from({ length: 5 }, ((r) => () => r.next())(stream(1001, 'demand')));
    const b = Array.from({ length: 5 }, ((r) => () => r.next())(stream(1001, 'traffic')));
    const c = Array.from({ length: 5 }, ((r) => () => r.next())(stream(1002, 'demand')));
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('cyrb128 is a stable 4 × uint32 hash', () => {
    const h = cyrb128('1001:demand');
    expect(h).toHaveLength(4);
    for (const x of h) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(2 ** 32);
    }
    expect(cyrb128('1001:demand')).toEqual(h);
    expect(cyrb128('1001:traffic')).not.toEqual(h);
  });

  it('int(1, 3) yields only 1..3 and every value appears', () => {
    const r = stream(7, 'int');
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const v = r.int(1, 3);
      expect([1, 2, 3]).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
  });

  it('range stays inside [lo, hi)', () => {
    const r = stream(8, 'range');
    for (let i = 0; i < 500; i++) {
      const v = r.range(120, 300);
      expect(v).toBeGreaterThanOrEqual(120);
      expect(v).toBeLessThan(300);
    }
  });

  it('normal(0, 1) has mean ≈ 0 and sd ≈ 1', () => {
    const r = stream(9, 'normal');
    const n = 10_000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const v = r.normal(0, 1);
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(Math.sqrt(s2 / n - mean * mean) - 1)).toBeLessThan(0.05);
  });

  it('pick and weighted respect their inputs', () => {
    const r = stream(10, 'pick');
    const xs = ['a', 'b', 'c'] as const;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i++) counts[r.weighted(xs, [1, 0, 3])]++;
    expect(counts.b).toBe(0);
    expect(counts.c).toBeGreaterThan(counts.a * 2);
    for (let i = 0; i < 100; i++) expect(xs).toContain(r.pick(xs));
  });
});
