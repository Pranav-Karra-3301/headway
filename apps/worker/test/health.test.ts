import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
// Load the worker's module graph (sim + evolve) at import time: otherwise the first `exports.default.fetch` pays for it
// inside the test, which can exceed the default 5 s timeout on a busy machine.
import '../src/index';

describe('GET /api/health', () => {
  it('reports ok with the sim version', async () => {
    const res = await exports.default.fetch('https://headway.test/api/health');
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; simVersion: string; time: string }>();
    expect(body.ok).toBe(true);
    expect(body.simVersion).toBe('1');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  }, 30_000);
});
