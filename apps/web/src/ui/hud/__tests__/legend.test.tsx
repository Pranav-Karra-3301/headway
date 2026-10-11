import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Observation } from '@headway/sim';
import { LegendView, pickBusFor } from '../RouteLegend';

type Bus = Observation['buses'][number];
const bus = (id: string, routeId: Bus['routeId'], state: Bus['state'] = 'moving'): Bus => ({
  id, routeId, state, onboard: 0, capacity: 40, nextStopId: null, etaNextStopS: 30, holdUntil: null,
  headwayAheadS: null, headwayBehindS: null, holdUsedS: 0,
});
const obs = (buses: Bus[]) => ({ buses, routes: [] } as unknown as Observation);

describe('pickBusFor', () => {
  it('takes from the route with the most buses, preferring one at its terminal', () => {
    const o = obs([bus('b1', 'r1'), bus('b2', 'r1'), bus('b3', 'r2'), bus('b4', 'r2'), bus('b5', 'r2', 'layover'), bus('b6', 'r3')]);
    expect(pickBusFor(o, 'r3')).toBe('b5');
  });
  it('never takes a route\'s last bus, nor a bus already moving', () => {
    const o = obs([bus('b1', 'r1'), bus('b2', 'r1'), bus('b3', 'r2'), bus('b6', 'r3')]);
    const pending = [{ id: 1, t: 0, intent: { type: 'reassign' as const, vehicleId: 'b1', to: 'r2' as const }, status: 'pending' as const, appliedT: null, result: null, sawMoving: false }];
    expect(pickBusFor(o, 'r3')).toBe('b1');
    expect(pickBusFor(o, 'r3', pending)).toBeNull();
    expect(pickBusFor(null, 'r1')).toBeNull();
  });
});

describe('LegendView move button', () => {
  it('shows bus icons, a pending badge and disables when no bus can move', () => {
    const s = renderToStaticMarkup(
      <LegendView highlighted={null} onToggle={() => {}} onMove={() => {}} routes={[
        { id: 'r1', name: 'Campus Loop', color: '#1FA99A', buses: 3, queue: 5, move: 'b4', pending: 1 },
        { id: 'r2', name: 'Apartments', color: '#F0A830', buses: 1, queue: 0, move: null },
      ]} />,
    );
    expect(s).toContain('×3');
    expect(s).toContain('Move a bus here');
    expect(s).toContain('hud-lg-pending');
    expect(s.match(/disabled=""/g)).toHaveLength(1);
  });
});
