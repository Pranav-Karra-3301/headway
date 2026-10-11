// Shared app state (T3a owns; T3b/T3c/T3d/T7 read and call actions). Snapshots never go in here.
// Per-frame data (snapshots, the Sim, the renderer) lives in `frame` (state/frame.ts); the HUD gets a 4 Hz feed here.
import { create } from 'zustand';
import type { DecisionRecord, EvolveEvent, Generation, Intent, Observation, Policy, RouteId, Round, RunResult } from '@headway/sim';
import type { DetailMode, LightMode, PaletteId, Pick as RenderPick } from '../render/types';
import type { Speed } from '../sim/runner';
import type { SessionSpec, SimKind } from '../sim/session';

export type Mode = 'watch' | 'play' | 'lab';
export type PlayPhase = 'intro' | 'playing' | 'finishing' | 'results';
export type Quality = 'high' | 'low';
export type WatchController = 'g0' | 'ref' | 'champion';

export interface Toast { id: number; kind: 'transfer' | 'missed' | 'walkaway' | 'alert' | 'info'; text: string; simT: number }
export interface PaceSample { t: number; you: number; champion: number; baseline: number } // jSoFar per controller
export interface HudMetrics {
  t: number; clock: string; phase: 'running' | 'clearing' | 'done';
  meanWaitS: number; completionPct: number; missedConnections: number;
  waitingNow: number; ridingNow: number; jSoFar: number;
  /** p95 of waits so far (finished waits + people still waiting), from snapshots. */
  p95WaitS?: number;
  spawned?: number; completed?: number; leftBehind?: number;
}
export interface PlayState {
  phase: PlayPhase; seed: number;
  intents: Array<{ t: number; intent: Intent }>;
  pace: PaceSample[];
  results: { you: RunResult; champion: RunResult; baseline: RunResult } | null;
}
export interface LabState {
  generations: Generation[]; rounds: Round[]; selectedGenerationId: string | null;
  evolveEvents: EvolveEvent[]; evolving: boolean;
}
export interface ViewState { palette: PaletteId; detail: DetailMode; light: LightMode; quality: Quality }

export interface AppState extends ViewState {
  mode: Mode;
  highlightedRoute: RouteId | null;
  selection: RenderPick | null;
  speed: Speed; paused: boolean;
  hud: HudMetrics | null; observation: Observation | null; // written at 4 Hz by the canvas host
  /** Latest non-default decisions (policy / human / jev / fallback), newest first, ≤ 8. Written at 4 Hz by the host. */
  decisions: DecisionRecord[];
  toasts: Toast[];
  watchController: WatchController;
  champion: { policy: Policy; generation: Generation | null } | null;
  play: PlayState; lab: LabState;

  /** What the canvas host runs. Set via loadSession; the host rebuilds the sim when `session.key` or `sessionNonce` changes. */
  session: SessionSpec | null;
  sessionNonce: number;
  /** Which sim the host is actually running ('none' = static town only), and why it fell back. Written by the host. */
  simKind: SimKind; simError: string | null;
  /** Watch override set by Lab "Replay on stadium exit" (null = use watchController). */
  watchOverride: { policy: Policy; label: string } | null;
  /** Index into the showcase crowds Watch loops through. */
  showcaseIndex: number;
  /** About panel (T7) open. */
  about: boolean;

  setMode(m: Mode): void;
  setView(v: Partial<ViewState>): void;
  highlightRoute(r: RouteId | null): void;
  select(p: RenderPick | null): void;
  setSpeed(s: Speed): void;
  setPaused(p: boolean): void;
  setHudFeed(h: HudMetrics, o: Observation): void;
  pushToast(t: Omit<Toast, 'id'>): void;
  dismissToast(id: number): void;
  setWatchController(c: WatchController): void;
  setChampion(c: AppState['champion']): void;
  setPlay(p: Partial<PlayState>): void;
  resetPlay(seed: number): void;
  setLab(p: Partial<LabState>): void;
  appendEvolveEvent(e: EvolveEvent): void;

  /** Ask the canvas host to run this session (from t = 0). Same key = no-op unless restartSession(). */
  loadSession(s: SessionSpec | null): void;
  /** Rebuild the current session from t = 0 (e.g. "Play again"). */
  restartSession(): void;
  setSimInfo(kind: SimKind, error: string | null): void;
  /** Lab → Watch: run `policy` on the stadium-exit showcase crowd. */
  replayPolicy(policy: Policy, label?: string): void;
  nextShowcase(): void;
  setAbout(open: boolean): void;
}

const MAX_TOASTS = 4;
let toastId = 0;
const freshPlay = (seed: number): PlayState => ({ phase: 'intro', seed, intents: [], pace: [], results: null });

export const useApp = create<AppState>()((set) => ({
  mode: 'watch',
  palette: 'a', detail: 'toy', light: 'day', quality: 'high',
  highlightedRoute: null, selection: null,
  speed: 8, paused: false,
  hud: null, observation: null,
  decisions: [],
  toasts: [],
  watchController: 'champion',
  champion: null,
  play: freshPlay(0),
  lab: { generations: [], rounds: [], selectedGenerationId: null, evolveEvents: [], evolving: false },
  session: null, sessionNonce: 0,
  simKind: 'none', simError: null,
  watchOverride: null,
  showcaseIndex: 0,
  about: false,

  setMode: (mode) => set((s) => (s.mode === mode ? {} : { mode, selection: null })),
  setView: (v) => set(v),
  highlightRoute: (highlightedRoute) => set({ highlightedRoute }),
  select: (selection) => set({ selection }),
  setSpeed: (speed) => set({ speed }),
  setPaused: (paused) => set({ paused }),
  setHudFeed: (hud, observation) => set({ hud, observation }),
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastId }].slice(-MAX_TOASTS) })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setWatchController: (watchController) => set({ watchController, watchOverride: null }),
  setChampion: (champion) => set({ champion }),
  setPlay: (p) => set((s) => ({ play: { ...s.play, ...p } })),
  resetPlay: (seed) => set({ play: freshPlay(seed) }),
  setLab: (p) => set((s) => ({ lab: { ...s.lab, ...p } })),
  appendEvolveEvent: (e) => set((s) => ({ lab: { ...s.lab, evolveEvents: [...s.lab.evolveEvents, e] } })),

  loadSession: (session) => set((s) => (s.session?.key === session?.key ? {} : { session })),
  restartSession: () => set((s) => ({ sessionNonce: s.sessionNonce + 1 })),
  setSimInfo: (simKind, simError) => set({ simKind, simError }),
  replayPolicy: (policy, label) =>
    set({ watchOverride: { policy, label: label ?? `Replay ${policy.meta.id}` }, showcaseIndex: 0, mode: 'watch', selection: null }),
  nextShowcase: () => set((s) => ({ showcaseIndex: s.showcaseIndex + 1 })),
  setAbout: (about) => set({ about }),
}));
