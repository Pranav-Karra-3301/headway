import { env } from 'cloudflare:test';
import { createSim, G0, PolicyController, TOWN } from '@headway/sim';
import type { Intent, Metrics, Observation, Replay, RunResult } from '@headway/sim';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { admin, call, generation, resetDb } from './helpers';

type Entry = { rank: number; id: string; name: string; j: number; verified: boolean; championJ: number | null; createdAt: string };
type Board = { seed: number; scenarioId: string; simVersion: string; entries: Entry[] };
type Submitted = { ok: true; id: string; name: string; seed: number; j: number; rank: number; verified: boolean; championJ: number; baselineJ: number; metrics: Metrics };
type Err = { error: string; details?: string[] };

const DAY0 = Date.UTC(2026, 9, 11, 20, 0, 0); // play day 0 → seed 50000
const DAY10 = Date.UTC(2026, 9, 21, 12, 0, 0); // play day 10 → seeds 50004..50010 are the last 7 days
const iso = (ms: number) => new Date(ms).toISOString();

/** Plays the play scenario like the browser does: g0 + live `sim.intent` calls; returns the replay and the local result. */
function play(seed: number, script: Array<[t: number, intent: (obs: Observation) => Intent]> = []): { replay: Replay; result: RunResult } {
  const sim = createSim({ map: TOWN, scenario: { scenarioId: 'stadium_exit', seed, split: 'play' }, controller: new PolicyController(G0) });
  let i = 0;
  while (!sim.done) {
    while (i < script.length && sim.t >= script[i][0]) sim.intent(script[i++][1](sim.observe()));
    sim.step();
  }
  return { replay: sim.replay(), result: sim.result() };
}

const SCRIPT: Array<[number, (obs: Observation) => Intent]> = [
  [480, (o) => ({ type: 'reassign', vehicleId: o.buses[0].id, to: 'r3' })],
  [620, (o) => ({ type: 'hold', vehicleId: o.buses[2].id, seconds: 30 })],
  [700, () => ({ type: 'setTrainDeparture', dwellS: 70 })],
  [900, (o) => ({ type: 'dispatch', vehicleId: o.buses[4].id })],
];

// Computed once: the sims are deterministic.
const human = play(50000, SCRIPT);
const idle = play(50000);

const submit = (app: ReturnType<typeof createApp>, json: unknown, ip = '203.0.113.7') => call(app, '/api/leaderboard', { json, ip });
const board = async (app: ReturnType<typeof createApp>, q = '') => (await call(app, `/api/leaderboard${q}`)).json<Board>();

function insert(id: string, name: string, j: number, o: { seed?: number; sim?: string; created?: string } = {}) {
  return env.DB.prepare(
    `INSERT INTO leaderboard (id, name, scenario_id, seed, sim_version, j, metrics_json, replay_json, verified, champion_j, ip_hash, created_at)
     VALUES (?1, ?2, 'stadium_exit', ?3, ?4, ?5, '{}', '{}', 1, 2000000, NULL, ?6)`,
  ).bind(id, name, o.seed ?? 50000, o.sim ?? '2', j, o.created ?? iso(DAY0)).run();
}

beforeEach(resetDb);

