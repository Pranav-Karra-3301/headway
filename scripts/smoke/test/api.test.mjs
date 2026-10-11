import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { checkApi } from '../api.mjs';
import { serve } from './helpers.mjs';

const policy = (allocation = { r1: 2, r2: 2, r3: 2 }) => ({
  meta: { id: 'g0', parent: null, generation: 0, author: 'baseline', emphasis: 'baseline', summary: 'even headways' },
  params: { allocation, maxHoldS: 90, trainDefaultDwellS: 40 },
  rules: [{ id: 'r-a' }],
  defaults: { bus_at_stop: { type: 'depart' }, bus_at_terminal: { type: 'dispatch' }, train_at_central: { type: 'depart' } },
});
const json = (body, status = 200) => ({ status, type: 'application/json', body });

const servers = [];
after(() => Promise.all(servers.map((s) => s.close())));
const site = async (routes) => { const s = await serve(routes); servers.push(s); return s.url; };

test('passes when champion validates and generations has entries', async () => {
  const url = await site({
    '/api/champion': json({ policy: policy(), generation: null, train: null, val: null }),
    '/api/generations': json({ generations: [{ id: 'g0', number: 0, policy: policy() }], rounds: [], baseline: null, reference: null }),
  });
  const r = await checkApi(url);
  assert.equal(r.ok, true, r.failures.join('; '));
  assert.deepEqual(r.failures, []);
  assert.ok(r.notes.some((n) => /g0/.test(n)));
  assert.ok(r.notes.some((n) => /1 generation/.test(n)));
});

test('fails on SPA HTML fallback, HTTP errors, a bad allocation and empty generations', async () => {
  const html = await site({
    '/api/champion': { body: '<!doctype html><div id=root></div>' },
    '/api/generations': json({ error: 'db down' }, 500),
  });
  const a = await checkApi(html);
  assert.equal(a.ok, false);
  assert.ok(a.failures.some((f) => /champion.*not JSON/.test(f)), a.failures.join('; '));
  assert.ok(a.failures.some((f) => /generations.*HTTP 500/.test(f)), a.failures.join('; '));

  const bad = await site({
    '/api/champion': json({ policy: policy({ r1: 3, r2: 2, r3: 2 }) }),
    '/api/generations': json({ generations: [], rounds: [] }),
  });
  const b = await checkApi(bad);
  assert.equal(b.ok, false);
  assert.ok(b.failures.some((f) => /allocation/.test(f)), b.failures.join('; '));
  assert.ok(b.failures.some((f) => /no generations/.test(f)), b.failures.join('; '));

  const shapeless = await site({
    '/api/champion': json({ policy: { meta: {}, rules: 'nope' } }),
    '/api/generations': json({ rounds: [] }),
  });
  const c = await checkApi(shapeless);
  assert.ok(c.failures.some((f) => /champion/.test(f)), c.failures.join('; '));
  assert.ok(c.failures.some((f) => /generations/.test(f)), c.failures.join('; '));
});

test('reports an unreachable server as a failure, not a throw', async () => {
  const r = await checkApi('http://127.0.0.1:9', { timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.ok(r.failures.length >= 2);
});
