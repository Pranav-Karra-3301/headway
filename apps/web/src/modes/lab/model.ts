// Owner: T3d. Pure Lab view-model: timeline of rounds/generations, proposal outcomes, J chart data (spec §7, §10).
import type { Generation, Proposal, Round, SplitScore } from '@headway/sim';

export type Designer = 0 | 1 | 2;
export const DESIGNER_LETTER = ['A', 'B', 'C'] as const;

/** `r5-b` → 1. */
export function designerOfProposalId(id: string): Designer | null {
  const m = /^r\d+-([abc])$/.exec(id);
  return m ? (('abc'.indexOf(m[1]!)) as Designer) : null;
}

function roundNumberOfProposalId(id: string): number | null {
  const m = /^r(\d+)-[abc]$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** The round whose proposal became `gen` (null for g0 or when unknown). */
export function roundForGeneration(gen: Generation, rounds: Round[]): Round | null {
  if (gen.fromProposal) {
    const byProposal = rounds.find((r) => r.proposals.some((p) => p.id === gen.fromProposal));
    if (byProposal) return byProposal;
    const n = roundNumberOfProposalId(gen.fromProposal);
    const byNumber = n === null ? undefined : rounds.find((r) => r.number === n);
    if (byNumber) return byNumber;
  }
  return rounds.find((r) => r.championAfter === gen.id && r.championBefore !== gen.id) ?? null;
}

export type RoundOutcome = 'promoted' | 'rejected' | 'failed' | 'running';
export function roundOutcome(r: Round): RoundOutcome {
  if (r.status === 'running') return 'running';
  if (r.status === 'failed') return 'failed';
  return r.championAfter && r.championAfter !== r.championBefore ? 'promoted' : 'rejected';
}

export type TimelineItem =
  | { kind: 'gen'; gen: Generation }
  | { kind: 'round'; round: Round; outcome: RoundOutcome; generationId: string | null };

const byNumber = <T extends { number: number }>(xs: T[]) => [...xs].sort((a, b) => a.number - b.number);

/** g0, then each round followed by the generation it produced; trailing rejected/failed/running rounds at the end. */
export function buildTimeline(generations: Generation[], rounds: Round[]): TimelineItem[] {
  const gens = byNumber(generations);
  const rs = byNumber(rounds);
  const items: TimelineItem[] = [];
  const pushRound = (r: Round) => {
    const outcome = roundOutcome(r);
    items.push({ kind: 'round', round: r, outcome, generationId: outcome === 'promoted' ? r.championAfter : null });
  };
  let ri = 0;
  for (const g of gens) {
    const producer = g.number > 0 ? roundForGeneration(g, rs) : null;
    if (producer) while (ri < rs.length && rs[ri]!.number <= producer.number) pushRound(rs[ri++]!);
    items.push({ kind: 'gen', gen: g });
  }
  while (ri < rs.length) pushRound(rs[ri++]!);
  return items;
}

export type Outcome =
  | { kind: 'promoted'; label: string; generationId: string }
  | { kind: 'invalid' | 'rejected' | 'pending'; label: string };

const SHORT: Record<string, string> = {
  'Not the best this round': 'Runner-up',
  'Validation worse': 'Val worse',
  'Gain under 1%': 'Under 1%',
  'Worse on training': 'Worse',
  'Failed a promotion guard': 'Guard failed',
  'Not evaluated': 'Not scored',
  'Waiting for validation…': 'Validating…',
};

/** Badge text: "Promoted → g4", "Runner-up", "Val worse", "Invalid", … (the full label goes in the tooltip). */
export function shortOutcome(o: Outcome): string {
  if (o.kind === 'invalid') return 'Invalid';
  return SHORT[o.label] ?? o.label;
}

/** Why a proposal did or did not become the next generation (spec §7 promotion rule). */
export function proposalOutcome(p: Proposal, round: Round, generations: Generation[]): Outcome {
  if (!p.valid) return { kind: 'invalid', label: `Invalid · ${p.errors.length} error${p.errors.length === 1 ? '' : 's'}` };
  const made = generations.find((g) => g.fromProposal === p.id);
  if (made) return { kind: 'promoted', label: `Promoted → ${made.id}`, generationId: made.id };
  if (p.deltaTrainPct === null || p.deltaTrainPct === undefined) {
    return round.status === 'running' ? { kind: 'pending', label: 'Evaluating…' } : { kind: 'rejected', label: 'Not evaluated' };
  }
  if (p.deltaTrainPct > 0) return { kind: 'rejected', label: 'Worse on training' };
  if (p.deltaTrainPct > -1) return { kind: 'rejected', label: 'Gain under 1%' };
  if (p.val) {
    const champ = generations.find((g) => g.id === round.championBefore);
    if (champ && p.val.J > champ.val.J) return { kind: 'rejected', label: 'Validation worse' };
    return { kind: 'rejected', label: 'Failed a promotion guard' };
  }
  if (round.status === 'running') return { kind: 'pending', label: 'Waiting for validation…' };
  return { kind: 'rejected', label: 'Not the best this round' };
}

/** Signed % change of `j` vs `base` (0 when base is missing). */
export function pctVs(j: number, base: number): number {
  return base > 0 ? (j / base - 1) * 100 : 0;
}

const NICE = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];

