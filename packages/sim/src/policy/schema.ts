// Owner: Task P. zod schema + semantic validation of the policy DSL (spec §6).
//
// `validatePolicy` walks the raw input defensively and reports EVERY problem in one pass (structure and semantics),
// one short line each: `rules[2].when[0].f: unknown feature "train_eta" for bus_at_stop`. That matters because a
// designer gets exactly one repair attempt. Unknown keys are tolerated and stripped from the returned policy.
import { z } from 'zod';
import type { Action, DecisionKind, Op, Policy, RouteId } from '../contracts';
import { FEATURES, PLACEHOLDERS } from './features';

// ---------- limits (spec §6, §5.3) ----------
const KINDS: DecisionKind[] = ['bus_at_stop', 'bus_at_terminal', 'train_at_station'];
const OPS: Op[] = ['<', '<=', '>', '>=', '=='];
const ROUTES: RouteId[] = ['r1', 'r2', 'r3'];
const EMPHASES = ['transfers', 'spacing', 'allocation', 'baseline', 'reference'] as const;
const ACTION_TYPES: Action['type'][] = ['continue', 'dispatch', 'hold', 'reassign', 'setTrainDeparture'];
const LEGAL: Record<DecisionKind, Action['type'][]> = {
  bus_at_stop: ['continue', 'hold'],
  bus_at_terminal: ['dispatch', 'hold', 'reassign'],
  train_at_station: ['setTrainDeparture'],
};
const EXAMPLE_ACTION: Record<DecisionKind, string> = {
  bus_at_stop: '{"type": "continue"}',
  bus_at_terminal: '{"type": "dispatch"}',
  train_at_station: '{"type": "setTrainDeparture", "dwellS": 45}',
};
const RULE_ID = /^[a-z0-9-]{3,32}$/;
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const MAX_RULES = 24;
const MAX_CONDITIONS = 6;
const MAX_SAY = 140;
const MAX_SUMMARY = 200;
const MAX_INSTRUCTIONS = 1200;
const FLEET = 6;
const MAX_HOLD_S = 90;          // params.maxHoldS ceiling (= SimConfig.limits.maxHoldS)
const MIN_STOP_HOLD_S = 5;      // stop hold: 5..params.maxHoldS
const TERMINAL_HOLD: [number, number] = [10, 120];
const TRAIN_DWELL: [number, number] = [30, 120];
const HEADWAY: [number, number] = [60, 1800];

export function legalActionTypes(kind: DecisionKind): Action['type'][] {
  return [...LEGAL[kind]];
}

// ---------- the walker ----------
type Path = PropertyKey[];
interface Issue { path: Path; message: string }
type Add = (path: Path, message: string) => void;

