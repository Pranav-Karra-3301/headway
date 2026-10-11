import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { G0, PolicyController, REF, TOWN, runSync } from '@headway/sim';
import type { RunResult } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import { formatRun, main, parseSimRunArgs, resolvePolicyRef } from '../src/cli/sim-run';
import { createFileStore } from '../src/cli/store-file';
import { broken, generation, POLICY, variant } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'hw-simrun-'));

async function capture(argv: string[], dataDir?: string): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await main(argv, { log: (s) => lines.push(s), ...(dataDir ? { dataDir } : {}) });
  return { code, out: lines.join('\n') };
}

describe('parseSimRunArgs', () => {
  it('defaults to g0 on stadium_exit seed 1001', () => {
    expect(parseSimRunArgs([])).toMatchObject({ policy: 'g0', scenario: 'stadium_exit', seed: 1001, json: false, findings: 5 });
  });

  it('parses flags and rejects bad input', () => {
    expect(parseSimRunArgs(['--policy', 'ref', '--scenario=class_change', '--seed', '2001', '--json', '--findings', '3']))
      .toMatchObject({ policy: 'ref', scenario: 'class_change', seed: 2001, json: true, findings: 3 });
    expect(() => parseSimRunArgs(['--seed', 'x'])).toThrow(/seed/);
    expect(() => parseSimRunArgs(['--seed', '-4'])).toThrow(/seed/);
    expect(() => parseSimRunArgs(['--policy'])).toThrow(/needs a value/);
    expect(() => parseSimRunArgs(['--wat'])).toThrow(/unknown option/);
  });
});

describe('resolvePolicyRef', () => {
  it('resolves built-ins', () => {
    expect(resolvePolicyRef('g0').policy).toBe(G0);
    expect(resolvePolicyRef('ref').policy).toBe(REF);
    expect(resolvePolicyRef('example').policy.rules.length).toBeGreaterThan(0);
  });

  it('reads a policy file, bare or wrapped, and validates it', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'p.json'), JSON.stringify(variant(9)));
    writeFileSync(join(dir, 'wrapped.json'), JSON.stringify({ policy: variant(11), generation: null }));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(broken()));
    writeFileSync(join(dir, 'junk.json'), '{ nope');
    expect(resolvePolicyRef(join(dir, 'p.json')).policy.rules).toEqual(variant(9).rules);
    expect(resolvePolicyRef('wrapped.json', { cwd: dir }).policy.rules).toEqual(variant(11).rules);
    expect(() => resolvePolicyRef(join(dir, 'bad.json'))).toThrow(/train_eta/);
    expect(() => resolvePolicyRef(join(dir, 'junk.json'))).toThrow(/cannot read/);
    expect(() => resolvePolicyRef('nope-not-a-policy')).toThrow(/unknown policy/);
  });

  it('resolves champion and gN from the data dir', async () => {
    const dataDir = join(tmp(), 'data');
    expect(() => resolvePolicyRef('champion', { dataDir })).toThrow(/no generations/);
    const store = createFileStore(dataDir);
    await store.saveGeneration(generation('g0', 0, G0));
    await store.saveGeneration(generation('g1', 1, POLICY));
    expect(resolvePolicyRef('champion', { dataDir })).toMatchObject({ label: 'g1' });
    expect(resolvePolicyRef('g0', { dataDir }).policy).toBe(G0);           // built-in wins
    expect(resolvePolicyRef('g1', { dataDir }).policy.rules).toEqual(POLICY.rules);
    expect(() => resolvePolicyRef('g7', { dataDir })).toThrow(/g7/);
  });
});

describe('sim:run main', () => {
  it('prints the metrics of one real run', { timeout: 30_000 }, async () => {
    const direct = runSync({ map: TOWN, scenario: { scenarioId: 'stadium_exit', seed: 1001, split: 'train' }, controller: new PolicyController(G0) });
    const { code, out } = await capture(['--policy', 'g0', '--scenario', 'stadium_exit', '--seed', '1001']);
    expect(code).toBe(0);
    expect(out).toContain('g0 on stadium_exit seed 1001');
    expect(out).toContain(direct.hash);
    expect(out).toContain(`${direct.metrics.completionPct.toFixed(1)}%`);
    expect(out).toMatch(/J\s+[\d.]+ pax-h/);
    expect(out).toMatch(/missed connections/);
    if (direct.findings[0]) expect(out).toContain(direct.findings[0].text);
  });

  it('prints the RunResult as JSON with --json', { timeout: 30_000 }, async () => {
    const { code, out } = await capture(['--policy', 'ref', '--scenario', 'class_change', '--seed', '1002', '--json']);
    expect(code).toBe(0);
    const r = JSON.parse(out) as RunResult;
    expect(r).toMatchObject({ scenarioId: 'class_change', seed: 1002, controller: { kind: 'policy', policyId: 'ref' } });
    expect(r.metrics.spawned).toBeGreaterThan(0);
  });

  it('fails cleanly on an unknown scenario or policy', { timeout: 30_000 }, async () => {
    expect((await capture(['--scenario', 'moon_landing'])).code).toBe(2);
    const bad = await capture(['--policy', 'champion'], join(tmp(), 'empty'));
    expect(bad.code).toBe(2);
    expect(bad.out).toMatch(/no generations/);
  });
});

describe('formatRun', () => {
  it('summarises metrics, findings and rule fires', { timeout: 30_000 }, () => {
    const r = runSync({ map: TOWN, scenario: { scenarioId: 'class_change', seed: 1001, split: 'train' }, controller: new PolicyController(G0) });
    const text = formatRun(r, { label: 'g0', ms: 12, findings: 2 });
    expect(text).toContain('class_change seed 1001');
    expect(text).toContain('completion');
    expect(text).toContain('rule fires');
    expect(text.split('\n').filter((l) => l.startsWith('  - ')).length).toBeLessThanOrEqual(2);
  });
});
