import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Generation, Proposal, Round } from '@headway/sim';
import { describe, expect, it, vi } from 'vitest';
import { createFileStore } from '../src/cli/store-file';
import { generation, POLICY, score } from './fixtures';

const tmp = () => mkdtempSync(join(tmpdir(), 'hw-store-'));
const names = (dir: string) => readdirSync(dir).sort();

function proposal(roundNo: number, letter: 'a' | 'b' | 'c'): Proposal {
  return {
    id: `r${roundNo}-${letter}`, roundId: `R${roundNo}`, designer: (['a', 'b', 'c'].indexOf(letter)) as 0 | 1 | 2, model: 'm',
    emphasis: 'transfers', summary: `s${roundNo}${letter}`, rationale: '', policy: null, valid: false, errors: ['x'],
    train: null, val: null, deltaTrainPct: null, findings: [], narrative: 'Invalid: x',
  };
}

function round(n: number, o: Partial<Round> = {}): Round {
  return {
    id: `R${n}`, number: n, championBefore: 'g0', championAfter: 'g0', status: 'done',
    proposals: (['a', 'b', 'c'] as const).map((l) => proposal(n, l)), startedAt: `2026-10-11T10:0${n}:00Z`, finishedAt: `2026-10-11T10:0${n}:30Z`,
    ...o,
  };
}

describe('createFileStore', () => {
  it('starts empty: round 1, no history, and asks for a bootstrap champion', async () => {
    const store = createFileStore(join(tmp(), 'data'));
    expect(await store.nextRoundNumber()).toBe(1);
    expect(await store.history(6)).toEqual([]);
    expect(store.generations()).toEqual([]);
    expect(store.rounds()).toEqual([]);
    await expect(store.champion()).rejects.toThrow(/no generations/);
  });

  it('bootstraps g0 once and persists it', async () => {
    const dir = tmp();
    const g0 = generation('g0', 0, POLICY);
    const bootstrap = vi.fn(async () => g0);
    const store = createFileStore(dir, { bootstrap });
    expect(await store.champion()).toEqual(g0);
    expect(await store.champion()).toEqual(g0);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(names(join(dir, 'generations'))).toEqual(['g0.json']);
    expect(await createFileStore(dir).champion()).toEqual(g0);
  });

  it('upserts rounds by id (running, then final) and numbers the next round', async () => {
    const dir = tmp();
    const store = createFileStore(dir);
    await store.saveRound(round(1, { status: 'running', proposals: [], finishedAt: null }));
    expect(await store.nextRoundNumber()).toBe(2);
    await store.saveRound(round(1));
    expect(names(join(dir, 'rounds'))).toEqual(['R1.json']);
    expect(store.rounds()).toEqual([round(1)]);
    expect(JSON.parse(readFileSync(join(dir, 'rounds', 'R1.json'), 'utf8'))).toEqual(round(1));
  });

  it('picks the highest-numbered generation as champion (numeric, not lexical)', async () => {
    const dir = tmp();
    const store = createFileStore(dir);
    for (const n of [0, 2, 10, 9]) await store.saveGeneration(generation(`g${n}`, n, POLICY, score(1000 - n)));
    expect((await store.champion()).id).toBe('g10');
    expect(store.generations().map((g) => g.id)).toEqual(['g0', 'g2', 'g9', 'g10']);
  });

  it('returns the most recent proposals in chronological order', async () => {
    const store = createFileStore(tmp());
    for (const n of [2, 10, 1]) await store.saveRound(round(n));
    await store.saveRound(round(11, { status: 'running', proposals: [], finishedAt: null }));
    expect((await store.history(4)).map((p) => p.id)).toEqual(['r2-c', 'r10-a', 'r10-b', 'r10-c']);
    expect((await store.history(100)).map((p) => p.id)).toHaveLength(9);
    expect(await store.history(0)).toEqual([]);
    expect(await store.nextRoundNumber()).toBe(12);
  });

  it('marks rounds left running by a crashed run as failed', async () => {
    const store = createFileStore(tmp());
    await store.saveRound(round(1));
    await store.saveRound(round(2, { status: 'running', proposals: [], finishedAt: null }));
    const stale = store.failStaleRounds('2026-10-11T11:00:00Z');
    expect(stale.map((r) => r.id)).toEqual(['R2']);
    expect(store.rounds().map((r) => [r.id, r.status, r.finishedAt])).toEqual([
      ['R1', 'done', '2026-10-11T10:01:30Z'], ['R2', 'failed', '2026-10-11T11:00:00Z'],
    ]);
    expect(store.failStaleRounds('2026-10-11T12:00:00Z')).toEqual([]);
  });

  it('ignores non-JSON files and leaves no temp files behind', async () => {
    const dir = tmp();
    const store = createFileStore(dir);
    await store.saveGeneration(generation('g0', 0, POLICY));
    writeFileSync(join(dir, 'generations', '.DS_Store'), 'junk');
    writeFileSync(join(dir, 'generations', 'notes.txt'), 'junk');
    expect(store.generations().map((g) => g.id)).toEqual(['g0']);
    expect(names(join(dir, 'generations')).filter((n) => n.includes('tmp'))).toEqual([]);
  });

  it('fails loudly on a corrupt record instead of overwriting history', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'rounds'), { recursive: true });
    writeFileSync(join(dir, 'rounds', 'R3.json'), '{ not json');
    const store = createFileStore(dir);
    await expect(store.nextRoundNumber()).rejects.toThrow(/R3\.json/);
  });

  it('rejects ids that are not safe file names', async () => {
    const store = createFileStore(tmp());
    const bad: Generation = { ...generation('g1', 1, POLICY), id: '../g1' };
    await expect(store.saveGeneration(bad)).rejects.toThrow(/unsafe id/);
  });
});
