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
/** The study's recommendation (and the art bible's rule 1): true iso, azimuth 45°. */
const RECOMMENDED = viewId(ISO_ELEV, 45);
const pick = byId.get(RECOMMENDED)!;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: !q.has('noaa') && !!single, preserveDrawingBuffer: true }); // grid tiles are 2× supersampled instead
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.add(study.root);
const dusk = light === 'dusk' ? 1 : 0;
const lights = createLights({ bounds: TOWN.bounds, palette: 'a', dusk, shadowMapSize: single ? 4096 : 2048 });
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
  const pts = r.hiddenPoints.map((h) => ({ h, s: screenOf(f, toImage(b, h.p)), g: h.cls !== 'route' && h.cls !== 'rail' }));
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
    const cls = r === pick ? 'best' : rig ? 'rig' : '';
    const tags = (r === pick ? ' <b class="tag">pick</b>' : '') + (r === best && r !== pick ? ' <b class="tag ghost">top score</b>' : '');
    return `<tr class="${cls}"><td class="v">${i + 1}. ${r.view.label}${tags}</td>` +
      `<td>${pct(r.hidden.queue.frac)}</td><td>${pct(r.hidden.platformQueue.frac)}</td><td>${pct(r.hidden.stop.frac)}</td><td>${pct(r.hidden.platform.frac)}</td><td>${pct(r.hidden.route.frac)}</td><td>${pct(r.hidden.rail.frac)}</td><td>${pct(r.behindVehicle.frac)}</td>` +
      `<td>${r.fit.scale.toFixed(1)}</td><td>${r.screen.personPx.toFixed(1)}</td><td>${r.screen.networkPct.toFixed(0)}%</td>` +
      `<td>${r.screen.queueSpacingMinPx.toFixed(1)}</td><td>${r.screen.markersInvolved}/${r.perPlace.length}</td><td>${r.fit.inspectorScale.toFixed(1)}</td><td>${(r.fit.alt['1280×720'] ?? 0).toFixed(1)}</td>` +
      `<td>${pct(visibilityOf(r))}</td><td class="s">${r.score.toFixed(1)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>view (ranked by score)</th><th>stop<br>queues</th><th>platform<br>queues</th><th>stops</th><th>platform<br>edges</th><th>bus<br>routes</th><th>rail</th><th>behind a<br>dwelling bus/train</th>` +
    `<th>px / u</th><th>person<br>px</th><th>network<br>% screen</th><th>queue gap<br>px</th><th>marker<br>clashes</th><th>px / u<br>inspector</th><th>px / u<br>1280×720</th><th>visible<br>(weighted)</th><th>score</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  root.innerHTML = `<header><h1>Camera study</h1><p>Default Overview framing (bible §1.4 HUD-safe rect, 4 % pad) of the real town on a ${VW}×${VH} screen: ${town.sources.districtItems} district items + ${town.sources.baseItems} base-scenery items as catalog-sized occluder boxes, the world layer as a height field, stub-sim queues at t = ${Math.round(snap.t)} s; x-ray off. <span class="key"><i class="dot"></i> hidden queue slot / stop / platform edge</span> <span class="key"><i class="dot small"></i> hidden route / rail</span> <span class="key"><i class="dash"></i> HUD-safe rect</span></p></header>` +
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
    ctx.strokeStyle = r === pick ? '#F2C14E' : 'rgba(31,42,68,0.12)'; ctx.lineWidth = r === pick ? 4 : 1.5;
    roundRect(ctx, x, y, tileW, tileH, 14); ctx.stroke();
    // caption
    ctx.fillStyle = INK; ctx.font = '19px GumballRounded, system-ui'; ctx.textBaseline = 'top';
    ctx.fillText(r.view.label ?? r.view.id, x + 4, y + tileH + 7);
    if (group) { ctx.font = '12px GumballRounded, system-ui'; ctx.fillStyle = 'rgba(31,42,68,0.55)'; const w = ctx.measureText(group).width; ctx.fillText(group, x + tileW - w - 4, y + tileH + 11); }
    ctx.font = '600 12.5px "Avenir Next Rounded Std", Nunito, system-ui'; ctx.fillStyle = 'rgba(31,42,68,0.8)';
    ctx.fillText(caption(r), x + 4, y + tileH + 29);
    if (r === pick) {
      ctx.font = '19px GumballRounded, system-ui';
      const lx = x + 4 + ctx.measureText(r.view.label ?? r.view.id).width + 10;
      ctx.fillStyle = '#F2C14E'; roundRect(ctx, lx, y + tileH + 6, 112, 22, 11); ctx.fill();
      ctx.fillStyle = INK; ctx.font = '13px GumballRounded, system-ui'; ctx.fillText('recommended', lx + 12, y + tileH + 10);
    }
  }
  document.getElementById('table')!.innerHTML = tableHtml(results);
  const iso45 = byId.get(viewId(ISO_ELEV, 45))!, e30 = byId.get(viewId(30, 45))!, e45 = byId.get(viewId(45, 45))!, rig = byId.get(CURRENT_RIG_VIEW.id)!;
  document.getElementById('notes')!.innerHTML = notesHtml(pick, { iso45, e30, e45, rig });
  setMsg('');
}

function notesHtml(top: ViewResult, v: { iso45: ViewResult; e30: ViewResult; e45: ViewResult; rig: ViewResult }): string {
  const worst = [...top.perPlace].sort((a, b) => b.queueHidden + b.spotHidden - (a.queueHidden + a.spotHidden)).filter((p) => p.queueHidden + p.spotHidden > 0).slice(0, 4);
  const places = worst.map((p) => `<li><b>${p.name}</b> — ${p.queueHidden}/${p.queueN} queue slots, ${p.spotHidden}/${p.spotN} ${p.kind === 'stop' ? 'stop' : 'edge'} samples, by ${p.by.map((b) => `<code>${b}</code>`).join(', ')}</li>`).join('');
  const occ = new Map<string, number>();
  for (const h of top.hiddenPoints) if (h.cls === 'route') occ.set(h.by, (occ.get(h.by) ?? 0) + 1);
  const routeTop = [...occ.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `<code>${k}</code> ${n}`).join(', ');
  const px = (r: ViewResult) => `${r.fit.scale.toFixed(1)} px/u, people ${r.screen.personPx.toFixed(0)} px`;
  return `<div class="card"><h2>Why 35.26° · az 45°</h2><ul>` +
    `<li>A building of height h hides ground <b>1.22 h</b> deep at 30°, <b>1.0 h</b> at 35.26°, <b>0.71 h</b> at 45° (per axis). Measured: stop queues ${pct(v.e30.hidden.queue.frac)} → ${pct(v.iso45.hidden.queue.frac)} → ${pct(v.e45.hidden.queue.frac)}, routes ${pct(v.e30.hidden.route.frac)} → ${pct(v.iso45.hidden.route.frac)} → ${pct(v.e45.hidden.route.frac)}.</li>` +
    `<li>Size at Overview: 30° ${px(v.e30)} · 35.26° ${px(v.iso45)} · 45° ${px(v.e45)} — 45° drops people under the bible’s 10 px floor; 30° buys ~10 % size for double the hidden queues.</li>` +
    `<li>az 45° keeps E–W and N–S streets equally legible (35°/55° skew one family) and is what the districts were composed for; today’s 32° rig hides ${pct(v.rig.hidden.queue.frac)} of stop queues vs ${pct(v.iso45.hidden.queue.frac)}.</li>` +
    `</ul></div><div class="card"><h2>Still hidden at 35.26° · az 45° (fix in layout, then x-ray)</h2><ul>${places || '<li>no stop, queue or platform hidden</li>'}` +
    `<li>Routes are hidden mostly by ${routeTop || '—'} — tall camera-side buildings (bible §2.2).</li></ul></div>`;
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
