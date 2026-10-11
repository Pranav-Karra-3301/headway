import { describe, expect, it } from 'vitest';
import { G0 } from '@headway/sim';
import { cachedComparison, compareCrowd } from '../compare';
import { showcaseAt } from '../../../sim/session';

describe('compareCrowd', () => {
  it('runs baseline, hand-written and champion on the same crowd and caches the result', () => {
    const crowd = showcaseAt(0);
    expect(cachedComparison(crowd, null)).toBeUndefined();
    const rows = compareCrowd(crowd, null);
    expect(rows?.map((r) => r.key)).toEqual(['g0', 'ref', 'champion']);
    for (const r of rows!) {
      expect(r.waitS).toBeGreaterThan(0);
      expect(r.gaveUp).toBeGreaterThanOrEqual(0);
      expect(r.homePct).toBeGreaterThan(0);
      expect(r.homePct).toBeLessThanOrEqual(100);
    }
    // No champion loaded: the champion column falls back to the baseline policy.
    expect(rows![2]).toEqual({ ...rows![0], key: 'champion' });
    expect(compareCrowd(crowd, null)).toBe(rows);
    expect(cachedComparison(crowd, G0)).toBe(rows); // no champion = G0: same cache entry
  });
});
