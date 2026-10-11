// T8: verify-leaderboard CLI (re-simulate leaderboard replays from D1 via wrangler, or local replay files).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { G0 } from '@headway/sim';
import type { Metrics, Policy, Replay, RunResult } from '@headway/sim';
import {
  checkReplay, main, parseD1Json, selectSql, updateSql, verifyLeaderboard, verifyRow, wranglerDb,
  type LeaderboardDb, type LeaderboardRow, type Simulate,
} from '../src/cli/verify-leaderboard';

const V = { simVersion: '1', mapVersion: 'town-1' };
function metrics(J: number): Metrics {
  return {
    J, spawned: 900, completed: 870, unfinished: 30, completionPct: 96.7, meanJourneyS: 800, meanWaitS: 200, p95WaitS: 600, maxWaitS: 900,
    transfersMade: 100, missedConnections: 5, leftBehind: 10, walkaways: 2,
    effort: { busDistanceU: 4000, deadheadDistanceU: 0, holdS: 300, trainDwellS: 800 },
  };
}
function replay(p: Partial<Replay> = {}): Replay {
  return {
    simVersion: '1', mapVersion: 'town-1', scenarioId: 'stadium_exit', seed: 50003, controller: { kind: 'human', basePolicyId: 'g0' },
    intents: [{ t: 610, intent: { type: 'hold', vehicleId: 'b4', seconds: 30 } }], ...p,
  };
}
function row(p: Partial<LeaderboardRow> = {}, r: unknown = replay()): LeaderboardRow {
  return { id: 'lb-1', name: 'Ada', scenario_id: 'stadium_exit', seed: 50003, sim_version: '1', j: 1000, verified: 0, replay_json: JSON.stringify(r), created_at: '2026-10-11T15:00:00Z', ...p };
}
/** Fake sim: J = 1000 − 10 × intents (so "doing nothing" is the baseline 1000). */
function fakeSim(): Simulate & { calls: Array<{ replay: Replay; policy: Policy }> } {
  const calls: Array<{ replay: Replay; policy: Policy }> = [];
  const sim = ((replay: Replay, policy: Policy): RunResult => {
    calls.push({ replay, policy });
    const J = 1000 - 10 * (replay.intents?.length ?? 0);
    return {
      simVersion: replay.simVersion, mapVersion: replay.mapVersion, scenarioId: replay.scenarioId, seed: replay.seed, controller: replay.controller,
      metrics: metrics(J), stops: [], findings: [], ruleFires: {}, hash: `h${J}`,
    };
  }) as Simulate & { calls: Array<{ replay: Replay; policy: Policy }> };
  sim.calls = calls;
  return sim;
}
function fakeDb(rows: LeaderboardRow[]): LeaderboardDb & { selects: Array<{ all: boolean; limit: number }>; updates: string[][] } {
  const selects: Array<{ all: boolean; limit: number }> = [];
  const updates: string[][] = [];
  return {
    selects, updates,
    select: (o) => {
      selects.push(o);
      return rows;
    },
    update: (sqls) => {
      updates.push(sqls);
    },
  };
}

describe('checkReplay', () => {
  it('accepts a human g0 replay on a play seed', () => {
    expect(checkReplay(replay(), V)).toBeNull();
    expect(checkReplay(replay(), { ...V, scenarioId: 'stadium_exit', seed: 50003 })).toBeNull();
  });
  it.each([
    ['not an object', 'x', /object/],
    ['sim version', replay({ simVersion: '0' }), /simVersion/],
    ['map version', replay({ mapVersion: 'old' }), /mapVersion/],
    ['scenario', replay({ scenarioId: 'class_change' }), /scenario/],
    ['play seed', replay({ seed: 1001 }), /play seed/],
    ['controller', replay({ controller: { kind: 'policy', policyId: 'g7' } }), /controller/],
    ['intents', { ...replay(), intents: 'lots' }, /intents/],
  ])('rejects a bad %s', (_name, r, msg) => {
    expect(checkReplay(r, V)).toMatch(msg);
  });
  it('rejects a replay that does not match its row', () => {
    expect(checkReplay(replay(), { ...V, seed: 50004 })).toMatch(/seed/);
  });
});

