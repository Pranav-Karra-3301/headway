// Owner: T3d. Rule-level policy diff for the Lab (spec §10): added / removed / changed rules, conditions,
// thresholds, actions and params. Pure; meta (id, parent, summary, author) is ignored.
import type { Action, Condition, DecisionKind, Policy, Rule, RouteId } from '@headway/sim';

export interface ConditionChange {
  kind: 'added' | 'removed' | 'changed';
  f: string;
  from?: Condition;
  to?: Condition;
}
export type RuleField = 'on' | 'priority' | 'do' | 'say';
export interface FieldChange { field: RuleField; from: unknown; to: unknown }
export interface RuleChange {
  id: string; on: DecisionKind;
  fields: FieldChange[];
  conditions: ConditionChange[];
  before: Rule; after: Rule;
}
export interface ParamChange { path: string; from: unknown; to: unknown }
export interface DefaultChange { kind: DecisionKind; from: Action; to: Action }
export interface PolicyDiff {
  added: Rule[]; removed: Rule[]; changed: RuleChange[];
  /** Rules present in both with no difference. */
  unchanged: number;
  params: ParamChange[];
  defaults: DefaultChange[];
  advisor: ParamChange[];
  empty: boolean;
}

const ROUTES: RouteId[] = ['r1', 'r2', 'r3'];
const KINDS: DecisionKind[] = ['bus_at_stop', 'bus_at_terminal', 'train_at_station'];
const RULE_FIELDS: Array<Exclude<RuleField, 'do'> | 'do'> = ['on', 'priority', 'do', 'say'];

/** Order-insensitive structural equality for small JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  return canon(a) === canon(b);
}
function canon(x: unknown): string {
  if (x === undefined) return 'undefined';
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
}

const sameCond = (a: Condition, b: Condition) => a.f === b.f && a.op === b.op && a.v === b.v;

/** Pair conditions: exact matches first, then same feature + op (threshold moved), then same feature (op changed). */
export function diffConditions(a: Condition[], b: Condition[]): ConditionChange[] {
  const left = a.map((c, i) => ({ c, i }));
  const right = b.map((c, i) => ({ c, i }));
  const out: Array<ConditionChange & { order: number }> = [];
  const take = (match: (x: Condition, y: Condition) => boolean, emit: boolean) => {
    for (let li = 0; li < left.length; li++) {
      const l = left[li]!;
      const ri = right.findIndex((r) => match(l.c, r.c));
      if (ri < 0) continue;
      const r = right[ri]!;
      if (emit) out.push({ kind: 'changed', f: l.c.f, from: l.c, to: r.c, order: r.i });
      left.splice(li, 1); right.splice(ri, 1); li--;
    }
  };
  take(sameCond, false);
  take((x, y) => x.f === y.f && x.op === y.op, true);
  take((x, y) => x.f === y.f, true);
  for (const l of left) out.push({ kind: 'removed', f: l.c.f, from: l.c, order: 1000 + l.i });
  for (const r of right) out.push({ kind: 'added', f: r.c.f, to: r.c, order: r.i });
  return out.sort((x, y) => x.order - y.order).map(({ order: _o, ...rest }) => rest);
}

function diffRule(a: Rule, b: Rule): RuleChange | null {
  const fields: FieldChange[] = [];
  for (const field of RULE_FIELDS) {
    if (!sameJson(a[field], b[field])) fields.push({ field, from: a[field], to: b[field] });
  }
  const conditions = diffConditions(a.when, b.when);
  if (!fields.length && !conditions.length) return null;
  return { id: b.id, on: b.on, fields, conditions, before: a, after: b };
}

function paramChanges(a: Policy['params'], b: Policy['params']): ParamChange[] {
  const out: ParamChange[] = [];
  for (const r of ROUTES) {
    if (a.allocation?.[r] !== b.allocation?.[r]) out.push({ path: `allocation.${r}`, from: a.allocation?.[r], to: b.allocation?.[r] });
  }
  if (a.maxHoldS !== b.maxHoldS) out.push({ path: 'maxHoldS', from: a.maxHoldS, to: b.maxHoldS });
  if (a.trainDefaultDwellS !== b.trainDefaultDwellS) out.push({ path: 'trainDefaultDwellS', from: a.trainDefaultDwellS, to: b.trainDefaultDwellS });
  for (const r of ROUTES) {
    const x = a.targetHeadwayS?.[r];
    const y = b.targetHeadwayS?.[r];
    if (x !== y) out.push({ path: `targetHeadwayS.${r}`, from: x, to: y });
  }
  return out;
}

