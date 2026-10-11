// Owner: C1 (camera study). /camera-study.html — the measured comparison of default-camera candidates.
//   /camera-study.html                     3×2 screenshot grid + table (fit computed for a 1600×1000 viewport)
//   /camera-study.html?view=e-iso-a45      one view, full window (or ?elev=35.26&az=45), HUD ghosts + hidden samples
// Params: light=day|dusk · w,h (viewport the fit is computed for) · inspector=1 · hud=watch|play · t=<stub sim s>
//         overlay=0 (no HUD ghosts / markers) · world=0 (town only)
// Exposes window.__cameraStudy = { table, places, results } and window.__studyReady = true when drawn.
import * as THREE from 'three';
import { createStubSim, SEEDS, TOWN } from '@headway/sim';
import type { SimSnapshot } from '@headway/sim';
import { DISTRICTS } from '../../districts/index';
import { createLights } from '../../lights';
import { shared } from '../../materials';
import { createBackdrop } from '../../post/backdrop';
import { SCENERY } from '../../scenery';
import type { LightMode } from '../../types';
import { worldLayout } from '../../world/layout';
import { fitView, hudBoxes, screenOf, type Fit, type HudOptions } from './fit';
import { buildHeightField, heightFieldHit } from './heightfield';
import { measureView, rankViews, visibilityOf, type ViewResult } from './measure';
import { placeTable, studyTable } from './report';
import { studySamples } from './samples';
import { buildStudyScene } from './scene';
import { composeStudyTown, studyBoxes } from './town';
import { CURRENT_RIG_VIEW, ISO_ELEV, STUDY_VIEWS, toImage, viewBasis, viewId, viewLabel, type V3, type ViewSpec } from './views';

const q = new URLSearchParams(location.search);
const light: LightMode = q.get('light') === 'dusk' ? 'dusk' : 'day';
const overlay = q.get('overlay') !== '0';
const hud: HudOptions = { mode: q.get('hud') === 'play' ? 'play' : 'watch', inspector: q.get('inspector') === '1' };
const single: ViewSpec | null = (() => {
  const id = q.get('view');
  const all = [...STUDY_VIEWS, CURRENT_RIG_VIEW];
  if (id) return all.find((v) => v.id === id) ?? null;
  if (q.get('elev') || q.get('az')) {
    const e = Number(q.get('elev') ?? ISO_ELEV), a = Number(q.get('az') ?? 45);
    const elev = Math.abs(e - ISO_ELEV) < 0.01 ? ISO_ELEV : e;
    return { id: viewId(elev, a), elev, az: a, label: viewLabel(elev, a) };
  }
  return null;
})();
const VW = Number(q.get('w') ?? (single ? innerWidth : 1600)), VH = Number(q.get('h') ?? (single ? innerHeight : 1000));
const log = q.get('debug') ? console.warn.bind(console) : console.info.bind(console);
const T0 = performance.now();
const setMsg = (s: string) => { const m = document.getElementById('msg'); if (m) m.textContent = s; };

// ---------------------------------------------------------------- stub sim: a busy moment
function busySnapshot(): SimSnapshot {
  const sim = createStubSim({ map: TOWN, scenario: SEEDS.showcase[0]! });
  const want = q.get('t') ? Number(q.get('t')) : null;
  let best: SimSnapshot | null = null, bestN = -1;
  while (!sim.done && sim.t < (want ?? 1800)) {
    sim.step();
    if (want === null && sim.t % 30 === 0) {
      const s = sim.snapshot();
      const n = s.people.filter((p) => p.state === 'waiting').length;
      if (n > bestN) { bestN = n; best = s; }
    }
  }
  return want === null && best ? best : sim.snapshot();
}

// ---------------------------------------------------------------- measure + scene
const town = composeStudyTown(TOWN, DISTRICTS, SCENERY);
const layout = worldLayout(TOWN);
const samples = studySamples(TOWN, { railTunnel: layout.railTunnel });
const boxes = studyBoxes(town);
const snap = busySnapshot();
const tSnap = performance.now();
const study = buildStudyScene(TOWN, town, snap, { light, world: q.get('world') !== '0' });
log(`camera-study: snapshot t=${snap.t} in ${(tSnap - T0).toFixed(0)} ms, scene built in ${(performance.now() - tSnap).toFixed(0)} ms`);