/** Evenly spaced round ticks covering [lo, hi] (3–8 of them), always including 0 when it lies inside. */
export function niceTicks(lo: number, hi: number): number[] {
  if (!(hi > lo)) { lo -= 5; hi += 5; }
  const span = hi - lo;
  const step = NICE.find((s) => span / s <= 6) ?? NICE[NICE.length - 1]!;
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = a; v <= b + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6 + 0);
  if (out.length < 3) out.push(out[out.length - 1]! + step);
  return out;
}

export interface ChartStep {
  step: number; label: string; genId: string; roundId: string | null;
  train: number; val: number | null; promoted: boolean; running?: boolean;
  trainJ: number; valJ: number | null;
}
export interface ChartCandidate {
  step: number; proposalId: string; designer: Designer | null; pct: number;
  promoted: boolean; clipped: boolean;
}
export interface ChartData {
  steps: ChartStep[]; candidates: ChartCandidate[];
  /** ref's J_train vs g0 (%), when known. */
  ref: number | null;
  domain: [number, number]; ticks: number[];
}
export interface ChartInput {
  generations: Generation[]; rounds: Round[];
  reference?: SplitScore | null; baseline?: SplitScore | null;
  /** Scored proposals of a round that is still streaming (from the evolve feed). */
  live?: { round: number; scored: Array<{ proposalId: string; deltaTrainPct: number }> } | null;
}

/** Candidates worse than this many points above the champion line are drawn clipped at the edge. */
const CANDIDATE_HEADROOM = 8;

export function chartData(input: ChartInput): ChartData {
  const gens = byNumber(input.generations);
  const g0 = gens[0];
  const baseTrain = g0?.train.J ?? input.baseline?.J ?? 0;
  const baseVal = g0?.val.J ?? 0;
  const empty: ChartData = { steps: [], candidates: [], ref: null, domain: [-10, 0], ticks: niceTicks(-10, 0) };
  if (!g0 || !(baseTrain > 0)) return empty;

  const steps: ChartStep[] = [];
  const raw: Array<Omit<ChartCandidate, 'clipped'>> = [];
  const stepOf = (g: Generation, label: string, roundId: string | null, promoted: boolean, running = false): ChartStep => ({
    step: steps.length, label, genId: g.id, roundId, promoted, running: running || undefined,
    train: pctVs(g.train.J, baseTrain), val: baseVal > 0 ? pctVs(g.val.J, baseVal) : null, trainJ: g.train.J, valJ: g.val.J,
  });

  let champ: Generation = g0;
  for (const item of buildTimeline(gens, input.rounds)) {
    if (item.kind === 'gen') {
      champ = item.gen;
      const last = steps[steps.length - 1];
      if (last && last.genId === item.gen.id) continue; // already drawn by the round that produced it
      steps.push(stepOf(item.gen, item.gen.id, null, true));
      continue;
    }
    const r = item.round;
    const before = gens.find((g) => g.id === r.championBefore) ?? champ;
    const after = item.outcome === 'promoted' ? gens.find((g) => g.id === r.championAfter) : undefined;
    const st = after ? stepOf(after, after.id, r.id, true) : stepOf(before, `R${r.number}`, r.id, false, item.outcome === 'running');
    steps.push(st);
    const beforePct = pctVs(before.train.J, baseTrain);
    for (const p of r.proposals) {
      if (!p.valid) continue;
      const pct = p.train ? pctVs(p.train.J, baseTrain)
        : p.deltaTrainPct != null ? ((1 + beforePct / 100) * (1 + p.deltaTrainPct / 100) - 1) * 100 : null;
      if (pct === null) continue;
      raw.push({ step: st.step, proposalId: p.id, designer: designerOfProposalId(p.id), pct, promoted: after?.fromProposal === p.id });
    }
  }

  const live = input.live;
  if (live && !input.rounds.some((r) => r.number === live.round && r.status !== 'running')) {
    let st = steps.find((s) => s.roundId === `R${live.round}`);
    if (!st) { st = stepOf(champ, `R${live.round}`, `R${live.round}`, false, true); steps.push(st); }
    const beforePct = st.train;
    for (const s of live.scored) {
      if (raw.some((c) => c.proposalId === s.proposalId)) continue;
      raw.push({
        step: st.step, proposalId: s.proposalId, designer: designerOfProposalId(s.proposalId),
        pct: ((1 + beforePct / 100) * (1 + s.deltaTrainPct / 100) - 1) * 100, promoted: false,
      });
    }
  }

  const ref = input.reference && input.reference.J > 0 ? pctVs(input.reference.J, baseTrain) : null;
  const lineVals = [0, ...steps.map((s) => s.train), ...steps.flatMap((s) => (s.val === null ? [] : [s.val])), ...(ref === null ? [] : [ref])];
  const cap = Math.max(...lineVals) + CANDIDATE_HEADROOM;
  const candidates = raw.map((c) => ({ ...c, clipped: c.pct > cap, pct: c.pct }));
  const vals = [...lineVals, ...candidates.map((c) => Math.min(c.pct, cap))];
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  return { steps, candidates, ref, domain: [ticks[0]!, ticks[ticks.length - 1]!], ticks };
}
