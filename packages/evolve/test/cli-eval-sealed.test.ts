// T8: eval-sealed CLI (sealed test seeds from .env, champion/g0/ref evaluation, POST /api/admin/sealed-eval). Seeds must never leak.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { G0, REF } from '@headway/sim';
import type { Metrics, Policy, RunResult, ScenarioInstance } from '@headway/sim';
import {
  ensureSealedSeeds, generateSeeds, main, parseEnvText, parseSealedSeeds, postSealedEval, runSealedEval, sealedInstances, seedSetId,
  type SealedEvalBody,
} from '../src/cli/eval-sealed';
import type { SimRun } from '../src/cli/sweep';

const tmp = () => mkdtempSync(join(tmpdir(), 'hw-sealed-'));
function metrics(J: number): Metrics {
  return {
    J, spawned: 1000, completed: 960, unfinished: 40, completionPct: 96, meanJourneyS: 800, meanWaitS: 200, p95WaitS: 600, maxWaitS: 900,
    transfersMade: 100, missedConnections: 5, leftBehind: 10, walkaways: 2,
    effort: { busDistanceU: 4000, deadheadDistanceU: 0, holdS: 300, trainDwellS: 800 },
  };
}
function fakeRun(table: Record<string, number>): SimRun & { calls: string[] } {
  const calls: string[] = [];
  const run = ((policy: Policy, inst: ScenarioInstance): RunResult => {
    calls.push(`${policy.meta.id}:${inst.scenarioId}:${inst.split}`);
    return {
      simVersion: '1', mapVersion: 'town-1', scenarioId: inst.scenarioId, seed: inst.seed, controller: { kind: 'policy', policyId: policy.meta.id },
      metrics: metrics(table[policy.meta.id] ?? 1), stops: [], findings: [], ruleFires: {}, hash: 'h',
    };
  }) as SimRun & { calls: string[] };
  run.calls = calls;
  return run;
}
/** Deterministic "random" ints for seed generation. */
function seq(...xs: number[]) {
  let i = 0;
  return (lo: number, hi: number) => {
    const x = xs[i++ % xs.length]!;
    expect(x).toBeGreaterThanOrEqual(lo);
    expect(x).toBeLessThan(hi);
    return x;
  };
}
const SEEDS = [123457, 234568, 345679];
const leaks = (text: string) => SEEDS.filter((s) => text.includes(String(s)));

describe('.env parsing', () => {
  it('reads KEY=VALUE lines with comments, export prefixes and quotes', () => {
    const env = parseEnvText('# comment\nA=1\nexport B="two words"\nC=\'x=y\'\n\nD = spaced \nE=plain # trailing\nnot a line\n');
    expect(env).toEqual({ A: '1', B: 'two words', C: 'x=y', D: 'spaced', E: 'plain' });
  });
});

describe('sealed seeds', () => {
  it('parses a JSON array or a comma list of distinct positive integers', () => {
    expect(parseSealedSeeds('[101, 202, 303]')).toEqual([101, 202, 303]);
    expect(parseSealedSeeds('101,202, 303')).toEqual([101, 202, 303]);
    for (const bad of ['', '[]', '[1.5]', '["a"]', '[-1]', 'x,y', '[1,1]', '{"a":1}']) expect(() => parseSealedSeeds(bad)).toThrow(/SEALED_TEST_SEEDS/);
  });
  it('generates 3 distinct seeds away from the train/val/showcase/play ranges', () => {
    expect(generateSeeds(3, seq(SEEDS[0]!, SEEDS[0]!, SEEDS[1]!, SEEDS[2]!))).toEqual(SEEDS);
    const real = generateSeeds();
    expect(real).toHaveLength(3);
    expect(new Set(real).size).toBe(3);
    for (const s of real) expect(s >= 100_000 && s < 900_000).toBe(true);
  });
  it('writes generated seeds into .env once, keeps the other lines, and reuses them afterwards', () => {
    const dir = tmp();
    const envPath = join(dir, '.env');
    writeFileSync(envPath, 'OPENROUTER_API_KEY=abc\nADMIN_TOKEN=tok', { mode: 0o600 });
    const first = ensureSealedSeeds(envPath, { randInt: seq(...SEEDS) });
    expect(first).toEqual({ seeds: SEEDS, generated: true });
    const text = readFileSync(envPath, 'utf8');
    expect(text).toBe(`OPENROUTER_API_KEY=abc\nADMIN_TOKEN=tok\nSEALED_TEST_SEEDS=[${SEEDS.join(',')}]\n`);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(ensureSealedSeeds(envPath, { randInt: seq(999_999) })).toEqual({ seeds: SEEDS, generated: false });
  });
  it('creates a private .env when there is none', () => {
    const envPath = join(tmp(), '.env');
    expect(ensureSealedSeeds(envPath, { randInt: seq(...SEEDS) }).generated).toBe(true);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(envPath, 'utf8')).toBe(`SEALED_TEST_SEEDS=[${SEEDS.join(',')}]\n`);
  });
  it('fingerprints the seed set without revealing it', () => {
    const id = seedSetId(SEEDS);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(seedSetId([...SEEDS].reverse())).toBe(id);
    expect(seedSetId([1, 2, 3])).not.toBe(id);
    expect(leaks(id)).toEqual([]);
  });
  it('crosses scenarios × seeds on the test split', () => {
    expect(sealedInstances([7, 8], ['stadium_exit', 'class_change'])).toEqual([
      { scenarioId: 'stadium_exit', seed: 7, split: 'test' }, { scenarioId: 'stadium_exit', seed: 8, split: 'test' },
      { scenarioId: 'class_change', seed: 7, split: 'test' }, { scenarioId: 'class_change', seed: 8, split: 'test' },
    ]);
  });
});

