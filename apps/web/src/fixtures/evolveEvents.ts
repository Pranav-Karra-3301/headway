// Owner: Task P. The EvolveEvent stream for one full round (ROUND = R5, champion g3 → g4), in emission order:
// round_start → 3 requests → replies (designer 1 falls back to OpenRouter, designer 2 stays invalid after its repair)
// → train evals 0…8 + scored per valid proposal → val evals 0…4 for the winner → decision. Treat as read-only.
import type { EvolveEvent, Proposal } from '@headway/sim';
import { PRIMARY_MODEL } from './build';
import { ROUND, ROUND_TRACE } from './generations';

const [a, b, c] = ROUND.proposals as [Proposal, Proposal, Proposal];

const requested = (p: Proposal): EvolveEvent => ({ type: 'proposal', designer: p.designer, model: PRIMARY_MODEL, emphasis: p.emphasis, status: 'requested' });
const received = (p: Proposal, errors?: string[]): EvolveEvent => ({
  type: 'proposal', designer: p.designer, model: p.model, emphasis: p.emphasis, status: 'received', summary: p.summary,
  ...(errors ? { errors } : {}),
});
const evals = (p: Proposal, split: 'train' | 'val', total: number): EvolveEvent[] =>
  Array.from({ length: total + 1 }, (_, done): EvolveEvent => ({ type: 'eval', proposalId: p.id, split, done, total }));
const scored = (p: Proposal): EvolveEvent => ({ type: 'scored', proposalId: p.id, deltaTrainPct: p.deltaTrainPct!, narrative: ROUND_TRACE.scoredNarrative[p.id]! });

export const EVOLVE_EVENTS: EvolveEvent[] = [
  { type: 'round_start', round: ROUND.number, champion: ROUND.championBefore },
  requested(a),
  requested(b),
  requested(c),
  received(a),
  received(c, ROUND_TRACE.firstAttemptErrors[c.id]),
  received(b), // slower: Luminal timed out, the OpenRouter fallback answered
  { type: 'proposal', designer: c.designer, model: c.model, emphasis: c.emphasis, status: 'invalid', summary: c.summary, errors: c.errors },
  ...evals(a, 'train', 8),
  scored(a),
  ...evals(b, 'train', 8),
  scored(b),
  ...evals(a, 'val', 4),
  { type: 'decision', promoted: ROUND.championAfter, reason: ROUND_TRACE.decisionReason },
];
