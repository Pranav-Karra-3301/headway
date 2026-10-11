// Test-only helpers: a tiny PNG encoder (all five filter types), synthetic images and a fixture HTTP server.
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 }; // channels -> PNG colour type

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Encode raw 8-bit pixels. `filter` is a filter type 0-4 or a function (y) => type.
 * `splitIdat` splits the compressed stream into that many IDAT chunks. `bitDepth` / `interlace` let tests build
 * unsupported files.
 */
export function encodePng({ width, height, channels, data }, { filter = 0, splitIdat = 1, bitDepth = 8, interlace = 0 } = {}) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const ft = typeof filter === 'function' ? filter(y) : filter;
    raw[y * (stride + 1)] = ft;
    for (let x = 0; x < stride; x++) {
      const cur = data[y * stride + x];
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= channels ? data[(y - 1) * stride + x - channels] : 0;
      const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + x] = (cur - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = COLOR_TYPE[channels];
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace;
  const z = deflateSync(raw);
  const parts = [];
  const size = Math.ceil(z.length / splitIdat);
  for (let i = 0; i < z.length; i += size) parts.push(chunk('IDAT', z.subarray(i, i + size)));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from('Software\0headway-smoke-test', 'latin1')),
    ...parts,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Build an RGBA image from fn(x, y) -> [r, g, b, a?]. */
export function makeImage(width, height, fn) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, channels: 4, data };
}

/** Deterministic PRNG for synthetic noise. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Serve `routes` ({ '/path': { status?, type?, body } | (req) => that }) on 127.0.0.1 with a random port.
 * Returns { url, close }.
 */
export async function serve(routes) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    let r = routes[path];
    if (typeof r === 'function') r = r(req);
    if (!r) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>404</title><h1>Not found</h1>');
      return;
    }
    res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

/**
 * A fake Headway page. Options:
 *  mode: value for window.__headway.mode ('watch' | 'play' | 'lab' | null to omit)
 *  canvas: '2d' (busy scene) | 'webgl' (busy scene drawn every frame, preserveDrawingBuffer false) |
 *          'blank' (transparent 2d canvas) | 'blank-webgl' (solid clear colour every frame) | 'none'
 *  overlay: add colourful HUD-like text over the canvas centre
 *  ready: whether __headway.ready ever becomes true; readyDelayMs
 *  advance: whether t advances once ready
 *  consoleError / throwError / rejectError / workerError: strings to emit shortly after load
 *  noHeadway: never define window.__headway
 *  modeAfterReady: switch __headway.mode to this value just after ready (a router that sets the mode a tick late)
 *  apiFetch: fetch /api/champion like apps/web/src/api.ts (404 here -> Chrome logs a network error)
 *  viteClient: include the <script src="/@vite/client"> tag Vite injects in dev
 */
export function fakePage(o = {}) {
  const cfg = {
    mode: 'watch', canvas: '2d', overlay: false, ready: true, readyDelayMs: 150, advance: true,
    consoleError: null, throwError: null, rejectError: null, workerError: null, consoleWarn: null, noHeadway: false,
    modeAfterReady: null, apiFetch: false, viteClient: false,
    ...o,
  };
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>fake headway</title>
<style>
  html, body { margin: 0; height: 100%; background: linear-gradient(#cfe3f5, #f7efe0); overflow: hidden; font: 16px system-ui; }
  canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; }
  .hud { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 5; padding: 24px; border-radius: 16px;
         background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.2); }
  .hud b { display: inline-block; padding: 6px 10px; margin: 4px; border-radius: 999px; color: #fff; }
  .blur { filter: blur(12px); }
</style>${cfg.viteClient ? '<script type="module" src="/@vite/client"></script>' : ''}</head>
<body>
<script>
const cfg = ${JSON.stringify(cfg)};
if (!cfg.noHeadway) window.__headway = cfg.mode === null ? { t: 0, ready: false } : { t: 0, mode: cfg.mode, ready: false };
const W = innerWidth, H = innerHeight;
if (cfg.canvas !== 'none') {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  document.body.append(c);
  if (cfg.canvas === '2d') {
    const g = c.getContext('2d');
    g.fillStyle = '#9fc7a4'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = 'hsl(' + ((i * 47) % 360) + ' 55% ' + (35 + (i * 13) % 40) + '%)';
      g.fillRect((i * 137) % W, (i * 89) % H, 40 + (i % 5) * 20, 30 + (i % 3) * 18);
    }
  } else if (cfg.canvas === 'webgl' || cfg.canvas === 'blank-webgl') {
    const gl = c.getContext('webgl2', { preserveDrawingBuffer: false, antialias: false });
    const draw = () => {
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0.93, 0.89, 0.8, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (cfg.canvas === 'webgl') {
        gl.enable(gl.SCISSOR_TEST);
        for (let i = 0; i < 90; i++) {
          gl.scissor((i * 137) % W, (i * 89) % H, 50 + (i % 4) * 15, 30 + (i % 3) * 12);
          gl.clearColor(((i * 37) % 100) / 100, ((i * 61) % 100) / 100, ((i * 13) % 100) / 100, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      }
      requestAnimationFrame(draw);
    };
    draw();
  }
}
if (cfg.overlay) {
  const d = document.createElement('div');
  d.className = 'hud';
  d.innerHTML = '<h1>HEADWAY</h1>' + Array.from({ length: 24 }, (_, i) =>
    '<b style="background:hsl(' + (i * 53 % 360) + ' 60% 45%)">Route ' + i + ' · 12 waiting</b>').join('');
  document.body.append(d);
}
let t = 0;
const tick = () => {
  if (!cfg.noHeadway && cfg.advance && window.__headway.ready) { t += 8 / 60; window.__headway.t = t; }
  requestAnimationFrame(tick);
};
tick();
if (!cfg.noHeadway && cfg.ready) setTimeout(() => {
  window.__headway.ready = true;
  if (cfg.modeAfterReady) setTimeout(() => { window.__headway.mode = cfg.modeAfterReady; }, 60);
}, cfg.readyDelayMs);
if (cfg.apiFetch) fetch('/api/champion', { headers: { accept: 'application/json' } }).catch(() => {});
setTimeout(() => {
  if (cfg.consoleWarn) console.warn(cfg.consoleWarn);
  if (cfg.consoleError) console.error(cfg.consoleError);
  if (cfg.rejectError) Promise.reject(new Error(cfg.rejectError));
  if (cfg.workerError) {
    const src = 'setTimeout(() => { throw new Error(' + JSON.stringify(cfg.workerError) + '); }, 10);';
    new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  }
  if (cfg.throwError) throw new Error(cfg.throwError);
}, 50);
</script>
</body></html>`;
}