describe('runSealedEval', () => {
  const instances = sealedInstances(SEEDS, ['stadium_exit', 'class_change']);
  const champion = { label: 'g4', policy: { ...structuredClone(REF), meta: { ...REF.meta, id: 'g4' } } };

  it('scores champion, baseline and reference on every sealed instance', () => {
    const run = fakeRun({ g4: 900, g0: 1000, ref: 950 });
    const body = runSealedEval({ champion, instances, run, now: () => '2026-10-11T18:00:00.000Z' });
    expect(run.calls).toHaveLength(18);
    expect(run.calls.every((c) => c.endsWith(':test'))).toBe(true);
    expect(body).toMatchObject({ simVersion: '1', mapVersion: 'town-1', scenarios: ['stadium_exit', 'class_change'], seedsPerScenario: 3, runs: 6,
      seedSet: seedSetId(SEEDS), createdAt: '2026-10-11T18:00:00.000Z' });
    expect(body.results.map((r) => [r.role, r.policyId, r.jTest])).toEqual([['champion', 'g4', 5400], ['baseline', 'g0', 6000], ['reference', 'ref', 5700]]);
    expect(body.results[0]!.deltaVsBaselinePct).toBeCloseTo(-10, 6);
    expect(body.results[0]!.byScenario.stadium_exit!.J).toBe(2700);
    expect(body.results[0]!.score.runs).toBe(6);
    expect(body.results[0]!.metrics).toEqual(body.results[0]!.score.metrics);
    expect(body.results[0]!.metrics.J).toBe(5400);
    expect(body.results.every((r) => r.createdAt === '2026-10-11T18:00:00.000Z' && r.simVersion === '1')).toBe(true);
    expect(leaks(JSON.stringify(body))).toEqual([]);
  });

  it('does not re-run g0 when the champion is g0', () => {
    const run = fakeRun({ g0: 1000, ref: 950 });
    const body = runSealedEval({ champion: { label: 'g0', policy: G0 }, instances, run });
    expect(run.calls).toHaveLength(12);
    expect(body.results.map((r) => r.policyId)).toEqual(['g0', 'g0', 'ref']);
  });
});

describe('postSealedEval', () => {
  it('POSTs the body with the admin bearer token', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ ok: true, stored: 3 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const body = { results: [] } as unknown as SealedEvalBody;
    const r = await postSealedEval('https://w.test/', 'tok', body, fetchImpl);
    expect(r).toEqual({ ok: true, status: 200, response: { ok: true, stored: 3 } });
    expect(seen[0]!.url).toBe('https://w.test/api/admin/sealed-eval');
    expect(seen[0]!.init.method).toBe('POST');
    expect(new Headers(seen[0]!.init.headers).get('authorization')).toBe('Bearer tok');
    expect(new Headers(seen[0]!.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual(body);
  });
  it('reports HTTP errors and network failures without throwing', async () => {
    const notImpl = (async () => new Response('{"error":"not implemented yet"}', { status: 501 })) as unknown as typeof fetch;
    expect(await postSealedEval('https://w.test', 't', {} as SealedEvalBody, notImpl)).toEqual({ ok: false, status: 501, response: { error: 'not implemented yet' } });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await postSealedEval('https://w.test', 't', {} as SealedEvalBody, down)).toMatchObject({ ok: false, status: 0 });
  });
});

