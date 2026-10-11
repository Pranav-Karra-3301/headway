// Hand-rolled structural checks for request bodies (the worker has no direct zod dependency).
// Every error is one short line naming the path, e.g. `generations[0].train.J: expected number`.
import { validatePolicy } from '@headway/sim';
import type { Generation, Intent, Metrics, Replay, Round, RouteId, SplitScore } from '@headway/sim';

type Check = (v: unknown, path: string, errs: string[]) => void;
type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (min = 0, max = Infinity): Check => (v, p, e) => {
  if (typeof v !== 'string') e.push(`${p}: expected string`);
  else if (v.trim().length < min) e.push(`${p}: must not be empty`);
  else if (v.length > max) e.push(`${p}: longer than ${max} characters`);
};
const num: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected number`);
};
const int = (min: number): Check => (v, p, e) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) e.push(`${p}: expected integer >= ${min}`);
};
const bool: Check = (v, p, e) => {
  if (typeof v !== 'boolean') e.push(`${p}: expected boolean`);
};
const oneOf = (...xs: unknown[]): Check => (v, p, e) => {
  if (!xs.includes(v)) e.push(`${p}: expected one of ${xs.map((x) => JSON.stringify(x)).join(', ')}`);
};
const nullable = (c: Check): Check => (v, p, e) => {
  if (v !== null) c(v, p, e);
};
const optional = (c: Check): Check => (v, p, e) => {
  if (v !== undefined) c(v, p, e);
};
const anything: Check = () => {};
const array = (c: Check, min = 0, max = Infinity): Check => (v, p, e) => {
  if (!Array.isArray(v)) return void e.push(`${p}: expected array`);
  if (v.length < min || v.length > max) e.push(`${p}: expected ${min}..${max} items, got ${v.length}`);
  v.forEach((x, i) => c(x, `${p}[${i}]`, e));
};
const object = (shape: Record<string, Check>): Check => (v, p, e) => {
  if (!isObj(v)) return void e.push(`${p}: expected object`);
  for (const [k, c] of Object.entries(shape)) c(v[k], `${p}.${k}`, e);
};

function run<T>(c: Check, v: unknown, root: string): Result<T> {
  const errors: string[] = [];
  c(v, root, errors);
  return errors.length === 0 ? { ok: true, value: v as T } : { ok: false, errors: errors.slice(0, 50) };
}

// ---------- evolution records ----------
const metrics = object({
  J: num, spawned: num, completed: num, unfinished: num, completionPct: num, meanJourneyS: num, meanWaitS: num, p95WaitS: num,
  maxWaitS: num, transfersMade: num, missedConnections: num, leftBehind: num, walkaways: num,
  effort: object({ busDistanceU: num, deadheadDistanceU: num, holdS: num, trainDwellS: num }),
});
const splitScore = object({ J: num, metrics, runs: int(0) });
/** Minimal shape. Generations and valid proposals additionally pass `validatePolicy` (see `parsePublish`). */
const policy = object({
  meta: object({ id: str(1, 64) }),
  params: object({}),
  rules: array(object({ id: str(1, 64) }), 0, 24),
  defaults: object({}),
});
const isPolicyShaped = (v: unknown): boolean => {
  const errs: string[] = [];
  policy(v, '', errs);
  return errs.length === 0;
};
const finding = object({ kind: str(1), impactS: num, text: str() });
const generation = object({
  id: str(1, 64), number: int(0), parentId: nullable(str(1, 64)), policy, fromProposal: nullable(str(1, 64)), explanation: str(),
  train: splitScore, val: splitScore, findings: array(finding), createdAt: str(1),
});
const proposal = object({
  id: str(1, 64), roundId: str(1, 64), designer: oneOf(0, 1, 2), model: str(1), emphasis: oneOf('transfers', 'spacing', 'allocation'),
  // Checked in parsePublish: valid → full DSL validation; invalid → kept when policy-shaped, else stored as null.
  summary: str(), rationale: str(), policy: anything, valid: bool, errors: array(str()),
  train: nullable(splitScore), val: nullable(splitScore), deltaTrainPct: nullable(num), findings: array(finding), narrative: str(),
});
const round = object({
  id: str(1, 64), number: int(0), championBefore: str(1), championAfter: str(1), status: oneOf('running', 'done', 'failed'),
  proposals: array(proposal), startedAt: str(1), finishedAt: nullable(str(1)),
});

/** Body of `POST /api/admin/publish`. Rounds carry their proposals. */
export interface PublishBody {
  generations?: Generation[];
  rounds?: Round[];
  /** g0 on the train split (defaults to generation g0's train score when omitted). */
  baseline?: SplitScore;
  /** ref on the train split. */
  reference?: SplitScore;
}

const publishShape = object({
  generations: optional(array(generation)),
  rounds: optional(array(round)),
  baseline: optional(splitScore),
  reference: optional(splitScore),
});

export function parsePublish(v: unknown): Result<PublishBody> {
  const r = run<PublishBody>(publishShape, v, 'body');
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => e.replace(/^body\./, '')) };
  const b = r.value;
  const errors: string[] = [];
  if (!b.generations?.length && !b.rounds?.length && !b.baseline && !b.reference) errors.push('body: nothing to publish');
  const dup = (ids: string[], path: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${path}: duplicate id "${id}"`);
      seen.add(id);
    }
  };
  dup((b.generations ?? []).map((g) => g.id), 'generations');
  dup((b.generations ?? []).map((g) => String(g.number)), 'generations[].number');
  dup((b.rounds ?? []).map((r) => r.id), 'rounds');
  dup((b.rounds ?? []).flatMap((r) => r.proposals.map((p) => p.id)), 'rounds[].proposals');
  (b.rounds ?? []).forEach((r, i) =>
    r.proposals.forEach((p, j) => {
      if (p.roundId !== r.id) errors.push(`rounds[${i}].proposals[${j}].roundId: "${p.roundId}" does not match round "${r.id}"`);
    }),
  );
  // Policies the web may run (the champion feeds Watch; valid proposals can be replayed) must pass the sim's own
  // DSL validator, so a deploy never serves a policy its bundled sim cannot run. Invalid proposals are display-only.
  (b.generations ?? []).forEach((g, i) => checkPolicy(g.policy, `generations[${i}].policy`, errors));
  const rounds = b.rounds?.map((r, i) => ({
    ...r,
    proposals: r.proposals.map((p, j) => {
      if (p.valid) checkPolicy(p.policy, `rounds[${i}].proposals[${j}].policy`, errors);
      else if (p.policy !== null && !isPolicyShaped(p.policy)) return { ...p, policy: null };
      return p;
    }),
  }));
  return errors.length === 0 ? { ok: true, value: { ...b, rounds } } : { ok: false, errors: errors.slice(0, 50) };
}

