// Owner: T3d. The Lab headline: champion's change in total passenger time (training + unseen crowds, vs the start),
// whether it beats the hand-written plan, the g0 → g1 → … path in plain words, and one line on how evolution works.
import { Fragment } from 'react';
import type { Generation } from '@headway/sim';
import { emphasisLabel, fmtSignedPct, plainChange } from '../format';
import { pctVs } from '../model';
import { IconArrow, IconCheck, IconPlay, IconSpark } from './icons';

const tone = (x: number | null) => (x === null || Math.abs(x) < 0.05 ? 'flat' : x < 0 ? 'good' : 'bad');

const IconBus = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="2.5" width="11" height="9" rx="2.2" /><path d="M2.5 7.5h11" /><circle cx="5.2" cy="13" r="1" fill="currentColor" stroke="none" /><circle cx="10.8" cy="13" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export function ChampionCard({ gen, gens, refPct, selectedId, onPick, onReplay }: {
  gen: Generation; gens: Generation[]; refPct: number | null; selectedId: string | null;
  onPick(g: Generation): void; onReplay(): void;
}) {
  const g0 = gens[0] ?? null;
  const train = g0 && gen !== g0 ? pctVs(gen.train.J, g0.train.J) : 0;
  const val = g0 && gen !== g0 ? pctVs(gen.val.J, g0.val.J) : 0;
  const vsRef = refPct === null ? null
    : train < refPct ? 'beats the hand-written plan' : `hand-written plan ${fmtSignedPct(refPct)}`;
  return (
    <section className="lab-card lab-champ" aria-label={`Champion ${gen.id}`}>
      <div className="lab-hero">
        <div className="lab-hero__nums">
          <div className="lab-hero__big" data-tone={tone(train)}>
            {fmtSignedPct(train)}<span className="lab-hero__unit">total passenger time</span>
          </div>
          <p className="lab-hero__sub">
            <b data-tone={tone(val)}>{fmtSignedPct(val)}</b> on unseen crowds{vsRef && <> · {vsRef}</>}
          </p>
        </div>
        <button type="button" className="lab-btn lab-btn--primary" onClick={onReplay}>
          <IconPlay /> Replay on stadium exit
        </button>
      </div>

      <ol className="lab-path" aria-label="Generations">
        {gens.map((g, i) => {
          const pct = g0 && g !== g0 ? pctVs(g.train.J, g0.train.J) : 0;
          const emph = g.number === 0 ? 'baseline' : g.policy.meta.emphasis;
          return (
            <Fragment key={g.id}>
              {i > 0 && <li className="lab-path__arrow" aria-hidden="true"><IconArrow /></li>}
              <li>
                <button type="button" className="lab-path__chip" data-emphasis={emph} aria-pressed={g.id === selectedId}
                  data-champ={g === gen || undefined} title={g.policy.meta.summary} onClick={() => onPick(g)}>
                  <span className="lab-path__top">
                    <span className="lab-genid">{g.id}</span>
                    <span className="lab-path__kind">{emphasisLabel(emph)}</span>
                    {g.number > 0 && <span className="lab-path__pct" data-tone={tone(pct)}>{fmtSignedPct(pct)}</span>}
                  </span>
                  <span className="lab-path__what">{plainChange(g.policy.meta.summary, emph, g.number === 0)}</span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>

      <p className="lab-how" aria-label="How evolution works">
        <span><IconSpark /> AI designers propose</span><i aria-hidden="true">→</i>
        <span><IconBus /> simulator tests</span><i aria-hidden="true">→</i>
        <span><IconCheck /> only real gains survive</span>
      </p>
    </section>
  );
}
