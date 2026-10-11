// Hand-rolled structural checks for request bodies (the worker has no direct zod dependency).
// Every error is one short line naming the path, e.g. `generations[0].train.J: expected number`.
import type { Generation, Round, SplitScore } from '@headway/sim';

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
/** Shape only; full DSL validation is `validatePolicy` in @headway/sim (the CLI validates before publishing). */
const policy = object({
  meta: object({ id: str(1, 64) }),
  params: object({}),
  rules: array(object({ id: str(1, 64) }), 0, 24),
  defaults: object({}),
});
const finding = object({ kind: str(1), impactS: num, text: str() });
const generation = object({
  id: str(1, 64), number: int(0), parentId: nullable(str(1, 64)), policy, fromProposal: nullable(str(1, 64)), explanation: str(),
  train: splitScore, val: splitScore, findings: array(finding), createdAt: str(1),
});
const proposal = object({
  id: str(1, 64), roundId: str(1, 64), designer: oneOf(0, 1, 2), model: str(1), emphasis: oneOf('transfers', 'spacing', 'allocation'),
  summary: str(), rationale: str(), policy: nullable(policy), valid: bool, errors: array(str()),
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
  return errors.length === 0 ? { ok: true, value: b } : { ok: false, errors };
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
