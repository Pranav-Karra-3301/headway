// Owner: T4. The evolution CLI (spec §8.6).
//
//   pnpm evolve [--rounds N] [--publish [url]] [--data data] [--web apps/web/public/data | --no-web] [--quiet]
//               [--model deepseek-ai/DeepSeek-V4.1-Flash] [--fallback-model deepseek/deepseek-v4-pro] [--env .env]
//   pnpm evolve --smoke [--emphasis transfers|spacing|allocation]     one live Luminal designer call, nothing saved
//
// Keys come from the root .env (the process env wins): LUMINAL_API_KEY (primary), OPENROUTER_API_KEY (fallback on
// timeout/429/5xx), ADMIN_TOKEN (--publish), optional LUMINAL_BASE_URL / OPENROUTER_BASE_URL. Keys are never printed.
// Writes data/generations/<id>.json, data/rounds/<id>.json, data/events/<roundId>.json, data/{baseline,reference}.json,
// then apps/web/public/data/{champion,generations,evolve-events}.json (via export-web), then POSTs to /api/admin/publish.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { G0, REF } from '@headway/sim';
import type { Emphasis, EvolveEvent, Generation, Policy, Round, SplitScore } from '@headway/sim';
import { buildDigest, proposalVerdict, signedPct } from '../digest';
import { baselineGeneration, createEvaluator, type Evaluator } from '../evaluate';
import { createOpenAICompatClient, withFallback, type LlmClient, type LlmRequest, type LlmResponse } from '../llm';
import { designerSystemPrompt, designerUserPrompt } from '../prompts';
import { parseDesignerReply, runRound } from '../round';
import { createFileStore } from './store-file';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

export const DEFAULTS = {
  model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  fallbackModel: 'deepseek/deepseek-v4-pro',
  luminalBaseUrl: 'https://flash.luminal.cloud/v1',
  openRouterBaseUrl: 'https://openrouter.ai/api/v1',
  publishUrl: 'https://headway.pranavkarra001.workers.dev',
} as const;

const MAX_ROUNDS = 50;
const EMPHASES: readonly Emphasis[] = ['transfers', 'spacing', 'allocation'];
const SMOKE_TEMPERATURE = 0.4;
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 90_000;
const HISTORY_PROPOSALS = 6;

export const USAGE = `usage: pnpm evolve [--rounds N] [--publish [url]] [--data dir] [--web dir | --no-web] [--quiet]
                   [--model id] [--fallback-model id] [--env file]
       pnpm evolve --smoke [--emphasis transfers|spacing|allocation]
  --rounds N        evolution rounds to run (default 1, max ${MAX_ROUNDS})
  --publish [url]   POST everything to <url>/api/admin/publish with ADMIN_TOKEN (default ${DEFAULTS.publishUrl})
  --data dir        records directory (default data/)
  --web dir         web fallback data (default apps/web/public/data/); --no-web skips it
  --smoke           one live designer call to Luminal; validates the reply and prints its summary; saves nothing`;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------- arguments and env ----------

export interface EvolveOptions {
  rounds: number; publish: string | null; dataDir: string; webDir: string | null; envFile: string;
  model: string; fallbackModel: string; smoke: boolean; emphasis: Emphasis; quiet: boolean; help: boolean;
}

const repoPath = (p: string) => (isAbsolute(p) ? resolve(p) : resolve(REPO_ROOT, p));

export function parseEvolveArgs(argv: string[]): EvolveOptions {
  const o: EvolveOptions = {
    rounds: 1, publish: null, dataDir: repoPath('data'), webDir: repoPath('apps/web/public/data'), envFile: repoPath('.env'),
    model: DEFAULTS.model, fallbackModel: DEFAULTS.fallbackModel, smoke: false, emphasis: 'transfers', quiet: false, help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq >= 0 ? eq : undefined);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new Error(`--${name} needs a value`);
      return v;
    };
    switch (name) {
      case 'rounds': {
        const v = value();
        const n = /^\d+$/.test(v) ? Number(v) : NaN;
        if (!(n >= 1 && n <= MAX_ROUNDS)) throw new Error(`--rounds must be an integer from 1 to ${MAX_ROUNDS}, got "${v}"`);
        o.rounds = n;
        break;
      }
      case 'publish': {
        const next = inline ?? (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[++i] : undefined);
        const url = (next ?? DEFAULTS.publishUrl).replace(/\/+$/, '');
        if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error(`--publish expects an http(s) URL, got "${next}"`);
        o.publish = url;
        break;
      }
      case 'data': o.dataDir = repoPath(value()); break;
      case 'web': o.webDir = repoPath(value()); break;
      case 'no-web': o.webDir = null; break;
      case 'env': o.envFile = repoPath(value()); break;
      case 'model': o.model = value(); break;
      case 'fallback-model': o.fallbackModel = value(); break;
      case 'emphasis': {
        const v = value();
        if (!EMPHASES.includes(v as Emphasis)) throw new Error(`--emphasis must be one of ${EMPHASES.join(', ')}, got "${v}"`);
        o.emphasis = v as Emphasis;
        break;
      }
      case 'smoke': o.smoke = true; break;
      case 'quiet': o.quiet = true; break;
      case 'help': o.help = true; break;
      default: throw new Error(`unknown option --${name}`);
    }
  }
  return o;
}

