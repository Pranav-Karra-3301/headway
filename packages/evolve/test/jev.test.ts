// Owner: T6. Jev provider (TypeSafe System One via OpenRouter), cache, the Jev comparison and Jev-track designers (spec §9).
import { G0, REF, validatePolicy } from '@headway/sim';
import type { DecisionProvider, Policy } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest } from '../src/llm';
import { JEV_GENERIC_INSTRUCTIONS, compareJev, jevInstances, withJevAdvisor, type JevAdvisor } from '../src/jev/compare';
import { createJevProvider, withCache } from '../src/jev/provider';
import { designJevAdvisors, jevDesignerSystemPrompt, parseJevDesign } from '../src/jev/track';

type Req = Parameters<DecisionProvider['choose']>[0];
type Res = Awaited<ReturnType<DecisionProvider['choose']>>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const REQ: Req = {
  instructions: 'Hold when many riders transfer.',
  situation: 'Bus b4 (Route 1) at University Station. 18 aboard of 40.',
  options: ['Depart now', 'Hold 20 s', 'Hold 40 s', 'Hold 60 s'],
};

interface Captured { url: string; init: RequestInit }
function mockFetch(reply: (c: Captured) => Response | Promise<Response>): typeof fetch & { calls: Captured[] } {
  const calls: Captured[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = { url: String(input), init: init ?? {} };
    calls.push(c);
    return reply(c);
  }) as typeof fetch & { calls: Captured[] };
  f.calls = calls;
  return f;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (choice: string, probabilities: Record<string, number>) => ({
  model: 'typesafe/jev-1.13-20260917', answers: { decision: { type: 'choice', choice, probabilities, confidence: 0.53 } },
});

