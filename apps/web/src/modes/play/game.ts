// Owner: T3c. Play orchestration (non-React): session, tour, intents, pace, Finish fast-forward, results, spectate, submit.
// The director + canvas host build and drive the play session (g0 + the player's intents); Play steps the runner itself
// only while finishing. Everything the player sees comes from the Observation / snapshots (no future info).
import { G0 } from '@headway/sim';
import type { DecisionRecord, Intent, Observation, RouteId, ScenarioInstance, Sim, SimSnapshot } from '@headway/sim';
import { fetchChampion, fetchLeaderboard, submitRun } from '../../api';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import type { SimRunner, Speed } from '../../sim/runner';
import { createSessionSim, playSpec, type SessionSpec } from '../../sim/session';
import { aiRunsFor } from './aiRuns';
import { addIntent, expirePending, resolveWithDecisions, resolveWithObservation, type TrackedIntent } from './intents';
import { keyCommand, type Command } from './keys';
import { clock, cleanName, legalActions, paceAt, trainDwellFor, TRAIN_ID, type DockLegality, type Gate } from './logic';
import { freshAi, freshRun, usePlay } from './playStore';

export const TOUR_KEY = 'headway.play.tour.v1';
export const PLAY_SPEED: Speed = 8;
const PACE_EVERY_S = 30;
const OBS_EVERY_MS = 250;
const FINISH_MS = 1200;

let lastSnap: SimSnapshot | null = null;
let lastObsMs = -Infinity;
let nextPaceT = 0;
let intentSeq = 0;
let nudgeSeq = 0;
let awaiting: { prev: Sim | null; since: number; then: () => void } | null = null;
let ffLastMs: number | null = null;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function tourDone(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

function spec(): SessionSpec {
  const seed = useApp.getState().play.seed;
  return playSpec(seed > 0 ? seed : undefined);
}
export const playScenario = (): ScenarioInstance => spec().scenario;

function setPaused(p: boolean): void {
  useApp.getState().setPaused(p);
  if (p) frame.runner?.pause(); else frame.runner?.resume();
}

export function setSpeed(s: Speed): void {
  useApp.getState().setSpeed(s);
  frame.runner?.setSpeed(s);
}

function observe(sim: Sim | undefined | null): Observation | null {
  try { return sim ? sim.observe() : null; } catch { return null; }
}

function resetCounters(): void {
  lastSnap = null;
  lastObsMs = -Infinity;
  nextPaceT = 0;
}

/** Run `then` once the host has swapped in a new sim (the director rebuilds the session when the phase returns to intro). */
function whenFresh(then: () => void): void {
  awaiting = { prev: frame.runner?.sim ?? null, since: performance.now(), then };
}

// ---------- lifecycle ----------
// The director (sim/director.ts) owns the play session: it resets a half-played game when Play is entered, starts the
// clock when the phase leaves 'intro', and restarts the run (paused) when the phase returns to 'intro'.

/** Clears the per-run local state (called whenever the shared phase returns to 'intro'). */
export function resetLocal(): void {
  usePlay.getState().set({ ...freshRun() });
  resetCounters();
}

/** PlayMode mounted: the AI runs on today's crowd start right away (they take well under a second each). */
export function enterPlay(): void {
  usePlay.getState().set({ spectating: false, restarting: false });
  if (useApp.getState().play.phase === 'intro') resetLocal();
  void ensureAi(playScenario());
}

export function leavePlay(): void {
  awaiting = null;
  usePlay.getState().set({ picker: null, preview: null, tour: null, restarting: false });
}

export async function ensureAi(scenario: ScenarioInstance = playScenario()): Promise<void> {
  let champion = useApp.getState().champion?.policy ?? null;
  if (!champion) {
    try {
      const c = await fetchChampion();
      if (!useApp.getState().champion) useApp.getState().setChampion(c);
      champion = useApp.getState().champion?.policy ?? c.policy;
    } catch {
      champion = G0;
    }
  }
  const id = champion.meta.id;
  const key = `${scenario.seed}:${id}`;
  const cur = usePlay.getState().ai;
  if (cur.key === key && cur.status !== 'error' && cur.status !== 'idle') return;
  usePlay.getState().set({ ai: { ...freshAi(id, key), status: 'running' } });
  const mine = () => usePlay.getState().ai.key === key;
  try {
    const runs = await aiRunsFor(scenario, champion, G0, (r) => {
      if (mine()) usePlay.getState().set({ ai: { ...usePlay.getState().ai, [r.who]: r } });
    });
    if (!mine()) return;
    usePlay.getState().set({ ai: { ...usePlay.getState().ai, champion: runs.champion, baseline: runs.baseline, status: 'done' } });
    syncPace();
    publishResults();
  } catch (e) {
    if (mine()) usePlay.getState().set({ ai: { ...usePlay.getState().ai, status: 'error', error: errText(e) } });
  }
}

/** Goal card → playing. The tour runs first (paused) unless it was already seen, or when asked for. */
export function start(opts: { tour?: boolean } = {}): void {
  const app = useApp.getState();
  app.setPlay({ phase: 'playing' }); // the director unpauses on intro → playing
  setSpeed(PLAY_SPEED);
  resetCounters();
  if (usePlay.getState().ai.status === 'error') void ensureAi(); // e.g. the engine finished loading after Play opened
  if (opts.tour || !tourDone()) { usePlay.getState().set({ tour: 0 }); setPaused(true); } else setPaused(false);
}

export function setTour(step: number | null): void {
  if (step === null) {
    try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* private mode */ }
    usePlay.getState().set({ tour: null });
    if (useApp.getState().play.phase === 'playing') setPaused(false);
  } else {
    usePlay.getState().set({ tour: step });
  }
}

