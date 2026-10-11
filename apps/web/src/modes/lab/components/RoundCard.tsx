// Owner: T3d. One round's three proposal cards (model, emphasis, summary, valid, ΔJ, narrative) — spec §10 Lab.
import type { CSSProperties } from 'react';
import type { Generation, Proposal, Round } from '@headway/sim';
import { emphasisLabel, fmtSignedPct, fmtTime, plainChange } from '../format';
import { proposalOutcome, roundOutcome } from '../model';
import { IconPlay } from './icons';

export interface RoundCardProps {
  round: Round; generations: Generation[];
  focusProposalId: string | null;
  onFocus(p: Proposal): void;
  onReplay(p: Proposal): void;
}

function roundHeadline(r: Round, generations: Generation[]): string {
  const o = roundOutcome(r);
  if (o === 'promoted') return `${r.championBefore} → ${r.championAfter}`;
  if (o === 'running') return `running on ${r.championBefore}`;
  if (o === 'failed') return `failed · ${r.championBefore} kept`;
  return generations.length ? `rejected · ${r.championBefore} kept` : 'rejected';
}

/** Plain verdict: "Kept → g4" or "Rejected · worse on training". */
function verdictText(out: ReturnType<typeof proposalOutcome>): string {
  if (out.kind === 'promoted') return `Kept → ${out.generationId}`;
  if (out.kind === 'invalid') return 'Rejected · rules invalid';
  if (out.kind === 'pending') return 'Testing…';
  const why: Record<string, string> = {
    'Not the best this round': 'another idea won', 'Validation worse': 'worse on unseen crowds',
    'Gain under 1%': 'gain under 1%', 'Worse on training': 'worse on training',
    'Failed a promotion guard': 'failed a safety check', 'Not evaluated': 'not tested',
  };
  return `Rejected · ${why[out.label] ?? out.label.toLowerCase()}`;
}

export function ProposalCard({ p, round, generations, focused, onFocus, onReplay, index }: {
  p: Proposal; round: Round; generations: Generation[]; focused: boolean; index: number;
  onFocus(p: Proposal): void; onReplay(p: Proposal): void;
}) {
  const out = proposalOutcome(p, round, generations);
  const what = p.valid ? plainChange(p.summary, p.emphasis) : 'Rules did not validate';
  const d = p.valid ? p.deltaTrainPct : null;
  return (
    <article className="lab-prow" data-outcome={out.kind} data-emphasis={p.emphasis} data-focused={focused || undefined}
      style={{ '--i': index } as CSSProperties}>
      <button type="button" className="lab-prow__hit" onClick={() => onFocus(p)} aria-pressed={focused}
        aria-label={`Show ${p.id} rule diff`} title={p.summary || undefined} />
      <span className="lab-prow__chip">{emphasisLabel(p.emphasis)}</span>
      <span className="lab-prow__what">{what}</span>
      <span className="lab-prow__delta" data-tone={d === null || d === undefined ? 'flat' : d < 0 ? 'good' : 'bad'}>
        {d === null || d === undefined ? '—' : fmtSignedPct(d)}
      </span>
      <span className="lab-prow__verdict" data-outcome={out.kind} title={out.label}>{verdictText(out)}</span>
      {p.valid && p.policy ? (
        <button type="button" className="lab-prow__play" onClick={() => onReplay(p)} title={`Replay ${p.id} on stadium exit`} aria-label={`Replay ${p.id}`}>
          <IconPlay />
        </button>
      ) : <span />}
    </article>
  );
}

export function RoundCard({ round, generations, focusProposalId, onFocus, onReplay }: RoundCardProps) {
  const proposals = [...round.proposals].sort((a, b) => a.designer - b.designer);
  const valid = proposals.filter((p) => p.valid).length;
  return (
    <section className="lab-card lab-round" aria-label={`Round ${round.number}`}>
      <header className="lab-card__head">
        <h3 className="lab-h3">Round {round.number}<span className="lab-h3__sub">{roundHeadline(round, generations)}</span></h3>
        <span className="lab-muted lab-small">{[fmtTime(round.startedAt), `3 designers`, `${valid} valid`].filter(Boolean).join(' · ')}</span>
      </header>
      <div className="lab-prows">
        {proposals.map((p, i) => (
          <ProposalCard key={p.id} p={p} round={round} generations={generations} index={i}
            focused={p.id === focusProposalId} onFocus={onFocus} onReplay={onReplay} />
        ))}
        {proposals.length === 0 && <p className="lab-empty">No proposals were recorded for this round.</p>}
      </div>
    </section>
  );
}
