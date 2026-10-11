import { G0, validatePolicy } from '@headway/sim';
import type { Generation, Policy, Round, SplitScore } from '@headway/sim';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { admin, call, generation, proposal, resetDb, round, split, testEnv } from './helpers';

type Champion = { policy: Policy; generation: Generation | null; train: SplitScore | null; val: SplitScore | null };
type Generations = { generations: Generation[]; rounds: Round[]; baseline: SplitScore | null; reference: SplitScore | null };
type Err = { error: string; details?: string[] };

const app = createApp();
const publish = (json: unknown, headers: Record<string, string> = admin) => call(app, '/api/admin/publish', { json, headers });

beforeEach(resetDb);

describe('public reads on an empty database', () => {
  it('GET /api/champion falls back to G0', async () => {
    const res = await call(app, '/api/champion');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json<Champion>()).toEqual({ policy: G0, generation: null, train: null, val: null });
  });

  it('GET /api/generations is empty', async () => {
    const res = await call(app, '/api/generations');
    expect(res.status).toBe(200);
    expect(await res.json<Generations>()).toEqual({ generations: [], rounds: [], baseline: null, reference: null });
  });

  it('GET /api/generations/:id is 404 for an unknown id', async () => {
    const res = await call(app, '/api/generations/g9');
    expect(res.status).toBe(404);
    expect((await res.json<Err>()).error).toMatch(/g9/);
  });

  it('the deployed entry (default export) serves the same routes', async () => {
    const res = await exports.default.fetch('https://headway.test/api/champion');
    expect(res.status).toBe(200);
    expect((await res.json<Champion>()).generation).toBeNull();
  });
});

describe('admin auth', () => {
  const body = { generations: [generation(0, null)] };

  it.each([
    ['no header', {}],
    ['wrong token', { Authorization: 'Bearer nope' }],
    ['wrong scheme', { Authorization: `Basic ${btoa('admin:test-admin-token')}` }],
    ['empty bearer', { Authorization: 'Bearer ' }],
  ])('POST /api/admin/publish → 401 with %s and writes nothing', async (_name, headers) => {
    const res = await publish(body, headers as Record<string, string>);
    expect(res.status).toBe(401);
    expect((await res.json<Err>()).error).toBe('unauthorized');
    expect((await (await call(app, '/api/generations')).json<Generations>()).generations).toEqual([]);
  });

  it('rejects everything when ADMIN_TOKEN is not configured', async () => {
    const res = await call(app, '/api/admin/publish', { json: body, headers: { Authorization: 'Bearer ' }, env: testEnv({ ADMIN_TOKEN: '' }) });
    expect(res.status).toBe(401);
  });

  it('guards POST /api/evolve too', async () => {
    expect((await call(app, '/api/evolve', { method: 'POST' })).status).toBe(401);
  });
});

