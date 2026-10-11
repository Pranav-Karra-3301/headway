// Owner: T3d. Sealed test panel (spec §7): champion vs g0 vs ref on secret seeds, never shown to agents. Compact.
import type { SealedRow } from '../sealed';
import { sealedRows } from '../sealed';
import { fmtSignedPct } from '../format';
import { IconLock } from './icons';

export function SealedCard({ rows, championId }: { rows: SealedRow[] | null; championId: string | null }) {
  const view = rows ? sealedRows(rows, championId) : [];
  const champ = view.find((r) => r.champion && r.policyId !== 'g0' && r.policyId !== 'ref') ?? null;
  const ref = view.find((r) => r.policyId === 'ref') ?? null;
  return (
    <section className="lab-card lab-sealed" aria-label="Sealed test">
      <header className="lab-card__head">
        <h3 className="lab-h3">Sealed test<span className="lab-h3__sub">secret seeds, scored once after optimization</span></h3>
        <span className="lab-chip lab-chip--lock" title="The seeds live only on the server; they never enter a prompt or the evolve code path.">
          <IconLock /> never shown to agents
        </span>
      </header>
      {rows === null ? <p className="lab-muted lab-small">Loading…</p>
        : champ && champ.vsBaselinePct !== null ? (
          <p className="lab-sealed__line">
            <span className="lab-sealed__big" data-tone={champ.vsBaselinePct < 0 ? 'good' : 'bad'}>{fmtSignedPct(champ.vsBaselinePct)}</span>
            <span><b>{champ.policyId}</b> vs g0 on unseen seeds</span>
            {ref?.vsBaselinePct != null && <span className="lab-muted">hand-written ref {fmtSignedPct(ref.vsBaselinePct)}</span>}
          </p>
        ) : <p className="lab-muted lab-small">Not run yet. The champion, g0 and ref are scored once on seeds no designer ever sees.</p>}
    </section>
  );
}
