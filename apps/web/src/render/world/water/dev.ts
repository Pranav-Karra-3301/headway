// Owner: E2. Lake preview (Vite dev: /src/render/world/water/dev.html): the real TownRenderer (town, buses, people,
// world: base + terrain + water + sky) with a free camera for art-direction screenshots.
// URL: ?light=day|dusk &palette=a|b|c &elev=35 &az=45 &view=60 (world units tall) &x=0&z=0 (look-at on the ground)
//      &only=water (hide the other world parts) &off=traffic,fx,streetscape &post=0 &clean=1 &t=660 (sim fast-forward)
//      &anim=0 (freeze the sim) &mode=lite (no town: Stage + board + world only) &frames=40 (stop rendering after N
//      frames — fast headless screenshots)
import * as THREE from 'three';
import { createStubSim, playInstance, TOWN } from '@headway/sim';
import { SimRunner } from '../../../sim/runner';
import { TownRenderer } from '../../index';
import { bakeGeometry, makeBoard } from '../../kit';
import { KitMaterial } from '../../materials';
import { Stage } from '../../post';
import type { FrameContext } from '../../layers';
import type { LightMode, PaletteId } from '../../types';
import { createWorldLayer } from '../index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const light: LightMode = q.get('light') === 'dusk' ? 'dusk' : 'day';
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const off = new Set((q.get('off') ?? '').split(',').filter(Boolean));
if (q.get('clean') === '1') document.body.classList.add('clean');
document.body.classList.toggle('dusk', light === 'dusk');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const msg = document.getElementById('msg')!;

function aim(stage: Stage): void {
  const rig = stage.rig, cam = rig.camera;
  rig.bounds = null;
  const t = rig.target.clone();
  const tx = num('x', t.x), tz = num('z', t.z);
  if (q.has('elev') || q.has('az')) {
    const el = (num('elev', 35) * Math.PI) / 180, az = (num('az', 45) * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    cam.position.set(tx, 0, tz).addScaledVector(dir, 220);
    cam.far = 900;
    cam.lookAt(tx, 0, tz);
    if (rig.controls) { rig.controls.target.set(tx, 0, tz); rig.controls.update(); }
  } else if (q.has('x') || q.has('z')) {
    rig.set(tx, tz);
  }
  if (q.has('view')) cam.zoom = rig.view / num('view', 60);
  cam.updateProjectionMatrix();
}

function hideOthers(scene: THREE.Object3D): void {
  if (q.get('only') !== 'water') return;
  const world = scene.getObjectByName('world');
  world?.children.forEach((c) => { if (c.name !== 'water') c.visible = false; });
}

let frames = 0;
const maxFrames = num('frames', Infinity);
if (q.get('mode') === 'lite') {
  const b = TOWN.bounds;
  const stage = new Stage(canvas, { palette, light, bounds: b, maxHeight: 10, post: q.get('post') !== '0', autoQuality: false, preserveDrawingBuffer: true });
  stage.setLight(light, true);
  const board = new THREE.Mesh(bakeGeometry(makeBoard(b.maxX - b.minX, b.maxZ - b.minZ), palette).geometry, new KitMaterial());
  board.receiveShadow = true;
  stage.scene.add(board);
  const world = createWorldLayer(TOWN);
  world.setPalette?.(palette);
  world.setLight?.(light);
  stage.scene.add(world.object);
  hideOthers(stage.scene);
  aim(stage);
  const empty = { t: 0, vehicles: [], people: [], queues: [], events: [] } as unknown as FrameContext['prev'];
  let last = performance.now();
  const t0 = last;
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    world.update({ prev: empty, next: empty, alpha: 1, simT: 0, dtS: dt, timeS: (now - t0) / 1000, map: TOWN, camera: stage.camera, light, highlightedRoute: null });
    stage.render(dt);
    frames++;
    if (frames < maxFrames) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  msg.textContent = `lite · ${light}`;
} else {
  const renderer = new TownRenderer(canvas, TOWN, {
    palette, light, quality: 'high', post: q.get('post') !== '0', autoQuality: false, preserveDrawingBuffer: true,
    layers: { world: !off.has('world'), streetscape: !off.has('streetscape'), traffic: !off.has('traffic'), fx: !off.has('fx') },
  });
  renderer.stage.setLight(light, true);
  hideOthers(renderer.stage.scene);
  aim(renderer.stage);
  const sim = createStubSim({ map: TOWN, scenario: playInstance(0) });
  const ffT = num('t', 600);
  while (sim.t < ffT && !sim.done) sim.step();
  const runner = new SimRunner(() => sim, 4);
  if (q.get('anim') === '0') runner.paused = true;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    runner.frame(dt);
    renderer.render(runner.prev, runner.next, runner.alpha);
    frames++;
    if (frames % 30 === 0) {
      let draws = 0;
      renderer.stage.scene.getObjectByName('world')?.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) draws++; });
      msg.textContent = `${light} · world meshes ${draws} · t=${Math.round(runner.simT)}s`;
    }
    if (frames < maxFrames) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
(window as unknown as { __water: { frames: () => number } }).__water = { frames: () => frames };