/** Runs `validatePolicy` and re-roots its paths (`rules[0].when[0].f: …`) under `at`. */
function checkPolicy(p: unknown, at: string, errors: string[]): void {
  const v = validatePolicy(p);
  if (v.ok) return;
  for (const e of v.errors) errors.push(e.startsWith('policy:') ? at + e.slice('policy'.length) : e.startsWith('[') ? at + e : `${at}.${e}`);
}

// ---------- Jev proxy ----------
export interface JevDecideRequest {
  instructions: string;
  situation: string;
  options: string[];
}

const jevShape = object({ instructions: str(0, 1200), situation: str(1, 1500), options: array(str(1, 200), 2, 8) });

export function parseJevRequest(v: unknown): Result<JevDecideRequest> {
  const r = run<JevDecideRequest>(jevShape, v, 'body');
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => e.replace(/^body\./, '')) };
  return { ok: true, value: { instructions: r.value.instructions, situation: r.value.situation, options: [...r.value.options] } };
}

// ---------- leaderboard submissions ----------
/** Spec §11: at most 16 characters of [A-Za-z0-9 _-] (trimmed, inner whitespace collapsed — same as the web's cleanName). */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9 _-]{1,16}$/.test(s) ? s : null;
}

export const MAX_INTENTS = 1000;
const VEHICLE_ID = /^[A-Za-z0-9_-]{1,16}$/;
const ROUTE_IDS: readonly RouteId[] = ['r1', 'r2', 'r3'];

