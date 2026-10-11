// Owner: C2 (camera rig). Camera rig preview (Vite dev: /src/render/camera/dev/rig-dev.html): the full TownRenderer
// with its camera driven by the C2 CameraRig, a mock HUD that sets the safe rect, presets, peek, focus and x-ray.
// URL: ?preset=overview|stadium|downtown|campus|central  &insp=1 (inspector open)  &mode=play (dock)  &guides=1 (safe rect)
//      &xray=0 &xmode=object (whole-occluder dither)  &light=dusk  &peek=-1|1 (hold Q/E)  &focus=<stopId>  &t=660 (sim s)  &clean=1  &nohud=1  &anim=0
import * as THREE from 'three';
import { createStubSim, playInstance, TOWN } from '@headway/sim';
import { SimRunner } from '../../../sim/runner';
import { preloadTownAssets, TownRenderer } from '../../index';
import { DISTRICTS } from '../../districts/index';
import type { LightMode, Pick } from '../../types';
import { CameraRig } from '../rig';
import { PRESETS, type PresetId } from '../presets';
import { boxesFromPlacements, queueTriggerPoints, XrayTracker, type XrayTrigger } from '../xray';
import type { Rect } from '../fit';
import { CAMERA } from '../iso';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const light: LightMode = q.get('light') === 'dusk' ? 'dusk' : 'day';
document.body.classList.toggle('play', q.get('mode') === 'play');
document.body.classList.toggle('insp', q.get('insp') === '1');
document.body.classList.toggle('guides', q.get('guides') === '1');
document.body.classList.toggle('clean', q.get('clean') === '1');
document.body.classList.toggle('nohud', q.get('nohud') === '1');
const msg = document.getElementById('msg')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
await preloadTownAssets();
const renderer = new TownRenderer(canvas, TOWN, { light, preserveDrawingBuffer: true, autoQuality: false });
renderer.stage.setLight(light, true);

// ---------------------------------------------------------------- hand the Stage camera to the C2 rig
const old = renderer.stage.rig as unknown as { controls: { dispose(): void } | null; update(): void; resize(): void; set(): void; focus(): void };
old.controls?.dispose();
old.update = old.resize = old.set = old.focus = () => {};
const rig = new CameraRig(canvas, { map: TOWN, camera: renderer.stage.camera, keys: true });

const $ = (id: string) => document.getElementById(id)!;
const box = (el: HTMLElement): Rect | null => {
  if (getComputedStyle(el).display === 'none' || document.body.classList.contains('nohud')) return null;
  const r = el.getBoundingClientRect();
  return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
};
/** The bible's safe rect from the live HUD: below the bar + 36 px, cut by the inspector and the Play dock. */
function hudRect(): { rect: Rect; corners: Rect[] } {
  const w = canvas.clientWidth, h = canvas.clientHeight, g = CAMERA.hudGap;
  const bar = box($('bar')), insp = box($('insp')), bottom = box($('bottom')), legend = box($('legend'));
  const play = document.body.classList.contains('play');
  const rect = {
    x0: g, y0: (bar ? bar.y1 + g : 0) + CAMERA.hudMarkers,
    x1: insp ? insp.x0 - g : w - g, y1: play && bottom ? bottom.y0 - g : h - g,
  };
  const corners = [legend, play ? null : bottom].filter((r): r is Rect => !!r);
  return { rect, corners };
}
function showSafe(): void {
  const s = rig.safeRect, el = $('safe');
  Object.assign(el.style, { left: `${s.x0}px`, top: `${s.y0}px`, width: `${s.x1 - s.x0}px`, height: `${s.y1 - s.y0}px` });
}
function layout(animate: boolean): void {
  renderer.resize();
  rig.resize(canvas.clientWidth, canvas.clientHeight);
  const { rect, corners } = hudRect();
  rig.setSafeRect(rect, { corners, animate });
  showSafe();
}
layout(false);
addEventListener('resize', () => layout(false));

// ---------------------------------------------------------------- presets + mode readout
const presetsEl = $('presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'chip gb';
  b.dataset.id = p.id;
  b.innerHTML = `<kbd>${p.key}</kbd>${p.label}`;
  b.addEventListener('click', () => rig.preset(p.id));
  presetsEl.append(b);
}
const showMode = () => {
  presetsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.id === (rig.mode === 'overview' ? 'overview' : rig.activePreset)));
  $('mode').textContent = rig.mode;
};
rig.onModeChange = showMode;
showMode();
addEventListener('keydown', (e) => {
  const p = PRESETS.find((x) => x.key === e.key);
  if (p) rig.preset(p.id);
  if (e.key === 'i') { document.body.classList.toggle('insp'); const { rect, corners } = hudRect(); rig.setSafeRect(rect, { corners }); showSafe(); }
  if (e.key === 'x') xray.enabled = !xray.enabled;
  if (e.key === 'g') document.body.classList.toggle('guides');
  if (e.key === 'f' && selected) { const at = renderer.dynamic.positionOf(selected); if (at) rig.focusOn(at); }
});

