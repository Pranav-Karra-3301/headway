// POST /api/evolve (Bearer ADMIN_TOKEN): one evolution round streamed as NDJSON EvolveEvents.
// T5 part 2: runRound with a D1-backed EvolveStore; lock via rounds.status = 'running' (stale after 10 min).
import { Hono } from 'hono';
import type { AppContext, AppDeps } from '../env';
import { jsonError } from '../http';
import { requireAdmin } from './admin';

export function evolveRoutes(_deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();
  r.post('/api/evolve', requireAdmin(), (c) => jsonError(c, 501, 'not implemented yet'));
  return r;
}
