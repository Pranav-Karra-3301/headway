// Hono app: /api/* (spec §11). Static assets are served by the ASSETS binding before the worker runs.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext, AppDeps } from './env';
import { jsonError } from './http';
import { adminRoutes } from './routes/admin';
import { defaultDesigner, evolveRoutes } from './routes/evolve';
import { jevRoutes } from './routes/jev';
import { leaderboardRoutes } from './routes/leaderboard';
import { publicRoutes } from './routes/public';
import { evaluateSplit } from './score';

/** Local dev servers (Vite on any port) may call the API cross-origin; production is same-origin. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp(overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    fetch: (input, init) => fetch(input, init),
    cache: () => (typeof caches === 'undefined' ? null : caches.default),
    now: () => Date.now(),
    designer: (env) => defaultDesigner(env, deps.fetch),
    evaluate: evaluateSplit,
    ...overrides,
  };
  const app = new Hono<AppContext>();

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (LOCAL_ORIGIN.test(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['Retry-After'],
      maxAge: 600,
    }),
  );
  app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method === 'GET' && !c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/api/health', (c) => c.json({ ok: true, simVersion: c.env.SIM_VERSION, time: new Date(deps.now()).toISOString() }));
  app.route('/', publicRoutes());
  app.route('/', adminRoutes(deps));
  app.route('/', jevRoutes(deps));
  app.route('/', evolveRoutes(deps));
  app.route('/', leaderboardRoutes(deps));

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/') || !c.env?.ASSETS) return jsonError(c, 404, 'not found');
    return c.env.ASSETS.fetch(c.req.raw);
  });
  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    return jsonError(c, 500, 'internal error');
  });
  return app;
}
