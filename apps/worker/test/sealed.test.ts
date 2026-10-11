import { G0, REF } from '@headway/sim';
import type { Metrics, SplitScore } from '@headway/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { sha256Hex } from '../src/http';
import { admin, call, generation, metrics, resetDb, split, testEnv } from './helpers';

type Row = {
  id: string; policyId: string; role: string; simVersion: string; mapVersion: string; jTest: number; metrics: Metrics; runs: number;
  byScenario: Record<string, SplitScore>; deltaVsBaselinePct: number | null; seedSet: string; scenarios: string[]; createdAt: string;
};
type Err = { error: string; details?: string[] };

const T0 = Date.UTC(2026, 9, 11, 21, 0, 0);
const CREATED = '2026-10-11T19:00:00.000Z';

/** The body packages/evolve/src/cli/eval-sealed.ts (T8) POSTs: SealedEvalBody. */
function t8Body(createdAt = CREATED) {
  const res = (role: string, policyId: string, J: number, delta: number | null) => ({
    role, policyId, simVersion: '1', jTest: J, metrics: metrics(J), score: split(J, 9),
    byScenario: { stadium_exit: split(J * 0.6, 3), class_change: split(J * 0.3, 3), evening_commute: split(J * 0.1, 3) },
    deltaVsBaselinePct: delta, createdAt,
  });
  return {
    simVersion: '1', mapVersion: '1', seedSet: 'a1b2c3d4', scenarios: ['stadium_exit', 'class_change', 'evening_commute'],
    seedsPerScenario: 3, runs: 9, createdAt,
    results: [res('champion', 'g4', 2_700_000, -10), res('baseline', 'g0', 3_000_000, 0), res('reference', 'ref', 2_850_000, -5)],
  };
}

const sealed = async (app: ReturnType<typeof createApp>) => (await call(app, '/api/sealed')).json<{ results: Row[] }>();
const post = (app: ReturnType<typeof createApp>, json: unknown, e = testEnv(), headers: Record<string, string> = admin) =>
  call(app, '/api/admin/sealed-eval', { json, headers, env: e });

beforeEach(resetDb);

describe('sealed test results', () => {
  it('GET /api/sealed is empty at first', async () => {
    const res = await call(createApp(), '/api/sealed');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  it('POST /api/admin/sealed-eval needs the admin token', async () => {
    expect((await post(createApp(), t8Body(), testEnv(), {})).status).toBe(401);
    expect((await sealed(createApp())).results).toEqual([]);
  });

  it('stores the eval-sealed CLI body and serves it newest first', async () => {
    const app = createApp({ now: () => T0 });
    const res = await post(app, t8Body());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, stored: 3, seedSet: 'a1b2c3d4', createdAt: CREATED });

    const later = '2026-10-11T20:30:00.000Z';
    expect((await post(app, { ...t8Body(later), results: t8Body(later).results.slice(0, 1) })).status).toBe(200);

    const { results } = await sealed(app);
    expect(results).toHaveLength(4);
    expect(results[0]).toMatchObject({ policyId: 'g4', role: 'champion', createdAt: later });
    const g0 = results.find((r) => r.policyId === 'g0')!;
    expect(g0).toEqual({
      id: expect.any(String), policyId: 'g0', role: 'baseline', simVersion: '1', mapVersion: '1', jTest: 3_000_000, metrics: metrics(3_000_000), runs: 9,
      byScenario: t8Body().results[1].byScenario, deltaVsBaselinePct: 0, seedSet: 'a1b2c3d4',
      scenarios: ['stadium_exit', 'class_change', 'evening_commute'], createdAt: CREATED,
    });
    expect(new Set(results.map((r) => r.id)).size).toBe(4);
  });

  it('re-posting the same evaluation is idempotent', async () => {
    const app = createApp({ now: () => T0 });
    expect((await post(app, t8Body())).status).toBe(200);
    expect((await post(app, t8Body())).status).toBe(200);
    expect((await sealed(app)).results).toHaveLength(3);
  });

  it('400s malformed bodies with path-named errors', async () => {
    const app = createApp({ now: () => T0 });
    const b = t8Body();
    const cases: unknown[] = [
      { ...b, results: [] },
      { ...b, results: [{ ...b.results[0], role: 'oracle' }] },
      { ...b, results: [{ ...b.results[0], jTest: 'lots' }] },
      { ...b, results: [{ ...b.results[0], metrics: { J: 1 } }] },
      { ...b, seedSet: 7 },
      [b],
    ];
    for (const json of cases) {
      const res = await post(app, json);
      expect(res.status, JSON.stringify(json).slice(0, 100)).toBe(400);
      expect((await res.json<Err>()).details?.length ?? 0).toBeGreaterThan(0);
    }
    expect((await sealed(app)).results).toEqual([]);
  });

  it('evaluates champion, g0 and ref on SEALED_TEST_SEEDS itself when the body has no results — never revealing the seeds', async () => {
    const app = createApp({ now: () => T0 });
    const g1 = generation(1, 'r1-b');
    await call(app, '/api/admin/publish', { json: { generations: [generation(0, null), g1] }, headers: admin });

    const e = testEnv({ SEALED_TEST_SEEDS: '[777001]' });
    const res = await post(app, {}, e);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('777001');
    const body = JSON.parse(text) as {
      ok: boolean; stored: number; seedSet: string; scenarios: string[]; runs: number; seedsPerScenario: number;
      results: Array<Omit<Row, 'runs'> & { score: SplitScore }>;
    };
    expect(body).toMatchObject({ ok: true, stored: 3, runs: 3, seedsPerScenario: 1, scenarios: ['stadium_exit', 'class_change', 'evening_commute'] });
    expect(body.seedSet).toBe((await sha256Hex('777001')).slice(0, 8));
    expect(body.results.map((r) => [r.role, r.policyId])).toEqual([['champion', 'g1'], ['baseline', 'g0'], ['reference', 'ref']]);
    const base = body.results[1];
    expect(base.deltaVsBaselinePct).toBe(0);
    expect(base.jTest).toBeGreaterThan(0);
    expect(base.score.runs).toBe(3);
    expect(Object.keys(base.byScenario)).toEqual(['stadium_exit', 'class_change', 'evening_commute']);
    expect(Object.values(base.byScenario).reduce((s, x) => s + x.J, 0)).toBeCloseTo(base.jTest, 0);
    expect(body.results[2].jTest).not.toBe(base.jTest);

    const stored = await sealed(app);
    expect(stored.results.map((r) => r.policyId).sort()).toEqual(['g0', 'g1', 'ref']);
    expect(JSON.stringify(stored)).not.toContain('777001');
    expect(G0.meta.id).toBe('g0');
    expect(REF.meta.id).toBe('ref');
  });

  it('server-side evaluation needs SEALED_TEST_SEEDS and never echoes a malformed value', async () => {
    const app = createApp({ now: () => T0 });
    const missing = await post(app, {});
    expect(missing.status).toBe(400);
    expect((await missing.json<Err>()).error).toMatch(/SEALED_TEST_SEEDS/);

    const bad = await post(app, {}, testEnv({ SEALED_TEST_SEEDS: '[123456, "secret-ish"]' }));
    expect(bad.status).toBe(503);
    const text = await bad.text();
    expect(text).toMatch(/SEALED_TEST_SEEDS/);
    expect(text).not.toContain('123456');
    expect((await sealed(app)).results).toEqual([]);
  });
});
