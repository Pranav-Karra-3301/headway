// Owner: T3d. Live evolve feed: three designer lanes + log, folded from the streamed EvolveEvents (spec §8.1).
import type { CSSProperties } from 'react';
import type { EvolveEvent } from '@headway/sim';
import type { FeedState, Lane } from '../feed';
import { feedLine } from '../feed';
import { fmtSignedPct, modelLabel } from '../format';
import { DESIGNER_LETTER } from '../model';
import { IconCheck, IconX } from './icons';

type StepState = 'done' | 'active' | 'todo' | 'failed';

function laneSteps(l: Lane): Array<{ label: string; state: StepState }> {
  const order = ['requested', 'received', 'training', 'scored', 'validating', 'promoted'] as const;
  const at = l.status === 'invalid' ? 1 : Math.max(0, order.indexOf(l.status as (typeof order)[number]));
  const st = (i: number): StepState => {
    if (l.status === 'idle') return 'todo';
    if (l.status === 'invalid') return i === 0 ? 'done' : i === 1 ? 'failed' : 'todo';
    if (i < at) return 'done';
    if (i === at) return l.status === 'scored' || l.status === 'promoted' || l.status === 'received' ? 'done' : 'active';
    return 'todo';
  };
  const train = l.train ? ` ${l.train.done}/${l.train.total}` : '';
  const val = l.val ? ` ${l.val.done}/${l.val.total}` : '';
  return [
    { label: 'Asked', state: st(0) },
    { label: l.repaired ? 'Repaired' : 'Proposed', state: st(1) },
    { label: `Train${train}`, state: st(2) },
    { label: 'Scored', state: st(3) },
    { label: `Val${val}`, state: l.val ? st(4) : 'todo' },
  ];
}

function LaneCard({ l, index }: { l: Lane; index: number }) {
  const steps = laneSteps(l);
  const progress = l.status === 'training' && l.train ? l.train.done / Math.max(1, l.train.total)
    : l.status === 'validating' && l.val ? l.val.done / Math.max(1, l.val.total) : null;
  return (
    <article className="lab-lane" data-status={l.status} data-emphasis={l.emphasis ?? undefined} style={{ '--i': index } as CSSProperties}>
      <header className="lab-prop__head">
        <span className="lab-avatar" data-emphasis={l.emphasis ?? undefined}>{DESIGNER_LETTER[l.designer]}</span>
        <div className="lab-prop__who">
          <div className="lab-prop__row">
            <span className="lab-prop__emph">{l.emphasis ?? 'waiting'}</span>
            {l.status === 'promoted' && <span className="lab-badge" data-outcome="promoted"><IconCheck /> promoted</span>}
            {l.status === 'invalid' && <span className="lab-badge" data-outcome="invalid"><IconX /> invalid</span>}
            {l.deltaTrainPct !== null && l.status !== 'promoted' && (
              <span className="lab-lane__delta" data-tone={l.deltaTrainPct < 0 ? 'good' : 'bad'}>{fmtSignedPct(l.deltaTrainPct)}</span>
            )}
          </div>
          <span className="lab-prop__model">{l.model ? modelLabel(l.model) : '—'}</span>
        </div>
      </header>
      <ol className="lab-steps">
        {steps.map((s) => <li key={s.label} data-state={s.state}><i />{s.label}</li>)}
      </ol>
      <div className="lab-progress" aria-hidden="true" data-on={progress !== null || undefined}>
        <i style={{ transform: `scaleX(${progress ?? 0})` }} />
      </div>
      <p className="lab-lane__text">
        {l.status === 'invalid' ? <code>{l.errors[0] ?? 'invalid policy'}</code>
          : l.narrative ? l.narrative
          : l.summary ? l.summary
          : l.status === 'requested' ? 'Writing a policy…' : 'Waiting…'}
      </p>
    </article>
  );
}

export interface LiveRoundProps {
  feed: FeedState; events: EvolveEvent[]; evolving: boolean;
  onClose(): void;
}

export function LiveRound({ feed, events, evolving, onClose }: LiveRoundProps) {
  const lines = events.filter((e) => e.type !== 'error').map(feedLine).slice(-4);
  const notStarted = feed.round === null && !evolving && feed.phase === 'failed';
  const status = feed.phase === 'done'
    ? (feed.decision?.promoted ? `Promoted ${feed.decision.promoted}` : 'No promotion')
    : feed.phase === 'failed' ? (feed.round === null ? 'Did not start' : 'Round failed')
    : feed.phase === 'evaluating' ? 'Simulating…' : feed.phase === 'designing' ? 'Designers writing…' : 'Starting…';
  return (
    <section className="lab-card lab-live" data-phase={feed.phase} aria-live="polite" aria-label="Live evolution round">
      <header className="lab-card__head">
        <h3 className="lab-h3">
          <span className="lab-live__dot" data-on={evolving || undefined} />
          {feed.round !== null ? `Live round ${feed.round}` : 'Live round'}
          {feed.champion && <span className="lab-h3__sub">from {feed.champion}</span>}
        </h3>
        <div className="lab-live__right">
          {feed.replay && <span className="lab-chip lab-chip--quiet" title="Live evolution is not available on this deployment">recorded replay</span>}
          <span className="lab-chip" data-tone={feed.phase === 'done' ? (feed.decision?.promoted ? 'good' : 'flat') : feed.phase === 'failed' ? 'bad' : 'live'}>{status}</span>
          {!evolving && <button type="button" className="lab-btn lab-btn--ghost lab-btn--sm" onClick={onClose}>Show rounds</button>}
        </div>
      </header>
      {!notStarted && (
        <div className="lab-props lab-props--live">
          {feed.lanes.map((l, i) => <LaneCard key={l.designer} l={l} index={i} />)}
        </div>
      )}
      {notStarted ? null : feed.decision ? (
        <p className="lab-decision" data-tone={feed.decision.promoted ? 'good' : 'flat'}>{feed.decision.reason}</p>
      ) : (
        <ol className="lab-log">{lines.map((t, i) => <li key={`${events.length}-${i}`}>{t}</li>)}</ol>
      )}
      {feed.errors.length > 0 && (
        <ul className="lab-errlist">{feed.errors.slice(-2).map((t, i) => <li key={i}>{t}</li>)}</ul>
      )}
    </section>
  );
}