// ------------------------------------------------------------------------------------------------ provider
describe('createJevProvider', () => {
  it('POSTs the System One request body to {baseUrl}/systemone', async () => {
    const f = mockFetch(() => json(answer('o2', { o0: 0.02, o1: 0.29, o2: 0.65, o3: 0.04 })));
    const p = createJevProvider({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'sk-test', model: 'typesafe/jev-1.13', fetchImpl: f });
    await p.choose(REQ);
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'typesafe/jev-1.13',
      state: { situation: REQ.situation, operating_instructions: REQ.instructions },
      questions: {
        decision: {
          type: 'choice',
          instructions: 'Which option should dispatch choose now to follow operating_instructions?',
          criteria: { o0: 'Depart now', o1: 'Hold 20 s', o2: 'Hold 40 s', o3: 'Hold 60 s' },
        },
      },
    });
    expect((p as unknown as { model: string }).model).toBe('typesafe/jev-1.13');
  });

  it('maps answers.decision to option order', async () => {
    const f = mockFetch(() => json(answer('o2', { o3: 0.04, o1: 0.29, o0: 0.02, o2: 0.65 })));
    const r = await createJevProvider({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', fetchImpl: f }).choose(REQ);
    expect(r.index).toBe(2);
    expect(r.probs).toEqual([0.02, 0.29, 0.65, 0.04]);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fills missing probabilities with 0 and uses the argmax when the choice is unusable', async () => {
    const f = mockFetch(() => json(answer('Hold 40 s', { o1: 0.7, o2: 0.3 })));
    const r = await createJevProvider({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', fetchImpl: f }).choose(REQ);
    expect(r).toMatchObject({ index: 1, probs: [0, 0.7, 0.3, 0] });
  });

  it('throws on HTTP errors and unusable bodies (without leaking the key)', async () => {
    const mk = (res: () => Response) => createJevProvider({ baseUrl: 'https://x.test/v1', apiKey: 'sk-secret', model: 'm', fetchImpl: mockFetch(res) });
    const http = mk(() => new Response('rate limited', { status: 429 })).choose(REQ);
    await expect(http).rejects.toThrow(/429/);
    await http.catch((e: unknown) => expect(String(e)).not.toContain('sk-secret'));
    await expect(mk(() => json({ answers: {} })).choose(REQ)).rejects.toThrow(/answers\.decision/);
    await expect(mk(() => new Response('not json', { status: 200 })).choose(REQ)).rejects.toThrow();
    await expect(mk(() => json(answer('o9', {}))).choose(REQ)).rejects.toThrow();
  });
});

// ------------------------------------------------------------------------------------------------ cache
describe('withCache', () => {
  function counting(fail = 0) {
    let n = 0;
    const p: DecisionProvider & { calls: () => number } = {
      calls: () => n,
      choose: async (req) => {
        n++;
        if (n <= fail) throw new Error('upstream down');
        return { index: req.options.length - 1, probs: req.options.map((_, i) => (i === req.options.length - 1 ? 1 : 0)), latencyMs: 300 };
      },
    };
    return p;
  }

  it('answers identical requests once (keyed on instructions, situation and options)', async () => {
    const up = counting();
    const c = withCache(up);
    const a = await c.choose(REQ);
    const b = await c.choose({ options: [...REQ.options], situation: REQ.situation, instructions: REQ.instructions });
    expect(up.calls()).toBe(1);
    expect(a).toEqual({ index: 3, probs: [0, 0, 0, 1], latencyMs: 300 });
    expect(b).toEqual({ index: 3, probs: [0, 0, 0, 1], latencyMs: 0 });
    b.probs[0] = 9;
    expect((await c.choose(REQ)).probs[0]).toBe(0);
    await c.choose({ ...REQ, situation: `${REQ.situation} 3 still waiting here.` });
    await c.choose({ ...REQ, instructions: 'Never hold.' });
    await c.choose({ ...REQ, options: REQ.options.slice(0, 2) });
    expect(up.calls()).toBe(4);
  });

  it('shares in-flight requests and does not cache failures', async () => {
    const up = counting(1);
    const c = withCache(up);
    await expect(c.choose(REQ)).rejects.toThrow('upstream down');
    const [x, y] = await Promise.all([c.choose(REQ), c.choose(REQ)]);
    expect(x.index).toBe(3);
    expect(y.index).toBe(3);
    expect(up.calls()).toBe(2);
  });

  it('keeps the wrapped provider model', () => {
    const inner = Object.assign(counting(), { model: 'typesafe/jev-1.13' });
    expect((withCache(inner) as unknown as { model?: string }).model).toBe('typesafe/jev-1.13');
  });
});

// ------------------------------------------------------------------------------------------------ compare
describe('compareJev', () => {
  const always = (label: string) => {
    const calls: Req[] = [];
    const p: DecisionProvider & { calls: Req[] } = {
      calls,
      choose: async (req) => {
        calls.push(req);
        const i = Math.max(0, req.options.indexOf(label));
        return { index: i, probs: req.options.map((_, k) => (k === i ? 0.9 : 0.1 / (req.options.length - 1))), latencyMs: 7 } satisfies Res;
      },
    };
    return p;
  };

  it('defaults to stadium_exit × 2 train seeds', () => {
    expect(jevInstances()).toEqual([
      { scenarioId: 'stadium_exit', seed: 1001, split: 'train' },
      { scenarioId: 'stadium_exit', seed: 1002, split: 'train' },
    ]);
  });

  it('withJevAdvisor enables Jev on a copy of the policy and keeps it valid', () => {
    const p = withJevAdvisor(G0, { instructions: JEV_GENERIC_INSTRUCTIONS }, 'jev-generic');
    expect(p.meta.id).toBe('g0-jev-generic');
    expect(p.advisor).toEqual({
      provider: 'jev', enabled: true, askWhen: [{ f: 'train_eta_s', op: '<=', v: 120 }], holdOptionsS: [0, 20, 40, 60],
      instructions: JEV_GENERIC_INSTRUCTIONS,
    });
    expect(G0.advisor).toBeUndefined();
    expect(validatePolicy(p).ok).toBe(true);
    expect(JEV_GENERIC_INSTRUCTIONS.length).toBeLessThanOrEqual(1200);
  });

  it('runs rules-only vs Jev generic vs Jev evolved on the same seeds', async () => {
    const evolved: JevAdvisor = {
      provider: 'jev', enabled: true, askWhen: [], holdOptionsS: [0, 30], instructions: 'Hold 30 s whenever you can.',
    };
    const provider = always('Hold 30 s');
    let tick = 0;
    const report = await compareJev({
      champion: clone(REF), provider, evolved, timeoutMs: 1000, model: 'typesafe/jev-1.13', now: () => `2026-10-11T20:00:0${tick++}Z`,
    });
    expect(report.arms.map((a) => a.id)).toEqual(['rules', 'jev_generic', 'jev_evolved']);
    expect(report.instances).toEqual(jevInstances());
    expect(report.championId).toBe('ref');
    expect(report.model).toBe('typesafe/jev-1.13');
    expect(report.createdAt).toBe('2026-10-11T20:00:00Z');
    const [rules, generic, evo] = report.arms as [typeof report.arms[0], typeof report.arms[0], typeof report.arms[0]];
    expect(rules.jev).toBeNull();
    expect(rules.deltaPct).toBe(0);
    expect(rules.runs.map((r) => r.seed)).toEqual([1001, 1002]);
    expect(generic.advisor?.instructions).toBe(JEV_GENERIC_INSTRUCTIONS);
    expect(evo.advisor).toEqual(evolved);
    // The generic arm's options do not include 30 s, so its provider answers fall to index 0 (Depart now).
    expect(generic.jev!.chosen['Depart now']).toBe(generic.jev!.answered);
    expect(evo.jev!.chosen['Hold 30 s']).toBe(evo.jev!.answered);
    expect(evo.jev!.asked).toBeGreaterThan(generic.jev!.asked); // askWhen [] asks at every station stop
    for (const arm of [generic, evo]) {
      expect(arm.jev!.timeouts + arm.jev!.errors).toBe(0);
      expect(arm.jev!.meanLatencyMs).toBe(7);
      expect(arm.score.runs).toBe(2);
      expect(arm.deltaPct).toBeCloseTo((arm.score.J - rules.score.J) / rules.score.J * 100, 6);
    }
    expect(evo.score.J).not.toBe(rules.score.J);
  });

  it('a Jev that always departs reproduces the rules exactly for a policy without stop rules', async () => {
    const report = await compareJev({ champion: clone(G0), provider: always('Depart now'), timeoutMs: 1000 });
    expect(report.arms.map((a) => a.id)).toEqual(['rules', 'jev_generic']);
    expect(report.arms[1]!.score.J).toBe(report.arms[0]!.score.J);
    expect(report.arms[1]!.deltaPct).toBe(0);
    expect(report.notes.join(' ')).toMatch(/no evolved/i);
  });

  it('uses the champion advisor as the evolved arm when it has its own instructions', async () => {
    const champ = withJevAdvisor(G0, { instructions: 'Evolved: hold only for big transfers.', enabled: false }, 'x');
    const report = await compareJev({ champion: champ, provider: always('Depart now'), timeoutMs: 1000 });
    expect(report.arms.map((a) => a.id)).toEqual(['rules', 'jev_generic', 'jev_evolved']);
    expect(report.arms[2]!.advisor).toMatchObject({ enabled: true, instructions: 'Evolved: hold only for big transfers.' });
  });
});

// ------------------------------------------------------------------------------------------------ Jev-track designers
describe('Jev-track designers', () => {
  const ADVISOR: JevAdvisor = {
    provider: 'jev', enabled: true, askWhen: [{ f: 'train_eta_s', op: '<=', v: 90 }], holdOptionsS: [0, 15, 30, 45],
    instructions: 'Hold only when the train is close and at least 5 riders will transfer.',
  };
  const reply = (advisor: unknown, summary = 'Tighter holds') => JSON.stringify({ summary, rationale: 'Because.', advisor });

  function fakeLlm(script: Array<string | Error>): LlmClient & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    let i = 0;
    return {
      reqs,
      complete: async (req) => {
        reqs.push(req);
        const s = script[i++ % script.length]!;
        if (s instanceof Error) throw s;
        return { text: s, latencyMs: 5, model: req.model, provider: 'fake' };
      },
    };
  }

  it('the system prompt explains the job, the features and the output contract', () => {
    const s = jevDesignerSystemPrompt(G0);
    for (const part of ['Jev', 'askWhen', 'holdOptionsS', 'instructions', 'train_eta_s', 'expected_transfers', 'Depart now', '1200']) {
      expect(s).toContain(part);
    }
  });

  it('parses and validates a design against the champion', () => {
    const ok = parseJevDesign(`Here you go:\n\`\`\`json\n${reply(ADVISOR)}\n\`\`\``, G0);
    expect(ok).toEqual({ ok: true, advisor: ADVISOR, summary: 'Tighter holds', rationale: 'Because.' });
    const forced = parseJevDesign(reply({ ...ADVISOR, provider: undefined, enabled: false }), G0);
    expect(forced.ok && forced.advisor).toMatchObject({ provider: 'jev', enabled: true });
    const bad = parseJevDesign(reply({ ...ADVISOR, askWhen: [{ f: 'route_queue', op: '>=', v: 1 }], holdOptionsS: [0, 200] }), G0);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toContain('route_queue');
      expect(bad.errors.join('\n')).toContain('holdOptionsS');
    }
    expect(parseJevDesign('no json here', G0).ok).toBe(false);
    expect(parseJevDesign(reply({ ...ADVISOR, instructions: 'x'.repeat(1201) }), G0).ok).toBe(false);
  });

  it('runs designers in parallel with rotating temperatures; one failure does not sink the others; one repair each', async () => {
    const bad = reply({ ...ADVISOR, holdOptionsS: [0, 500] });
    const llm = fakeLlm([reply(ADVISOR, 'A'), new Error('luminal down'), bad, reply({ ...ADVISOR, holdOptionsS: [0, 30] }, 'C fixed')]);
    const out = await designJevAdvisors({ llm, model: 'deepseek-ai/DeepSeek-V4.1-Flash', champion: G0, current: ADVISOR, evidence: 'J went up.' });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ ok: true, summary: 'A', advisor: ADVISOR });
    expect(out[1]).toMatchObject({ ok: false });
    expect(out[1]!.ok === false && out[1]!.errors.join(' ')).toContain('luminal down');
    expect(out[2]).toMatchObject({ ok: true, summary: 'C fixed', repaired: true });
    const first = llm.reqs.slice(0, 3);
    expect(first.map((r) => r.temperature)).toEqual([0.4, 0.7, 1.0]);
    for (const r of first) {
      expect(r.json).toBe(true);
      expect(r.user).toContain('J went up.');
      expect(r.user).toContain(ADVISOR.instructions);
    }
    expect(llm.reqs[3]!.user).toContain('holdOptionsS');
  });
});
