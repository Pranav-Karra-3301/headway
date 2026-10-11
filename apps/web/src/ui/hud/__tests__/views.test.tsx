import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Inspector, InspectorCard } from '../Inspector';
import { MetricsCluster, MetricsView } from '../MetricsCluster';
import { QueueMarkers } from '../QueueMarkers';
import { LegendView, RouteLegend } from '../RouteLegend';
import { ScenarioChip, ScenarioView } from '../ScenarioChip';
import { SpeedControls, SpeedView } from '../SpeedControls';
import { ToastView, Toasts } from '../Toasts';
import { stopModel, vehicleModel } from '../inspect';
import { obsAt, snapAt, vehicle, withStop } from './fixtures';

const noop = () => {};
const html = (el: ReactElement) => renderToStaticMarkup(el);

describe('HUD containers render with an empty store (no sim yet)', () => {
  it('render without throwing', () => {
    for (const C of [MetricsCluster, SpeedControls, ScenarioChip, RouteLegend, QueueMarkers, Inspector, Toasts]) {
      expect(() => html(<C />)).not.toThrow();
    }
  });
  it('inspector and toasts render nothing without a selection or toasts', () => {
    expect(html(<Inspector />)).toBe('');
    expect(html(<Toasts />)).toContain('hud-toasts');
  });
});

describe('MetricsView', () => {
  const hud = {
    t: 660, clock: '21:41', phase: 'running' as const, meanWaitS: 192, completionPct: 64.4, missedConnections: 12,
    waitingNow: 143, ridingNow: 88, jSoFar: 50000,
  };
  it('shows mean wait, completion, missed connections and waiting now', () => {
    const s = html(<MetricsView hud={hud} pace={null} paceClock={null} />);
    expect(s).toContain('Mean wait');
    expect(s).toContain('3:12');
    expect(s).toContain('64%');
    expect(s).toContain('Missed');
    expect(s).toContain('>12<');
    expect(s).toContain('143');
    expect(s).toContain('data-sev="warn"');
    expect(s).not.toContain('vs AI');
  });
  it('shows the Play pace chip, green when ahead', () => {
    const s = html(<MetricsView hud={hud} pace={{ vsAiPaxH: 6.24, vsBaselinePaxH: 9.1, ahead: true, t: 660 }} paceClock="21:41" />);
    expect(s).toContain('vs AI');
    expect(s).toContain('+6.2');
    expect(s).toContain('pax-h');
    expect(s).toContain('data-ahead="true"');
  });
  it('shows placeholders before the first HUD tick', () => {
    expect(html(<MetricsView hud={null} pace={null} paceClock={null} />)).toContain('—');
  });
});

describe('SpeedView', () => {
  it('marks the active speed and the pause state', () => {
    const s = html(<SpeedView speed={8} paused={false} onSpeed={noop} onToggle={noop} />);
    expect(s).toContain('aria-pressed="true"');
    expect(s).toMatch(/aria-pressed="true"[^>]*>8×</);
    expect(s).toContain('aria-label="Pause"');
    const p = html(<SpeedView speed={1} paused={true} onSpeed={noop} onToggle={noop} />);
    expect(p).toContain('aria-label="Play"');
  });
});

describe('ScenarioView', () => {
  it('shows the scenario, the clock and the next advertised event', () => {
    const s = html(
      <ScenarioView name="Stadium exit" clock="21:38" t={480} durationS={1800} clearingS={900} phase="running"
        events={[{ kind: 'stadium_closing', t: 600, label: 'Stadium closing' }]} clockStart="21:30" />,
    );
    expect(s).toContain('Stadium exit');
    expect(s).toContain('21:38');
    expect(s).toContain('Stadium closing in 2:00');
  });
  it('says when the run is clearing or done', () => {
    expect(html(<ScenarioView name="Stadium exit" clock="22:05" t={2100} durationS={1800} clearingS={900} phase="clearing" events={[]} clockStart="21:30" />))
      .toContain('No new riders');
    expect(html(<ScenarioView name="Stadium exit" clock="22:15" t={2700} durationS={1800} clearingS={900} phase="done" events={[]} clockStart="21:30" />))
      .toContain('Run complete');
  });
});

describe('LegendView', () => {
  it('lists routes with live counts and marks the highlighted one', () => {
    const s = html(
      <LegendView highlighted="r2" onToggle={noop} routes={[
        { id: 'r1', name: 'Campus Loop', color: '#1FA99A', buses: 2, queue: 14 },
        { id: 'r2', name: 'Apartments', color: '#F0A830', buses: 3, queue: 40 },
        { id: 'r3', name: 'Stadium', color: '#8A6BD8', buses: 1, queue: 0 },
      ]} />,
    );
    expect(s).toContain('Campus Loop');
    expect(s).toContain('3 buses');
    expect(s).toContain('1 bus');
    expect(s).toContain('40 waiting');
    expect(s).toContain('data-dim="true"');
    expect(s.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe('InspectorCard', () => {
  it('renders a bus with occupancy, next stop and the rule that fired', () => {
    const snap = snapAt(700, [vehicle('b4', {
      routeId: 'r2', onboard: 28, lastDecision: {
        dpId: 1, t: 690, kind: 'bus_at_stop', vehicleId: 'b4', features: {}, action: { type: 'hold', seconds: 45 },
        ruleId: 'hold_for_train', source: 'policy', explanation: 'Holding 45 s for the train (34 s away, 14 transfers)',
      },
    })]);
    const m = vehicleModel('b4', obsAt(700), snap, null)!;
    const s = html(<InspectorCard model={{ kind: 'vehicle', m }} palette="a" onClose={noop} />);
    expect(s).toContain('Bus b4');
    expect(s).toContain('28');
    expect(s).toContain('Holding 45 s for the train');
    expect(s).toContain('hold_for_train');
    expect(s).toContain('aria-label="Close"');
  });
  it('renders a stop with its queue by route', () => {
    const obs = withStop(obsAt(900), 'stop_downtown', { queue: 17, queueByRoute: { r1: 12, r3: 5 }, longestWaitS: 300 });
    const m = stopModel('stop_downtown', obs, null)!;
    const s = html(<InspectorCard model={{ kind: 'stop', m }} palette="a" onClose={noop} />);
    expect(s).toContain('Downtown');
    expect(s).toContain('17');
    expect(s).toContain('5:00');
  });
});

describe('ToastView', () => {
  it('renders each toast with its kind and sim clock', () => {
    const s = html(
      <ToastView clockStart="21:30" onDismiss={noop} onHold={noop} toasts={[
        { id: 1, kind: 'alert', text: 'Stadium closing in 2:00', simT: 480 },
        { id: 2, kind: 'missed', text: 'Missed connection at Central', simT: 700 },
      ]} />,
    );
    expect(s).toContain('Stadium closing in 2:00');
    expect(s).toContain('data-kind="missed"');
    expect(s).toContain('21:38');
    expect(s).toContain('21:41');
  });
});
