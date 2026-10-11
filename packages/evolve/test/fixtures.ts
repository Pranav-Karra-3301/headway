// Shared fixtures for evolve tests: policies, metrics, run results, a memory store and fakes.
import type {
  ControllerRef, EvolveEvent, FailureFinding, Generation, Metrics, Policy, Proposal, Round, RunResult,
  SplitScore, StopId, StopStats,
} from '@headway/sim';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/llm';
import type { EvolveStore, RoundDeps } from '../src/round';

export function metrics(p: Partial<Metrics> = {}): Metrics {
  return {
    J: 100_000, spawned: 1500, completed: 1400, unfinished: 100, completionPct: 93.3,
    meanJourneyS: 840, meanWaitS: 240, p95WaitS: 700, maxWaitS: 1100,
    transfersMade: 120, missedConnections: 40, leftBehind: 20, walkaways: 5,
    effort: { busDistanceU: 5000, deadheadDistanceU: 0, holdS: 600, trainDwellS: 900 },
    ...p,
  };
}

export function score(J: number, p: Partial<Metrics> = {}, runs = 8): SplitScore {
  return { J, metrics: metrics({ J, ...p }), runs };
}

const CONTROLLER: ControllerRef = { kind: 'policy', policyId: 'g0' };

export function stopStats(id: StopId, maxGap: number, maxQueue = 30): StopStats {
  return { id, maxQueue, meanWaitS: 200, maxGapS: { r2: maxGap } };
}

export function runResult(p: Partial<RunResult> = {}): RunResult {
  return {
    simVersion: '1', mapVersion: '1', scenarioId: 'stadium_exit', seed: 1001, controller: CONTROLLER,
    metrics: metrics(), stops: [stopStats('stop_apts_south', 600)], findings: [], ruleFires: {}, hash: 'abc',
    ...p,
  };
}

// ---- findings (narrowed so tests can spread and override fields) ----
type F<K extends FailureFinding['kind']> = Extract<FailureFinding, { kind: K }>;
export function gap(impactS: number, gapS = 840, text = 'Apartments South went 14 min without a Route 2 bus (21:52–22:06).'): F<'service_gap'> {
  return { kind: 'service_gap', impactS, text, stopId: 'stop_apts_south', routeId: 'r2', gapS, fromT: 1320, toT: 2160, affected: 40 };
}
export function missed(impactS: number, count = 38, text = '38 riders reached Central from the train just after Route 2 left.'): F<'missed_transfer'> {
  return { kind: 'missed_transfer', impactS, text, at: { kind: 'stop', id: 'stop_central_stn' }, from: 'train', to: 'r2', count, window: [600, 900] };
}
export function bunching(impactS: number, events = 4, text = 'Route 1 buses bunched 4× (as close as 40 s).'): F<'bunching'> {
  return { kind: 'bunching', impactS, text, routeId: 'r1', stopId: 'stop_downtown', events, minHeadwayS: 40 };
}
export function overload(impactS: number, leftBehind = 23, text = '23 people were left behind at Stadium Gate; the queue peaked at 140.'): F<'overload'> {
  return { kind: 'overload', impactS, text, at: { kind: 'stop', id: 'stop_stadium_gate' }, routeId: 'r3', leftBehind, peakQueue: 140 };
}

// ---- policies (spec §6 example; meta is stamped by the runner) ----
export const POLICY: Policy = {
  meta: { id: 'g0', parent: null, generation: 0, author: 'test', emphasis: 'baseline',
    summary: 'Hold at Central for an arriving train only with 8+ transfers and the next bus 3+ min away.' },
  params: { allocation: { r1: 2, r2: 2, r3: 2 }, maxHoldS: 60, trainDefaultDwellS: 45 },
  rules: [
    { id: 'prestage-stadium', on: 'bus_at_terminal', priority: 30,
      when: [{ f: 'event_in_s', op: '<=', v: 300 }, { f: 'event_in_s', op: '>=', v: -600 },
        { f: 'buses_on_route', op: '>=', v: 2 }, { f: 'route_queue', op: '<', v: 25 }],
      do: { type: 'reassign', to: 'r3' },
      say: 'Moving to Stadium: closing in {event_in_s}s, only {route_queue} waiting here' },
    { id: 'hold-for-connection', on: 'bus_at_stop', priority: 20,
      when: [{ f: 'train_eta_s', op: '<=', v: 45 }, { f: 'expected_transfers', op: '>=', v: 8 },
        { f: 'onboard', op: '<=', v: 25 }, { f: 'headway_behind_s', op: '>=', v: 180 }],
      do: { type: 'hold', seconds: 45 },
      say: 'Holding {seconds}s for the train ({train_eta_s}s away, {expected_transfers} transfers)' },
    { id: 'anti-bunch', on: 'bus_at_stop', priority: 10,
      when: [{ f: 'headway_ratio', op: '<', v: 0.5 }, { f: 'downstream_queue', op: '<', v: 40 }],
      do: { type: 'hold', until: 'target_headway' },
      say: 'Spacing out: only {headway_ahead_s}s behind the bus ahead' },
    { id: 'even-headway', on: 'bus_at_terminal', priority: 10,
      when: [{ f: 'headway_ratio', op: '<', v: 1 }],
      do: { type: 'hold', until: 'target_headway' },
      say: 'Waiting {seconds}s at the terminal to keep a {target_headway_s}s headway' },
    { id: 'train-meets-bus', on: 'train_at_station', priority: 10,
      when: [{ f: 'next_bus_eta_s', op: '<=', v: 40 }, { f: 'platform_queue', op: '<', v: 30 }],
      do: { type: 'setTrainDeparture', dwellS: 75 },
      say: 'Train waits {dwellS}s: a bus arrives in {next_bus_eta_s}s' },
  ],
  defaults: { bus_at_stop: { type: 'continue' }, bus_at_terminal: { type: 'dispatch' },
    train_at_station: { type: 'setTrainDeparture', dwellS: 45 } },
};