function formatPath(path: readonly PropertyKey[]): string {
  let s = '';
  for (const k of path) {
    if (typeof k === 'number') s += `[${k}]`;
    else s += s ? `.${String(k)}` : String(k);
  }
  return s || 'policy';
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isNum(x) && Number.isInteger(x);
const show = (x: unknown): string => {
  if (x === undefined) return 'nothing';
  const s = JSON.stringify(x) ?? String(x);
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
};
const range = (lo: number, hi: number) => `${lo}–${hi}`;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

function featureHint(name: string, kind: DecisionKind): string {
  const own = Object.keys(FEATURES[kind]);
  let best = '';
  let bestD = Infinity;
  for (const f of own) {
    const d = f.startsWith(name) || name.startsWith(f) ? 1 : levenshtein(name, f);
    if (d < bestD) { best = f; bestD = d; }
  }
  if (best && bestD <= Math.max(2, Math.floor(name.length / 3))) return ` (did you mean "${best}"?)`;
  const other = KINDS.find((k) => k !== kind && Object.hasOwn(FEATURES[k], name));
  if (other) return ` (it is a ${other} feature)`;
  return '';
}

function checkString(x: unknown, path: Path, add: Add, max: number, opts: { nonEmpty?: boolean } = {}): void {
  if (typeof x !== 'string') return add(path, `must be a string (got ${show(x)})`);
  if (opts.nonEmpty && x.trim() === '') return add(path, 'must not be empty');
  if (x.length > max) add(path, `at most ${max} characters (got ${x.length})`);
}

function checkIntIn(x: unknown, path: Path, add: Add, lo: number, hi: number, what = ''): void {
  if (!isNum(x)) return add(path, `must be a number (got ${show(x)})`);
  if (!Number.isInteger(x)) return add(path, `must be a whole number (got ${x})`);
  if (x < lo || x > hi) add(path, `${x} is outside ${range(lo, hi)}${what}`);
}

function checkCondition(c: unknown, path: Path, kind: DecisionKind | null, add: Add): void {
  if (!isRecord(c)) return add(path, `must be a condition like {"f": "queue_here", "op": ">=", "v": 20} (got ${show(c)})`);
  let spec: { min: number; max: number } | undefined;
  if (typeof c.f !== 'string') add([...path, 'f'], `must be a feature name (got ${show(c.f)})`);
  else if (kind) {
    spec = Object.hasOwn(FEATURES[kind], c.f) ? FEATURES[kind][c.f] : undefined;
    if (!spec) add([...path, 'f'], `unknown feature "${c.f}" for ${kind}${featureHint(c.f, kind)}`);
  }
  if (!OPS.includes(c.op as Op)) add([...path, 'op'], `must be one of ${OPS.join(' ')} (got ${show(c.op)})`);
  if (!isNum(c.v)) add([...path, 'v'], `must be a number (got ${show(c.v)})`);
  else if (spec && (c.v < spec.min || c.v > spec.max)) {
    add([...path, 'v'], `${c.v} is outside ${range(spec.min, spec.max)} for ${String(c.f)}`);
  }
}

function checkConditions(when: unknown, path: Path, kind: DecisionKind | null, add: Add): void {
  if (!Array.isArray(when)) return add(path, `must be an array of conditions (got ${show(when)})`);
  if (when.length > MAX_CONDITIONS) add(path, `at most ${MAX_CONDITIONS} conditions (got ${when.length})`);
  when.forEach((c, i) => checkCondition(c, [...path, i], kind, add));
}

/** Checks an action for `kind` (null = kind unknown: structure only). Returns the action type when recognisable. */
function checkAction(a: unknown, path: Path, kind: DecisionKind | null, maxHold: number, add: Add): Action['type'] | null {
  if (!isRecord(a)) {
    add(path, `must be an action like ${EXAMPLE_ACTION[kind ?? 'bus_at_stop']} (got ${show(a)})`);
    return null;
  }
  const type = a.type as Action['type'];
  if (!ACTION_TYPES.includes(type)) {
    add([...path, 'type'], `unknown action type ${show(a.type)} (types: ${ACTION_TYPES.join(', ')})`);
    return null;
  }
  if (kind && !LEGAL[kind].includes(type)) {
    add([...path, 'type'], `${type} is not allowed on ${kind} (allowed: ${LEGAL[kind].join(', ')})`);
  }
  if (type === 'hold') {
    const hasS = a.seconds !== undefined;
    const hasU = a.until !== undefined;
    if (hasS && hasU) add(path, 'hold takes either "seconds" or "until", not both');
    else if (!hasS && !hasU) add(path, 'hold needs "seconds" or "until": "target_headway"');
    else if (hasU) {
      if (a.until !== 'target_headway') add([...path, 'until'], `must be "target_headway" (got ${show(a.until)})`);
    } else if (kind === 'bus_at_terminal') {
      checkIntIn(a.seconds, [...path, 'seconds'], add, TERMINAL_HOLD[0], TERMINAL_HOLD[1], ' for a hold at the terminal');
    } else if (kind === 'bus_at_stop') {
      checkIntIn(a.seconds, [...path, 'seconds'], add, MIN_STOP_HOLD_S, maxHold, ` for a hold at a stop (params.maxHoldS = ${maxHold})`);
    } else {
      checkIntIn(a.seconds, [...path, 'seconds'], add, MIN_STOP_HOLD_S, TERMINAL_HOLD[1]);
    }
  } else if (type === 'reassign') {
    if (!(ROUTES as unknown[]).includes(a.to) && a.to !== 'busiest') {
      add([...path, 'to'], `must be ${ROUTES.join(', ')} or "busiest" (got ${show(a.to)})`);
    }
  } else if (type === 'setTrainDeparture') {
    checkIntIn(a.dwellS, [...path, 'dwellS'], add, TRAIN_DWELL[0], TRAIN_DWELL[1], ' s after arrival');
  }
  return type;
}

function checkSay(say: unknown, path: Path, kind: DecisionKind | null, actionType: Action['type'] | null, add: Add): void {
  checkString(say, path, add, MAX_SAY);
  if (typeof say !== 'string' || !kind) return;
  const reported = new Set<string>();
  for (const m of say.matchAll(PLACEHOLDER)) {
    const name = m[1]!;
    if (reported.has(name)) continue;
    reported.add(name);
    if (!PLACEHOLDERS[kind].includes(name)) {
      add(path, `unknown placeholder {${name}} for ${kind}`);
    } else if (actionType) {
      const needs = name === 'seconds' ? 'hold' : name === 'to' ? 'reassign' : name === 'dwellS' ? 'setTrainDeparture' : null;
      if (needs && needs !== actionType) add(path, `placeholder {${name}} needs a ${needs} action (this rule does ${actionType})`);
    }
  }
}

function checkMeta(m: unknown, add: Add): void {
  const path = ['meta'];
  if (!isRecord(m)) return add(path, `must be an object with id, parent, generation, author, emphasis, summary (got ${show(m)})`);
  checkString(m.id, [...path, 'id'], add, 64, { nonEmpty: true });
  if (m.parent !== null) checkString(m.parent, [...path, 'parent'], add, 64);
  if (!isInt(m.generation) || m.generation < 0) add([...path, 'generation'], `must be a whole number ≥ 0 (got ${show(m.generation)})`);
  checkString(m.author, [...path, 'author'], add, 120);
  if (!(EMPHASES as readonly unknown[]).includes(m.emphasis)) {
    add([...path, 'emphasis'], `must be one of ${EMPHASES.join(', ')} (got ${show(m.emphasis)})`);
  }
  checkString(m.summary, [...path, 'summary'], add, MAX_SUMMARY);
}

/** Returns the effective stop-hold cap (params.maxHoldS when valid, else the 90 s ceiling). */
function checkParams(p: unknown, add: Add): number {
  const path = ['params'];
  if (!isRecord(p)) {
    add(path, `must be an object with allocation, maxHoldS, trainDefaultDwellS (got ${show(p)})`);
    return MAX_HOLD_S;
  }
  const alloc = p.allocation;
  if (!isRecord(alloc)) add([...path, 'allocation'], `must be an object like {"r1": 2, "r2": 2, "r3": 2} (got ${show(alloc)})`);
  else {
    for (const k of Object.keys(alloc)) {
      if (!(ROUTES as string[]).includes(k)) add([...path, 'allocation', k], `unknown route (routes: ${ROUTES.join(', ')})`);
    }
    let allInts = true;
    for (const r of ROUTES) {
      const n = alloc[r];
      if (!isInt(n) || n < 1) { allInts = false; add([...path, 'allocation', r], `must be a whole number of buses ≥ 1 (got ${show(n)})`); }
    }
    const sum = ROUTES.reduce((s, r) => s + (isNum(alloc[r]) ? (alloc[r] as number) : 0), 0);
    if (allInts && sum !== FLEET) add([...path, 'allocation'], `must sum to ${FLEET} buses (got ${sum})`);
  }
  let maxHold = MAX_HOLD_S;
  if (!isInt(p.maxHoldS) || p.maxHoldS < 0 || p.maxHoldS > MAX_HOLD_S) {
    add([...path, 'maxHoldS'], `must be a whole number of seconds in ${range(0, MAX_HOLD_S)} (got ${show(p.maxHoldS)})`);
  } else maxHold = p.maxHoldS;
  checkIntIn(p.trainDefaultDwellS, [...path, 'trainDefaultDwellS'], add, TRAIN_DWELL[0], TRAIN_DWELL[1]);
  if (p.targetHeadwayS !== undefined) {
    const t = p.targetHeadwayS;
    if (!isRecord(t)) add([...path, 'targetHeadwayS'], `must be an object like {"r1": 240} (got ${show(t)})`);
    else {
      for (const [k, v] of Object.entries(t)) {
        if (!(ROUTES as string[]).includes(k)) add([...path, 'targetHeadwayS', k], `unknown route (routes: ${ROUTES.join(', ')})`);
        else checkIntIn(v, [...path, 'targetHeadwayS', k], add, HEADWAY[0], HEADWAY[1], ' s');
      }
    }
  }
  return maxHold;
}

function checkRules(rules: unknown, maxHold: number, add: Add): void {
  const path = ['rules'];
  if (!Array.isArray(rules)) return add(path, `must be an array of rules (got ${show(rules)})`);
  if (rules.length > MAX_RULES) add(path, `at most ${MAX_RULES} rules (got ${rules.length})`);
  const seen = new Map<string, number>();
  rules.forEach((r: unknown, i) => {
    const rp = [...path, i];
    if (!isRecord(r)) return add(rp, `must be a rule object with id, on, priority, when, do, say (got ${show(r)})`);
    if (typeof r.id !== 'string' || !RULE_ID.test(r.id)) add([...rp, 'id'], `must match ^[a-z0-9-]{3,32}$ (got ${show(r.id)})`);
    else if (r.id === 'default') add([...rp, 'id'], '"default" is reserved for the defaults');
    else if (seen.has(r.id)) add([...rp, 'id'], `duplicate rule id "${r.id}" (also rules[${seen.get(r.id)}])`);
    else seen.set(r.id, i);
    const kind = KINDS.includes(r.on as DecisionKind) ? (r.on as DecisionKind) : null;
    if (!kind) add([...rp, 'on'], `must be one of ${KINDS.join(', ')} (got ${show(r.on)})`);
    if (!isNum(r.priority)) add([...rp, 'priority'], `must be a number (got ${show(r.priority)})`);
    checkConditions(r.when, [...rp, 'when'], kind, add);
    const actionType = checkAction(r.do, [...rp, 'do'], kind, maxHold, add);
    checkSay(r.say, [...rp, 'say'], kind, actionType, add);
  });
}

function checkDefaults(d: unknown, maxHold: number, add: Add): void {
  const path = ['defaults'];
  if (!isRecord(d)) return add(path, `must be an object with an action for each of ${KINDS.join(', ')} (got ${show(d)})`);
  for (const k of KINDS) {
    if (d[k] === undefined) add([...path, k], `missing (e.g. ${EXAMPLE_ACTION[k]})`);
    else checkAction(d[k], [...path, k], k, maxHold, add);
  }
}

function checkAdvisor(a: unknown, maxHold: number, add: Add): void {
  const path = ['advisor'];
  if (!isRecord(a)) return add(path, `must be an object with provider, enabled, askWhen, holdOptionsS, instructions (got ${show(a)})`);
  if (a.provider !== 'jev') add([...path, 'provider'], `must be "jev" (got ${show(a.provider)})`);
  if (typeof a.enabled !== 'boolean') add([...path, 'enabled'], `must be true or false (got ${show(a.enabled)})`);
  checkConditions(a.askWhen, [...path, 'askWhen'], 'bus_at_stop', add);
  const opts = a.holdOptionsS;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > 8) {
    add([...path, 'holdOptionsS'], `must be 2–8 hold lengths in seconds, e.g. [0, 20, 40, 60] (got ${show(opts)})`);
  } else {
    opts.forEach((s: unknown, i) => {
      if (!isInt(s) || (s !== 0 && (s < MIN_STOP_HOLD_S || s > maxHold))) {
        add([...path, 'holdOptionsS', i], `must be 0 or a whole number in ${range(MIN_STOP_HOLD_S, maxHold)} (got ${show(s)})`);
      } else if (opts.indexOf(s) !== i) add([...path, 'holdOptionsS', i], `duplicate option ${s}`);
    });
  }
  checkString(a.instructions, [...path, 'instructions'], add, MAX_INSTRUCTIONS);
}