/** What the server needs to re-simulate a play run: `expect` comes from the bundled sim and map, `tMax` from the scenario. */
export interface ReplayExpect { simVersion: string; mapVersion: string; scenarioId: string; tMax: number; seedOk: (seed: number) => string | null }
export interface Submission { name: string; replay: Replay & { intents: Array<{ t: number; intent: Intent }> } }

function parseIntent(x: unknown, p: string, tMax: number, errs: string[]): { t: number; intent: Intent } | null {
  if (!isObj(x)) {
    errs.push(`${p}: expected { t, intent }`);
    return null;
  }
  const n0 = errs.length;
  const t = x.t;
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 0 || t > tMax) errs.push(`${p}.t: expected a whole second 0..${tMax}`);
  const i = x.intent;
  if (!isObj(i)) {
    errs.push(`${p}.intent: expected object`);
    return null;
  }
  const vehicle = () => {
    if (typeof i.vehicleId !== 'string' || !VEHICLE_ID.test(i.vehicleId)) errs.push(`${p}.intent.vehicleId: expected a vehicle id like "b3"`);
    return i.vehicleId as string;
  };
  const seconds = (k: 'seconds' | 'dwellS') => {
    const v = i[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 600) errs.push(`${p}.intent.${k}: expected a number of seconds 0..600`);
    return v as number;
  };
  let intent: Intent | null = null;
  switch (i.type) {
    case 'dispatch': intent = { type: 'dispatch', vehicleId: vehicle() }; break;
    case 'hold': intent = { type: 'hold', vehicleId: vehicle(), seconds: seconds('seconds') }; break;
    case 'reassign': {
      const vehicleId = vehicle();
      if (!ROUTE_IDS.includes(i.to as RouteId)) errs.push(`${p}.intent.to: expected one of "r1", "r2", "r3"`);
      intent = { type: 'reassign', vehicleId, to: i.to as RouteId };
      break;
    }
    case 'setTrainDeparture': intent = { type: 'setTrainDeparture', dwellS: seconds('dwellS') }; break;
    default: errs.push(`${p}.intent.type: expected one of "dispatch", "hold", "reassign", "setTrainDeparture"`);
  }
  return errs.length === n0 && intent ? { t: t as number, intent } : null;
}

/**
 * Body of `POST /api/leaderboard`: `{ name, replay }`. The replay must be the play scenario on a recent play seed, made with
 * the current sim and map, by the baseline g0 plus human intents only (recorded decisions are refused, spec §10 fairness).
 * Returns a normalized replay (known fields only) the server re-simulates and stores.
 */
export function parseSubmission(v: unknown, expect: ReplayExpect): Result<Submission> {
  const errors: string[] = [];
  if (!isObj(v)) return { ok: false, errors: ['body: expected { name, replay }'] };
  const name = cleanName(v.name);
  if (!name) errors.push('name: use 1–16 letters, digits, spaces, _ or -');
  const r = v.replay;
  if (!isObj(r)) return { ok: false, errors: [...errors, 'replay: expected the replay object from a finished run'] };

  const reload = '(reload the page to get the current game)';
  if (r.simVersion !== expect.simVersion) errors.push(`replay.simVersion: ${JSON.stringify(r.simVersion)} is not the server's sim version "${expect.simVersion}" ${reload}`);
  if (r.mapVersion !== expect.mapVersion) errors.push(`replay.mapVersion: ${JSON.stringify(r.mapVersion)} is not the server's map version "${expect.mapVersion}" ${reload}`);
  if (r.scenarioId !== expect.scenarioId) errors.push(`replay.scenarioId: ${JSON.stringify(r.scenarioId)} is not the play scenario "${expect.scenarioId}"`);
  const seed = r.seed;
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) errors.push('replay.seed: expected an integer play seed');
  else {
    const why = expect.seedOk(seed);
    if (why) errors.push(`replay.seed: ${why}`);
  }
  const c = r.controller;
  const humanOnG0 = isObj(c) && ((c.kind === 'human' && c.basePolicyId === 'g0') || (c.kind === 'policy' && c.policyId === 'g0'));
  if (!humanOnG0) errors.push('replay.controller: must be the baseline plus your interventions ({"kind":"human","basePolicyId":"g0"})');
  if (r.decisions !== undefined && !(Array.isArray(r.decisions) && r.decisions.length === 0)) {
    errors.push('replay.decisions: recorded decisions are not accepted; submit your intents only');
  }

  const intents: Array<{ t: number; intent: Intent }> = [];
  if (r.intents !== undefined) {
    if (!Array.isArray(r.intents)) errors.push(`replay.intents: expected an array of at most ${MAX_INTENTS} { t, intent }`);
    else if (r.intents.length > MAX_INTENTS) errors.push(`replay.intents: at most ${MAX_INTENTS} intents (got ${r.intents.length})`);
    else {
      r.intents.forEach((x, k) => {
        const ok = parseIntent(x, `replay.intents[${k}]`, expect.tMax, errors);
        if (ok) intents.push(ok);
      });
    }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 50) };
  return {
    ok: true,
    value: {
      name: name!,
      replay: {
        simVersion: expect.simVersion, mapVersion: expect.mapVersion, scenarioId: expect.scenarioId, seed: seed as number,
        controller: { kind: 'human', basePolicyId: 'g0' }, intents,
      },
    },
  };
}

