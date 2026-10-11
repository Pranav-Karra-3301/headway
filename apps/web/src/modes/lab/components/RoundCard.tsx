// Owner: T3d. One round's three proposal cards (model, emphasis, summary, valid, ΔJ, narrative) — spec §10 Lab.
import type { CSSProperties } from 'react';
import type { Generation, Proposal, Round } from '@headway/sim';
import { splitVerdict } from '../feed';
import { fmtSignedPct, fmtTime, modelLabel, providerLabel } from '../format';
import { DESIGNER_LETTER, pctVs, proposalOutcome, roundOutcome, shortOutcome } from '../model';
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

export function ProposalCard({ p, round, generations, focused, onFocus, onReplay, index }: {
  p: Proposal; round: Round; generations: Generation[]; focused: boolean; index: number;
  onFocus(p: Proposal): void; onReplay(p: Proposal): void;
}) {
  const out = proposalOutcome(p, round, generations);
  const champ = generations.find((g) => g.id === round.championBefore) ?? null;
  const valDelta = p.val && champ ? pctVs(p.val.J, champ.val.J) : null;
  const { body, verdict } = splitVerdict(p.narrative);
  const fallback = providerLabel(p.model) === 'OpenRouter';
  return (
    <article className="lab-prop" data-outcome={out.kind} data-emphasis={p.emphasis} data-focused={focused || undefined}
      style={{ '--i': index } as CSSProperties}>
      <button type="button" className="lab-prop__hit" onClick={() => onFocus(p)} aria-pressed={focused}
        aria-label={`Show ${p.id} rule diff`} />
      <header className="lab-prop__head">
        <span className="lab-avatar" data-emphasis={p.emphasis}>{DESIGNER_LETTER[p.designer] ?? '?'}</span>
        <div className="lab-prop__who">
          <div className="lab-prop__row">
            <span className="lab-prop__emph">{p.emphasis}</span>
            <span className="lab-badge" data-outcome={out.kind} title={out.label}>{shortOutcome(out)}</span>
          </div>
          <span className="lab-prop__model" title={p.model}>{modelLabel(p.model)}{fallback ? ' · fallback' : ''}</span>
        </div>
      </header>
      <p className="lab-prop__summary">{p.summary || (p.valid ? 'No summary given.' : 'The designer’s output never validated.')}</p>
      {p.valid ? (
        <div className="lab-prop__score">
          <span className="lab-prop__delta" data-tone={p.deltaTrainPct === null ? 'flat' : p.deltaTrainPct < 0 ? 'good' : 'bad'}>
            {p.deltaTrainPct === null ? '—' : fmtSignedPct(p.deltaTrainPct)}
          </span>
          <span className="lab-prop__scorelbl">J train vs {round.championBefore}{valDelta !== null ? <><br />val {fmtSignedPct(valDelta)}</> : null}</span>
        </div>
      ) : (
        <ul className="lab-prop__errors">
          {p.errors.slice(0, 2).map((e, i) => <li key={i}><code>{e}</code></li>)}
          {p.errors.length > 2 && <li className="lab-muted">+{p.errors.length - 2} more</li>}
        </ul>
      )}
      {p.valid && body && <p className="lab-prop__narr">{body}</p>}
      <footer className="lab-prop__foot">
        {verdict && out.kind !== 'promoted' ? <span className="lab-prop__verdict">{verdict}</span> : <span />}
        {p.valid && p.policy && (
          <button type="button" className="lab-btn lab-btn--ghost lab-btn--sm" onClick={() => onReplay(p)} title={`Replay ${p.id} on stadium exit`}>
            <IconPlay /> Replay
          </button>
        )}
      </footer>
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
      <div className="lab-props">
        {proposals.map((p, i) => (
          <ProposalCard key={p.id} p={p} round={round} generations={generations} index={i}
            focused={p.id === focusProposalId} onFocus={onFocus} onReplay={onReplay} />
        ))}
        {proposals.length === 0 && <p className="lab-empty">No proposals were recorded for this round.</p>}
      </div>
    </section>
  );
}