describe('verifyRow', () => {
  it('verifies an unverified row whose J matches', () => {
    const sim = fakeSim();
    const v = verifyRow(row({ j: 990 }), { simulate: sim, ...V });
    expect(v).toMatchObject({ id: 'lb-1', status: 'verified', j: 990, claimedJ: 990 });
    expect(sim.calls[0]!.policy).toEqual(G0);
    expect(sim.calls[0]!.replay.intents).toHaveLength(1);
  });
  it('corrects a J that differs, and accepts rows stored without a J', () => {
    expect(verifyRow(row({ j: 5 }), { simulate: fakeSim(), ...V })).toMatchObject({ status: 'corrected', j: 990, claimedJ: 5 });
    expect(verifyRow(row({ j: null }), { simulate: fakeSim(), ...V })).toMatchObject({ status: 'verified', j: 990, claimedJ: null });
  });
  it('reports already-verified matching rows as ok', () => {
    expect(verifyRow(row({ j: 990, verified: 1 }), { simulate: fakeSim(), ...V }).status).toBe('ok');
  });
  it('rejects bad JSON, mismatches and sim failures without throwing', () => {
    expect(verifyRow(row({}, 'x'), { simulate: fakeSim(), ...V })).toMatchObject({ status: 'rejected' });
    expect(verifyRow({ ...row(), replay_json: '{oops' }, { simulate: fakeSim(), ...V })).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/JSON/) });
    expect(verifyRow(row({ seed: 50009 }), { simulate: fakeSim(), ...V })).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/seed/) });
    expect(verifyRow(row({ sim_version: '0' }), { simulate: fakeSim(), ...V })).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/sim_version/) });
    const boom: Simulate = () => {
      throw new Error('bad intent');
    };
    expect(verifyRow(row(), { simulate: boom, ...V })).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/bad intent/) });
  });
});

describe('SQL', () => {
  it('selects unverified rows (or all) newest first with a limit', () => {
    expect(selectSql({ all: false, limit: 50 })).toBe(
      'SELECT id, name, scenario_id, seed, sim_version, j, verified, replay_json, created_at FROM leaderboard WHERE verified = 0 ORDER BY created_at DESC LIMIT 50');
    expect(selectSql({ all: true, limit: 7 })).not.toMatch(/WHERE/);
  });
  it('writes j, metrics and verified = 1 with quotes escaped', () => {
    const sql = updateSql({ id: "lb-1", name: 'x', seed: 50003, status: 'corrected', claimedJ: 5, j: 990.5, metrics: { ...metrics(990.5), note: "it's" } as unknown as Metrics });
    expect(sql).toBe(`UPDATE leaderboard SET j = 990.5, metrics_json = '${JSON.stringify({ ...metrics(990.5), note: "it''s" })}', verified = 1 WHERE id = 'lb-1'`);
  });
  it('refuses odd ids and non-finite J', () => {
    expect(() => updateSql({ id: "x'; DROP TABLE leaderboard; --", name: '', seed: 1, status: 'verified', claimedJ: 1, j: 1, metrics: metrics(1) })).toThrow(/id/);
    expect(() => updateSql({ id: 'ok', name: '', seed: 1, status: 'verified', claimedJ: 1, j: Number.NaN, metrics: metrics(1) })).toThrow(/J/);
  });
});