/** Minimal dotenv: KEY=VALUE, `export KEY=…`, '…' / "…" quotes, # comments (whole line, or after an unquoted value). */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    const q = v[0];
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]!] = v;
  }
  return out;
}

const ENV_KEYS = ['LUMINAL_API_KEY', 'OPENROUTER_API_KEY', 'ADMIN_TOKEN', 'LUMINAL_BASE_URL', 'OPENROUTER_BASE_URL'] as const;
export type EvolveEnv = Partial<Record<(typeof ENV_KEYS)[number], string>>;

/** The .env file, overridden by non-empty process env values. */
export function loadEnv(path: string, processEnv: Record<string, string | undefined> = process.env): EvolveEnv {
  const file = existsSync(path) ? parseEnvText(readFileSync(path, 'utf8')) : {};
  const env: EvolveEnv = {};
  for (const k of ENV_KEYS) {
    const v = processEnv[k] || file[k];
    if (v) env[k] = v;
  }
  return env;
}

// ---------- models ----------

/** Luminal primary with an OpenRouter fallback (spec §8.2); either alone when only one key is set. */
export function createDesignerLlm(env: EvolveEnv, o: { model: string; fallbackModel: string; fetchImpl?: typeof fetch }): {
  llm: LlmClient; luminal: LlmClient | null; label: string;
} {
  const luminal = env.LUMINAL_API_KEY
    ? createOpenAICompatClient({ baseUrl: env.LUMINAL_BASE_URL || DEFAULTS.luminalBaseUrl, apiKey: env.LUMINAL_API_KEY, provider: 'luminal', fetchImpl: o.fetchImpl })
    : null;
  const openrouter = env.OPENROUTER_API_KEY
    ? createOpenAICompatClient({
      baseUrl: env.OPENROUTER_BASE_URL || DEFAULTS.openRouterBaseUrl, apiKey: env.OPENROUTER_API_KEY, provider: 'openrouter',
      headers: { 'HTTP-Referer': DEFAULTS.publishUrl, 'X-Title': 'Headway' }, fetchImpl: o.fetchImpl,
    })
    : null;
  if (luminal && openrouter) return { llm: withFallback(luminal, openrouter, o.fallbackModel), luminal, label: `luminal ${o.model}, fallback openrouter ${o.fallbackModel}` };
  if (luminal) return { llm: luminal, luminal, label: `luminal ${o.model} (no fallback: OPENROUTER_API_KEY is not set)` };
  if (openrouter) {
    return {
      llm: { complete: (req) => openrouter.complete({ ...req, model: o.fallbackModel }) }, luminal: null,
      label: `openrouter ${o.fallbackModel} (LUMINAL_API_KEY is not set)`,
    };
  }
  throw new Error('set LUMINAL_API_KEY (and OPENROUTER_API_KEY for the fallback) in .env');
}

interface CountingLlm extends LlmClient { calls: number; byProvider: Map<string, number> }

function counting(llm: LlmClient): CountingLlm {
  const c: CountingLlm = {
    calls: 0,
    byProvider: new Map(),
    async complete(req: LlmRequest): Promise<LlmResponse> {
      c.calls++;
      const res = await llm.complete(req);
      c.byProvider.set(res.provider, (c.byProvider.get(res.provider) ?? 0) + 1);
      return res;
    },
  };
  return c;
}

// ---------- output ----------

