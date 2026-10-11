// Fakes for /api/evolve: a scripted designer LLM and a table-driven evaluate (no real sims, no network).
import type { LlmClient, LlmRequest, LlmResponse } from '@headway/evolve';
import { G0 } from '@headway/sim';
import type { FailureFinding, Policy, RunResult, StopId } from '@headway/sim';
import type { Evaluate } from '../src/env';
import { GAP, metrics } from './helpers';

/** Designer i in a round runs at temperature [0.4, 0.7, 1.0][i] (spec §8.2): route scripted replies by temperature. */
const TEMPS = [0.4, 0.7, 1.0];

export type Scripted = string | Error;

export function fakeLlm(script: Scripted[][]): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const used = script.map(() => 0);
  return {
    calls,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      calls.push(req);
      const d = TEMPS.indexOf(req.temperature ?? -1);
      if (d < 0) throw new Error(`unexpected temperature ${req.temperature}`);
      const next = script[d]?.[used[d]++];
      if (next === undefined) throw new Error(`designer ${d} has no more scripted replies`);
      if (next instanceof Error) throw next;
      return { text: next, latencyMs: 2, model: req.model, provider: 'fake' };
    },
  };
}

/** An LLM-style designer reply: prose around a fenced JSON block. */
export function reply(policy: unknown, summary: string): string {
  const body = JSON.stringify({ summary, rationale: 'Missed connections dominate the findings.', changes: ['one focused change'], policy }, null, 2);
  return `Here is my proposal.\n\`\`\`json\n${body}\n\`\`\`\nThanks.`;
}

/** DSL-valid variants of G0 (each differs from the champion body). */
export function variant(kind: 'dwell' | 'alloc' | 'hold'): Policy {
  const p = structuredClone(G0);
  if (kind === 'dwell') {
    p.params.trainDefaultDwellS = 60;
    p.defaults.train_at_station = { type: 'setTrainDeparture', dwellS: 60 };
  } else if (kind === 'alloc') {
    p.params.allocation = { r1: 2, r2: 3, r3: 1 };
  } else {
    p.params.maxHoldS = 45;
  }
  return p;
}

export function runResult(o: { J: number; seed: number; scenarioId: string; gapS?: number; completionPct?: number; findings?: FailureFinding[] }): RunResult {
  const stop = (id: StopId) => ({ id, maxQueue: 24, meanWaitS: 140, maxGapS: { r2: o.gapS ?? 600 } });
  return {
    simVersion: '1', mapVersion: '1', scenarioId: o.scenarioId, seed: o.seed, controller: { kind: 'policy', policyId: 'x' },
    metrics: { ...metrics(o.J), completionPct: o.completionPct ?? 93 },
    stops: [stop('stop_apts_south'), stop('stop_central_stn')], findings: o.findings ?? [], ruleFires: { 'even-headway': 4, default: 30 }, hash: 'deadbeef',
  };
}

export interface EvalRow { train: number; val: number; completionPct?: number; gapS?: number }

/** Scores by `policy.meta.id` (`default` row for unknown ids). Train = 8 runs, val = 4 runs; J split evenly. */
export function fakeEvaluate(table: Record<string, EvalRow>): { calls: Array<{ id: string; split: 'train' | 'val' }>; evaluate: Evaluate } {
  const calls: Array<{ id: string; split: 'train' | 'val' }> = [];
  const evaluate: Evaluate = async (policy, split) => {
    const id = policy.meta.id;
    calls.push({ id, split });
    const row = table[id] ?? table.default;
    if (!row) throw new Error(`no eval row for ${id}`);
    const runs = split === 'train' ? 8 : 4;
    const J = split === 'train' ? row.train : row.val;
    const results = Array.from({ length: runs }, (_, i) =>
      runResult({
        J: J / runs, seed: (split === 'train' ? 1001 : 2001) + (i % (runs / 2)), scenarioId: i < runs / 2 ? 'stadium_exit' : 'class_change',
        gapS: row.gapS, completionPct: row.completionPct, findings: i === 0 ? [GAP] : [],
      }));
    const m = { ...metrics(J), completionPct: row.completionPct ?? 93 };
    return { score: { J, metrics: m, runs }, results };
  };
  return { calls, evaluate };
}
