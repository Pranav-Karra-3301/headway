// Admin endpoints (Bearer ADMIN_TOKEN): CLI publish and the sealed test evaluation (spec §7, §11).
import { DEFAULT_CONFIG, G0, REF, SCENARIOS, TOWN } from '@headway/sim';
import type { Policy, RunResult, ScenarioInstance, SplitScore } from '@headway/sim';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { latestGeneration, META_BASELINE, META_REFERENCE, saveRoundStatements, upsertGeneration, upsertMeta, upsertSealed } from '../db';
import type { SealedRole } from '../db';
import type { AppContext, AppDeps } from '../env';
import { jsonError, readJson, safeEqual, sha256Hex } from '../http';
import { aggregate, policyKey, runPolicy } from '../score';
import { isObj, parsePublish, parseSealedEval, parseSealedSeeds } from '../validate';
import type { SealedEvalBody } from '../validate';

/** stadium_exit and class_change, plus evening_commute when the sim defines it (same list as `eval-sealed`, spec §7). */
export function sealedScenarios(): string[] {
  return ['stadium_exit', 'class_change', ...((SCENARIOS as Record<string, unknown>).evening_commute ? ['evening_commute'] : [])];
}

/**
 * Champion, g0 and ref on every (scenario, sealed seed): the same numbers `eval-sealed` computes in Node.
 * The result carries only aggregates and a seed-set fingerprint, never the seeds or per-run results.
 */
export async function sealedEvaluation(o: { seeds: number[]; champion: { id: string; policy: Policy }; now: string }): Promise<SealedEvalBody> {
  const scenarios = sealedScenarios();
  const instances: ScenarioInstance[] = scenarios.flatMap((scenarioId) => o.seeds.map((seed) => ({ scenarioId, seed, split: 'test' as const })));
  const entries: Array<{ role: SealedRole; policyId: string; policy: Policy }> = [
    { role: 'champion', policyId: o.champion.id, policy: o.champion.policy },
    { role: 'baseline', policyId: G0.meta.id, policy: G0 },
    { role: 'reference', policyId: REF.meta.id, policy: REF },
  ];
  const runs = new Map<string, RunResult[]>();
  const scored = entries.map((e) => {
    const key = policyKey(e.policy);
    let rs = runs.get(key);
    if (!rs) {
      rs = instances.map((i) => runPolicy(e.policy, i));
      runs.set(key, rs);
    }
    const byScenario: Record<string, SplitScore> = {};
    for (const s of scenarios) byScenario[s] = aggregate(rs.filter((r) => r.scenarioId === s));
    return { ...e, score: aggregate(rs), byScenario };
  });
  const baseJ = scored.find((s) => s.role === 'baseline')!.score.J;
  return {
    simVersion: DEFAULT_CONFIG.simVersion, mapVersion: TOWN.version,
    seedSet: (await sha256Hex([...o.seeds].sort((a, b) => a - b).join(','))).slice(0, 8),
    scenarios, seedsPerScenario: o.seeds.length, runs: instances.length, createdAt: o.now,
    results: scored.map((s) => ({
      role: s.role, policyId: s.policyId, simVersion: DEFAULT_CONFIG.simVersion, jTest: s.score.J, metrics: s.score.metrics, score: s.score,
      byScenario: s.byScenario, deltaVsBaselinePct: baseJ > 0 ? ((s.score.J - baseJ) / baseJ) * 100 : null, createdAt: o.now,
    })),
  };
}

function sealedStatements(db: D1Database, b: SealedEvalBody): D1PreparedStatement[] {
  return b.results.map((x) =>
    upsertSealed(db, {
      policyId: x.policyId, role: x.role, simVersion: x.simVersion, mapVersion: b.mapVersion, jTest: x.jTest, metrics: x.metrics,
      runs: x.score?.runs ?? b.runs, byScenario: x.byScenario ?? {}, deltaVsBaselinePct: x.deltaVsBaselinePct ?? null,
      seedSet: b.seedSet, scenarios: b.scenarios, createdAt: x.createdAt ?? b.createdAt,
    }));
}

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

  /**
   * Sealed test results (never shown to agents). Two forms:
   * - the body `eval-sealed --url …` POSTs (SealedEvalBody: `{ simVersion, mapVersion, seedSet, scenarios, seedsPerScenario,
   *   runs, createdAt, results: [{ role, policyId, simVersion, jTest, metrics, score, byScenario, deltaVsBaselinePct, createdAt }] }`)
   *   → stored as-is → `{ ok, stored, seedSet, createdAt }`;
   * - `{}` / an empty body → the worker evaluates the champion, g0 and ref on SEALED_TEST_SEEDS itself, stores and returns
   *   `{ ok, stored, ...SealedEvalBody }`.
   * Re-posting the same evaluation (seedSet + createdAt + role) overwrites it.
   */
  r.post('/api/admin/sealed-eval', async (c) => {
    const body = await readJson(c.req.raw, 1024 * 1024, { emptyAs: {} });
    if (!body.ok) return jsonError(c, body.status, body.error);
    const db = c.env.DB;

    if (isObj(body.value) && Object.keys(body.value).length === 0) {
      const raw = c.env.SEALED_TEST_SEEDS ?? '';
      if (!raw.trim()) {
        return jsonError(c, 400, 'SEALED_TEST_SEEDS is not configured on this worker: POST the body from `eval-sealed --url <worker>`, or set the secret');
      }
      const seeds = parseSealedSeeds(raw);
      if (!seeds) return jsonError(c, 503, 'SEALED_TEST_SEEDS is malformed: expected a JSON array of 1–10 distinct positive integers');
      const g = await latestGeneration(db);
      const result = await sealedEvaluation({ seeds, champion: g ? { id: g.id, policy: g.policy } : { id: G0.meta.id, policy: G0 }, now: new Date(deps.now()).toISOString() });
      await db.batch(sealedStatements(db, result));
      return c.json({ ok: true, stored: result.results.length, ...result });
    }

    const parsed = parseSealedEval(body.value);
    if (!parsed.ok) return jsonError(c, 400, 'invalid sealed-eval body', parsed.errors);
    const roles = parsed.value.results.map((x) => x.role);
    if (new Set(roles).size !== roles.length) return jsonError(c, 400, 'invalid sealed-eval body', ['results: one result per role (champion, baseline, reference)']);
    await db.batch(sealedStatements(db, parsed.value));
    return c.json({ ok: true, stored: parsed.value.results.length, seedSet: parsed.value.seedSet, createdAt: parsed.value.createdAt });
  });

  return r;
}