const LETTER = (d: number) => 'abc'[d] ?? String(d);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** One console line per event; null for events not worth a line (evaluation start). */
export function formatEvent(e: EvolveEvent): string | null {
  switch (e.type) {
    case 'round_start':
      return `R${e.round} · champion ${e.champion}`;
    case 'proposal': {
      const head = `  [${LETTER(e.designer)}] ${e.emphasis.padEnd(10)} ${e.status}`;
      if (e.status === 'requested') return `${head} · ${e.model}`;
      if (e.status === 'invalid') {
        const more = (e.errors?.length ?? 0) > 1 ? ` (+${e.errors!.length - 1} more)` : '';
        return `${head}: ${e.errors?.[0] ?? 'unknown error'}${more}`;
      }
      const repairing = e.errors?.length ? ` · ${e.errors.length} validation error${e.errors.length === 1 ? '' : 's'}, asking for a repair` : '';
      return `${head}${e.summary ? `: ${e.summary}` : ''}${repairing}`;
    }
    case 'eval':
      return e.done === e.total ? `  ${e.proposalId} · ${e.split} ${e.done}/${e.total} runs` : null;
    case 'scored':
      return `  ${e.proposalId} · ${e.narrative.startsWith('ΔJ') ? e.narrative : `ΔJ ${signedPct(e.deltaTrainPct)} on training. ${e.narrative}`}`;
    case 'decision':
      return `  → ${e.reason}`;
    case 'error':
      return `  ! ${e.message}`;
  }
}

function roundSummary(r: Round, ms: number, calls: number, providers: string): string {
  const lines = [`${r.id} ${r.status} in ${secs(ms)} · ${calls} LLM call${calls === 1 ? '' : 's'}${providers ? ` (${providers})` : ''} · champion ${r.championBefore} → ${r.championAfter}`];
  for (const p of r.proposals) {
    const delta = p.deltaTrainPct === null ? '' : `ΔJ ${signedPct(p.deltaTrainPct)}`;
    lines.push(`  ${p.id.padEnd(6)} ${p.emphasis.padEnd(10)} ${(p.valid ? 'valid' : 'invalid').padEnd(7)} ${delta.padEnd(10)} ${proposalVerdict(p) || p.summary}`);
  }
  return lines.join('\n');
}

function writeJson(path: string, value: unknown, pretty = true): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
  renameSync(tmp, path);
}

/** The round the Lab replays offline: the latest promotion, else the latest completed round, else the latest. */
function replayRound(rounds: Round[]): Round | null {
  const latest = (f: (r: Round) => boolean) => [...rounds].reverse().find(f) ?? null;
  return latest((r) => r.status === 'done' && r.championAfter !== r.championBefore) ?? latest((r) => r.status === 'done') ?? latest(() => true);
}

/** apps/web/public/data: champion.json + generations.json (export-web, same shapes as the API) and evolve-events.json. */
async function writeWebData(dataDir: string, webDir: string, rounds: Round[], log: (s: string) => void): Promise<string[]> {
  const { exportWeb } = await import('./export-web');
  const r = exportWeb({ dataDir, outDir: webDir, evaluate: null });
  for (const n of r.notes) log(`note: ${n}`);
  const files = r.files.map((f) => f.path);
  const replay = replayRound(rounds);
  const eventsPath = replay ? join(dataDir, 'events', `${replay.id}.json`) : null;
  if (eventsPath && existsSync(eventsPath)) {
    const out = join(webDir, 'evolve-events.json');
    writeJson(out, JSON.parse(readFileSync(eventsPath, 'utf8')), false);
    files.push(`${out} (${replay!.id})`);
  }
  return files;
}

// ---------- publish ----------

export interface PublishBody { generations: Generation[]; rounds: Round[]; baseline: SplitScore; reference: SplitScore }

export async function publishData(baseUrl: string, token: string, body: PublishBody, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/admin/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, status: res.status, message: `HTTP ${res.status}${text ? `: ${text.slice(0, 500)}` : ''}` };
    let counts: { generations?: number; rounds?: number; proposals?: number } = {};
    try { counts = JSON.parse(text) as typeof counts; } catch { /* keep the defaults */ }
    const n = (x: number | undefined, fallback: number) => (typeof x === 'number' ? x : fallback);
    return {
      ok: true, status: res.status,
      message: `${n(counts.generations, body.generations.length)} generations, ${n(counts.rounds, body.rounds.length)} rounds, ${n(counts.proposals, body.rounds.reduce((k, r) => k + r.proposals.length, 0))} proposals`,
    };
  } catch (e) {
    return { ok: false, status: 0, message: `network error: ${errText(e)}` };
  }
}

