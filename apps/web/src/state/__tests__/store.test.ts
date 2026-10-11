import { beforeEach, describe, expect, it } from 'vitest';
import { G0, REF } from '@headway/sim';
import { useApp } from '../store';
import { selectIsLive, selectShowHud, selectWatchLabel, severityOf } from '../selectors';
import { parsePath, pathFor } from '../router';

const initial = useApp.getState();
beforeEach(() => useApp.setState(initial, true));

describe('store actions', () => {
  it('keeps at most 4 toasts, newest last, and dismisses by id', () => {
    const s = useApp.getState();
    for (let i = 0; i < 6; i++) s.pushToast({ kind: 'info', text: `t${i}`, simT: i });
    const toasts = useApp.getState().toasts;
    expect(toasts.map((t) => t.text)).toEqual(['t2', 't3', 't4', 't5']);
    useApp.getState().dismissToast(toasts[0]!.id);
    expect(useApp.getState().toasts.map((t) => t.text)).toEqual(['t3', 't4', 't5']);
  });

  it('setMode clears the selection; same mode is a no-op', () => {
    useApp.getState().select({ kind: 'bus', id: 'b1' });
    useApp.getState().setMode('watch');
    expect(useApp.getState().selection).toEqual({ kind: 'bus', id: 'b1' });
    useApp.getState().setMode('lab');
    expect(useApp.getState().selection).toBeNull();
    expect(useApp.getState().mode).toBe('lab');
  });

  it('loadSession ignores the same key; restartSession bumps the nonce', () => {
    const spec = { key: 'watch:a', scenario: { scenarioId: 'stadium_exit', seed: 1, split: 'showcase' as const }, policy: G0, label: 'x' };
    useApp.getState().loadSession(spec);
    const first = useApp.getState().session;
    useApp.getState().loadSession({ ...spec });
    expect(useApp.getState().session).toBe(first);
    const n = useApp.getState().sessionNonce;
    useApp.getState().restartSession();
    expect(useApp.getState().sessionNonce).toBe(n + 1);
  });

  it('replayPolicy switches to Watch with an override; picking a controller clears it', () => {
    useApp.getState().setMode('lab');
    useApp.getState().replayPolicy(REF, 'Replay ref');
    let s = useApp.getState();
    expect(s.mode).toBe('watch');
    expect(s.watchOverride?.policy.meta.id).toBe('ref');
    expect(selectWatchLabel(s)).toBe('Replay ref');
    s.setWatchController('g0');
    s = useApp.getState();
    expect(s.watchOverride).toBeNull();
    expect(selectWatchLabel(s)).toBe('Baseline g0');
  });

  it('nextShowcase advances; resetPlay starts at the intro', () => {
    useApp.getState().nextShowcase();
    expect(useApp.getState().showcaseIndex).toBe(1);
    useApp.getState().setPlay({ phase: 'results' });
    useApp.getState().resetPlay(50001);
    expect(useApp.getState().play).toMatchObject({ phase: 'intro', seed: 50001, intents: [], results: null });
  });
});

describe('selectors', () => {
  it('severity thresholds follow the spec (ok < 180 ≤ warn < 420 ≤ bad)', () => {
    expect(severityOf(0)).toBe('ok');
    expect(severityOf(179)).toBe('ok');
    expect(severityOf(180)).toBe('warn');
    expect(severityOf(419)).toBe('warn');
    expect(severityOf(420)).toBe('bad');
  });

  it('watch label names the champion by id', () => {
    const s = useApp.getState();
    expect(selectWatchLabel(s)).toBe('Champion');
    s.setChampion({ policy: { ...G0, meta: { ...G0.meta, id: 'g4' } }, generation: null });
    expect(selectWatchLabel(useApp.getState())).toBe('Champion g4');
    useApp.getState().setWatchController('ref');
    expect(selectWatchLabel(useApp.getState())).toBe('Reference');
  });

  it('HUD hides in Lab; live means running and not paused', () => {
    expect(selectShowHud(useApp.getState())).toBe(true);
    useApp.getState().setMode('lab');
    expect(selectShowHud(useApp.getState())).toBe(false);
    expect(selectIsLive(useApp.getState())).toBe(false); // no sim feed yet
    useApp.setState({ hud: { t: 10, clock: '21:30', phase: 'running', meanWaitS: 0, completionPct: 0, missedConnections: 0, waitingNow: 0, ridingNow: 0, jSoFar: 0 } });
    expect(selectIsLive(useApp.getState())).toBe(true);
    useApp.getState().setPaused(true);
    expect(selectIsLive(useApp.getState())).toBe(false);
  });
});

describe('router', () => {
  it('parses and builds the four routes', () => {
    expect(parsePath('/')).toEqual({ mode: 'watch', generationId: null });
    expect(parsePath('/play')).toEqual({ mode: 'play', generationId: null });
    expect(parsePath('/lab')).toEqual({ mode: 'lab', generationId: null });
    expect(parsePath('/lab/g3')).toEqual({ mode: 'lab', generationId: 'g3' });
    expect(parsePath('/nope')).toEqual({ mode: 'watch', generationId: null });
    for (const p of ['/', '/play', '/lab', '/lab/g3']) expect(pathFor(parsePath(p))).toBe(p);
  });
});
