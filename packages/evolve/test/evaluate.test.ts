import { DEFAULT_CONFIG, G0, REF, SEEDS } from '@headway/sim';
import type { Policy, ScenarioInstance } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import {
  baselineGeneration, championProbes, createEvaluator, evaluatePolicy, evolveInstances, MAX_PROBES, newRuleProbes, painFeatures, policyBody,
  runProbes, sampleFeatures, type EvaluatorCache, type FeatureSamples, type RunOne,
} from '../src/evaluate';
import { fakeEvaluate, gap, metrics, missed, overload, runResult } from './fixtures';

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
  it('runs the policy on each instance and aggregates the split score', { timeout: 30_000 }, () => {
    const { score, results } = evaluatePolicy(G0, [STADIUM_1001]);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r).toMatchObject({ scenarioId: 'stadium_exit', seed: 1001, controller: { kind: 'policy', policyId: 'g0' }, simVersion: DEFAULT_CONFIG.simVersion });
    expect(r.metrics.spawned).toBeGreaterThan(0);
    expect(score.runs).toBe(1);
    expect(score.J).toBeCloseTo(r.metrics.J, 1);
    expect(score.metrics.spawned).toBe(r.metrics.spawned);
  });

  it('is deterministic and distinguishes policies', { timeout: 30_000 }, () => {
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

  it('runs the real engine by default and matches evaluatePolicy', { timeout: 30_000 }, async () => {
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

describe('championProbes / runProbes', () => {
  it('builds rule ablations, every legal one-bus move and one default swap per decision kind', () => {
    const probes = championProbes(G0);
    expect(probes.map((p) => p.id)).toEqual([
      'rm-even-headway', 'mv-r1-r2', 'mv-r1-r3', 'mv-r2-r1', 'mv-r2-r3', 'mv-r3-r1', 'mv-r3-r2',
      'def-bus_at_stop', 'def-bus_at_terminal', 'def-train_at_station',
      'guard-even-headway-20', 'guard-even-headway-40', 'guard-even-headway-80',
      'thr-even-headway-0-0.5', 'thr-even-headway-0-1.5',
    ]);
    const guard = probes.find((p) => p.id === 'guard-even-headway-40')!;
    expect(guard.label).toBe('rule even-headway skipped while route_queue >= 40');
    expect(guard.policy.rules[0]!.when).toEqual([{ f: 'headway_ratio', op: '<', v: 1 }, { f: 'route_queue', op: '<', v: 40 }]);
    expect(probes.find((p) => p.id === 'thr-even-headway-0-0.5')!.label).toBe('rule even-headway: headway_ratio < 1 → 0.5');
    expect(championProbes(REF).length).toBeLessThanOrEqual(40);
    const mv = probes.find((p) => p.id === 'mv-r1-r3')!;
    expect(mv.label).toBe('move 1 bus r1→r3 (2/2/2 → 1/2/3)');
    expect(mv.policy.params.allocation).toEqual({ r1: 1, r2: 2, r3: 3 });
    expect(probes.find((p) => p.id === 'rm-even-headway')!.policy.rules).toEqual([]);
    expect(probes.find((p) => p.id === 'def-bus_at_terminal')!.policy.defaults.bus_at_terminal).toEqual({ type: 'hold', until: 'target_headway' });
    expect(probes.find((p) => p.id === 'def-train_at_station')!.policy.defaults.train_at_station).toEqual({ type: 'setTrainDeparture', dwellS: 30 });
    expect(G0.rules).toHaveLength(1); // the champion is not mutated
    // a route already at 1 bus never donates
    const ids = championProbes(REF).map((p) => p.id);
    expect(ids.filter((id) => id.startsWith('mv-r1-'))).toEqual([]);
    expect(ids).toContain('mv-r3-r1');
    expect(ids.filter((id) => id.startsWith('rm-'))).toHaveLength(REF.rules.length);
  });

  it('scores probes on the training split only, best first', async () => {
    const ev = fakeEvaluate({ 'probe-rm-even-headway': { train: 950, val: 1 }, 'probe-mv-r1-r3': { train: 1008, val: 1 }, default: { train: 1000, val: 1 } });
    const seen: string[] = [];
    const out = await runProbes(ev.evaluate, G0, 1000, (r, runs) => seen.push(`${r.id}:${runs}`));
    expect(ev.calls.every((c) => c.split === 'train')).toBe(true);
    expect(ev.calls).toHaveLength(15);
    expect(seen).toHaveLength(15);
    expect(out[0]).toMatchObject({ id: 'rm-even-headway', label: 'remove rule even-headway', deltaPct: -5 });
    expect(out.at(-1)).toMatchObject({ id: 'mv-r1-r3', deltaPct: 0.8 });
  });

  it('skips probes that fail to evaluate', async () => {
    const ev = fakeEvaluate({ default: { train: 990, val: 1 } });
    const evaluate: typeof ev.evaluate = async (p, split) => { if (p.meta.id === 'probe-mv-r1-r2') throw new Error('boom'); return ev.evaluate(p, split); };
    const out = await runProbes(evaluate, G0, 1000);
    expect(out).toHaveLength(14);
    expect(out.map((r) => r.id)).not.toContain('mv-r1-r2');
  });
});

describe('new-rule probes', () => {
  const results = [runResult({ findings: [overload(50_000, 30), missed(20_000), gap(5_000)] })];
  const samples: FeatureSamples = {
    bus_at_terminal: Array.from({ length: 100 }, (_, i) => ({ route_queue: i, max_other_route_queue: 2 * i, queue_ratio_other: i / 10, headway_ratio: 1, buses_on_route: 2, headway_ahead_s: 3600, layover_s: 0, event_in_s: 0, target_headway_s: 200 })),
    bus_at_stop: Array.from({ length: 100 }, (_, i) => ({ queue_here: i % 20, downstream_queue: i, load_factor: i / 100, expected_transfers: i % 7, train_eta_s: i < 50 ? 9999 : i * 2 })),
    train_at_station: Array.from({ length: 50 }, (_, i) => ({ platform_queue: i, onboard: 3 * i, transfers_alighted: i % 9, next_bus_eta_s: 10 * i, buses_here_or_due_60s: 0, dwell_s: 0, event_in_s: 0 })),
  };

  it('ranks related features by the impact of the champion\'s findings', () => {
    const pain = painFeatures(results);
    expect(pain.bus_at_terminal.map((x) => x.f)).toEqual(['route_queue', 'max_other_route_queue', 'queue_ratio_other']);
    expect(pain.bus_at_stop[0]!.f).toBe('queue_here');
    expect(pain.train_at_station.map((x) => x.f)).toContain('transfers_alighted');
  });

  it('builds single-condition rules from p50/p80 of the decision records, with neutral say and generated ids', () => {
    const probes = newRuleProbes(G0, results, samples);
    expect(probes.length).toBeGreaterThan(10);
    for (const p of probes) {
      expect(p.rule!.id).toMatch(/^probe-(stop|term|train)-[a-z0-9]+-[a-z0-9]+-[a-z0-9p-]+$/);
      expect(p.rule!.id.length).toBeLessThanOrEqual(32);
      expect(p.rule!.when).toHaveLength(1);
      expect(p.policy.rules).toHaveLength(G0.rules.length + 1);
      expect(p.rule!.say).toMatch(/^Probe rule: /);
    }
    const reas = probes.filter((p) => p.rule!.on === 'bus_at_terminal' && p.rule!.do.type === 'reassign' && p.rule!.when[0]!.f === 'route_queue');
    expect(reas.map((p) => p.rule!.when[0])).toEqual([{ f: 'route_queue', op: '>=', v: 50 }, { f: 'route_queue', op: '>=', v: 79 }]);
    expect(reas[0]!.rule!.priority).toBeGreaterThan(G0.rules[0]!.priority);
    expect(reas[0]!.label).toBe('new rule on bus_at_terminal: reassign to busiest when route_queue >= 50');
    // low-trigger features use <= p50 / p20 and ignore sentinel values (9999 = no train)
    const eta = probes.filter((p) => p.rule!.when[0]!.f === 'train_eta_s').map((p) => p.rule!.when[0]!);
    expect(eta.every((c) => c.op === '<=' && c.v < 9999)).toBe(true);
    // round-robin over kinds: the first three probes cover three different kinds
    expect(new Set(probes.slice(0, 3).map((p) => p.rule!.on)).size).toBe(3);
  });

  it('caps all probes at 50, edits first, and skips new rules without samples', () => {
    const all = championProbes(G0, { results, samples });
    expect(all.length).toBe(MAX_PROBES);
    expect(all[0]!.id).toBe('rm-even-headway');
    expect(all.filter((p) => p.rule).length).toBe(MAX_PROBES - championProbes(G0).length);
    expect(championProbes(G0, { results }).every((p) => !p.rule)).toBe(true);
    expect(championProbes(G0, { results, samples, limit: 5 })).toHaveLength(5);
  });

  it('records the champion\'s decision features with the real engine', { timeout: 30_000 }, () => {
    const s0 = sampleFeatures(G0, evolveInstances('train').slice(0, 1));
    expect(s0.bus_at_terminal!.length).toBeGreaterThan(10);
    expect(Object.keys(s0.bus_at_stop![0]!)).toContain('queue_here');
    expect(s0.train_at_station!.length).toBeGreaterThan(0);
  });
});
