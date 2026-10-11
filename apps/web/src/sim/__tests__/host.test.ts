import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G0 } from '@headway/sim';
import type { DecisionRecord, SimEvent } from '@headway/sim';
import type { Pick, TownRendererApi } from '../../render/types';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { startHost } from '../host';
import type { HeadwayProbe } from '../host';
import type { SessionSpec } from '../session';
import { fakeSim } from './fakeSim';
import type { FakeSim } from './fakeSim';

const initial = useApp.getState();
const spec = (key = 'watch:test'): SessionSpec =>
  ({ key, scenario: { scenarioId: 'stadium_exit', seed: 4001, split: 'showcase' }, policy: G0, label: 'Baseline g0' });

function fakeRenderer() {
  const calls = { render: 0, highlight: [] as Array<string | null>, light: [] as string[], select: [] as Array<Pick | null>, disposed: 0 };
  let pickResult: Pick | null = { kind: 'bus', id: 'b1' };
  const r: TownRendererApi & { calls: typeof calls; setPick(p: Pick | null): void } = {
    calls,
    setPick(p) { pickResult = p; },
    render() { calls.render++; },
    pick() { return pickResult; },
    select(p) { calls.select.push(p); },
    highlightRoute(id) { calls.highlight.push(id); },
    setPalette() {}, setDetail() {},
    setLight(l) { calls.light.push(l); },
    project() { return { x: 0, y: 0, visible: false }; },
    resize() {}, dispose() { calls.disposed++; },
  };
  return r;
}