// ---------------------------------------------------------------- picking / focus
let selected: Pick | null = null;
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
    selected = renderer.pick(e.clientX, e.clientY);
    renderer.select(selected);
    if (selected) { const at = renderer.dynamic.positionOf(selected); if (at) rig.ensureVisible(at); }
  }
  down = null;
});
canvas.addEventListener('dblclick', (e) => {
  const p = renderer.pick(e.clientX, e.clientY);
  if (!p) return;
  const at = renderer.dynamic.positionOf(p);
  if (at) rig.focusOn(at);
  if (p.kind === 'bus' || p.kind === 'train') rig.follow(() => renderer.dynamic.positionOf(p));
});

// ---------------------------------------------------------------- x-ray over the district scenery
const xray = new XrayTracker(boxesFromPlacements(DISTRICTS.flatMap((d) => d.items)));
const tAttach = performance.now();
const tagged = xray.attach(renderer.town.object, (m) => /^(scenery|trees)/.test(m.name) || ((m as THREE.InstancedMesh).isInstancedMesh && !m.name));
const attachMs = performance.now() - tAttach;
xray.enabled = q.get('xray') !== '0';

// ---------------------------------------------------------------- sim
const sim = createStubSim({ map: TOWN, scenario: playInstance(0) });
const ffT = num('t', 660);
while (sim.t < ffT && !sim.done) sim.step();
const runner = new SimRunner(() => sim, 4);
if (q.get('anim') === '0') runner.paused = true;

// ---------------------------------------------------------------- initial view from the URL
const pre = q.get('preset') as PresetId | null;
if (pre && PRESETS.some((p) => p.id === pre)) rig.preset(pre, false);
const fstop = q.get('focus');
if (fstop) { const s = TOWN.stops.find((x) => x.id === fstop); if (s) rig.focusOn({ x: s.p.x, y: 0.4, z: s.p.z }, { animate: false }); }
if (q.has('peek')) { const d = Math.sign(num('peek', 0)) as -1 | 0 | 1; rig.peek(d); rig.setAzimuth(CAMERA.azimuthDeg + d * CAMERA.peekDeg, false); }

// ---------------------------------------------------------------- loop
let last = performance.now(), frames = 0, nX = 0;
function triggers(): XrayTrigger[] {
  const pts = queueTriggerPoints(TOWN, runner.next.queues);
  for (const v of runner.next.vehicles) {
    const at = renderer.dynamic.positionOf({ kind: v.kind, id: v.id } as Pick);
    if (at) pts.push({ x: at.x, y: at.y + 0.55, z: at.z, key: `v:${v.id}`, r: v.kind === 'train' ? 3 : 2 });
  }
  if (selected) { const at = renderer.dynamic.positionOf(selected); if (at) pts.push({ x: at.x, y: at.y + 0.5, z: at.z, key: 'sel', r: 1.6 }); }
  return pts;
}
function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  runner.frame(dt);
  rig.update(dt);
  nX = xray.update(triggers(), rig.viewDir, dt, q.get('xmode') === 'object' ? undefined : { camera: rig.camera, w: canvas.clientWidth, h: canvas.clientHeight, pxPerUnit: rig.pxPerUnit });
  renderer.render(runner.prev, runner.next, runner.alpha);
  frames++;
  if (frames % 15 === 1) {
    msg.textContent = `${rig.mode}${rig.activePreset ? ` · ${rig.activePreset}` : ''} · ${rig.pxPerUnit.toFixed(1)} px/u · ${rig.zoomK.toFixed(2)}× Overview · az ${rig.azimuthDeg.toFixed(1)}° · x-ray ${xray.enabled ? `${nX} faded` : 'off'} (${xray.boxes.length} boxes, ${tagged.meshes} meshes tagged in ${attachMs.toFixed(0)} ms) · frame ${frames}`;
    showMode();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __rig: unknown }).__rig = { rig, renderer, xray, get frames() { return frames; }, ready: true };
