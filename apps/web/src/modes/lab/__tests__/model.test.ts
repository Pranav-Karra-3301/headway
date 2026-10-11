import { describe, expect, it } from 'vitest';
import { buildTimeline, chartData, designerOfProposalId, niceTicks, pctVs, proposalOutcome, roundForGeneration, shortOutcome } from '../model';
import { gen, history, proposal, round, score } from './helpers';

describe('designerOfProposalId', () => {
  it('maps r{n}-{a|b|c} to the designer index', () => {
    expect(designerOfProposalId('r5-a')).toBe(0);
    expect(designerOfProposalId('r5-b')).toBe(1);
    expect(designerOfProposalId('r12-c')).toBe(2);
    expect(designerOfProposalId('g3')).toBeNull();
  });
});

describe('roundForGeneration', () => {
  it('finds the round whose proposal became the generation', () => {
    const { generations, rounds } = history();
    expect(roundForGeneration(generations[0]!, rounds)).toBeNull();
    expect(roundForGeneration(generations[1]!, rounds)?.id).toBe('R1');
    expect(roundForGeneration(generations[2]!, rounds)?.id).toBe('R3');
  });
});

describe('buildTimeline', () => {
  it('interleaves rounds and the generations they produced', () => {
    const { generations, rounds } = history();
    const items = buildTimeline(generations, rounds).map((i) => (i.kind === 'gen' ? i.gen.id : `${i.round.id}:${i.outcome}`));
    expect(items).toEqual(['g0', 'R1:promoted', 'g1', 'R2:rejected', 'R3:promoted', 'g2']);
  });

  it('keeps trailing rejected, failed and running rounds after the last generation', () => {
    const { generations, rounds } = history();
    rounds.push(round(4, 'g2', 'g2', [], 'failed'), round(5, 'g2', 'g2', [], 'running'));
    const items = buildTimeline(generations, rounds).map((i) => (i.kind === 'gen' ? i.gen.id : `${i.round.id}:${i.outcome}`));
    expect(items.slice(-3)).toEqual(['g2', 'R4:failed', 'R5:running']);
  });

  it('works without any rounds (generations only)', () => {
    const { generations } = history();
    expect(buildTimeline(generations, []).map((i) => (i.kind === 'gen' ? i.gen.id : 'round'))).toEqual(['g0', 'g1', 'g2']);
  });
});

describe('proposalOutcome', () => {
  const { generations, rounds } = history();
  const [r1, r2, r3] = rounds as [typeof rounds[0], typeof rounds[0], typeof rounds[0]];
  const outcome = (r: typeof r1, i: number) => proposalOutcome(r.proposals[i]!, r, generations);

  it('marks the promoted proposal with its generation', () => {
    expect(outcome(r1, 1)).toEqual({ kind: 'promoted', label: 'Promoted → g1', generationId: 'g1' });
    expect(outcome(r3, 0)).toEqual({ kind: 'promoted', label: 'Promoted → g2', generationId: 'g2' });
  });

  it('explains every rejection', () => {
    expect(outcome(r1, 2)).toEqual({ kind: 'invalid', label: 'Invalid · 1 error' });
    expect(outcome(r1, 0)).toEqual({ kind: 'rejected', label: 'Not the best this round' });
    expect(outcome(r2, 0)).toEqual({ kind: 'rejected', label: 'Validation worse' });
    expect(outcome(r2, 1)).toEqual({ kind: 'rejected', label: 'Gain under 1%' });
    expect(outcome(r2, 2)).toEqual({ kind: 'rejected', label: 'Worse on training' });
  });

  it('has short badge labels', () => {
    expect(shortOutcome(outcome(r1, 1))).toBe('Promoted → g1');
    expect(shortOutcome(outcome(r1, 2))).toBe('Invalid');
    expect(shortOutcome(outcome(r1, 0))).toBe('Runner-up');
    expect(shortOutcome(outcome(r2, 0))).toBe('Val worse');
    expect(shortOutcome(outcome(r2, 1))).toBe('Under 1%');
    expect(shortOutcome(outcome(r2, 2))).toBe('Worse');
  });

  it('shows pending proposals of a running round', () => {
    const r = round(4, 'g2', 'g2', [proposal(4, 0, {})], 'running');
    expect(proposalOutcome(r.proposals[0]!, r, generations)).toEqual({ kind: 'pending', label: 'Evaluating…' });
  });
});

