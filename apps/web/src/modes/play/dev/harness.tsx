// Dev only (T3c): mounts the real App and injects Play state so each Play screen can be screenshotted without the engine.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { FailureFinding, Metrics, Observation, RunResult } from '@headway/sim';
import { App } from '../../../App';
import { bootstrap } from '../../../state/boot';
import { useApp } from '../../../state/store';
import '../../../styles/index.css';
import type { HeadlessRun } from '../headless';
import type { TrackedIntent } from '../intents';
import { act, finish, setTour, start, TOUR_KEY } from '../game';
import { usePlay } from '../playStore';
import { frame } from '../../../state/frame';

const metrics = (J: number, p: Partial<Metrics>): Metrics => ({
  J, spawned: 1500, completed: 1452, unfinished: 48, completionPct: 96.8, meanJourneyS: J / 1500, meanWaitS: 312, p95WaitS: 905,
  maxWaitS: 1320, transfersMade: 214, missedConnections: 31, leftBehind: 96, walkaways: 22,
  effort: { busDistanceU: 14_200, deadheadDistanceU: 0, holdS: 640, trainDwellS: 1620 }, ...p,
});
const gap = (stopId: string, routeId: 'r1' | 'r2' | 'r3', impactS: number, gapS: number, fromT: number): FailureFinding =>
  ({ kind: 'service_gap', impactS, text: `${stopId} waited ${Math.round(gapS / 60)} min for ${routeId}`, stopId, routeId, gapS, fromT, toT: fromT + gapS, affected: 40 }) as FailureFinding;
const missed = (impactS: number, count: number): FailureFinding =>
  ({ kind: 'missed_transfer', impactS, text: `${count} train riders missed the r2 bus at Central Station`, at: { kind: 'stop', id: 'stop_central_stn' }, from: 'train', to: 'r2', count, window: [700, 1100] }) as FailureFinding;
const overload = (impactS: number, leftBehind: number): FailureFinding =>
  ({ kind: 'overload', impactS, text: `r3 buses at Stadium Gate left ${leftBehind} people behind`, at: { kind: 'stop', id: 'stop_stadium_gate' }, routeId: 'r3', leftBehind, peakQueue: 180 }) as FailureFinding;
const result = (J: number, m: Partial<Metrics>, findings: FailureFinding[]): RunResult => ({
  simVersion: '1', mapVersion: '1', scenarioId: 'stadium_exit', seed: 50000, controller: { kind: 'policy', policyId: 'g0' },
  metrics: metrics(J, m), stops: [], findings, ruleFires: {}, hash: 'dev',
});
const curve = (J: number, bend = 1) => Array.from({ length: 91 }, (_, i) => ({ t: i * 30, j: J * Math.pow(i / 90, 1.6 * bend) }));
const run = (who: 'champion' | 'baseline', J: number, res: RunResult, bend: number): HeadlessRun =>
  ({ who, policyId: who === 'champion' ? 'g6' : 'g0', samples: curve(J, bend), result: res, ms: 120, stub: false });

const youJ = 3600 * 431.6, aiJ = 3600 * 422.9, baseJ = 3600 * 466.2;
const you = result(youJ, { meanWaitS: 288, p95WaitS: 842, completionPct: 97.4, missedConnections: 19, walkaways: 14, effort: { busDistanceU: 14_650, deadheadDistanceU: 180, holdS: 520, trainDwellS: 1710 } },
  [gap('stop_apts_south', 'r2', 7200 * 3, 840, 900), missed(2600 * 3, 19), overload(3000, 40)]);
const ai = result(aiJ, { meanWaitS: 276, p95WaitS: 798, completionPct: 97.9, missedConnections: 12, walkaways: 11, effort: { busDistanceU: 14_900, deadheadDistanceU: 210, holdS: 610, trainDwellS: 1680 } },
  [gap('stop_apts_south', 'r2', 1400 * 3, 420, 900), missed(5200 * 3, 12), overload(2500, 31)]);
const base = result(baseJ, {}, [gap('stop_apts_south', 'r2', 8000 * 3, 900, 860), missed(6400 * 3, 31), overload(9000, 96)]);
const aiState = { status: 'done' as const, championId: 'g6', error: null, champion: run('champion', aiJ, ai, 1), baseline: run('baseline', baseJ, base, 1.02) };

