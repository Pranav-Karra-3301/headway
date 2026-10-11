// Owner: T3d. Live evolve feed: folds the EvolveEvent stream into three designer lanes (spec §8.1, §8.2).
import type { Emphasis, EvolveEvent } from '@headway/sim';
import { fmtSignedPct, modelLabel } from './format';
import { DESIGNER_LETTER, designerOfProposalId } from './model';
import type { Designer } from './model';

export type LaneStatus = 'idle' | 'requested' | 'received' | 'invalid' | 'training' | 'scored' | 'validating' | 'promoted';
export interface Progress { done: number; total: number }
export interface Lane {
  designer: Designer; proposalId: string | null;
  model: string | null; emphasis: Emphasis | null; status: LaneStatus; repaired: boolean;
  summary: string | null; errors: string[];
  train: Progress | null; val: Progress | null;
  deltaTrainPct: number | null; narrative: string | null;
}
export type FeedPhase = 'idle' | 'designing' | 'evaluating' | 'done' | 'failed';
export interface FeedState {
  round: number | null; champion: string | null; phase: FeedPhase;
  lanes: Lane[];
  decision: { promoted: string | null; reason: string } | null;
  errors: string[];
  scored: Array<{ proposalId: string; deltaTrainPct: number }>;
  /** The stream is a recorded round replayed because live evolution is unavailable here. */
  replay: boolean;
}

/** api.streamEvolve announces a recorded replay with an `error` event carrying this note; it is not a failure. */
export const isReplayNote = (message: string) => /replays the last recorded round/i.test(message);

const LETTERS = 'abc';
const emptyLane = (designer: Designer): Lane => ({
  designer, proposalId: null, model: null, emphasis: null, status: 'idle', repaired: false,
  summary: null, errors: [], train: null, val: null, deltaTrainPct: null, narrative: null,
});

export function reduceFeed(events: EvolveEvent[]): FeedState {
  const s: FeedState = {
    round: null, champion: null, phase: 'idle', lanes: [emptyLane(0), emptyLane(1), emptyLane(2)],
    decision: null, errors: [], scored: [], replay: false,
  };
  const laneById = (id: string): Lane | null => {
    const d = designerOfProposalId(id);
    return d === null ? null : s.lanes[d]!;
  };
  const pid = (d: number) => (s.round === null ? null : `r${s.round}-${LETTERS[d]}`);
  let progressed = false;
  for (const e of events) {
    switch (e.type) {
      case 'round_start':
        s.round = e.round; s.champion = e.champion;
        s.lanes.forEach((l) => { l.proposalId = pid(l.designer); });
        break;
      case 'proposal': {
        const l = s.lanes[e.designer];
        if (!l) break;
        l.model = e.model; l.emphasis = e.emphasis; l.proposalId ??= pid(e.designer);
        if (e.summary) l.summary = e.summary;
        if (e.errors) l.errors = e.errors;
        if (e.status === 'requested') l.status = 'requested';
        else if (e.status === 'invalid') l.status = 'invalid';
        else { l.status = 'received'; if (e.status === 'repaired') l.repaired = true; }
        break;
      }
      case 'eval': {
        progressed = true;
        const l = laneById(e.proposalId);
        if (!l) break;
        l.proposalId = e.proposalId;
        if (e.split === 'train') { l.train = { done: e.done, total: e.total }; if (l.status !== 'scored') l.status = 'training'; }
        else { l.val = { done: e.done, total: e.total }; l.status = 'validating'; }
        break;
      }
      case 'scored': {
        progressed = true;
        const l = laneById(e.proposalId);
        s.scored.push({ proposalId: e.proposalId, deltaTrainPct: e.deltaTrainPct });
        if (!l) break;
        l.proposalId = e.proposalId; l.deltaTrainPct = e.deltaTrainPct; l.narrative = e.narrative;
        if (l.status !== 'validating') l.status = 'scored';
        break;
      }
      case 'decision': {
        s.decision = { promoted: e.promoted, reason: e.reason };
        const winnerId = e.promoted ? (/\b(r\d+-[abc])\b[^.]*\bpromoted\b/i.exec(e.reason)?.[1] ?? null) : null;
        const winner = winnerId ? laneById(winnerId)
          : e.promoted ? [...s.lanes].filter((l) => l.val && l.val.done >= l.val.total).sort((a, b) => (a.deltaTrainPct ?? 0) - (b.deltaTrainPct ?? 0))[0] ?? null
          : null;
        for (const l of s.lanes) if (l.status === 'validating') l.status = 'scored';
        if (winner) winner.status = 'promoted';
        break;
      }
      case 'error':
        if (isReplayNote(e.message)) s.replay = true;
        else s.errors.push(e.message);
        break;
    }
  }
  const last = [...events].reverse().find((e) => !(e.type === 'error' && isReplayNote(e.message)));
  s.phase = s.decision ? 'done'
    : last?.type === 'error' ? 'failed'
    : progressed ? 'evaluating'
    : events.length ? 'designing' : 'idle';
  return s;
}

/** One short human-readable line per event, for the log under the lanes. */
export function feedLine(e: EvolveEvent): string {
  switch (e.type) {
    case 'round_start': return `Round ${e.round} started · champion ${e.champion}`;
    case 'proposal': {
      const who = `Designer ${DESIGNER_LETTER[e.designer] ?? e.designer + 1}`;
      if (e.status === 'requested') return `${who} (${e.emphasis}) asked ${modelLabel(e.model)}`;
      if (e.status === 'received') return e.summary ? `${who} proposed: ${e.summary}` : `${who} returned a policy`;
      if (e.status === 'repaired') return e.summary ? `${who} repaired its policy: ${e.summary}` : `${who} repaired its policy`;
      return e.errors?.length ? `${who} was invalid: ${e.errors[0]}` : `${who} was invalid`;
    }
    case 'eval': return `${e.proposalId} ${e.split === 'train' ? 'training' : 'validation'} runs ${e.done}/${e.total}`;
    case 'scored': return `${e.proposalId} scored ΔJ ${fmtSignedPct(e.deltaTrainPct)} on training`;
    case 'decision': return e.promoted ? `Promoted ${e.promoted} · ${e.reason}` : `No promotion · ${e.reason}`;
    case 'error': return `Error · ${e.message}`;
  }
}

const VERDICT_START = /(^|[.!?)]\s+)((?:Rejected|Not promoted|Promoted to)\b[\s\S]*)$/;

/** Narratives end with the promotion verdict ("Rejected: validation worse."); split it off for the card footer. */
export function splitVerdict(narrative: string): { body: string; verdict: string | null } {
  const m = VERDICT_START.exec(narrative ?? '');
  if (!m) return { body: (narrative ?? '').trim(), verdict: null };
  const body = narrative.slice(0, m.index + m[1]!.length).trim();
  return { body, verdict: m[2]!.trim() };
}