// ---------- rounds ----------

export interface RunEvolveDeps {
  llm: LlmClient; log(s: string): void; now(): string;
  evaluator?: Evaluator; fetchImpl?: typeof fetch; adminToken?: string;
}

/** Runs `o.rounds` rounds against the file store, then writes web data and publishes. Exit code: 0 ok, 1 failure, 2 config. */
export async function runEvolve(o: EvolveOptions, deps: RunEvolveDeps): Promise<{ code: number; rounds: Round[]; generations: Generation[] }> {
  const { log, now } = deps;
  if (o.publish && !deps.adminToken) {
    log('error: --publish needs ADMIN_TOKEN in .env');
    return { code: 2, rounds: [], generations: [] };
  }
  const ev = deps.evaluator ?? createEvaluator();
  const store = createFileStore(o.dataDir, {
    bootstrap: async () => {
      log('no generations yet: scoring g0 on train and val');
      return baselineGeneration(ev.evaluate, now);
    },
  });
  for (const r of store.failStaleRounds(now())) log(`marked ${r.id} failed (an earlier run left it running)`);

  const llm = counting(deps.llm);
  const ran: Round[] = [];
  let code = 0;
  for (let i = 0; i < o.rounds; i++) {
    const events: EvolveEvent[] = [];
    const started = Date.now();
    const calls = llm.calls;
    const before = new Map(llm.byProvider);
    try {
      const { round } = await runRound({
        llm, model: o.model, store, now, evaluate: ev.evaluate,
        emit: (e) => {
          events.push(e);
          const line = o.quiet ? null : formatEvent(e);
          if (line !== null) log(line);
        },
      });
      writeJson(join(o.dataDir, 'events', `${round.id}.json`), events);
      ran.push(round);
      const providers = [...llm.byProvider].map(([p, n]) => [p, n - (before.get(p) ?? 0)] as const).filter(([, n]) => n > 0).map(([p, n]) => `${p} ${n}`).join(', ');
      log(roundSummary(round, Date.now() - started, llm.calls - calls, providers));
    } catch (e) {
      log(`error: round ${i + 1} of ${o.rounds} crashed: ${errText(e)}`);
      code = 1;
      break;
    }
  }

  const baseline = (await ev.evaluate(G0, 'train')).score;
  const reference = (await ev.evaluate(REF, 'train')).score;
  writeJson(join(o.dataDir, 'baseline.json'), baseline);
  writeJson(join(o.dataDir, 'reference.json'), reference);
  const generations = store.generations();
  const rounds = store.rounds();
  const champion = generations[generations.length - 1];
  if (champion) log(`champion ${champion.id} · J_train ${(champion.train.J / 3600).toFixed(1)} pax-h (g0 ${(baseline.J / 3600).toFixed(1)}, ref ${(reference.J / 3600).toFixed(1)}) · ${ev.stats.runs} sim runs`);

  if (o.webDir) {
    try {
      for (const f of await writeWebData(o.dataDir, o.webDir, rounds, log)) log(`wrote ${f}`);
    } catch (e) {
      log(`error: web data not written (${errText(e)}); run src/cli/export-web.ts`);
      code = code || 1;
    }
  }
  if (o.publish) {
    if (code !== 0) log('not publishing: a round crashed');
    else {
      const body: PublishBody = { generations, rounds: rounds.filter((r) => r.status !== 'running'), baseline, reference };
      const res = await publishData(o.publish, deps.adminToken!, body, deps.fetchImpl ?? fetch);
      log(res.ok ? `published ${res.message} to ${o.publish}` : `error: publish failed: ${res.message}`);
      if (!res.ok) code = 1;
    }
  }
  return { code, rounds: ran, generations };
}

// ---------- smoke ----------

export interface SmokeResult {
  ok: boolean; provider: string; model: string; latencyMs: number; chars: number;
  summary: string; rules: number; deltaTrainPct: number | null; errors: string[];
}

/** One designer call against the stored champion (g0 when data/ is empty). Validates the reply exactly as a round
 *  would and scores it on train; prints the summary only and writes nothing. */
