// Owner: T3c. Play-local UI state (the shared slice lives in useApp().play). Snapshots never go in here.
import { create } from 'zustand';
import type { Observation, Replay, RouteId, RunResult } from '@headway/sim';
import type { LeaderboardRow } from '../../api';
import type { HeadlessRun } from './headless';
import type { TrackedIntent } from './intents';
import type { Picker } from './keys';
import type { PacePoint } from './logic';

export interface AiState {
  status: 'idle' | 'running' | 'done' | 'error';
  champion: HeadlessRun | null; baseline: HeadlessRun | null;
  championId: string; error: string | null;
}

export interface PlayLocal {
  /** The player's sim, observed at 4 Hz. */
  obs: Observation | null;
  /** Coach-mark step while the tour runs. */
  tour: number | null;
  picker: Picker;
  /** Route hovered in the reassign picker (deadhead preview). */
  preview: RouteId | null;
  tracked: TrackedIntent[];
  ai: AiState;
  you: RunResult | null;
  replay: Replay | null;
  youPace: PacePoint[];
  spectating: boolean;
  finishing: { from: number; to: number; t: number } | null;
  nudge: { text: string; tone: 'info' | 'warn'; n: number } | null;
  submit: { status: 'idle' | 'sending' | 'done' | 'error'; name: string; j: number | null; error: string | null };
  board: { status: 'idle' | 'loading' | 'done' | 'error'; rows: LeaderboardRow[] };
  /** "Play again" is waiting for the host to rebuild the sim. */
  restarting: boolean;
  /** The run could not be scored / stepped. */
  error: string | null;
  set(p: Partial<PlayLocal>): void;
}

export const freshAi = (championId = ''): AiState => ({ status: 'idle', champion: null, baseline: null, championId, error: null });

export const freshRun = (): Pick<PlayLocal, 'obs' | 'picker' | 'preview' | 'tracked' | 'you' | 'replay' | 'youPace' | 'spectating' | 'finishing' | 'nudge' | 'submit'> => ({
  obs: null, picker: null, preview: null, tracked: [], you: null, replay: null, youPace: [], spectating: false, finishing: null,
  nudge: null, submit: { status: 'idle', name: '', j: null, error: null },
});

export const usePlay = create<PlayLocal>()((set) => ({
  ...freshRun(),
  tour: null,
  ai: freshAi(),
  board: { status: 'idle', rows: [] },
  restarting: false,
  error: null,
  set: (p) => set(p),
}));
