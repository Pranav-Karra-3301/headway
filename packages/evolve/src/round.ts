// Owner: T4. One evolution round (spec §8.1): champion evidence → 3 designers in parallel (one repair each) →
// train scoring → promotion gates (spec §7, at most two validation attempts) → narratives, records, events.
// Pure orchestration over injected deps (LLM, store, evaluate, clock), so it runs in Node and in the Worker.
import { G0, REF, validatePolicy } from '@headway/sim';
import type { Emphasis, EvolveEvent, FailureFinding, Generation, Policy, Proposal, Round, RunResult, SplitScore } from '@headway/sim';
import { topFindings, worstGap } from './aggregate';
import { buildDigest, signedPct } from './digest';
import { policyBody, runProbes, type ProbeResult } from './evaluate';
import { extractJson } from './extract';
import type { LlmClient, LlmRequest } from './llm';
import { proposalNarrative } from './narrative';
import { designerSystemPrompt, designerUserPrompt, repairPrompt } from './prompts';

export interface EvolveStore {
  champion(): Promise<Generation>;
  history(limit: number): Promise<Proposal[]>;
  nextRoundNumber(): Promise<number>;
  saveRound(r: Round): Promise<void>;
  saveGeneration(g: Generation): Promise<void>;
}
export interface RoundDeps {
  llm: LlmClient; model: string; store: EvolveStore; emit(e: EvolveEvent): void; now(): string;
  evaluate(policy: Policy, split: 'train' | 'val'): Promise<{ score: SplitScore; results: RunResult[] }>;
  temperatures?: [number, number, number];
}

// ---------- settings (spec §7, §8.2) ----------
const EMPHASES: readonly Emphasis[] = ['transfers', 'spacing', 'allocation'];
const TEMPERATURES: [number, number, number] = [0.4, 0.7, 1.0];
const LETTERS = ['a', 'b', 'c'] as const;
const DESIGNERS = [0, 1, 2] as const;
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 90_000;
const HISTORY_PROPOSALS = 12;      // the last 4 rounds × 3 designers
const MIN_GAIN_PCT = 1;            // J_train at least 1% better (tunable)
const MAX_COMPLETION_DROP = 1;     // percentage points
const GAP_FLOOR_S = 900;           // worst gap ≤ max(champion's worst, 900 s)
const VAL_ATTEMPTS = 2;            // the best, then the second-best
const EPS = 1e-9;
const MAX_SUMMARY = 200;
const MAX_RATIONALE = 1200;
const MAX_ECHO = 12_000;           // previous reply shown back in the repair request

type Designer = (typeof DESIGNERS)[number];
type Evaluated = { score: SplitScore; results: RunResult[] };
export type DesignerReply = { ok: true; policy: Policy; summary: string; rationale: string } | { ok: false; errors: string[]; summary: string };
type Parsed = DesignerReply;

interface Draft {
  designer: Designer; id: string; emphasis: Emphasis; model: string;
  summary: string; rationale: string; policy: Policy | null; errors: string[];
  train: SplitScore | null; results: RunResult[]; delta: number | null; findings: FailureFinding[];
  scored: string;                  // the scoring narrative ("ΔJ −5.0% on training. …")
  verdict: string;                 // "Promoted to g1." / "Rejected: …" / "Not promoted: …"
  val: SplitScore | null;
}

interface Ctx {
  deps: RoundDeps; n: number; champion: Generation; emit: (e: EvolveEvent) => void;
  system: string; digest: string; temps: [number, number, number]; championBody: string;
}

// ---------- helpers ----------
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const noDot = (s: string): string => s.replace(/[.\s]+$/, '');
const emphasisFor = (designer: number, round: number): Emphasis => EMPHASES[(designer + round) % EMPHASES.length]!;

function pctChange(value: number, base: number): number {
  return base > 0 ? Math.round((10_000 * (value - base)) / base) / 100 : 0;
}

