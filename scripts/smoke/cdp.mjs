// Chrome DevTools Protocol over Node's global WebSocket, plus a headless Chrome launcher. Dependency-free.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/** The explicit path if it exists (null if not), else $CHROME_PATH, else the first standard install that exists. */
export function findChrome(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  for (const p of [process.env.CHROME_PATH, ...(CANDIDATES[process.platform] ?? [])]) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export class Cdp {
  /** @param {string} url browser websocket URL */
  static connect(url, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { ws.close(); reject(new Error(`CDP connect timeout: ${url}`)); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new Cdp(ws)); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP connect failed: ${url}`)); }, { once: true });
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
    ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error(`CDP connection closed during ${p.method}`));
      this.pending.clear();
    });
  }

  #onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8')); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
      else p.resolve(msg.result ?? {});
      return;
    }
    for (const fn of this.listeners) {
      try { fn(msg); } catch { /* listener bugs must not break the connection */ }
    }
  }

  /** Send a command (to a flattened target session when sessionId is set). */
  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(new Error(`CDP connection closed (${method})`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  /** Subscribe to every event; returns an unsubscribe function. */
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolve with the first event matching `pred`, or reject after timeoutMs. */
  waitFor(pred, timeoutMs) {
    return new Promise((resolve, reject) => {
      const off = this.on((m) => {
        if (pred(m)) { clearTimeout(timer); off(); resolve(m); }
      });
      const timer = setTimeout(() => { off(); reject(new Error(`timed out after ${timeoutMs} ms`)); }, timeoutMs);
    });
  }

  /** A view bound to one target session. */
  session(sessionId) {
    return {
      id: sessionId,
      send: (method, params, timeoutMs) => this.send(method, params, sessionId, timeoutMs),
    };
  }

  close() {
    if (!this.closed) this.ws.close();
  }
}

/**
 * Launch headless Chrome (SwiftShader WebGL, no throttling) and connect to it.
 * @returns {Promise<{ cdp: Cdp, version: string, close: () => Promise<void> }>}
 */
export async function launchChrome({ chromePath, width = 1600, height = 1000, launchTimeoutMs = 20_000 } = {}) {
  const bin = findChrome(chromePath);
  if (!bin) throw new Error(chromePath ? `Chrome not found at ${chromePath}` : 'Chrome not found: pass --chrome <path> or set CHROME_PATH');
  const userDataDir = mkdtempSync(join(tmpdir(), 'headway-smoke-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
    '--password-store=basic',
    '--use-mock-keychain',
    `--window-size=${width},${height}`,
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), // root in CI containers
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false;
  const exit = new Promise((resolve) => proc.once('exit', () => { exited = true; resolve(); }));
  const kill = () => { if (!exited) try { proc.kill('SIGKILL'); } catch { /* already gone */ } };
  process.once('exit', kill);

  let stderr = '';
  let found = false;
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not start within ${launchTimeoutMs} ms:\n${stderr.slice(-1500)}`)), launchTimeoutMs);
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      const m = !found && /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (m) { found = true; clearTimeout(timer); resolve(m[1]); }
    });
    proc.once('error', (e) => { clearTimeout(timer); reject(new Error(`Chrome failed to launch (${bin}): ${e.message}`)); });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (code ${code}):\n${stderr.slice(-1500)}`)); });
  }).catch((e) => {
    kill();
    removeDir(userDataDir);
    throw e;
  });

  let cdp, product;
  try {
    cdp = await Cdp.connect(wsUrl);
    ({ product } = await cdp.send('Browser.getVersion', {}, undefined, 10_000));
  } catch (e) {
    cdp?.close();
    kill();
    removeDir(userDataDir);
    throw e;
  }
  return {
    cdp,
    version: product,
    close: async () => {
      try { await cdp.send('Browser.close', {}, undefined, 3000); } catch { /* fall through to kill */ }
      cdp.close();
      await Promise.race([exit, new Promise((r) => setTimeout(r, 3000))]);
      kill();
      await Promise.race([exit, new Promise((r) => setTimeout(r, 2000))]);
      process.removeListener('exit', kill);
      removeDir(userDataDir);
    },
  };
}

/** Best-effort removal of Chrome's temp profile (Chrome may still be flushing it for a moment after exit). */
function removeDir(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir */ }
}
