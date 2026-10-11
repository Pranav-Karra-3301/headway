// Smoke-test the Headway web app in headless Chrome: per route, load the page, wait for window.__headway.ready,
// check mode and sim-time advance, sample the canvas for blankness, collect console errors, save a screenshot.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyzeImage, describeCanvas } from './analyze.mjs';
import { checkApi } from './api.mjs';
import { DEFAULT_OUT_DIR, DEFAULT_ROUTES, REPO_ROOT, routeUrl } from './args.mjs';
import { launchChrome } from './cdp.mjs';
import { consoleEntry, isIgnored, isNoise } from './console.mjs';
import { decodePng } from './png.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isApiUrl = (u) => {
  try { return new URL(u).pathname.startsWith('/api/'); } catch { return false; }
};
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const firstLine = (s) => s.split('\n')[0];

/** Reads window.__headway; `t` / `mode` / `ready` may be plain values, getters or functions. Other primitive fields
 *  (e.g. sim, renderer, frames, error) are copied into `extra` for the report. */
const STATE_EXPR = `(() => {
  const base = { readyState: document.readyState, origin: location.origin,
                 vite: !!document.querySelector('script[src^="/@vite/client"]') };
  const h = window.__headway;
  if (h === undefined || h === null) return { ...base, present: false };
  const read = (k) => { try { const v = h[k]; return typeof v === 'function' ? v.call(h) : v; } catch { return undefined; } };
  const t = read('t'), mode = read('mode'), ready = read('ready');
  const extra = {};
  for (const k in h) {
    if (k === 't' || k === 'mode' || k === 'ready') continue;
    let v;
    try { v = h[k]; } catch { continue; } // values only: never call the page's functions
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) extra[k] = v;
  }
  return { ...base, present: true, ready: !!ready, mode: mode == null ? null : String(mode),
           t: typeof t === 'number' && Number.isFinite(t) ? t : null, tType: typeof t, extra };
})()`;

/** Largest canvas actually visible in the viewport (CSS px, document coordinates). */
const CANVAS_EXPR = `(() => {
  const all = [...document.querySelectorAll('canvas')], vw = innerWidth, vh = innerHeight, list = [];
  for (const c of all) {
    const r = c.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(vw, r.right), y1 = Math.min(vh, r.bottom);
    const w = Math.floor(x1 - Math.ceil(x0)), h = Math.floor(y1 - Math.ceil(y0));
    if (w < 32 || h < 32) continue;
    const cs = getComputedStyle(c);
    if (cs.visibility !== 'visible' || cs.display === 'none') continue;
    let faded = false;
    for (let el = c; el; el = el.parentElement) if (parseFloat(getComputedStyle(el).opacity) === 0) { faded = true; break; }
    if (faded) continue;
    list.push({ x: Math.ceil(x0) + scrollX, y: Math.ceil(y0) + scrollY, w, h, bufferW: c.width, bufferH: c.height });
  }
  list.sort((a, b) => b.w * b.h - a.w * a.h);
  return { total: all.length, best: list[0] ?? null };
})()`;

/** While sampling, paint only canvases (no HUD, cards, filters or page background) so overlays cannot mask a blank
 *  canvas and a drawn canvas is not judged through a blur. Resolves after two frames. */
const STYLE_ID = '__headway_smoke_canvas_only';
const CANVAS_ONLY_ON = `(() => {
  let s = document.getElementById('${STYLE_ID}');
  if (!s) { s = document.createElement('style'); s.id = '${STYLE_ID}'; (document.head ?? document.documentElement).append(s); }
  s.textContent = 'html,body{background:#000!important;background-image:none!important}'
    + '*,*::before,*::after{visibility:hidden!important;filter:none!important;backdrop-filter:none!important;'
    + 'opacity:1!important;mix-blend-mode:normal!important;transition:none!important;animation:none!important}'
    + 'canvas{visibility:visible!important}';
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
})()`;
const CANVAS_ONLY_OFF = `(() => { document.getElementById('${STYLE_ID}')?.remove(); return true; })()`;

async function evalValue(page, expression, { awaitPromise = false, timeoutMs = 5000 } = {}) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

async function screenshot(page, clip) {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 };
  const { data } = await page.send('Page.captureScreenshot', params, 60_000);
  return Buffer.from(data, 'base64');
}

/** Screenshot the canvas alone (up to `attempts` times, 1 s apart, until it is not blank). */
async function sampleCanvas(page, box, attempts = 3) {
  let png, m;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1000);
    await evalValue(page, CANVAS_ONLY_ON, { awaitPromise: true, timeoutMs: 5000 }).catch(() => {});
    try {
      png = await screenshot(page, box);
    } finally {
      await evalValue(page, CANVAS_ONLY_OFF).catch(() => {});
    }
    m = analyzeImage(decodePng(png));
    if (!m.blank) break;
  }
  return { png, metrics: m };
}

