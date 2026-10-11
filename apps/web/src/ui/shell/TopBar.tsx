// Top bar frame (T3a): wordmark + mode tabs | T3b ScenarioChip + SpeedControls | T3b MetricsCluster + view/about.
import { useApp } from '../../state/store';
import type { Mode } from '../../state/store';
import { MetricsCluster } from '../hud/MetricsCluster';
import { ScenarioChip } from '../hud/ScenarioChip';
import { SpeedControls } from '../hud/SpeedControls';
import { InfoIcon, MoonIcon, SunIcon } from './icons';
import { Segmented } from './Segmented';
import { Slot } from './Slot';

/** One tiny purpose line per mode, shown under the tabs. */
export const PURPOSE: Record<Mode, string> = {
  watch: 'The AI runs the town',
  play: 'Beat the AI on the same crowd',
  lab: 'How the AI improved',
};

const MODES: Array<{ value: Mode; label: string; title: string }> = [
  { value: 'watch', label: 'Watch', title: `Watch: ${PURPOSE.watch}` },
  { value: 'play', label: 'Play', title: `Play: ${PURPOSE.play}` },
  { value: 'lab', label: 'Lab', title: `Lab: ${PURPOSE.lab}` },
];

export function Wordmark() {
  const setMode = useApp((s) => s.setMode);
  return (
    <button type="button" className="hw-wordmark" onClick={() => setMode('watch')} aria-label="Headway — back to Watch">
      HEADWAY
      <span className="hw-wordmark__dots" aria-hidden="true"><i /><i /><i /></span>
    </button>
  );
}

function Purpose() {
  const mode = useApp((s) => s.mode);
  return <span key={mode} className="hw-purpose" aria-live="polite">{PURPOSE[mode]}</span>;
}

export function ModeTabs() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  return <Segmented role="tablist" label="Mode" className="hw-tabs" value={mode} options={MODES} onChange={setMode} />;
}

function ViewButtons() {
  const light = useApp((s) => s.light);
  const setView = useApp((s) => s.setView);
  const setAbout = useApp((s) => s.setAbout);
  const about = useApp((s) => s.about);
  const dusk = light === 'dusk';
  return (
    <div className="hw-card hw-island hw-island--tight">
      <button
        type="button" className="hw-icon-btn" onClick={() => setView({ light: dusk ? 'day' : 'dusk' })}
        aria-label={dusk ? 'Switch to day' : 'Switch to dusk'} title={dusk ? 'Day' : 'Dusk'}
      >
        {dusk ? <SunIcon /> : <MoonIcon />}
      </button>
      <button
        type="button" className="hw-icon-btn" onClick={() => setAbout(!about)} aria-label="About Headway" title="About (?)"
        aria-haspopup="dialog" aria-expanded={about}
      >
        <InfoIcon />
      </button>
    </div>
  );
}

export function TopBar() {
  const showHud = useApp((s) => s.mode !== 'lab');
  return (
    <header className="hw-topbar">
      <div className="hw-topbar__left">
        <nav className="hw-card hw-island hw-island--nav" aria-label="Headway">
          <Wordmark />
          <ModeTabs />
          <Purpose />
        </nav>
      </div>
      <div className="hw-topbar__center">
        {showHud && (
          <>
            <Slot name="ScenarioChip"><ScenarioChip /></Slot>
            <Slot name="SpeedControls"><SpeedControls /></Slot>
          </>
        )}
      </div>
      <div className="hw-topbar__right">
        {showHud && <Slot name="MetricsCluster"><MetricsCluster /></Slot>}
        <ViewButtons />
      </div>
    </header>
  );
}
