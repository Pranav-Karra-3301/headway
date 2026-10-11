import type { EvolveEvent, Generation, Proposal } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import { designerSystemPrompt, repairPrompt } from '../src/prompts';
import { runRound, type RoundDeps } from '../src/round';
import {
  broken, collect, fakeEvaluate, fakeLlm, generation, MemoryStore, POLICY, reply, score, variant,
  type EvalRow, type Scripted,
} from './fixtures';

const BASE: Record<string, EvalRow> = { g0: { train: 1000, val: 500 }, ref: { train: 900, val: 450 }, default: { train: 1000, val: 500 } };
const VALID: Scripted[][] = [[reply(variant(6), 'A')], [reply(variant(10), 'B')], [reply(variant(12), 'C')]];

function setup(o: { script?: Scripted[][]; table?: Record<string, EvalRow>; round?: number; champion?: Generation;
  temperatures?: [number, number, number]; past?: Proposal[] }) {
  const champion = o.champion ?? generation('g0', 0, POLICY);
  const store = new MemoryStore(champion, o.round ?? 1, o.past ?? []);
  const llm = fakeLlm(o.script ?? VALID, o.temperatures);
  const ev = fakeEvaluate({ ...BASE, ...o.table });
  const { events, emit } = collect();
  let tick = 0;
  const deps: RoundDeps = {
    llm, model: 'deepseek-ai/DeepSeek-V4.1-Flash', store, emit, evaluate: ev.evaluate,
    now: () => `2026-10-11T12:00:${String(tick++).padStart(2, '0')}Z`,
    ...(o.temperatures ? { temperatures: o.temperatures } : {}),
  };
  return { store, llm, ev, events, deps };
}

const statuses = (events: EvolveEvent[], designer: number) =>
  events.flatMap((e) => (e.type === 'proposal' && e.designer === designer ? [e.status] : []));
const valIds = (calls: Array<{ id: string; split: string }>) => calls.filter((c) => c.split === 'val').map((c) => c.id).sort();

