import { describe, expect, it } from 'vitest';
import type { EvolveEvent } from '@headway/sim';
import { feedLine, reduceFeed, splitVerdict } from '../feed';

const ROUND: EvolveEvent[] = [
  { type: 'round_start', round: 5, champion: 'g4' },
  { type: 'proposal', designer: 0, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'spacing', status: 'requested' },
  { type: 'proposal', designer: 1, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'allocation', status: 'requested' },
  { type: 'proposal', designer: 2, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'transfers', status: 'requested' },
  { type: 'proposal', designer: 1, model: 'deepseek/deepseek-v4-pro', emphasis: 'allocation', status: 'received', summary: 'Pre-stage two buses' },
  { type: 'proposal', designer: 0, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'spacing', status: 'repaired', summary: 'Tighter anti-bunching' },
  { type: 'proposal', designer: 2, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'transfers', status: 'invalid', errors: ['rules[1].when[0].f: unknown feature "train_eta" for bus_at_stop'] },
  { type: 'eval', proposalId: 'r5-a', split: 'train', done: 0, total: 8 },
  { type: 'eval', proposalId: 'r5-b', split: 'train', done: 0, total: 8 },
  { type: 'eval', proposalId: 'r5-a', split: 'train', done: 8, total: 8 },
  { type: 'scored', proposalId: 'r5-a', deltaTrainPct: -3.2, narrative: 'ΔJ −3.2% on training.' },
  { type: 'eval', proposalId: 'r5-b', split: 'train', done: 8, total: 8 },
  { type: 'scored', proposalId: 'r5-b', deltaTrainPct: -6.1, narrative: 'ΔJ −6.1% on training.' },
  { type: 'eval', proposalId: 'r5-b', split: 'val', done: 0, total: 4 },
  { type: 'eval', proposalId: 'r5-b', split: 'val', done: 4, total: 4 },
  { type: 'decision', promoted: 'g5', reason: 'r5-b promoted to g5: ΔJ −6.1% on training and no worse on validation.' },
];

describe('reduceFeed', () => {
  it('is idle with no events', () => {
    const s = reduceFeed([]);
    expect(s.phase).toBe('idle');
    expect(s.lanes).toHaveLength(3);
    expect(s.lanes.every((l) => l.status === 'idle')).toBe(true);
  });

  it('tracks each designer lane through a full round', () => {
    const s = reduceFeed(ROUND);
    expect(s.round).toBe(5);
    expect(s.champion).toBe('g4');
    expect(s.phase).toBe('done');
    const [a, b, c] = s.lanes;
    expect(a).toMatchObject({ designer: 0, proposalId: 'r5-a', emphasis: 'spacing', status: 'scored', summary: 'Tighter anti-bunching', repaired: true, deltaTrainPct: -3.2 });
    expect(a!.train).toEqual({ done: 8, total: 8 });
    expect(b).toMatchObject({ proposalId: 'r5-b', status: 'promoted', model: 'deepseek/deepseek-v4-pro', deltaTrainPct: -6.1 });
    expect(b!.val).toEqual({ done: 4, total: 4 });
    expect(c).toMatchObject({ proposalId: 'r5-c', status: 'invalid' });
    expect(c!.errors).toHaveLength(1);
    expect(s.decision).toEqual({ promoted: 'g5', reason: 'r5-b promoted to g5: ΔJ −6.1% on training and no worse on validation.' });
    expect(s.scored).toEqual([{ proposalId: 'r5-a', deltaTrainPct: -3.2 }, { proposalId: 'r5-b', deltaTrainPct: -6.1 }]);
  });

  it('reports intermediate phases', () => {
    expect(reduceFeed(ROUND.slice(0, 4)).phase).toBe('designing');
    const mid = reduceFeed(ROUND.slice(0, 10));
    expect(mid.phase).toBe('evaluating');
    expect(mid.lanes[0]!.status).toBe('training');
    expect(mid.lanes[1]!.status).toBe('training');
    expect(reduceFeed(ROUND.slice(0, 14)).lanes[1]!.status).toBe('validating');
  });

  it('marks the round failed when it ends on an error without a decision', () => {
    const s = reduceFeed([...ROUND.slice(0, 4), { type: 'error', message: 'Luminal timed out' }]);
    expect(s.phase).toBe('failed');
    expect(s.errors).toEqual(['Luminal timed out']);
  });

  it('keeps non-fatal errors but still finishes', () => {
    const events: EvolveEvent[] = [...ROUND.slice(0, -1), { type: 'error', message: 'r5-a: validation failed: boom' }, ROUND[ROUND.length - 1]!];
    const s = reduceFeed(events);
    expect(s.phase).toBe('done');
    expect(s.errors).toEqual(['r5-a: validation failed: boom']);
  });

  it('treats the recorded-replay note as a flag, not an error', () => {
    const note: EvolveEvent = { type: 'error', message: 'Live evolution is not available here, so this replays the last recorded round.' };
    const first = reduceFeed([note]);
    expect(first.replay).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.phase).toBe('designing');
    const s = reduceFeed([note, ...ROUND]);
    expect(s.replay).toBe(true);
    expect(s.errors).toEqual([]);
    expect(s.phase).toBe('done');
  });

  it('a rejected decision promotes nobody', () => {
    const s = reduceFeed([...ROUND.slice(0, -1), { type: 'decision', promoted: null, reason: 'No promotion: r5-b was worse on validation; g4 stays champion.' }]);
    expect(s.lanes.some((l) => l.status === 'promoted')).toBe(false);
    expect(s.decision?.promoted).toBeNull();
  });
});

