// Jev (TypeSafe System One) via OpenRouter `${OPENROUTER_BASE_URL}/systemone` (spec §9). Same request body as
// packages/evolve/src/jev/provider.ts so browser (proxy) and CLI decisions match.
import { isObj } from './validate';
import type { JevDecideRequest } from './validate';

export const JEV_QUESTION = 'Which option should dispatch choose now to follow operating_instructions?';

/** `/api/jev/decide` response: DecisionProvider.choose's `{ index, probs, latencyMs }` plus context. */
export interface JevDecision {
  index: number;
  probs: number[];
  choice: string;
  confidence: number | null;
  model: string;
  latencyMs: number;
}

export class UpstreamError extends Error {
  readonly status: 502 | 504;
  constructor(status: 502 | 504, message: string) {
    super(message);
    this.status = status;
  }
}

export function systemOneBody(model: string, req: JevDecideRequest) {
  const criteria: Record<string, string> = {};
  req.options.forEach((label, i) => {
    criteria[`o${i}`] = label;
  });
  return {
    model,
    state: { situation: req.situation, operating_instructions: req.instructions },
    questions: { decision: { type: 'choice', instructions: JEV_QUESTION, criteria } },
  };
}

/** Maps `answers.decision` to option order. Index = the chosen key, else argmax (ties → lowest index). */
export function mapAnswer(json: unknown, options: string[], requestedModel: string): Omit<JevDecision, 'latencyMs'> | null {
  if (!isObj(json) || !isObj(json.answers) || !isObj(json.answers.decision)) return null;
  const a = json.answers.decision;
  const p = isObj(a.probabilities) ? a.probabilities : {};
  const probs = options.map((_, i) => {
    const v = p[`o${i}`];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  });
  const chosen = typeof a.choice === 'string' && /^o\d+$/.test(a.choice) ? Number(a.choice.slice(1)) : -1;
  let index = chosen >= 0 && chosen < options.length ? chosen : -1;
  if (index < 0 && probs.some((x) => x > 0)) index = probs.indexOf(Math.max(...probs));
  if (index < 0) return null;
  return {
    index,
    probs,
    choice: options[index],
    confidence: typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : null,
    model: typeof json.model === 'string' ? json.model : requestedModel,
  };
}

export async function callSystemOne(
  o: { fetch: typeof fetch; baseUrl: string; apiKey: string; model: string; timeoutMs: number; now: () => number },
  req: JevDecideRequest,
): Promise<JevDecision> {
  const started = o.now();
  let res: Response;
  try {
    res = await o.fetch(`${o.baseUrl.replace(/\/+$/, '')}/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${o.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://headway.pranavkarra001.workers.dev',
        'X-Title': 'Headway',
      },
      body: JSON.stringify(systemOneBody(o.model, req)),
      signal: AbortSignal.timeout(o.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw new UpstreamError(504, `jev timed out after ${o.timeoutMs} ms`);
    throw new UpstreamError(502, `jev request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new UpstreamError(502, `jev upstream ${res.status}${text ? `: ${text}` : ''}`);
  }
  const mapped = mapAnswer(await res.json().catch(() => null), req.options, o.model);
  if (!mapped) throw new UpstreamError(502, 'jev upstream returned no usable answers.decision');
  return { ...mapped, latencyMs: Math.max(0, o.now() - started) };
}