describe('POST /api/leaderboard', () => {
  it('re-simulates the replay on the server and stores the verified J', async () => {
    expect(human.replay.intents?.length).toBe(4);
    expect(human.replay.controller).toEqual({ kind: 'human', basePolicyId: 'g0' });
    const app = createApp({ now: () => DAY0 });
    const res = await submit(app, { name: '  transit   tom ', replay: human.replay });
    expect(res.status).toBe(200);
    const body = await res.json<Submitted>();
    expect(body).toMatchObject({ ok: true, name: 'transit tom', seed: 50000, rank: 1, verified: true });
    expect(body.j).toBe(human.result.metrics.J);
    expect(body.metrics).toEqual(human.result.metrics);
    expect(body.baselineJ).toBe(idle.result.metrics.J);
    expect(body.championJ).toBe(idle.result.metrics.J); // empty D1: the champion is g0

    const row = await env.DB.prepare('SELECT * FROM leaderboard WHERE id = ?1').bind(body.id)
      .first<{ name: string; seed: number; sim_version: string; j: number; verified: number; champion_j: number; ip_hash: string; replay_json: string; scenario_id: string }>();
    expect(row).toMatchObject({ name: 'transit tom', seed: 50000, sim_version: '2', j: body.j, verified: 1, champion_j: body.championJ, scenario_id: 'stadium_exit' });
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(row?.ip_hash).not.toContain('203.0.113.7');
    expect(JSON.parse(row!.replay_json)).toEqual({ ...human.replay, controller: { kind: 'human', basePolicyId: 'g0' } });

    const b = await board(app, '?seed=50000');
    expect(b.entries).toEqual([{ rank: 1, id: body.id, name: 'transit tom', j: body.j, verified: true, championJ: body.championJ, createdAt: iso(DAY0) }]);
  });

  it('accepts a do-nothing run (it scores exactly the baseline) and ranks against the board', async () => {
    const app = createApp({ now: () => DAY0 });
    await insert('a', 'better', idle.result.metrics.J - 1000);
    await insert('b', 'worse', idle.result.metrics.J + 1000);
    const res = await submit(app, { name: 'idle_ida', replay: idle.replay });
    expect(res.status).toBe(200);
    const body = await res.json<Submitted>();
    expect(body.j).toBe(idle.result.metrics.J);
    expect(body.rank).toBe(2);
  });

  it('scores the champion from D1 on the same seed', async () => {
    const g1 = generation(1, 'r1-b');
    await call(createApp(), '/api/admin/publish', { json: { generations: [generation(0, null), g1] }, headers: admin });
    const body = await (await submit(createApp({ now: () => DAY0 }), { name: 'vs champ', replay: idle.replay })).json<Submitted>();
    expect(body.baselineJ).toBe(idle.result.metrics.J);
    expect(typeof body.championJ).toBe('number');
    expect(body.championJ).not.toBe(body.baselineJ);
  });

  it('accepts only play seeds from the last 7 days', async () => {
    const day10 = createApp({ now: () => DAY10 });
    const oldest = play(50004);
    expect((await submit(day10, { name: 'week ago', replay: oldest.replay })).status).toBe(200);
    for (const seed of [50003, 50011, 50000, 49999, 4001]) {
      const res = await submit(day10, { name: 'old seed', replay: { ...oldest.replay, seed } }, `198.51.100.${seed % 200}`);
      expect(res.status, String(seed)).toBe(400);
      expect((await res.json<Err>()).details?.join(' ')).toMatch(/play seed/);
    }
    const future = await submit(createApp({ now: () => DAY0 }), { name: 'tomorrow', replay: { ...idle.replay, seed: 50001 } });
    expect(future.status).toBe(400);
  });

  it('400s bad names and replays it cannot verify, naming the problem', async () => {
    const app = createApp({ now: () => DAY0 });
    const ok = { name: 'transit tom', replay: human.replay };
    const r = human.replay;
    const cases: Array<[unknown, RegExp]> = [
      [{ ...ok, name: 'x'.repeat(17) }, /name/],
      [{ ...ok, name: '' }, /name/],
      [{ ...ok, name: 'bus🚌fan' }, /name/],
      [{ ...ok, name: 42 }, /name/],
      [{ name: 'no replay' }, /replay/],
      [{ ...ok, replay: { ...r, simVersion: '0' } }, /simVersion/],
      [{ ...ok, replay: { ...r, mapVersion: 'old' } }, /mapVersion/],
      [{ ...ok, replay: { ...r, scenarioId: 'class_change' } }, /scenario/],
      [{ ...ok, replay: { ...r, controller: { kind: 'policy', policyId: 'g3' } } }, /controller/],
      [{ ...ok, replay: { ...r, controller: { kind: 'jev', policyId: 'g0', model: 'typesafe/jev-1.13' } } }, /controller/],
      [{ ...ok, replay: { ...r, decisions: [{ dpId: 4, action: { type: 'continue' } }] } }, /decisions/],
      [{ ...ok, replay: { ...r, intents: 'all of them' } }, /intents/],
      [{ ...ok, replay: { ...r, intents: [{ t: 10, intent: { type: 'teleport', vehicleId: 'b1' } }] } }, /intents\[0\]/],
      [{ ...ok, replay: { ...r, intents: [{ t: -5, intent: { type: 'dispatch', vehicleId: 'b1' } }] } }, /intents\[0\]\.t/],
      [{ ...ok, replay: { ...r, intents: [{ t: 10, intent: { type: 'hold', vehicleId: 'b1', seconds: 'long' } }] } }, /seconds/],
      [{ ...ok, replay: { ...r, intents: [{ t: 10, intent: { type: 'reassign', vehicleId: 'b1', to: 'r9' } }] } }, /to/],
      [{ ...ok, replay: { ...r, intents: Array.from({ length: 1001 }, (_, i) => ({ t: i, intent: { type: 'dispatch', vehicleId: 'b1' } })) } }, /intents/],
    ];
    for (const [json, why] of cases) {
      const res = await submit(app, json, `198.51.100.${cases.findIndex((c) => c[0] === json)}`);
      expect(res.status, JSON.stringify(json).slice(0, 120)).toBe(400);
      const err = await res.json<Err>();
      expect([err.error, ...(err.details ?? [])].join(' '), JSON.stringify(json).slice(0, 120)).toMatch(why);
    }
    expect((await call(app, '/api/leaderboard', { body: '{oops', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await board(app)).entries).toEqual([]);
  });

  it('rate-limits submissions to 5 per minute per IP', async () => {
    let now = DAY0;
    const app = createApp({ now: () => now });
    for (let i = 0; i < 5; i++) expect((await submit(app, { name: '', replay: idle.replay }, '192.0.2.1')).status).toBe(400);
    const limited = await submit(app, { name: 'sixth', replay: idle.replay }, '192.0.2.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await submit(app, { name: 'other ip', replay: idle.replay }, '192.0.2.2')).status).toBe(200);
    now += 61_000;
    expect((await submit(app, { name: 'later', replay: idle.replay }, '192.0.2.1')).status).toBe(200);
  });
});

describe('GET /api/leaderboard', () => {
  it("defaults to today's play seed and is empty at first", async () => {
    expect(await board(createApp({ now: () => DAY0 }))).toEqual({ seed: 50000, scenarioId: 'stadium_exit', simVersion: '2', entries: [] });
    expect((await board(createApp({ now: () => DAY10 }))).seed).toBe(50010);
  });

  it('lists the top 20 for the seed, best entry per name, lowest J first', async () => {
    for (let i = 0; i < 25; i++) await insert(`p${i}`, `player ${i}`, 1_000_000 + i * 1000, { created: iso(DAY0 + i) });
    await insert('mira-1', 'Mira', 900_000);
    await insert('mira-2', 'mira', 950_000);
    await insert('other-seed', 'elsewhere', 1, { seed: 50001 });
    await insert('old-sim', 'old version', 2, { sim: '0' });
    const b = await board(createApp({ now: () => DAY0 }), '?seed=50000');
    expect(b.entries).toHaveLength(20);
    expect(b.entries[0]).toMatchObject({ rank: 1, id: 'mira-1', name: 'Mira', j: 900_000, verified: true, championJ: 2_000_000 });
    expect(b.entries.slice(1).map((e) => e.name)).toEqual(Array.from({ length: 19 }, (_, i) => `player ${i}`));
    expect(b.entries.map((e) => e.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('400s a seed that is not a positive integer', async () => {
    for (const q of ['?seed=abc', '?seed=-3', '?seed=1.5']) expect((await call(createApp(), `/api/leaderboard${q}`)).status, q).toBe(400);
  });
});
