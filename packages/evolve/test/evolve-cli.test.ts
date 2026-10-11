import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvolveEvent, Round } from '@headway/sim';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULTS, REPO_ROOT, createDesignerLlm, designerSmoke, formatEvent, parseEnvText, parseEvolveArgs, runEvolve,
} from '../src/cli/evolve';
import { createFileStore } from '../src/cli/store-file';
import { createEvaluator, type RunOne } from '../src/evaluate';
import { broken, fakeLlm, metrics, reply, runResult, variant } from './fixtures';

/** A fast stand-in engine (J grows with the rule count) for tests that are not about the sim. */
const fakeRun: RunOne = (policy, inst) => runResult({
  scenarioId: inst.scenarioId, seed: inst.seed, controller: { kind: 'policy', policyId: policy.meta.id }, metrics: metrics({ J: 1000 + 10 * policy.rules.length }),
});
const fakeEvaluator = () => createEvaluator({ run: fakeRun, yieldBetweenRuns: false });

const TOKEN = 'sekret-admin-token-123';
const tmp = () => mkdtempSync(join(tmpdir(), 'hw-evolve-'));
const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const ls = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
function clock() {
  let s = 0;
  return () => `2026-10-11T12:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s++ % 60).padStart(2, '0')}Z`;
}
function okFetch(body: unknown = { ok: true }) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('parseEvolveArgs', () => {
  it('defaults to one round into the repo data dirs, no publish', () => {
    const o = parseEvolveArgs([]);
    expect(o).toMatchObject({
      rounds: 1, publish: null, smoke: false, model: DEFAULTS.model, fallbackModel: DEFAULTS.fallbackModel,
      dataDir: join(REPO_ROOT, 'data'), webDir: join(REPO_ROOT, 'apps', 'web', 'public', 'data'), envFile: join(REPO_ROOT, '.env'),
    });
  });

  it('parses rounds, publish (with and without a URL), dirs and flags', () => {
    expect(parseEvolveArgs(['--rounds', '3', '--publish', 'http://localhost:8787/'])).toMatchObject({ rounds: 3, publish: 'http://localhost:8787' });
    expect(parseEvolveArgs(['--publish', '--rounds', '2'])).toMatchObject({ rounds: 2, publish: DEFAULTS.publishUrl });
    expect(parseEvolveArgs(['--rounds=2', '--publish'])).toMatchObject({ rounds: 2, publish: DEFAULTS.publishUrl });
    expect(parseEvolveArgs(['--no-web']).webDir).toBeNull();
    expect(parseEvolveArgs(['--data', 'tmp/d']).dataDir).toBe(join(REPO_ROOT, 'tmp', 'd'));
    expect(parseEvolveArgs(['--data', '/abs/d']).dataDir).toBe('/abs/d');
    expect(parseEvolveArgs(['--smoke', '--emphasis', 'spacing'])).toMatchObject({ smoke: true, emphasis: 'spacing' });
    expect(parseEvolveArgs(['--model', 'm1', '--fallback-model', 'm2'])).toMatchObject({ model: 'm1', fallbackModel: 'm2' });
  });

  it('rejects bad input', () => {
    expect(() => parseEvolveArgs(['--rounds', '0'])).toThrow(/rounds/);
    expect(() => parseEvolveArgs(['--rounds', 'many'])).toThrow(/rounds/);
    expect(() => parseEvolveArgs(['--publish', 'ftp://x'])).toThrow(/publish/);
    expect(() => parseEvolveArgs(['--emphasis', 'vibes'])).toThrow(/emphasis/);
    expect(() => parseEvolveArgs(['--frobnicate'])).toThrow(/unknown option/);
  });
});

describe('parseEnvText', () => {
  it('reads KEY=VALUE lines, quotes, export and comments', () => {
    expect(parseEnvText('# c\nA=1\nexport B="two words"\nC=\'x=y\'\nD=plain # note\n\nbad line\n')).toEqual({ A: '1', B: 'two words', C: 'x=y', D: 'plain' });
  });
});

