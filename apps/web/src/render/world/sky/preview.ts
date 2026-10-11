// Owner: E3. Dev preview of the sky + base through the real TownRenderer (town, world, streetscape, traffic, FX,
// Stage post chain), so it looks exactly like the game:
//   /src/render/world/sky/preview.html?light=day|dusk&palette=a|b|c&zoom=0.45&elev=35.264&az=45&dx=0&dz=0
//   &post=0 (plain render) &labels=0 &t=120 (cloud drift time offset) &ease=1 (start day, ease to `light`)
// `zoom` is relative to the game's default Overview fit; dx/dz pan the target in world units.
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import { TownRenderer } from '../../index';
import type { LightMode, PaletteId } from '../../types';

const q = new URLSearchParams(location.search);
const palette = (['a', 'b', 'c'].includes(q.get('palette') ?? '') ? q.get('palette') : 'a') as PaletteId;
const light = (q.get('light') === 'dusk' ? 'dusk' : 'day') as LightMode;
const msg = document.getElementById('msg')!;
const fail = (e: unknown) => { msg.textContent = 'ERROR ' + String((e as Error)?.stack ?? e); msg.style.opacity = '1'; msg.style.color = '#c00'; };
window.addEventListener('error', (e) => fail(e.error ?? e.message));
if (light === 'dusk') document.body.classList.add('dusk');
if (q.get('labels') === '0') document.body.classList.add('nolabels');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ease = q.get('ease') === '1';
const r = new TownRenderer(canvas, TOWN, {
  palette, light: ease ? 'day' : light, preserveDrawingBuffer: true, autoQuality: false,
  post: q.get('post') !== '0', quality: q.get('quality') === 'low' ? 'low' : 'high',
});
const cam = r.stage.camera;
const rig = r.stage.rig;
rig.bounds = null;
if (q.has('elev') || q.has('az')) {
  const el = (Number(q.get('elev') ?? 35.264) * Math.PI) / 180, az = (Number(q.get('az') ?? 45) * Math.PI) / 180;
  const t = rig.target.clone();
  cam.position.copy(t).add(new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(160));
  cam.lookAt(t);
  rig.controls?.update();
  r.fit();
}
const zoomK = Number(q.get('zoom') ?? 1) || 1;
const t0 = rig.target;
rig.set(t0.x + Number(q.get('dx') ?? 0), t0.z + Number(q.get('dz') ?? 0), cam.zoom * zoomK);
if (ease) setTimeout(() => r.setLight(light), 300);

const snap = (): SimSnapshot => ({
  t: 0, phase: 'running', vehicles: [], people: [], queues: [], events: [],
  running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
} as unknown as SimSnapshot);
const s = snap();
const tOff = Number(q.get('t') ?? 0);
if (tOff) (r as unknown as { startMs: number }).startMs -= tOff * 1000;
const resize = () => r.resize();
window.addEventListener('resize', resize);
const frame = () => {
  try { r.render(s, s, 1); } catch (e) { fail(e); return; }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
msg.textContent = `${palette} · ${light} · zoom ${zoomK} · ${r.layers.map((l) => l.name).join(' + ')}`;
(window as unknown as { __ready: boolean }).__ready = true;
