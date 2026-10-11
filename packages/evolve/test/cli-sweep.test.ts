// T8: sweep CLI (policies × scenarios × seeds → metrics table) and the shared CLI helpers it exports.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { G0, REF, EXAMPLE_G3 } from '@headway/sim';
import type { FailureFinding, Generation, Metrics, Policy, RunResult, ScenarioInstance, SimConfig, SplitScore } from '@headway/sim';
import {
  aggregateRows, buildInstances, configOverrides, formatTable, main, parseArgs, parseSeeds, readGenerations,
  resolvePolicy, runSweep, sanityGates, simRun, type SimRun, type SweepRow,
} from '../src/cli/sweep';

// ---------- helpers (self-contained; no shared fixtures) ----------
function metrics(p: Partial<Metrics> = {}): Metrics {
  return {
    J: 100_000, spawned: 1000, completed: 950, unfinished: 50, completionPct: 95,
    meanJourneyS: 800, meanWaitS: 200, p95WaitS: 600, maxWaitS: 900,
    transfersMade: 100, missedConnections: 5, leftBehind: 10, walkaways: 2,
    effort: { busDistanceU: 4000, deadheadDistanceU: 0, holdS: 300, trainDwellS: 800 },
    ...p,
  };
}
function result(inst: ScenarioInstance, policyId: string, m: Partial<Metrics> = {}, gapS = 500, findings: FailureFinding[] = []): RunResult {
  return {
    simVersion: '1', mapVersion: 'm1', scenarioId: inst.scenarioId, seed: inst.seed,
    controller: { kind: 'policy', policyId }, metrics: metrics(m),
    stops: [{ id: 'stop_apts_south', maxQueue: 20, meanWaitS: 200, maxGapS: { r2: gapS } }],
    findings, ruleFires: { default: 3 }, hash: `${policyId}-${inst.scenarioId}-${inst.seed}`,
  };
}
function score(J: number): SplitScore {
  return { J, metrics: metrics({ J }), runs: 8 };
}
function gen(id: string, number: number, policy: Policy): Generation {
  return {
    id, number, parentId: number === 0 ? null : `g${number - 1}`, policy: { ...structuredClone(policy), meta: { ...policy.meta, id, generation: number } },
    fromProposal: number === 0 ? null : `r${number}-a`, explanation: `gen ${id}`, train: score(1000 - number), val: score(500 - number), findings: [],
    createdAt: '2026-10-11T12:00:00.000Z',
  };
}
function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'hw-sweep-'));
}
/** A fake runner: J per run by policy label (via meta.id), completion/missed per scenario. */
function fakeRun(table: Record<string, number>, extra: (inst: ScenarioInstance, id: string) => Partial<Metrics> = () => ({})): SimRun & { calls: string[] } {
  const calls: string[] = [];
  const run = ((policy: Policy, inst: ScenarioInstance) => {
    const id = policy.meta.id;
    calls.push(`${id}:${inst.scenarioId}:${inst.seed}`);
    return result(inst, id, { J: table[id] ?? 1, ...extra(inst, id) });
  }) as SimRun & { calls: string[] };
  run.calls = calls;
  return run;
}
const inst = (scenarioId: string, seed: number): ScenarioInstance => ({ scenarioId, seed, split: 'train' });

// ---------- argument parsing ----------
describe('parseArgs', () => {
  it('reads --k v, --k=v, boolean flags, repeated --set and positionals', () => {
    const a = parseArgs(['--policies', 'g0,ref', '--set', 'bus.capacity=60', '--set=walk.meanSpeed=1.2', '--quiet', '--json=out.json', 'extra']);
    expect(a.get('policies')).toBe('g0,ref');
    expect(a.all('set')).toEqual(['bus.capacity=60', 'walk.meanSpeed=1.2']);
    expect(a.flag('quiet')).toBe(true);
    expect(a.flag('verbose')).toBe(false);
    expect(a.get('json')).toBe('out.json');
    expect(a.positionals).toEqual(['extra']);
  });
  it('treats --no-x as a false flag and a flag followed by another --opt as boolean', () => {
    const a = parseArgs(['--no-gates', '--dry-run', '--url', 'http://x']);
    expect(a.flag('gates', true)).toBe(false);
    expect(a.flag('dry-run')).toBe(true);
    expect(a.get('url')).toBe('http://x');
  });
});

describe('parseSeeds', () => {
  it('expands ranges and lists', () => {
    expect(parseSeeds('1001-1004,2001')).toEqual([1001, 1002, 1003, 1004, 2001]);
    expect(parseSeeds(' 7 ')).toEqual([7]);
  });
  it('rejects junk and huge ranges', () => {
    expect(() => parseSeeds('abc')).toThrow(/seed/);
    expect(() => parseSeeds('5-1')).toThrow(/seed/);
    expect(() => parseSeeds('1-100000')).toThrow(/range/);
  });
});

