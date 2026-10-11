// Owner: T8. `verify-leaderboard`: re-simulates player replays from the CLI (spec §11 Workers-Free fallback, and an audit of the
// worker's own verification on Workers Paid).
//
//   pnpm --filter @headway/evolve exec tsx src/cli/verify-leaderboard.ts [--local] [--all] [--limit 200] [--dry-run]
//   pnpm --filter @headway/evolve exec tsx src/cli/verify-leaderboard.ts --file replay.json [--file …]
//
// D1 mode reads `leaderboard` rows through `wrangler d1 execute headway --remote|--local --json` (run in apps/worker, using your
// wrangler login), re-runs each replay with the g0 baseline + the player's intents (runSync), and writes back
// `j`, `metrics_json` and `verified = 1` for rows that check out. Rejected rows are reported and left untouched.
// File mode re-simulates local replays (a Replay, `{ name, replay }`, or an array) and compares them with g0 doing nothing.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_CONFIG, G0, PolicyController, TOWN, runSync } from '@headway/sim';
import type { Metrics, Policy, Replay, RunResult } from '@headway/sim';
import { DATA_DIR, REPO_ROOT, formatTable, inferSplit, inputPath, parseArgs, paxH, resolvePolicy, runIfMain, signedPct } from './sweep';

const PLAY_SCENARIO = 'stadium_exit';
const PLAY_SEED_MIN = 50_000;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type Simulate = (replay: Replay, policy: Policy) => RunResult;

/** The real engine: the replay's scenario and seed, `policy` as the base controller, the replay's intents and recorded decisions. */
export const simReplay: Simulate = (replay, policy) =>
  runSync({
    map: TOWN, scenario: { scenarioId: replay.scenarioId, seed: replay.seed, split: inferSplit(replay.seed) },
    controller: new PolicyController(policy), intents: replay.intents, decisions: replay.decisions,
  });

/** null when the replay is a valid leaderboard replay (human on g0, current sim + map, the play scenario, a play seed). */
export function checkReplay(r: unknown, expect: { simVersion: string; mapVersion: string; scenarioId?: string; seed?: number }): string | null {
  if (!isObj(r)) return 'replay is not an object';
  if (r.simVersion !== expect.simVersion) return `replay simVersion ${JSON.stringify(r.simVersion)} ≠ sim ${JSON.stringify(expect.simVersion)}`;
  if (r.mapVersion !== expect.mapVersion) return `replay mapVersion ${JSON.stringify(r.mapVersion)} ≠ map ${JSON.stringify(expect.mapVersion)}`;
  if (r.scenarioId !== PLAY_SCENARIO) return `scenario ${JSON.stringify(r.scenarioId)} is not the play scenario (${PLAY_SCENARIO})`;
  if (expect.scenarioId !== undefined && r.scenarioId !== expect.scenarioId) return `replay scenario ${String(r.scenarioId)} ≠ row scenario ${expect.scenarioId}`;
  if (typeof r.seed !== 'number' || !Number.isInteger(r.seed) || r.seed < PLAY_SEED_MIN) return `seed ${String(r.seed)} is not a play seed`;
  if (expect.seed !== undefined && r.seed !== expect.seed) return `replay seed ${r.seed} ≠ row seed ${expect.seed}`;
  const c = r.controller;
  if (!isObj(c) || c.kind !== 'human' || c.basePolicyId !== 'g0') return 'controller must be { kind: "human", basePolicyId: "g0" }';
  if (r.intents !== undefined) {
    if (!Array.isArray(r.intents)) return 'intents must be an array';
    const bad = r.intents.findIndex((x) => !isObj(x) || typeof x.t !== 'number' || !isObj(x.intent) || typeof x.intent.type !== 'string');
    if (bad >= 0) return `intents[${bad}] must be { t: number, intent: Intent }`;
  }
  if (r.decisions !== undefined && !Array.isArray(r.decisions)) return 'decisions must be an array';
  return null;
}

