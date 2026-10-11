import { DEFAULT_CONFIG, G0, REF, SEEDS } from '@headway/sim';
import type { Policy, ScenarioInstance } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import { baselineGeneration, createEvaluator, evaluatePolicy, evolveInstances, policyBody, type EvaluatorCache, type RunOne } from '../src/evaluate';
import { gap, metrics, missed, runResult } from './fixtures';

const STADIUM_1001: ScenarioInstance = { scenarioId: 'stadium_exit', seed: 1001, split: 'train' };
const withId = (p: Policy, id: string): Policy => ({ ...p, meta: { ...p.meta, id, summary: `copy ${id}` } });

/** A fake engine: J depends on the policy body and the instance, so cache mistakes show up as wrong numbers. */
function fakeRun(): { run: RunOne; calls: string[] } {
  const calls: string[] = [];
  const run: RunOne = (policy, inst) => {
    calls.push(`${policy.meta.id}|${inst.scenarioId}|${inst.seed}`);
    const J = 1000 + inst.seed + policy.rules.length * 7;
    return runResult({ scenarioId: inst.scenarioId, seed: inst.seed, controller: { kind: 'policy', policyId: policy.meta.id }, metrics: metrics({ J }) });
  };
  return { run, calls };
}

describe('evaluatePolicy (real engine)', () => {
  it('runs the policy on each instance and aggregates the split score', () => {
    const { score, results } = evaluatePolicy(G0, [STADIUM_1001]);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r).toMatchObject({ scenarioId: 'stadium_exit', seed: 1001, controller: { kind: 'policy', policyId: 'g0' }, simVersion: DEFAULT_CONFIG.simVersion });
    expect(r.metrics.spawned).toBeGreaterThan(0);
    expect(score.runs).toBe(1);
    expect(score.J).toBeCloseTo(r.metrics.J, 1);
    expect(score.metrics.spawned).toBe(r.metrics.spawned);
  });

  it('is deterministic and distinguishes policies', () => {
    const a = evaluatePolicy(G0, [STADIUM_1001]).results[0]!;
    const b = evaluatePolicy(G0, [STADIUM_1001]).results[0]!;
    const c = evaluatePolicy(REF, [STADIUM_1001]).results[0]!;
    expect(b.hash).toBe(a.hash);
    expect(b.metrics.J).toBe(a.metrics.J);
    expect(c.controller).toEqual({ kind: 'policy', policyId: 'ref' });
    expect(c.hash).not.toBe(a.hash);
  });

  it('returns an empty score for no instances', () => {
    expect(evaluatePolicy(G0, [])).toMatchObject({ results: [], score: { J: 0, runs: 0 } });
  });
});

describe('evolveInstances', () => {
  it('uses the spec §7 train and val instances, as copies', () => {
    const train = evolveInstances('train');
    expect(train).toEqual(SEEDS.train);
    expect(train).toHaveLength(8);
    expect(new Set(train.map((x) => x.scenarioId))).toEqual(new Set(['stadium_exit', 'class_change']));
    expect(train.map((x) => x.seed).sort()).toEqual([1001, 1001, 1002, 1002, 1003, 1003, 1004, 1004]);
    expect(evolveInstances('val')).toEqual(SEEDS.val);
    expect(evolveInstances('val').every((x) => x.split === 'val')).toBe(true);
    train[0]!.seed = 9;
    expect(SEEDS.train[0]!.seed).not.toBe(9);
  });
});

describe('policyBody', () => {
  it('ignores meta and key order', () => {
    const reordered = JSON.parse(JSON.stringify({ rules: G0.rules, defaults: G0.defaults, params: G0.params, meta: G0.meta })) as Policy;
    expect(policyBody(withId(reordered, 'g7'))).toBe(policyBody(G0));
    expect(policyBody(REF)).not.toBe(policyBody(G0));
  });
});