function harness() {
  const rafs: Array<(t: number) => void> = [];
  const handlers: Record<string, (e: unknown) => void> = {};
  const win = {
    requestAnimationFrame(cb: (t: number) => void) { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const canvas = {
    style: {} as Record<string, string>,
    addEventListener(type: string, fn: (e: unknown) => void) { handlers[type] = fn; },
    removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  let now: number | null = null; // starts at the first frames() call, after the host captured its clock
  const frames = (n: number, ms = 1000 / 64) => {
    if (now === null) now = Math.ceil(performance.now()) + 1; // integer start: 15.625 ms steps stay exact
    for (let i = 0; i < n; i++) { now += ms; rafs.shift()!(now); }
  };
  const probe = () => (win as unknown as { __headway: HeadwayProbe }).__headway;
  return { win, canvas, container: {} as HTMLElement, frames, probe, handlers };
}

let stop: () => void = () => {};
let sims: FakeSim[] = [];
const makeSim = () => { const sim = fakeSim(); sims.push(sim); return { sim, kind: 'real' as const, error: null }; };

beforeEach(() => { useApp.setState(initial, true); sims = []; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { stop(); vi.restoreAllMocks(); });

describe('canvas host', () => {
  it('renders every frame, steps the sim and reports through the probe', () => {
    const h = harness();
    const r = fakeRenderer();
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim, makeRenderer: () => r });
    expect(frame.runner).not.toBeNull();
    expect(frame.renderer).toBe(r);
    expect(useApp.getState().simKind).toBe('real');
    h.frames(64); // 1 s at 8×
    expect(r.calls.render).toBe(64);
    expect(sims[0]!.t).toBe(8);
    expect(h.probe()).toMatchObject({ t: 8, mode: 'watch', ready: true, sim: 'real', renderer: 'three', session: 'watch:test' });
  });

  it('feeds the HUD at ~4 Hz, not every frame', () => {
    const h = harness();
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim, makeRenderer: () => fakeRenderer() });
    const setHud = vi.fn();
    const unsub = useApp.subscribe((s, p) => { if (s.hud !== p.hud) setHud(); });
    h.frames(128); // 2 s
    unsub();
    expect(setHud.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(setHud.mock.calls.length).toBeLessThanOrEqual(9);
    const hud = useApp.getState().hud!;
    expect(hud.t).toBeGreaterThanOrEqual(12); // sampled at 4 Hz: at most 250 ms (2 sim-s at 8×) stale
    expect(hud.t).toBeLessThanOrEqual(16);
    expect(hud.clock).toBe('21:30');
    expect(hud.completionPct).toBe(50);
  });

  it('turns events into toasts and keeps the latest non-default decisions', () => {
    const h = harness();
    const rec = (dpId: number, source: DecisionRecord['source']): SimEvent => ({
      t: dpId, kind: 'decision',
      record: { dpId, t: dpId, kind: 'bus_at_stop', vehicleId: 'b2', features: {}, action: { type: 'continue' }, ruleId: 'r', explanation: `d${dpId}`, source },
    });
    const sim = fakeSim();
    sim.eventsAt.set(3, [{ t: 3, kind: 'transfer_made', personId: 1, at: { kind: 'platform', id: 'stn_central' } }, rec(3, 'policy')]);
    sim.eventsAt.set(4, [rec(4, 'default'), rec(5, 'human')]);
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim: () => ({ sim, kind: 'real', error: null }), makeRenderer: () => fakeRenderer() });
    h.frames(64);
    const toasts = useApp.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'transfer', simT: 3 });
    expect(toasts[0]!.text).toMatch(/^Transfer made at /);
    expect(useApp.getState().decisions.map((d) => d.explanation)).toEqual(['d5', 'd3']);
  });

  it('syncs pause/speed both ways between the store and the runner', () => {
    const h = harness();
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim, makeRenderer: () => fakeRenderer() });
    useApp.getState().setPaused(true);
    h.frames(64);
    expect(sims[0]!.t).toBe(0);
    useApp.getState().setPaused(false);
    useApp.getState().setSpeed(16);
    h.frames(64);
    expect(sims[0]!.t).toBe(16);
    frame.runner!.pause(); // e.g. Play pausing the runner directly
    h.frames(1);
    expect(useApp.getState().paused).toBe(true);
    frame.runner!.setSpeed(4);
    h.frames(1);
    expect(useApp.getState().speed).toBe(4);
  });

  it('rebuilds on a new session key or restartSession, and clears the stale HUD', () => {
    const h = harness();
    useApp.getState().loadSession(spec('a'));
    stop = startHost({ ...h, makeSim, makeRenderer: () => fakeRenderer() });
    h.frames(64);
    expect(useApp.getState().hud).not.toBeNull();
    useApp.getState().loadSession(spec('b'));
    expect(sims).toHaveLength(2);
    expect(frame.runner!.sim).toBe(sims[1]);
    expect(useApp.getState().hud).toBeNull();
    useApp.getState().restartSession();
    expect(sims).toHaveLength(3);
    expect(frame.runner!.next.t).toBe(0);
  });

  it('click picks and selects; a drag does not; store changes reach the renderer', () => {
    const h = harness();
    const r = fakeRenderer();
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim, makeRenderer: () => r });
    const ev = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, pointerType: 'mouse' });
    h.handlers.pointerdown!(ev(100, 100));
    h.handlers.pointerup!(ev(102, 101));
    expect(useApp.getState().selection).toEqual({ kind: 'bus', id: 'b1' });
    expect(r.calls.select.at(-1)).toEqual({ kind: 'bus', id: 'b1' });
    r.setPick(null);
    h.handlers.pointerdown!(ev(100, 100));
    h.handlers.pointerup!(ev(180, 140)); // pan
    expect(useApp.getState().selection).toEqual({ kind: 'bus', id: 'b1' });
    h.handlers.pointerdown!(ev(100, 100));
    h.handlers.pointerup!(ev(100, 100)); // click on empty ground clears
    expect(useApp.getState().selection).toBeNull();
    useApp.getState().highlightRoute('r2');
    useApp.getState().setView({ light: 'dusk' });
    expect(r.calls.highlight.at(-1)).toBe('r2');
    expect(r.calls.light.at(-1)).toBe('dusk');
  });

  it('a crashing engine falls back to the stub sim instead of freezing', () => {
    const h = harness();
    const bad = fakeSim();
    bad.throwAt = 5;
    const stub = fakeSim();
    useApp.getState().loadSession(spec());
    stop = startHost({ ...h, makeSim: () => ({ sim: bad, kind: 'real', error: null }), makeFallback: () => stub, makeRenderer: () => fakeRenderer() });
    h.frames(64);
    expect(useApp.getState().simKind).toBe('stub');
    expect(frame.runner!.sim).toBe(stub);
    h.frames(64);
    expect(stub.t).toBeGreaterThan(0);
  });

  it('with no session renders the empty town and is not ready; dispose releases everything', () => {
    const h = harness();
    const r = fakeRenderer();
    stop = startHost({ ...h, makeSim, makeRenderer: () => r });
    h.frames(3);
    expect(r.calls.render).toBe(3);
    expect(h.probe().ready).toBe(false);
    expect(useApp.getState().simKind).toBe('none');
    stop();
    stop = () => {};
    expect(r.calls.disposed).toBe(1);
    expect(frame.renderer).toBeNull();
    expect(frame.runner).toBeNull();
  });
});