// ---------- instances ----------
describe('buildInstances', () => {
  it('defaults to the train split: stadium_exit + class_change × 1001–1004', () => {
    const xs = buildInstances({});
    expect(xs).toHaveLength(8);
    expect(new Set(xs.map((x) => x.scenarioId))).toEqual(new Set(['stadium_exit', 'class_change']));
    expect(new Set(xs.map((x) => x.seed))).toEqual(new Set([1001, 1002, 1003, 1004]));
    expect(xs.every((x) => x.split === 'train')).toBe(true);
  });
  it('val and showcase splits follow spec §7', () => {
    expect(buildInstances({ split: 'val' }).map((x) => x.seed).sort()).toEqual([2001, 2001, 2002, 2002]);
    expect(buildInstances({ split: 'showcase' })).toHaveLength(6);
  });
  it('filters a split by scenario', () => {
    const xs = buildInstances({ split: 'train', scenarios: ['stadium_exit'] });
    expect(xs.map((x) => x.seed)).toEqual([1001, 1002, 1003, 1004]);
    expect(xs.every((x) => x.scenarioId === 'stadium_exit')).toBe(true);
  });
  it('explicit seeds cross the scenarios and infer the split label', () => {
    const xs = buildInstances({ scenarios: ['stadium_exit'], seeds: [2001, 50003, 17] });
    expect(xs).toEqual([
      { scenarioId: 'stadium_exit', seed: 2001, split: 'val' },
      { scenarioId: 'stadium_exit', seed: 50003, split: 'play' },
      { scenarioId: 'stadium_exit', seed: 17, split: 'train' },
    ]);
  });
  it('play split uses the day index', () => {
    expect(buildInstances({ split: 'play', dayIndex: 3 })).toEqual([{ scenarioId: 'stadium_exit', seed: 50003, split: 'play' }]);
  });
  it('rejects an unknown split', () => {
    expect(() => buildInstances({ split: 'test' })).toThrow(/split/);
  });
});

// ---------- config overrides ----------
describe('configOverrides', () => {
  const base = {
    simVersion: '1',
    bus: { count: 6, capacity: 50, speed: 8, boardS: 2, alightS: 1, minDwellS: 5 },
    objective: { unfinishedPenaltyS: 2700, missedWindowS: 60, bunchingFraction: 0.3 },
  } as unknown as SimConfig;

  it('sets nested values on copies of whole top-level groups (withConfig is shallow)', () => {
    const o = configOverrides(['bus.capacity=60', 'objective.unfinishedPenaltyS=1800'], base);
    expect(o).toEqual({
      bus: { count: 6, capacity: 60, speed: 8, boardS: 2, alightS: 1, minDwellS: 5 },
      objective: { unfinishedPenaltyS: 1800, missedWindowS: 60, bunchingFraction: 0.3 },
    });
    expect(base.bus.capacity).toBe(50);
  });
  it('parses JSON values and keeps strings', () => {
    expect(configOverrides(['simVersion=dev'], base)).toEqual({ simVersion: 'dev' });
    expect(configOverrides(['bus.speed=8.5'], base).bus?.speed).toBe(8.5);
  });
  it('rejects unknown keys and malformed entries', () => {
    expect(() => configOverrides(['bus.capx=1'], base)).toThrow(/unknown config key "bus.capx"/);
    expect(() => configOverrides(['nope'], base)).toThrow(/key=value/);
  });
});

// ---------- policies ----------
describe('resolvePolicy', () => {
  it('resolves built-ins', () => {
    expect(resolvePolicy('g0', { dataDir: tmp() })).toEqual({ label: 'g0', policy: G0 });
    expect(resolvePolicy('ref', { dataDir: tmp() }).policy).toEqual(REF);
    expect(resolvePolicy('example', { dataDir: tmp() }).policy).toEqual(EXAMPLE_G3);
  });
  it('resolves champion and gN from data/generations, and files holding a Policy or a wrapper', () => {
    const data = tmp();
    mkdirSync(join(data, 'generations'));
    writeFileSync(join(data, 'generations', 'g1.json'), JSON.stringify(gen('g1', 1, REF)));
    writeFileSync(join(data, 'generations', 'g2.json'), JSON.stringify(gen('g2', 2, EXAMPLE_G3)));
    expect(resolvePolicy('champion', { dataDir: data })).toMatchObject({ label: 'g2', policy: { meta: { id: 'g2' } } });
    expect(resolvePolicy('g1', { dataDir: data })).toMatchObject({ label: 'g1', policy: { meta: { id: 'g1' } } });
    const f = join(data, 'mine.json');
    writeFileSync(f, JSON.stringify({ summary: 's', policy: { ...REF, meta: { ...REF.meta, id: 'r9-a' } } }));
    expect(resolvePolicy(f, { dataDir: data })).toMatchObject({ label: 'r9-a', policy: { meta: { id: 'r9-a' } } });
  });
  it('explains what is wrong with a missing generation or an invalid policy', () => {
    const data = tmp();
    expect(() => resolvePolicy('champion', { dataDir: data })).toThrow(/no generations/);
    expect(() => resolvePolicy('g7', { dataDir: data })).toThrow(/g7/);
    const bad = structuredClone(G0) as Policy;
    bad.rules[0]!.when[0]!.f = 'not_a_feature';
    const f = join(data, 'bad.json');
    writeFileSync(f, JSON.stringify(bad));
    expect(() => resolvePolicy(f, { dataDir: data })).toThrow(/rules\[0\]\.when\[0\]\.f/);
    expect(() => resolvePolicy(join(data, 'missing.json'), { dataDir: data })).toThrow(/not found|unknown policy/);
  });
});

