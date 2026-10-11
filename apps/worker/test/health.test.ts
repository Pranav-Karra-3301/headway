import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('reports ok with the sim version', async () => {
    const res = await exports.default.fetch('https://headway.test/api/health');
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; simVersion: string; time: string }>();
    expect(body.ok).toBe(true);
    expect(body.simVersion).toBe('1');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
