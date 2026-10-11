// End-to-end: real headless Chrome against fake Headway pages served locally. Skips when Chrome is not installed.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { routeFor } from '../args.mjs';
import { findChrome } from '../cdp.mjs';
import { decodePng } from '../png.mjs';
import { formatReport, runSmoke } from '../smoke.mjs';
import { fakePage, serve } from './helpers.mjs';

const chrome = findChrome();
const skip = chrome ? false : 'Chrome not found (set CHROME_PATH)';
const route = (path, mode, extra = {}) => ({ path, name: path.slice(1) || 'root', mode, mustAdvance: false, requireCanvas: false, ...extra });

describe('smoke harness against fake pages', { skip, timeout: 180_000 }, () => {
  let site;
  let out;
  before(async () => {
    out = mkdtempSync(join(tmpdir(), 'headway-smoke-test-'));
    const page = (o) => ({ body: fakePage(o) });
    site = await serve({
      // a healthy app: Watch advances; Play is paused behind a goal card with a WebGL town; Lab has no canvas
      '/': page({ mode: 'watch', canvas: '2d', consoleWarn: 'just a warning' }),
      '/play': page({ mode: 'watch', modeAfterReady: 'play', canvas: 'webgl', overlay: true, advance: false }),
      '/lab': page({ mode: 'lab', canvas: 'none' }),
      // broken variants
      '/err': page({ consoleError: 'kaboom from console' }),
      '/throw': page({ throwError: 'uncaught kaboom' }),
      '/reject': page({ rejectError: 'rejected kaboom' }),
      '/worker': page({ workerError: 'worker kaboom' }),
      '/blank': page({ canvas: 'blank' }),
      '/blank-gl': page({ canvas: 'blank-webgl', overlay: true }),
      '/frozen': page({ advance: false }),
      '/never': page({ ready: false }),
      '/nohw': page({ noHeadway: true }),
      '/wrong-mode': page({ mode: 'watch' }),
      '/no-canvas': page({ canvas: 'none' }),
      '/broken': page({ ready: false, consoleError: 'fatal boot error' }),
      '/vite-dev': page({ apiFetch: true, viteClient: true }),
      '/no-vite': page({ apiFetch: true }),
      '/@vite/client': { type: 'text/javascript', body: '// fake vite client' },
    });
  });
  after(async () => {
    await site?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  });

  test('a healthy app passes on /, /play and /lab and saves screenshots', async () => {
    const report = await runSmoke({ url: site.url, routes: [routeFor('/'), routeFor('/play'), routeFor('/lab')], outDir: out, chromePath: chrome });
    const text = formatReport(report);
    assert.equal(report.ok, true, text);
    const [watch, play, lab] = report.routes;
    assert.equal(watch.mode, 'watch');
    assert.equal(watch.advanced, true);
    assert.ok(watch.t1 > watch.t0);
    assert.equal(watch.canvas.blank, false);
    assert.equal(play.mode, 'play', 'mode set one tick after ready is accepted');
    assert.equal(play.advanced, false, 'play is paused; informational only');
    assert.ok(play.notes.some((n) => /did not advance/.test(n)), play.notes.join('; '));
    assert.equal(play.canvas.blank, false, 'WebGL canvas behind an overlay must sample as drawn');
    assert.equal(lab.canvas, null);
    assert.ok(lab.notes.some((n) => /no visible canvas/.test(n)), lab.notes.join('; '));
    for (const r of report.routes) {
      assert.equal(r.status, 200);
      assert.deepEqual(r.consoleErrors, []);
      assert.ok(existsSync(r.screenshot), r.screenshot);
      const png = decodePng(readFileSync(r.screenshot));
      assert.equal(png.width, 1600);
      assert.equal(png.height, 1000);
    }
    assert.ok(existsSync(join(out, 'report.json')));
    assert.match(text, /PASS\s+watch/);
    assert.match(text, /RESULT: PASS/);
  });

  test('each failure mode is caught with a specific reason', async () => {
    const report = await runSmoke({
      url: site.url,
      outDir: out,
      chromePath: chrome,
      readyTimeoutMs: 2500,
      advanceTimeoutMs: 1500,
      routes: [
        route('/err', 'watch'),
        route('/throw', 'watch'),
        route('/reject', 'watch'),
        route('/worker', 'watch'),
        route('/blank', 'watch', { requireCanvas: true }),
        route('/blank-gl', 'watch'),
        route('/frozen', 'watch', { mustAdvance: true }),
        route('/never', 'watch'),
        route('/nohw', 'watch'),
        route('/wrong-mode', 'play'),
        route('/no-canvas', 'watch', { requireCanvas: true }),
        route('/missing', null),
      ],
    });
    const text = formatReport(report);
    assert.equal(report.ok, false);
    const by = Object.fromEntries(report.routes.map((r) => [r.path, r]));
    const fails = (p, re) => {
      assert.equal(by[p].ok, false, `${p} should fail\n${text}`);
      assert.ok(by[p].failures.some((f) => re.test(f)), `${p}: ${by[p].failures.join(' | ')}`);
    };
    fails('/err', /console.*kaboom from console/);
    fails('/throw', /exception.*uncaught kaboom/);
    fails('/reject', /rejected kaboom/);
    fails('/worker', /worker kaboom/);
    assert.equal(by['/worker'].consoleErrors.length, 1, 'a worker error reported by page log and worker is counted once');
    fails('/blank', /blank canvas.*transparent or cleared to black/);
    fails('/blank-gl', /blank canvas/);
    fails('/frozen', /sim time did not advance/);
    fails('/never', /not ready/);
    fails('/nohw', /__headway.*missing|not ready/);
    fails('/wrong-mode', /mode.*watch.*expected.*play/);
    fails('/no-canvas', /no visible canvas/);
    fails('/missing', /HTTP 404/);
    assert.ok(existsSync(join(out, 'blank-canvas.png')), 'blank canvas sample saved for diagnosis');
    assert.match(text, /FAIL\s+err/);
    assert.match(text, /RESULT: FAIL/);
  });

  test('a broken boot (console errors, never ready) stops waiting after failFastMs', async () => {
    const t0 = Date.now();
    const report = await runSmoke({
      url: site.url, outDir: out, chromePath: chrome, readyTimeoutMs: 60_000, failFastMs: 1000,
      routes: [route('/broken', 'watch')],
    });
    const [r] = report.routes;
    assert.equal(r.ok, false);
    assert.ok(r.failures.some((f) => /not ready.*stopped early/.test(f)), r.failures.join(' | '));
    assert.ok(r.failures.some((f) => /fatal boot error/.test(f)), r.failures.join(' | '));
    assert.ok(Date.now() - t0 < 20_000, `took ${Date.now() - t0} ms`);
  });

  test('on a Vite dev server /api 404s are expected (no worker); elsewhere they fail', async () => {
    const report = await runSmoke({
      url: site.url, outDir: out, chromePath: chrome,
      routes: [route('/vite-dev', 'watch'), route('/no-vite', 'watch')],
    });
    const [dev, prod] = report.routes;
    assert.equal(dev.ok, true, formatReport(report));
    assert.ok(dev.notes.some((n) => /Vite dev server.*\/api/.test(n)), dev.notes.join(' | '));
    assert.equal(prod.ok, false);
    assert.ok(prod.failures.some((f) => /404.*\/api\/champion/.test(f)), prod.failures.join(' | '));
  });

  test('--ignore patterns suppress matching console errors', async () => {
    const report = await runSmoke({
      url: site.url, outDir: out, chromePath: chrome, ignore: [/kaboom from console/],
      routes: [route('/err', 'watch')],
    });
    assert.equal(report.ok, true, formatReport(report));
    assert.equal(report.routes[0].ignoredErrors, 1);
  });
});
