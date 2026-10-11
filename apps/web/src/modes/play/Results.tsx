// Owner: T3c. Results: You / AI champion / Baseline side by side on the identical crowd, the verdict, how the race unfolded,
// what made the difference (findings where you and the AI differ most), your interventions, and the leaderboard.
import { useEffect, useState } from 'react';
import type { Metrics, RunResult } from '@headway/sim';
import { useApp } from '../../state/store';
import { loadBoard, playAgain, playScenario, spectate, submitScore } from './game';
import { describeIntent } from './intents';
import {
  clock, differenceFindings, fmtMin, fmtMMSS, fmtPaxH, raceSeries, sentence, verdict,
} from './logic';
import { usePlay } from './playStore';
import { AgainIcon, CheckIcon, EyeIcon, playFacts } from './ui';

type Who = 'you' | 'ai' | 'base';
interface Row { key: string; label: string; get: (m: Metrics) => number; fmt: (v: number) => string; lower: boolean }
const ROWS: Row[] = [
  { key: 'journey', label: 'Mean journey', get: (m) => m.meanJourneyS, fmt: (v) => `${fmtMin(v)} min`, lower: true },
  { key: 'wait', label: 'Mean wait', get: (m) => m.meanWaitS, fmt: fmtMMSS, lower: true },
  { key: 'p95', label: 'p95 wait', get: (m) => m.p95WaitS, fmt: fmtMMSS, lower: true },
  { key: 'done', label: 'Got home', get: (m) => m.completionPct, fmt: (v) => `${v.toFixed(1)}%`, lower: false },
  { key: 'missed', label: 'Missed connections', get: (m) => m.missedConnections, fmt: (v) => String(Math.round(v)), lower: true },
  { key: 'walk', label: 'Walkaways', get: (m) => m.walkaways, fmt: (v) => String(Math.round(v)), lower: true },
];

function bestOf(rows: Array<RunResult | null>, row: Row): number | null {
  const vals = rows.filter((r): r is RunResult => !!r).map((r) => row.get(r.metrics));
  if (vals.length < 2) return null;
  const best = row.lower ? Math.min(...vals) : Math.max(...vals);
  return vals.some((v) => v !== best) ? best : null;
}

function ScoreCard(p: { who: Who; title: string; sub: string; result: RunResult | null; all: Array<RunResult | null>; maxJ: number; loading?: boolean; stub?: boolean; index: number }) {
  const j = p.result ? p.result.metrics.J : 0;
  const m = p.result?.metrics;
  return (
    <section className="pl-score hw-card" data-who={p.who} style={{ ['--i' as string]: p.index }}>
      <header className="pl-score__head">
        <span className="pl-score__dot" />
        <span className="pl-score__title">{p.title}</span>
        <span className="pl-score__sub">{p.sub}{p.stub ? ' · preview sim' : ''}</span>
      </header>
      {m ? (
        <>
          <div className="pl-score__j">
            <span className="hw-num">{fmtPaxH(j)}</span><span className="pl-score__unit">passenger-hours</span>
          </div>
          <span className="pl-score__bar" aria-hidden="true"><i style={{ transform: `scaleX(${p.maxJ > 0 ? j / p.maxJ : 0})` }} /></span>
          <dl className="pl-score__rows">
            {ROWS.map((row) => {
              const v = row.get(m);
              const best = bestOf(p.all, row);
              return (
                <div key={row.key} className="pl-score__row" data-best={best !== null && v === best ? true : undefined}>
                  <dt>{row.label}</dt>
                  <dd className="hw-num">{row.fmt(v)}{best !== null && v === best && <CheckIcon />}</dd>
                </div>
              );
            })}
          </dl>
          <p className="pl-score__effort">
            Effort: {Math.round(m.effort.busDistanceU).toLocaleString('en-US')} u driven · {Math.round(m.effort.deadheadDistanceU)} u deadhead
            · {fmtMMSS(m.effort.holdS)} held · {fmtMMSS(m.effort.trainDwellS)} train dwell
          </p>
        </>
      ) : (
        <div className="pl-score__empty">{p.loading ? <><i className="pl-dot" /> Running this crowd…</> : 'Unavailable'}</div>
      )}
    </section>
  );
}

