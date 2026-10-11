// Owner: T2.3. Traffic preview (Vite dev: /src/render/traffic/preview.html): the full TownRenderer + stub sim with the
// app's frame.runner set, so the traffic layer reads the stadium closing time like it does in the app.
// URL: ?palette=a|b|c &light=day|dusk &seed=4001 &t=700 (sim s to start at) &pre=120 (traffic pre-roll, sim s)
//      &speed=8 &zoom=1 &x=&z= (camera target) &route=r1 &kit=1 (no Kenney cars) &cars=16 &off=world,fx,... &clean=1
//      &post=0 &quality=low (fast headless shots)
import { createStubSim, TOWN } from '@headway/sim';
import type { RouteId } from '@headway/sim';
import { SimRunner, type Speed } from '../../sim/runner';
import { frame } from '../../state/frame';
import { TownRenderer } from '../index';
import type { PaletteId } from '../types';
import { createTrafficLayer, vehiclePoses, type TrafficLayer } from './index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = q.get('light') === 'dusk' ? 'dusk' : 'day';
const seed = num('seed', 4001);
if (q.get('clean') === '1') document.body.classList.add('clean');
document.body.classList.toggle('dusk', light === 'dusk');
const off = new Set((q.get('off') ?? '').split(',').filter(Boolean));

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new TownRenderer(canvas, TOWN, {
  palette, light, preserveDrawingBuffer: true, seed, autoQuality: false, post: q.get('post') !== '0',
  quality: q.get('quality') === 'low' ? 'low' : 'high',
  layers: { world: !off.has('world'), streetscape: !off.has('streetscape'), traffic: false, fx: !off.has('fx') },
});
renderer.stage.setLight(light, true);
// Our own traffic layer (so preview options apply); the composer's is disabled above.
const traffic: TrafficLayer = createTrafficLayer(TOWN, {
  seed, ...(q.has('cars') ? { carCount: num('cars', 16) } : {}), kenney: q.get('kit') !== '1',
});
renderer.layers.push(traffic);
renderer.stage.scene.add(traffic.object);
traffic.setPalette?.(palette);
if (q.has('route')) renderer.highlightRoute(q.get('route') as RouteId);
if (q.has('zoom') || q.has('x') || q.has('z')) {
  const t = renderer.stage.rig.target;
  renderer.stage.rig.set(num('x', t.x), num('z', t.z), renderer.stage.camera.zoom * num('zoom', 1));
}

// Stub sim fast-forwarded to `t`; the last `pre` seconds also step the traffic (with bus/train poses).
const sim = createStubSim({ map: TOWN, scenario: { scenarioId: 'stadium_exit', seed, split: 'showcase' } });
const ffT = num('t', 700), pre = Math.min(ffT, num('pre', 120));
while (sim.t < ffT - pre && !sim.done) sim.step();
const runner = new SimRunner(() => sim, (Number(q.get('speed')) || 8) as Speed);
frame.runner = runner;
let prevSnap = sim.snapshot();
traffic.model.closingT = sim.observe().scenario.advertised.find((e) => e.kind === 'stadium_closing')?.t ?? null;
while (sim.t < ffT && !sim.done) {
  sim.step();
  const snap = sim.snapshot();
  const poses = vehiclePoses(TOWN, prevSnap, snap, 1);
  traffic.model.step(1, { simT: sim.t, buses: poses.buses, trainDist: poses.trainDist });
  prevSnap = snap;
}
runner.reset(() => sim);

const stats = document.getElementById('stats')!;
let last = performance.now(), total = 0, fpsT = 0, frames = 0;
function loop(now: number): void {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  runner.frame(dt);
  renderer.render(runner.prev, runner.next, runner.alpha);
  total++; frames++; fpsT += dt;
  if (fpsT > 0.5) {
    const cars = traffic.model.cars;
    const surge = cars.filter((c) => c.surge).length;
    const calls = traffic.object.children.filter((m) => (m as unknown as { count: number }).count > 0).length;
    stats.textContent = `${Math.round(frames / fpsT)} fps · ${cars.length} cars (${surge} leaving the stadium) · ${traffic.cars} models · ${calls} draw calls · t=${Math.round(runner.simT)} s · closes at ${traffic.model.closingT ?? '—'}`;
    frames = 0; fpsT = 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
addEventListener('resize', () => renderer.resize());
(window as unknown as { __traffic: unknown }).__traffic = { renderer, traffic, runner, get frames() { return total; } };