export function finish(): void {
  const r = frame.runner;
  if (!r) return;
  if (r.sim.done) { complete(); return; }
  const o = observe(r.sim);
  const to = o ? o.scenario.durationS + o.scenario.clearingS : r.sim.t + 2700;
  ffLastMs = null;
  usePlay.getState().set({ finishing: { from: r.sim.t, to, t: r.sim.t }, picker: null, preview: null, tour: null });
  useApp.getState().setPlay({ phase: 'finishing' });
  setPaused(false);
}

/** Results → a fresh run on the same crowd, straight into play (the director rebuilds the sim on 'intro'). */
export function playAgain(): void {
  usePlay.getState().set({ restarting: true });
  whenFresh(() => {
    usePlay.getState().set({ restarting: false });
    useApp.getState().setPlay({ phase: 'playing' }); // the director unpauses on intro → playing
    setSpeed(PLAY_SPEED);
  });
  useApp.getState().resetPlay(spec().scenario.seed);
}

/** Results → watch the champion run the identical crowd. The director pins the play session in play mode, so: restart
 *  it (the host rebuilds and resets its HUD feeds), then swap the champion's sim into the runner in place. */
export function spectate(): void {
  const app = useApp.getState();
  const champion = app.champion?.policy ?? G0;
  const scenario = spec().scenario;
  try {
    const made = createSessionSim({ key: `play-ai:${scenario.seed}:${champion.meta.id}`, scenario, policy: champion, label: `AI ${champion.meta.id}` });
    app.select(null);
    app.restartSession();
    const r = frame.runner;
    if (!r) return;
    r.reset(() => made.sim);
    usePlay.getState().set({ spectating: true });
    setSpeed(PLAY_SPEED);
    setPaused(false);
  } catch (e) {
    nudge(`Could not start the AI run: ${errText(e)}`, 'warn');
  }
}

export function backToResults(): void {
  usePlay.getState().set({ spectating: false });
  setPaused(true);
}

function complete(): void {
  const r = frame.runner;
  if (!r) return;
  const local = usePlay.getState();
  const o = observe(r.sim);
  if (o) samplePace(o, true);
  try {
    local.set({ you: r.sim.result(), replay: r.sim.replay(), error: null });
  } catch (e) {
    local.set({ you: null, replay: null, error: `Could not score this run: ${errText(e)}` });
  }
  usePlay.getState().set({ tracked: expirePending(usePlay.getState().tracked), finishing: null, picker: null, preview: null });
  useApp.getState().setPlay({ phase: 'results' });
  setPaused(true);
  syncPace();
  publishResults();
  void loadBoard();
}

