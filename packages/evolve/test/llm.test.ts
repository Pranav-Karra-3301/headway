import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatClient, LlmError, withFallback, type LlmClient, type LlmRequest } from '../src/llm';

const REQ: LlmRequest = { model: 'deepseek-ai/DeepSeek-V4.1-Flash', system: 'sys', user: 'usr', temperature: 0.7, maxTokens: 8000, json: true, timeoutMs: 2000 };

function okResponse(content: unknown): Response {
  return new Response(JSON.stringify({ model: 'x', choices: [{ message: { role: 'assistant', content, reasoning_content: 'hmm {"no": 1}' }, finish_reason: 'stop' }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

describe('createOpenAICompatClient', () => {
  it('posts an OpenAI-compatible chat completion and maps the reply', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => okResponse('{"ok":true}'));
    const llm = createOpenAICompatClient({ baseUrl: 'https://flash.luminal.cloud/v1/', apiKey: 'k-123', provider: 'luminal', headers: { 'X-Title': 'Headway' }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await llm.complete(REQ);
    expect(res).toMatchObject({ text: '{"ok":true}', model: REQ.model, provider: 'luminal' });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://flash.luminal.cloud/v1/chat/completions');
    expect(init!.method).toBe('POST');
    const headers = new Headers(init!.headers);
    expect(headers.get('authorization')).toBe('Bearer k-123');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-title')).toBe('Headway');
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({
      model: REQ.model, temperature: 0.7, max_tokens: 8000, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
    });
  });

  it('omits response_format when json is not requested', async () => {
    const fetchImpl = vi.fn(async () => okResponse('hi'));
    const llm = createOpenAICompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'p', fetchImpl: fetchImpl as unknown as typeof fetch });
    await llm.complete({ model: 'm', system: 's', user: 'u' });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format).toBeUndefined();
  });

  it('throws a retryable LlmError on 429 and 5xx, a non-retryable one on 400', async () => {
    for (const [status, retryable] of [[429, true], [503, true], [400, false], [401, false]] as const) {
      const llm = createOpenAICompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'p',
        fetchImpl: (async () => new Response('nope', { status })) as unknown as typeof fetch });
      const err = await llm.complete(REQ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).status).toBe(status);
      expect((err as LlmError).retryable).toBe(retryable);
    }
  });

  it('times out with a retryable error', async () => {
    const fetchImpl = (_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    const llm = createOpenAICompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'p', fetchImpl: fetchImpl as unknown as typeof fetch });
    const t0 = Date.now();
    const err = await llm.complete({ ...REQ, timeoutMs: 50 }).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('timeout');
    expect((err as LlmError).retryable).toBe(true);
  });

  it('treats a network failure and empty content as retryable', async () => {
    const net = createOpenAICompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'p',
      fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    const e1 = await net.complete(REQ).catch((e: unknown) => e);
    expect((e1 as LlmError).retryable).toBe(true);
    const empty = createOpenAICompatClient({ baseUrl: 'https://x/v1', apiKey: 'k', provider: 'p',
      fetchImpl: (async () => okResponse('')) as unknown as typeof fetch });
    const e2 = await empty.complete(REQ).catch((e: unknown) => e);
    expect((e2 as LlmError).retryable).toBe(true);
  });
});

describe('withFallback', () => {
  function client(impl: (req: LlmRequest) => Promise<string>, provider: string): LlmClient & { reqs: LlmRequest[] } {
    const reqs: LlmRequest[] = [];
    return { reqs, async complete(req) { reqs.push(req); return { text: await impl(req), latencyMs: 1, model: req.model, provider }; } };
  }

  it('uses the primary when it succeeds', async () => {
    const p = client(async () => 'primary', 'luminal');
    const f = client(async () => 'fallback', 'openrouter');
    const res = await withFallback(p, f, 'deepseek/deepseek-v4-pro').complete(REQ);
    expect(res.text).toBe('primary');
    expect(f.reqs).toHaveLength(0);
  });

  it('falls back with the fallback model on 429, 5xx, timeout and network errors', async () => {
    const errors = [
      new LlmError('rate', { provider: 'luminal', status: 429, retryable: true, kind: 'http' }),
      new LlmError('down', { provider: 'luminal', status: 502, retryable: true, kind: 'http' }),
      new LlmError('slow', { provider: 'luminal', status: null, retryable: true, kind: 'timeout' }),
      new TypeError('fetch failed'),
    ];
    for (const err of errors) {
      const p = client(async () => { throw err; }, 'luminal');
      const f = client(async () => 'fallback', 'openrouter');
      const res = await withFallback(p, f, 'deepseek/deepseek-v4-pro').complete(REQ);
      expect(res).toMatchObject({ text: 'fallback', model: 'deepseek/deepseek-v4-pro', provider: 'openrouter' });
      expect(f.reqs[0]).toMatchObject({ ...REQ, model: 'deepseek/deepseek-v4-pro' });
    }
  });

  it('does not fall back on a non-retryable error', async () => {
    const p = client(async () => { throw new LlmError('bad request', { provider: 'luminal', status: 400, retryable: false, kind: 'http' }); }, 'luminal');
    const f = client(async () => 'fallback', 'openrouter');
    await expect(withFallback(p, f, 'm2').complete(REQ)).rejects.toThrow('bad request');
    expect(f.reqs).toHaveLength(0);
  });

  it('reports both failures when the fallback fails too', async () => {
    const p = client(async () => { throw new LlmError('luminal 503', { provider: 'luminal', status: 503, retryable: true, kind: 'http' }); }, 'luminal');
    const f = client(async () => { throw new Error('openrouter down'); }, 'openrouter');
    await expect(withFallback(p, f, 'm2').complete(REQ)).rejects.toThrow(/luminal 503.*openrouter down/);
  });
});
