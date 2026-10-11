import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G0 } from '@headway/sim';
import { useApp } from '../../state/store';
import type { HudMetrics } from '../../state/store';
import { WATCH_ROTATE_MS, startDirector } from '../director';
import { playDayIndex } from '../session';

const initial = useApp.getState();
const champ = { policy: { ...G0, meta: { ...G0.meta, id: 'g4' } }, generation: null };
const hud = (phase: HudMetrics['phase']): HudMetrics =>
  ({ t: 2700, clock: '22:15', phase, meanWaitS: 0, completionPct: 0, missedConnections: 0, waitingNow: 0, ridingNow: 0, jSoFar: 0 });

let stop: () => void = () => {};
beforeEach(() => { useApp.setState(initial, true); vi.useFakeTimers(); });
afterEach(() => { stop(); vi.useRealTimers(); });

describe('session director', () => {
  it('waits for the champion, then runs it on the first showcase crowd', () => {
    stop = startDirector();
    expect(useApp.getState().session).toBeNull();
    useApp.getState().setChampion(champ);
    const s = useApp.getState().session!;
    expect(s.key).toMatch(/^watch:0:stadium_exit:\d+:g4$/);
    expect(s.label).toBe('Champion g4');
    expect(useApp.getState().paused).toBe(false);
  });

  it('Lab keeps the Watch session running; switching controllers reloads', () => {
    useApp.getState().setChampion(champ);
    stop = startDirector();
    const key = useApp.getState().session!.key;
    useApp.getState().setMode('lab');
    expect(useApp.getState().session!.key).toBe(key);
    useApp.getState().setWatchController('g0');
    expect(useApp.getState().session!.key).toMatch(/:g0$/);
  });

  it('Play: seeds today, starts paused, unpauses on start, restarts on Play again', () => {
    useApp.getState().setChampion(champ);
    stop = startDirector();
    useApp.getState().setMode('play');
    let s = useApp.getState();
    expect(s.play.seed).toBe(50000 + playDayIndex());
    expect(s.session!.key).toBe(`play:stadium_exit:${s.play.seed}`);
    expect(s.session!.human).toBe(true);
    expect(s.paused).toBe(true);
    s.setPlay({ phase: 'playing' });
    expect(useApp.getState().paused).toBe(false);
    useApp.getState().setPlay({ phase: 'results' });
    const nonce = useApp.getState().sessionNonce;
    useApp.getState().resetPlay(useApp.getState().play.seed);
    s = useApp.getState();
    expect(s.paused).toBe(true);
    expect(s.sessionNonce).toBe(nonce + 1);
    s.setMode('watch');
    expect(useApp.getState().session!.key).toMatch(/^watch:/);
    expect(useApp.getState().paused).toBe(false);
  });

  it('a half-played game resets to the intro when you come back to Play', () => {
    useApp.getState().setChampion(champ);
    stop = startDirector();
    useApp.getState().setMode('play');
    useApp.getState().setPlay({ phase: 'playing' });
    useApp.getState().setMode('watch');
    useApp.getState().setMode('play');
    expect(useApp.getState().play.phase).toBe('intro');
    expect(useApp.getState().paused).toBe(true);
  });

  it('rotates to the next showcase crowd a few seconds after a Watch run ends', () => {
    useApp.getState().setChampion(champ);
    stop = startDirector();
    const key = useApp.getState().session!.key;
    useApp.setState({ hud: hud('done') });
    vi.advanceTimersByTime(WATCH_ROTATE_MS - 1);
    expect(useApp.getState().session!.key).toBe(key);
    vi.advanceTimersByTime(1);
    expect(useApp.getState().showcaseIndex).toBe(1);
    expect(useApp.getState().session!.key).not.toBe(key);
    expect(useApp.getState().hud).toBeNull(); // stale feed cleared with the new session
  });
});
