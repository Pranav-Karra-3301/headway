import { G0, REF, SEEDS } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import type { Evaluate } from '../src/env';
import { isRecentPlaySeed, playDayIndex, todayPlaySeed } from '../src/play';
import { aggregate, evaluateSplit, memoEvaluate } from '../src/score';

describe('scoring with the real engine', () => {
  it('evaluateSplit runs the val split (stadium_exit + class_change × 2001–2002) and aggregates like the CLI', async () => {
    const { score, results } = await evaluateSplit(G0, 'val');
    expect(results.map((r) => [r.scenarioId, r.seed])).toEqual(SEEDS.val.map((i) => [i.scenarioId, i.seed]));
    expect(score.runs).toBe(4);
    expect(score).toEqual(aggregate(results)); // also holds once @headway/evolve's evaluatePolicy replaces the fallback
    expect(score.J).toBeCloseTo(results.reduce((s, r) => s + r.metrics.J, 0), 1);
    expect(score.metrics.completionPct).toBeGreaterThan(0);
  });

  it('evaluateSplit yields to the event loop between runs, so the /api/evolve NDJSON stream flushes while it scores', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    try {
      await evaluateSplit(G0, 'val');
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it('memoEvaluate scores each (policy body, split) once per request', async () => {
    const calls: string[] = [];
    const fake: Evaluate = async (p, split) => {
      calls.push(`${p.meta.id}/${split}`);
      return { score: { J: 1, runs: 0, metrics: aggregate([]).metrics }, results: [] };
    };
    const ev = memoEvaluate(fake);
    await Promise.all([ev(G0, 'train'), ev({ ...G0, meta: { ...G0.meta, id: 'same-body' } }, 'train'), ev(G0, 'val'), ev(REF, 'train')]);
    expect(calls).toEqual(['g0/train', 'g0/val', 'ref/train']);
  });
});

describe('play seeds', () => {
  it('follow the web: 50000 + UTC days since 2026-10-11; the last 7 days are accepted', () => {
    expect(playDayIndex(Date.UTC(2026, 9, 11, 0, 0, 0))).toBe(0);
    expect(playDayIndex(Date.UTC(2026, 9, 10, 23, 0, 0))).toBe(0);
    expect(todayPlaySeed(Date.UTC(2026, 9, 12, 23, 59, 59))).toBe(50001);
    const day10 = Date.UTC(2026, 9, 21, 9);
    expect([50003, 50004, 50010, 50011].map((s) => isRecentPlaySeed(s, day10))).toEqual([false, true, true, false]);
  });
});
