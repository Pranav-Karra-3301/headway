// App shell (T3a). Layout contract for the components mounted here:
//
//  .hw-app (full viewport, position: relative)
//   ├─ CanvasHost            .hw-stage: the 3D town canvas (inset 0)
//   ├─ QueueMarkers          .hw-markers: same box as the canvas (inset 0, pointer-events none), so
//   │                        frame.renderer.project() pixels map 1:1 to `left/top` inside it
//   ├─ .hw-hud               grid overlay (pointer-events none; direct children of an area get them back)
//   │   ├─ top bar           [wordmark · Watch Play Lab] [ScenarioChip · SpeedControls] [MetricsCluster · About]
//   │   │                    → these three render in-flow chips (no positioning needed)
//   │   ├─ area "right"      Inspector (top-right, under the bar)
//   │   ├─ area "left"       RouteLegend (bottom-left)
//   │   ├─ area "bottom"     WatchMode card (watch) — Play's dock goes here too if it renders in-flow
//   │   └─ area "toasts"     Toasts (bottom-right)
//   ├─ PlayMode / LabMode    mounted directly in .hw-app: position yourself (absolute/fixed), use
//   │                        var(--hw-top) for the top bar's bottom edge and var(--hw-gap) for margins
//   └─ Landing, AboutPanel   mounted directly in .hw-app (modals / title card)
//
// Every track component sits in a <Slot> error boundary so one crash cannot blank the app.
import { useEffect } from 'react';
import { useApp } from './state/store';
import { startRouter } from './state/router';
import { startDirector } from './sim/director';
import { applyTheme } from './styles/theme';
import { CanvasHost } from './ui/shell/CanvasHost';
import { TopBar } from './ui/shell/TopBar';
import { Slot } from './ui/shell/Slot';
import { WatchMode } from './modes/watch/WatchMode';
import { PlayMode } from './modes/play/PlayMode';
import { LabMode } from './modes/lab/LabMode';
import { QueueMarkers } from './ui/hud/QueueMarkers';
import { Inspector } from './ui/hud/Inspector';
import { RouteLegend } from './ui/hud/RouteLegend';
import { Toasts } from './ui/hud/Toasts';
import { Landing } from './ui/landing/Landing';
import { AboutPanel } from './ui/about/AboutPanel';

export function App() {
  const mode = useApp((s) => s.mode);
  const palette = useApp((s) => s.palette);
  const light = useApp((s) => s.light);

  useEffect(() => startRouter(useApp), []);
  useEffect(() => startDirector(), []);
  useEffect(() => applyTheme(palette, light), [palette, light]);

  const lab = mode === 'lab';
  return (
    <div className="hw-app" data-mode={mode} data-light={light}>
      <CanvasHost />
      {!lab && (
        <div className="hw-markers" aria-hidden="true">
          <Slot name="QueueMarkers"><QueueMarkers /></Slot>
        </div>
      )}
      <div className="hw-hud">
        <TopBar />
        {!lab && (
          <>
            <div className="hw-area hw-area--right"><Slot name="Inspector"><Inspector /></Slot></div>
            <div className="hw-area hw-area--left"><Slot name="RouteLegend"><RouteLegend /></Slot></div>
          </>
        )}
        <div className="hw-area hw-area--bottom">
          {mode === 'watch' && <Slot name="WatchMode"><WatchMode /></Slot>}
        </div>
        <div className="hw-area hw-area--toasts"><Slot name="Toasts"><Toasts /></Slot></div>
      </div>
      {mode === 'play' && <Slot name="PlayMode"><PlayMode /></Slot>}
      {lab && <Slot name="LabMode"><LabMode /></Slot>}
      <Slot name="Landing"><Landing /></Slot>
      <Slot name="AboutPanel"><AboutPanel /></Slot>
    </div>
  );
}
