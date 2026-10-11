import type { FailureFinding, Proposal } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import { buildDigest } from '../src/digest';
import { bunching, gap, missed, overload, POLICY, runResult, score, stopStats } from './fixtures';

function proposal(p: Partial<Proposal>): Proposal {
  return { id: 'r1-a', roundId: 'R1', designer: 0, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'transfers',
    summary: 'Hold longer at Central', rationale: '', policy: POLICY, valid: true, errors: [], train: score(95_000),
    val: null, deltaTrainPct: -5, findings: [], narrative: 'ΔJ −5.0% on training.', ...p };
}

describe('buildDigest', () => {
  const results = [
    runResult({ seed: 1001, findings: [gap(9000), missed(6000), bunching(500)], ruleFires: { 'anti-bunch': 4, default: 100 },
      stops: [stopStats('stop_apts_south', 840, 120), stopStats('stop_downtown', 300, 45)] }),
    runResult({ seed: 1002, findings: [gap(7000), overload(3000)], ruleFires: { 'anti-bunch': 6, default: 90 },
      stops: [stopStats('stop_apts_south', 600, 80)] }),
  ];
  const history = [
    proposal({ id: 'r1-a', val: score(77_777, {}, 4), deltaTrainPct: -3.2, narrative: 'ΔJ −3.2% on training. Rejected: validation worse.' }),
    proposal({ id: 'r1-b', valid: false, train: null, deltaTrainPct: null, policy: null,
      errors: ['rules[1].when[0].f: unknown feature "train_eta" for bus_at_stop'], narrative: '' }),
    proposal({ id: 'r1-c', deltaTrainPct: -6.1, val: score(40_000, {}, 4), narrative: 'ΔJ −6.1% on training. Promoted to g1.' }),
  ];
  const digest = buildDigest({
    champion: { policy: POLICY, results }, baseline: score(3_600_000), reference: score(3_240_000), history,
  });

  it('has a metrics table for champion, g0 and ref in passenger-hours', () => {
    expect(digest).toMatch(/g0/);
    expect(digest).toMatch(/ref/);
    expect(digest).toContain('1000.0'); // g0: 3.6M passenger-seconds = 1000.0 passenger-hours
    expect(digest).toContain('900.0');  // ref
  });

  it('lists findings as sentences, strongest first, merged across runs', () => {
    const iGap = digest.indexOf('Apartments South went 14 min');
    const iMissed = digest.indexOf('38 riders reached Central');
    const iOver = digest.indexOf('23 people were left behind');
    expect(iGap).toBeGreaterThan(0);
    expect(iGap).toBeLessThan(iMissed);
    expect(iMissed).toBeLessThan(iOver);
    expect(digest.split('Apartments South went 14 min').length - 1).toBe(1); // merged, shown once
    expect(digest).toMatch(/2\/2 runs/);
  });

  it('shows per-stop max queue and max gap, and summed rule fires', () => {
    expect(digest).toContain('stop_apts_south');
    expect(digest).toMatch(/stop_apts_south[^\n]*120/);
    expect(digest).toMatch(/stop_apts_south[^\n]*14\.0/); // 840 s gap in minutes
    expect(digest).toMatch(/anti-bunch[^\n]*10/);
    expect(digest).toMatch(/never fired[^\n]*hold-for-connection/);
  });

  it('reports recent proposals with outcomes but never validation numbers', () => {
    expect(digest).toContain('Hold longer at Central');
    expect(digest).toContain('Rejected: validation worse');
    expect(digest).toContain('Promoted to g1');
    expect(digest).toContain('unknown feature "train_eta"');
    expect(digest).toContain('−3.2%');
    for (const leak of ['77777', '77,777', '21.6']) expect(digest).not.toContain(leak); // 77,777 s = 21.6 passenger-hours
  });

  it('stays within 6,000 characters for huge inputs', () => {
    const many: FailureFinding[] = Array.from({ length: 300 }, (_, i) =>
      gap(10_000 - i, 600 + i, `Stop ${i} went ${i} min without a bus, which is a very long sentence padded for length ${'x'.repeat(60)}.`));
    const big = buildDigest({
      champion: { policy: POLICY, results: Array.from({ length: 8 }, (_, s) => runResult({ seed: s, findings: many.map((f) => ({ ...f, stopId: 'stop_downtown' as const, routeId: (['r1', 'r2', 'r3'] as const)[s % 3] })) })) },
      baseline: score(1), reference: score(1),
      history: Array.from({ length: 40 }, (_, i) => proposal({ id: `r${i}-a`, summary: 'S'.repeat(200), narrative: 'N'.repeat(400) })),
    });
    expect(big.length).toBeLessThanOrEqual(6000);
    expect(big).toMatch(/Stop 0 went/);
  });
});
