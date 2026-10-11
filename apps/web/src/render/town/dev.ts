// Owner: T2.2. Town dev page (Vite dev: /src/render/town/dev.html): the full TownRenderer driven by the stub sim.
// URL: ?palette=a|b|c &detail=toy|min &light=day|dusk &quality=high|low &post=0 &speed=8 &t=660 (fast-forward, sim s)
//      &anim=0 (freeze after fast-forward) &route=r1 (highlight) &select=bus:b1 &zoom=1.4 &x=0&z=0 (pan target)
//      &off=world,traffic,fx,streetscape (drop layers) &clean=1 (hide UI) &seed=4001
import * as THREE from 'three';
import { createStubSim, playInstance, TOWN } from '@headway/sim';
import type { RouteId, ScenarioInstance } from '@headway/sim';
import { SimRunner, type Speed } from '../../sim/runner';
import { TownRenderer } from '../index';
import type { Quality } from '../post';
import type { DetailMode, LightMode, PaletteId, Pick } from '../types';

const q = new URLSearchParams(location.search);
const pickParam = <T extends string>(k: string, ok: readonly T[], d: T): T => (ok.includes(q.get(k) as T) ? (q.get(k) as T) : d);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const state = {
  palette: pickParam<PaletteId>('palette', ['a', 'b', 'c'], 'a'),
  detail: pickParam<DetailMode>('detail', ['min', 'toy'], 'toy'),
  light: pickParam<LightMode>('light', ['day', 'dusk'], 'day'),
  route: pickParam<RouteId | 'none'>('route', ['r1', 'r2', 'r3', 'none'], 'none'),
  speed: String(pickParam('speed', ['1', '4', '8', '16'], '8')),
};
if (q.get('clean') === '1') document.body.classList.add('clean');
const off = new Set((q.get('off') ?? '').split(',').filter(Boolean));

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new TownRenderer(canvas, TOWN, {
  palette: state.palette, detail: state.detail, light: state.light,
  quality: pickParam<Quality>('quality', ['high', 'low'], 'high'),
  post: q.get('post') !== '0', autoQuality: q.get('auto') === '1', preserveDrawingBuffer: true,
  layers: { world: !off.has('world'), streetscape: !off.has('streetscape'), traffic: !off.has('traffic'), fx: !off.has('fx') },
});
renderer.stage.setLight(state.light, true);
if (q.has('zoom') || q.has('x') || q.has('z')) {
  const t = renderer.stage.rig.target;
  renderer.stage.rig.set(num('x', t.x), num('z', t.z), renderer.stage.camera.zoom * num('zoom', 1));
}

// ---------------------------------------------------------------- stub sim, fast-forwarded
const scenario: ScenarioInstance = q.has('seed') ? { scenarioId: 'stadium_exit', seed: num('seed', 4001), split: 'showcase' } : playInstance(0);
const sim = createStubSim({ map: TOWN, scenario });
const ffT = num('t', 660);
while (sim.t < ffT && !sim.done) sim.step();
const runner = new SimRunner(() => sim, Number(state.speed) as Speed);
if (q.get('anim') === '0') runner.paused = true;

// ---------------------------------------------------------------- UI
const selEl = document.getElementById('sel')!;
const apply = () => {
  renderer.setPalette(state.palette);
  renderer.setDetail(state.detail);
  renderer.setLight(state.light);
  renderer.highlightRoute(state.route === 'none' ? null : state.route);
  runner.speed = Number(state.speed) as Speed;
  document.body.classList.toggle('dusk', state.light === 'dusk');
  document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.classList.toggle('on', state[b.dataset.k as keyof typeof state] === b.dataset.v));
};
document.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => {
  (state as Record<string, string>)[b.dataset.k!] = b.dataset.v!;
  apply();
}));
apply();
const showSel = (p: Pick | null) => {
  renderer.select(p);
  selEl.textContent = p ? `selected ${p.kind} ${p.id}` : '';
};
const pre = q.get('select');
if (pre) { const [kind, id] = pre.split(':'); showSel({ kind: kind as Pick['kind'], id: id ?? '' }); }
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) showSel(renderer.pick(e.clientX, e.clientY));
  down = null;
});
canvas.addEventListener('dblclick', (e) => { const p = renderer.pick(e.clientX, e.clientY); if (p) renderer.focus(p); });
addEventListener('resize', () => renderer.resize());

// ---------------------------------------------------------------- loop
const stats = document.getElementById('stats')!;
let last = performance.now(), frames = 0, fpsT = 0, fps = 0, total = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  runner.frame(dt);
  renderer.render(runner.prev, runner.next, runner.alpha);
  frames++; total++;
  fpsT += dt;
  if (fpsT > 0.5) {
    fps = Math.round(frames / fpsT); frames = 0; fpsT = 0;
    let meshes = 0;
    renderer.stage.scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    const s = renderer.town.stats, d = renderer.dynamic.stats();
    stats.textContent = `${fps} fps · ${renderer.stage.quality} · ${meshes} scene meshes · static ${s.meshes} baked + ${s.instanced} instanced (${(s.vertices / 1000).toFixed(0)}k verts, ${s.items} items, ${s.placeholders} placeholders) · ${d.buses} buses · ${d.people} people · t=${Math.round(runner.simT)}s`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __town: unknown }).__town = { renderer, runner, get frames() { return total; }, ready: true };
