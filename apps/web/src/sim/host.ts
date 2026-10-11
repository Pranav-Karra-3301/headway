// Canvas host (T3a): owns the SimRunner and the TownRenderer for the page.
// rAF: runner.frame → renderer.render every frame; HUD feed (setHudFeed) at 4 Hz; snapshot events → toasts.
// Store ↔ runner/renderer sync: session, paused, speed, palette/detail/light/quality, highlight, selection.
import { TOWN, createStubSim, stationById, stopById } from '@headway/sim';
import type { DecisionRecord, QueuePlace, SimSnapshot } from '@headway/sim';
import { TownRenderer } from '../render/index';
import type { TownRendererApi } from '../render/types';
import { frame } from '../state/frame';
import { useApp } from '../state/store';
import type { AppState } from '../state/store';
import { WaitTracker, buildHud } from '../state/hud';
import { createEventToaster } from '../state/eventToasts';
import { SimRunner } from './runner';
import { createSessionSim } from './session';
import type { SessionSpec } from './session';

const HUD_INTERVAL_MS = 250;
const CLICK_SLOP_PX = 6;
const HOVER_INTERVAL_MS = 70;
const MAX_DECISIONS = 8;

export const EMPTY_SNAPSHOT: SimSnapshot = {
  t: 0, phase: 'running', vehicles: [], people: [], queues: [], events: [],
  running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
};

export interface HeadwayProbe {
  readonly t: number; readonly simT: number; readonly mode: AppState['mode']; readonly ready: boolean;
  readonly sim: AppState['simKind']; readonly renderer: 'three' | 'none'; readonly frames: number;
  readonly session: string | null; readonly error: string | null;
}
declare global { interface Window { __headway?: HeadwayProbe } }