// ---------- rows ----------

export interface LeaderboardRow {
  id: string; name: string; scenario_id: string; seed: number; sim_version: string; j: number | null; verified: number;
  replay_json: string; created_at?: string;
}
export type VerdictStatus = 'ok' | 'verified' | 'corrected' | 'rejected';
export interface Verdict {
  id: string; name: string; seed: number; status: VerdictStatus; claimedJ: number | null;
  j?: number; metrics?: Metrics; hash?: string; reason?: string;
}

export function verifyRow(row: LeaderboardRow, o: { simulate: Simulate; simVersion: string; mapVersion: string; tolerance?: number }): Verdict {
  const claimedJ = typeof row.j === 'number' && Number.isFinite(row.j) ? row.j : null;
  const base = { id: row.id, name: row.name, seed: row.seed, claimedJ };
  const reject = (reason: string): Verdict => ({ ...base, status: 'rejected', reason });
  if (row.sim_version !== o.simVersion) return reject(`row sim_version ${JSON.stringify(row.sim_version)} ≠ sim ${JSON.stringify(o.simVersion)}`);
  let replay: unknown;
  try {
    replay = JSON.parse(row.replay_json);
  } catch {
    return reject('replay_json is not valid JSON');
  }
  const problem = checkReplay(replay, { simVersion: o.simVersion, mapVersion: o.mapVersion, scenarioId: row.scenario_id, seed: row.seed });
  if (problem) return reject(problem);
  let result: RunResult;
  try {
    result = o.simulate(replay as Replay, G0);
  } catch (err) {
    return reject(`re-simulation failed: ${errMsg(err)}`);
  }
  const j = result.metrics.J;
  const tol = (o.tolerance ?? 1e-6) * Math.max(1, Math.abs(j));
  const matches = claimedJ === null || Math.abs(j - claimedJ) <= tol;
  const status: VerdictStatus = !matches ? 'corrected' : row.verified === 1 && claimedJ !== null ? 'ok' : 'verified';
  return { ...base, status, j, metrics: result.metrics, hash: result.hash };
}

// ---------- SQL ----------

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function selectSql(o: { all: boolean; limit: number }): string {
  const limit = Math.min(10_000, Math.max(1, Math.floor(o.limit)));
  return `SELECT id, name, scenario_id, seed, sim_version, j, verified, replay_json, created_at FROM leaderboard${o.all ? '' : ' WHERE verified = 0'} ORDER BY created_at DESC LIMIT ${limit}`;
}

export function updateSql(v: Verdict): string {
  if (!SAFE_ID.test(v.id)) throw new Error(`refusing to update a row with an unexpected id ${JSON.stringify(v.id)}`);
  if (typeof v.j !== 'number' || !Number.isFinite(v.j)) throw new Error(`row ${v.id}: J is not a finite number`);
  return `UPDATE leaderboard SET j = ${v.j}, metrics_json = ${sqlString(JSON.stringify(v.metrics ?? {}))}, verified = 1 WHERE id = ${sqlString(v.id)}`;
}

// ---------- D1 through wrangler ----------

export const WORKER_DIR = join(REPO_ROOT, 'apps', 'worker');
const WRANGLER_BIN = join(WORKER_DIR, 'node_modules', '.bin', 'wrangler');

function wranglerError(v: unknown): string | null {
  if (!isObj(v) || v.error === undefined) return null;
  const e = v.error;
  return isObj(e) && typeof e.text === 'string' ? e.text : JSON.stringify(e);
}

