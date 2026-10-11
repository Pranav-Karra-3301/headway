// Owner: T3d. Compact round timeline: one row per round (collapsed), expand to see its three proposals.
import type { Generation, Proposal, Round } from '@headway/sim';
import { fmtSignedPct } from '../format';
import { roundOutcome } from '../model';
import { ProposalCard } from './RoundCard';

function outcomeText(r: Round): string {
  const o = roundOutcome(r);
  if (o === 'promoted') return `${r.championBefore} → ${r.championAfter} · new champion`;
  if (o === 'running') return `running on ${r.championBefore}`;
  if (o === 'failed') return `failed · ${r.championBefore} kept`;
  return `rejected · ${r.championBefore} stays`;
}

export function RoundTimeline({ rounds, generations, openRoundId, focusProposalId, onToggle, onFocus, onReplay }: {
  rounds: Round[]; generations: Generation[]; openRoundId: string | null; focusProposalId: string | null;
  onToggle(r: Round): void; onFocus(p: Proposal): void; onReplay(p: Proposal): void;
}) {
  const list = [...rounds].sort((a, b) => b.number - a.number);
  return (
    <section className="lab-card lab-rt" aria-label="Rounds">
      <header className="lab-card__head">
        <h3 className="lab-h3">Rounds<span className="lab-h3__sub">newest first · 3 ideas each</span></h3>
      </header>
      {list.length === 0 && <p className="lab-empty">No rounds are published yet.</p>}
      <ol className="lab-rt__list">
        {list.map((r) => {
          const open = r.id === openRoundId;
          const o = roundOutcome(r);
          const best = r.proposals.filter((p) => p.valid && p.deltaTrainPct !== null)
            .reduce<number | null>((m, p) => (m === null || p.deltaTrainPct! < m ? p.deltaTrainPct! : m), null);
          const proposals = [...r.proposals].sort((a, b) => a.designer - b.designer);
          return (
            <li key={r.id} className="lab-rt__item" data-open={open || undefined} data-outcome={o}>
              <button type="button" className="lab-rt__row" aria-expanded={open} onClick={() => onToggle(r)}>
                <span className="lab-rt__chev" aria-hidden="true">›</span>
                <span className="lab-rt__n">Round {r.number}</span>
                <span className="lab-rt__out">{outcomeText(r)}</span>
                <span className="lab-rt__best" data-tone={best === null ? 'flat' : best < 0 ? 'good' : 'bad'}>
                  {best === null ? '—' : fmtSignedPct(best)}
                </span>
              </button>
              {open && (
                <div className="lab-prows lab-rt__props">
                  {proposals.map((p, i) => (
                    <ProposalCard key={p.id} p={p} round={r} generations={generations} index={i}
                      focused={p.id === focusProposalId} onFocus={onFocus} onReplay={onReplay} />
                  ))}
                  {proposals.length === 0 && <p className="lab-empty">No proposals were recorded for this round.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