const tWorld = performance.now();
const hf = study.world ? buildHeightField(study.world.object, layout.extent) : null;
/** World-layer meshes (terrain, forests, lighthouse, bridges …) block a ray until it climbs above 40 u. */
const worldHit = hf ? (p: V3, d: V3): string | null => { const h = heightFieldHit(hf, p, d); return h ? `world:${h}` : null; } : undefined;
const msWorld = performance.now() - tWorld;

const views = [...STUDY_VIEWS, CURRENT_RIG_VIEW];
const input = { map: TOWN, samples, boxes, viewport: { w: VW, h: VH }, hud, ...(worldHit ? { extraHit: worldHit } : {}) };
const tMeasure = performance.now();
const results = rankViews(views.map((v) => measureView(v, input)));
log(`camera-study: height field ${msWorld.toFixed(0)} ms, ${views.length} views measured in ${(performance.now() - tMeasure).toFixed(0)} ms, ${study.stats.triangles} static tris`);
const byId = new Map(results.map((r) => [r.view.id, r]));
const best = results.find((r) => r.view.id !== CURRENT_RIG_VIEW.id)!;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.add(study.root);
const dusk = light === 'dusk' ? 1 : 0;
const lights = createLights({ bounds: TOWN.bounds, palette: 'a', dusk, shadowMapSize: 4096 });
lights.fit(TOWN.bounds, 9);
scene.add(lights.group);
const backdrop = createBackdrop(scene, { palette: 'a', dusk, bounds: TOWN.bounds });
backdrop.setDusk(dusk);
shared.uDusk.value = dusk;
shared.uRim.value = 0.14 + 0.1 * dusk;

