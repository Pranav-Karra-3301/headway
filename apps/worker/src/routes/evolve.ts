// POST /api/evolve (Bearer ADMIN_TOKEN): one evolution round (spec §8, §11) streamed as NDJSON EvolveEvents.
// runRound from @headway/evolve over a D1 store; one running round at a time via rounds.status (stale after 10 min).
import { createOpenAICompatClient, runRound, withFallback } from '@headway/evolve';
import { G0, REF } from '@headway/sim';
import type { EvolveEvent, Generation } from '@headway/sim';
import { Hono } from 'hono';
import { failRunningRound, latestGeneration, META_BASELINE, META_REFERENCE, setRoundEvents, upsertMeta } from '../db';
import type { AppContext, AppDeps, AppEnv, Designer, Evaluate } from '../env';
import { jsonError } from '../http';
import { memoEvaluate, topFindings } from '../score';
import { claimRound, createD1Store } from '../store';
import { requireAdmin } from './admin';

/** OpenRouter model used when Luminal times out / 429s / 5xxs (spec §8.2), or alone when only OpenRouter is configured. */
export const FALLBACK_MODEL = 'deepseek/deepseek-v4-pro';
/** Designer calls can leave the stream silent for a minute or more; a blank line (readers skip it) keeps proxies from idling out. */
const HEARTBEAT_MS = 15_000;

/** Default designer: Luminal (LUMINAL_MODEL) with one fallback to OpenRouter deepseek-v4-pro; null without any key. */
export function defaultDesigner(env: AppEnv, fetchImpl: typeof fetch): Designer | null {
  const luminal = env.LUMINAL_API_KEY
    ? createOpenAICompatClient({ baseUrl: env.LUMINAL_BASE_URL, apiKey: env.LUMINAL_API_KEY, provider: 'luminal', fetchImpl })
    : null;
  const openrouter = env.OPENROUTER_API_KEY
    ? createOpenAICompatClient({
        baseUrl: env.OPENROUTER_BASE_URL, apiKey: env.OPENROUTER_API_KEY, provider: 'openrouter', fetchImpl,
        headers: { 'HTTP-Referer': 'https://headway.pranavkarra001.workers.dev', 'X-Title': 'Headway' },
      })
    : null;
  if (luminal && openrouter) return { llm: withFallback(luminal, openrouter, FALLBACK_MODEL), model: env.LUMINAL_MODEL };
  if (luminal) return { llm: luminal, model: env.LUMINAL_MODEL };
  if (openrouter) return { llm: openrouter, model: FALLBACK_MODEL };
  return null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Collects a round's events and mirrors them into rounds.events_json: one write in flight, coalescing bursts. */
function eventLog(db: D1Database, roundId: string) {
  const events: EvolveEvent[] = [];
  let dirty = false;
  let writing: Promise<void> | null = null;
  const drain = async () => {
    while (dirty) {
      dirty = false;
      try {
        await setRoundEvents(db, roundId, JSON.stringify(events)).run();
      } catch (err) {
        console.warn(`events_json write failed (${roundId}):`, errText(err));
      }
    }
  };
  const kick = (): void => {
    writing ??= drain().finally(() => {
      writing = null;
      if (dirty) kick(); // an event that landed after the last loop check
    });
  };
  return {
    events,
    push(e: EvolveEvent) {
      events.push(e);
      dirty = true;
      kick();
    },
    async flush() {
      while (writing) await writing;
    },
  };
}

export function evolveRoutes(deps: AppDeps): Hono<AppContext> {
  const r = new Hono<AppContext>();

  /**
   * Runs one round. 200 → `application/x-ndjson`, one EvolveEvent per line, ending with a `decision` event; the round,
   * its proposals, any new generation and every event (rounds.events_json) are persisted as it goes.
   * 409 while another round runs (`?force=1` breaks a lock younger than 10 min); 503 without designer API keys.
   */
  r.post('/api/evolve', requireAdmin(), async (c) => {
    const designer = deps.designer(c.env);
    if (!designer) return jsonError(c, 503, 'live evolution is not available here: no designer LLM API key is configured');
    const db = c.env.DB;
    const nowIso = () => new Date(deps.now()).toISOString();

    const current = await latestGeneration(db);
    const claim = await claimRound(db, { nowMs: deps.now(), championId: current?.id ?? G0.meta.id, force: c.req.query('force') === '1' });
    if (!claim.ok) {
      const who = claim.running ? `round ${claim.running.id} is already running (started ${claim.running.startedAt})` : 'another round is already running';
      return jsonError(c, 409, `${who}; try again when it finishes`);
    }

    // Scores are memoized for the request; g0/ref training scores are kept as the Lab's baseline/reference lines.
    const scored = memoEvaluate(deps.evaluate);
    const evaluate: Evaluate = async (policy, split) => {
      const res = await scored(policy, split);
      const key = split !== 'train' ? null : policy === G0 ? META_BASELINE : policy === REF ? META_REFERENCE : null;
      if (key) await upsertMeta(db, key, res.score, nowIso()).run().catch((err: unknown) => console.warn(`meta ${key} write failed:`, errText(err)));
      return res;
    };
    const bootstrap = async (): Promise<Generation> => {
      const [train, val] = await Promise.all([evaluate(G0, 'train'), evaluate(G0, 'val')]);
      return {
        id: G0.meta.id, number: 0, parentId: null, policy: G0, fromProposal: null, explanation: G0.meta.summary,
        train: train.score, val: val.score, findings: topFindings(train.results), createdAt: nowIso(),
      };
    };

    const log = eventLog(db, claim.id);
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    let open = true;
    // Never await the client: a slow or vanished reader must not stall the round (chunks queue in the stream).
    const send = (e: EvolveEvent) => {
      if (!open) return;
      writer.write(enc.encode(`${JSON.stringify(e)}\n`)).catch(() => { open = false; });
    };
    const emit = (e: EvolveEvent) => {
      log.push(e);
      send(e);
    };
    const heartbeat = setInterval(() => {
      if (open) writer.write(enc.encode('\n')).catch(() => { open = false; });
    }, HEARTBEAT_MS);

    const task = (async () => {
      try {
        await runRound({ llm: designer.llm, model: designer.model, store: createD1Store(db, { round: claim, bootstrap }), emit, now: nowIso, evaluate });
      } catch (err) {
        // runRound reports designer/evaluation failures itself; this is the store or bootstrap failing underneath it.
        const message = `Round ${claim.id} failed: ${errText(err)}`;
        console.error(message);
        emit({ type: 'error', message });
        emit({ type: 'decision', promoted: null, reason: `${message}. The champion is unchanged.` });
        await failRunningRound(db, claim.id, nowIso()).run().catch((e: unknown) => console.error('could not release the round lock:', errText(e)));
      } finally {
        clearInterval(heartbeat);
        await log.flush();
        writer.close().catch(() => {});
      }
    })();
    c.executionCtx.waitUntil(task);

    return new Response(readable, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  });

  return r;
}