const prettyId = (id: string) => id.replace(/^(stop|stn)_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Display name of a stop or platform from the map (falls back to a prettified id). */
export function placeName(at: QueuePlace): string {
  try {
    return at.kind === 'stop' ? stopById(TOWN, at.id).name : stationById(TOWN, at.id).name;
  } catch {
    return prettyId(at.id);
  }
}

function mapReady(): boolean {
  return Array.isArray(TOWN?.routes) && TOWN.routes.length > 0 && Array.isArray(TOWN?.stops);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startHost(a: { canvas: HTMLCanvasElement; container: HTMLElement; win?: Window }): () => void {
  const win = a.win ?? window;
  const store = useApp;
  let disposed = false;
  let renderer: TownRendererApi | null = null;
  let runner: SimRunner | null = null;
  let session: SessionSpec | null = null;
  let builtKey: string | null = null;
  let builtNonce = -1;
  let ready = false;
  let frames = 0;
  let lastError: string | null = null;
  let renderFailures = 0;
  let lastNext: SimSnapshot | null = null;
  let decisions: DecisionRecord[] = [];
  let decisionsDirty = false;
  const waits = new WaitTracker();
  const toaster = createEventToaster({ placeName });

  // ---------- renderer ----------
  const view = store.getState();
  if (mapReady()) {
    try {
      renderer = new TownRenderer(a.canvas, TOWN, { palette: view.palette, detail: view.detail, light: view.light });
    } catch (e) {
      lastError = `renderer: ${errText(e)}`;
      console.warn('[headway] town renderer unavailable:', e);
      renderer = null;
    }
  } else {
    lastError = 'map not ready';
  }
  frame.renderer = renderer;
  frame.canvas = a.canvas;

  const applyView = (s: AppState, prev: AppState | null) => {
    if (!renderer) return;
    try {
      if (!prev || s.palette !== prev.palette) renderer.setPalette(s.palette);
      if (!prev || s.detail !== prev.detail) renderer.setDetail(s.detail);
      if (!prev || s.light !== prev.light) renderer.setLight(s.light);
      if (!prev || s.quality !== prev.quality) {
        const q = (renderer as unknown as { setQuality?: (q: string) => void }).setQuality;
        if (typeof q === 'function') q.call(renderer, s.quality);
      }
      if (!prev || s.highlightedRoute !== prev.highlightedRoute) renderer.highlightRoute(s.highlightedRoute);
      if (!prev || s.selection !== prev.selection) renderer.select(s.selection);
    } catch (e) {
      console.warn('[headway] renderer setter failed:', e);
    }
  };
  if (renderer) applyView(store.getState(), null);

  // ---------- sessions ----------
  let syncedPaused = store.getState().paused;
  let syncedSpeed = store.getState().speed;

  const resetFeeds = () => {
    waits.reset(); toaster.reset(); decisions = []; decisionsDirty = true; lastNext = null;
  };

  const build = (spec: SessionSpec | null) => {
    session = spec;
    builtKey = spec?.key ?? null;
    builtNonce = store.getState().sessionNonce;
    resetFeeds();
    if (!spec) { runner = null; frame.runner = null; store.getState().setSimInfo('none', null); return; }
    try {
      const made = createSessionSim(spec);
      if (made.kind === 'stub' && made.error) console.warn(`[headway] real sim not ready (${made.error}); running the stub sim`);
      if (runner) runner.reset(() => made.sim);
      else runner = new SimRunner(() => made.sim, store.getState().speed);
      const s = store.getState();
      runner.paused = s.paused; syncedPaused = s.paused;
      runner.speed = s.speed; syncedSpeed = s.speed;
      frame.runner = runner;
      lastError = made.error ? `sim: ${made.error}` : lastError === 'map not ready' ? lastError : null;
      s.setSimInfo(made.kind, made.error);
    } catch (e) {
      runner = null; frame.runner = null;
      lastError = `sim: ${errText(e)}`;
      console.warn('[headway] no sim available; showing the static town:', e);
      store.getState().setSimInfo('none', errText(e));
    }
    store.setState({ hud: null, observation: null, decisions: [] });
  };

  /** The real engine threw mid-run: keep the show going on the stub sim for this session. */
  const fallBack = (e: unknown) => {
    const msg = errText(e);
    console.warn('[headway] sim crashed; switching to the stub sim:', e);
    lastError = `sim crashed: ${msg}`;
    resetFeeds();
    try {
      if (!session || !runner) throw e;
      const scenario = session.scenario;
      runner.reset(() => createStubSim({ map: TOWN, scenario }));
      store.getState().setSimInfo('stub', msg);
    } catch (e2) {
      runner = null; frame.runner = null;
      store.getState().setSimInfo('none', errText(e2));
    }
  };

  const onStore = (s: AppState, prev: AppState) => {
    if (s.session?.key !== builtKey || s.sessionNonce !== builtNonce) build(s.session);
    applyView(s, prev);
  };
  build(store.getState().session);
  const unsub = store.subscribe(onStore);

  // ---------- frame loop ----------
  let raf = 0;
  let last = performance.now();
  let lastHud = -Infinity;

  const syncControls = () => {
    if (!runner) return;
    const s = store.getState();
    if (s.paused !== syncedPaused) { runner.paused = s.paused; syncedPaused = s.paused; }
    else if (runner.paused !== syncedPaused) { syncedPaused = runner.paused; s.setPaused(runner.paused); }
    if (s.speed !== syncedSpeed) { runner.speed = s.speed; syncedSpeed = s.speed; }
    else if (runner.speed !== syncedSpeed) { syncedSpeed = runner.speed; s.setSpeed(runner.speed); }
  };

  const ingest = (snap: SimSnapshot, nowMs: number) => {
    waits.observe(snap);
    const mode = store.getState().mode;
    for (const e of snap.events) {
      if (e.kind === 'decision' && e.record.source !== 'default') {
        decisions.unshift(e.record);
        decisionsDirty = true;
      }
    }
    if (decisions.length > MAX_DECISIONS) decisions.length = MAX_DECISIONS;
    if (mode === 'lab') return;
    for (const t of toaster.ingest(snap.events, nowMs)) store.getState().pushToast(t);
  };

  const publishHud = () => {
    if (!runner) return;
    let obs = null;
    try { obs = runner.sim.observe(); } catch { obs = null; }
    const hud = buildHud(runner.next, obs, waits.p95(runner.next.t));
    const patch: Partial<AppState> = obs ? { hud, observation: obs } : { hud };
    if (decisionsDirty) { patch.decisions = decisions.slice(); decisionsDirty = false; }
    store.setState(patch);
  };

  const tick = (now: number) => {
    if (disposed) return;
    raf = win.requestAnimationFrame(tick);
    const dt = Math.min(Math.max((now - last) / 1000, 0), 1);
    last = now;
    if (runner) {
      syncControls();
      try {
        runner.frame(dt);
      } catch (e) {
        fallBack(e);
      }
    }
    const r = runner;
    if (r && r.next !== lastNext) {
      lastNext = r.next;
      try { ingest(r.next, now); } catch (e) { console.warn('[headway] feed error:', e); }
    }
    if (renderer) {
      try {
        if (r) renderer.render(r.prev, r.next, r.alpha);
        else renderer.render(EMPTY_SNAPSHOT, EMPTY_SNAPSHOT, 1);
        renderFailures = 0;
      } catch (e) {
        if (renderFailures++ === 0) console.error('[headway] render failed:', e);
      }
    }
    if (now - lastHud >= HUD_INTERVAL_MS) {
      lastHud = now;
      try { publishHud(); } catch (e) { console.warn('[headway] HUD feed error:', e); }
    }
    frames++;
    if (!ready && runner) ready = true;
  };
  raf = win.requestAnimationFrame(tick);

  // ---------- picking ----------
  let down: { x: number; y: number; id: number } | null = null;
  let lastHover = 0;
  const onDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || !renderer) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a pan, not a click
    try {
      store.getState().select(renderer.pick(e.clientX, e.clientY));
    } catch (err) {
      console.warn('[headway] pick failed:', err);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!renderer || down || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - lastHover < HOVER_INTERVAL_MS) return;
    lastHover = now;
    try {
      a.canvas.style.cursor = renderer.pick(e.clientX, e.clientY) ? 'pointer' : '';
    } catch { /* hover is cosmetic */ }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (store.getState().selection) store.getState().select(null);
  };
  a.canvas.addEventListener('pointerdown', onDown);
  a.canvas.addEventListener('pointerup', onUp);
  a.canvas.addEventListener('pointermove', onMove);
  win.addEventListener('keydown', onKey);

  // ---------- resize ----------
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { try { renderer?.resize(); } catch { /* noop */ } }) : null;
  ro?.observe(a.container);

  // ---------- smoke-test probe ----------
  const probe: HeadwayProbe = {
    get t() { return frame.runner?.sim.t ?? 0; },
    get simT() { return frame.runner?.simT ?? 0; },
    get mode() { return store.getState().mode; },
    get ready() { return ready; },
    get sim() { return store.getState().simKind; },
    get renderer() { return renderer ? 'three' : 'none'; },
    get frames() { return frames; },
    get session() { return session?.key ?? null; },
    get error() { return lastError; },
  };
  Object.defineProperty(win, '__headway', { value: probe, configurable: true, writable: true });

  return () => {
    disposed = true;
    win.cancelAnimationFrame(raf);
    unsub();
    ro?.disconnect();
    a.canvas.removeEventListener('pointerdown', onDown);
    a.canvas.removeEventListener('pointerup', onUp);
    a.canvas.removeEventListener('pointermove', onMove);
    win.removeEventListener('keydown', onKey);
    try { renderer?.dispose(); } catch { /* noop */ }
    if (frame.renderer === renderer) frame.renderer = null;
    if (frame.runner === runner) frame.runner = null;
    if (frame.canvas === a.canvas) frame.canvas = null;
  };
}
