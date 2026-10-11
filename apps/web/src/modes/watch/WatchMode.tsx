// Owner: T3a, U1. Watch bottom panel: "Who's dispatching?" (Baseline / Hand-written / AI champion, or a Lab replay),
// a same-crowd comparison strip (all three run headlessly on this crowd), and the latest rule that actually fired.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { scenarioDef } from '@headway/sim';
import type { DecisionRecord, Policy, ScenarioInstance } from '@headway/sim';
import { useApp } from '../../state/store';
import type { WatchController } from '../../state/store';
import { safeClock } from '../../state/hud';
import { showcaseInstances } from '../../sim/session';
import { NextIcon } from '../../ui/shell/icons';
import { cachedComparison, compareCacheKey, compareCrowd } from './compare';
import type { CompareRow } from './compare';
import './watch.css';

const prettyScenario = (id: string) => id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function scenarioName(id: string, fromObs: string | undefined): string {
  if (fromObs) return fromObs;
  try { return scenarioDef(id).name; } catch { return prettyScenario(id); }
}

function vehicleName(id: string): string {
  const bus = /^b(\d+)$/.exec(id);
  if (bus) return `Bus ${bus[1]}`;
  if (/^t\d*$/.test(id)) return 'Train';
  return id;
}

const PreviewTag = () => (
  <span className="hw-watch__tag" title="The real simulation engine is not loaded yet: this preview sim moves vehicles and people but makes no real decisions.">
    PREVIEW SIM
  </span>
);

function Ticker({ rec, clockStart, preview }: { rec: DecisionRecord | undefined; clockStart: string | undefined; preview: boolean }) {
  const phase = useApp((s) => s.hud?.phase);
  let body;
  if (phase === 'done') {
    body = <span className="hw-watch__ticker-text">Run complete. New crowd in a moment.</span>;
  } else if (!rec) {
    body = <span className="hw-watch__ticker-text">Click a bus, train or stop to see why.</span>;
  } else {
    body = (
      <>
        <span className="hw-src" data-src={rec.source} title={`Decided by: ${rec.source}`} />
        <span key={`${rec.dpId}:${rec.vehicleId}`} className="hw-watch__ticker-text">
          {clockStart && <span className="hw-num">{safeClock(clockStart, rec.t)}&ensp;</span>}
          <b>{vehicleName(rec.vehicleId)}</b>&ensp;{rec.explanation || rec.ruleId}
        </span>
      </>
    );
  }
  return (
    <div className="hw-watch__ticker" aria-live="polite">
      {body}
      {preview && <PreviewTag />}
    </div>
  );
}

const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const ClockIcon = () => <svg {...icon}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
const LeaveIcon = () => <svg {...icon}><circle cx="10" cy="5" r="2.2" /><path d="M10 9v6l-3 6M10 15l3 6M7 11.5h6M16 9l4 4M20 9l-4 4" /></svg>;
const HomeIcon = () => <svg {...icon}><path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5M10 20v-5h4v5" /></svg>;

const CONTROLLERS: WatchController[] = ['g0', 'ref', 'champion'];
type Metric = { label: string; icon: ReactNode; get(r: CompareRow): number; fmt(v: number): [string, string]; hint: string; best: 'low' | 'high'; badge: string };
const METRICS: Metric[] = [
  { label: 'Avg wait', icon: <ClockIcon />, get: (r) => r.waitS, fmt: (v) => [(v / 60).toFixed(1), 'min'], hint: 'lower is better', best: 'low', badge: 'Fastest' },
  { label: 'Gave up', icon: <LeaveIcon />, get: (r) => r.gaveUp, fmt: (v) => [String(Math.round(v)), ''], hint: 'riders who walked away, lower is better', best: 'low', badge: 'Fewest' },
  { label: 'Got home', icon: <HomeIcon />, get: (r) => r.homePct, fmt: (v) => [String(Math.round(v)), '%'], hint: 'higher is better', best: 'high', badge: 'Most' },
];

/** Friendly crowd name: never show a seed. Showcase crowds cycle Crowd 1..3; the Play seed is tonight's game crowd. */
function crowdName(scenario: ScenarioInstance, showcase: ScenarioInstance[], playSeed: number): string {
  const i = showcase.findIndex((c) => c.scenarioId === scenario.scenarioId && c.seed === scenario.seed);
  if (i >= 0) return `Crowd ${(i % 3) + 1}`;
  if (playSeed && scenario.seed === playSeed) return 'Tonight\u2019s game crowd';
  return 'Crowd';
}