function publishResults(): void {
  const { you, ai } = usePlay.getState();
  if (you && ai.champion && ai.baseline) {
    useApp.getState().setPlay({ results: { you, champion: ai.champion.result, baseline: ai.baseline.result } });
  }
}

// ---------- per frame ----------
export function tick(nowMs: number): void {
  const r = frame.runner;
  if (awaiting) {
    if ((r && r.sim !== awaiting.prev) || nowMs - awaiting.since > 2500) {
      const then = awaiting.then;
      awaiting = null;
      then();
    }
    return;
  }
  if (!r) return;
  const local = usePlay.getState();
  if (local.spectating) return;
  const phase = useApp.getState().play.phase;
  if (phase !== 'playing' && phase !== 'finishing') return;

  if (phase === 'finishing') fastForward(r, nowMs);
  if (r.next !== lastSnap) {
    lastSnap = r.next;
    const recs = humanRecords(r.next);
    if (recs.length) {
      const tracked = resolveWithDecisions(usePlay.getState().tracked, recs);
      if (tracked !== usePlay.getState().tracked) usePlay.getState().set({ tracked });
    }
  }
  if (nowMs - lastObsMs >= OBS_EVERY_MS) {
    lastObsMs = nowMs;
    const o = observe(r.sim);
    if (o) {
      const tracked = resolveWithObservation(usePlay.getState().tracked, o);
      usePlay.getState().set(tracked !== usePlay.getState().tracked ? { obs: o, tracked } : { obs: o });
      samplePace(o);
    }
  }
  if (r.sim.done) complete();
}

function humanRecords(s: SimSnapshot): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  for (const e of s.events ?? []) if (e.kind === 'decision' && e.record.source === 'human') out.push(e.record);
  for (const v of s.vehicles ?? []) if (v.lastDecision?.source === 'human') out.push(v.lastDecision);
  return out;
}

/** Finish: race the runner's sim to the end in ~1.2 s of real time (ticks scale with the real time between frames, so
 *  slow or throttled frames still finish on time), sampling pace on the way. The host keeps rendering runner.next. */
function fastForward(r: SimRunner, nowMs: number): void {
  const f = usePlay.getState().finishing;
  if (!f || r.sim.done) return;
  const total = Math.max(1, f.to - f.from);
  const elapsed = ffLastMs === null ? 16 : Math.min(400, Math.max(0, nowMs - ffLastMs));
  ffLastMs = nowMs;
  const want = Math.max(24, Math.ceil((elapsed * total) / FINISH_MS));
  const t0 = performance.now();
  let n = 0;
  try {
    while (!r.sim.done && n < want && performance.now() - t0 < 40) {
      r.sim.step();
      n++;
      if (r.sim.t % PACE_EVERY_S === 0) { const o = observe(r.sim); if (o) samplePace(o); }
    }
    r.prev = r.next;
    r.next = r.sim.snapshot();
    r.alpha = 1;
  } catch (e) {
    usePlay.getState().set({ error: `Fast-forward failed: ${errText(e)}` });
  }
  usePlay.getState().set({ finishing: { ...f, t: r.sim.t } });
}

function samplePace(o: Observation, force = false): void {
  if (!force && o.t < nextPaceT) return;
  const pts = usePlay.getState().youPace;
  if (pts.length && pts[pts.length - 1]!.t >= o.t) return;
  usePlay.getState().set({ youPace: [...pts, { t: o.t, j: o.running.jSoFar }] });
  nextPaceT = (Math.floor(o.t / PACE_EVERY_S) + 1) * PACE_EVERY_S;
  syncPace();
}

/** Shared store pace for the top-bar chip (T3b ui/hud/pace.ts): the AI's full curves on the 30-s grid, interpolated
 *  there at the live sim time. `you` is your jSoFar where already known, NaN for the future. */
function syncPace(): void {
  const { youPace, ai } = usePlay.getState();
  if (!ai.champion || !ai.baseline) return;
  const b = ai.baseline.samples;
  const lastYou = youPace.length ? youPace[youPace.length - 1]!.t : -1;
  useApp.getState().setPlay({
    pace: ai.champion.samples.map((p) => ({
      t: p.t, champion: p.j, baseline: paceAt(b, p.t) ?? p.j, you: p.t <= lastYou ? paceAt(youPace, p.t) ?? Number.NaN : Number.NaN,
    })),
  });
}