/** Rows from `wrangler d1 execute --json` output: `[{ results, success, meta }, …]` (one entry per statement). */
export function parseD1Json(stdout: string): Array<Record<string, unknown>> {
  const start = stdout.search(/^\s*[[{]/m);
  if (start < 0) throw new Error(`unexpected wrangler output: ${stdout.slice(0, 200)}`);
  let v: unknown;
  try {
    v = JSON.parse(stdout.slice(start));
  } catch {
    throw new Error(`unexpected wrangler output: ${stdout.slice(start, start + 200)}`);
  }
  const err = wranglerError(v);
  if (err) throw new Error(err);
  if (Array.isArray(v)) return v.flatMap((x) => (isObj(x) && Array.isArray(x.results) ? (x.results as Array<Record<string, unknown>>) : []));
  if (isObj(v) && Array.isArray(v.results)) return v.results as Array<Record<string, unknown>>;
  throw new Error(`unexpected wrangler output: ${stdout.slice(start, start + 200)}`);
}

export interface LeaderboardDb {
  select(o: { all: boolean; limit: number }): LeaderboardRow[];
  update(sqls: string[]): void;
}

function execWrangler(args: string[]): string {
  try {
    return execFileSync(WRANGLER_BIN, args, { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    let text: string | null = null;
    try {
      parseD1Json(e.stdout ?? '');
    } catch (inner) {
      text = errMsg(inner);
    }
    throw new Error(`wrangler d1 execute failed: ${text && !text.startsWith('unexpected wrangler output') ? text : (e.stderr || e.message || 'unknown error').trim().slice(0, 500)}`);
  }
}

export function wranglerDb(o: { remote: boolean; exec?: (args: string[]) => string; database?: string }): LeaderboardDb {
  const exec = o.exec ?? execWrangler;
  const base = ['d1', 'execute', o.database ?? 'headway', o.remote ? '--remote' : '--local', '--json', '--yes'];
  return {
    select: (q) => parseD1Json(exec([...base, '--command', selectSql(q)])) as unknown as LeaderboardRow[],
    update: (sqls) => {
      for (let i = 0; i < sqls.length; i += 25) parseD1Json(exec([...base, '--command', sqls.slice(i, i + 25).join('; ')]));
    },
  };
}

export function verifyLeaderboard(o: {
  db: LeaderboardDb; simulate: Simulate; simVersion: string; mapVersion: string; all: boolean; limit: number; dryRun: boolean;
}): Verdict[] {
  const verdicts = o.db.select({ all: o.all, limit: o.limit }).map((row) => verifyRow(row, o));
  const writes = verdicts.filter((v) => v.status === 'verified' || v.status === 'corrected');
  if (!o.dryRun && writes.length > 0) o.db.update(writes.map(updateSql));
  return verdicts;
}

// ---------- CLI ----------

export interface VerifyDeps {
  db?: (o: { remote: boolean }) => LeaderboardDb; simulate?: Simulate; log?: (s: string) => void;
  versions?: { simVersion: string; mapVersion: string }; dataDir?: string;
}

const USAGE = `usage: tsx src/cli/verify-leaderboard.ts [--local] [--all] [--limit 200] [--dry-run]
       tsx src/cli/verify-leaderboard.ts --file replay.json [--file …]`;

const jOrDash = (j: number | null | undefined) => (typeof j === 'number' ? paxH(j) : '—');

function verifyFiles(files: string[], o: { simulate: Simulate; versions: { simVersion: string; mapVersion: string }; dataDir: string; log: (s: string) => void }): number {
  let failures = 0;
  for (const file of files) {
    let items: unknown[];
    try {
      const v: unknown = JSON.parse(readFileSync(inputPath(file), 'utf8'));
      items = Array.isArray(v) ? v : [v];
    } catch (err) {
      o.log(`${file}: cannot read (${errMsg(err)})`);
      failures++;
      continue;
    }
    items.forEach((item, i) => {
      const replay = (isObj(item) && isObj(item.replay) ? item.replay : item) as Replay;
      const name = isObj(item) && typeof item.name === 'string' ? item.name : `${basename(file)}${items.length > 1 ? `#${i + 1}` : ''}`;
      if (!isObj(replay) || typeof replay.scenarioId !== 'string' || typeof replay.seed !== 'number') {
        o.log(`${name}: not a replay`);
        failures++;
        return;
      }
      const problem = checkReplay(replay, o.versions);
      if (problem) o.log(`${name}: warning: ${problem}`);
      try {
        const c = replay.controller as Replay['controller'] | undefined;
        const policy = !c || c.kind === 'human' ? G0 : resolvePolicy(c.policyId, { dataDir: o.dataDir }).policy;
        const r = o.simulate(replay, policy);
        const b = o.simulate({ ...replay, controller: { kind: 'policy', policyId: 'g0' }, intents: [], decisions: [] }, G0);
        const d = b.metrics.J > 0 ? ((r.metrics.J - b.metrics.J) / b.metrics.J) * 100 : null;
        const n = replay.intents?.length ?? 0;
        o.log(`${name}: ${replay.scenarioId} seed ${replay.seed} · ${n} intents · J ${paxH(r.metrics.J)} pax-h (${signedPct(d)} vs g0 ${paxH(b.metrics.J)})`
          + ` · completion ${r.metrics.completionPct.toFixed(1)}% · hash ${r.hash}${r.hash === b.hash ? ' (identical to g0)' : ''}`);
      } catch (err) {
        o.log(`${name}: re-simulation failed: ${errMsg(err)}`);
        failures++;
      }
    });
  }
  return failures > 0 ? 1 : 0;
}

export async function main(argv: string[], deps: VerifyDeps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  const args = parseArgs(argv, ['help', 'local', 'remote', 'all', 'dry-run']);
  if (args.flag('help')) {
    log(USAGE);
    return 0;
  }
  const simulate = deps.simulate ?? simReplay;
  const versions = deps.versions ?? { simVersion: DEFAULT_CONFIG.simVersion, mapVersion: TOWN.version };
  const files = args.all('file');
  if (files.length > 0) return verifyFiles(files, { simulate, versions, dataDir: deps.dataDir ?? DATA_DIR, log });

  const remote = !args.flag('local');
  const dryRun = args.flag('dry-run');
  const all = args.flag('all');
  const limit = Number(args.get('limit') ?? 200);
  if (!Number.isFinite(limit) || limit < 1) {
    log(`error: --limit must be a positive number\n${USAGE}`);
    return 2;
  }
  const db = deps.db ? deps.db({ remote }) : wranglerDb({ remote });
  log(`Re-simulating ${all ? 'all' : 'unverified'} leaderboard rows from the ${remote ? 'remote' : 'local'} D1 (sim ${versions.simVersion}, map ${versions.mapVersion})…`);
  let verdicts: Verdict[];
  try {
    verdicts = verifyLeaderboard({ db, simulate, ...versions, all, limit, dryRun });
  } catch (err) {
    log(`error: ${errMsg(err)}`);
    return 1;
  }
  if (verdicts.length === 0) {
    log('nothing to verify');
    return 0;
  }
  log(formatTable(
    ['id', 'name', 'seed', 'claimed J', 're-sim J', 'ΔJ', 'status', 'reason'],
    verdicts.map((v) => [v.id.slice(0, 12), v.name, String(v.seed), jOrDash(v.claimedJ), jOrDash(v.j),
      v.j !== undefined && v.claimedJ ? signedPct(((v.j - v.claimedJ) / v.claimedJ) * 100) : '—', v.status, v.reason ?? '']),
  ));
  const count = (s: VerdictStatus) => verdicts.filter((v) => v.status === s).length;
  const writes = count('verified') + count('corrected');
  log(`${verdicts.length} rows: ${count('verified')} verified, ${count('corrected')} corrected, ${count('ok')} already ok, ${count('rejected')} rejected`
    + ` — ${dryRun ? `dry run: ${writes} rows would be written` : `wrote ${writes} rows`}`);
  return 0;
}

runIfMain(import.meta.url, main);
