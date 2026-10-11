// Player leaderboard (spec §11): GET /api/leaderboard?seed= (top 20), POST /api/leaderboard { name, replay } with server
// re-simulation (g0 + the player's intents on the play seed); GET /api/sealed (sealed-test results for the Lab).
import { DEFAULT_CONFIG, G0, scenarioDef, TOWN } from '@headway/sim';
import type { Policy, RunResult } from '@headway/sim';
import { Hono } from 'hono';
import { insertLeaderboard, latestGeneration, leaderboardRank, listSealed, topLeaderboard } from '../db';
import type { AppContext, AppDeps } from '../env';
import { clientIp, FixedWindowLimiter, jsonError, readJson, sha256Hex } from '../http';
import { isRecentPlaySeed, PLAY_SCENARIO, PLAY_WINDOW_DAYS, todayPlaySeed } from '../play';
import { policyKey, runPolicy } from '../score';
import { parseSubmission } from '../validate';

const SUBMITS_PER_MIN = 5;
const BOARD_SIZE = 20;
const MEMO_MAX = 200;
/** The sim the worker bundles: replays are verified against it and the board only compares runs from it. */
const SIM_VERSION = DEFAULT_CONFIG.simVersion;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function leaderboardRoutes(deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();
  const limiter = new FixedWindowLimiter(SUBMITS_PER_MIN, 60_000, deps.now);
  const def = scenarioDef(PLAY_SCENARIO);
  const tMax = def.durationS + def.clearingS;

  // J of a policy with no human input on a play seed (baseline / champion lines): deterministic, so memoized per isolate.
  const memo = new Map<string, number>();
  const plainJ = (policy: Policy, seed: number): number => {
    const key = `${seed}|${policyKey(policy)}`;
    let j = memo.get(key);
    if (j === undefined) {
      j = runPolicy(policy, { scenarioId: PLAY_SCENARIO, seed, split: 'play' }).metrics.J;
      if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
      memo.set(key, j);
    }
    return j;
  };

  /** `{ seed, scenarioId, simVersion, entries: [{ rank, id, name, j, verified, championJ, createdAt }] }`; seed defaults to today's. */
  r.get('/api/leaderboard', async (c) => {
    const q = c.req.query('seed');
    const seed = q === undefined || q === '' ? todayPlaySeed(deps.now()) : /^\d{1,9}$/.test(q) ? Number(q) : NaN;
    if (!Number.isSafeInteger(seed) || seed <= 0) return jsonError(c, 400, 'seed must be a positive integer');
    const entries = await topLeaderboard(c.env.DB, seed, SIM_VERSION, BOARD_SIZE);
    return c.json({ seed, scenarioId: PLAY_SCENARIO, simVersion: SIM_VERSION, entries });
  });

  /**
   * `{ name, replay }` → re-simulates g0 + the replay's intents on its play seed and stores the verified J.
   * → `{ ok, id, name, seed, j, rank, verified, championJ, baselineJ, metrics }`; 400 with details; 429 over 5/min/IP.
   */
  r.post('/api/leaderboard', async (c) => {
    const ip = clientIp(c.req.raw);
    const lim = limiter.hit(ip);
    if (!lim.ok) {
      c.header('Retry-After', String(lim.retryAfterS));
      return jsonError(c, 429, `rate limited: ${SUBMITS_PER_MIN} submissions per minute`);
    }
    const body = await readJson(c.req.raw, 256 * 1024);
    if (!body.ok) return jsonError(c, body.status, body.error);
    const nowMs = deps.now();
    const parsed = parseSubmission(body.value, {
      simVersion: SIM_VERSION, mapVersion: TOWN.version, scenarioId: PLAY_SCENARIO, tMax,
      seedOk: (s) => (isRecentPlaySeed(s, nowMs) ? null : `${s} is not a play seed from the last ${PLAY_WINDOW_DAYS} days (today's is ${todayPlaySeed(nowMs)})`),
    });
    if (!parsed.ok) return jsonError(c, 400, 'invalid submission', parsed.errors);
    const { name, replay } = parsed.value;
    const db = c.env.DB;

    let you: RunResult;
    let baselineJ: number;
    try {
      you = runPolicy(G0, { scenarioId: replay.scenarioId, seed: replay.seed, split: 'play' }, replay.intents);
      baselineJ = plainJ(G0, replay.seed);
    } catch (err) {
      console.error('leaderboard re-simulation failed:', errText(err));
      return jsonError(c, 422, 'could not re-simulate this run', [errText(err)]);
    }
    // The AI line is context only: a champion that cannot run must not cost the player their entry.
    let championJ: number | null = null;
    try {
      championJ = plainJ((await latestGeneration(db))?.policy ?? G0, replay.seed);
    } catch (err) {
      console.warn('champion run on the play seed failed:', errText(err));
    }

    const id = crypto.randomUUID();
    const createdAt = new Date(nowMs).toISOString();
    const ipHash = (await sha256Hex(`${c.env.ADMIN_TOKEN || 'headway'}|${ip}`)).slice(0, 16);
    await insertLeaderboard(db, {
      id, name, scenario_id: replay.scenarioId, seed: replay.seed, sim_version: you.simVersion, j: you.metrics.J,
      metrics_json: JSON.stringify(you.metrics), replay_json: JSON.stringify(replay), verified: 1, champion_j: championJ,
      ip_hash: ipHash, created_at: createdAt,
    }).run();
    const rank = await leaderboardRank(db, replay.seed, SIM_VERSION, name, you.metrics.J);
    return c.json({ ok: true, id, name, seed: replay.seed, j: you.metrics.J, rank, verified: true, championJ, baselineJ, metrics: you.metrics });
  });

  /** `{ results: SealedEntry[] }`, newest first (each evaluation stores champion, g0 and ref; seeds are never stored). */
  r.get('/api/sealed', async (c) => c.json({ results: await listSealed(c.env.DB) }));

  return r;
}
