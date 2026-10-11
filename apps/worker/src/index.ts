import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, simVersion: c.env.SIM_VERSION, time: new Date().toISOString() }));

export default app;