describe('runRound', () => {
  it('runs a full round: designers, scoring, promotion, records and events', async () => {
    const { store, llm, ev, events, deps } = setup({
      table: { 'r1-a': { train: 950, val: 490 }, 'r1-b': { train: 980, val: 480 }, 'r1-c': { train: 1010, val: 500 },
        'probe-rm-anti-bunch': { train: 960, val: 1 } },
    });
    const { round, generation: gen } = await runRound(deps);

    expect(round).toMatchObject({ id: 'R1', number: 1, status: 'done', championBefore: 'g0', championAfter: 'g1' });
    expect(round.startedAt).toMatch(/^2026-10-11T/);
    expect(round.finishedAt).not.toBeNull();
    expect(round.proposals.map((p) => p.id)).toEqual(['r1-a', 'r1-b', 'r1-c']);
    expect(round.proposals.map((p) => p.designer)).toEqual([0, 1, 2]);
    expect(round.proposals.every((p) => p.roundId === 'R1' && p.valid && p.errors.length === 0)).toBe(true);
    // spec §8.2: designer i in round r gets EMPHASES[(i + r) % 3], EMPHASES = [transfers, spacing, allocation]
    expect(round.proposals.map((p) => p.emphasis)).toEqual(['spacing', 'allocation', 'transfers']);
    expect(round.proposals.map((p) => p.summary)).toEqual(['A', 'B', 'C']);

    // LLM settings: temperatures [0.4, 0.7, 1.0], JSON mode, 8k tokens, shared system prompt
    expect(llm.calls.map((c) => c.temperature).sort()).toEqual([0.4, 0.7, 1.0]);
    for (const c of llm.calls) {
      expect(c).toMatchObject({ model: deps.model, json: true, maxTokens: 8000 });
      expect(c.system).toBe(designerSystemPrompt());
    }
    expect(llm.calls.find((c) => c.temperature === 0.4)!.user).toContain('SPACING:');
    expect(llm.calls.find((c) => c.temperature === 1.0)!.user).toContain('TRANSFERS:');

    // scoring
    const [a, b, c] = round.proposals as [Proposal, Proposal, Proposal];
    expect(a.deltaTrainPct).toBeCloseTo(-5);
    expect(b.deltaTrainPct).toBeCloseTo(-2);
    expect(c.deltaTrainPct).toBeCloseTo(1);
    expect(a.train!.J).toBe(950);
    expect(a.narrative).toMatch(/^ΔJ −5\.0% on training/);
    expect(a.policy!.meta).toMatchObject({ id: 'r1-a', parent: 'g0', generation: 1, emphasis: 'spacing', summary: 'A' });
    expect(a.model).toBe(deps.model);

    // promotion of the best (r1-a): new generation g1
    expect(gen).toMatchObject({ id: 'g1', number: 1, parentId: 'g0', fromProposal: 'r1-a' });
    expect(gen!.policy.meta).toMatchObject({ id: 'g1', parent: 'g0', generation: 1, emphasis: 'spacing' });
    expect(gen!.train.J).toBe(950);
    expect(gen!.val.J).toBe(490);
    expect(gen!.explanation).toContain('A');
    expect(store.generations.at(-1)!.id).toBe('g1');
    expect(a.narrative).toContain('Promoted to g1.');
    expect(b.narrative).toContain('Not promoted');
    expect(valIds(ev.calls)).toEqual(['g0', 'r1-a']);

    // events in order
    expect(events[0]).toEqual({ type: 'round_start', round: 1, champion: 'g0' });
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: 'decision', promoted: 'g1' });
    expect((last as { reason: string }).reason).toContain('r1-a');
    const at = (pred: (e: EvolveEvent) => boolean) => events.findIndex(pred);
    const requested = events.flatMap((e, i) => (e.type === 'proposal' && e.status === 'requested' ? [i] : []));
    expect(requested.map((i) => (events[i] as { designer: number }).designer)).toEqual([0, 1, 2]);
    const received = events.flatMap((e, i) => (e.type === 'proposal' && e.status === 'received' ? [i] : []));
    expect(received).toHaveLength(3);
    expect(Math.max(...requested)).toBeLessThan(Math.min(...received));
    const scored: number[] = [];
    for (const id of ['r1-a', 'r1-b', 'r1-c']) {
      const e0 = at((e) => e.type === 'eval' && e.proposalId === id && e.split === 'train' && e.done === 0 && e.total === 8);
      const e1 = at((e) => e.type === 'eval' && e.proposalId === id && e.split === 'train' && e.done === 8 && e.total === 8);
      const s = at((e) => e.type === 'scored' && e.proposalId === id);
      expect(e0).toBeGreaterThan(Math.max(...received));
      expect(e0).toBeLessThan(e1);
      expect(e1).toBeLessThan(s);
      scored.push(s);
    }
    const scoredA = events[scored[0]!] as Extract<EvolveEvent, { type: 'scored' }>;
    expect(scoredA.deltaTrainPct).toBeCloseTo(-5);
    expect(scoredA.narrative).toMatch(/^ΔJ −5\.0%/);
    const v = at((e) => e.type === 'eval' && e.split === 'val' && e.proposalId === 'r1-a' && e.done === 4 && e.total === 4);
    expect(v).toBeGreaterThan(Math.max(...scored));
    expect(v).toBeLessThan(events.length - 1);

    // sensitivity probes: one-step champion variants on training only, logged before the designers start
    const probeCalls = ev.calls.filter((c) => c.id.startsWith('probe-'));
    expect(probeCalls.length).toBeGreaterThanOrEqual(POLICY.rules.length);
    expect(probeCalls.every((c) => c.split === 'train')).toBe(true);
    const probeEvents = events.flatMap((e, i) => (e.type === 'eval' && e.proposalId.startsWith('probe: ') ? [i] : []));
    expect(probeEvents).toHaveLength(probeCalls.length);
    expect(Math.max(...probeEvents)).toBeLessThan(Math.min(...requested));
    expect(llm.calls[0]!.user).toContain('## Probes (training ΔJ vs champion');
    expect(llm.calls[0]!.user).toMatch(/## Probes [^\n]*\n- remove rule anti-bunch → −4\.0%\n/);

    // persistence: running first, final round last
    expect(store.rounds[0]).toMatchObject({ id: 'R1', status: 'running', finishedAt: null, proposals: [] });
    expect(store.rounds.at(-1)).toEqual(round);
  });

  it('repairs an invalid reply once and records it as repaired', async () => {
    const { round, llm, events, deps } = await (async () => {
      const s = setup({ script: [[reply(broken()), reply(variant(6))], VALID[1]!, VALID[2]!] });
      return { ...s, ...(await runRound(s.deps)) };
    })();
    const a = round.proposals[0]!;
    expect(a.valid).toBe(true);
    expect(a.policy).not.toBeNull();
    const d0 = llm.calls.filter((c) => c.temperature === 0.4);
    expect(d0).toHaveLength(2);
    expect(statuses(events, 0)).toEqual(['requested', 'received', 'repaired']);
    const firstErrors = (events.find((e) => e.type === 'proposal' && e.designer === 0 && e.status === 'received') as { errors?: string[] }).errors!;
    expect(firstErrors.length).toBeGreaterThan(0);
    expect(firstErrors.join('\n')).toContain('train_eta');
    expect(d0[1]!.user).toContain(repairPrompt(firstErrors));
    expect(d0[1]!.user).toContain('"train_eta"'); // the previous reply is shown back
    expect(d0[1]!).toMatchObject({ model: deps.model, json: true, temperature: 0.4 });
  });

  it('records a proposal that is still invalid after repair, and never evaluates it', async () => {
    const s = setup({ script: [VALID[0]!, [reply(broken()), reply(broken())], VALID[2]!], table: { 'r1-a': { train: 950, val: 490 } } });
    const { round } = await runRound(s.deps);
    const b = round.proposals[1]!;
    expect(b).toMatchObject({ id: 'r1-b', valid: false, policy: null, train: null, val: null, deltaTrainPct: null });
    expect(b.errors.join('\n')).toContain('train_eta');
    expect(statuses(s.events, 1)).toEqual(['requested', 'received', 'invalid']);
    expect((s.events.find((e) => e.type === 'proposal' && e.designer === 1 && e.status === 'invalid') as { errors?: string[] }).errors!.length).toBeGreaterThan(0);
    expect(s.ev.calls.some((c) => c.id === 'r1-b')).toBe(false);
    expect(round.status).toBe('done');
  });

  it('repairs a reply with no JSON at all', async () => {
    const s = setup({ script: [['Sorry, I am not sure what you want.', reply(variant(6))], VALID[1]!, VALID[2]!] });
    const { round } = await runRound(s.deps);
    expect(round.proposals[0]!.valid).toBe(true);
    expect(statuses(s.events, 0)).toEqual(['requested', 'received', 'repaired']);
    const errs = (s.events.find((e) => e.type === 'proposal' && e.designer === 0 && e.status === 'received') as { errors?: string[] }).errors!;
    expect(errs.join(' ')).toMatch(/no JSON object/i);
  });

  it('accepts a bare policy object and stamps meta (long summary clipped to 200 chars)', async () => {
    const long = { ...variant(6), meta: { ...POLICY.meta, id: 'my-policy', summary: 'x'.repeat(300) } };
    const s = setup({ script: [[JSON.stringify(long)], VALID[1]!, VALID[2]!] });
    const { round } = await runRound(s.deps);
    const a = round.proposals[0]!;
    expect(a.valid).toBe(true);
    expect(a.policy!.meta.id).toBe('r1-a');
    expect(a.summary.length).toBeLessThanOrEqual(200);
    expect(a.policy!.meta.summary.length).toBeLessThanOrEqual(200);
  });

  it('survives a designer that throws', async () => {
    const s = setup({ script: [VALID[0]!, VALID[1]!, [new Error('luminal exploded')]], table: { 'r1-a': { train: 950, val: 490 } } });
    const { round, generation: gen } = await runRound(s.deps);
    expect(round.status).toBe('done');
    const c = round.proposals[2]!;
    expect(c).toMatchObject({ id: 'r1-c', valid: false, policy: null, model: s.deps.model, emphasis: 'transfers' });
    expect(c.errors.join(' ')).toContain('luminal exploded');
    expect(statuses(s.events, 2)).toEqual(['requested', 'invalid']);
    expect(gen?.fromProposal).toBe('r1-a');
  });

  it('marks the round failed when all three designers fail, keeping the champion', async () => {
    const s = setup({ script: [[new Error('down')], [reply(broken()), 'still nothing'], ['garbage', 'garbage']] });
    const { round, generation: gen } = await runRound(s.deps);
    expect(round).toMatchObject({ status: 'failed', championBefore: 'g0', championAfter: 'g0' });
    expect(round.finishedAt).not.toBeNull();
    expect(gen).toBeNull();
    expect(s.store.generations).toHaveLength(1);
    expect(s.events.at(-1)).toMatchObject({ type: 'decision', promoted: null });
    expect(s.ev.calls.some((c) => c.id.startsWith('r1-'))).toBe(false);
    expect(s.store.rounds.at(-1)!.status).toBe('failed');
  });

  it('records an evaluation crash as an error and keeps going', async () => {
    const s = setup({ table: { 'r1-b': { train: 970, val: 480 } } });
    const evaluate = s.deps.evaluate;
    s.deps.evaluate = async (p, split) => { if (p.meta?.id === 'r1-a') throw new Error('sim blew up'); return evaluate(p, split); };
    const { round, generation: gen } = await runRound(s.deps);
    expect(round.status).toBe('done');
    expect(round.proposals[0]!.train).toBeNull();
    expect(round.proposals[0]!.errors.join(' ')).toContain('sim blew up');
    expect(s.events.some((e) => e.type === 'error' && e.message.includes('sim blew up'))).toBe(true);
    expect(gen?.fromProposal).toBe('r1-b');
  });
});