describe('POST /api/admin/publish', () => {
  const g0 = generation(0, null);
  const g1 = generation(1, 'r1-b');
  const R1 = round(1, [proposal(1, 0, true), proposal(1, 1, true), proposal(1, 2, false)]);

  it('round-trips generations, rounds with proposals, baseline and reference', async () => {
    const res = await publish({ generations: [g1, g0], rounds: [R1], baseline: split(1_000_000), reference: split(900_000) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, generations: 2, rounds: 1, proposals: 3 });

    const gens = await (await call(app, '/api/generations')).json<Generations>();
    expect(gens).toEqual({ generations: [g0, g1], rounds: [R1], baseline: split(1_000_000), reference: split(900_000) });

    expect(await (await call(app, '/api/champion')).json<Champion>()).toEqual({ policy: g1.policy, generation: g1, train: g1.train, val: g1.val });
    expect(await (await call(app, '/api/generations/g1')).json()).toEqual({ generation: g1, round: R1 });
    expect(await (await call(app, '/api/generations/g0')).json()).toEqual({ generation: g0, round: null });
  });

  it('upserts: re-publishing a round updates it and replaces its proposal set', async () => {
    await publish({ rounds: [round(1, [proposal(1, 0, true)], 'running', 'g0')] });
    let rounds = (await (await call(app, '/api/generations')).json<Generations>()).rounds;
    expect(rounds).toEqual([round(1, [proposal(1, 0, true)], 'running', 'g0')]);

    expect((await publish({ rounds: [R1], generations: [g0, g1] })).status).toBe(200);
    expect((await publish({ rounds: [R1], generations: [g0, g1] })).status).toBe(200); // idempotent
    rounds = (await (await call(app, '/api/generations')).json<Generations>()).rounds;
    expect(rounds).toEqual([R1]);

    const fewer = round(1, [proposal(1, 1, true)]);
    await publish({ rounds: [fewer] });
    rounds = (await (await call(app, '/api/generations')).json<Generations>()).rounds;
    expect(rounds).toEqual([fewer]);
  });

  it('409s a conflicting generation number and writes nothing from that batch', async () => {
    await publish({ generations: [g0, g1] });
    const clash = await publish({ generations: [{ ...generation(1, 'r1-b'), id: 'g1-bis' }], rounds: [R1] });
    expect(clash.status).toBe(409);
    const gens = await (await call(app, '/api/generations')).json<Generations>();
    expect(gens.generations.map((g) => g.id)).toEqual(['g0', 'g1']);
    expect(gens.rounds).toEqual([]);
  });

  it('derives the baseline from g0 when none was published', async () => {
    await publish({ generations: [g0] });
    const gens = await (await call(app, '/api/generations')).json<Generations>();
    expect(gens.baseline).toEqual(g0.train);
    expect(gens.reference).toBeNull();
  });

  it('fixtures are DSL-valid policies', () => {
    expect(validatePolicy(g0.policy).ok).toBe(true);
    expect(validatePolicy(g1.policy).ok).toBe(true);
    expect(validatePolicy(proposal(1, 0, true).policy).ok).toBe(true);
  });

  it('400s generation and valid-proposal policies that fail the DSL validator, naming the path', async () => {
    const unknownFeature = { ...g1.policy, rules: [{ ...g1.policy.rules[0], when: [{ f: 'train_eta', op: '<=', v: 60 }] }] };
    const badGen = await publish({ generations: [g0, { ...g1, policy: unknownFeature }] });
    expect(badGen.status).toBe(400);
    const genErr = await badGen.json<Err>();
    expect(genErr.details).toContainEqual(expect.stringMatching(/^generations\[1\]\.policy\.rules\[0\]\.when\[0\]\.f: unknown feature "train_eta"/));

    const valid = proposal(1, 0, true);
    const lopsided = { ...valid, policy: { ...valid.policy!, params: { ...valid.policy!.params, allocation: { r1: 3, r2: 2, r3: 2 } } } };
    const badProp = await publish({ rounds: [round(1, [lopsided])] });
    expect(badProp.status).toBe(400);
    expect((await badProp.json<Err>()).details).toContainEqual(expect.stringMatching(/^rounds\[0\]\.proposals\[0\]\.policy\.params\.allocation: must sum to 6/));

    const notAPolicy = await publish({ generations: [{ ...g0, policy: 'g0' }] });
    expect(notAPolicy.status).toBe(400);
    expect((await notAPolicy.json<Err>()).details?.some((d) => d.startsWith('generations[0].policy'))).toBe(true);

    const gens = await (await call(app, '/api/generations')).json<Generations>();
    expect(gens).toEqual({ generations: [], rounds: [], baseline: null, reference: null });
  });

  it('accepts whatever an invalid proposal carries; a non-policy is stored as null', async () => {
    const junk = { ...proposal(1, 2, false), policy: { rules: 'all of them', note: 'LLM output' } as unknown as Policy };
    const halfBaked = { ...proposal(1, 1, false), policy: { ...g1.policy, rules: [{ ...g1.policy.rules[0], id: 'Bad Id!' }] } };
    const res = await publish({ rounds: [round(1, [proposal(1, 0, true), halfBaked, junk])] });
    expect(res.status).toBe(200);
    const stored = (await (await call(app, '/api/generations')).json<Generations>()).rounds[0].proposals;
    expect(stored.map((p) => p.id)).toEqual(['r1-a', 'r1-b', 'r1-c']);
    expect(stored[1]).toEqual(halfBaked);
    expect(stored[2]).toEqual({ ...junk, policy: null });
  });

  it('400s with path-named errors for malformed bodies', async () => {
    const bad = await publish({ generations: [{ ...g1, train: { J: 'x', metrics: {}, runs: 8 } }] });
    expect(bad.status).toBe(400);
    const err = await bad.json<Err>();
    expect(err.details?.some((d) => d.startsWith('generations[0].train.J'))).toBe(true);

    const mismatch = await publish({ rounds: [{ ...R1, proposals: [{ ...proposal(1, 0, true), roundId: 'R7' }] }] });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json<Err>()).details?.some((d) => d.startsWith('rounds[0].proposals[0].roundId'))).toBe(true);

    expect((await call(app, '/api/admin/publish', { body: 'not json', headers: { ...admin, 'content-type': 'application/json' } })).status).toBe(400);
    expect((await publish({})).status).toBe(400);
    expect((await publish([g0])).status).toBe(400);
    expect((await (await call(app, '/api/generations')).json<Generations>()).generations).toEqual([]);
  });
});

describe('http plumbing', () => {
  it('allows CORS from local dev origins only', async () => {
    const pre = await call(app, '/api/champion', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');

    const local = await call(app, '/api/champion', { headers: { Origin: 'http://127.0.0.1:5321' } });
    expect(local.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5321');
    const evil = await call(app, '/api/champion', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('unknown /api routes are JSON 404s', async () => {
    const res = await call(app, '/api/nope');
    expect(res.status).toBe(404);
    expect((await res.json<Err>()).error).toBe('not found');
  });
});
