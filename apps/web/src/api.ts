// Worker API client (T3a). Every read falls back to the static `/data/*.json` files when `/api` fails
// (no Worker in `vite dev`, a 5xx, an HTML SPA page instead of JSON, or no network).
import { G0, validatePolicy } from '@headway/sim';
import type { EvolveEvent, Generation, Metrics, Policy, Replay, Round, SplitScore } from '@headway/sim';

export interface ChampionInfo { policy: Policy; generation: Generation | null }
export interface GenerationsInfo { generations: Generation[]; rounds: Round[]; baseline?: SplitScore | null; reference?: SplitScore | null }
export interface LeaderboardRow { name: string; j: number; verified: boolean }
export interface SealedRow { policyId: string; jTest: number; metrics: Metrics | null; simVersion: string | null; createdAt: string | null }

/** `vite dev` has no Worker behind it: skip `/api` there (no 404 noise) unless VITE_HEADWAY_API points at one
 *  (e.g. `VITE_HEADWAY_API=http://127.0.0.1:8787` for `wrangler dev`). Builds and tests always use same-origin `/api`. */
const API_BASE: string = (import.meta.env?.VITE_HEADWAY_API as string | undefined) ?? '';
const API_ENABLED = import.meta.env?.MODE !== 'development' || API_BASE !== '';
const api = (path: string) => `${API_BASE}${path}`;
const noApi = (): Promise<never> => Promise.reject(new Error('API disabled in vite dev'));

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.clone().json();
    if (isObj(body) && typeof body.error === 'string') return body.error;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}

function isJson(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return ct.includes('json');
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) } });
  if (!res.ok) throw new HttpError(res.status, await errorMessage(res));
  if (!isJson(res)) throw new HttpError(res.status, `${url}: not JSON`); // e.g. the dev server's index.html
  return res.json();
}

/** Tries each source in order; the first that loads and parses (non-null) wins. */
async function firstOf<T>(sources: Array<() => Promise<unknown>>, parse: (x: unknown) => T | null): Promise<T | null> {
  for (const load of sources) {
    try {
      const v = parse(await load());
      if (v !== null) return v;
    } catch { /* next source */ }
  }
  return null;
}

function asPolicy(x: unknown): Policy | null {
  if (!isObj(x) || !isObj(x.meta) || !Array.isArray(x.rules)) return null;
  try {
    const v = validatePolicy(x);
    return v.ok ? v.policy : null;
  } catch {
    return x as unknown as Policy; // validator unavailable: trust the shape check
  }
}

function asChampion(x: unknown): ChampionInfo | null {
  if (!isObj(x)) return null;
  if ('policy' in x) {
    const policy = asPolicy(x.policy);
    if (!policy) return null;
    if (isObj(x.generation)) return { policy, generation: x.generation as unknown as Generation };
    if (typeof x.number === 'number' && typeof x.id === 'string') return { policy, generation: x as unknown as Generation }; // a bare Generation
    return { policy, generation: null };
  }
  const policy = asPolicy(x);
  return policy ? { policy, generation: null } : null;
}

export async function fetchChampion(): Promise<ChampionInfo> {
  const c = await firstOf([() => (API_ENABLED ? getJson(api('/api/champion')) : noApi()), () => getJson('/data/champion.json')], asChampion);
  return c ?? { policy: G0, generation: null };
}

function asGenerations(x: unknown): GenerationsInfo | null {
  let generations: unknown;
  let rest: Obj = {};
  if (Array.isArray(x)) generations = x;
  else if (isObj(x) && Array.isArray(x.generations)) { generations = x.generations; rest = x; }
  else return null;
  const gens = (generations as unknown[]).filter((g): g is Generation => isObj(g) && typeof g.id === 'string')
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const rounds = Array.isArray(rest.rounds) ? (rest.rounds as unknown[]).filter((r): r is Round => isObj(r)) : [];
  return {
    generations: gens, rounds,
    baseline: isObj(rest.baseline) ? (rest.baseline as unknown as SplitScore) : null,
    reference: isObj(rest.reference) ? (rest.reference as unknown as SplitScore) : null,
  };
}