function RaceChart() {
  const youPace = usePlay((s) => s.youPace);
  const ai = usePlay((s) => s.ai);
  const end = usePlay((s) => (s.obs ? s.obs.scenario.durationS + s.obs.scenario.clearingS : 2700));
  if (!ai.champion || !ai.baseline || youPace.length < 2) return <p className="pl-muted">The race chart appears once the AI runs are in.</p>;
  const s = raceSeries(youPace, ai.champion.samples, ai.baseline.samples);
  const W = 360, H = 150, P = 10;
  const vals = [...s.you, ...s.ai].map((p) => p.v);
  const lo = Math.min(0, ...vals), hi = Math.max(0.5, ...vals);
  const span = hi - lo || 1;
  const x = (t: number) => P + (Math.min(end, Math.max(0, t)) / end) * (W - 2 * P - 46);
  const y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const path = (pts: Array<{ t: number; v: number }>) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const lastYou = s.you[s.you.length - 1]!;
  const lastAi = s.ai[s.ai.length - 1]!;
  const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const yYou = y(lastYou.v), yAi = y(lastAi.v);
  const nudgeY = Math.abs(yYou - yAi) < 14 ? (yYou < yAi ? -7 : 7) : 0;
  return (
    <svg className="pl-race" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Passenger-hours saved against the baseline: you ${fmt(lastYou.v)}, the AI ${fmt(lastAi.v)}`}>
      <line className="pl-race__zero" x1={P} x2={W - P - 46} y1={y(0)} y2={y(0)} />
      <text className="pl-race__lbl" x={W - P - 42} y={y(0) + 4}>baseline</text>
      <path className="pl-race__ai" d={path(s.ai)} />
      <path className="pl-race__you" d={path(s.you)} />
      <text className="pl-race__lbl pl-race__lbl--ai" x={x(lastAi.t) + 6} y={yAi + 4 - nudgeY}>AI {fmt(lastAi.v)}</text>
      <text className="pl-race__lbl pl-race__lbl--you" x={x(lastYou.t) + 6} y={yYou + 4 + nudgeY}>You {fmt(lastYou.v)}</text>
    </svg>
  );
}

function Differences({ you, ai, clockStart }: { you: RunResult; ai: RunResult; clockStart: string }) {
  const diffs = differenceFindings(you.findings, ai.findings, 3);
  if (diffs.length === 0) return <p className="pl-muted">You and the AI ran into the same problems in the same places.</p>;
  return (
    <ul className="pl-diffs">
      {diffs.map((d) => (
        <li key={d.key} data-worse={d.worse}>
          <span className="pl-diffs__tag">{d.worse === 'you' ? `Cost you ${(Math.abs(d.deltaS) / 3600).toFixed(1)} pax-h` : `Saved you ${(Math.abs(d.deltaS) / 3600).toFixed(1)} pax-h`}</span>
          <span className="pl-diffs__who">{d.worse === 'you' ? 'Your run' : 'The AI’s run'}</span>
          <span className="pl-diffs__text">{sentence(d.finding, clockStart)}</span>
        </li>
      ))}
    </ul>
  );
}

function Interventions({ clockStart }: { clockStart: string }) {
  const tracked = usePlay((s) => s.tracked).filter((x) => x.status !== 'replaced');
  if (tracked.length === 0) {
    return <p className="pl-muted">No interventions, so this run is exactly the baseline. Try holding a bus at Central for the train, or moving a bus to r3 before the stadium closes.</p>;
  }
  return (
    <ol className="pl-log">
      {tracked.map((x) => (
        <li key={x.id} data-status={x.status}>
          <span className="pl-log__t hw-num">{clock(clockStart, x.t)}</span>
          <span className="pl-log__what">{describeIntent(x.intent)}</span>
          <span className="pl-log__res">
            {x.status === 'applied' ? `${x.appliedT !== null && x.appliedT > x.t ? `at ${clock(clockStart, x.appliedT)}: ` : ''}${x.result ?? 'applied'}`
              : x.status === 'expired' ? 'Not applied before the run ended' : 'Pending'}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Leaderboard() {
  const board = usePlay((s) => s.board);
  const submit = usePlay((s) => s.submit);
  const you = usePlay((s) => s.you);
  const seed = useApp((s) => s.play.seed);
  const [name, setName] = useState(submit.name);
  useEffect(() => { if (board.status === 'idle') void loadBoard(); }, [board.status]);
  const rows = [...board.rows].sort((a, b) => a.j - b.j).slice(0, 8);
  return (
    <aside className="pl-board hw-card" aria-label="Leaderboard">
      <header className="pl-board__head"><span className="pl-board__title">Leaderboard</span><span className="pl-muted hw-num">crowd #{seed}</span></header>
      {board.status === 'loading' && rows.length === 0 ? <p className="pl-muted"><i className="pl-dot" /> Loading</p>
        : rows.length === 0 ? <p className="pl-muted">No scores on this crowd yet. Be the first.</p>
        : (
          <ol className="pl-board__rows">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} data-me={submit.status === 'done' && r.name === submit.name ? true : undefined}>
                <span className="pl-board__rank hw-num">{i + 1}</span>
                <span className="pl-board__name">{r.name}</span>
                <span className="pl-board__j hw-num">{fmtPaxH(r.j)}</span>
                <span className="pl-board__v" aria-label={r.verified ? 'Re-simulated on the server' : 'Not yet verified'} data-v={r.verified || undefined}>{r.verified ? <CheckIcon /> : '·'}</span>
              </li>
            ))}
          </ol>
        )}
      <form className="pl-board__form" onSubmit={(e) => { e.preventDefault(); void submitScore(name); }}>
        <input className="pl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={16}
          aria-label="Name for the leaderboard" disabled={!you || submit.status === 'sending' || submit.status === 'done'} />
        <button type="submit" className="hw-btn hw-btn--primary" disabled={!you || !name.trim() || submit.status === 'sending' || submit.status === 'done'}>
          {submit.status === 'sending' ? 'Sending…' : submit.status === 'done' ? 'Submitted' : 'Submit'}
        </button>
      </form>
      {submit.status === 'done' && <p className="pl-board__msg" data-tone="ok">Submitted{submit.j !== null ? `: ${fmtPaxH(submit.j)} pax-h, re-simulated` : ''}.</p>}
      {submit.status === 'error' && <p className="pl-board__msg" data-tone="bad">{submit.error}</p>}
    </aside>
  );
}

export function Results() {
  const you = usePlay((s) => s.you);
  const ai = usePlay((s) => s.ai);
  const error = usePlay((s) => s.error);
  const clockStart = usePlay((s) => s.obs?.scenario.clockStart) ?? playFacts(playScenario().scenarioId).clockStart;
  const champion = useApp((s) => s.champion);
  const seed = useApp((s) => s.play.seed);
  const facts = playFacts(playScenario().scenarioId);
  const aiRes = ai.champion?.result ?? null;
  const baseRes = ai.baseline?.result ?? null;
  const v = you && aiRes && baseRes ? verdict(you.metrics.J, aiRes.metrics.J, baseRes.metrics.J) : null;
  const all = [you, aiRes, baseRes];
  const maxJ = Math.max(0, ...all.map((r) => r?.metrics.J ?? 0));
  const champId = ai.champion?.policyId ?? champion?.policy.meta.id ?? 'champion';

  return (
    <div className="pl-results" role="dialog" aria-modal="true" aria-labelledby="pl-res-title">
      <div className="pl-results__inner">
        <header className="pl-res-head">
          <span className="hw-label">Results · {facts.name} · crowd #{seed}</span>
          <h1 id="pl-res-title" data-tone={v?.tone ?? 'none'}>{v?.headline ?? (you ? 'Run complete' : 'Scoring your run…')}</h1>
          <p className="pl-res-head__line">
            {error ?? v?.line ?? (ai.status === 'error' ? 'The AI comparison is unavailable right now.' : 'Waiting for the AI’s run on this crowd…')}
          </p>
        </header>

        <div className="pl-res-top">
          <div className="pl-scores">
            <ScoreCard index={0} who="you" title="You" sub="g0 + your calls" result={you} all={all} maxJ={maxJ} />
            <ScoreCard index={1} who="ai" title="AI dispatcher" sub={`champion ${champId}`} result={aiRes} all={all} maxJ={maxJ} loading={ai.status === 'running'} stub={ai.champion?.stub} />
            <ScoreCard index={2} who="base" title="Baseline" sub="g0, hands off" result={baseRes} all={all} maxJ={maxJ} loading={ai.status === 'running'} stub={ai.baseline?.stub} />
          </div>
          <Leaderboard />
        </div>

        <div className="pl-res-lower">
          <section className="pl-panel hw-card">
            <h2>How the race unfolded</h2>
            <RaceChart />
          </section>
          <section className="pl-panel hw-card">
            <h2>What made the difference</h2>
            {you && aiRes ? <Differences you={you} ai={aiRes} clockStart={clockStart} /> : <p className="pl-muted">Waiting for both runs.</p>}
          </section>
          <section className="pl-panel hw-card">
            <h2>Your interventions</h2>
            <Interventions clockStart={clockStart} />
          </section>
        </div>

        <footer className="pl-res-foot">
          <button type="button" className="hw-btn" onClick={() => spectate()}><EyeIcon /> Watch the AI on this crowd</button>
          <button type="button" className="hw-btn hw-btn--primary" autoFocus onClick={() => playAgain()}><AgainIcon /> Play again</button>
        </footer>
      </div>
    </div>
  );
}
