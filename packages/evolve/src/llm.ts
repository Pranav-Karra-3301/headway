// Owner: T4. OpenAI-compatible LLM client (Luminal primary, OpenRouter fallback), spec §8.2.
// fetch only: runs in Node, the browser and Workers.
// Streams (SSE) by default: Luminal answers 503 "temporarily unavailable" to non-streaming requests that run past ~20 s,
// which is every designer call (8k-token budget incl. reasoning). Plain JSON responses are still accepted.

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

type ErrorBody = { message?: string; code?: number | string };

/** Retryable unless the provider reports a definite client error (4xx other than 408/429). */
function errorRetryable(code: unknown): boolean {
  const n = Number(code);
  return !Number.isFinite(n) || n === 408 || n === 429 || n >= 500 || n < 400;
}

/** Reads an OpenAI-style SSE stream and joins `choices[0].delta.content` (reasoning deltas are ignored). */
async function readSse(body: ReadableStream<Uint8Array>, onError: (e: ErrorBody) => never, signal: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let done = false;
  const line = (raw: string) => {
    const l = raw.replace(/\r$/, '');
    if (!l.startsWith('data:')) return;            // event:, id:, retry: and ': comment' keep-alives
    const data = l.slice(5).trim();
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    let chunk: { choices?: Array<{ delta?: { content?: unknown } }>; error?: ErrorBody };
    try { chunk = JSON.parse(data); } catch { return; } // a malformed event is skipped
    if (chunk?.error) onError(chunk.error);
    text += contentText(chunk?.choices?.[0]?.delta?.content);
  };
  try {
    while (!done) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl >= 0 && !done) {
        line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
    }
    if (!done) {
      buf += dec.decode();
      if (buf) line(buf);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (done) cancel();
  }
  return text;
}

/**
 * Request extras per provider, applied unless `extraBody` overrides them. DeepSeek V4.1 Flash (Luminal) and V4 Pro
 * (OpenRouter) both spend the whole 8k-token designer budget reasoning on our prompts (finish_reason "length", no
 * content), and neither honours a reasoning budget, so reasoning is switched off: Luminal takes DeepSeek's
 * `thinking: { type: 'disabled' }`, OpenRouter its unified `reasoning: { enabled: false }`.
 */
export const PROVIDER_EXTRAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  luminal: { thinking: { type: 'disabled' } },
  openrouter: { reasoning: { enabled: false } },
};

export function createOpenAICompatClient(o: {
  baseUrl: string; apiKey: string; provider: string; headers?: Record<string, string>; fetchImpl?: typeof fetch;
  /** SSE streaming (default true). */
  stream?: boolean;
  /** Merged into every request body after the provider extras (e.g. `{ thinking: { type: 'enabled' } }`). */
  extraBody?: Record<string, unknown>;
}): LlmClient {
  const url = `${o.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const stream = o.stream ?? true;
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
          stream,
        };
        if (req.temperature !== undefined) body.temperature = req.temperature;
        if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
        if (req.json) body.response_format = { type: 'json_object' };
        Object.assign(body, PROVIDER_EXTRAS[o.provider] ?? {}, o.extraBody ?? {});

        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: {
              ...o.headers, Authorization: `Bearer ${o.apiKey}`, 'Content-Type': 'application/json',
              Accept: stream ? 'text/event-stream, application/json' : 'application/json',
            },
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
        const providerError = (err: ErrorBody): never => {
          const code = Number(err.code);
          throw fail(`error: ${err.message ?? 'unknown'}`, Number.isFinite(code) ? code : null, errorRetryable(err.code), 'http');
        };
        // reasoning_content is ignored; only content is parsed (spec §8.2)
        let text: string;
        if (res.body && (res.headers.get('content-type') ?? '').includes('text/event-stream')) {
          try {
            text = await readSse(res.body, providerError, ctrl.signal);
          } catch (e) {
            if (e instanceof LlmError) throw e;
            throw timedOut ? timeoutError() : fail(`stream failed: ${message(e)}`, res.status, true, 'network');
          }
          if (timedOut) throw timeoutError();
        } else {
          let data: { choices?: Array<{ message?: { content?: unknown } }>; error?: ErrorBody };
          try {
            data = await res.json();
          } catch (e) {
            throw timedOut ? timeoutError() : fail(`unreadable response: ${message(e)}`, res.status, true, 'parse');
          }
          if (data?.error && !data.choices?.length) providerError(data.error);
          text = contentText(data?.choices?.[0]?.message?.content);
        }
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
