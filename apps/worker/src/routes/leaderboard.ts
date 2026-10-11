// Player leaderboard and sealed results.
// T5 part 2: GET /api/leaderboard?seed= (top 20), POST /api/leaderboard { name, replay } with runSync re-simulation
// (simVersion, mapVersion, play seed within the last 7 days, name ≤ 16 chars of [A-Za-z0-9 _-], 5/min/IP), GET /api/sealed.
import { Hono } from 'hono';
import type { AppContext, AppDeps } from '../env';
import { jsonError } from '../http';

export function leaderboardRoutes(_deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();
  r.get('/api/leaderboard', (c) => jsonError(c, 501, 'not implemented yet'));
  r.post('/api/leaderboard', (c) => jsonError(c, 501, 'not implemented yet'));
  r.get('/api/sealed', (c) => jsonError(c, 501, 'not implemented yet'));
  return r;
}