describe('promotion rule (spec §7)', () => {
  async function decide(table: Record<string, EvalRow>, champion?: Generation) {
    const s = setup({ table, ...(champion ? { champion } : {}) });
    const out = await runRound(s.deps);
    return { ...s, ...out, promoted: out.generation?.fromProposal ?? null };
  }

  it('needs at least a 1% training gain', async () => {
    const r = await decide({ 'r1-a': { train: 995, val: 400 }, 'r1-b': { train: 999, val: 400 }, 'r1-c': { train: 1200, val: 400 } });
    expect(r.promoted).toBeNull();
    expect(valIds(r.ev.calls)).toEqual([]);
    expect((r.events.at(-1) as { reason: string }).reason).toMatch(/1%/);
    expect(r.round.proposals[0]!.narrative).toContain('Rejected: less than 1% better on training.');
    expect(r.round.proposals[2]!.narrative).toContain('Rejected: worse on training (ΔJ +20.0%).');
    expect(r.round.status).toBe('done');
    expect(r.round.championAfter).toBe('g0');
  });

  it('gives the second-best one validation attempt when the best fails validation', async () => {
    const r = await decide({ 'r1-a': { train: 950, val: 510 }, 'r1-b': { train: 970, val: 495 }, 'r1-c': { train: 980, val: 400 } });
    expect(r.promoted).toBe('r1-b');
    expect(r.generation!.id).toBe('g1');
    expect(valIds(r.ev.calls)).toEqual(['g0', 'r1-a', 'r1-b']);
    expect(r.round.proposals[0]!.narrative).toContain('Rejected: validation worse.');
    expect(r.round.proposals[1]!.narrative).toContain('Promoted to g1.');
    expect(r.round.proposals[2]!.narrative).toContain('Not promoted');
  });

  it('stops after two validation attempts', async () => {
    const r = await decide({ 'r1-a': { train: 950, val: 510 }, 'r1-b': { train: 960, val: 505 }, 'r1-c': { train: 970, val: 400 } });
    expect(r.promoted).toBeNull();
    expect(valIds(r.ev.calls)).toEqual(['g0', 'r1-a', 'r1-b']);
    expect((r.events.at(-1) as { reason: string }).reason).toMatch(/validation/i);
  });

  it('promotes when validation is equal (no worse)', async () => {
    const r = await decide({ 'r1-a': { train: 950, val: 500 }, 'r1-b': { train: 1000, val: 1 }, 'r1-c': { train: 1000, val: 1 } });
    expect(r.promoted).toBe('r1-a');
  });

  it('rejects a completion drop of more than 1 point (exactly 1 is fine)', async () => {
    const r = await decide({ 'r1-a': { train: 950, val: 400, completion: 91.5 }, 'r1-b': { train: 970, val: 400, completion: 92 }, 'r1-c': { train: 1000, val: 1 } });
    expect(r.promoted).toBe('r1-b');
    expect(r.round.proposals[0]!.narrative).toMatch(/Rejected: completion fell 1\.5 pts/);
    expect(valIds(r.ev.calls)).toEqual(['g0', 'r1-b']);
  });

  it('guards the worst service gap at max(champion worst, 900 s)', async () => {
    const r = await decide({ g0: { train: 1000, val: 500, worstGapS: 600 },
      'r1-a': { train: 950, val: 400, worstGapS: 950 }, 'r1-b': { train: 970, val: 400, worstGapS: 900 }, 'r1-c': { train: 1000, val: 1 } });
    expect(r.promoted).toBe('r1-b');
    expect(r.round.proposals[0]!.narrative).toMatch(/Rejected: a stop went 16 min without service/);

    const r2 = await decide({ g0: { train: 1000, val: 500, worstGapS: 1000 },
      'r1-a': { train: 950, val: 400, worstGapS: 990 }, 'r1-b': { train: 1000, val: 1 }, 'r1-c': { train: 1000, val: 1 } });
    expect(r2.promoted).toBe('r1-a');
  });

  it('promotes from a later generation with the right ids', async () => {
    const champ = generation('g3', 3, POLICY, score(1000), score(500, {}, 4));
    const s = setup({ champion: champ, round: 5, table: { g3: { train: 1000, val: 500 }, 'r5-a': { train: 1000, val: 1 }, 'r5-b': { train: 900, val: 450 }, 'r5-c': { train: 1000, val: 1 } } });
    const { round, generation: gen } = await runRound(s.deps);
    expect(round.id).toBe('R5');
    expect(gen).toMatchObject({ id: 'g4', number: 4, parentId: 'g3', fromProposal: 'r5-b' });
    expect(gen!.policy.meta).toMatchObject({ id: 'g4', parent: 'g3', generation: 4 });
    expect(round.championAfter).toBe('g4');
  });
});

