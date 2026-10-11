// POST /api/jev/decide: validated, cached, rate-limited proxy to Jev (spec §9, §11).
import { Hono } from 'hono';
import type { AppContext, AppDeps } from '../env';
import { clientIp, FixedWindowLimiter, jsonError, readJson, sha256Hex } from '../http';
import { callSystemOne, UpstreamError } from '../jev';
import type { JevDecision } from '../jev';
import { parseJevRequest } from '../validate';

const RATE_LIMIT_PER_MIN = 30;
const MEMO_MAX = 500;
const UPSTREAM_TIMEOUT_MS = 5_000;
const CACHE_TTL_S = 86_400;

export function jevRoutes(deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();
  const limiter = new FixedWindowLimiter(RATE_LIMIT_PER_MIN, 60_000, deps.now);
  const memo = new Map<string, JevDecision>();
  const remember = (key: string, d: JevDecision) => {
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(key, d);
  };

  /**
   * Body `{ instructions ≤ 1200, situation 1..1500, options: 2..8 labels }` →
   * `{ index, probs, choice, confidence, model, latencyMs, cached }`.
   * Identical requests are served from memory / the Cache API (key: SHA-256 of model + body); only upstream
   * calls count against the 30/min/IP limit.
   */
  r.post('/api/jev/decide', async (c) => {
    const body = await readJson(c.req.raw, 16 * 1024);
    if (!body.ok) return jsonError(c, body.status, body.error);
    const parsed = parseJevRequest(body.value);
    if (!parsed.ok) return jsonError(c, 400, 'invalid request', parsed.errors);
    const req = parsed.value;

    const model = c.env.JEV_MODEL;
    const key = await sha256Hex(JSON.stringify({ model, instructions: req.instructions, situation: req.situation, options: req.options }));
    const cacheUrl = new URL(`/__cache/jev/${key}`, c.req.url).toString();
    const cache = deps.cache();

    let hit = memo.get(key) ?? null;
    if (!hit && cache) {
      try {
        const res = await cache.match(cacheUrl);
        if (res) hit = await res.json<JevDecision>();
      } catch (err) {
        console.warn('jev cache read failed', err);
      }
      if (hit) remember(key, hit);
    }
    if (hit) return c.json({ ...hit, cached: true });

    const lim = limiter.hit(clientIp(c.req.raw));
    if (!lim.ok) {
      c.header('Retry-After', String(lim.retryAfterS));
      return jsonError(c, 429, `rate limited: ${RATE_LIMIT_PER_MIN} Jev calls per minute`);
    }
    if (!c.env.OPENROUTER_API_KEY) return jsonError(c, 503, 'jev is not configured');

    let decision: JevDecision;
    try {
      decision = await callSystemOne(
        { fetch: deps.fetch, baseUrl: c.env.OPENROUTER_BASE_URL, apiKey: c.env.OPENROUTER_API_KEY, model, timeoutMs: UPSTREAM_TIMEOUT_MS, now: deps.now },
        req,
      );
    } catch (err) {
      if (err instanceof UpstreamError) return jsonError(c, err.status, err.message);
      throw err;
    }
    remember(key, decision);
    if (cache) {
      try {
        await cache.put(cacheUrl, Response.json(decision, { headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_S}` } }));
      } catch (err) {
        console.warn('jev cache write failed', err);
      }
    }
    return c.json({ ...decision, cached: false });
  });

  return r;
}