// ---------- intents ----------
function appliesNow(i: Intent, o: Observation | null): { applied: boolean; result?: string } {
  if (i.type === 'dispatch') return { applied: true, result: 'Dispatched from the terminal' };
  if (!o) return { applied: false };
  if (i.type === 'hold') {
    const b = o.buses.find((x) => x.id === i.vehicleId);
    return b && (b.state === 'dwelling' || b.state === 'holding') ? { applied: true, result: `Held ${i.seconds} s` } : { applied: false };
  }
  if (i.type === 'setTrainDeparture') {
    return o.train.state === 'dwelling' || o.train.state === 'holding' ? { applied: true, result: `Dwell set to ${i.dwellS} s` } : { applied: false };
  }
  return { applied: false };
}

export function issue(i: Intent): boolean {
  const r = frame.runner;
  if (!r || r.sim.done) return false;
  const o = observe(r.sim);
  const t = r.sim.t;
  try { r.intent(i); } catch (e) { nudge(`Could not send that: ${errText(e)}`, 'warn'); return false; }
  const app = useApp.getState();
  app.setPlay({ intents: [...app.play.intents, { t, intent: i }] });
  const now = appliesNow(i, o);
  usePlay.getState().set({ tracked: addIntent(usePlay.getState().tracked, { id: ++intentSeq, t, intent: i }, now) });
  return true;
}

export function nudge(text: string, tone: 'info' | 'warn' = 'info'): void {
  usePlay.getState().set({ nudge: { text, tone, n: ++nudgeSeq } });
}

/** Pending reassigns away from each route (excluding `except`), so the last bus cannot be double-booked. */
function pendingAway(tracked: readonly TrackedIntent[], o: Observation | null, except: string | null): Partial<Record<RouteId, number>> {
  const out: Partial<Record<RouteId, number>> = {};
  for (const x of tracked) {
    if (x.status !== 'pending' || x.intent.type !== 'reassign' || x.intent.vehicleId === except) continue;
    const vid = x.intent.vehicleId;
    const b = o?.buses.find((y) => y.id === vid);
    if (b) out[b.routeId] = (out[b.routeId] ?? 0) + 1;
  }
  return out;
}

export function currentLegality(): DockLegality {
  const app = useApp.getState();
  const { obs, tracked } = usePlay.getState();
  const r = frame.runner;
  const sel = app.selection && (app.selection.kind === 'bus' || app.selection.kind === 'train') ? app.selection : null;
  const view = sel && r ? r.next.vehicles?.find((v) => v.id === sel.id) ?? null : null;
  return legalActions(obs, sel, { view, pendingAway: pendingAway(tracked, obs, sel?.id ?? null), done: !!r?.sim.done });
}

function trainLast(): DecisionRecord | null {
  const v = frame.runner?.next.vehicles?.find((x) => x.kind === 'train' || x.id === TRAIN_ID);
  return v?.lastDecision ?? null;
}

export function trainPlan(mode: 'extend' | 'now') {
  const o = usePlay.getState().obs;
  return o ? trainDwellFor(o, mode, trainLast()) : null;
}

function gated(g: Gate, run: () => void): void {
  if (g.ok) run(); else nudge(g.why, 'warn');
}

const scenarioClock = (t: number) => clock(usePlay.getState().obs?.scenario.clockStart ?? '00:00', t);