describe('designer diversity (spec §8.2)', () => {
  it('rotates emphases by round and honours custom temperatures', async () => {
    for (const [n, want] of [[2, ['allocation', 'transfers', 'spacing']], [3, ['transfers', 'spacing', 'allocation']]] as const) {
      const s = setup({ round: n, temperatures: [0.2, 0.5, 0.9] });
      const { round } = await runRound(s.deps);
      expect(round.proposals.map((p) => p.emphasis)).toEqual(want);
      expect(s.llm.calls.map((c) => c.temperature).sort()).toEqual([0.2, 0.5, 0.9]);
    }
  });

  it('shows recent proposals to the designers through the digest', async () => {
    const past: Proposal = { id: 'r1-a', roundId: 'R1', designer: 0, model: 'm', emphasis: 'transfers', summary: 'Earlier idea: hold at Central',
      rationale: '', policy: null, valid: true, errors: [], train: score(990), val: score(510, {}, 4), deltaTrainPct: -1.0, findings: [],
      narrative: 'ΔJ −1.0% on training. Rejected: validation worse.' };
    const s = setup({ round: 2, past: [past] });
    await runRound(s.deps);
    expect(s.llm.calls[0]!.user).toContain('Earlier idea: hold at Central');
    expect(s.llm.calls[0]!.user).toContain('Rejected: validation worse');
  });
});