describe('wrangler D1 access', () => {
  const OUT = JSON.stringify([{ results: [row()], success: true, meta: { duration: 1 } }]);
  it('parses wrangler --json output (array of statement results), tolerating noise before the JSON', () => {
    expect(parseD1Json(OUT)).toEqual([row()]);
    expect(parseD1Json(`⛅️ wrangler 4\n${OUT}`)).toEqual([row()]);
    expect(() => parseD1Json('{"error":{"text":"no such table: leaderboard: SQLITE_ERROR"}}')).toThrow(/no such table/);
  });
  it('runs d1 execute against the remote (or local) DB and batches updates', () => {
    const calls: string[][] = [];
    const db = wranglerDb({ remote: true, exec: (args) => (calls.push(args), OUT) });
    expect(db.select({ all: false, limit: 10 })).toEqual([row()]);
    db.update(['UPDATE a', 'UPDATE b']);
    expect(calls[0]!.slice(0, 6)).toEqual(['d1', 'execute', 'headway', '--remote', '--json', '--yes']);
    expect(calls[0]!.slice(6)).toEqual(['--command', selectSql({ all: false, limit: 10 })]);
    expect(calls[1]!.slice(6)).toEqual(['--command', 'UPDATE a; UPDATE b']);
    const local: string[][] = [];
    wranglerDb({ remote: false, exec: (args) => (local.push(args), OUT) }).select({ all: true, limit: 1 });
    expect(local[0]).toContain('--local');
  });
});

describe('verifyLeaderboard', () => {
  const rows = [row({ id: 'a', j: 990 }), row({ id: 'b', j: 1 }), row({ id: 'c' }, replay({ seed: 1001 })), row({ id: 'd', j: 990, verified: 1 })];
  it('writes verified and corrected rows only', () => {
    const db = fakeDb(rows);
    const vs = verifyLeaderboard({ db, simulate: fakeSim(), ...V, all: true, limit: 100, dryRun: false });
    expect(vs.map((v) => [v.id, v.status])).toEqual([['a', 'verified'], ['b', 'corrected'], ['c', 'rejected'], ['d', 'ok']]);
    expect(db.selects).toEqual([{ all: true, limit: 100 }]);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]!.map((s) => /WHERE id = '(\w+)'/.exec(s)![1])).toEqual(['a', 'b']);
  });
  it('--dry-run writes nothing', () => {
    const db = fakeDb(rows);
    verifyLeaderboard({ db, simulate: fakeSim(), ...V, all: false, limit: 100, dryRun: true });
    expect(db.updates).toEqual([]);
  });
});

describe('main', () => {
  it('verifies D1 rows through the injected db and prints a table', async () => {
    const db = fakeDb([row({ id: 'a', j: 990 }), row({ id: 'c' }, replay({ seed: 1001 }))]);
    const logs: string[] = [];
    expect(await main(['--dry-run'], { db: () => db, simulate: fakeSim(), log: (s) => logs.push(s), versions: V })).toBe(0);
    const text = logs.join('\n');
    expect(text).toMatch(/a\s+Ada\s+50003/);
    expect(text).toMatch(/rejected/);
    expect(text).toMatch(/dry run/i);
    expect(db.updates).toEqual([]);
  });

  it('--file re-simulates a local replay and compares with g0 doing nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hw-verify-'));
    const f = join(dir, 'replay.json');
    writeFileSync(f, JSON.stringify({ name: 'Ada', replay: replay({ intents: [
      { t: 610, intent: { type: 'hold', vehicleId: 'b4', seconds: 30 } }, { t: 900, intent: { type: 'dispatch', vehicleId: 'b1' } }] }) }));
    const sim = fakeSim();
    const logs: string[] = [];
    expect(await main(['--file', f], { simulate: sim, log: (s) => logs.push(s), versions: V })).toBe(0);
    expect(sim.calls).toHaveLength(2);
    expect(sim.calls[1]!.replay.intents).toEqual([]);
    const text = logs.join('\n');
    expect(text).toMatch(/2 intents/);
    expect(text).toMatch(/−2\.0% vs g0/);
  });

  it('returns 1 when the D1 query fails', async () => {
    const logs: string[] = [];
    const db: LeaderboardDb = { select: () => { throw new Error('no such table: leaderboard'); }, update: () => {} };
    expect(await main([], { db: () => db, simulate: fakeSim(), log: (s) => logs.push(s), versions: V })).toBe(1);
    expect(logs.join('\n')).toMatch(/no such table/);
  });
});