type Bus = Observation['buses'][number];
const bus = (id: string, routeId: Bus['routeId'], state: Bus['state'], p: Partial<Bus> = {}): Bus => ({
  id, routeId, state, onboard: 22, capacity: 40, nextStopId: 'stop_downtown', etaNextStopS: 52, holdUntil: null, headwayAheadS: 260,
  headwayBehindS: 300, holdUsedS: 0, ...p,
});
const T = 680;
const obs: Observation = {
  t: T, phase: 'running',
  scenario: { id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30', durationS: 1800, clearingS: 900, advertised: [{ kind: 'stadium_closing', t: 600, label: 'Stadium closes' }] },
  buses: [
    bus('b1', 'r1', 'moving', { onboard: 31, nextStopId: 'stop_old_main' }), bus('b2', 'r1', 'layover', { onboard: 0, nextStopId: 'stop_university_stn', headwayAheadS: 190 }),
    bus('b3', 'r2', 'holding', { onboard: 18, holdUntil: T + 24, nextStopId: 'stop_central_stn', holdUsedS: 30 }), bus('b4', 'r2', 'moving', { onboard: 40, nextStopId: 'stop_apts_south', etaNextStopS: 75 }),
    bus('b5', 'r3', 'dwelling', { onboard: 37, nextStopId: 'stop_stadium_gate' }), bus('b6', 'r3', 'moving', { onboard: 40, nextStopId: 'stop_apts_north', etaNextStopS: 110 }),
  ],
  train: { state: 'moving', stationId: 'stn_central', etaS: 34, onboard: 96, capacity: 160, departAt: null, alightingNext: 40, transfersNext: { r2: 14, r1: 5 },
    platformQueue: { stn_stadium: 120, stn_university: 8, stn_central: 11 } },
  stops: [],
  routes: [{ id: 'r1', buses: ['b1', 'b2'], targetHeadwayS: 240, queue: 14 }, { id: 'r2', buses: ['b3', 'b4'], targetHeadwayS: 240, queue: 46 },
    { id: 'r3', buses: ['b5', 'b6'], targetHeadwayS: 240, queue: 163 }],
  running: { spawned: 980, completed: 212, waitingNow: 420, ridingNow: 260, meanWaitS: 240, missedConnections: 6, leftBehind: 22, jSoFar: 3600 * 61.4 },
};
const tracked: TrackedIntent[] = [
  { id: 1, t: 540, intent: { type: 'reassign', vehicleId: 'b2', to: 'r3' }, status: 'applied', appliedT: 610, result: 'Moving to r3: closing in 0 s, only 4 waiting here', sawMoving: true },
  { id: 2, t: 655, intent: { type: 'hold', vehicleId: 'b3', seconds: 30 }, status: 'applied', appliedT: 655, result: 'Held 30 s for the train', sawMoving: false },
  { id: 3, t: 676, intent: { type: 'reassign', vehicleId: 'b1', to: 'r3' }, status: 'pending', appliedT: null, result: null, sawMoving: false },
  { id: 4, t: 1210, intent: { type: 'setTrainDeparture', dwellS: 75 }, status: 'applied', appliedT: 1262, result: 'Train waits 75 s at Central Station', sawMoving: true },
  { id: 5, t: 1580, intent: { type: 'hold', vehicleId: 'b4', seconds: 60 }, status: 'expired', appliedT: null, result: null, sawMoving: true },
];

const q = new URLSearchParams(location.search);
const advance = (toT: number) => {
  const r = frame.runner;
  if (!r) return;
  while (!r.sim.done && r.sim.t < toT) r.sim.step();
  r.prev = r.next;
  r.next = r.sim.snapshot();
};

/** Fake-data scenes are re-applied for a while to win races with async init; live scenes drive the real flow once. */
const scenes: Record<string, { fake?: () => void; live?: () => void }> = {
  goal: { fake: () => usePlay.getState().set({ ai: aiState }) },
  tour: {
    live: () => {
      try { localStorage.removeItem(TOUR_KEY); } catch { /* ignore */ }
      start();
      setTour(Number(q.get('step') ?? 0));
    },
  },
  dock: {
    live: () => {
      try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
      start();
      advance(Number(q.get('t') ?? 660));
      useApp.getState().select({ kind: 'bus', id: q.get('bus') ?? 'b2' });
      setTimeout(() => {
        const pick = q.get('picker');
        if (q.get('hold')) act({ kind: 'hold', seconds: 30 });
        if (pick === 'reassign') act({ kind: 'reassign-open' });
        if (pick === 'train') usePlay.getState().set({ picker: 'train' });
      }, 700);
    },
  },
  results: {
    fake: () => {
      useApp.setState((s) => ({ play: { ...s.play, phase: 'results', results: { you, champion: ai, baseline: base } }, paused: true }));
      usePlay.getState().set({
        ai: aiState, you, obs, tracked, tour: null,
        youPace: curve(youJ, 1.01),
        board: { status: 'done', rows: [{ name: 'mira', j: 3600 * 418.2, verified: true }, { name: 'Pranav', j: 3600 * 425.0, verified: true }, { name: 'ada_l', j: 3600 * 433.9, verified: false }, { name: 'trainfan', j: 3600 * 447.3, verified: true }] },
      });
    },
  },
  finish: {
    live: () => {
      try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
      start();
      advance(Number(q.get('t') ?? 900));
      finish();
    },
  },
};

bootstrap();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
const scene = scenes[q.get('scene') ?? 'goal'] ?? scenes.goal!;
let n = 0;
const id = setInterval(() => {
  n++;
  if (useApp.getState().mode !== 'play') useApp.setState({ mode: 'play' });
  if (n >= 3) scene.fake?.();
  if (n === 6) scene.live?.();
  if (n > 20) clearInterval(id);
}, 150);
void obs;
// debug readout for headless runs (--dump-dom)
setInterval(() => {
  const a = usePlay.getState().ai;
  document.body.dataset.debug = JSON.stringify({ ai: a.status, err: a.error, c: a.champion?.samples.length ?? 0, pace: useApp.getState().play.pace.length, phase: useApp.getState().play.phase, sim: useApp.getState().simKind, simErr: useApp.getState().simError, t: frame.runner?.sim.t ?? null });
}, 300);