describe('robustness', () => {
  it('asks for a repair when the proposal is identical to the champion', async () => {
    const s = setup({ script: [[reply(POLICY), reply(variant(6))], VALID[1]!, VALID[2]!] });
    const { round } = await runRound(s.deps);
    expect(round.proposals[0]!.valid).toBe(true);
    expect(statuses(s.events, 0)).toEqual(['requested', 'received', 'repaired']);
    const errs = (s.events.find((e) => e.type === 'proposal' && e.designer === 0 && e.status === 'received') as { errors?: string[] }).errors!;
    expect(errs.join(' ')).toMatch(/identical to the champion/);
  });

  it('records both errors when the repair call itself fails', async () => {
    const s = setup({ script: [[reply(broken()), new Error('rate limited')], VALID[1]!, VALID[2]!] });
    const { round } = await runRound(s.deps);
    const a = round.proposals[0]!;
    expect(a).toMatchObject({ valid: false, policy: null, train: null });
    expect(a.errors.join('\n')).toContain('train_eta');
    expect(a.errors.join('\n')).toContain('rate limited');
    expect(a.narrative).toMatch(/^Invalid: /);
    expect(statuses(s.events, 0)).toEqual(['requested', 'received', 'invalid']);
  });

  it('records the model that actually answered (fallback) and stamps it as the author', async () => {
    const s = setup({ table: { 'r1-b': { train: 900, val: 400 } } });
    const inner = s.deps.llm;
    s.deps.llm = { complete: async (req) => ({ ...(await inner.complete(req)), model: req.temperature === 0.7 ? 'deepseek/deepseek-v4-pro' : req.model }) };
    const { round, generation: gen } = await runRound(s.deps);
    expect(round.proposals.map((p) => p.model)).toEqual([s.deps.model, 'deepseek/deepseek-v4-pro', s.deps.model]);
    expect(round.proposals[1]!.policy!.meta.author).toBe('deepseek/deepseek-v4-pro');
    expect(gen!.policy.meta.author).toBe('deepseek/deepseek-v4-pro');
    const received = s.events.find((e) => e.type === 'proposal' && e.designer === 1 && e.status === 'received');
    expect(received).toMatchObject({ model: 'deepseek/deepseek-v4-pro' });
  });

  it('accepts a policy sent as a JSON string and keeps the listed changes in the rationale', async () => {
    const text = JSON.stringify({ summary: 'S', rationale: 'Because.', changes: ['first change.', 'second'], policy: JSON.stringify(variant(6)) });
    const s = setup({ script: [[text], VALID[1]!, VALID[2]!] });
    const { round } = await runRound(s.deps);
    expect(round.proposals[0]).toMatchObject({ valid: true, summary: 'S', rationale: 'Because. Changes: first change; second.' });
  });

  it('fails the round cleanly when the champion cannot be evaluated', async () => {
    const s = setup({});
    s.deps.evaluate = async () => { throw new Error('engine missing'); };
    const { round, generation: gen } = await runRound(s.deps);
    expect(gen).toBeNull();
    expect(round).toMatchObject({ status: 'failed', championAfter: 'g0', proposals: [] });
    expect(round.finishedAt).not.toBeNull();
    expect(s.llm.calls).toHaveLength(0);
    expect(s.events.map((e) => e.type)).toEqual(['round_start', 'error', 'decision']);
    expect((s.events[1] as { message: string }).message).toContain('engine missing');
    expect(s.store.rounds.at(-1)).toEqual(round);
  });

  it('keeps going when the event listener throws', async () => {
    const s = setup({ table: { 'r1-a': { train: 950, val: 490 } } });
    s.deps.emit = () => { throw new Error('stream closed'); };
    const { round, generation: gen } = await runRound(s.deps);
    expect(round.status).toBe('done');
    expect(gen?.id).toBe('g1');
  });

  it('gives the second-best its attempt when validating the best crashes', async () => {
    const s = setup({ table: { 'r1-a': { train: 950, val: 400 }, 'r1-b': { train: 970, val: 450 } } });
    const evaluate = s.deps.evaluate;
    s.deps.evaluate = async (p, split) => { if (p.meta.id === 'r1-a' && split === 'val') throw new Error('val blew up'); return evaluate(p, split); };
    const { round, generation: gen } = await runRound(s.deps);
    expect(gen?.fromProposal).toBe('r1-b');
    expect(round.proposals[0]!.narrative).toContain('Rejected: validation failed to run.');
    expect(round.proposals[0]!.errors.join(' ')).toContain('val blew up');
    expect(s.events.some((e) => e.type === 'error' && e.message.includes('val blew up'))).toBe(true);
  });

  it('promotes nothing when the champion cannot be validated', async () => {
    const s = setup({ table: { 'r1-a': { train: 950, val: 400 } } });
    const evaluate = s.deps.evaluate;
    s.deps.evaluate = async (p, split) => { if (p.meta.id === 'g0' && split === 'val') throw new Error('no val seeds'); return evaluate(p, split); };
    const { round, generation: gen } = await runRound(s.deps);
    expect(gen).toBeNull();
    expect(round).toMatchObject({ status: 'done', championAfter: 'g0' });
    expect(round.proposals[0]!.narrative).toContain('Not promoted: validation could not run.');
    expect((s.events.at(-1) as { reason: string }).reason).toMatch(/validation could not run/);
  });
});