/** @param {import('./cdp.mjs').Cdp} cdp */
async function smokeRoute(cdp, opts, route) {
  const url = routeUrl(opts, route);
  const started = Date.now();
  const res = {
    name: route.name, path: route.path, url, ok: false, failures: [], notes: [],
    status: null, loadMs: null, readyMs: null, mode: null, t0: null, t1: null, advanced: null,
    canvas: null, consoleErrors: [], ignoredErrors: 0, screenshot: null, headway: null, durationMs: 0,
  };
  const fail = (m) => res.failures.push(m);
  const note = (m) => res.notes.push(m);
  const origin = new URL(url).origin;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const page = cdp.session(sessionId);
  const sessions = new Map([[sessionId, 'page']]);
  const errors = [];
  const docs = [];
  let crashed = false;
  // The Vite dev server has no worker behind /api; the app's api.ts then falls back to /data, but Chrome still logs
  // the 404. Those are expected in dev only (on the deployed Worker an /api 404 is a real failure).
  let viteDev = false;
  const devApi404 = (e) => viteDev && e.kind === 'network' && /status of 404/.test(e.text) && isApiUrl(e.url);
  const off = cdp.on((m) => {
    if (!m.sessionId || !sessions.has(m.sessionId)) return;
    if (m.method === 'Target.attachedToTarget') {
      // Workers (e.g. Play's headless runs) report console errors on their own session.
      const child = m.params.sessionId;
      sessions.set(child, m.params.targetInfo?.type ?? 'child');
      cdp.send('Runtime.enable', {}, child).catch(() => {});
      cdp.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
      return;
    }
    if (m.method === 'Inspector.targetCrashed' && m.sessionId === sessionId) { crashed = true; return; }
    if (m.method === 'Network.responseReceived' && m.params.type === 'Document' && m.sessionId === sessionId) {
      docs.push(m.params);
      return;
    }
    const e = consoleEntry(m);
    if (e) errors.push(m.sessionId === sessionId ? e : { ...e, kind: `${sessions.get(m.sessionId)} ${e.kind}` });
  });

  try {
    await Promise.all([
      page.send('Page.enable'),
      page.send('Runtime.enable'),
      page.send('Log.enable'),
      page.send('Network.enable'),
      page.send('Inspector.enable').catch(() => {}),
      page.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false }),
      page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}),
      page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }),
    ]);
    await page.send('Page.bringToFront').catch(() => {});

    const navStart = Date.now();
    const nav = await page.send('Page.navigate', { url }, opts.loadTimeoutMs);
    const mainDoc = () => docs.filter((d) => d.frameId === nav.frameId && (!nav.loaderId || d.loaderId === nav.loaderId)).at(-1);
    let state = null;
    if (nav.errorText) fail(`navigation failed: ${nav.errorText}`);
    else {
      // Wait for window.__headway.ready. Bail early on an HTTP error page, a crash, or console errors that have
      // already failed the route once failFastMs has passed (a broken boot should not cost the full timeout).
      const reportable = () => errors.some((e) => !isIgnored(e, opts.ignore) && !devApi404(e));
      let stoppedEarly = false;
      while (Date.now() - navStart < opts.readyTimeoutMs && !crashed) {
        const d = mainDoc();
        if (d && d.response.status >= 400) break;
        if (Date.now() - navStart > opts.failFastMs && reportable()) { stoppedEarly = true; break; }
        const s = await evalValue(page, STATE_EXPR).catch(() => null);
        if (s && s.origin === origin) {
          state = s;
          if (s.vite) viteDev = true;
          if (s.readyState === 'complete' && res.loadMs === null) res.loadMs = Date.now() - navStart;
          if (s.present && s.ready) { res.readyMs = Date.now() - navStart; break; }
        }
        await sleep(100);
      }
      res.status = mainDoc()?.response.status ?? null;
      const waited = `after ${secs(Date.now() - navStart)}${stoppedEarly ? '; stopped early because of console errors' : ''}`;
      if (crashed) fail('page crashed');
      else if (res.status !== null && res.status >= 400) fail(`HTTP ${res.status} for ${route.path}`);
      else if (res.readyMs !== null) { /* ready */ }
      else if (!state || !state.present) fail(`window.__headway missing (not ready ${waited})`);
      else fail(`not ready: window.__headway.ready still false ${waited}`);
    }

    const ready = res.readyMs !== null;
    if (ready) {
      if (state.t === null) fail(`window.__headway.t is not a number (${state.tType})`);
      else {
        // Sim time must advance on Watch; elsewhere (Play's goal card, Lab panels) it is informational.
        let t0 = state.t;
        res.t0 = t0;
        const limit = route.mustAdvance ? opts.advanceTimeoutMs : Math.min(opts.advanceTimeoutMs, 2500);
        const since = Date.now();
        while (Date.now() - since < limit && !crashed) {
          await sleep(200);
          const s = await evalValue(page, STATE_EXPR).catch(() => null);
          if (!s || !s.present || s.origin !== origin || s.t === null) continue;
          state = s;
          if (s.t < t0) t0 = s.t; // the page reloaded (e.g. Vite re-optimised deps): measure from the new start
          res.t1 = s.t;
          if (s.t > t0) { res.advanced = true; break; }
        }
        if (res.advanced !== true) {
          res.advanced = false;
          const msg = `sim time did not advance (t stayed ${t0} for ${secs(limit)})`;
          if (route.mustAdvance) fail(msg);
          else note(`${msg}; not required on ${route.name}`);
        }
      }
      // Mode is read after the advance wait so a router that sets it one tick after `ready` is not flagged.
      res.mode = state.mode;
      if (route.mode) {
        if (state.mode === null) fail(`window.__headway.mode missing (expected '${route.mode}')`);
        else if (state.mode !== route.mode) fail(`mode is '${state.mode}', expected '${route.mode}'`);
      }
    }

    if (!crashed) {
      await evalValue(page, 'document.fonts ? document.fonts.ready.then(() => true) : true', { awaitPromise: true, timeoutMs: 3000 }).catch(() => {});
      const shot = join(opts.outDir, `${route.name}.png`);
      writeFileSync(shot, await screenshot(page));
      res.screenshot = shot;
    }

    if (ready && !crashed) {
      const probe = await evalValue(page, CANVAS_EXPR);
      if (!probe.best) {
        const msg = `no visible canvas (${probe.total} <canvas> element${probe.total === 1 ? '' : 's'}, none visible >= 32x32)`;
        if (route.requireCanvas) fail(msg);
        else note(msg);
      } else {
        const { png, metrics } = await sampleCanvas(page, probe.best);
        res.canvas = { ...probe.best, ...metrics };
        if (metrics.blank) {
          const file = join(opts.outDir, `${route.name}-canvas.png`);
          writeFileSync(file, png);
          const hints = [];
          // The sample is painted over a forced black page, so solid black means transparent (or cleared to black).
          if (metrics.why === 'uniform' && metrics.dominant === '#000000') hints.push('nothing drawn: transparent or cleared to black');
          if (probe.best.bufferW === 300 && probe.best.bufferH === 150) hints.push('drawing buffer is still the default 300x150, so the renderer never sized it');
          fail(`blank canvas (${metrics.why}): ${describeCanvas(metrics)}${hints.length ? `; ${hints.join('; ')}` : ''}; sample saved to ${rel(file)}`);
        }
      }
    }

    // Final probe read for the report (T3a's probe also carries sim / renderer / frames / error).
    const last = crashed ? null : await evalValue(page, STATE_EXPR).catch(() => null);
    if (last?.present && last.origin === origin) state = last;
    if (state?.present) {
      res.headway = { ready: state.ready, mode: state.mode, t: state.t, ...state.extra };
      if (typeof state.extra?.error === 'string' && state.extra.error) note(`window.__headway.error: ${state.extra.error}`);
    }
  } catch (e) {
    // A command timing out on a live page means the page stopped producing frames / answering (main thread busy).
    fail(/timed out/.test(e.message) ? `page unresponsive: ${e.message}` : `harness error: ${e.message}`);
  } finally {
    await sleep(100); // let late console events for this page arrive
    off();
    await cdp.send('Target.closeTarget', { targetId }, undefined, 5000).catch(() => {});
  }

  const seen = new Set();
  let devApi = 0;
  for (const e of errors) {
    // A worker error arrives twice (page log + worker exception): same first line, url with/without :line:col.
    const key = `${firstLine(e.text).replace(/\s+/g, ' ').trim()}|${(e.url ?? '').replace(/:\d+:\d+$/, '')}`;
    if (seen.has(key) || isNoise(e)) continue;
    seen.add(key);
    if (devApi404(e)) devApi++;
    else if (isIgnored(e, opts.ignore)) res.ignoredErrors++;
    else res.consoleErrors.push(e);
  }
  if (devApi) note(`Vite dev server: ignored ${devApi} /api 404${devApi === 1 ? '' : 's'} (no worker in dev; the app falls back to /data)`);
  for (const e of res.consoleErrors.slice(0, 5)) fail(`${e.kind}: ${firstLine(e.text)}${e.url ? ` (${e.url})` : ''}`);
  if (res.consoleErrors.length > 5) fail(`... and ${res.consoleErrors.length - 5} more console errors (see report.json)`);

  res.ok = res.failures.length === 0;
  res.durationMs = Date.now() - started;
  return res;
}

