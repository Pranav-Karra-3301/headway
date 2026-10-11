import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { call, OR_KEY, testEnv } from './helpers';

type Decide = { index: number; probs: number[]; choice: string; confidence: number | null; model: string; latencyMs: number; cached: boolean };
type Err = { error: string; details?: string[] };

const OPTIONS = ['Depart now', 'Hold 20 s', 'Hold 40 s', 'Hold 60 s'];
const INSTRUCTIONS = 'Hold for transferring train riders when the train is close; never strand the next stops.';
let n = 0;
/** Unique situation per call so the shared Cache API never leaks between tests. */
const situation = () => `Bus b4 (Route 2) at Central Station. Train arrives in 34 s with 14 riders transferring. #${++n} ${crypto.randomUUID()}`;

function upstreamOk(probs = [0.1, 0.15, 0.6, 0.15], choice = 'o2'): Response {
  return Response.json({
    id: 'gen-1', model: 'typesafe/jev-1.13-20260917',
    answers: { decision: { type: 'choice', choice, probabilities: Object.fromEntries(probs.map((p, i) => [`o${i}`, p])), confidence: 0.55 } },
    usage: { input_tokens: 310, output_tokens: 1 },
  });
}

function fakeFetch(respond: (i: number) => Response | Promise<Response> = () => upstreamOk()) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return respond(calls.length - 1);
  }) as typeof fetch;
  return { f, calls };
}

const decide = (app: ReturnType<typeof createApp>, json: unknown, ip = '10.0.0.1', e = testEnv()) =>
  call(app, '/api/jev/decide', { json, ip, env: e });

describe('POST /api/jev/decide', () => {
  it('forwards a valid request to OpenRouter /systemone and maps the answer', async () => {
    const { f, calls } = fakeFetch();
    const app = createApp({ fetch: f });
    const s = situation();
    const res = await decide(app, { instructions: INSTRUCTIONS, situation: s, options: OPTIONS });
    expect(res.status).toBe(200);
    const body = await res.json<Decide>();
    expect(body).toMatchObject({ index: 2, probs: [0.1, 0.15, 0.6, 0.15], choice: 'Hold 40 s', confidence: 0.55, model: 'typesafe/jev-1.13-20260917', cached: false });
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${env.OPENROUTER_BASE_URL}/systemone`);
    expect(calls[0].init?.method).toBe('POST');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('authorization') === `Bearer ${OR_KEY}`).toBe(true);
    expect(headers.get('content-type')).toContain('application/json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      model: env.JEV_MODEL,
      state: { situation: s, operating_instructions: INSTRUCTIONS },
      questions: {
        decision: {
          type: 'choice',
          instructions: 'Which option should dispatch choose now to follow operating_instructions?',
          criteria: { o0: 'Depart now', o1: 'Hold 20 s', o2: 'Hold 40 s', o3: 'Hold 60 s' },
        },
      },
    });
  });

  it('falls back to the argmax (ties → lowest index) when the choice key is unusable', async () => {
    const { f } = fakeFetch(() => upstreamOk([0.1, 0.4, 0.4, 0.1], 'banana'));
    const res = await decide(createApp({ fetch: f }), { instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS });
    expect((await res.json<Decide>()).index).toBe(1);
  });

  it('400s invalid bodies without calling upstream', async () => {
    const { f, calls } = fakeFetch();
    const app = createApp({ fetch: f });
    const ok = { instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS };
    const cases: unknown[] = [
      [], {}, 'just a string',
      { ...ok, instructions: 7 },
      { ...ok, instructions: 'x'.repeat(1201) },
      { ...ok, situation: 'x'.repeat(1501) },
      { ...ok, situation: '' },
      { ...ok, options: ['Depart now'] },
      { ...ok, options: Array.from({ length: 9 }, (_, i) => `Hold ${i * 10} s`) },
      { ...ok, options: [1, 2] },
      { ...ok, options: ['Depart now', ''] },
      { ...ok, options: 'Depart now' },
    ];
    for (const json of cases) {
      const res = await decide(app, json);
      expect(res.status, JSON.stringify(json).slice(0, 80)).toBe(400);
      expect(typeof (await res.json<Err>()).error).toBe('string');
    }
    const notJson = await call(app, '/api/jev/decide', { body: '{nope', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
    expect(calls).toHaveLength(0);

    const edgeSituation = `${situation()} ${'s'.repeat(1500)}`.slice(0, 1500);
    const edge = await decide(app, { instructions: 'i'.repeat(1200), situation: edgeSituation, options: Array.from({ length: 8 }, (_, i) => `Hold ${i * 10} s`) });
    expect(edge.status).toBe(200);
  });

  it('caches identical requests in memory and in the Cache API', async () => {
    const a = fakeFetch();
    const app = createApp({ fetch: a.f });
    const req = { instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS };
    const first = await (await decide(app, req)).json<Decide>();
    const second = await (await decide(app, req)).json<Decide>();
    expect(a.calls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });

    const b = fakeFetch();
    const third = await (await decide(createApp({ fetch: b.f }), req)).json<Decide>();
    expect(b.calls).toHaveLength(0);
    expect(third).toEqual({ ...first, cached: true });

    await decide(app, { ...req, options: [...OPTIONS].reverse() });
    expect(a.calls).toHaveLength(2);
  });

  it('maps upstream failures to 502/504 and never caches them', async () => {
    const { f, calls } = fakeFetch((i) => (i === 0 ? new Response('overloaded', { status: 529 }) : upstreamOk()));
    const app = createApp({ fetch: f });
    const req = { instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS };
    const failed = await decide(app, req);
    expect(failed.status).toBe(502);
    expect((await failed.json<Err>()).error).toMatch(/529/);
    expect((await decide(app, req)).status).toBe(200);
    expect(calls).toHaveLength(2);

    const malformed = fakeFetch(() => Response.json({ answers: {} }));
    expect((await decide(createApp({ fetch: malformed.f }), { ...req, situation: situation() })).status).toBe(502);

    const timeout = fakeFetch(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')));
    expect((await decide(createApp({ fetch: timeout.f }), { ...req, situation: situation() })).status).toBe(504);

    const network = fakeFetch(() => Promise.reject(new TypeError('Network connection lost.')));
    expect((await decide(createApp({ fetch: network.f }), { ...req, situation: situation() })).status).toBe(502);
  });

  it('rate-limits upstream calls to 30 per minute per IP', async () => {
    let t = 1_000_000;
    const { f, calls } = fakeFetch();
    const app = createApp({ fetch: f, now: () => t });
    const req = () => ({ instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS });
    const repeat = req();
    expect((await decide(app, repeat, '10.0.0.7')).status).toBe(200);
    for (let i = 1; i < 30; i++) expect((await decide(app, req(), '10.0.0.7')).status).toBe(200);
    const limited = await decide(app, req(), '10.0.0.7');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await decide(app, repeat, '10.0.0.7')).status).toBe(200); // cache hits are free
    expect((await decide(app, req(), '10.0.0.8')).status).toBe(200); // other IPs unaffected
    t += 60_000;
    expect((await decide(app, req(), '10.0.0.7')).status).toBe(200);
    expect(calls).toHaveLength(32);
  });

  it('503s when the OpenRouter key is not configured', async () => {
    const { f, calls } = fakeFetch();
    const res = await decide(createApp({ fetch: f }), { instructions: INSTRUCTIONS, situation: situation(), options: OPTIONS }, '10.0.0.9', testEnv({ OPENROUTER_API_KEY: '' }));
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});