function advisorChanges(a: Policy['advisor'], b: Policy['advisor']): ParamChange[] {
  if (!a && !b) return [];
  const out: ParamChange[] = [];
  const keys = ['enabled', 'askWhen', 'holdOptionsS', 'instructions', 'provider'] as const;
  for (const k of keys) {
    const x = a?.[k];
    const y = b?.[k];
    if (!sameJson(x, y)) out.push({ path: `advisor.${k}`, from: x, to: y });
  }
  return out;
}

export function diffPolicies(a: Policy, b: Policy): PolicyDiff {
  const aById = new Map(a.rules.map((r) => [r.id, r]));
  const bById = new Map(b.rules.map((r) => [r.id, r]));
  const added = b.rules.filter((r) => !aById.has(r.id));
  const removed = a.rules.filter((r) => !bById.has(r.id));
  const changed: RuleChange[] = [];
  let unchanged = 0;
  for (const rb of b.rules) {
    const ra = aById.get(rb.id);
    if (!ra) continue;
    const c = diffRule(ra, rb);
    if (c) changed.push(c);
    else unchanged++;
  }
  const params = paramChanges(a.params, b.params);
  const defaults: DefaultChange[] = [];
  for (const k of KINDS) {
    if (!sameJson(a.defaults?.[k], b.defaults?.[k])) defaults.push({ kind: k, from: a.defaults[k], to: b.defaults[k] });
  }
  const advisor = advisorChanges(a.advisor, b.advisor);
  const empty = !added.length && !removed.length && !changed.length && !params.length && !defaults.length && !advisor.length;
  return { added, removed, changed, unchanged, params, defaults, advisor, empty };
}

// ---------- plain-language rendering ----------

const MINUS = '−';
const OPS: Record<Condition['op'], string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '==': '=' };

export function fmtNum(v: number): string {
  const s = Number.isInteger(v) ? String(Math.abs(v)) : String(Math.round(Math.abs(v) * 100) / 100);
  return v < 0 ? `${MINUS}${s}` : s;
}

export function describeCondition(c: Condition): string {
  return `${c.f} ${OPS[c.op] ?? c.op} ${fmtNum(c.v)}`;
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'continue': return 'continue';
    case 'dispatch': return 'dispatch';
    case 'hold': return 'seconds' in a ? `hold ${fmtNum(a.seconds)} s` : 'hold to target headway';
    case 'reassign': return a.to === 'busiest' ? 'reassign → busiest route' : `reassign → ${a.to}`;
    case 'setTrainDeparture': return `train dwells ${fmtNum(a.dwellS)} s`;
  }
}

export const KIND_LABEL: Record<DecisionKind, string> = {
  bus_at_stop: 'bus at stop',
  bus_at_terminal: 'bus at terminal',
  train_at_station: 'train at station',
};

const PARAM_LABEL: Record<string, string> = {
  maxHoldS: 'max hold',
  trainDefaultDwellS: 'default train dwell',
};

/** "allocation.r1" → "buses on r1", "maxHoldS" → "max hold", etc. */
export function paramLabel(path: string): string {
  if (path.startsWith('allocation.')) return `buses on ${path.slice(11)}`;
  if (path.startsWith('targetHeadwayS.')) return `target headway ${path.slice(15)}`;
  if (path.startsWith('advisor.')) return `Jev ${path.slice(8)}`;
  return PARAM_LABEL[path] ?? path;
}

/** Value text for params (seconds get a unit; absent values read as "auto"/"off"). */
export function paramValue(path: string, v: unknown): string {
  if (v === undefined || v === null) return path.startsWith('targetHeadwayS.') ? 'auto' : '—';
  if (typeof v === 'number') return path.endsWith('S') || path.startsWith('targetHeadwayS.') ? `${fmtNum(v)} s` : fmtNum(v);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 47)}…` : v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x && 'f' in x ? describeCondition(x as Condition) : String(x))).join(', ');
  return JSON.stringify(v);
}

/** One-line summary: "+2 rules · 1 changed · 3 params". */
export function diffSummary(d: PolicyDiff): string {
  if (d.empty) return 'No rule changes';
  const parts: string[] = [];
  if (d.added.length) parts.push(`+${d.added.length} rule${d.added.length > 1 ? 's' : ''}`);
  if (d.removed.length) parts.push(`${MINUS}${d.removed.length} rule${d.removed.length > 1 ? 's' : ''}`);
  if (d.changed.length) parts.push(`${d.changed.length} changed`);
  const p = d.params.length + d.defaults.length + d.advisor.length;
  if (p) parts.push(`${p} param${p > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