/**
 * Run the smoke test. Throws only for harness problems (Chrome missing / failing to start).
 * @param {{ url: string, query?: string, routes?: import('./args.mjs').RouteSpec[], outDir?: string, chromePath?: string | null,
 *   width?: number, height?: number, readyTimeoutMs?: number, advanceTimeoutMs?: number, loadTimeoutMs?: number,
 *   failFastMs?: number, ignore?: RegExp[], api?: boolean, log?: (line: string) => void }} o
 */
export async function runSmoke(o) {
  const opts = {
    query: '', routes: DEFAULT_ROUTES, outDir: DEFAULT_OUT_DIR, chromePath: null, width: 1600, height: 1000,
    readyTimeoutMs: 45_000, advanceTimeoutMs: 10_000, loadTimeoutMs: 30_000, failFastMs: 10_000, ignore: [], api: false,
    log: () => {},
    ...o,
  };
  opts.url = opts.url.replace(/\/+$/, '');
  mkdirSync(opts.outDir, { recursive: true });
  const started = Date.now();
  const report = {
    url: opts.url, ok: false, startedAt: new Date(started).toISOString(), durationMs: 0, browser: null,
    outDir: opts.outDir, routes: [], api: null,
  };
  const browser = await launchChrome({ chromePath: opts.chromePath, width: opts.width, height: opts.height });
  report.browser = browser.version;
  try {
    for (const route of opts.routes) {
      opts.log(`smoke: ${route.name} ${routeUrl(opts, route)}`);
      report.routes.push(await smokeRoute(browser.cdp, opts, route));
    }
  } finally {
    await browser.close();
  }
  if (opts.api) {
    opts.log('smoke: api');
    report.api = await checkApi(opts.url);
  }
  report.ok = report.routes.every((r) => r.ok) && (report.api ? report.api.ok : true);
  report.durationMs = Date.now() - started;
  writeFileSync(join(opts.outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

function rel(p) {
  const r = relative(REPO_ROOT, p);
  return r.startsWith('..') ? p : r;
}

const fmtT = (t) => (Number.isInteger(t) ? String(t) : t.toFixed(1));

/** Human-readable multi-line summary. */
export function formatReport(r) {
  const lines = [`Headway smoke: ${r.url} (${r.browser ?? 'no browser'})`];
  const w = Math.max(5, ...r.routes.map((x) => x.name.length));
  const pw = Math.max(5, ...r.routes.map((x) => x.path.length));
  for (const x of r.routes) {
    const bits = [];
    if (x.status !== null) bits.push(`HTTP ${x.status}`);
    if (x.readyMs !== null) bits.push(`ready ${secs(x.readyMs)}`);
    if (x.mode) bits.push(`mode ${x.mode}`);
    const app = ['sim', 'renderer', 'frames'].filter((k) => x.headway?.[k] != null).map((k) => `${k}=${x.headway[k]}`);
    if (app.length) bits.push(app.join(' '));
    if (x.t0 !== null) bits.push(`t ${fmtT(x.t0)} -> ${x.t1 !== null ? fmtT(x.t1) : '?'}`);
    if (x.canvas) bits.push(`canvas ${describeCanvas(x.canvas)}`);
    bits.push(`console errors ${x.consoleErrors.length}${x.ignoredErrors ? ` (+${x.ignoredErrors} ignored)` : ''}`);
    lines.push(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name.padEnd(w)}  ${x.path.padEnd(pw)}  ${bits.join(' | ')}`);
    for (const f of x.failures) lines.push(`      fail: ${f}`);
    for (const n of x.notes) lines.push(`      note: ${n}`);
    if (x.screenshot) lines.push(`      shot: ${rel(x.screenshot)}`);
  }
  if (r.api) {
    lines.push(`${r.api.ok ? 'PASS' : 'FAIL'}  ${'api'.padEnd(w)}  ${'/api'.padEnd(pw)}`);
    for (const f of r.api.failures) lines.push(`      fail: ${f}`);
    for (const n of r.api.notes) lines.push(`      note: ${n}`);
  }
  const passed = r.routes.filter((x) => x.ok).length;
  lines.push(
    `RESULT: ${r.ok ? 'PASS' : 'FAIL'} (${passed}/${r.routes.length} routes passed${r.api ? `, api ${r.api.ok ? 'passed' : 'failed'}` : ''}) ` +
      `in ${secs(r.durationMs)}; report ${rel(join(r.outDir, 'report.json'))}`,
  );
  return lines.join('\n');
}
