// Owner: E4. World integration preview: the real TownRenderer (town, world, streetscape, traffic, FX, Stage post
// chain) driven by the stub sim, so the board ↔ terrain ↔ water seams, exits and the rail tunnel look exactly like
// the game. URL (all optional):
//   /world-dev.html?light=day|dusk &palette=a|b|c &elev=35.264 &az=45 &zoom=1 (× the game's Overview fit)
//   &shot=overview|beauty|rail-out|rail-in|north|south|east|ne|sw|exit:<i> (framing presets; zoom/dx/dz still apply)
//   &x=..&z=.. (absolute target) &dx=..&dz=.. (pan in world units) &post=0 &t=660 (sim fast-forward, s) &anim=0
//   &off=traffic,fx,streetscape,world (drop layers) &route=r1|r2|r3 (highlight) &clean=1 (hide the caption)
import * as THREE from 'three';
import { createStubSim, playInstance, pointAt, RAIL_SPANS, TOWN } from '@headway/sim';
import type { ScenarioInstance } from '@headway/sim';
import { SimRunner } from '../../sim/runner';
import { preloadTownAssets, TownRenderer } from '../index';
import type { LightMode, PaletteId } from '../types';
import { WATER_KENNEY_IDS } from './water/index';
import { worldLayout } from './layout';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const off = new Set((q.get('off') ?? '').split(',').filter(Boolean));
const msg = document.getElementById('msg')!;
const fail = (e: unknown) => { msg.textContent = 'ERROR ' + String((e as Error)?.stack ?? e); msg.style.color = '#c00'; msg.style.opacity = '1'; };
addEventListener('error', (e) => fail(e.error ?? e.message));
document.body.classList.toggle('dusk', light === 'dusk');
document.body.classList.toggle('clean', q.get('clean') === '1');

const layout = worldLayout(TOWN);
const loop = TOWN.rail.loop;
/** Framing presets: target (world x, z) and zoom relative to the Overview fit. */
function preset(name: string): { x?: number; z?: number; zoom: number } {
  const at = (d: number) => pointAt(loop, d);
  if (name === 'beauty') return { zoom: 0.45 };
  if (name === 'rail-out') { const p = at(RAIL_SPANS.tunnel[1]); return { x: p.x + 4, z: p.z - 1, zoom: 2.6 }; }
  if (name === 'rail-in') { const p = at(RAIL_SPANS.tunnel[0]); return { x: p.x + 4, z: p.z + 2, zoom: 2.6 }; }
  if (name === 'north') return { x: -2, z: -28, zoom: 2 };
  if (name === 'south') return { x: -2, z: 30, zoom: 1.9 };
  if (name === 'east') return { x: 38, z: 4, zoom: 1.9 };
  if (name === 'ne') return { x: 36, z: -27, zoom: 2 };
  if (name === 'sw') return { x: -37, z: 27, zoom: 2 };
  const m = /^exit:(\d+)$/.exec(name);
  if (m) { const e = layout.exits[Number(m[1])]; if (e) return { x: e.p.x + e.dir.x * 3, z: e.p.z + e.dir.z * 3, zoom: 3 }; }
  return { zoom: 1 };
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
await preloadTownAssets({ extra: WATER_KENNEY_IDS });
const r = new TownRenderer(canvas, TOWN, {
  palette, light, preserveDrawingBuffer: true, autoQuality: false,
  post: q.get('post') !== '0', quality: q.get('quality') === 'low' ? 'low' : 'high',
  layers: { world: !off.has('world'), streetscape: !off.has('streetscape'), traffic: !off.has('traffic'), fx: !off.has('fx') },
});
r.stage.setLight(light, true);
const route = q.get('route');
if (route === 'r1' || route === 'r2' || route === 'r3') r.highlightRoute(route);

// ---------------------------------------------------------------- camera: art-bible iso (35.264°, 45°) by default
const cam = r.stage.camera, rig = r.stage.rig;
rig.bounds = null;
const frameView = () => {
  const el = (num('elev', 35.264) * Math.PI) / 180, az = (num('az', 45) * Math.PI) / 180;
  const t = rig.target.clone();
  cam.position.copy(t).add(new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(160));
  cam.lookAt(t);
  rig.controls?.update();
  r.fit();
  const p = preset(q.get('shot') ?? 'overview');
  const t0 = rig.target;
  rig.set(num('x', p.x ?? t0.x) + num('dx', 0), num('z', p.z ?? t0.z) + num('dz', 0), cam.zoom * p.zoom * num('zoom', 1));
};
r.stage.resize();
frameView();
addEventListener('resize', () => { r.stage.resize(); frameView(); });

// ---------------------------------------------------------------- stub sim, fast-forwarded (buses + the train move)
const scenario: ScenarioInstance = q.has('seed') ? { scenarioId: 'stadium_exit', seed: num('seed', 4001), split: 'showcase' } : playInstance(0);
const sim = createStubSim({ map: TOWN, scenario });
const ffT = num('t', 660);
while (sim.t < ffT && !sim.done) sim.step();
const runner = new SimRunner(() => sim, 4);
if (q.get('anim') === '0') runner.paused = true;

// ---------------------------------------------------------------- loop + caption (world draw calls for the budget)
const world = r.layers.find((l) => l.name === 'world');
const worldCalls = () => {
  let n = 0;
  world?.object.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
};
let last = performance.now(), frames = 0;
function frame(now: number): void {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
  last = now;
  try {
    runner.frame(dt);
    r.render(runner.prev, runner.next, runner.alpha);
  } catch (e) { fail(e); return; }
  if (++frames === 30 || frames % 120 === 0) {
    msg.textContent = `world v1 · ${light} · palette ${palette} · elev ${num('elev', 35.264)}° az ${num('az', 45)}° · ${q.get('shot') ?? 'overview'} ×${num('zoom', 1)}`
      + ` · layers ${r.layers.map((l) => l.name).join('+')} · world ${worldCalls()} draw calls · t=${Math.round(runner.simT)}s`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __worldReady: boolean; __world: unknown }).__worldReady = true;
(window as unknown as { __world: unknown }).__world = { renderer: r, runner, layout };
