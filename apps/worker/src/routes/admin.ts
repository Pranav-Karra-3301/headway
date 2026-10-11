// Admin endpoints (Bearer ADMIN_TOKEN): CLI publish; part 2 adds sealed evaluation.
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { META_BASELINE, META_REFERENCE, saveRoundStatements, upsertGeneration, upsertMeta } from '../db';
import type { AppContext, AppDeps } from '../env';
import { jsonError, readJson, safeEqual } from '../http';
import { parsePublish } from '../validate';

/** 401 unless `Authorization: Bearer <ADMIN_TOKEN>`; an unset/empty ADMIN_TOKEN rejects everything. */
export function requireAdmin(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const expected = c.env.ADMIN_TOKEN ?? '';
    const m = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization') ?? '');
    if (!expected || !m || !(await safeEqual(m[1], expected))) {
      c.header('WWW-Authenticate', 'Bearer');
      return jsonError(c, 401, 'unauthorized');
    }
    await next();
  };
}

export function adminRoutes(deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();
  r.use('/api/admin/*', requireAdmin());

  /**
   * Body: `{ generations?: Generation[]; rounds?: Round[]; baseline?: SplitScore; reference?: SplitScore }` (rounds carry proposals).
   * Upserts everything in one D1 batch; a re-published round's proposal set is replaced exactly.
   * → `{ ok: true, generations, rounds, proposals }` (counts written).
   */
  r.post('/api/admin/publish', async (c) => {
    const body = await readJson(c.req.raw, 8 * 1024 * 1024);
    if (!body.ok) return jsonError(c, body.status, body.error);
    const parsed = parsePublish(body.value);
    if (!parsed.ok) return jsonError(c, 400, 'invalid publish body', parsed.errors);
    const { generations = [], rounds = [], baseline, reference } = parsed.value;
    const db = c.env.DB;
    const now = new Date(deps.now()).toISOString();
    const stmts = [
      ...rounds.flatMap((round) => saveRoundStatements(db, round)),
      ...generations.map((g) => upsertGeneration(db, g)),
      ...(baseline ? [upsertMeta(db, META_BASELINE, baseline, now)] : []),
      ...(reference ? [upsertMeta(db, META_REFERENCE, reference, now)] : []),
    ];
    try {
      await db.batch(stmts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('publish failed', message);
      return jsonError(c, /constraint/i.test(message) ? 409 : 500, 'publish failed', [message]);
    }
    return c.json({ ok: true, generations: generations.length, rounds: rounds.length, proposals: rounds.reduce((n, round) => n + round.proposals.length, 0) });
  });

  // T5 part 2: POST /api/admin/sealed-eval (sealed evaluation of champion, g0 and ref on SEALED_TEST_SEEDS).
  r.post('/api/admin/sealed-eval', (c) => jsonError(c, 501, 'not implemented yet'));

  return r;
}
