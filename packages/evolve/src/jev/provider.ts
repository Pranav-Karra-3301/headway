// Owner: T6. Jev (TypeSafe System One) via OpenRouter `/systemone` (spec §9). fetch only: Node, browser, Worker.
// Same request body as apps/worker/src/jev.ts, so CLI and browser (proxy) decisions match.
import type { DecisionProvider } from '@headway/sim';

type Choice = Awaited<ReturnType<DecisionProvider['choose']>>;
type Req = Parameters<DecisionProvider['choose']>[0];

const QUESTION = 'Which option should dispatch choose now to follow operating_instructions?';
/** Upper bound on one HTTP call; the JevController applies the real decision deadline (800 ms browser, 5 s CLI). */
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 5_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function requestSignal(): AbortSignal | undefined {
  const A = typeof AbortSignal !== 'undefined' ? (AbortSignal as { timeout?: (ms: number) => AbortSignal }) : undefined;
  return typeof A?.timeout === 'function' ? A.timeout(REQUEST_TIMEOUT_MS) : undefined;
}

/** `answers.decision` → option-ordered probabilities; index = the chosen key `oN`, else the argmax (ties → lowest). */
function mapDecision(body: unknown, count: number): { index: number; probs: number[] } | null {
  if (!isObj(body) || !isObj(body.answers) || !isObj(body.answers.decision)) return null;
  const d = body.answers.decision;
  const p = isObj(d.probabilities) ? d.probabilities : {};
  const probs = Array.from({ length: count }, (_, i) => {
    const v = p[`o${i}`];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });
  const m = typeof d.choice === 'string' ? /^o(\d+)$/.exec(d.choice.trim()) : null;
  let index = m ? Number(m[1]) : -1;
  if (!(index >= 0 && index < count)) {
    index = -1;
    for (let i = 0; i < count; i++) if (probs[i]! > 0 && (index < 0 || probs[i]! > probs[index]!)) index = i;
  }
  return index >= 0 ? { index, probs } : null;
}

export function createJevProvider(o: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): DecisionProvider {
  const url = `${o.baseUrl.replace(/\/+$/, '')}/systemone`;
  const doFetch: typeof fetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
  const provider = {
    model: o.model,
    async choose(req: Req): Promise<Choice> {
      const started = now();
      const criteria: Record<string, string> = {};
      req.options.forEach((label, i) => { criteria[`o${i}`] = label; });
      const body = {
        model: o.model,
        state: { situation: req.situation, operating_instructions: req.instructions },
        questions: { decision: { type: 'choice', instructions: QUESTION, criteria } },
      };
      const signal = requestSignal();
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://headway.pranavkarra001.workers.dev',
          'X-Title': 'Headway',
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        let text = (await res.text().catch(() => '')).slice(0, 200);
        if (o.apiKey) text = text.replaceAll(o.apiKey, '***');
        throw new Error(`jev: HTTP ${res.status}${text ? ` ${text}` : ''}`);
      }
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        throw new Error('jev: response is not JSON');
      }
      const mapped = mapDecision(parsed, req.options.length);
      if (!mapped) throw new Error('jev: response has no usable answers.decision');
      return { ...mapped, latencyMs: Math.max(0, Math.round(now() - started)) };
    },
  };
  return provider;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * In-memory cache keyed by SHA-256 of `{ instructions, situation, options }` (spec §9). Concurrent identical requests share
 * one call; failures are not cached; cache hits report latencyMs 0.
 */
export function withCache(p: DecisionProvider): DecisionProvider {
  const cache = new Map<string, Promise<Choice>>();
  const m = (p as { model?: unknown }).model;
  const wrapped = {
    ...(typeof m === 'string' ? { model: m } : {}),
    async choose(req: Req): Promise<Choice> {
      const key = await sha256Hex(JSON.stringify({ instructions: req.instructions, situation: req.situation, options: req.options }));
      let entry = cache.get(key);
      const hit = entry !== undefined;
      if (!entry) {
        entry = Promise.resolve().then(() => p.choose(req));
        cache.set(key, entry);
        entry.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      }
      const r = await entry;
      return { index: r.index, probs: [...r.probs], latencyMs: hit ? 0 : r.latencyMs };
    },
  };
  return wrapped;
}
