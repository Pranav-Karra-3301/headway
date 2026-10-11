// Small builders for Lab tests (independent of the shared fixtures, so tests stay stable while fixtures evolve).
import { G0 } from '@headway/sim';
import type { Emphasis, Generation, Metrics, Policy, Proposal, Round, SplitScore } from '@headway/sim';

export function metrics(J: number, over: Partial<Metrics> = {}): Metrics {
  return {
    J, spawned: 12000, completed: 11500, unfinished: 500, completionPct: 95.8,
    meanJourneyS: 1260, meanWaitS: 240, p95WaitS: 780, maxWaitS: 1500,
    transfersMade: 900, missedConnections: 120, leftBehind: 80, walkaways: 40,
    effort: { busDistanceU: 52000, deadheadDistanceU: 600, holdS: 2400, trainDwellS: 3600 },
    ...over,
  };
}

export function score(J: number, runs = 8, over: Partial<Metrics> = {}): SplitScore {
  return { J, runs, metrics: metrics(J, over) };
}

export function policy(id: string, parent: string | null, generation: number, emphasis: Policy['meta']['emphasis'] = 'transfers'): Policy {
  const p = structuredClone(G0);
  p.meta = { ...p.meta, id, parent, generation, emphasis, author: generation === 0 ? 'human' : 'deepseek-v4.1-flash@luminal', summary: `${id} summary` };
  return p;
}

export function gen(n: number, trainJ: number, valJ: number, fromProposal: string | null = null): Generation {
  const id = `g${n}`;
  return {
    id, number: n, parentId: n === 0 ? null : `g${n - 1}`, policy: policy(id, n === 0 ? null : `g${n - 1}`, n),
    fromProposal, explanation: `${id} explanation`, train: score(trainJ), val: score(valJ, 4), findings: [],
    createdAt: `2026-10-11T15:0${n}:00Z`,
  };
}

const LETTERS = ['a', 'b', 'c'] as const;
const EMPHASES: Emphasis[] = ['transfers', 'spacing', 'allocation'];

export function proposal(round: number, designer: 0 | 1 | 2, o: { trainJ?: number | null; valJ?: number | null; delta?: number | null; valid?: boolean; errors?: string[] } = {}): Proposal {
  const valid = o.valid ?? true;
  const id = `r${round}-${LETTERS[designer]}`;
  return {
    id, roundId: `R${round}`, designer, model: 'deepseek-ai/DeepSeek-V4.1-Flash', emphasis: EMPHASES[designer]!,
    summary: `${id} summary`, rationale: `${id} rationale`, policy: valid ? policy(id, null, round, EMPHASES[designer]) : null,
    valid, errors: o.errors ?? (valid ? [] : ['rules[0].when[0].f: unknown feature "x" for bus_at_stop']),
    train: valid && o.trainJ != null ? score(o.trainJ) : null,
    val: valid && o.valJ != null ? score(o.valJ, 4) : null,
    deltaTrainPct: valid ? (o.delta ?? null) : null,
    findings: [], narrative: `${id} narrative`,
  };
}

export function round(n: number, before: string, after: string, proposals: Proposal[], status: Round['status'] = 'done'): Round {
  return {
    id: `R${n}`, number: n, championBefore: before, championAfter: after, status, proposals,
    startedAt: `2026-10-11T15:${10 + n}:00Z`, finishedAt: status === 'running' ? null : `2026-10-11T15:${11 + n}:00Z`,
  };
}

/** g0 → R1 promotes r1-b as g1 → R2 rejected (validation worse) → R3 promotes r3-a as g2. */
export function history(): { generations: Generation[]; rounds: Round[] } {
  const g0 = gen(0, 4_000_000, 2_000_000);
  const g1 = gen(1, 3_800_000, 1_920_000, 'r1-b');
  const g2 = gen(2, 3_600_000, 1_850_000, 'r3-a');
  const r1 = round(1, 'g0', 'g1', [
    proposal(1, 0, { trainJ: 3_960_000, delta: -1.0 }),
    proposal(1, 1, { trainJ: 3_800_000, valJ: 1_920_000, delta: -5.0 }),
    proposal(1, 2, { valid: false }),
  ]);
  const r2 = round(2, 'g1', 'g1', [
    proposal(2, 0, { trainJ: 3_700_000, valJ: 1_990_000, delta: -2.63 }),
    proposal(2, 1, { trainJ: 3_790_000, delta: -0.26 }),
    proposal(2, 2, { trainJ: 4_180_000, delta: 10.0 }),
  ]);
  const r3 = round(3, 'g1', 'g2', [
    proposal(3, 0, { trainJ: 3_600_000, valJ: 1_850_000, delta: -5.26 }),
    proposal(3, 1, { valid: false }),
    proposal(3, 2, { trainJ: 3_820_000, delta: 0.53 }),
  ]);
  return { generations: [g0, g1, g2], rounds: [r1, r2, r3] };
}