describe('pctVs / niceTicks', () => {
  it('computes signed percentage change', () => {
    expect(pctVs(3_800_000, 4_000_000)).toBeCloseTo(-5, 10);
    expect(pctVs(4_400_000, 4_000_000)).toBeCloseTo(10, 10);
    expect(pctVs(1, 0)).toBe(0);
  });

  it('produces round ticks that cover the range', () => {
    const t = niceTicks(-18.4, 0.6);
    expect(t[0]).toBeLessThanOrEqual(-18.4);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(0.6);
    expect(t).toContain(0);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.length).toBeLessThanOrEqual(8);
    const steps = t.slice(1).map((v, i) => v - t[i]!);
    expect(new Set(steps.map((s) => s.toFixed(6))).size).toBe(1);
  });

  it('handles a flat range', () => {
    const t = niceTicks(0, 0);
    expect(t[0]).toBeLessThan(0);
    expect(t[t.length - 1]).toBeGreaterThan(0);
  });
});

describe('chartData', () => {
  it('builds one champion step per round, relative to g0 on each split', () => {
    const { generations, rounds } = history();
    const d = chartData({ generations, rounds, reference: score(3_720_000) });
    expect(d.steps.map((s) => s.label)).toEqual(['g0', 'g1', 'R2', 'g2']);
    expect(d.steps.map((s) => s.genId)).toEqual(['g0', 'g1', 'g1', 'g2']);
    expect(d.steps.map((s) => s.promoted)).toEqual([true, true, false, true]);
    expect(d.steps[0]!.train).toBe(0);
    expect(d.steps[1]!.train).toBeCloseTo(-5, 6);
    expect(d.steps[1]!.val).toBeCloseTo(-4, 6);
    expect(d.steps[2]!.train).toBeCloseTo(-5, 6);
    expect(d.steps[3]!.train).toBeCloseTo(-10, 6);
    expect(d.ref).toBeCloseTo(-7, 6);
  });

  it('plots valid scored candidates at their round step; invalid ones are skipped', () => {
    const { generations, rounds } = history();
    const d = chartData({ generations, rounds });
    const r1 = d.candidates.filter((c) => c.step === 1).map((c) => c.proposalId);
    expect(r1).toEqual(['r1-a', 'r1-b']);
    const r2c = d.candidates.find((c) => c.proposalId === 'r2-c')!;
    expect(r2c.pct).toBeCloseTo(4.5, 6);
    expect(d.candidates.find((c) => c.proposalId === 'r1-b')!.promoted).toBe(true);
    expect(d.candidates.find((c) => c.proposalId === 'r2-a')!.promoted).toBe(false);
  });

  it('domain covers the champion line, the ref line and the ticks', () => {
    const { generations, rounds } = history();
    const d = chartData({ generations, rounds, reference: score(3_720_000) });
    expect(d.domain[0]).toBeLessThanOrEqual(-10);
    expect(d.domain[1]).toBeGreaterThanOrEqual(4.5);
    expect(d.ticks[0]).toBe(d.domain[0]);
    expect(d.ticks[d.ticks.length - 1]).toBe(d.domain[1]);
  });

  it('adds live candidates for a running round at a new step', () => {
    const { generations, rounds } = history();
    const d = chartData({ generations, rounds, live: { round: 4, scored: [{ proposalId: 'r4-a', deltaTrainPct: -2 }] } });
    expect(d.steps[d.steps.length - 1]).toMatchObject({ label: 'R4', genId: 'g2', running: true });
    const c = d.candidates.find((x) => x.proposalId === 'r4-a')!;
    expect(c.step).toBe(4);
    expect(c.pct).toBeCloseTo((0.9 * 0.98 - 1) * 100, 6);
  });

  it('falls back to generations when there are no rounds', () => {
    const generations = [gen(0, 100, 50), gen(1, 90, 46), gen(2, 85, 44)];
    const d = chartData({ generations, rounds: [] });
    expect(d.steps.map((s) => s.label)).toEqual(['g0', 'g1', 'g2']);
    expect(d.steps[2]!.train).toBeCloseTo(-15, 6);
    expect(d.candidates).toEqual([]);
    expect(d.ref).toBeNull();
  });

  it('is empty-safe', () => {
    const d = chartData({ generations: [], rounds: [] });
    expect(d.steps).toEqual([]);
    expect(d.candidates).toEqual([]);
  });
});