/** All three controllers on this crowd (cached per crowd; computed after paint so the panel never blocks). */
function useComparison(scenario: ScenarioInstance | undefined, champion: Policy | null): CompareRow[] | null | undefined {
  const key = scenario ? compareCacheKey(scenario, champion) : '';
  const [state, setState] = useState<{ key: string; rows: CompareRow[] | null | undefined }>({ key: '', rows: undefined });
  useEffect(() => {
    if (!scenario) return;
    const hit = cachedComparison(scenario, champion);
    if (hit !== undefined) { setState({ key, rows: hit }); return; }
    const t = setTimeout(() => setState({ key, rows: compareCrowd(scenario, champion) }), 30);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!scenario) return undefined;
  return state.key === key ? state.rows : cachedComparison(scenario, champion);
}

export function WatchMode() {
  const controller = useApp((s) => s.watchController);
  const override = useApp((s) => s.watchOverride);
  const champion = useApp((s) => s.champion);
  const session = useApp((s) => s.session);
  const showcaseIndex = useApp((s) => s.showcaseIndex);
  const simKind = useApp((s) => s.simKind);
  const scenarioLabel = useApp((s) => s.observation?.scenario.name);
  const clockStart = useApp((s) => s.observation?.scenario.clockStart);
  const latest = useApp((s) => s.decisions[0]);
  const setController = useApp((s) => s.setWatchController);
  const nextShowcase = useApp((s) => s.nextShowcase);
  const playSeed = useApp((s) => s.play.seed);
  const setMode = useApp((s) => s.setMode);

  const crowds = showcaseInstances();
  const scenario = session?.scenario;
  const champPolicy = champion?.policy ?? null;
  const rows = useComparison(scenario, champPolicy);
  const selected: WatchController | null = override ? null : controller;
  const options: Array<{ value: WatchController; label: string; title: string }> = [
    { value: 'g0', label: 'Baseline', title: 'The simple starting rules' },
    { value: 'ref', label: 'Hand-written', title: 'Rules a person wrote by hand' },
    { value: 'champion', label: 'AI champion', title: champPolicy?.meta.summary ?? 'The best rules the AI has evolved so far' },
  ];
  const name = (k: WatchController) => options.find((o) => o.value === k)!.label;
  const runKey = scenario ? compareCacheKey(scenario, champPolicy) : '';

  return (
    <section className="hw-card hw-watch hw-watch--cmp" aria-label="Watch">
      <div className="hw-watch__head">
        <h2 className="hw-watch__h">
          Who&rsquo;s dispatching?
          <span className="hw-watch__crowd">
            {scenario ? `${scenarioName(scenario.scenarioId, scenarioLabel)} · ${crowdName(scenario, crowds, playSeed)}` : 'Loading the town…'}
          </span>
        </h2>
        {override && <span className="hw-watch__pill" title={override.policy.meta.summary}>{override.label}</span>}
        {override && (
          <button type="button" className="hw-btn hw-btn--ghost" onClick={() => setMode('lab')} title="Back to the Lab (the replay keeps running)">
            Back to Lab
          </button>
        )}
        <button
          type="button" className="hw-btn hw-btn--ghost" onClick={nextShowcase}
          title={`Same town, new random riders (${(showcaseIndex % crowds.length) + 1} of ${crowds.length})`}
        >
          New crowd <NextIcon />
        </button>
      </div>

      <div className="hw-cmp" data-sel={selected ?? ''}>
        <span className="hw-cmp__corner">Same crowd</span>
        {options.map((o) => (
          <button
            key={o.value} type="button" className="hw-cmp__who" data-k={o.value} data-on={o.value === selected}
            aria-pressed={o.value === selected} title={o.title} onClick={() => setController(o.value)}
          >
            <i aria-hidden="true" />{o.label}
          </button>
        ))}
        {rows === null ? null : rows === undefined ? (
          <span className="hw-cmp__pending" aria-hidden="true" />
        ) : (
          METRICS.map((m, mi) => {
            const vals = CONTROLLERS.map((k) => m.get(rows.find((r) => r.key === k)!));
            const max = Math.max(...vals, 1e-9);
            const top = m.best === 'low' ? Math.min(...vals) : Math.max(...vals);
            const tie = vals.every((v) => v === top);
            const last = mi === METRICS.length - 1;
            return [
              <span key={`${m.label}:l`} className="hw-cmp__label" title={m.hint}>{m.icon}{m.label}</span>,
              ...CONTROLLERS.map((k, i) => {
                const [num, unit] = m.fmt(vals[i]!);
                const win = !tie && vals[i] === top;
                return (
                  <div
                    key={`${m.label}:${k}`} className="hw-cmp__cell" data-k={k} data-on={k === selected} data-last={last}
                    title={`${name(k)}: ${num}${unit ? ` ${unit}` : ''} (${m.hint})`}
                    onClick={() => setController(k)}
                  >
                    <span className="hw-cmp__val">
                      <b>{num}</b>{unit && <small>{unit}</small>}
                      {win && <em key={runKey} className="hw-cmp__badge">{m.badge}</em>}
                    </span>
                    <span className="hw-cmp__track">
                      <span key={runKey} className="hw-cmp__fill" style={{ width: `${Math.max(6, (100 * vals[i]!) / max)}%`, animationDelay: `${mi * 70 + i * 40}ms` }} />
                    </span>
                  </div>
                );
              }),
            ];
          })
        )}
      </div>

      <Ticker rec={latest} clockStart={clockStart} preview={simKind === 'stub'} />
    </section>
  );
}