describe('createEvaluator', () => {
  it('caches by policy body, sim version and split', async () => {
    const { run, calls } = fakeRun();
    const ev = createEvaluator({ run, yieldBetweenRuns: false });
    const first = await ev.evaluate(G0, 'train');
    expect(first.results).toHaveLength(8);
    expect(calls).toHaveLength(8);

    const again = await ev.evaluate(G0, 'train');
    expect(calls).toHaveLength(8);
    expect(again.score).toEqual(first.score);

    await ev.evaluate(G0, 'val');
    expect(calls).toHaveLength(12);
    await ev.evaluate(REF, 'train');
    expect(calls).toHaveLength(20);
    expect(ev.stats).toEqual({ runs: 20, hits: 1, misses: 3 });
  });

  it('re-stamps cached results with the requesting policy id (a promoted proposal keeps its scores)', async () => {
    const { run, calls } = fakeRun();
    const ev = createEvaluator({ run, yieldBetweenRuns: false });
    const asProposal = await ev.evaluate(withId(G0, 'r1-b'), 'train');
    const asGeneration = await ev.evaluate(withId(G0, 'g1'), 'train');
    expect(calls).toHaveLength(8);
    expect(asGeneration.score).toEqual(asProposal.score);
    expect(asGeneration.results.every((r) => r.controller.kind === 'policy' && r.controller.policyId === 'g1')).toBe(true);
    expect(asProposal.results.every((r) => r.controller.kind === 'policy' && r.controller.policyId === 'r1-b')).toBe(true);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const { run: ok } = fakeRun();
    const run: RunOne = (p, i) => {
      if (fail) throw new Error('engine exploded');
      return ok(p, i);
    };
    const ev = createEvaluator({ run, yieldBetweenRuns: false });
    await expect(ev.evaluate(G0, 'val')).rejects.toThrow('engine exploded');
    fail = false;
    await expect(ev.evaluate(G0, 'val')).resolves.toMatchObject({ score: { runs: 4 } });
  });

  it('keys on the sim version', async () => {
    const { run, calls } = fakeRun();
    const cache: EvaluatorCache = new Map();
    await createEvaluator({ run, yieldBetweenRuns: false, cache, simVersion: '1' }).evaluate(G0, 'val');
    await createEvaluator({ run, yieldBetweenRuns: false, cache, simVersion: '2' }).evaluate(G0, 'val');
    await createEvaluator({ run, yieldBetweenRuns: false, cache, simVersion: '2' }).evaluate(G0, 'val');
    expect(calls).toHaveLength(8);
  });

  it('runs the real engine by default and matches evaluatePolicy', async () => {
    const ev = createEvaluator();
    const viaEvaluator = await ev.evaluate(G0, 'val');
    const direct = evaluatePolicy(G0, SEEDS.val);
    expect(viaEvaluator.score).toEqual(direct.score);
    expect(viaEvaluator.results.map((r) => r.hash)).toEqual(direct.results.map((r) => r.hash));
  });
});

describe('baselineGeneration', () => {
  it('builds g0 from the G0 policy scored on train and val', async () => {
    const { run } = fakeRun();
    const findingsRun: RunOne = (p, i) => ({ ...run(p, i), findings: i.seed === 1001 ? [gap(50), missed(900)] : [gap(10)] });
    const ev = createEvaluator({ run: findingsRun, yieldBetweenRuns: false });
    const g0 = await baselineGeneration(ev.evaluate, () => '2026-10-11T09:00:00Z');
    expect(g0).toMatchObject({ id: 'g0', number: 0, parentId: null, fromProposal: null, createdAt: '2026-10-11T09:00:00Z', explanation: G0.meta.summary });
    expect(g0.policy.meta.id).toBe('g0');
    expect(policyBody(g0.policy)).toBe(policyBody(G0));
    expect(g0.train.runs).toBe(8);
    expect(g0.val.runs).toBe(4);
    expect(g0.findings.length).toBeLessThanOrEqual(8);
    expect(g0.findings[0]!.impactS).toBe(900);
  });
});
