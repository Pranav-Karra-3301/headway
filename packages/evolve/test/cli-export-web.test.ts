// T8: export-web CLI (data/ → apps/web/public/data/{champion,generations}.json, same shapes as GET /api/champion and /api/generations).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_G3, G0, REF } from '@headway/sim';
import type { Generation, Metrics, Policy, Proposal, Round, RunResult, SplitScore } from '@headway/sim';
import { buildWebData, exportWeb, main, readRounds, type Evaluate } from '../src/cli/export-web';

function metrics(J: number): Metrics {
  return {
    J, spawned: 1000, completed: 950, unfinished: 50, completionPct: 95, meanJourneyS: 800, meanWaitS: 200, p95WaitS: 600, maxWaitS: 900,
    transfersMade: 100, missedConnections: 5, leftBehind: 10, walkaways: 2,
    effort: { busDistanceU: 4000, deadheadDistanceU: 0, holdS: 300, trainDwellS: 800 },
  };
}
const score = (J: number, runs = 8): SplitScore => ({ J, metrics: metrics(J), runs });
function gen(id: string, number: number, policy: Policy, J = 1000 - number * 10): Generation {
  return {
    id, number, parentId: number === 0 ? null : `g${number - 1}`, policy: { ...structuredClone(policy), meta: { ...policy.meta, id, generation: number } },
    fromProposal: number === 0 ? null : `r${number}-a`, explanation: `generation ${id}`, train: score(J), val: score(J / 2, 4), findings: [],
    createdAt: `2026-10-11T1${number}:00:00.000Z`,
  };
}
function proposal(round: number, d: 0 | 1 | 2): Proposal {
  return {
    id: `r${round}-${'abc'[d]}`, roundId: `R${round}`, designer: d, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: 'transfers',
    summary: 's', rationale: 'r', policy: REF, valid: true, errors: [], train: score(990), val: null, deltaTrainPct: -1, findings: [], narrative: 'n',
  };
}
function round(n: number, promoted: boolean): Round {
  return {
    id: `R${n}`, number: n, championBefore: `g${n - 1}`, championAfter: promoted ? `g${n}` : `g${n - 1}`, status: 'done',
    proposals: [proposal(n, 0), proposal(n, 1), proposal(n, 2)], startedAt: '2026-10-11T12:00:00Z', finishedAt: '2026-10-11T12:01:00Z',
  };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'hw-export-'));
function dataDir(files: Record<string, unknown>): string {
  const d = tmp();
  for (const [rel, v] of Object.entries(files)) {
    const p = join(d, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return d;
}
const readJson = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));
/** Fake evaluate: J by policy id and split; records calls. */
function fakeEvaluate(table: Record<string, number>): Evaluate & { calls: string[] } {
  const calls: string[] = [];
  const ev = ((policy: Policy, split: 'train' | 'val') => {
    calls.push(`${policy.meta.id}:${split}`);
    const J = (table[policy.meta.id] ?? 1) * (split === 'val' ? 0.5 : 1);
    const results: RunResult[] = [];
    return { score: score(J, split === 'train' ? 8 : 4), results };
  }) as Evaluate & { calls: string[] };
  ev.calls = calls;
  return ev;
}

