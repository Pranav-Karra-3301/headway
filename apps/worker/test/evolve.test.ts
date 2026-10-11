import { env } from 'cloudflare:test';
import { G0 } from '@headway/sim';
import type { EvolveEvent, Generation, Policy, Round, SplitScore } from '@headway/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AppDeps } from '../src/env';
import { admin, call, LUMINAL_KEY, OR_KEY, readNdjson, resetDb, testEnv } from './helpers';
import { fakeEvaluate, fakeLlm, reply, variant } from './evolve-fakes';

type Generations = { generations: Generation[]; rounds: Round[]; baseline: SplitScore | null; reference: SplitScore | null };
type Champion = { policy: Policy; generation: Generation | null };
type Err = { error: string; details?: string[] };

const T0 = Date.UTC(2026, 9, 11, 20, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const TABLE = {
  g0: { train: 1_000_000, val: 500_000 },
  ref: { train: 950_000, val: 480_000 },
  'r1-a': { train: 940_000, val: 490_000 },
  'r1-b': { train: 990_000, val: 499_000 },
  'r1-c': { train: 1_010_000, val: 505_000 },
  g1: { train: 940_000, val: 490_000 },
  'r2-a': { train: 939_000, val: 489_000 },
};

function round1Llm() {
  return fakeLlm([
    [reply(variant('dwell'), 'Longer train dwell for transfers')],
    [reply(variant('alloc'), 'Move a bus from Route 3 to Route 2')],
    ['I cannot answer in JSON, sorry.', 'Still no JSON.'],
  ]);
}

function setup(over: Partial<AppDeps> = {}, llm = round1Llm()) {
  const ev = fakeEvaluate(TABLE);
  const app = createApp({ designer: () => ({ llm, model: 'deepseek-ai/DeepSeek-V4.1-Flash' }), evaluate: ev.evaluate, now: () => T0, ...over });
  return { app, ev, llm };
}

const evolve = (app: ReturnType<typeof createApp>, path = '/api/evolve', e = testEnv()) => call(app, path, { method: 'POST', headers: admin, env: e });
const generations = async (app: ReturnType<typeof createApp>) => (await call(app, '/api/generations')).json<Generations>();
const roundRow = (id: string) =>
  env.DB.prepare('SELECT status, started_at, finished_at, events_json FROM rounds WHERE id = ?1').bind(id)
    .first<{ status: string; started_at: string; finished_at: string | null; events_json: string }>();

beforeEach(resetDb);

describe('POST /api/evolve', () => {
  it('streams one round as NDJSON, persists every step and promotes the winner', async () => {
    const { app, ev, llm } = setup();
    const res = await evolve(app);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const events = await readNdjson<EvolveEvent>(res);

    expect(events[0]).toEqual({ type: 'round_start', round: 1, champion: 'g0' });
    expect(events.at(-1)).toMatchObject({ type: 'decision', promoted: 'g1' });
    const statuses = events.flatMap((e) => (e.type === 'proposal' ? [`${e.designer}:${e.status}`] : []));
    expect(statuses).toEqual(expect.arrayContaining(['0:requested', '1:requested', '2:requested', '0:received', '1:received', '2:invalid']));
    expect(events).toContainEqual(expect.objectContaining({ type: 'scored', proposalId: 'r1-a', deltaTrainPct: -6 }));
    expect(events).toContainEqual({ type: 'eval', proposalId: 'r1-a', split: 'val', done: 4, total: 4 });
    expect(llm.calls).toHaveLength(4); // 3 designers + 1 repair

    // champion scores are computed once per (policy, split) within a round
    const keys = ev.calls.map((c) => `${c.id}/${c.split}`);
    expect(keys.filter((k) => k === 'g0/train')).toHaveLength(1);
    expect(keys.filter((k) => k === 'g0/val')).toHaveLength(1);

    // every event is persisted on the round row; the round, its proposals and both generations are in D1
    const row = await roundRow('R1');
    expect(row?.status).toBe('done');
    expect(JSON.parse(row!.events_json)).toEqual(events);

    const gens = await generations(app);
    expect(gens.generations.map((g) => [g.id, g.number, g.parentId, g.fromProposal, g.train.J])).toEqual([
      ['g0', 0, null, null, 1_000_000],
      ['g1', 1, 'g0', 'r1-a', 940_000],
    ]);
    expect(gens.generations[0].policy.rules).toEqual(G0.rules);
    expect(gens.generations[1].policy.meta).toMatchObject({ id: 'g1', parent: 'g0', generation: 1 });
    expect(gens.rounds).toHaveLength(1);
    const R1 = gens.rounds[0];
    expect(R1).toMatchObject({ id: 'R1', number: 1, status: 'done', championBefore: 'g0', championAfter: 'g1' });
    expect(R1.proposals.map((p) => [p.id, p.valid])).toEqual([['r1-a', true], ['r1-b', true], ['r1-c', false]]);
    expect(gens.baseline?.J).toBe(1_000_000);
    expect(gens.reference?.J).toBe(950_000);

    const champ = await (await call(app, '/api/champion')).json<Champion>();
    expect(champ.generation?.id).toBe('g1');
    expect(champ.policy.params.trainDefaultDwellS).toBe(60);
  });

  it('runs the next round from the stored champion, with the stored proposals as history', async () => {
    const first = setup();
    await (await evolve(first.app)).arrayBuffer();

    const llm = fakeLlm([
      [reply(variant('alloc'), 'Rebalance toward Route 2')],
      ['nope', 'nope'],
      [reply(variant('dwell'), 'Same as the champion')],
    ]);
    const { app } = setup({}, llm);
    const events = await readNdjson<EvolveEvent>(await evolve(app));
    expect(events[0]).toEqual({ type: 'round_start', round: 2, champion: 'g1' });
    expect(events.at(-1)).toMatchObject({ type: 'decision', promoted: null });
    expect(llm.calls[0].user).toContain('r1-a');

    const gens = await generations(app);
    expect(gens.generations.map((g) => g.id)).toEqual(['g0', 'g1']);
    expect(gens.rounds.map((r) => [r.id, r.status, r.championBefore, r.championAfter])).toEqual([
      ['R1', 'done', 'g0', 'g1'],
      ['R2', 'done', 'g1', 'g1'],
    ]);
    const r2c = gens.rounds[1].proposals.find((p) => p.id === 'r2-c');
    expect(r2c?.valid).toBe(false);
    expect(r2c?.errors.join(' ')).toMatch(/identical to the champion/);
  });

  it('allows one running round at a time; the lock goes stale after 10 minutes', async () => {
    const { app, llm } = setup();
    await env.DB.prepare(`INSERT INTO rounds (id, number, champion_before, status, started_at) VALUES ('R1', 1, 'g0', 'running', ?1)`)
      .bind(iso(T0 - 60_000)).run();

    const busy = await evolve(app);
    expect(busy.status).toBe(409);
    expect((await busy.json<Err>()).error).toMatch(/R1 is already running/);
    expect(llm.calls).toHaveLength(0);
    expect((await roundRow('R1'))?.status).toBe('running');

    await env.DB.prepare(`UPDATE rounds SET started_at = ?1 WHERE id = 'R1'`).bind(iso(T0 - 11 * 60_000)).run();
    const events = await readNdjson<EvolveEvent>(await evolve(app));
    expect(events[0]).toEqual({ type: 'round_start', round: 2, champion: 'g0' });
    expect((await roundRow('R1'))?.status).toBe('failed');
    expect((await roundRow('R2'))?.status).toBe('done');
  });

  it('?force=1 breaks a fresh lock', async () => {
    const { app } = setup();
    await env.DB.prepare(`INSERT INTO rounds (id, number, champion_before, status, started_at) VALUES ('R1', 1, 'g0', 'running', ?1)`)
      .bind(iso(T0 - 5_000)).run();
    const res = await evolve(app, '/api/evolve?force=1');
    expect(res.status).toBe(200);
    expect((await readNdjson<EvolveEvent>(res))[0]).toEqual({ type: 'round_start', round: 2, champion: 'g0' });
    expect((await roundRow('R1'))?.status).toBe('failed');
  });

  it('keeps the champion and releases the lock when every designer fails', async () => {
    const llm = fakeLlm([[new Error('boom')], [new Error('boom')], [new Error('boom')]]);
    const { app } = setup({}, llm);
    const events = await readNdjson<EvolveEvent>(await evolve(app));
    expect(events.at(-1)).toMatchObject({ type: 'decision', promoted: null });
    expect((await roundRow('R1'))?.status).toBe('failed');
    expect((await generations(app)).generations.map((g) => g.id)).toEqual(['g0']);

    const again = await evolve(setup().app);
    expect(again.status).toBe(200);
    expect((await readNdjson<EvolveEvent>(again))[0]).toMatchObject({ type: 'round_start', round: 2 });
  });

  it('reports an unexpected failure on the stream, marks the round failed and frees the lock', async () => {
    const broken = fakeEvaluate({});
    const { app } = setup({ evaluate: broken.evaluate });
    const res = await evolve(app);
    expect(res.status).toBe(200);
    const events = await readNdjson<EvolveEvent>(res);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as { message: string }).message).toMatch(/no eval row for g0/);
    expect(events.at(-1)).toMatchObject({ type: 'decision', promoted: null });
    const row = await roundRow('R1');
    expect(row?.status).toBe('failed');
    expect(row?.finished_at).toBe(iso(T0));
    expect(JSON.parse(row!.events_json)).toEqual(events);

    expect((await evolve(setup().app)).status).toBe(200);
  });

  it('503s without writing anything when no designer LLM is configured', async () => {
    const ev = fakeEvaluate(TABLE);
    const app = createApp({ evaluate: ev.evaluate, now: () => T0 });
    const res = await evolve(app, '/api/evolve', testEnv({ LUMINAL_API_KEY: '', OPENROUTER_API_KEY: '' }));
    expect(res.status).toBe(503);
    expect((await res.json<Err>()).error).toMatch(/not available/);
    expect((await generations(app)).rounds).toEqual([]);
  });

  it('calls Luminal by default and falls back to OpenRouter deepseek-v4-pro on a 5xx', async () => {
    const calls: Array<{ url: string; auth: string | null; body: { model: string; temperature: number; response_format?: unknown } }> = [];
    const completion = (text: string) => Response.json({ choices: [{ message: { role: 'assistant', content: text } }] });
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = JSON.parse(String(init?.body));
      calls.push({ url, auth: new Headers(init?.headers).get('authorization'), body });
      if (url.startsWith(env.LUMINAL_BASE_URL)) {
        if (body.temperature === 1) return new Response('overloaded', { status: 503 });
        return completion(reply(body.temperature === 0.4 ? variant('dwell') : variant('alloc'), 'A change'));
      }
      return completion(reply(variant('hold'), 'Shorter holds'));
    }) as typeof fetch;
    const ev = fakeEvaluate(TABLE);
    const app = createApp({ fetch: f, evaluate: ev.evaluate, now: () => T0 });
    const events = await readNdjson<EvolveEvent>(await evolve(app));
    expect(events.at(-1)).toMatchObject({ type: 'decision' });

    const luminal = calls.filter((c) => c.url === `${env.LUMINAL_BASE_URL}/chat/completions`);
    const openrouter = calls.filter((c) => c.url === `${env.OPENROUTER_BASE_URL}/chat/completions`);
    expect(luminal).toHaveLength(3);
    expect(openrouter).toHaveLength(1);
    expect(luminal.every((c) => c.auth === `Bearer ${LUMINAL_KEY}` && c.body.model === env.LUMINAL_MODEL)).toBe(true);
    expect(luminal[0].body.response_format).toEqual({ type: 'json_object' });
    expect(openrouter[0]).toMatchObject({ auth: `Bearer ${OR_KEY}`, body: { model: 'deepseek/deepseek-v4-pro', temperature: 1 } });

    const R1 = (await generations(app)).rounds[0];
    expect(R1.proposals.map((p) => [p.id, p.model])).toEqual([
      ['r1-a', env.LUMINAL_MODEL],
      ['r1-b', env.LUMINAL_MODEL],
      ['r1-c', 'deepseek/deepseek-v4-pro'],
    ]);
  });
});