/** A valid variant: changes one threshold of the transfer-hold rule. */
export function variant(transfers: number): Policy {
  const p = structuredClone(POLICY);
  const rule = p.rules[1]!;
  rule.when = rule.when.map((c) => (c.f === 'expected_transfers' ? { ...c, v: transfers } : c));
  return p;
}

/** An invalid variant: unknown feature for bus_at_stop. */
export function broken(): Policy {
  const p = structuredClone(POLICY);
  p.rules[1]!.when[0] = { f: 'train_eta', op: '<=', v: 45 };
  return p;
}

/** An LLM-style reply: prose, a fenced JSON block, trailing prose. */
export function reply(policy: unknown, summary = 'Tighter transfer holds at Central'): string {
  const body = JSON.stringify({ summary, rationale: 'Missed connections dominate the findings.', changes: ['raise transfer threshold'], policy }, null, 2);
  return `Here is my proposal.\n\`\`\`json\n${body}\n\`\`\`\nLet me know if you need anything else.`;
}

export function generation(id: string, number: number, policy: Policy, train = score(1000), val = score(500, {}, 4)): Generation {
  return { id, number, parentId: number === 0 ? null : `g${number - 1}`, policy: { ...policy, meta: { ...policy.meta, id } },
    fromProposal: null, explanation: 'baseline', train, val, findings: [], createdAt: '2026-10-11T00:00:00Z' };
}

// ---- memory store ----
export class MemoryStore implements EvolveStore {
  generations: Generation[];
  rounds: Round[] = [];        // every saveRound call, deep-copied, in order
  constructor(champion: Generation, public next = 1, public past: Proposal[] = []) { this.generations = [champion]; }
  async champion(): Promise<Generation> { return this.generations[this.generations.length - 1]!; }
  async history(limit: number): Promise<Proposal[]> { return this.past.slice(-limit); }
  async nextRoundNumber(): Promise<number> { return this.next; }
  async saveRound(r: Round): Promise<void> { this.rounds.push(structuredClone(r)); }
  async saveGeneration(g: Generation): Promise<void> { this.generations.push(structuredClone(g)); }
}

// ---- fake LLM: routes by temperature → designer index; scripted replies per designer ----
export type Scripted = string | Error;
export function fakeLlm(script: Scripted[][], temps: number[] = [0.4, 0.7, 1.0]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const used = script.map(() => 0);
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);
      const d = temps.indexOf(req.temperature ?? -1);
      if (d < 0) throw new Error(`unexpected temperature ${req.temperature}`);
      const next = script[d]![used[d]!++];
      if (next === undefined) throw new Error(`designer ${d} has no more scripted replies`);
      if (next instanceof Error) throw next;
      return { text: next, latencyMs: 3, model: req.model, provider: 'fake' };
    },
  };
}

// ---- fake evaluate: keyed by policy.meta.id ----
export interface EvalRow { train: number; val: number; completion?: number; worstGapS?: number; findings?: FailureFinding[] }
export function fakeEvaluate(table: Record<string, EvalRow>) {
  const calls: Array<{ id: string; split: 'train' | 'val' }> = [];
  const evaluate: RoundDeps['evaluate'] = async (policy, split) => {
    const id = (policy as Partial<Policy> | undefined)?.meta?.id ?? 'unknown';
    calls.push({ id, split });
    const row = table[id] ?? table.default;
    if (!row) throw new Error(`no eval row for ${id}`);
    const runs = split === 'train' ? 8 : 4;
    const J = split === 'train' ? row.train : row.val;
    const m = { completionPct: row.completion ?? 93 };
    const results = Array.from({ length: runs }, (_, i) =>
      runResult({ seed: (split === 'train' ? 1001 : 2001) + (i % 4), scenarioId: i < runs / 2 ? 'stadium_exit' : 'class_change',
        metrics: metrics({ J: J / runs, ...m }), stops: [stopStats('stop_apts_south', row.worstGapS ?? 600)],
        findings: i === 0 ? (row.findings ?? []) : [], ruleFires: { 'even-headway': 3, default: 40 } }));
    return { score: score(J, m, runs), results };
  };
  return { calls, evaluate };
}

export function collect(): { events: EvolveEvent[]; emit: (e: EvolveEvent) => void } {
  const events: EvolveEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}