// ---------- sealed evaluation (body shape of packages/evolve/src/cli/eval-sealed.ts, T8) ----------
export interface SealedResultBody {
  role: 'champion' | 'baseline' | 'reference'; policyId: string; simVersion: string; jTest: number; metrics: Metrics;
  score?: SplitScore; byScenario?: Record<string, SplitScore>; deltaVsBaselinePct?: number | null; createdAt?: string;
}
/** `POST /api/admin/sealed-eval` with precomputed results (`eval-sealed --url …`). Contains no seeds. */
export interface SealedEvalBody {
  simVersion: string; mapVersion: string; seedSet: string; scenarios: string[]; seedsPerScenario: number; runs: number; createdAt: string;
  results: SealedResultBody[];
}

const isoDate: Check = (v, p, e) => {
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) e.push(`${p}: expected an ISO timestamp`);
};
const record = (c: Check): Check => (v, p, e) => {
  if (!isObj(v)) return void e.push(`${p}: expected object`);
  const keys = Object.keys(v);
  if (keys.length > 10) e.push(`${p}: at most 10 entries`);
  for (const k of keys.slice(0, 10)) c(v[k], `${p}.${k}`, e);
};
const sealedResult = object({
  role: oneOf('champion', 'baseline', 'reference'), policyId: str(1, 64), simVersion: str(1, 32), jTest: num, metrics,
  score: optional(splitScore), byScenario: optional(record(splitScore)), deltaVsBaselinePct: optional(nullable(num)), createdAt: optional(isoDate),
});
const sealedShape = object({
  simVersion: str(1, 32), mapVersion: str(1, 32), seedSet: str(1, 64), scenarios: array(str(1, 40), 1, 10), seedsPerScenario: int(1),
  runs: int(1), createdAt: isoDate, results: array(sealedResult, 1, 10),
});

export function parseSealedEval(v: unknown): Result<SealedEvalBody> {
  const r = run<SealedEvalBody>(sealedShape, v, 'body');
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => e.replace(/^body\./, '')) };
  return r;
}

/** SEALED_TEST_SEEDS: a JSON array (or comma list) of 1–10 distinct positive integers. Errors never echo the value. */
export function parseSealedSeeds(value: string): number[] | null {
  const t = value.trim();
  let xs: unknown;
  if (t.startsWith('[')) {
    try {
      xs = JSON.parse(t);
    } catch {
      return null;
    }
  } else xs = t ? t.split(',').map((s) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN)) : [];
  if (!Array.isArray(xs) || xs.length < 1 || xs.length > 10) return null;
  if (!xs.every((x) => typeof x === 'number' && Number.isSafeInteger(x) && x > 0)) return null;
  if (new Set(xs).size !== xs.length) return null;
  return xs as number[];
}
