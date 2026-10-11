// Owner: T3d. The selected generation: summary, J vs baseline/parent, secondary metrics, open failures, replay.
import type { FailureFinding, Generation, Metrics, Proposal } from '@headway/sim';
import { splitVerdict } from '../feed';
import { fmtInt, fmtMin, fmtSignedPct, modelLabel, providerLabel } from '../format';
import { pctVs } from '../model';
import { IconPlay } from './icons';

interface Stat { label: string; value: string; unit?: string; delta: number | null; better: 'lower' | 'higher'; deltaText?: string }

function stats(m: Metrics, parent: Metrics | null): Stat[] {
  const journey = m.spawned > 0 ? m.J / m.spawned : 0;
  const pj = parent && parent.spawned > 0 ? parent.J / parent.spawned : null;
  const d = (a: number, b: number | null | undefined) => (b === null || b === undefined ? null : a - b);
  return [
    { label: 'Avg journey', value: fmtMin(journey), unit: 'min', delta: d(journey, pj), better: 'lower', deltaText: pj === null ? undefined : fmtMin(Math.abs(journey - pj)) },
    { label: 'Mean wait', value: fmtMin(m.meanWaitS), unit: 'min', delta: d(m.meanWaitS, parent?.meanWaitS), better: 'lower', deltaText: parent ? fmtMin(Math.abs(m.meanWaitS - parent.meanWaitS)) : undefined },
    { label: 'p95 wait', value: fmtMin(m.p95WaitS), unit: 'min', delta: d(m.p95WaitS, parent?.p95WaitS), better: 'lower', deltaText: parent ? fmtMin(Math.abs(m.p95WaitS - parent.p95WaitS)) : undefined },
    { label: 'Completed', value: m.completionPct.toFixed(1), unit: '%', delta: d(m.completionPct, parent?.completionPct), better: 'higher', deltaText: parent ? Math.abs(m.completionPct - parent.completionPct).toFixed(1) : undefined },
    { label: 'Missed transfers', value: fmtInt(m.missedConnections), delta: d(m.missedConnections, parent?.missedConnections), better: 'lower', deltaText: parent ? fmtInt(Math.abs(m.missedConnections - parent.missedConnections)) : undefined },
    { label: 'Walkaways', value: fmtInt(m.walkaways), delta: d(m.walkaways, parent?.walkaways), better: 'lower', deltaText: parent ? fmtInt(Math.abs(m.walkaways - parent.walkaways)) : undefined },
  ];
}

function Delta({ s }: { s: Stat }) {
  if (s.delta === null || Math.abs(s.delta) < 1e-9 || !s.deltaText || Number(s.deltaText.replace(/,/g, '')) === 0) return <span className="lab-stat__d" data-tone="flat">=</span>;
  const good = s.better === 'lower' ? s.delta < 0 : s.delta > 0;
  return <span className="lab-stat__d" data-tone={good ? 'good' : 'bad'}>{s.delta < 0 ? '▼' : '▲'} {s.deltaText}</span>;
}

const KIND_TAG: Record<FailureFinding['kind'], string> = {
  service_gap: 'gap', missed_transfer: 'missed', bunching: 'bunching', overload: 'overload', unused_capacity: 'empty', long_hold: 'hold',
};

export interface GenerationCardProps {
  gen: Generation; parent: Generation | null; g0: Generation | null; isChampion: boolean;
  proposal: Proposal | null; roundLabel: string | null;
  onReplay(): void;
}

export function GenerationCard({ gen, parent, g0, isChampion, proposal, roundLabel, onReplay }: GenerationCardProps) {
  const vsG0 = g0 ? pctVs(gen.train.J, g0.train.J) : 0;
  const valVsG0 = g0 ? pctVs(gen.val.J, g0.val.J) : 0;
  const vsParent = parent ? pctVs(gen.train.J, parent.train.J) : null;
  const why = proposal ? splitVerdict(proposal.narrative).body
    : gen.number > 0 && gen.explanation && gen.explanation !== gen.policy.meta.summary ? gen.explanation : '';
  const findings = [...gen.findings].sort((a, b) => b.impactS - a.impactS).slice(0, 2);
  const meta = gen.number === 0
    ? 'Hand-written baseline · every generation descends from it'
    : [roundLabel ? `${roundLabel} · ${gen.fromProposal}` : gen.fromProposal, proposal ? `${proposal.emphasis} designer` : null,
      proposal ? [modelLabel(proposal.model), providerLabel(proposal.model)].filter(Boolean).join(' on ') : null].filter(Boolean).join(' · ');
  return (
    <section className="lab-card lab-gen" aria-label={`Generation ${gen.id}`}>
      <header className="lab-gen__head">
        <span className="lab-genid">{gen.id}</span>
        <div className="lab-gen__tags">
          {isChampion && <span className="lab-chip lab-chip--champ">Champion</span>}
          <span className="lab-gen__meta">{meta}</span>
        </div>
      </header>
      <p className="lab-gen__summary">{gen.policy.meta.summary}</p>
      <div className="lab-gen__hero">
        <div className="lab-big" data-tone={gen.number === 0 ? 'flat' : vsG0 < 0 ? 'good' : 'bad'}>
          {gen.number === 0 ? '0.0%' : fmtSignedPct(vsG0)}
        </div>
        <div className="lab-gen__herotext">
          <b>J vs baseline</b> on 8 training runs
          <span>
            {gen.number === 0 ? 'the yardstick every proposal is scored against' : <>validation {fmtSignedPct(valVsG0)}{vsParent !== null && parent ? <> · vs {parent.id} {fmtSignedPct(vsParent)}</> : null}</>}
          </span>
        </div>
      </div>
      <dl className="lab-stats">
        {stats(gen.train.metrics, parent?.train.metrics ?? null).map((s) => (
          <div key={s.label} className="lab-stat">
            <dt>{s.label}</dt>
            <dd><span className="lab-stat__v">{s.value}</span>{s.unit && <span className="lab-stat__u">{s.unit}</span>}{parent && <Delta s={s} />}</dd>
          </div>
        ))}
      </dl>
      {why && <p className="lab-gen__why"><b>Why it survived</b> {why}</p>}
      {findings.length > 0 && (
        <div className="lab-gen__fails">
          <b>Still failing</b>
          <ul>
            {findings.map((f, i) => (
              <li key={i}><span className="lab-tag" data-kind={f.kind}>{KIND_TAG[f.kind]}</span>{f.text}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="lab-gen__actions">
        <button type="button" className="lab-btn lab-btn--primary" onClick={onReplay}>
          <IconPlay /> Replay on stadium exit
        </button>
        <span className="lab-muted lab-small">Runs {gen.id} in the town on the showcase crowd</span>
      </div>
    </section>
  );
}