function cameraFor(view: ViewSpec, f: Fit): THREE.OrthographicCamera {
  const b = viewBasis(view);
  const cam = new THREE.OrthographicCamera(-f.viewport.w / 2 / f.scale, f.viewport.w / 2 / f.scale, f.viewport.h / 2 / f.scale, -f.viewport.h / 2 / f.scale, 1, 1200);
  cam.position.set(b.d.x * 400 + b.right.x * f.target.x + b.up.x * f.target.y, b.d.y * 400 + b.right.y * f.target.x + b.up.y * f.target.y, b.d.z * 400 + b.right.z * f.target.x + b.up.z * f.target.y);
  cam.lookAt(cam.position.x - b.d.x, cam.position.y - b.d.y, cam.position.z - b.d.z);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

const empty = snap;
function draw(view: ViewSpec, f: Fit, pxW: number, pxH: number, timeS: number): HTMLCanvasElement {
  renderer.setSize(pxW, pxH, false);
  const cam = cameraFor(view, f);
  study.update({ prev: empty, next: empty, alpha: 1, simT: snap.t, dtS: 1 / 60, timeS, camera: cam, light, highlightedRoute: null });
  renderer.render(scene, cam);
  return renderer.domElement;
}

// ---------------------------------------------------------------- 2D overlay (HUD ghosts, safe rect, hidden samples)
const INK = '#1F2A44', HIDDEN = '#E5484D';
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function drawOverlay(ctx: CanvasRenderingContext2D, r: ViewResult, f: Fit, ox: number, oy: number, k: number): void {
  const W = f.viewport.w, H = f.viewport.h, g = 14;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  // HUD ghosts at their real places (top bar pills, legend, bottom card, inspector)
  const ghost = (x: number, y: number, w: number, h: number, rad = 18) => {
    ctx.shadowColor = 'rgba(31,42,68,0.16)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(255,251,242,0.78)'; roundRect(ctx, x, y, w, h, rad); ctx.fill();
    ctx.shadowColor = 'transparent';
  };
  ghost(g, g, Math.min(400, W * 0.26), 52, 26);
  ghost(W / 2 - 290, g, 278, 52, 26); ghost(W / 2 - 4, g, 238, 52, 26);
  ghost(W - g - Math.min(350, W * 0.22) - 64, g, Math.min(350, W * 0.22), 52, 26); ghost(W - g - 52, g, 52, 52, 26);
  const boxes = hudBoxes(W, H, hud);
  const legend = boxes.find((b) => b.id === 'legend')!, bottom = boxes.find((b) => b.id === 'bottom')!, insp = boxes.find((b) => b.id === 'inspector');
  ghost(legend.x0 + g, legend.y0 + g, legend.x1 - legend.x0 - 2 * g, legend.y1 - legend.y0 - 2 * g);
  ghost(bottom.x0 + g, bottom.y0 + g, bottom.x1 - bottom.x0 - 2 * g, bottom.y1 - bottom.y0 - 2 * g);
  if (insp) ghost(insp.x0 + g, insp.y0 + g, insp.x1 - insp.x0 - 2 * g, insp.y1 - insp.y0 - 2 * g);
  // safe rect (sizes below are in output pixels: divide by k)
  ctx.setLineDash([7 / k, 6 / k]); ctx.lineWidth = 1.6 / k; ctx.strokeStyle = 'rgba(46,91,218,0.7)';
  ctx.strokeRect(f.rect.x0 + 2 / k, f.rect.y0 + 2 / k, f.rect.x1 - f.rect.x0 - 4 / k, f.rect.y1 - f.rect.y0 - 4 / k);
  ctx.setLineDash([]);
  // hidden samples: routes/rail first (small, soft), gameplay samples on top (ringed)
  const b = viewBasis(r.view);
  const pts = r.hiddenPoints.map((h) => ({ h, s: screenOf(f, toImage(b, h.p)), g: h.cls === 'queue' || h.cls === 'stop' || h.cls === 'platform' }));
  for (const { s, g } of pts) if (!g) { ctx.fillStyle = 'rgba(229,72,77,0.6)'; ctx.beginPath(); ctx.arc(s.x, s.y, 1.9 / k, 0, Math.PI * 2); ctx.fill(); }
  for (const { s, g } of pts) if (g) {
    ctx.fillStyle = HIDDEN; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 / k;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.1 / k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
function caption(r: ViewResult): string {
  return `queues hidden ${pct(r.hidden.queue.frac)} · stops ${pct(r.hidden.stop.frac)} · routes ${pct(r.hidden.route.frac)} · ${r.fit.scale.toFixed(1)} px/u · person ${r.screen.personPx.toFixed(0)} px`;
}

// ---------------------------------------------------------------- page
function tableHtml(rs: ViewResult[]): string {
  const rows = rs.map((r, i) => {
    const rig = r.view.id === CURRENT_RIG_VIEW.id;
    const cls = r === best ? 'best' : rig ? 'rig' : '';
    return `<tr class="${cls}"><td class="v">${i + 1}. ${r.view.label}${r === best ? ' <b class="tag">top</b>' : ''}</td>` +
      `<td>${pct(r.hidden.queue.frac)}</td><td>${pct(r.hidden.stop.frac)}</td><td>${pct(r.hidden.platform.frac)}</td><td>${pct(r.hidden.route.frac)}</td><td>${pct(r.hidden.rail.frac)}</td>` +
      `<td>${r.fit.scale.toFixed(1)}</td><td>${r.screen.groundPx.toFixed(1)}</td><td>${r.screen.personPx.toFixed(1)}</td><td>${r.screen.networkPct.toFixed(0)}%</td>` +
      `<td>${r.screen.queueSpacingMinPx.toFixed(1)}</td><td>${r.screen.markersInvolved}/${r.perPlace.length}</td><td>${r.fit.inspectorScale.toFixed(1)}</td><td>${(r.fit.alt['1280×720'] ?? 0).toFixed(1)}</td>` +
      `<td>${pct(visibilityOf(r))}</td><td class="s">${r.score.toFixed(1)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>view (ranked)</th><th>queue slots<br>hidden</th><th>stops</th><th>platform<br>edges</th><th>bus<br>routes</th><th>rail</th>` +
    `<th>px / u</th><th>ground<br>px / u</th><th>person<br>px</th><th>network<br>% screen</th><th>queue gap<br>px</th><th>marker<br>clashes</th><th>px / u<br>inspector</th><th>px / u<br>1280×720</th><th>visible<br>(weighted)</th><th>score</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const GRID: Array<[string, string]> = [
  [viewId(30, 45), 'elevation sweep · az 45°'], [viewId(ISO_ELEV, 45), ''], [viewId(45, 45), ''],
  [viewId(ISO_ELEV, 35), 'azimuth sweep at 35.26°'], [viewId(ISO_ELEV, 55), ''], [CURRENT_RIG_VIEW.id, 'reference: today’s rig'],
];

async function frame(): Promise<void> { await new Promise((res) => requestAnimationFrame(() => res(null))); }

async function runGrid(): Promise<void> {
  document.body.classList.add('grid');
  const root = document.getElementById('app')!;
  const cols = 3, tileW = Math.floor((Math.min(innerWidth, 1600) - 48 - 2 * 12) / cols), tileH = Math.round((tileW * VH) / VW);
  root.innerHTML = `<header><h1>Camera study</h1><p>Default framing of the real town (base scenery + districts on disk, catalog-sized occluders, stub-sim queues at t = ${Math.round(snap.t)} s) fitted into the HUD-safe area of a ${VW}×${VH} screen. <span class="key"><i class="dot"></i> hidden queue slot / stop / platform edge</span> <span class="key"><i class="dot small"></i> hidden route / rail</span> <span class="key"><i class="dash"></i> HUD-safe rect</span></p></header>` +
    `<canvas id="grid"></canvas><section id="table"></section><section id="notes"></section>`;
  const canvas = document.getElementById('grid') as HTMLCanvasElement;
  const gap = 12, capH = 46;
  const cw = cols * tileW + (cols - 1) * gap, ch = 2 * (tileH + capH) + gap;
  const ss = 2;
  canvas.width = cw * ss; canvas.height = ch * ss; canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ss, ss);
  for (let i = 0; i < GRID.length; i++) {
    const [id, group] = GRID[i]!;
    const r = byId.get(id)!;
    const f = fitView(r.view, TOWN, { w: VW, h: VH }, hud);
    const x = (i % cols) * (tileW + gap), y = Math.floor(i / cols) * (tileH + capH + gap);
    setMsg(`rendering ${r.view.label}…`);
    await frame();
    const src = draw(r.view, f, tileW * ss, tileH * ss, 1);
    ctx.save(); roundRect(ctx, x, y, tileW, tileH, 14); ctx.clip();
    ctx.drawImage(src, x, y, tileW, tileH);
    if (overlay) drawOverlay(ctx, r, f, x, y, tileW / VW);
    ctx.restore();
    ctx.strokeStyle = r === best ? '#F2C14E' : 'rgba(31,42,68,0.12)'; ctx.lineWidth = r === best ? 4 : 1.5;
    roundRect(ctx, x, y, tileW, tileH, 14); ctx.stroke();
    // caption
    ctx.fillStyle = INK; ctx.font = '19px GumballRounded, system-ui'; ctx.textBaseline = 'top';
    ctx.fillText(r.view.label ?? r.view.id, x + 4, y + tileH + 7);
    if (group) { ctx.font = '12px GumballRounded, system-ui'; ctx.fillStyle = 'rgba(31,42,68,0.55)'; const w = ctx.measureText(group).width; ctx.fillText(group, x + tileW - w - 4, y + tileH + 11); }
    ctx.font = '600 12.5px "Avenir Next Rounded Std", Nunito, system-ui'; ctx.fillStyle = 'rgba(31,42,68,0.8)';
    ctx.fillText(caption(r), x + 4, y + tileH + 29);
    if (r === best) {
      ctx.font = '19px GumballRounded, system-ui';
      const lx = x + 4 + ctx.measureText(r.view.label ?? r.view.id).width + 10;
      ctx.fillStyle = '#F2C14E'; roundRect(ctx, lx, y + tileH + 6, 92, 22, 11); ctx.fill();
      ctx.fillStyle = INK; ctx.font = '13px GumballRounded, system-ui'; ctx.fillText('top score', lx + 16, y + tileH + 10);
    }
  }
  document.getElementById('table')!.innerHTML = tableHtml(results);
  const iso45 = byId.get(viewId(ISO_ELEV, 45))!, e30 = byId.get(viewId(30, 45))!, e45 = byId.get(viewId(45, 45))!, rig = byId.get(CURRENT_RIG_VIEW.id)!;
  document.getElementById('notes')!.innerHTML = notesHtml(best, { iso45, e30, e45, rig });
  setMsg('');
}

function notesHtml(top: ViewResult, v: { iso45: ViewResult; e30: ViewResult; e45: ViewResult; rig: ViewResult }): string {
  const worst = [...top.perPlace].sort((a, b) => b.queueHidden + b.spotHidden - (a.queueHidden + a.spotHidden)).filter((p) => p.queueHidden + p.spotHidden > 0).slice(0, 4);
  const places = worst.map((p) => `<li><b>${p.name}</b> — ${p.queueHidden}/${p.queueN} queue slots, ${p.spotHidden}/${p.spotN} ${p.kind === 'stop' ? 'stop' : 'edge'} samples hidden by ${p.by.map((b) => `<code>${b}</code>`).join(', ')}</li>`).join('');
  return `<div class="card"><h2>Reading it</h2><ul>` +
    `<li>Ground hidden behind a building of height h: <b>1.73 h</b> at 30°, <b>1.41 h</b> at 35.26°, <b>1.0 h</b> at 45°.</li>` +
    `<li>In the HUD-safe rect, 30° and 35.26° fit at the same width (${v.e30.fit.scale.toFixed(1)} vs ${v.iso45.fit.scale.toFixed(1)} px/u) — so 35.26° shows more ground (${v.iso45.screen.networkPct.toFixed(0)}% vs ${v.e30.screen.networkPct.toFixed(0)}% of the screen) with less hidden; 45° turns height-limited (${v.e45.fit.scale.toFixed(1)} px/u, people ${v.e45.screen.personPx.toFixed(0)} px tall).</li>` +
    `<li>Today’s rig (32°) hides ${pct(v.rig.hidden.queue.frac)} of queue slots and ${pct(v.rig.hidden.route.frac)} of route samples vs ${pct(v.iso45.hidden.queue.frac)} / ${pct(v.iso45.hidden.route.frac)} at 35.26°.</li>` +
    `</ul></div><div class="card"><h2>Still hidden at the pick (${top.view.label}) — x-ray / layout</h2><ul>${places || '<li>nothing</li>'}</ul></div>`;
}

async function runSingle(view: ViewSpec): Promise<void> {
  document.body.classList.add('single');
  const r = byId.get(view.id) ?? measureView(view, input);
  const f = fitView(view, TOWN, { w: VW, h: VH }, hud);
  const root = document.getElementById('app')!;
  root.innerHTML = '<canvas id="view"></canvas><div id="card"></div>';
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ss = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * ss; canvas.height = innerHeight * ss;
  canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
  const ctx = canvas.getContext('2d')!;
  await frame();
  const k = innerWidth / VW;
  ctx.drawImage(draw(view, f, innerWidth * ss, Math.round((innerWidth * VH * ss) / VW), 1), 0, 0, canvas.width, Math.round((innerWidth * VH * ss) / VW));
  if (overlay) drawOverlay(ctx, r, f, 0, 0, k * ss);
  const card = document.getElementById('card')!;
  card.innerHTML = `<h2>${r.view.label}</h2><p>${caption(r)}</p><p>score ${r.score.toFixed(1)} · visible ${pct(visibilityOf(r))} · ${study.stats.triangles.toLocaleString()} static tris</p>`;
  card.style.display = overlay ? '' : 'none';
}

const done = single ? runSingle(single) : runGrid();
done.then(() => {
  const strip = (r: ViewResult) => ({ ...r, hiddenPoints: r.hiddenPoints.length });
  (window as unknown as { __cameraStudy: unknown }).__cameraStudy = {
    table: studyTable(results), places: placeTable(best), results: results.map(strip), town: town.sources, snapshotT: snap.t, stats: study.stats,
  };
  const pre = document.createElement('pre'); pre.id = 'dump'; pre.textContent = studyTable(results) + '\n\n' + placeTable(best); pre.style.display = 'none';
  document.body.append(pre);
  (window as unknown as { __studyReady: boolean }).__studyReady = true;
}).catch((err: unknown) => { setMsg(`camera study failed: ${String(err)}`); console.error(err); });