describe('readGenerations', () => {
  it('reads every *.json (object or array), skips junk, sorts by number', () => {
    const data = tmp();
    mkdirSync(join(data, 'generations'));
    writeFileSync(join(data, 'generations', 'b.json'), JSON.stringify([gen('g2', 2, G0), gen('g0', 0, G0)]));
    writeFileSync(join(data, 'generations', 'a.json'), JSON.stringify(gen('g1', 1, G0)));
    writeFileSync(join(data, 'generations', 'broken.json'), '{nope');
    writeFileSync(join(data, 'generations', 'notes.txt'), 'hello');
    writeFileSync(join(data, 'generations', 'other.json'), JSON.stringify({ hello: 1 }));
    const warnings: string[] = [];
    expect(readGenerations(data, (w) => warnings.push(w)).map((g) => g.id)).toEqual(['g0', 'g1', 'g2']);
    expect(warnings.join('\n')).toMatch(/broken\.json/);
    expect(readGenerations(join(data, 'nothing-here'))).toEqual([]);
  });
  it('unwraps { generation } and { generations: [] } files', () => {
    const data = tmp();
    mkdirSync(join(data, 'generations'));
    writeFileSync(join(data, 'generations', 'one.json'), JSON.stringify({ generation: gen('g1', 1, G0), round: { id: 'R1' } }));
    writeFileSync(join(data, 'generations', 'index.json'), JSON.stringify({ generations: [gen('g0', 0, G0), gen('g2', 2, G0)] }));
    expect(readGenerations(data).map((g) => g.id)).toEqual(['g0', 'g1', 'g2']);
  });
});

// ---------- running and aggregating ----------
describe('runSweep + aggregateRows', () => {
  const instances = [inst('stadium_exit', 1001), inst('class_change', 1001)];
  const policies = [{ label: 'g0', policy: G0 }, { label: 'ref', policy: REF }];

  it('runs policy-major over every instance with timings', () => {
    const run = fakeRun({ g0: 100, ref: 90 });
    const rows = runSweep({ policies, instances, run });
    expect(run.calls).toEqual(['g0:stadium_exit:1001', 'g0:class_change:1001', 'ref:stadium_exit:1001', 'ref:class_change:1001']);
    expect(rows.map((r) => r.label)).toEqual(['g0', 'g0', 'ref', 'ref']);
    expect(rows.every((r) => r.ms >= 0)).toBe(true);
  });

  it('passes config overrides through and reports progress', () => {
    const seen: Array<Partial<SimConfig> | undefined> = [];
    const run: SimRun = (p, i, c) => { seen.push(c); return result(i, p.meta.id); };
    const progress: string[] = [];
    runSweep({ policies: policies.slice(0, 1), instances, run, config: { simVersion: 'x' }, onRow: (r) => progress.push(r.label) });
    expect(seen).toEqual([{ simVersion: 'x' }, { simVersion: 'x' }]);
    expect(progress).toEqual(['g0', 'g0']);
  });

  it('aggregates per policy with ΔJ vs the baseline (g0 when present)', () => {
    const rows = runSweep({ policies, instances, run: fakeRun({ g0: 100, ref: 90 }) });
    const agg = aggregateRows(rows);
    expect(agg.map((a) => [a.label, a.runs, a.score.J])).toEqual([['g0', 2, 200], ['ref', 2, 180]]);
    expect(agg[0]!.deltaPct).toBe(0);
    expect(agg[1]!.deltaPct).toBeCloseTo(-10, 6);
    expect(agg[0]!.worstGapS).toBe(500);
  });

  it('uses the first policy as the baseline when g0 is absent', () => {
    const rows = runSweep({ policies: [{ label: 'a', policy: { ...G0, meta: { ...G0.meta, id: 'a' } } }, { label: 'b', policy: { ...G0, meta: { ...G0.meta, id: 'b' } } }], instances, run: fakeRun({ a: 50, b: 55 }) });
    expect(aggregateRows(rows).map((a) => a.deltaPct)).toEqual([0, 10]);
  });
});

