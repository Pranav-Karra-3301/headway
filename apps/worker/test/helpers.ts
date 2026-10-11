import { applyD1Migrations, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import type { FailureFinding, Generation, Metrics, Policy, Proposal, Round, SplitScore } from '@headway/sim';
import m0001 from '../migrations/0001_init.sql?raw';
import m0002 from '../migrations/0002_meta.sql?raw';
import type { createApp } from '../src/app';
import type { AppEnv } from '../src/env';

const MIGRATIONS = (
  [
    ['0001_init.sql', m0001],
    ['0002_meta.sql', m0002],
  ] as const
).map(([name, sql]) => ({
  name,
  queries: sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((q) => q.trim())
    .filter((q) => q.length > 0),
}));

export async function resetDb(): Promise<void> {
  await applyD1Migrations(env.DB, MIGRATIONS);
  await env.DB.batch(
    ['proposals', 'rounds', 'generations', 'meta', 'leaderboard', 'sealed_results'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

export const ADMIN = 'test-admin-token';
export const OR_KEY = 'test-openrouter-key';

/** The real test env (D1, vars) with fake secrets, so assertions never touch real keys. */
export function testEnv(over: Partial<AppEnv> = {}): AppEnv {
  return { ...env, ADMIN_TOKEN: ADMIN, OPENROUTER_API_KEY: OR_KEY, ...over };
}

type App = ReturnType<typeof createApp>;
export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  ip?: string;
  env?: AppEnv;
}

export async function call(app: App, path: string, init: CallInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body: string | undefined = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  if (init.ip) headers.set('CF-Connecting-IP', init.ip);
  const method = init.method ?? (body !== undefined ? 'POST' : 'GET');
  const req = new Request(`https://headway.test${path}`, { method, headers, body });
  const ctx = createExecutionContext();
  const res = await app.fetch(req, init.env ?? testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export const admin = { Authorization: `Bearer ${ADMIN}` };

// ---------- fixtures (contract-shaped) ----------
export function metrics(J: number): Metrics {
  return {
    J, spawned: 1500, completed: 1410, unfinished: 90, completionPct: 94, meanJourneyS: 640, meanWaitS: 190, p95WaitS: 610,
    maxWaitS: 1020, transfersMade: 130, missedConnections: 17, leftBehind: 41, walkaways: 6,
    effort: { busDistanceU: 5200, deadheadDistanceU: 40, holdS: 310, trainDwellS: 880 },
  };
}

export function split(J: number, runs = 8): SplitScore {
  return { J, metrics: metrics(Math.round(J / runs)), runs };
}

export function policy(id: string, parent: string | null, generation: number): Policy {
  return {
    meta: { id, parent, generation, author: generation === 0 ? 'human' : 'designer', emphasis: generation === 0 ? 'baseline' : 'transfers', summary: `policy ${id}` },
    params: { allocation: { r1: 2, r2: 2, r3: 2 }, maxHoldS: 90, trainDefaultDwellS: 45 },
    rules: generation === 0 ? [] : [
      { id: 'hold-for-train', on: 'bus_at_stop', priority: 10, when: [{ f: 'train_eta_s', op: '<=', v: 60 }], do: { type: 'hold', seconds: 30 }, say: 'Holding {seconds}s for the train' },
    ],
    defaults: { bus_at_stop: { type: 'continue' }, bus_at_terminal: { type: 'dispatch' }, train_at_station: { type: 'setTrainDeparture', dwellS: 45 } },
  };
}

export const GAP: FailureFinding = {
  kind: 'service_gap', impactS: 12600, text: 'Apartments South went 14 min without a Route 2 bus (21:52–22:06).',
  stopId: 'stop_apts_south', routeId: 'r2', gapS: 840, fromT: 1320, toT: 2160, affected: 31,
};

export function generation(n: number, fromProposal: string | null, J = 1_000_000 - n * 50_000): Generation {
  return {
    id: `g${n}`, number: n, parentId: n === 0 ? null : `g${n - 1}`, policy: policy(`g${n}`, n === 0 ? null : `g${n - 1}`, n),
    fromProposal, explanation: n === 0 ? 'Baseline: fixed schedule.' : `Promoted ${fromProposal}: ΔJ −5.0% on training.`,
    train: split(J), val: split(J / 2, 4), findings: [GAP], createdAt: `2026-10-11T15:0${n}:00.000Z`,
  };
}

export function proposal(round: number, designer: 0 | 1 | 2, valid: boolean): Proposal {
  const id = `r${round}-${'abc'[designer]}`;
  return {
    id, roundId: `R${round}`, designer, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: (['transfers', 'spacing', 'allocation'] as const)[designer],
    summary: valid ? `Hold at Central (${id})` : 'Broken proposal', rationale: 'Missed transfers dominate J.',
    policy: valid ? policy(id, 'g0', round) : null, valid, errors: valid ? [] : ['rules[2].when[0].f: unknown feature "train_eta" for bus_at_stop'],
    train: valid ? split(950_000 - designer) : null, val: valid && designer === 1 ? split(470_000, 4) : null,
    deltaTrainPct: valid ? -5 - designer / 10 : null, findings: valid ? [GAP] : [],
    narrative: valid ? 'ΔJ −5.0% on training. Holding at Central helped transfers.' : '',
  };
}

export function round(n: number, proposals: Proposal[], status: Round['status'] = 'done', championAfter = `g${n}`): Round {
  return {
    id: `R${n}`, number: n, championBefore: `g${n - 1}`, championAfter, status, proposals,
    startedAt: `2026-10-11T15:0${n}:00.000Z`, finishedAt: status === 'running' ? null : `2026-10-11T15:0${n}:30.000Z`,
  };
}