export function act(c: Command): boolean {
  const app = useApp.getState();
  const local = usePlay.getState();
  const legal = currentLegality();
  const busId = legal.target?.kind === 'bus' ? legal.target.id : null;
  switch (c.kind) {
    case 'pause-toggle': setPaused(!app.paused); return true;
    case 'speed': setSpeed(c.speed); return true;
    case 'cycle': cycle(c.dir); return true;
    case 'close':
      if (local.picker) { local.set({ picker: null, preview: null }); return true; }
      if (app.selection) { app.select(null); return true; }
      return false;
    case 'dispatch':
      gated(legal.dispatch, () => { if (busId && issue({ type: 'dispatch', vehicleId: busId })) nudge(`${busId} dispatched`); });
      return true;
    case 'hold':
      gated(legal.hold, () => {
        if (!busId) return;
        const b = local.obs?.buses.find((x) => x.id === busId);
        const now = !!b && (b.state === 'dwelling' || b.state === 'holding');
        if (issue({ type: 'hold', vehicleId: busId, seconds: c.seconds })) {
          nudge(now ? `${busId} holds ${c.seconds} s here` : `${busId} will hold ${c.seconds} s at its next stop`);
        }
      });
      return true;
    case 'reassign-open':
      gated(legal.reassign, () => local.set({ picker: local.picker === 'reassign' ? null : 'reassign', preview: null }));
      return true;
    case 'reassign':
      gated(legal.reassignTo[c.to], () => {
        if (busId && issue({ type: 'reassign', vehicleId: busId, to: c.to })) nudge(`${busId} moves to ${c.to} at its next terminal`);
        local.set({ picker: null, preview: null });
      });
      return true;
    case 'train': {
      const plan = trainPlan(c.mode);
      if (!plan) return true;
      const cur = local.obs?.train.departAt ?? null;
      if (c.mode === 'extend' && plan.immediate && plan.capped && cur !== null && plan.departAt !== null && plan.departAt <= cur) {
        nudge('The train already waits the 2-minute maximum', 'warn');
        return true;
      }
      if (issue({ type: 'setTrainDeparture', dwellS: plan.dwellS })) {
        nudge(plan.immediate && plan.departAt !== null ? `Train departs ${scenarioClock(plan.departAt)}`
          : c.mode === 'now' ? 'Train leaves its next station after 30 s' : `Train waits ${plan.dwellS} s at its next station`);
      }
      local.set({ picker: null });
      return true;
    }
  }
}

function cycle(dir: 1 | -1): void {
  const o = usePlay.getState().obs;
  const all = [...[...(o?.buses.map((b) => b.id) ?? ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])].sort(), TRAIN_ID];
  const cur = useApp.getState().selection?.id ?? null;
  const k = cur ? all.indexOf(cur) : -1;
  const next = all[k < 0 ? (dir > 0 ? 0 : all.length - 1) : (k + dir + all.length) % all.length]!;
  useApp.getState().select({ kind: next === TRAIN_ID ? 'train' : 'bus', id: next });
  usePlay.getState().set({ picker: null, preview: null });
}

/** Window keydown (capture). Only while playing, never in text fields; handled keys stop there. */
export function handleKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  const app = useApp.getState();
  const local = usePlay.getState();
  if (app.mode !== 'play' || app.play.phase !== 'playing' || local.spectating) return;
  if (local.tour !== null) {
    if (e.key === 'Escape') { setTour(null); e.preventDefault(); e.stopPropagation(); }
    return;
  }
  const c = keyCommand(e, { picker: local.picker });
  if (!c) return;
  if (e.repeat && c.kind !== 'cycle') { e.preventDefault(); e.stopPropagation(); return; } // no bursts from a held key
  if (act(c)) { e.preventDefault(); e.stopPropagation(); }
}

export function submitScore(raw: string): Promise<void> | void {
  const name = cleanName(raw);
  const local = usePlay.getState();
  if (!name) {
    local.set({ submit: { status: 'error', name: raw, j: null, error: 'Use 1–16 letters, digits, spaces, _ or -' } });
    return;
  }
  const replay = local.replay;
  if (!replay) {
    local.set({ submit: { status: 'error', name, j: null, error: 'No finished run to submit' } });
    return;
  }
  local.set({ submit: { status: 'sending', name, j: null, error: null } });
  return submitRun(name, replay).then((res) => {
    usePlay.getState().set({
      submit: res.ok ? { status: 'done', name, j: res.j ?? null, error: null } : { status: 'error', name, j: null, error: res.error ?? 'Rejected' },
    });
    if (res.ok) void loadBoard();
  });
}

export async function loadBoard(): Promise<void> {
  const seed = spec().scenario.seed;
  usePlay.getState().set({ board: { ...usePlay.getState().board, status: 'loading' } });
  try {
    const rows = await fetchLeaderboard(seed);
    usePlay.getState().set({ board: { status: 'done', rows } });
  } catch {
    usePlay.getState().set({ board: { status: 'error', rows: [] } });
  }
}