describe('readRounds', () => {
  it('reads data/rounds/*.json, keeps round-shaped values, sorts by number', () => {
    const d = dataDir({ 'rounds/R2.json': round(2, false), 'rounds/R1.json': round(1, true), 'rounds/junk.json': { id: 'x' }, 'rounds/bad.json': '{' });
    const warnings: string[] = [];
    expect(readRounds(d, (w) => warnings.push(w)).map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(warnings.some((w) => w.includes('bad.json'))).toBe(true);
    expect(readRounds(join(d, 'missing'))).toEqual([]);
  });
  it('unwraps { round } and { rounds: [] } files', () => {
    const d = dataDir({ 'rounds/a.json': { round: round(1, true), generation: null }, 'rounds/index.json': { rounds: [round(3, false), round(2, true)] } });
    expect(readRounds(d).map((r) => r.id)).toEqual(['R1', 'R2', 'R3']);
  });
});

describe('buildWebData', () => {
  it('champion = the latest generation; same shapes as the worker API', () => {
    const gens = [gen('g1', 1, REF), gen('g0', 0, G0), gen('g2', 2, EXAMPLE_G3)];
    const { champion, generations } = buildWebData({ generations: gens, rounds: [round(2, true), round(1, true)], baseline: null, reference: score(950) });
    expect(champion.policy.meta.id).toBe('g2');
    expect(champion.generation?.id).toBe('g2');
    expect(champion.train).toEqual(gens[2]!.train);
    expect(champion.val).toEqual(gens[2]!.val);
    expect(generations.generations.map((g) => g.id)).toEqual(['g0', 'g1', 'g2']);
    expect(generations.rounds.map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(generations.baseline).toEqual(gens[1]!.train); // g0's train when no baseline is given
    expect(generations.reference).toEqual(score(950));
    expect(Object.keys(champion).sort()).toEqual(['generation', 'policy', 'train', 'val']);
    expect(Object.keys(generations).sort()).toEqual(['baseline', 'generations', 'reference', 'rounds']);
  });
  it('falls back to G0 with nulls when nothing exists', () => {
    const { champion, generations } = buildWebData({ generations: [], rounds: [], baseline: null, reference: null });
    expect(champion).toEqual({ policy: G0, generation: null, train: null, val: null });
    expect(generations).toEqual({ generations: [], rounds: [], baseline: null, reference: null });
  });
});

describe('exportWeb', () => {
  it('exports data/ as-is without the sim (baseline from g0, reference from data/reference.json)', () => {
    const d = dataDir({
      'generations/g0.json': gen('g0', 0, G0), 'generations/g1.json': gen('g1', 1, REF), 'generations/g2.json': gen('g2', 2, EXAMPLE_G3),
      'rounds/R1.json': round(1, true), 'rounds/R2.json': round(2, true), 'reference.json': score(900),
    });
    const out = tmp();
    const r = exportWeb({ dataDir: d, outDir: out, evaluate: null });
    const champion = readJson(join(out, 'champion.json'));
    const generations = readJson(join(out, 'generations.json'));
    expect(champion.policy.meta.id).toBe('g2');
    expect(champion.generation.number).toBe(2);
    expect(generations.generations).toHaveLength(3);
    expect(generations.rounds).toHaveLength(2);
    expect(generations.rounds[0].proposals).toHaveLength(3);
    expect(generations.baseline.J).toBe(1000);
    expect(generations.reference.J).toBe(900);
    expect(r.files.map((f) => f.path)).toEqual([join(out, 'champion.json'), join(out, 'generations.json')]);
    expect(r.files.every((f) => f.bytes > 10)).toBe(true);
  });

  it('accepts baseline/reference files holding { score } or { train } wrappers', () => {
    const d = dataDir({ 'generations/g0.json': gen('g0', 0, G0), 'baseline.json': { score: score(1234) }, 'reference.json': { train: score(1111) } });
    const r = exportWeb({ dataDir: d, outDir: tmp(), evaluate: null });
    expect(r.generations.baseline?.J).toBe(1234);
    expect(r.generations.reference?.J).toBe(1111);
  });

  it('with an empty data/ and no sim: G0 champion, empty history, nulls', () => {
    const out = tmp();
    const r = exportWeb({ dataDir: tmp(), outDir: out, evaluate: null });
    expect(readJson(join(out, 'champion.json'))).toEqual({ policy: G0, generation: null, train: null, val: null });
    expect(readJson(join(out, 'generations.json'))).toEqual({ generations: [], rounds: [], baseline: null, reference: null });
    expect(r.notes.join('\n')).toMatch(/no generations/);
  });

  it('with an empty data/ and the sim: bootstraps g0 (train + val) and the ref line', () => {
    const ev = fakeEvaluate({ g0: 2000, ref: 1800 });
    const r = exportWeb({ dataDir: tmp(), outDir: tmp(), evaluate: ev, now: () => '2026-10-11T15:00:00.000Z' });
    expect(ev.calls.sort()).toEqual(['g0:train', 'g0:val', 'ref:train']);
    const g0 = r.champion.generation!;
    expect(g0).toMatchObject({ id: 'g0', number: 0, parentId: null, fromProposal: null, createdAt: '2026-10-11T15:00:00.000Z' });
    expect(g0.policy).toEqual(G0);
    expect(g0.train.J).toBe(2000);
    expect(g0.val.J).toBe(1000);
    expect(r.champion.policy).toEqual(G0);
    expect(r.generations.generations).toHaveLength(1);
    expect(r.generations.baseline?.J).toBe(2000);
    expect(r.generations.reference?.J).toBe(1800);
  });

  it('only computes what is missing (ref) when data/ has generations', () => {
    const ev = fakeEvaluate({ ref: 1700 });
    const d = dataDir({ 'generations/g0.json': gen('g0', 0, G0), 'generations/g1.json': gen('g1', 1, REF) });
    const r = exportWeb({ dataDir: d, outDir: tmp(), evaluate: ev });
    expect(ev.calls).toEqual(['ref:train']);
    expect(r.generations.reference?.J).toBe(1700);
    expect(r.generations.baseline?.J).toBe(1000);
  });

  it('keeps going when the sim throws, leaving nulls and a note', () => {
    const ev: Evaluate = () => {
      throw new Error('not implemented yet: runSync stadium_exit');
    };
    const r = exportWeb({ dataDir: tmp(), outDir: tmp(), evaluate: ev });
    expect(r.champion.generation).toBeNull();
    expect(r.generations.reference).toBeNull();
    expect(r.notes.join('\n')).toMatch(/not implemented yet/);
  });

  it('warns about generations whose policy does not validate', () => {
    const bad = gen('g1', 1, G0);
    (bad.policy.rules[0]!.when[0] as { f: string }).f = 'nope';
    const d = dataDir({ 'generations/g0.json': gen('g0', 0, G0), 'generations/g1.json': bad });
    const r = exportWeb({ dataDir: d, outDir: tmp(), evaluate: null });
    expect(r.notes.join('\n')).toMatch(/g1.*does not validate/);
  });
});

describe('main', () => {
  it('writes both files and prints a summary', async () => {
    const d = dataDir({ 'generations/g0.json': gen('g0', 0, G0), 'generations/g1.json': gen('g1', 1, REF, 900), 'rounds/R1.json': round(1, true) });
    const out = tmp();
    const logs: string[] = [];
    expect(await main(['--data', d, '--out', out, '--no-sim'], { log: (s) => logs.push(s) })).toBe(0);
    const text = logs.join('\n');
    expect(text).toMatch(/champion g1/);
    expect(text).toMatch(/−10\.0% vs g0/);
    expect(text).toContain(join(out, 'champion.json'));
    expect(readJson(join(out, 'generations.json')).generations).toHaveLength(2);
  });
});
