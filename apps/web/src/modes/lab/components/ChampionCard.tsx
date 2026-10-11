// Owner: T3d. The champion at a glance: generation, ΔJ vs g0 on training and unseen validation, vs the hand-written ref.
import type { Generation } from '@headway/sim';
import { fmtSignedPct } from '../format';
import { pctVs } from '../model';
import { IconPlay } from './icons';

const tone = (x: number | null) => (x === null || Math.abs(x) < 0.05 ? 'flat' : x < 0 ? 'good' : 'bad');

export function ChampionCard({ gen, g0, refPct, onReplay }: {
  gen: Generation; g0: Generation | null; refPct: number | null; onReplay(): void;
}) {
  const train = g0 && gen !== g0 ? pctVs(gen.train.J, g0.train.J) : 0;
  const val = g0 && gen !== g0 ? pctVs(gen.val.J, g0.val.J) : 0;
  const tiles: Array<{ label: string; value: number | null; note: string }> = [
    { label: 'Training', value: train, note: 'J vs g0 baseline' },
    { label: 'Unseen validation', value: val, note: 'J vs g0 baseline' },
    { label: 'Hand-written ref', value: refPct, note: 'for comparison' },
  ];
  return (
    <section className="lab-card lab-champ" aria-label={`Champion ${gen.id}`}>
      <header className="lab-champ__head">
        <div>
          <div className="lab-champ__id"><span className="lab-chip lab-chip--champ">Champion</span><span className="lab-genid">{gen.id}</span><span className="lab-muted">generation {gen.number}</span></div>
          <p className="lab-champ__summary">{gen.policy.meta.summary}</p>
        </div>
        <button type="button" className="lab-btn lab-btn--primary" onClick={onReplay}>
          <IconPlay /> Replay on stadium exit
        </button>
      </header>
      <dl className="lab-champ__tiles">
        {tiles.map((t) => (
          <div key={t.label} className="lab-champ__tile" data-ref={t.label.startsWith('Hand') || undefined}>
            <dt>{t.label}</dt>
            <dd data-tone={tone(t.value)}>{t.value === null ? '—' : fmtSignedPct(t.value)}</dd>
            <span className="lab-muted lab-small">{t.note}</span>
          </div>
        ))}
      </dl>
    </section>
  );
}
