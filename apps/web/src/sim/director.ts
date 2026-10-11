// Session director (T3a): decides what the canvas host runs for the current mode.
// Watch and Lab share the Watch session (champion / g0 / ref / Lab replay on the showcase crowds; Lab keeps it running
// behind its panel). Play runs today's play seed with g0 + the player's intents, paused on the goal card.
import { playInstance } from '@headway/sim';
import { useApp } from '../state/store';
import type { AppState } from '../state/store';
import { playDayIndex, playSpec, watchSpec } from './session';
import type { SessionSpec } from './session';

/** Real milliseconds a finished Watch run stays on screen before the next showcase crowd. */
export const WATCH_ROTATE_MS = 6000;

export function desiredSession(s: AppState): SessionSpec | null {
  if (s.mode === 'play') return playSpec(s.play.seed);
  // Watch/Lab: wait for the champion fetch rather than flashing g0 first.
  if (s.watchController === 'champion' && !s.champion && !s.watchOverride) return null;
  return watchSpec({
    choice: s.watchController, champion: s.champion?.policy ?? null, override: s.watchOverride, showcaseIndex: s.showcaseIndex,
  });
}

type Store = Pick<typeof useApp, 'getState' | 'setState' | 'subscribe'>;

export function startDirector(store: Store = useApp): () => void {
  let rotateTimer: ReturnType<typeof setTimeout> | null = null;
  let rotateFor: string | null = null;
  let lastMode = store.getState().mode;
  let lastPhase = store.getState().play.phase;

  const clearRotate = () => { if (rotateTimer) clearTimeout(rotateTimer); rotateTimer = null; rotateFor = null; };

  const apply = (s: AppState) => {
    const enteringPlay = s.mode === 'play' && lastMode !== 'play';
    lastMode = s.mode;

    if (s.mode === 'play') {
      // Play needs a concrete seed (T3c reads play.seed). A half-played game does not survive leaving Play.
      const midGame = enteringPlay && (s.play.phase === 'playing' || s.play.phase === 'finishing');
      if (s.play.seed <= 0 || midGame) {
        lastPhase = 'intro';
        s.resetPlay(s.play.seed > 0 ? s.play.seed : playInstance(playDayIndex()).seed);
        return; // the store update re-enters apply
      }
    }

    const want = desiredSession(s);
    if (want && s.session?.key !== want.key) {
      clearRotate();
      lastPhase = s.play.phase;
      store.setState({ session: want, paused: !!want.paused, selection: null, hud: null, observation: null });
      return;
    }

    if (s.mode === 'play') {
      const from = lastPhase;
      lastPhase = s.play.phase;
      // "Play again": back to the intro restarts the run, paused on the goal card.
      if (s.play.phase === 'intro' && from !== 'intro') {
        store.setState({ paused: true, sessionNonce: s.sessionNonce + 1, hud: null, observation: null });
        return;
      }
      // Leaving the goal card starts the clock.
      if (from === 'intro' && s.play.phase === 'playing' && s.paused) store.setState({ paused: false });
      return;
    }
    lastPhase = s.play.phase;

    // Watch/Lab: loop through the showcase crowds.
    if (s.session && s.hud?.phase === 'done' && rotateFor !== s.session.key) {
      clearRotate();
      const key = s.session.key;
      rotateFor = key;
      rotateTimer = setTimeout(() => {
        rotateTimer = null;
        const now = store.getState();
        if (now.mode !== 'play' && now.session?.key === key) now.nextShowcase();
      }, WATCH_ROTATE_MS);
    }
  };

  apply(store.getState());
  const unsub = store.subscribe(apply);
  return () => { unsub(); clearRotate(); };
}