export async function designerSmoke(o: {
  llm: LlmClient; model: string; emphasis: Emphasis; dataDir: string; log(s: string): void; evaluator?: Evaluator;
}): Promise<SmokeResult> {
  const ev = o.evaluator ?? createEvaluator();
  const store = existsSync(join(o.dataDir, 'generations')) ? createFileStore(o.dataDir) : null;
  const latest = store?.generations().at(-1);
  const champion: { id: string; number: number; policy: Policy } = latest ?? { id: 'g0', number: 0, policy: G0 };
  const champTrain = await ev.evaluate(champion.policy, 'train');
  const digest = buildDigest({
    champion: { policy: champion.policy, results: champTrain.results },
    baseline: (await ev.evaluate(G0, 'train')).score,
    reference: (await ev.evaluate(REF, 'train')).score,
    history: store ? await store.history(HISTORY_PROPOSALS) : [],
  });
  const req: LlmRequest = {
    model: o.model, system: designerSystemPrompt(), user: designerUserPrompt({ emphasis: o.emphasis, champion: champion.policy, digest }),
    temperature: SMOKE_TEMPERATURE, maxTokens: MAX_TOKENS, json: true, timeoutMs: TIMEOUT_MS,
  };
  o.log(`smoke: one ${o.emphasis} designer call to ${o.model} against ${champion.id} (prompt ${req.system.length + req.user.length} chars)`);
  const fail = (errors: string[], extra: Partial<SmokeResult> = {}): SmokeResult => {
    o.log(`invalid: ${errors.slice(0, 5).join(' | ')}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ''}`);
    return { ok: false, provider: '', model: o.model, latencyMs: 0, chars: 0, summary: '', rules: 0, deltaTrainPct: null, errors, ...extra };
  };
  let res: LlmResponse;
  try {
    res = await o.llm.complete(req);
  } catch (e) {
    return fail([`call failed: ${errText(e)}`]);
  }
  const head = { provider: res.provider, model: res.model, latencyMs: res.latencyMs, chars: res.text.length };
  o.log(`reply from ${res.provider} ${res.model} in ${secs(res.latencyMs)} (${res.text.length} chars)`);
  const parsed = parseDesignerReply(res.text, {
    meta: { id: 'smoke', parent: champion.id, generation: champion.number + 1, author: res.model, emphasis: o.emphasis }, champion: champion.policy,
  });
  if (!parsed.ok) return fail(parsed.errors, { ...head, summary: parsed.summary });
  const train = await ev.evaluate(parsed.policy, 'train');
  const champJ = champTrain.score.J;
  const delta = champJ > 0 ? Math.round((10_000 * (train.score.J - champJ)) / champJ) / 100 : 0;
  o.log(`valid policy · ${parsed.policy.rules.length} rules (champion ${champion.policy.rules.length}) · ΔJ ${signedPct(delta)} on training vs ${champion.id} · smoke only, nothing saved`);
  o.log(`summary: ${parsed.summary || '(none)'}`);
  return { ok: true, ...head, summary: parsed.summary, rules: parsed.policy.rules.length, deltaTrainPct: delta, errors: [] };
}

// ---------- main ----------

export async function main(argv: string[], deps: { log?: (s: string) => void; fetchImpl?: typeof fetch; env?: EvolveEnv } = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => console.log(s));
  let o: EvolveOptions;
  try {
    o = parseEvolveArgs(argv);
  } catch (e) {
    log(`error: ${errText(e)}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    log(USAGE);
    return 0;
  }
  const env = deps.env ?? loadEnv(o.envFile);
  let llms: ReturnType<typeof createDesignerLlm>;
  try {
    llms = createDesignerLlm(env, { model: o.model, fallbackModel: o.fallbackModel, fetchImpl: deps.fetchImpl });
  } catch (e) {
    log(`error: ${errText(e)}`);
    return 2;
  }
  const now = () => new Date().toISOString();
  if (o.smoke) {
    if (!llms.luminal) {
      log('error: --smoke checks Luminal; set LUMINAL_API_KEY in .env');
      return 2;
    }
    return (await designerSmoke({ llm: llms.luminal, model: o.model, emphasis: o.emphasis, dataDir: o.dataDir, log })).ok ? 0 : 1;
  }
  log(`designers: ${llms.label}\ndata: ${o.dataDir}${o.webDir ? `\nweb: ${o.webDir}` : ''}${o.publish ? `\npublish: ${o.publish}` : ''}`);
  return (await runEvolve(o, { llm: llms.llm, log, now, fetchImpl: deps.fetchImpl, adminToken: env.ADMIN_TOKEN })).code;
}

function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e: unknown) => { console.error(errText(e)); process.exitCode = 1; },
  );
}