// ---------- §12 sanity gates ----------
describe('sanityGates', () => {
  const train = [inst('stadium_exit', 1001), inst('stadium_exit', 1002), inst('class_change', 1001)];
  function rowsWith(o: { g0J: number; refJ: number; completion: number; missed: number; gap: number; ms: number }): SweepRow[] {
    const rows: SweepRow[] = [];
    for (const [label, J] of [['g0', o.g0J], ['ref', o.refJ]] as const) {
      for (const i of train) {
        rows.push({ label, policyId: label, scenarioId: i.scenarioId, seed: i.seed, ms: o.ms,
          result: result(i, label, { J, completionPct: o.completion, completed: o.completion * 10, missedConnections: o.missed }, o.gap) });
      }
    }
    return rows;
  }
  const byName = (gs: ReturnType<typeof sanityGates>) => Object.fromEntries(gs.map((g) => [g.name, g.pass]));

  it('passes a healthy sweep', () => {
    const gs = sanityGates(rowsWith({ g0J: 100, refJ: 90, completion: 90, missed: 4, gap: 700, ms: 80 }));
    expect(gs).toHaveLength(5);
    expect(gs.every((g) => g.pass === true)).toBe(true);
    expect(gs.every((g) => g.detail.length > 0)).toBe(true);
  });
  it('fails each gate independently', () => {
    const g = byName(sanityGates(rowsWith({ g0J: 100, refJ: 97, completion: 80, missed: 3, gap: 500, ms: 400 })));
    expect(Object.values(g)).toEqual([false, false, false, false, false]);
  });
  it('reports n/a (null) when ref or g0 is not in the sweep', () => {
    const rows = rowsWith({ g0J: 100, refJ: 90, completion: 90, missed: 4, gap: 700, ms: 80 }).filter((r) => r.label === 'g0');
    const gs = sanityGates(rows);
    expect(gs[0]!.pass).toBeNull();
    expect(sanityGates([]).every((x) => x.pass === null)).toBe(true);
  });
});

describe('formatTable', () => {
  it('pads columns: first left-aligned, the rest right-aligned', () => {
    const t = formatTable(['policy', 'J'], [['g0', '1.0'], ['champion', '12.5']]);
    expect(t.split('\n')).toEqual([
      'policy       J',
      '--------  ----',
      'g0         1.0',
      'champion  12.5',
    ]);
  });
});

// ---------- CLI ----------
describe('main', () => {
  it('prints per-run rows, the policy summary and the gates, and writes --json', async () => {
    const out: string[] = [];
    const json = join(tmp(), 'sweep.json');
    const run = fakeRun({ g0: 7200, ref: 6000 }, (i) => (i.scenarioId === 'stadium_exit' ? { completionPct: 90, completed: 900 } : { completionPct: 97, completed: 970 }));
    const code = await main(['--policies', 'g0,ref', '--split', 'train', '--json', json], { run, log: (s) => out.push(s), dataDir: tmp() });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/g0\s+stadium_exit\s+1001/);
    expect(text).toMatch(/ref\b.*−16\.7%/);
    expect(text).toMatch(/ref beats g0 by ≥ 5% J/);
    const saved = JSON.parse(readFileSync(json, 'utf8'));
    expect(saved.rows).toHaveLength(16);
    expect(saved.rows[0]).toMatchObject({ label: 'g0', scenarioId: expect.any(String), seed: expect.any(Number), metrics: { J: 7200 } });
    expect(saved.summary.map((s: { label: string }) => s.label)).toEqual(['g0', 'ref']);
  });

  it('returns 2 with a usage message on bad input', async () => {
    const out: string[] = [];
    expect(await main(['--policies', 'nope-not-a-file'], { run: fakeRun({}), log: (s) => out.push(s), dataDir: tmp() })).toBe(2);
    expect(out.join('\n')).toMatch(/nope-not-a-file/);
  });
});

// ---------- the real engine, once T1a lands ----------
function simReady(): boolean {
  try {
    simRun(G0, inst('stadium_exit', 1001));
    return true;
  } catch (err) {
    if (/not implemented/.test(String(err))) return false;
    return true; // a real failure: let the test below surface it
  }
}

describe.skipIf(!simReady())('real sim', () => {
  it('sweeps g0 on one stadium_exit seed deterministically', () => {
    const rows = runSweep({ policies: [{ label: 'g0', policy: G0 }], instances: [inst('stadium_exit', 1001), inst('stadium_exit', 1001)], run: simRun });
    expect(rows[0]!.result.hash).toBe(rows[1]!.result.hash);
    expect(rows[0]!.result.metrics.spawned).toBeGreaterThan(0);
  });
});
