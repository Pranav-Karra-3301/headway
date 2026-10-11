import { afterEach, describe, expect, it, vi } from 'vitest';
import { G0 } from '@headway/sim';
import type { EvolveEvent, Generation, Policy, Replay } from '@headway/sim';
import { fetchChampion, fetchGenerations, fetchLeaderboard, streamEvolve, submitRun } from '../api';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | 'network-error';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const html = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } });

function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k + '?'));
    const r = key ? routes[key]!(url, init) : 'network-error';
    if (r === 'network-error') throw new TypeError('Failed to fetch');
    return r;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const policy = (id: string): Policy => ({ ...structuredClone(G0), meta: { ...G0.meta, id, generation: 4, parent: 'g3' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchChampion', () => {
  it('uses /api/champion when it works', async () => {
    const calls = mockFetch({ '/api/champion': () => json({ policy: policy('g4'), generation: null, train: null, val: null }) });
    const c = await fetchChampion();
    expect(c.policy.meta.id).toBe('g4');
    expect(c.generation).toBeNull();
    expect(calls).toEqual(['/api/champion']);
  });

  it('falls back to /data/champion.json when the API fails', async () => {
    const calls = mockFetch({
      '/api/champion': () => 'network-error',
      '/data/champion.json': () => json({ policy: policy('g2'), generation: { id: 'g2', number: 2 } }),
    });
    const c = await fetchChampion();
    expect(c.policy.meta.id).toBe('g2');
    expect(calls).toEqual(['/api/champion', '/data/champion.json']);
  });

  it('treats an HTML page (dev server SPA fallback) or a 5xx as a failure', async () => {
    mockFetch({ '/api/champion': () => html(), '/data/champion.json': () => json({ policy: policy('g1') }) });
    expect((await fetchChampion()).policy.meta.id).toBe('g1');
    mockFetch({ '/api/champion': () => json({ error: 'boom' }, 500), '/data/champion.json': () => json({ policy: policy('g1') }) });
    expect((await fetchChampion()).policy.meta.id).toBe('g1');
  });

  it('accepts a bare Generation or Policy in the data file', async () => {
    const gen = { id: 'g3', number: 3, policy: policy('g3') } as unknown as Generation;
    mockFetch({ '/api/champion': () => 'network-error', '/data/champion.json': () => json(gen) });
    const a = await fetchChampion();
    expect(a.policy.meta.id).toBe('g3');
    expect(a.generation?.id).toBe('g3');
    mockFetch({ '/api/champion': () => 'network-error', '/data/champion.json': () => json(policy('g5')) });
    expect((await fetchChampion()).policy.meta.id).toBe('g5');
  });

  it('ends at the built-in baseline when everything fails', async () => {
    mockFetch({});
    const c = await fetchChampion();
    expect(c.policy.meta.id).toBe('g0');
    expect(c.generation).toBeNull();
  });
});

describe('fetchGenerations', () => {
  const gens = [{ id: 'g0', number: 0 }, { id: 'g1', number: 1 }];
  it('reads /api/generations', async () => {
    mockFetch({ '/api/generations': () => json({ generations: gens, rounds: [{ id: 'r1' }], baseline: { J: 5 }, reference: null }) });
    const g = await fetchGenerations();
    expect(g.generations.map((x) => x.id)).toEqual(['g0', 'g1']);
    expect(g.rounds).toHaveLength(1);
    expect(g.baseline?.J).toBe(5);
  });

  it('falls back to /data/generations.json (object or bare array)', async () => {
    const calls = mockFetch({ '/api/generations': () => json({ error: 'x' }, 503), '/data/generations.json': () => json({ generations: gens, rounds: [] }) });
    expect((await fetchGenerations()).generations).toHaveLength(2);
    expect(calls).toEqual(['/api/generations', '/data/generations.json']);
    mockFetch({ '/api/generations': () => 'network-error', '/data/generations.json': () => json(gens) });
    const g = await fetchGenerations();
    expect(g.generations).toHaveLength(2);
    expect(g.rounds).toEqual([]);
  });

  it('sorts generations oldest first and returns empty lists when nothing loads', async () => {
    mockFetch({ '/api/generations': () => json({ generations: [gens[1], gens[0]], rounds: [] }) });
    expect((await fetchGenerations()).generations.map((x) => x.number)).toEqual([0, 1]);
    mockFetch({});
    expect(await fetchGenerations()).toMatchObject({ generations: [], rounds: [] });
  });
});

describe('fetchLeaderboard / submitRun', () => {
  it('maps rows leniently and falls back to /data', async () => {
    mockFetch({ '/api/leaderboard': (u) => (u.includes('seed=50000') ? json({ entries: [{ name: 'ada', J: 1200, verified: 1 }] }) : json([])) });
    expect(await fetchLeaderboard(50000)).toEqual([{ name: 'ada', j: 1200, verified: true }]);
    const calls = mockFetch({ '/api/leaderboard': () => json({ error: 'nope' }, 501), '/data/leaderboard.json': () => json([{ name: 'bo', j: 9, verified: false }]) });
    expect(await fetchLeaderboard(50000)).toEqual([{ name: 'bo', j: 9, verified: false }]);
    expect(calls[0]).toBe('/api/leaderboard?seed=50000');
    mockFetch({});
    expect(await fetchLeaderboard(1)).toEqual([]);
  });

  it('submitRun posts { name, replay } and never throws', async () => {
    const replay = { simVersion: '1', mapVersion: 'm', scenarioId: 'stadium_exit', seed: 50000, controller: { kind: 'human', basePolicyId: 'g0' } } as Replay;
    let body: unknown = null;
    mockFetch({ '/api/leaderboard': (_u, init) => { body = JSON.parse(String(init?.body)); return json({ ok: true, j: 4321 }); } });
    expect(await submitRun('ada', replay)).toEqual({ ok: true, j: 4321 });
    expect(body).toEqual({ name: 'ada', replay });
    mockFetch({ '/api/leaderboard': () => json({ error: 'name taken' }, 400) });
    expect(await submitRun('ada', replay)).toEqual({ ok: false, error: 'name taken' });
    mockFetch({});
    const r = await submitRun('ada', replay);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe('streamEvolve', () => {
  const events: EvolveEvent[] = [
    { type: 'round_start', round: 5, champion: 'g4' },
    { type: 'proposal', designer: 0, model: 'm', emphasis: 'transfers', status: 'requested' },
    { type: 'decision', promoted: null, reason: 'no gain' },
  ];

  it('parses an NDJSON stream split across chunks, with the bearer token', async () => {
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const enc = new TextEncoder();
    let auth = '';
    mockFetch({
      '/api/evolve': (_u, init) => {
        auth = new Headers(init?.headers).get('authorization') ?? '';
        const stream = new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(enc.encode(text.slice(0, 17))); c.enqueue(enc.encode(text.slice(17, 60))); c.enqueue(enc.encode(text.slice(60))); c.close(); },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
      },
    });
    const got: EvolveEvent[] = [];
    await streamEvolve('sekret', (e) => got.push(e));
    expect(auth).toBe('Bearer sekret');
    expect(got).toEqual(events);
  });

  it('rejects a bad token instead of falling back', async () => {
    mockFetch({ '/api/evolve': () => json({ error: 'unauthorized' }, 401), '/data/evolve-events.json': () => json(events) });
    await expect(streamEvolve('bad', () => {})).rejects.toThrow(/token/i);
  });

  it('replays /data/evolve-events.json when the API is unavailable, saying so first', async () => {
    mockFetch({ '/api/evolve': () => json({ error: 'not implemented yet' }, 501), '/data/evolve-events.json': () => json(events) });
    const got: EvolveEvent[] = [];
    await streamEvolve('t', (e) => got.push(e), { replayDelayMs: 0 });
    expect(got[0]).toMatchObject({ type: 'error' });
    expect(got.slice(1)).toEqual(events);
  });

  it('rejects when neither the API nor a recording is available', async () => {
    mockFetch({});
    await expect(streamEvolve('t', () => {}, { replayDelayMs: 0 })).rejects.toThrow();
  });
});