function collectIssues(x: unknown): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => { issues.push({ path, message }); };
  if (!isRecord(x)) {
    add([], `must be a JSON object with meta, params, rules, defaults (got ${show(x)})`);
    return issues;
  }
  checkMeta(x.meta, add);
  const maxHold = checkParams(x.params, add);
  checkRules(x.rules, maxHold, add);
  checkDefaults(x.defaults, maxHold, add);
  if (x.advisor !== undefined) checkAdvisor(x.advisor, maxHold, add);
  return issues;
}

// ---------- zod (structure; kind-dependent rules come from the walker via superRefine) ----------
const zCondition = z.object({ f: z.string(), op: z.enum(['<', '<=', '>', '>=', '==']), v: z.number() });
const zAction = z.union([
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('dispatch') }),
  z.object({ type: z.literal('hold'), seconds: z.number() }),
  z.object({ type: z.literal('hold'), until: z.literal('target_headway') }),
  z.object({ type: z.literal('reassign'), to: z.enum(['r1', 'r2', 'r3', 'busiest']) }),
  z.object({ type: z.literal('setTrainDeparture'), dwellS: z.number() }),
]);
const zKind = z.enum(['bus_at_stop', 'bus_at_terminal', 'train_at_station']);
const zPolicy = z.object({
  meta: z.object({
    id: z.string(), parent: z.string().nullable(), generation: z.number(), author: z.string(),
    emphasis: z.enum(EMPHASES), summary: z.string(),
  }),
  params: z.object({
    allocation: z.object({ r1: z.number(), r2: z.number(), r3: z.number() }),
    maxHoldS: z.number(),
    trainDefaultDwellS: z.number(),
    targetHeadwayS: z.object({ r1: z.number().optional(), r2: z.number().optional(), r3: z.number().optional() }).optional(),
  }),
  rules: z.array(z.object({ id: z.string(), on: zKind, priority: z.number(), when: z.array(zCondition), do: zAction, say: z.string() })),
  defaults: z.object({ bus_at_stop: zAction, bus_at_terminal: zAction, train_at_station: zAction }),
  advisor: z.object({
    provider: z.literal('jev'), enabled: z.boolean(), askWhen: z.array(zCondition),
    holdOptionsS: z.array(z.number()), instructions: z.string(),
  }).optional(),
});

