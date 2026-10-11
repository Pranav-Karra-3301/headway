import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSealed, normalizeSealed, sealedRows } from '../sealed';
import { metrics } from './helpers';

describe('normalizeSealed', () => {
  it('reads D1-style rows (snake_case, metrics as JSON text) and keeps the latest per policy', () => {
    const rows = normalizeSealed({
      results: [
        { id: 'x1', policy_id: 'g3', sim_version: 's1', j_test: 900, metrics_json: JSON.stringify(metrics(900)), created_at: '2026-10-11T15:00:00Z' },
        { id: 'x2', policy_id: 'g0', sim_version: 's1', j_test: 1000, metrics_json: JSON.stringify(metrics(1000)), created_at: '2026-10-11T15:00:00Z' },
        { id: 'x3', policy_id: 'g4', sim_version: 's1', j_test: 850, metrics_json: JSON.stringify(metrics(850)), created_at: '2026-10-11T16:00:00Z' },
        { id: 'x4', policy_id: 'g0', sim_version: 's1', j_test: 1001, metrics_json: '{bad json', created_at: '2026-10-11T16:00:00Z' },
        { id: 'x5', policy_id: 'ref', sim_version: 's1', j_test: 940, metrics_json: null, created_at: '2026-10-11T16:00:00Z' },
      ],
    });
    expect(rows.map((r) => r.policyId)).toEqual(['g0', 'ref', 'g3', 'g4']);
    const g0 = rows[0]!;
    expect(g0.J).toBe(1001);
    expect(g0.metrics).toBeNull();
    expect(rows[2]!.metrics?.completionPct).toBe(95.8);
    expect(rows[1]!.simVersion).toBe('s1');
  });

  it('reads camelCase rows and plain arrays', () => {
    const rows = normalizeSealed([
      { policyId: 'g2', jTest: 700, metrics: metrics(700), createdAt: '2026-10-11T15:00:00Z' },
      { policyId: 'g0', J: 800 },
    ]);
    expect(rows.map((r) => [r.policyId, r.J])).toEqual([['g0', 800], ['g2', 700]]);
  });

  it('reads a map keyed by policy with SplitScore values', () => {
    const rows = normalizeSealed({ g0: { J: 10, runs: 6, metrics: metrics(10) }, ref: { J: 9, runs: 6, metrics: metrics(9) }, g5: { J: 8, runs: 6, metrics: metrics(8) } });
    expect(rows.map((r) => [r.policyId, r.J, r.runs])).toEqual([['g0', 10, 6], ['ref', 9, 6], ['g5', 8, 6]]);
  });

  it('ignores junk', () => {
    expect(normalizeSealed(null)).toEqual([]);
    expect(normalizeSealed('nope')).toEqual([]);
    expect(normalizeSealed({ results: [{ policy_id: 'g1' }, { j_test: 5 }] })).toEqual([]);
    expect(normalizeSealed({ error: 'not implemented yet' })).toEqual([]);
  });
});

describe('sealedRows', () => {
  it('labels rows and computes the change vs g0', () => {
    const rows = sealedRows(normalizeSealed({ g0: { J: 1000 }, ref: { J: 940 }, g4: { J: 850 } }), 'g4');
    expect(rows.map((r) => r.label)).toEqual(['Baseline g0', 'Reference', 'Champion g4']);
    expect(rows.map((r) => r.vsBaselinePct)).toEqual([0, -6, -15]);
    expect(rows[2]!.champion).toBe(true);
  });

  it('keeps only g0, ref and the newest generation when several were sealed', () => {
    const rows = sealedRows(normalizeSealed({ g0: { J: 1000 }, ref: { J: 940 }, g3: { J: 900 }, g4: { J: 850 } }), null);
    expect(rows.map((r) => r.policyId)).toEqual(['g0', 'ref', 'g4']);
  });
});

describe('loadSealed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses /api/sealed when it answers', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/sealed') return new Response(JSON.stringify({ results: [{ policy_id: 'g0', j_test: 5 }] }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const rows = await loadSealed();
    expect(rows.map((r) => r.policyId)).toEqual(['g0']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the API fails or is unreachable (no static fallback)', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"not implemented yet"}', { status: 501 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadSealed()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await loadSealed()).toEqual([]);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    expect(await loadSealed()).toEqual([]);
  });
});
