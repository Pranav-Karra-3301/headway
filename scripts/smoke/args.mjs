// CLI options for the smoke harness. Pure; no I/O.
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
export const DEFAULT_OUT_DIR = `${REPO_ROOT}/.superpowers/wip/smoke`;

/** Known app routes: Watch must show a drawn canvas and advancing sim time; Play must show a canvas (it may start
 *  paused behind the goal card); Lab is panels first, so its canvas is only checked when one is visible. */
const KNOWN = {
  '/': { name: 'watch', mode: 'watch', mustAdvance: true, requireCanvas: true },
  '/play': { name: 'play', mode: 'play', mustAdvance: false, requireCanvas: true },
  '/lab': { name: 'lab', mode: 'lab', mustAdvance: false, requireCanvas: false },
};

/** @typedef {{ path: string, name: string, mode: string | null, mustAdvance: boolean, requireCanvas: boolean }} RouteSpec */

/** @returns {RouteSpec} */
export function routeFor(raw) {
  const path = raw === '/' ? '/' : raw.replace(/\/+$/, '');
  const known = KNOWN[path];
  if (known) return { path, ...known };
  const name = path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  return { path, name, mode: null, mustAdvance: false, requireCanvas: false };
}

export const DEFAULT_ROUTES = ['/', '/play', '/lab'].map(routeFor);

/** Full URL of a route: base (no trailing slash) + route path + the query given on --url. */
export function routeUrl(opts, route) {
  return opts.url + route.path + (opts.query ?? '');
}

export const USAGE = `Headway smoke test (headless Chrome over the DevTools protocol; no dependencies)

  node scripts/smoke/run.mjs --url <base> [options]

  --url <base>            app origin, e.g. http://localhost:5173 or https://headway.pranavkarra001.workers.dev
                          (a ?query is appended to every route, e.g. ?quality=low)
  --routes <a,b,c>        paths to visit (default /,/play,/lab)
  --out <dir>             screenshots + report.json (default .superpowers/wip/smoke)
  --chrome <path>         Chrome binary (default $CHROME_PATH or the standard install)
  --timeout <s>           wait for window.__headway.ready (default 45)
  --advance-timeout <s>   wait for sim time to advance (default 10)
  --size <WxH>            viewport (default 1600x1000)
  --ignore <regex>        ignore console errors whose text or url matches (repeatable)
  --api                   also check /api/champion validates and /api/generations has >= 1 entry
  -h, --help              this text

Fails on: page HTTP errors, console errors / uncaught exceptions (page and workers), window.__headway never ready,
wrong __headway.mode, Watch sim time not advancing, missing or blank canvas. Exit 0 pass, 1 fail, 2 harness error.`;

const num = (flag, v) => {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n) || n <= 0) throw new Error(`${flag} needs a positive number (got ${v})`);
  return n;
};

export function parseArgs(argv) {
  const o = {
    url: null, query: '', routes: DEFAULT_ROUTES, outDir: DEFAULT_OUT_DIR, chromePath: null,
    readyTimeoutMs: 45_000, advanceTimeoutMs: 10_000, width: 1600, height: 1000, ignore: [], api: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) { value = flag.slice(eq + 1); flag = flag.slice(0, eq); }
    const take = () => {
      if (value !== undefined) return value;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      i++;
      return v;
    };
    switch (flag) {
      case '-h': case '--help': o.help = true; break;
      case '--api': o.api = true; break;
      case '--url': {
        const raw = take();
        let u;
        try { u = new URL(raw); } catch { throw new Error(`--url must be an http(s) URL (got ${raw})`); }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`--url must be an http(s) URL (got ${raw})`);
        o.url = u.origin + u.pathname.replace(/\/+$/, '');
        o.query = u.search;
        break;
      }
      case '--routes': {
        const paths = take().split(',').map((p) => p.trim()).filter(Boolean);
        if (!paths.length || paths.some((p) => !p.startsWith('/'))) throw new Error('--routes takes comma-separated paths starting with /');
        o.routes = paths.map(routeFor);
        break;
      }
      case '--out': o.outDir = take(); break;
      case '--chrome': o.chromePath = take(); break;
      case '--timeout': o.readyTimeoutMs = num('--timeout', take()) * 1000; break;
      case '--advance-timeout': o.advanceTimeoutMs = num('--advance-timeout', take()) * 1000; break;
      case '--size': {
        const v = take();
        const m = /^(\d{2,5})x(\d{2,5})$/.exec(v);
        if (!m) throw new Error(`--size must look like 1600x1000 (got ${v})`);
        o.width = Number(m[1]);
        o.height = Number(m[2]);
        break;
      }
      case '--ignore': {
        const v = take();
        try { o.ignore.push(new RegExp(v, 'i')); } catch (e) { throw new Error(`--ignore: bad regex ${v}: ${e.message}`); }
        break;
      }
      default: throw new Error(`unknown option ${flag}`);
    }
  }
  if (!o.help && !o.url) throw new Error('--url <base> is required');
  return o;
}