describe('main', () => {
  function setup(envText = 'ADMIN_TOKEN=secret-token\n') {
    const dir = tmp();
    const envPath = join(dir, '.env');
    writeFileSync(envPath, envText, { mode: 0o600 });
    const logs: string[] = [];
    const posts: Array<{ url: string; body: SealedEvalBody; auth: string | null }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      posts.push({ url: String(url), body: JSON.parse(String(init!.body)), auth: new Headers(init!.headers).get('authorization') });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    const deps = { run: fakeRun({ g0: 1000, ref: 950, g4: 900 }), fetch: fetchImpl, log: (s: string) => logs.push(s), randInt: seq(...SEEDS), dataDir: dir, processEnv: {} };
    return { dir, envPath, logs, posts, deps };
  }

  it('generates seeds, evaluates, POSTs, and never prints the seeds or the token', async () => {
    const s = setup();
    expect(await main(['--env', s.envPath, '--url', 'https://w.test', '--champion', 'g0'], s.deps)).toBe(0);
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]!.url).toBe('https://w.test/api/admin/sealed-eval');
    expect(s.posts[0]!.auth).toBe('Bearer secret-token');
    expect(s.posts[0]!.body.results.map((r) => r.role)).toEqual(['champion', 'baseline', 'reference']);
    const text = s.logs.join('\n');
    expect(text).toMatch(/generated 3 sealed test seeds/i);
    expect(text).toMatch(/wrangler secret put SEALED_TEST_SEEDS/);
    expect(leaks(text)).toEqual([]);
    expect(leaks(JSON.stringify(s.posts))).toEqual([]);
    expect(text).not.toContain('secret-token');
    expect(readFileSync(s.envPath, 'utf8')).toContain('SEALED_TEST_SEEDS=');
  });

  it('reuses existing seeds, and --no-post / no --url skip the POST', async () => {
    const s = setup(`ADMIN_TOKEN=t\nSEALED_TEST_SEEDS=[${SEEDS.join(',')}]\n`);
    expect(await main(['--env', s.envPath, '--champion', 'g0'], s.deps)).toBe(0);
    expect(await main(['--env', s.envPath, '--url', 'https://w.test', '--no-post', '--champion', 'g0'], s.deps)).toBe(0);
    expect(s.posts).toHaveLength(0);
    const text = s.logs.join('\n');
    expect(text).toMatch(/using 3 sealed test seeds/i);
    expect(text).not.toMatch(/generated/i);
    expect(leaks(text)).toEqual([]);
  });

  it('writes --out without seeds', async () => {
    const s = setup();
    const out = join(s.dir, 'sealed.json');
    expect(await main(['--env', s.envPath, '--champion', 'g0', '--out', out], s.deps)).toBe(0);
    const saved = readFileSync(out, 'utf8');
    expect(JSON.parse(saved).results).toHaveLength(3);
    expect(leaks(saved)).toEqual([]);
  });

  it('fails clearly without ADMIN_TOKEN when posting, and when the POST is rejected', async () => {
    const s = setup('');
    expect(await main(['--env', s.envPath, '--url', 'https://w.test', '--champion', 'g0'], s.deps)).toBe(1);
    expect(s.logs.join('\n')).toMatch(/ADMIN_TOKEN/);
    const r = setup();
    const reject = (async () => new Response('{"error":"unauthorized"}', { status: 401 })) as unknown as typeof fetch;
    expect(await main(['--env', r.envPath, '--url', 'https://w.test', '--champion', 'g0'], { ...r.deps, fetch: reject })).toBe(1);
    expect(r.logs.join('\n')).toMatch(/401/);
  });

  it('takes the champion from the live API when --url is given and --champion is not', async () => {
    const s = setup();
    const champ = { ...structuredClone(REF), meta: { ...REF.meta, id: 'g4', generation: 4 } };
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url).endsWith('/api/champion')) return new Response(JSON.stringify({ policy: champ, generation: { id: 'g4' }, train: null, val: null }), { status: 200 });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    expect(await main(['--env', s.envPath, '--url', 'https://w.test'], { ...s.deps, fetch: fetchImpl })).toBe(0);
    expect(calls).toEqual(['GET https://w.test/api/champion', 'POST https://w.test/api/admin/sealed-eval']);
    expect(s.logs.join('\n')).toMatch(/champion g4/);
  });
});
