import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ROUTES, parseArgs, routeFor, routeUrl } from '../args.mjs';

test('requires --url unless --help', () => {
  assert.throws(() => parseArgs([]), /--url/);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('defaults: three routes, watch must advance, screenshots under .superpowers/wip/smoke', () => {
  const o = parseArgs(['--url', 'http://localhost:5173/']);
  assert.equal(o.url, 'http://localhost:5173');
  assert.deepEqual(o.routes, DEFAULT_ROUTES);
  assert.deepEqual(o.routes.map((r) => [r.path, r.name, r.mode, r.mustAdvance, r.requireCanvas]), [
    ['/', 'watch', 'watch', true, true],
    ['/play', 'play', 'play', false, true],
    ['/lab', 'lab', 'lab', false, false],
  ]);
  assert.match(o.outDir.replaceAll('\\', '/'), /\/\.superpowers\/wip\/smoke$/);
  assert.equal(o.width, 1600);
  assert.equal(o.height, 1000);
  assert.equal(o.readyTimeoutMs, 45_000);
  assert.equal(o.advanceTimeoutMs, 10_000);
  assert.equal(o.api, false);
  assert.deepEqual(o.ignore, []);
  assert.equal(o.chromePath, null);
});

test('accepts --flag=value, keeps a base path, and parses every option', () => {
  const o = parseArgs([
    '--url=https://headway.example.dev/app/', '--routes', '/lab,/play,/foo/bar', '--out', '/tmp/smoke-x',
    '--chrome', '/opt/chrome', '--timeout', '12', '--advance-timeout=4', '--size', '1280x800',
    '--ignore', 'HMR', '--ignore=favicon', '--api',
  ]);
  assert.equal(o.url, 'https://headway.example.dev/app');
  assert.deepEqual(o.routes.map((r) => r.name), ['lab', 'play', 'foo-bar']);
  assert.deepEqual(o.routes[2], { path: '/foo/bar', name: 'foo-bar', mode: null, mustAdvance: false, requireCanvas: false });
  assert.equal(o.outDir, '/tmp/smoke-x');
  assert.equal(o.chromePath, '/opt/chrome');
  assert.equal(o.readyTimeoutMs, 12_000);
  assert.equal(o.advanceTimeoutMs, 4_000);
  assert.equal(o.width, 1280);
  assert.equal(o.height, 800);
  assert.equal(o.api, true);
  assert.equal(o.ignore.length, 2);
  assert.ok(o.ignore[0].test('[vite] hmr connected'));
});

test('rejects unknown flags and bad values', () => {
  assert.throws(() => parseArgs(['--url', 'http://x', '--bogus']), /unknown option/);
  assert.throws(() => parseArgs(['--url', 'not a url']), /--url/);
  assert.throws(() => parseArgs(['--url', 'ftp://x']), /--url/);
  assert.throws(() => parseArgs(['--url', 'http://x', '--size', '12']), /--size/);
  assert.throws(() => parseArgs(['--url', 'http://x', '--timeout', 'soon']), /--timeout/);
  assert.throws(() => parseArgs(['--url', 'http://x', '--routes', 'play']), /--routes/);
  assert.throws(() => parseArgs(['--url', 'http://x', '--ignore', '(']), /--ignore/);
  assert.throws(() => parseArgs(['--url']), /--url/);
});

test('a query on --url is carried to every route URL', () => {
  const o = parseArgs(['--url', 'http://localhost:5199/?quality=low']);
  assert.equal(o.url, 'http://localhost:5199');
  assert.equal(o.query, '?quality=low');
  assert.deepEqual(o.routes.map((r) => routeUrl(o, r)), [
    'http://localhost:5199/?quality=low', 'http://localhost:5199/play?quality=low', 'http://localhost:5199/lab?quality=low',
  ]);
  assert.equal(routeUrl(parseArgs(['--url', 'http://h/base/']), routeFor('/play')), 'http://h/base/play');
});

test('routeFor maps known paths and tolerates trailing slashes', () => {
  assert.equal(routeFor('/').name, 'watch');
  assert.equal(routeFor('/play/').mode, 'play');
  assert.equal(routeFor('/lab').requireCanvas, false);
  assert.equal(routeFor('/x').mode, null);
});

test('--hash turns on the spec §12 browser = Node hash check (off by default)', () => {
  assert.equal(parseArgs(['--url', 'http://localhost:5173']).hash, false);
  assert.equal(parseArgs(['--url', 'http://localhost:5173', '--hash']).hash, true);
});