describe('feedLine', () => {
  it('turns events into short readable lines', () => {
    expect(feedLine(ROUND[0]!)).toBe('Round 5 started · champion g4');
    expect(feedLine(ROUND[1]!)).toBe('Designer A (spacing) asked DeepSeek V4.1 Flash');
    expect(feedLine(ROUND[4]!)).toBe('Designer B proposed: Pre-stage two buses');
    expect(feedLine(ROUND[5]!)).toBe('Designer A repaired its policy: Tighter anti-bunching');
    expect(feedLine(ROUND[6]!)).toBe('Designer C was invalid: rules[1].when[0].f: unknown feature "train_eta" for bus_at_stop');
    expect(feedLine(ROUND[9]!)).toBe('r5-a training runs 8/8');
    expect(feedLine(ROUND[10]!)).toBe('r5-a scored ΔJ −3.2% on training');
    expect(feedLine(ROUND[ROUND.length - 1]!)).toBe('Promoted g5 · r5-b promoted to g5: ΔJ −6.1% on training and no worse on validation.');
    expect(feedLine({ type: 'error', message: 'boom' })).toBe('Error · boom');
  });
});

describe('splitVerdict', () => {
  it('separates the promotion verdict from the narrative', () => {
    expect(splitVerdict('ΔJ −6.1% on training; fewer missed transfers at Central. Rejected: validation worse.')).toEqual({
      body: 'ΔJ −6.1% on training; fewer missed transfers at Central.', verdict: 'Rejected: validation worse.',
    });
    expect(splitVerdict('ΔJ −2.0% on training. Not promoted: r3-a was promoted.')).toEqual({ body: 'ΔJ −2.0% on training.', verdict: 'Not promoted: r3-a was promoted.' });
    expect(splitVerdict('ΔJ −6.1% on training. Promoted to g5.')).toEqual({ body: 'ΔJ −6.1% on training.', verdict: 'Promoted to g5.' });
    expect(splitVerdict('Just a narrative.')).toEqual({ body: 'Just a narrative.', verdict: null });
    expect(splitVerdict('')).toEqual({ body: '', verdict: null });
  });
});