export async function fetchGenerations(): Promise<GenerationsInfo> {
  const g = await firstOf([() => (API_ENABLED ? getJson(api('/api/generations')) : noApi()), () => getJson('/data/generations.json')], asGenerations);
  return g ?? { generations: [], rounds: [], baseline: null, reference: null };
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

function isEvolveEvent(x: unknown): x is EvolveEvent {
  return isObj(x) && typeof x.type === 'string';
}

/** Streams one evolution round (`POST /api/evolve`, NDJSON). A rejected token throws. If the API cannot run a round
 *  here, replays the last recorded round from `/data/evolve-events.json`, announcing the replay as the first event. */
export async function streamEvolve(
  token: string, onEvent: (e: EvolveEvent) => void, opts: { replayDelayMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  let res: Response | null = null;
  try {
    if (!API_ENABLED) throw new Error('API disabled in vite dev');
    res = await fetch(api('/api/evolve'), {
      method: 'POST', signal: opts.signal,
      headers: { authorization: `Bearer ${token}`, accept: 'application/x-ndjson' },
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    res = null;
  }
  if (res && (res.status === 401 || res.status === 403)) throw new Error('Admin token rejected');
  if (res && res.status === 409) throw new Error(await errorMessage(res));
  if (res && res.ok && res.body && !(res.headers.get('content-type') ?? '').includes('text/html')) {
    await readNdjson(res.body, onEvent);
    return;
  }
  const recorded = await firstOf([() => getJson('/data/evolve-events.json')], (x) =>
    Array.isArray(x) ? x.filter(isEvolveEvent) : isObj(x) && Array.isArray(x.events) ? x.events.filter(isEvolveEvent) : null);
  if (!recorded || recorded.length === 0) {
    if (!res) throw new Error('Evolution is offline: the server could not be reached');
    if (res.ok) throw new Error('Live evolution needs the Headway API, which this server does not provide');
    if (res.status === 404 || res.status === 501) throw new Error('Live evolution is not available on this deployment');
    throw new Error(await errorMessage(res));
  }
  onEvent({ type: 'error', message: 'Live evolution is not available here, so this replays the last recorded round.' });
  const delay = opts.replayDelayMs ?? 450;
  for (const e of recorded) {
    if (delay > 0) await sleep(delay, opts.signal);
    onEvent(e);
  }
}

async function readNdjson(body: ReadableStream<Uint8Array>, onEvent: (e: EvolveEvent) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const flush = (line: string) => {
    const s = line.trim();
    if (!s) return;
    try {
      const e: unknown = JSON.parse(s);
      if (isEvolveEvent(e)) onEvent(e);
    } catch { /* skip a malformed line */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      flush(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  buf += dec.decode();
  flush(buf);
}

function asLeaderboard(x: unknown): LeaderboardRow[] | null {
  const rows = Array.isArray(x) ? x
    : isObj(x) ? (['entries', 'rows', 'leaderboard', 'top'].map((k) => x[k]).find(Array.isArray) as unknown[] | undefined) : undefined;
  if (!rows) return null;
  return rows.filter(isObj).map((r) => ({
    name: String(r.name ?? '?'),
    j: Number(r.j ?? r.J ?? 0),
    verified: r.verified === true || r.verified === 1,
  }));
}

export async function fetchLeaderboard(seed: number): Promise<LeaderboardRow[]> {
  const rows = await firstOf(
    [() => (API_ENABLED ? getJson(api(`/api/leaderboard?seed=${encodeURIComponent(String(seed))}`)) : noApi()), () => getJson('/data/leaderboard.json')],
    asLeaderboard,
  );
  return rows ?? [];
}

export async function submitRun(name: string, replay: Replay): Promise<{ ok: boolean; j?: number; error?: string }> {
  try {
    if (!API_ENABLED) return { ok: false, error: 'The leaderboard needs the Headway API (not running under vite dev)' };
    const res = await fetch(api('/api/leaderboard'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ name, replay }),
    });
    if (!res.ok) return { ok: false, error: await errorMessage(res) };
    if (!isJson(res)) return { ok: false, error: 'Leaderboard is offline' };
    const body: unknown = await res.json();
    if (!isObj(body)) return { ok: true };
    const j = body.j ?? body.J ?? (isObj(body.entry) ? body.entry.j ?? body.entry.J : undefined);
    if (body.ok === false) return { ok: false, error: typeof body.error === 'string' ? body.error : 'Rejected' };
    return typeof j === 'number' ? { ok: true, j } : { ok: true };
  } catch {
    return { ok: false, error: 'Leaderboard is offline' };
  }
}

function asSealed(x: unknown): SealedRow[] | null {
  const rows = Array.isArray(x) ? x : isObj(x) ? (['results', 'sealed', 'rows'].map((k) => x[k]).find(Array.isArray) as unknown[] | undefined) : undefined;
  if (!rows) return null;
  return rows.filter(isObj).map((r) => ({
    policyId: String(r.policyId ?? r.policy_id ?? '?'),
    jTest: Number(r.jTest ?? r.j_test ?? r.J ?? 0),
    metrics: isObj(r.metrics) ? (r.metrics as unknown as Metrics) : null,
    simVersion: typeof r.simVersion === 'string' ? r.simVersion : typeof r.sim_version === 'string' ? r.sim_version : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : typeof r.created_at === 'string' ? r.created_at : null,
  }));
}

/** Sealed-test results (`GET /api/sealed`, fallback `/data/sealed.json`); empty when none are published. */
export async function fetchSealed(): Promise<SealedRow[]> {
  return (await firstOf([() => (API_ENABLED ? getJson(api('/api/sealed')) : noApi()), () => getJson('/data/sealed.json')], asSealed)) ?? [];
}
