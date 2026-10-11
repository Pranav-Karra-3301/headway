// Owner: T3a. Watch mode overlay: which dispatcher runs (g0 / ref / champion, or a Lab replay), which showcase crowd,
// and a ticker with the latest rule that actually fired.
import { scenarioDef } from '@headway/sim';
import type { DecisionRecord } from '@headway/sim';
import { useApp } from '../../state/store';
import type { WatchController } from '../../state/store';
import { safeClock } from '../../state/hud';
import { showcaseInstances } from '../../sim/session';
import { NextIcon } from '../../ui/shell/icons';
import { Segmented } from '../../ui/shell/Segmented';

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
    body = <span className="hw-watch__ticker-text">Run complete. The next crowd starts in a few seconds.</span>;
  } else if (!rec) {
    body = <span className="hw-watch__ticker-text">Click a bus, the train or a stop to see what it is doing and why.</span>;
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
  const setMode = useApp((s) => s.setMode);

  const crowds = showcaseInstances();
  const scenario = session?.scenario;
  const champId = champion?.policy.meta.id;
  const options: Array<{ value: WatchController | 'replay'; label: string; title: string }> = [
    { value: 'g0', label: 'Baseline g0', title: 'The hand-written baseline every generation started from' },
    { value: 'ref', label: 'Reference', title: 'A queue-responsive policy written by hand, for comparison' },
    { value: 'champion', label: champId && champId !== 'g0' ? `Champion ${champId}` : 'Champion', title: champion?.policy.meta.summary ?? 'The best evolved policy so far' },
  ];
  if (override) options.push({ value: 'replay', label: override.label, title: override.policy.meta.summary });

  return (
    <section className="hw-card hw-watch" aria-label="Watch">
      <div className="hw-watch__row">
        <div className="hw-watch__title">
          <span className="hw-label">Watching</span>
          <span className="hw-watch__scenario">
            {scenario ? scenarioName(scenario.scenarioId, scenarioLabel) : 'Loading the town…'}
            {scenario && <span style={{ color: 'var(--ink-3)' }}>&ensp;·&ensp;crowd {scenario.seed}</span>}
          </span>
        </div>
        <Segmented
          label="Dispatcher"
          value={override ? 'replay' : controller}
          options={options}
          onChange={(v) => { if (v !== 'replay') setController(v); }}
        />
        {override && (
          <button type="button" className="hw-btn hw-btn--ghost" onClick={() => setMode('lab')} title="Back to the Lab (the replay keeps running)">
            Back to Lab
          </button>
        )}
        <button
          type="button" className="hw-btn hw-btn--ghost" onClick={nextShowcase}
          title={`Next showcase crowd (${(showcaseIndex % crowds.length) + 1} of ${crowds.length})`}
        >
          Next crowd <NextIcon />
        </button>
      </div>
      <Ticker rec={latest} clockStart={clockStart} preview={simKind === 'stub'} />
    </section>
  );
}