/** Full policy schema: zod structure + every spec §6 semantic check. Unknown keys are stripped. */
export const PolicySchema: z.ZodType<Policy> = zPolicy.superRefine((p, ctx) => {
  for (const i of collectIssues(p)) ctx.addIssue({ code: 'custom', path: i.path, message: i.message });
});

export type ValidationResult = { ok: true; policy: Policy } | { ok: false; errors: string[] };

export function validatePolicy(input: unknown): ValidationResult {
  const issues = collectIssues(input);
  if (issues.length > 0) return { ok: false, errors: issues.map((i) => `${formatPath(i.path)}: ${i.message}`) };
  const parsed = zPolicy.safeParse(input); // backstop + strips unknown keys
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`) };
  return { ok: true, policy: parsed.data };
}

// ---------- DSL doc for LLM prompts (≤ 5,000 chars) ----------
const described = new Map<string, unknown>();
function featureLines(kind: DecisionKind): string {
  return Object.entries(FEATURES[kind])
    .map(([f, s]) => {
      const same = described.get(f) === s;
      described.set(f, s);
      return `- ${f} ${s.min}..${s.max}: ${same ? 'as above' : s.desc}`;
    })
    .join('\n');
}

export const POLICY_DSL_DOC = `# Headway dispatch policy DSL
A policy is JSON. The sim raises 3 kinds of decision point: bus_at_stop (after boarding at a stop),
bus_at_terminal (bus in layover at its route terminal), train_at_station (after boarding).

## Semantics
1. Rules with on == kind are tried by descending priority (ties: array order).
2. The first rule whose "when" conditions ALL hold (empty = always) and whose action is applicable fires.
3. Otherwise defaults[kind] applies (ruleId "default").
4. The explanation is the rule's "say" with {feature} → its value and {seconds}/{dwellS}/{to} → the resolved action parameter.

## Shape
- meta: {id, parent, generation, author, emphasis: transfers|spacing|allocation|baseline|reference, summary}
- params: {allocation: {r1, r2, r3}, maxHoldS, trainDefaultDwellS, targetHeadwayS?: {r1?, r2?, r3?}}
- rule: {id, on, priority, when: [{f, op, v}], do: Action, say}
- defaults: {bus_at_stop: Action, bus_at_terminal: Action, train_at_station: Action}
- advisor? (Jev picks station-stop holds): {provider: "jev", enabled, askWhen: [bus_at_stop conditions], holdOptionsS: [0,20,40,60], instructions}

## Actions
- {"type":"continue"}: bus_at_stop, leave now.
- {"type":"dispatch"}: bus_at_terminal, start the next loop now.
- {"type":"hold","seconds":N}: bus_at_stop 5..params.maxHoldS; bus_at_terminal 10..120. Stop holds also share a 180 s budget per loop.
- {"type":"hold","until":"target_headway"}: stop or terminal; holds target_headway_s - headway_ahead_s (clamped).
- {"type":"reassign","to":"r1"|"r2"|"r3"|"busiest"}: bus_at_terminal; deadheads to that route's terminal (r1/r2 share Central, r3 starts at Stadium Gate). Not applicable to its own route or if its route would drop below 1 bus. busiest = the other route with the largest queue.
- {"type":"setTrainDeparture","dwellS":N}: train_at_station, depart 30..120 s after arrival.
Routes: r1 Campus Loop, r2 Apartments, r3 Stadium. 6 buses, 1 train.

## Features (f, range of v)
### bus_at_stop
${featureLines('bus_at_stop')}
### bus_at_terminal
${featureLines('bus_at_terminal')}
### train_at_station
${featureLines('train_at_station')}

## Validation (else rejected)
- at most ${MAX_RULES} rules, at most ${MAX_CONDITIONS} conditions per rule; ids match ^[a-z0-9-]{3,32}$, unique.
- f from the list for the rule's "on"; v inside that feature's range; op one of ${OPS.join(' ')}.
- actions legal for the kind and inside bounds; seconds and dwellS are whole numbers.
- allocation: whole numbers >= 1 summing to ${FLEET}; maxHoldS 0..${MAX_HOLD_S}; trainDefaultDwellS 30..120; targetHeadwayS 60..1800.
- say at most ${MAX_SAY} chars using only that kind's placeholders ({seconds} needs hold, {to} reassign, {dwellS} setTrainDeparture).
- meta.summary at most ${MAX_SUMMARY} chars; advisor.instructions at most ${MAX_INSTRUCTIONS} chars.

## Example
rule: {"id":"hold-for-connection","on":"bus_at_stop","priority":20,
 "when":[{"f":"train_eta_s","op":"<=","v":45},{"f":"expected_transfers","op":">=","v":8},{"f":"headway_behind_s","op":">=","v":180}],
 "do":{"type":"hold","seconds":45},"say":"Holding {seconds}s for the train ({train_eta_s}s away, {expected_transfers} transfers)"}
defaults: {"bus_at_stop":{"type":"continue"},"bus_at_terminal":{"type":"dispatch"},"train_at_station":{"type":"setTrainDeparture","dwellS":45}}
`;