describe('createDesignerLlm', () => {
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('calls Luminal first and falls back to OpenRouter with the fallback model on 5xx', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).startsWith(DEFAULTS.luminalBaseUrl) ? new Response('busy', { status: 503 }) : ok('{"a":1}'));
    const { llm, luminal, label } = createDesignerLlm({ LUMINAL_API_KEY: 'lk', OPENROUTER_API_KEY: 'ok' }, {
      model: DEFAULTS.model, fallbackModel: DEFAULTS.fallbackModel, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(luminal).not.toBeNull();
    expect(label).toContain('luminal');
    const res = await llm.complete({ model: DEFAULTS.model, system: 's', user: 'u' });
    expect(res).toMatchObject({ provider: 'openrouter', model: DEFAULTS.fallbackModel, text: '{"a":1}' });
    const [[u1, i1], [u2, i2]] = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(u1).toBe(`${DEFAULTS.luminalBaseUrl}/chat/completions`);
    expect(new Headers(i1.headers).get('authorization')).toBe('Bearer lk');
    expect(u2).toBe(`${DEFAULTS.openRouterBaseUrl}/chat/completions`);
    expect(new Headers(i2.headers).get('authorization')).toBe('Bearer ok');
    expect(JSON.parse(String(i2.body)).model).toBe(DEFAULTS.fallbackModel);
  });

  it('uses OpenRouter alone when there is no Luminal key, and needs at least one key', async () => {
    const fetchImpl = vi.fn(async () => ok('{}'));
    const { llm, luminal } = createDesignerLlm({ OPENROUTER_API_KEY: 'ok' }, {
      model: DEFAULTS.model, fallbackModel: DEFAULTS.fallbackModel, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(luminal).toBeNull();
    expect(await llm.complete({ model: DEFAULTS.model, system: 's', user: 'u' })).toMatchObject({ provider: 'openrouter', model: DEFAULTS.fallbackModel });
    expect(() => createDesignerLlm({}, { model: 'm', fallbackModel: 'f' })).toThrow(/LUMINAL_API_KEY/);
  });

  it('honours base URL overrides from the env', async () => {
    const fetchImpl = vi.fn(async () => ok('{}'));
    const { llm } = createDesignerLlm({ LUMINAL_API_KEY: 'lk', LUMINAL_BASE_URL: 'https://lum.example/v9/' }, {
      model: 'm', fallbackModel: 'f', fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await llm.complete({ model: 'm', system: 's', user: 'u' });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('https://lum.example/v9/chat/completions');
  });
});

describe('formatEvent', () => {
  it('prints one readable line per event', () => {
    const lines = ([
      { type: 'round_start', round: 3, champion: 'g2' },
      { type: 'proposal', designer: 1, model: 'm', emphasis: 'spacing', status: 'received', summary: 'Hold less' },
      { type: 'proposal', designer: 2, model: 'm', emphasis: 'allocation', status: 'invalid', errors: ['rules[0].when[0].f: unknown feature'] },
      { type: 'eval', proposalId: 'r3-a', split: 'train', done: 8, total: 8 },
      { type: 'scored', proposalId: 'r3-a', deltaTrainPct: -2.345, narrative: 'ΔJ −2.3% on training.' },
      { type: 'decision', promoted: 'g3', reason: 'r3-a promoted to g3' },
      { type: 'error', message: 'boom' },
    ] as EvolveEvent[]).map(formatEvent);
    expect(lines[0]).toContain('R3');
    expect(lines[0]).toContain('g2');
    expect(lines[1]).toMatch(/\[b\].*spacing.*received.*Hold less/);
    expect(lines[2]).toMatch(/\[c\].*invalid.*unknown feature/);
    expect(lines[3]).toMatch(/r3-a.*train 8\/8/);
    expect(lines[4]).toMatch(/r3-a.*−2\.3%/);
    expect(lines[5]).toContain('r3-a promoted to g3');
    expect(lines[6]).toContain('boom');
    expect(formatEvent({ type: 'eval', proposalId: 'r3-a', split: 'val', done: 0, total: 4 })).toBeNull();
  });
});

describe('runEvolve', () => {
  it('runs a round on the real sim, writes data/ and web data, and publishes', { timeout: 120_000 }, async () => {
    const root = tmp();
    const dataDir = join(root, 'data');
    const webDir = join(root, 'web');
    const llm = fakeLlm([[reply(variant(6), 'A')], [reply(variant(10), 'B')], [reply(variant(12), 'C')]]);
    const fetchImpl = okFetch({ ok: true, generations: 1, rounds: 1, proposals: 3 });
    const logs: string[] = [];
    const o = parseEvolveArgs(['--rounds', '1', '--publish', 'https://example.test/', '--data', dataDir, '--web', webDir]);
    const res = await runEvolve(o, { llm, log: (s) => logs.push(s), now: clock(), fetchImpl: fetchImpl as unknown as typeof fetch, adminToken: TOKEN });

    expect(res.code).toBe(0);
    expect(ls(join(dataDir, 'rounds'))).toEqual(['R1.json']);
    const r1 = readJson<Round>(join(dataDir, 'rounds', 'R1.json'));
    expect(['done', 'failed']).toContain(r1.status);
    expect(r1).toMatchObject({ id: 'R1', championBefore: 'g0' });
    expect(r1.proposals.map((p) => p.id)).toEqual(['r1-a', 'r1-b', 'r1-c']);
    expect(r1.proposals.every((p) => p.valid && p.train?.runs === 8)).toBe(true);
    expect(ls(join(dataDir, 'generations'))).toContain('g0.json');
    expect(res.generations[0]!.id).toBe('g0');

    const events = readJson<EvolveEvent[]>(join(dataDir, 'events', 'R1.json'));
    expect(events[0]).toEqual({ type: 'round_start', round: 1, champion: 'g0' });
    expect(events[events.length - 1]!.type).toBe('decision');
    expect(readJson<{ runs: number }>(join(dataDir, 'baseline.json')).runs).toBe(8);
    expect(readJson<{ runs: number }>(join(dataDir, 'reference.json')).runs).toBe(8);

    const champion = readJson<{ generation: { id: string } }>(join(webDir, 'champion.json'));
    expect(champion.generation.id).toBe(res.generations[res.generations.length - 1]!.id);
    expect(readJson<{ rounds: Round[] }>(join(webDir, 'generations.json')).rounds.map((r) => r.id)).toEqual(['R1']);
    expect(readJson(join(webDir, 'evolve-events.json'))).toEqual(events);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://example.test/api/admin/publish');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body)) as { rounds: Round[]; generations: Array<{ id: string }>; baseline: { runs: number }; reference: { runs: number } };
    expect(body.rounds.map((r) => r.id)).toEqual(['R1']);
    expect(body.generations.map((g) => g.id)).toEqual(res.generations.map((g) => g.id));
    expect(body.baseline.runs).toBe(8);
    expect(body.reference.runs).toBe(8);
    expect(logs.join('\n')).not.toContain(TOKEN);
    expect(logs.join('\n')).toMatch(/published/i);
  });

  it('continues across rounds from the stored champion and history, and recovers a crashed round', async () => {
    const dataDir = join(tmp(), 'data');
    await createFileStore(dataDir).saveRound({
      id: 'R1', number: 1, championBefore: 'g0', championAfter: 'g0', status: 'running', proposals: [], startedAt: '2026-10-11T09:00:00Z', finishedAt: null,
    });
    const llm = fakeLlm([
      [reply(variant(6), 'A'), reply(variant(7), 'A2')],
      [reply(broken(), 'B'), reply(variant(10), 'B fixed'), reply(variant(11), 'B2')],
      [reply(variant(12), 'C'), reply(variant(13), 'C2')],
    ]);
    const logs: string[] = [];
    const res = await runEvolve(parseEvolveArgs(['--rounds', '2', '--data', dataDir, '--no-web']), { llm, log: (s) => logs.push(s), now: clock(), evaluator: fakeEvaluator() });

    expect(res.code).toBe(0);
    const rounds = createFileStore(dataDir).rounds();
    expect(rounds.map((r) => [r.id, r.status])).toEqual([['R1', 'failed'], ['R2', rounds[1]!.status], ['R3', rounds[2]!.status]]);
    expect(rounds[2]!.championBefore).toBe(rounds[1]!.championAfter);
    expect(rounds[1]!.proposals.find((p) => p.id === 'r2-b')?.valid).toBe(true);   // repaired
    const round3Prompts = llm.calls.slice(-3).map((c) => c.user).join('\n');
    expect(round3Prompts).toContain('r2-a');
    expect(logs.join('\n')).toMatch(/R1.*failed/);
  });

  it('reports a failed publish with a non-zero code but keeps the data', async () => {
    const dataDir = join(tmp(), 'data');
    const llm = fakeLlm([[reply(variant(6))], [reply(variant(10))], [reply(variant(12))]]);
    const fetchImpl = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    const logs: string[] = [];
    const res = await runEvolve(parseEvolveArgs(['--data', dataDir, '--no-web', '--publish', 'https://example.test']), {
      llm, log: (s) => logs.push(s), now: clock(), fetchImpl: fetchImpl as unknown as typeof fetch, adminToken: TOKEN, evaluator: fakeEvaluator(),
    });
    expect(res.code).toBe(1);
    expect(ls(join(dataDir, 'rounds'))).toEqual(['R1.json']);
    expect(logs.join('\n')).toMatch(/publish failed.*401/i);
  });

  it('refuses to publish without an admin token before spending any LLM calls', async () => {
    const llm = fakeLlm([[], [], []]);
    const res = await runEvolve(parseEvolveArgs(['--data', join(tmp(), 'data'), '--no-web', '--publish']), { llm, log: () => {}, now: clock() });
    expect(res.code).toBe(2);
    expect(llm.calls).toHaveLength(0);
  });
});

describe('designerSmoke', () => {
  it('makes one designer call, validates the policy and writes nothing', async () => {
    const dataDir = join(tmp(), 'data');
    const llm = fakeLlm([[reply(variant(6), 'Hold for bigger transfer groups')]]);
    const logs: string[] = [];
    const r = await designerSmoke({ llm, model: DEFAULTS.model, emphasis: 'transfers', dataDir, log: (s) => logs.push(s), evaluator: fakeEvaluator() });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toMatchObject({ model: DEFAULTS.model, json: true, maxTokens: 8000, temperature: 0.4 });
    expect(r).toMatchObject({ ok: true, summary: 'Hold for bigger transfer groups' });
    expect(r.rules).toBeGreaterThan(0);
    expect(typeof r.deltaTrainPct).toBe('number');
    expect(existsSync(dataDir)).toBe(false);
    expect(logs.join('\n')).toContain('Hold for bigger transfer groups');
  });

  it('reports validation errors for an invalid policy', async () => {
    const llm = fakeLlm([[reply(broken())]]);
    const r = await designerSmoke({ llm, model: DEFAULTS.model, emphasis: 'spacing', dataDir: join(tmp(), 'data'), log: () => {}, evaluator: fakeEvaluator() });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/train_eta/);
  });
});