/** Extract, stamp and validate one designer reply (spec §8.3). Meta is always stamped by the runner. */
function parseReply(text: string, meta: Omit<Policy['meta'], 'summary'>, championBody: string): Parsed {
  const json = extractJson(text);
  if (!isRecord(json)) {
    return { ok: false, summary: '', errors: ['reply contained no JSON object: answer with one JSON object {"summary", "rationale", "changes", "policy"}'] };
  }
  let raw: unknown = json.policy;
  if (typeof raw === 'string') raw = extractJson(raw);
  if (raw === undefined && ('rules' in json || 'params' in json)) raw = json; // a bare policy object
  const rawMeta = isRecord(raw) && isRecord(raw.meta) ? raw.meta : {};
  const summary = clip(str(json.summary) || str(rawMeta.summary), MAX_SUMMARY);
  if (!isRecord(raw)) {
    return { ok: false, summary, errors: ['"policy" is missing or not an object: put the COMPLETE policy under "policy"'] };
  }
  const v = validatePolicy({ ...raw, meta: { ...meta, summary } });
  if (!v.ok) return { ok: false, summary, errors: v.errors };
  if (policyBody(v.policy) === championBody) {
    return { ok: false, summary, errors: ['the policy is identical to the champion: make 1 to 3 focused changes'] };
  }
  const changes = Array.isArray(json.changes) ? json.changes.map(str).filter(Boolean).slice(0, 5).map(noDot) : [];
  const rationale = clip([str(json.rationale), changes.length ? `Changes: ${changes.join('; ')}.` : ''].filter(Boolean).join(' '), MAX_RATIONALE);
  return { ok: true, policy: v.policy, summary, rationale };
}

/** Extract, stamp and validate one designer reply exactly as `runRound` does (spec §8.3). Used by the CLI smoke check. */
export function parseDesignerReply(text: string, a: { meta: Omit<Policy['meta'], 'summary'>; champion: Policy }): DesignerReply {
  return parseReply(text, a.meta, policyBody(a.champion));
}

function newDraft(designer: Designer, n: number, model: string): Draft {
  return {
    designer, id: `r${n}-${LETTERS[designer]}`, emphasis: emphasisFor(designer, n), model,
    summary: '', rationale: '', policy: null, errors: [],
    train: null, results: [], delta: null, findings: [], scored: '', verdict: '', val: null,
  };
}

/** One designer: a call, extraction + validation, and at most one repair. Never throws. */
async function design(ctx: Ctx, i: Designer): Promise<Draft> {
  const { deps, n, champion } = ctx;
  const d = newDraft(i, n, deps.model);
  const event = (status: 'received' | 'repaired' | 'invalid', extra: { summary?: string; errors?: string[] }) =>
    ctx.emit({ type: 'proposal', designer: i, model: d.model, emphasis: d.emphasis, status, ...extra });
  const fail = (errors: string[], summary: string): Draft => {
    d.errors = errors;
    d.summary = summary;
    event('invalid', { errors });
    return d;
  };
  const meta = (): Omit<Policy['meta'], 'summary'> =>
    ({ id: d.id, parent: champion.id, generation: champion.number + 1, author: d.model, emphasis: d.emphasis });

  const req: LlmRequest = {
    model: deps.model, system: ctx.system, user: designerUserPrompt({ emphasis: d.emphasis, champion: champion.policy, digest: ctx.digest }),
    temperature: ctx.temps[i], maxTokens: MAX_TOKENS, json: true, timeoutMs: TIMEOUT_MS,
  };
  let text: string;
  try {
    const res = await deps.llm.complete(req);
    d.model = res.model;
    text = res.text;
  } catch (e) {
    return fail([`designer call failed: ${errText(e)}`], '');
  }
  let parsed = parseReply(text, meta(), ctx.championBody);
  event('received', { ...(parsed.summary ? { summary: parsed.summary } : {}), ...(parsed.ok ? {} : { errors: parsed.errors }) });

  if (!parsed.ok) {
    const first = parsed;
    const user = `${req.user}\n\n# Your previous reply\n${clip(text, MAX_ECHO)}\n\n# Validation errors\n${repairPrompt(first.errors)}`;
    try {
      const res = await deps.llm.complete({ ...req, user });
      d.model = res.model;
      parsed = parseReply(res.text, meta(), ctx.championBody);
    } catch (e) {
      return fail([...first.errors, `repair call failed: ${errText(e)}`], first.summary);
    }
    if (!parsed.ok) return fail(parsed.errors, parsed.summary || first.summary);
    event('repaired', parsed.summary ? { summary: parsed.summary } : {});
  }
  d.policy = parsed.policy;
  d.summary = parsed.summary;
  d.rationale = parsed.rationale;
  return d;
}

function toProposal(d: Draft, roundId: string): Proposal {
  const valid = d.policy !== null;
  return {
    id: d.id, roundId, designer: d.designer, model: d.model, emphasis: d.emphasis, summary: d.summary, rationale: d.rationale,
    policy: d.policy, valid, errors: d.errors, train: d.train, val: d.val, deltaTrainPct: d.delta, findings: d.findings,
    narrative: valid ? [d.scored, d.verdict].filter(Boolean).join(' ') : `Invalid: ${d.errors[0] ?? 'unknown error'}`,
  };
}

