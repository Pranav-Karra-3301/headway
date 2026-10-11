// Owner: T3d. Sealed test panel (spec §7): champion vs g0 vs ref on secret seeds, never shown to agents.
import type { CSSProperties } from 'react';
import type { SealedRow } from '../sealed';
import { sealedRows } from '../sealed';
import { fmtMin, fmtPaxH, fmtSignedPct } from '../format';
import { IconLock } from './icons';

export function SealedCard({ rows, championId }: { rows: SealedRow[] | null; championId: string | null }) {
  const view = rows ? sealedRows(rows, championId) : [];
  const champ = view.find((r) => r.champion && r.policyId !== 'g0' && r.policyId !== 'ref') ?? null;
  const ref = view.find((r) => r.policyId === 'ref') ?? null;
  const maxGain = Math.max(1, ...view.map((r) => Math.abs(Math.min(0, r.vsBaselinePct ?? 0))));
  return (
    <section className="lab-card lab-sealed" aria-label="Sealed test">
      <header className="lab-card__head">
        <h3 className="lab-h3">Sealed test<span className="lab-h3__sub">scored once, after optimization</span></h3>
        <span className="lab-chip lab-chip--lock"><IconLock /> never shown to agents</span>
      </header>
      {rows === null && <p className="lab-muted lab-small">Loading…</p>}
      {rows !== null && view.length === 0 && (
        <p className="lab-empty lab-empty--left">
          Not run yet. When optimization stops, the champion, g0 and ref are scored once on secret seeds that no designer
          ever sees.
        </p>
      )}
      {view.length > 0 && (
        <div className="lab-sealed__body">
          {champ && champ.vsBaselinePct !== null && (
            <div className="lab-sealed__hero">
              <div className="lab-big" data-tone={champ.vsBaselinePct < 0 ? 'good' : 'bad'}>{fmtSignedPct(champ.vsBaselinePct)}</div>
              <div className="lab-sealed__herotext">
                <b>{champ.policyId} vs g0</b>
                <span>on unseen seeds{ref?.vsBaselinePct != null ? ` · ref ${fmtSignedPct(ref.vsBaselinePct)}` : ''}</span>
              </div>
            </div>
          )}
          <table className="lab-table">
            <thead>
              <tr><th>Policy</th><th>J (pax-h)</th><th>vs g0</th><th>Done</th><th>Wait</th></tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const gain = Math.abs(Math.min(0, r.vsBaselinePct ?? 0));
                return (
                  <tr key={r.policyId} data-champion={r.champion || undefined}>
                    <th scope="row">{r.label}</th>
                    <td>{fmtPaxH(r.J)}</td>
                    <td data-tone={r.vsBaselinePct === null || r.policyId === 'g0' ? 'flat' : r.vsBaselinePct < 0 ? 'good' : 'bad'}>
                      <span className="lab-bar" aria-hidden="true"><i style={{ '--w': gain / maxGain } as CSSProperties} /></span>
                      {r.vsBaselinePct === null || r.policyId === 'g0' ? '—' : fmtSignedPct(r.vsBaselinePct)}
                    </td>
                    <td>{r.metrics ? `${r.metrics.completionPct.toFixed(1)}%` : '—'}</td>
                    <td>{r.metrics ? `${fmtMin(r.metrics.meanWaitS)} min` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="lab-foot">
        The seeds live only on the server. They never enter a prompt or the evolve code path, so this is the honest number.
      </p>
    </section>
  );
}
