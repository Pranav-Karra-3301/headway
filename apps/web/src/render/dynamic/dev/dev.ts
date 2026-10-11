// Owner: P3 (v12). Dynamic-layer dev page (Vite dev: /src/render/dynamic/dev/index.html): the full TownRenderer
// driven by the real engine (G0), for the depot lot, reserve buses driving out, the 3-car train and route picking.
// Until the engine reports depot buses itself, two reserves (b7, b8) are injected into each snapshot (&fake=0 to stop).
// URL: &t=700 (fast-forward, sim s) &speed=8 &anim=0 &x=24&z=-2&zoom=3 (camera; zoom × the default fit, applied after
//      the first frames) &deploy=b8:r3:720 (inject: b8 leaves the depot for r3 at sim t 720) &hover=r2 | bus:b1
//      &select=bus:b1 | route:r1 &route=r1 (highlight) &light=dusk &clean=1 &off=world,traffic,fx,streetscape
import { G0, PolicyController, TOWN, createSim, deadheadPath, playInstance } from '@headway/sim';
import type { RouteId, SimSnapshot, VehicleView } from '@headway/sim';
import { SimRunner, type Speed } from '../../../sim/runner';
import { preloadTownAssets, TownRenderer } from '../../index';
import type { LightMode, Pick } from '../../types';
import type { DynamicPick } from '../index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
if (q.get('clean') === '1') document.body.classList.add('clean');
const off = new Set((q.get('off') ?? '').split(',').filter(Boolean));
const parsePick = (s: string | null): DynamicPick | null => {
  if (!s) return null;
  const [kind, id] = s.includes(':') ? s.split(':') : ['route', s];
  return { kind, id } as DynamicPick;
};

const canvas = document.getElementById('c') as HTMLCanvasElement;
await preloadTownAssets();
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const renderer = new TownRenderer(canvas, TOWN, {
  light, post: q.get('post') !== '0', autoQuality: false, preserveDrawingBuffer: true,
  layers: { world: !off.has('world'), streetscape: !off.has('streetscape'), traffic: !off.has('traffic'), fx: !off.has('fx') },
});
renderer.stage.setLight(light, true);

// ---------------------------------------------------------------- real engine, fast-forwarded
const sim = createSim({ map: TOWN, scenario: playInstance(0), controller: new PolicyController(G0) });
const ffT = num('t', 700);
while (sim.t < ffT && !sim.done) sim.step();
const runner = new SimRunner(() => sim, Number(q.get('speed') ?? 8) as Speed);
if (q.get('anim') === '0') runner.paused = true;

// ---------------------------------------------------------------- fake depot (until the engine has one)
const fake = q.get('fake') !== '0';
const [depId, depRoute, depT] = (q.get('deploy') ?? '').split(':');
const deployAt = depT ? Number(depT) : Infinity;
const busSpeed = 0.3;
const deployPath = depRoute ? deadheadPath(TOWN, 'r1', depRoute as RouteId) : null;
const decorated = new WeakMap<SimSnapshot, SimSnapshot>();
const decorate = (s: SimSnapshot): SimSnapshot => {
  if (!fake || s.vehicles.some((v) => v.state === 'depot')) return s;
  let d = decorated.get(s);
  if (d) return d;
  const extra: VehicleView[] = ['b7', 'b8'].map((id) => {
    const base: VehicleView = { id, kind: 'bus', routeId: null, path: { kind: 'route', routeId: 'r1' }, dist: 0, state: 'depot', onboard: 0,
      capacity: 40, nextStopId: null, holdUntil: null, lastDecision: null };
    if (id === depId && deployPath && s.t >= deployAt) {
      const dist = Math.min(deployPath.length, (s.t - deployAt) * busSpeed);
      return { ...base, routeId: depRoute as RouteId, path: { kind: 'deadhead', from: 'r1', to: depRoute as RouteId }, dist, state: 'deadhead' };
    }
    return base;
  });
  d = { ...s, vehicles: [...s.vehicles, ...extra] };
  decorated.set(s, d);
  return d;
};

// ---------------------------------------------------------------- interaction
const info = document.getElementById('info')!;
renderer.highlightRoute((q.get('route') as RouteId | null) ?? null);
const pre = parsePick(q.get('select'));
const show = (p: DynamicPick | null) => {
  renderer.dynamic.select(p);
  info.textContent = p ? `selected ${p.kind} ${p.id}` : 'click a bus, the train, a person or a route line';
};
show(pre);
const hoverParam = parsePick(q.get('hover'));
/** Vehicles / people first, then stops (TownRenderer), then route lines (stops win near their shelters). */
const pickAt = (x: number, y: number): DynamicPick | null => {
  const p: Pick | null = renderer.pick(x, y);
  if (p) return p;
  const rect = canvas.getBoundingClientRect();
  return renderer.dynamic.pickRoute(x - rect.left, y - rect.top, (v) => renderer.project(v.x, v.y, v.z));
};
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) show(pickAt(e.clientX, e.clientY));
  down = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (down) return;
  const p = pickAt(e.clientX, e.clientY);
  renderer.dynamic.hover(p);
  canvas.style.cursor = p ? 'pointer' : '';
});
canvas.addEventListener('pointerleave', () => renderer.dynamic.hover(hoverParam));
addEventListener('resize', () => renderer.resize());

// ---------------------------------------------------------------- loop
let last = performance.now(), frames = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  runner.frame(dt);
  if (frames === 3 && (q.has('x') || q.has('z') || q.has('zoom'))) {
    const t = renderer.stage.rig.target;
    renderer.stage.rig.set(num('x', t.x), num('z', t.z), renderer.stage.camera.zoom * num('zoom', 1));
  }
  if (frames === 3 && hoverParam) renderer.dynamic.hover(hoverParam);
  renderer.render(decorate(runner.prev), decorate(runner.next), runner.alpha);
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __dyn: unknown }).__dyn = { renderer, runner, sim, get frames() { return frames; }, ready: true };