// ---------- the round ----------
export async function runRound(deps: RoundDeps): Promise<{ round: Round; generation: Generation | null }> {
  const emit = (e: EvolveEvent) => {
    try { deps.emit(e); } catch { /* a closed event stream must not stop the round */ }
  };
  const n = await deps.store.nextRoundNumber();
  const champion = await deps.store.champion();
  const started: Round = {
    id: `R${n}`, number: n, championBefore: champion.id, championAfter: champion.id,
    status: 'running', proposals: [], startedAt: deps.now(), finishedAt: null,
  };
  await deps.store.saveRound(started);
  emit({ type: 'round_start', round: n, champion: champion.id });

  const finish = async (drafts: Draft[], gen: Generation | null, failed: boolean, reason: string) => {
    const round: Round = {
      ...started, status: failed ? 'failed' : 'done', championAfter: gen?.id ?? champion.id,
      proposals: drafts.map((d) => toProposal(d, started.id)), finishedAt: deps.now(),
    };
    if (gen) await deps.store.saveGeneration(gen);
    await deps.store.saveRound(round);
    emit({ type: 'decision', promoted: gen?.id ?? null, reason });
    return { round, generation: gen };
  };

  // 1–2. the champion's training evidence (plus g0 and ref for the table) and the digest
  let champTrain: Evaluated;
  let baseline: SplitScore;
  let reference: SplitScore;
  try {
    champTrain = await deps.evaluate(champion.policy, 'train');
    baseline = policyBody(champion.policy) === policyBody(G0) ? champTrain.score : (await deps.evaluate(G0, 'train')).score;
    reference = (await deps.evaluate(REF, 'train')).score;
  } catch (e) {
    const message = `could not score the champion ${champion.id}, g0 and ref on training: ${errText(e)}`;
    emit({ type: 'error', message });
    return finish([], null, true, `Round failed: ${message}.`);
  }
  const history = await deps.store.history(HISTORY_PROPOSALS).catch((): Proposal[] => []);
  // sensitivity probes: one-step variants of the champion, training split only (logged as 'eval' events)
  const probes: ProbeResult[] = await runProbes(deps.evaluate, champion.policy, champTrain.score.J, (r, runs) =>
    emit({ type: 'eval', proposalId: `probe: ${r.label} → ΔJ ${signedPct(r.deltaPct)}`, split: 'train', done: runs, total: runs }),
  ).catch((): ProbeResult[] => []);
  const ctx: Ctx = {
    deps, n, champion, emit, system: designerSystemPrompt(), temps: deps.temperatures ?? TEMPERATURES,
    digest: buildDigest({ champion: { policy: champion.policy, results: champTrain.results }, baseline, reference, history, probes }),
    championBody: policyBody(champion.policy),
  };

  // 3–4. three designers in parallel, one repair attempt each
  for (const i of DESIGNERS) emit({ type: 'proposal', designer: i, model: deps.model, emphasis: emphasisFor(i, n), status: 'requested' });
  const drafts = await Promise.all(DESIGNERS.map((i) =>
    design(ctx, i).catch((e: unknown) => {
      const d = newDraft(i, n, deps.model);
      d.errors = [`designer failed: ${errText(e)}`];
      emit({ type: 'proposal', designer: i, model: d.model, emphasis: d.emphasis, status: 'invalid', errors: d.errors });
      return d;
    })));

  // 5. score the valid proposals on the training split
  const champJ = champTrain.score.J;
  for (const d of drafts) {
    if (!d.policy) continue;
    emit({ type: 'eval', proposalId: d.id, split: 'train', done: 0, total: champTrain.results.length });
    try {
      const ev = await deps.evaluate(d.policy, 'train');
      emit({ type: 'eval', proposalId: d.id, split: 'train', done: ev.results.length, total: ev.results.length });
      d.train = ev.score;
      d.results = ev.results;
      d.delta = pctChange(ev.score.J, champJ);
      d.findings = topFindings(ev.results);
      d.scored = proposalNarrative(ev.results, champTrain.results, d.delta);
      emit({ type: 'scored', proposalId: d.id, deltaTrainPct: d.delta, narrative: d.scored });
    } catch (e) {
      d.errors.push(`evaluation failed: ${errText(e)}`);
      d.verdict = `Rejected: evaluation failed (${clip(errText(e), 120)}).`;
      emit({ type: 'error', message: `${d.id}: evaluation failed: ${errText(e)}` });
    }
  }
  const scored = drafts.filter((d) => d.train !== null).sort((a, b) => a.train!.J - b.train!.J || a.designer - b.designer);
  if (!scored.length) {
    const reason = drafts.some((d) => d.policy)
      ? `No proposal could be scored; ${champion.id} stays champion.`
      : `All three designers failed; ${champion.id} stays champion.`;
    return finish(drafts, null, true, reason);
  }

  // 6–7. promotion (spec §7): training gates, then validation for the best and, if it fails, the second-best
  const champCompletion = champTrain.score.metrics.completionPct;
  const gapLimitS = Math.max(worstGap(champTrain.results)?.gapS ?? 0, GAP_FLOOR_S);
  const trainGate = (d: Draft): string | null => {
    const gainPct = champJ > 0 ? (100 * (champJ - d.train!.J)) / champJ : 0;
    if (gainPct < -EPS) return `worse on training (ΔJ ${signedPct(d.delta ?? -gainPct)})`;
    if (gainPct < MIN_GAIN_PCT - EPS) return `less than ${MIN_GAIN_PCT}% better on training`;
    const drop = champCompletion - d.train!.metrics.completionPct;
    if (drop > MAX_COMPLETION_DROP + EPS) return `completion fell ${drop.toFixed(1)} pts`;
    const g = worstGap(d.results);
    if (g && g.gapS > gapLimitS + EPS) {
      return `a stop went ${Math.round(g.gapS / 60)} min without service (${g.stopId} on ${g.routeId}; the limit is ${Math.round(gapLimitS / 60)} min)`;
    }
    return null;
  };

  const gateFailures: string[] = [];
  const passing: Draft[] = [];
  for (const d of scored) {
    const why = trainGate(d);
    if (why) {
      d.verdict = `Rejected: ${why}.`;
      gateFailures.push(`${d.id} ${why}`);
    } else passing.push(d);
  }

  const genNumber = champion.number + 1;
  const genId = `g${genNumber}`;
  let winner: Draft | null = null;
  let champVal: Evaluated | null = null;
  let valBroken = '';
  let attempts = 0;
  const valOutcomes: string[] = [];
  for (const d of passing) {
    if (winner) { d.verdict = `Not promoted: ${winner.id} was promoted.`; continue; }
    if (valBroken) { d.verdict = 'Not promoted: validation could not run.'; continue; }
    if (attempts >= VAL_ATTEMPTS) { d.verdict = 'Not promoted: only the two best proposals get a validation attempt.'; continue; }
    attempts++;
    if (!champVal) {
      try {
        champVal = await deps.evaluate(champion.policy, 'val');
      } catch (e) {
        valBroken = errText(e);
        emit({ type: 'error', message: `could not evaluate the champion ${champion.id} on validation: ${valBroken}` });
        d.verdict = 'Not promoted: validation could not run.';
        continue;
      }
    }
    emit({ type: 'eval', proposalId: d.id, split: 'val', done: 0, total: champVal.results.length });
    try {
      const ev = await deps.evaluate(d.policy!, 'val');
      emit({ type: 'eval', proposalId: d.id, split: 'val', done: ev.results.length, total: ev.results.length });
      d.val = ev.score;
      if (ev.score.J <= champVal.score.J + EPS) {
        winner = d;
        d.verdict = `Promoted to ${genId}.`;
      } else {
        d.verdict = 'Rejected: validation worse.';
        valOutcomes.push(`${d.id} was worse on validation`);
      }
    } catch (e) {
      d.errors.push(`validation failed to run: ${errText(e)}`);
      d.verdict = 'Rejected: validation failed to run.';
      valOutcomes.push(`${d.id} could not be validated`);
      emit({ type: 'error', message: `${d.id}: validation failed: ${errText(e)}` });
    }
  }

  // 8. records
  if (!winner) {
    const why = !passing.length
      ? `no proposal passed the training gates (${gateFailures.join('; ')})`
      : valBroken ? `validation could not run (${valBroken})` : valOutcomes.join('; ');
    return finish(drafts, null, false, `No promotion: ${why}; ${champion.id} stays champion.`);
  }
  const w: Draft = winner;
  const gen: Generation = {
    id: genId, number: genNumber, parentId: champion.id,
    policy: { ...w.policy!, meta: { ...w.policy!.meta, id: genId, parent: champion.id, generation: genNumber } },
    fromProposal: w.id,
    explanation: `${noDot(w.summary || 'No summary given')} (${w.id}, ${w.emphasis} designer). ${w.scored}`,
    train: w.train!, val: w.val!, findings: w.findings, createdAt: deps.now(),
  };
  return finish(drafts, gen, false, `${w.id} promoted to ${genId}: ΔJ ${signedPct(w.delta ?? 0)} on training and no worse on validation.`);
}
