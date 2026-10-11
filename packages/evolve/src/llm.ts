// Owner: T4. OpenAI-compatible LLM client (Luminal primary, OpenRouter fallback), spec §8.2.
// fetch only: runs in Node, the browser and Workers.

export interface LlmRequest { model: string; system: string; user: string; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number }
export interface LlmResponse { text: string; latencyMs: number; model: string; provider: string }
export interface LlmClient { complete(req: LlmRequest): Promise<LlmResponse> }

export type LlmErrorKind = 'http' | 'timeout' | 'network' | 'empty' | 'parse';

/** A failed completion. `retryable` = worth trying the fallback (timeout, 408/429/5xx, network, empty reply). */
export class LlmError extends Error {
  readonly provider: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly kind: LlmErrorKind;
  constructor(message: string, o: { provider: string; status: number | null; retryable: boolean; kind: LlmErrorKind }) {
    super(message);
    this.name = 'LlmError';
    this.provider = o.provider;
    this.status = o.status;
    this.retryable = o.retryable;
    this.kind = o.kind;
  }
}

const DEFAULT_TIMEOUT_MS = 90_000;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
  }
  return '';
}

export function createOpenAICompatClient(o: { baseUrl: string; apiKey: string; provider: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }): LlmClient {
  const url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const doFetch: typeof fetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
  const fail = (msg: string, status: number | null, retryable: boolean, kind: LlmErrorKind) =>
    new LlmError(`${o.provider}: ${msg}`, { provider: o.provider, status, retryable, kind });

  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const started = Date.now();
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
      const timeoutError = () => fail(`timed out after ${timeoutMs} ms`, null, true, 'timeout');
      try {
        const body: Record<string, unknown> = {
          model: req.model,
          messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
          stream: false,
        };
        if (req.temperature !== undefined) body.temperature = req.temperature;
        if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
        if (req.json) body.response_format = { type: 'json_object' };

        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: { ...o.headers, Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } catch (e) {
          throw timedOut ? timeoutError() : fail(`network error: ${message(e)}`, null, true, 'network');
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
          throw fail(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`, res.status, retryable, 'http');
        }
        let data: { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string; code?: number | string } };
        try {
          data = await res.json();
        } catch (e) {
          throw timedOut ? timeoutError() : fail(`unreadable response: ${message(e)}`, res.status, true, 'parse');
        }
        if (data?.error && !data.choices?.length) {
          const code = Number(data.error.code);
          const retryable = !Number.isFinite(code) || code === 408 || code === 429 || code >= 500;
          throw fail(`error: ${data.error.message ?? 'unknown'}`, Number.isFinite(code) ? code : null, retryable, 'http');
        }
        // reasoning_content is ignored; only content is parsed (spec §8.2)
        const text = contentText(data?.choices?.[0]?.message?.content);
        if (!text.trim()) throw fail('empty content', res.status, true, 'empty');
        return { text, latencyMs: Date.now() - started, model: req.model, provider: o.provider };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Calls primary; on timeout/429/5xx/network error calls fallback with `fallbackModel`. */
export function withFallback(primary: LlmClient, fallback: LlmClient, fallbackModel: string): LlmClient {
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      try {
        return await primary.complete(req);
      } catch (e) {
        if (e instanceof LlmError && !e.retryable) throw e;
        try {
          return await fallback.complete({ ...req, model: fallbackModel });
        } catch (e2) {
          const why = `${message(e)}; fallback ${fallbackModel} failed: ${message(e2)}`;
          if (e2 instanceof LlmError) throw new LlmError(why, { provider: e2.provider, status: e2.status, retryable: e2.retryable, kind: e2.kind });
          throw new Error(why);
        }
      }
    },
  };
}
