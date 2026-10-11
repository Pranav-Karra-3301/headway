// Owner: T3b. HUD dev harness (never shipped: `vite build` only bundles index.html). The app's layout, the real
// T3a top bar, a scripted FakeSim through the real SimRunner, a 2D placeholder renderer. In Play it feeds
// store.play.pace the way modes/play/game.ts does (AI curves on a 30-s grid), so the pace chip is live.
// Open /src/ui/hud/dev/index.html  ?t=840 · ?speed=8 · ?mode=play · ?select=bus:b4 | stop:stop_downtown | person:17
//                                   · ?palette=a|b|c · ?light=day|dusk · ?paused=1
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../styles/index.css';
import { applyTheme } from '../../../styles/theme';
import { frame } from '../../../state/frame';
import { useApp } from '../../../state/store';
import type { HudMetrics, Mode } from '../../../state/store';
import { SimRunner } from '../../../sim/runner';
import type { Speed } from '../../../sim/runner';
import type { LightMode, PaletteId, Pick } from '../../../render/types';
import { TopBar } from '../../shell/TopBar';
import { Inspector } from '../Inspector';
import { QueueMarkers } from '../QueueMarkers';
import { RouteLegend } from '../RouteLegend';
import { Toasts } from '../Toasts';
import { localClock } from '../format';
import { FakeSim, buildGeo } from './devSim';
import { createDevRenderer } from './devRenderer';

const q = new URLSearchParams(location.search);
const T0 = Number(q.get('t') ?? 840);
const SPEED = (Number(q.get('speed') ?? 8) as Speed) || 8;
const MODE = (q.get('mode') ?? 'watch') as Mode;
const PALETTE = (q.get('palette') ?? 'a') as PaletteId;
const LIGHT = (q.get('light') ?? 'day') as LightMode;
const SELECT = q.get('select');

useApp.setState({ mode: MODE, palette: PALETTE, light: LIGHT, speed: SPEED, paused: q.get('paused') === '1' });
if (MODE === 'play') useApp.getState().setPlay({ phase: 'playing' });
if (SELECT) {
  const [kind, id] = SELECT.split(':');
  if (kind && id) useApp.setState({ selection: { kind: kind as Pick['kind'], id } });
}

const EVENT_TOASTS = [
  { kind: 'transfer' as const, text: '6 transfers made, most at Central Station' },
  { kind: 'missed' as const, text: '3 missed connections, most at Downtown' },
  { kind: 'walkaway' as const, text: 'Someone gave up waiting at Apartments South and walked' },
];

function Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mode = useApp((s) => s.mode);
  const light = useApp((s) => s.light);
  const palette = useApp((s) => s.palette);

  useEffect(() => applyTheme(palette, light), [palette, light]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const geo = buildGeo();
    const runner = new SimRunner(() => new FakeSim(T0, geo), useApp.getState().speed);
    runner.paused = useApp.getState().paused;
    const renderer = createDevRenderer(canvas, geo, { palette: useApp.getState().palette, light: useApp.getState().light });
    frame.canvas = canvas;
    frame.runner = runner;
    frame.renderer = renderer;
    renderer.select(useApp.getState().selection);

    const unsub = useApp.subscribe((s, p) => {
      if (s.selection !== p.selection) renderer.select(s.selection);
      if (s.highlightedRoute !== p.highlightedRoute) renderer.highlightRoute(s.highlightedRoute);
      if (s.palette !== p.palette) renderer.setPalette(s.palette);
      if (s.light !== p.light) renderer.setLight(s.light);
      if (s.paused !== runner.paused) runner.paused = s.paused;
      if (s.speed !== runner.speed) runner.setSpeed(s.speed);
    });
    const onClick = (e: MouseEvent) => useApp.getState().select(renderer.pick(e.clientX, e.clientY));
    canvas.addEventListener('click', onClick);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    let raf = 0;
    let last = performance.now();
    let feedAcc = 1;
    let toastIdx = 0;
    // Scripted event toasts on a timer (rAF is sparse in headless screenshots).
    const pushEvent = () => {
      if (useApp.getState().paused) return;
      const e = EVENT_TOASTS[toastIdx++ % EVENT_TOASTS.length]!;
      useApp.getState().pushToast({ ...e, simT: runner.sim.t });
    };
    const t1 = window.setTimeout(pushEvent, 400);
    const t2 = window.setTimeout(pushEvent, 900);
    const iv = window.setInterval(pushEvent, 3400);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      runner.frame(dt);
      renderer.render(runner.prev, runner.next, runner.alpha);
      feedAcc += dt;
      if (feedAcc >= 0.25) {
        feedAcc = 0;
        const obs = runner.sim.observe();
        const r = obs.running;
        const hud: HudMetrics = {
          t: obs.t, clock: localClock(obs.scenario.clockStart, obs.t), phase: runner.sim.done ? 'done' : obs.phase,
          meanWaitS: r.meanWaitS, completionPct: r.spawned ? (r.completed / r.spawned) * 100 : 0, missedConnections: r.missedConnections,
          waitingNow: r.waitingNow, ridingNow: r.ridingNow, jSoFar: r.jSoFar, p95WaitS: Math.round(r.meanWaitS * 2.7),
        };
        const app = useApp.getState();
        if (app.mode === 'play' && app.play.pace.length === 0) {
          // AI curves on the 30-s grid for the whole run (the champion slightly worse than this fake "you" here).
          const pace = [];
          for (let t = 0; t <= 2700; t += 30) {
            const j = r.jSoFar * (t / Math.max(1, obs.t)) ** 1.6;
            pace.push({ t, you: Number.NaN, champion: j * 1.016 + 900, baseline: j * 1.07 + 2000 });
          }
          app.setPlay({ pace });
        }
        app.setHudFeed(hud, obs);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearInterval(iv);
      unsub();
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      frame.runner = null;
      frame.renderer = null;
      frame.canvas = null;
    };
  }, []);

  return (
    <div className="hw-app" data-mode={mode} data-light={light}>
      <div className="hw-stage"><canvas ref={canvasRef} className="hw-canvas" /></div>
      <div className="hw-markers" aria-hidden="true"><QueueMarkers /></div>
      <div className="hw-hud">
        <TopBar />
        <div className="hw-area hw-area--right"><Inspector /></div>
        <div className="hw-area hw-area--left"><RouteLegend /></div>
        <div className="hw-area hw-area--bottom" />
        <div className="hw-area hw-area--toasts"><Toasts /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
