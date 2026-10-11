# LLM providers: integration brief for Headway

Researched 2026-10-11 against live docs and endpoints.

What the labels mean:

- **VERIFIED**: I read it on an official page, and the URL is given.
- **INFERRED**: strong indirect evidence supports it, but no official doc states it.
- **UNVERIFIED**: not confirmed. Test it before you rely on it.

No provider keys were available, so I made **no authenticated calls**. Every request shape below comes from docs, not from a live 200 response.

## At a glance

| | Luminal: policy designer | TypeSafe Jev: dispatcher | OpenAI Decisions: reference only |
|---|---|---|---|
| Endpoint | `POST https://flash.luminal.cloud/v1/chat/completions`. The host is VERIFIED; the `/v1/chat/completions` path is INFERRED | `POST https://api.typesafe.ai/v1/systemone` (VERIFIED) | `POST https://api.openai.com/v1/decisions` (VERIFIED) |
| Auth | `Authorization: Bearer lum_live_…`. VERIFIED on the images host, INFERRED on the text host | `Authorization: Bearer <key>` | `Authorization: Bearer $OPENAI_API_KEY` |
| Model | `deepseek-ai/DeepSeek-V4.1-Flash` is LIVE. GLM-5.3-Flash is "COMING SOON" and has no published ID | `jev-1.13.0` (aliases `jev-latest` and `jev-preview`) | `gpt-6-luna` |
| Output | Chat text. JSON mode (`json_object`) per a third-party listing | Typed answer, per-option probabilities, and confidence | Typed answer, probabilities, and confidence |
| Price | $0.1425/M input, $0.0029/M cached input, $0.57/M output (reasoning tokens included) | $0.042/M input; output is free | $0.10/M input; output is free |
| Default limits | 60 RPM, 1M TPM, 10 req/s burst | 80 req/s and 100K tokens/s. These limits are "adjusting dynamically" | Not stated in the guide |
| Latency | Not published. It is a reasoning model, so plan for seconds | P50 0.16 s on the OpenRouter model page | Vendor claim: "about 10x faster" than the Responses API |

---

## 1. Luminal: DeepSeek V4.1 Flash / GLM Flash as the "policy designer"

**Which company this is.** Luminal AI Inc. runs luminal.com: an ML compiler plus "Luminal Cloud" serverless inference (GitHub: `luminal-ai/luminal`). Three look-alikes are not it:

- `luminal.ai` is a parked domain.
- `getluminal.com` returns 404.
- Luma AI's GLM API at `inference.lumalabs.ai` is a different company, and it shows up in search results.

### Verified facts

- **Text API host: `flash.luminal.cloud`.** Luminal's Terms and Privacy Policy say: "the Luminal Text API at flash.luminal.cloud, the Luminal Images API at images.luminal.cloud, the dashboard at dash.luminal.com". Sources: https://dash.luminal.com/terms and https://dash.luminal.com/privacy.
- **Keys** start with `lum_live_…` and come from the dashboard (https://dash.luminal.com, sign-up at https://dash.luminal.com/sign-up). The Text API and Images API use the same keys. On the images host, auth is `Authorization: Bearer lum_live_…` or `Api-Key: lum_live_…`, and Bearer wins if both are sent. The docs use the env var `$LUMINAL_API_KEY`. Source: https://images.luminal.cloud/docs/.
- **Models and pricing** (source: https://luminal.com/pricing):
  - `deepseek-ai/DeepSeek-V4.1-Flash` is **LIVE**: input $0.1425/M, input cache hit $0.0029/M, output $0.5700/M. "The model reasons before it answers; reasoning tokens are billed as output."
  - **GLM-5.3-Flash is "COMING SOON".** "Pricing will be published here when the model goes live." No model ID is published.
  - Billing is pay-as-you-go with a $50 minimum top-up, and credit does not expire. Usage is billed from each response's `usage`. The page also mentions `usage.prompt_tokens_details.cached_tokens`, which is the OpenAI chat-completions usage shape.
  - Your balance is available via "GET /v1/balance on either host".
- **Default text limits:** 60 requests/min, 1,000,000 tokens/min, and a burst of 10 requests/s. For more, write to founders@luminal.com. Source: https://luminal.com/pricing.
- **Live probes, unauthenticated, 2026-10-11:**
  - `GET https://flash.luminal.cloud/healthz` returns `200 ok`.
  - `/v1/models`, `/v1/balance`, `/v1/chat/completions` and `/docs/` all return `401` with an **empty body**. Every path except `/healthz` and `/` requires a key.
  - A CORS preflight returns `401`, so **browser calls cannot work**. Call Luminal from the Worker only.
- **Hackathon docs or credits:** I found nothing public. The Luminal blog, GitHub org and site mention no hackathon or credit program.

### Inferred, not stated in Luminal docs

- **The API is OpenAI-compatible Chat Completions at `https://flash.luminal.cloud/v1`.**
  - Evidence 1: LLM Gateway carries Luminal as an "Airside carrier" that it reaches "as the 'openai' transport". Source: code comment in https://github.com/theopenco/llmgateway/blob/main/packages/actions/src/prepare-request-body.ts.
  - Evidence 2: the pricing page uses the OpenAI `usage.prompt_tokens_details` field.
  - I could not read the text-API docs: `flash.luminal.cloud/docs/` returns 401 without a key, while the images host serves its docs publicly. **Confirm with `GET /v1/models` as soon as you have a key.**
- **Capabilities of the Luminal route** per LLM Gateway's listing (https://llmgateway.io/models/deepseek-v4.1-flash/luminal and https://api.llmgateway.io/v1/models):
  - Supported: streaming, vision, tools (but `parallelToolCalls: false`), reasoning, and "JSON Output".
  - **"Structured JSON" (strict `json_schema`) is *not* listed for the Luminal route**, although other hosts of the same model have it. Treat `response_format: {type:"json_schema"}` as UNVERIFIED on Luminal.
  - Context is 1M tokens.

### Unverified: test with a key

- The exact GLM Flash model ID on Luminal. The upstream Hugging Face naming suggests `zai-org/GLM-5.3-Flash`, but this is UNVERIFIED and the model is not live.
- Whether Luminal honours the DeepSeek knobs `thinking: {type:"disabled"}` and `reasoning_effort` ("low", "high" or "max" on DeepSeek's own API; source: https://api-docs.deepseek.com/guides/thinking_mode). The Hugging Face card describes a "continuously controllable reasoning effort" setting from 1 to 100, with no API parameter name given.
- Whether the response carries `reasoning_content` and what the SSE stream format is. Ignore reasoning fields and read only `choices[0].message.content`.
- Error codes beyond 401, for example the status for insufficient balance.
- Latency. No public TTFT or throughput figure exists. The homepage's "<10ms p99" is a compiler benchmark claim, not an API SLA. Measure it yourself.

### DeepSeek model caveats (source: DeepSeek's first-party docs at https://api-docs.deepseek.com/guides/json_mode)

These describe the model's behaviour on DeepSeek's own API; whether Luminal behaves the same is UNVERIFIED.

- JSON mode is `response_format: {"type":"json_object"}`. The prompt **must contain the word "json"** and an example of the format. Set `max_tokens` high enough to avoid truncation.
- "The API may occasionally return empty content." Handle that case.
- In thinking mode, multi-turn requests **with tools** must pass back `reasoning_content` or the API returns a 400. LLM Gateway notes that any DeepSeek V4 host can enforce this. This is one more reason to use JSON mode instead of tool calls for policies.
- The Hugging Face card recommends temperature 1.0 and top_p 0.95–1.0. On DeepSeek's own API, thinking mode ignores or rejects temperature.

### Minimal request (the path is INFERRED; run the smoke test first)

```bash
# Smoke test: lists model IDs (and the GLM ID once it is live), then checks credit
curl https://flash.luminal.cloud/v1/models  -H "Authorization: Bearer $LUMINAL_API_KEY"
curl https://flash.luminal.cloud/v1/balance -H "Authorization: Bearer $LUMINAL_API_KEY"

curl https://flash.luminal.cloud/v1/chat/completions \
  -H "Authorization: Bearer $LUMINAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V4.1-Flash",
    "messages": [
      {"role": "system", "content": "Reply with only a json object like {\"ok\": true}."},
      {"role": "user", "content": "ping"}
    ],
    "response_format": {"type": "json_object"},
    "max_tokens": 4096
  }'
```

### Worker client (fetch only, no SDK)

```ts
// luminal.ts: runs in Cloudflare Workers. Uses only fetch, AbortSignal.timeout, setTimeout.
export interface LuminalEnv {
  LUMINAL_API_KEY: string;   // secret (lum_live_…): `npx wrangler secret put LUMINAL_API_KEY`
  LUMINAL_BASE_URL?: string; // var; default below. The path is INFERRED, so confirm it.
  LUMINAL_MODEL?: string;    // var; default deepseek-ai/DeepSeek-V4.1-Flash
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class LuminalError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

export async function luminalChatJSON(
  env: LuminalEnv,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; extra?: Record<string, unknown> } = {},
): Promise<{ json: unknown; raw: string; usage?: unknown; model?: string }> {
  const base = (env.LUMINAL_BASE_URL ?? "https://flash.luminal.cloud/v1").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.LUMINAL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.LUMINAL_MODEL ?? "deepseek-ai/DeepSeek-V4.1-Flash",
        messages,
        response_format: { type: "json_object" },
        max_tokens: opts.maxTokens ?? 8192, // reasoning tokens count as output, so leave headroom
        stream: false,
        ...opts.extra, // e.g. { reasoning_effort: "low" }: UNVERIFIED on Luminal, so test it
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
  } catch (err) {
    throw new LuminalError(`network/timeout: ${String(err)}`, undefined, true);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => ""); // a 401 from Luminal has an empty body
    throw new LuminalError(`Luminal ${res.status}: ${body.slice(0, 300)}`, res.status,
      res.status === 429 || res.status >= 500);
  }
  const data = (await res.json()) as {
    model?: string;
    usage?: unknown;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const raw = choice?.message?.content ?? "";
  if (choice?.finish_reason === "length") throw new LuminalError("truncated (finish_reason=length)", undefined, true);
  if (!raw.trim()) throw new LuminalError("empty content", undefined, true); // known DeepSeek JSON-mode quirk
  const cleaned = raw.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, ""); // strip md fences
  try {
    return { json: JSON.parse(cleaned), raw, usage: data.usage, model: data.model };
  } catch {
    throw new LuminalError("model returned invalid JSON", undefined, true);
  }
}

// ---- Policy designer: small, enumerated schema, validated and clamped in code ----
export type Policy = {
  version: 1;
  target_headway_s: number;      // 60..900
  max_hold_s: number;            // 0..180
  short_turn_allowed: boolean;
  reserve_dispatch_load: number; // 0..1.5 load factor that triggers a reserve train
  priority_lines: string[];      // must be known line IDs
  operating_instructions: string; // <= 600 chars of plain English, fed to Jev as state
};

const clampNum = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

export function validatePolicy(x: unknown, knownLines: ReadonlySet<string>): Policy | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const target = clampNum(o.target_headway_s, 60, 900);
  const hold = clampNum(o.max_hold_s, 0, 180);
  const reserve = clampNum(o.reserve_dispatch_load, 0, 1.5);
  if (target === null || hold === null || reserve === null) return null;
  if (typeof o.short_turn_allowed !== "boolean") return null;
  if (typeof o.operating_instructions !== "string" || !o.operating_instructions.trim()) return null;
  const lines = Array.isArray(o.priority_lines)
    ? o.priority_lines.filter((l): l is string => typeof l === "string" && knownLines.has(l))
    : [];
  return {
    version: 1,
    target_headway_s: Math.round(target),
    max_hold_s: Math.round(hold),
    short_turn_allowed: o.short_turn_allowed,
    reserve_dispatch_load: reserve,
    priority_lines: lines,
    operating_instructions: o.operating_instructions.slice(0, 600),
  };
}

const POLICY_SYSTEM = `You are the policy designer for a transit simulation.
Return ONLY a json object (no prose, no markdown) with exactly these keys:
{"version":1,"target_headway_s":<int 60-900>,"max_hold_s":<int 0-180>,"short_turn_allowed":<bool>,
 "reserve_dispatch_load":<number 0-1.5>,"priority_lines":[<line id>,...],
 "operating_instructions":"<at most 600 chars of plain English for the dispatcher>"}
Example: {"version":1,"target_headway_s":240,"max_hold_s":60,"short_turn_allowed":true,
"reserve_dispatch_load":1.1,"priority_lines":["red"],"operating_instructions":"Protect red line headways. Hold at most 60 s. Short-turn only when 3+ trains bunch."}`;

export async function designPolicy(
  env: LuminalEnv,
  situation: unknown,
  knownLines: string[],
  fallback: Policy,
): Promise<{ policy: Policy; source: "model" | "fallback" }> {
  const lines = new Set(knownLines);
  const messages: ChatMessage[] = [
    { role: "system", content: POLICY_SYSTEM },
    { role: "user", content: `Network state as json:\n${JSON.stringify(situation)}` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { json, raw } = await luminalChatJSON(env, messages);
      const policy = validatePolicy(json, lines);
      if (policy) return { policy, source: "model" };
      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: "That json did not match the required keys/ranges. Return only the corrected json object." },
      );
    } catch (err) {
      if (!(err instanceof LuminalError) || !err.retryable) break;
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
    }
  }
  return { policy: fallback, source: "fallback" }; // the game never blocks on the LLM
}
```

### Structured-output strategy

1. **Request JSON mode.** Send `response_format: {type:"json_object"}`, put the word "json" and one example in the system prompt, and keep the schema small. Enumerated fields and clamped numbers are better than free-form plans.
2. **Validate in code.** The validator above clamps numeric ranges and drops unknown line IDs. On failure, do one repair turn, then fall back to the last good policy. Never let the policy designer emit concrete actions: the policy only parameterises the deterministic sim and Jev's state.
3. **Optional test.** Send once with `response_format: {type:"json_schema", json_schema:{…, strict:true}}`. If Luminal accepts it, keep it. Keep the validator either way.
4. **Run the designer off the hot path.** Call it from a Durable Object alarm or `ctx.waitUntil`, on a cadence (every N sim-minutes or when the player asks), not every tick. Waiting on `fetch` does not count as Worker CPU time. HTTP requests have no wall-clock limit while the client is connected; DO alarms and crons are capped at 15 min. Source: https://developers.cloudflare.com/workers/platform/limits/.

### Failure modes and limits

- **401 with an empty body:** bad or missing key.
- **429:** over 60 RPM, 1M TPM or the 10 req/s burst. The limit is per account, so **all players share it**. Funnel calls through one Durable Object rate limiter.
- **5xx or timeout:** reasoning can take tens of seconds, so use a long timeout.
- **`finish_reason: "length"`:** the reasoning used up `max_tokens` before the JSON was written.
- **Empty `content`:** a known DeepSeek JSON-mode quirk.
- **Markdown fences around the JSON:** stripped by the client above.
- **"Model not found" for GLM:** GLM-5.3-Flash is not live.
- **Workers limits:** only 6 simultaneous connections may wait for response headers per invocation. The Free plan allows 50 subrequests per request; the Paid plan allows 10,000.
- **Rough cost:** 3k input + 2k output tokens is about $0.0016 per policy call.

### Fallback route (if the direct API is blocked)

LLM Gateway at `https://api.llmgateway.io/v1` (OpenAI-compatible) with model `luminal/deepseek-v4.1-flash`. That ID "pins every request to Luminal" on pay-as-you-go keys and costs $0.135/$0.0027/$0.54 per M. Source: https://llmgateway.io/providers/luminal. Confirm with the organizers that this still counts as "through Luminal".

### Open questions for you (Luminal)

1. Do the hackathon materials give a Luminal base URL, model IDs, or a credit code? If not, sign up at dash.luminal.com; there is a $50 minimum top-up.
2. Is GLM Flash mandatory, or is DeepSeek V4.1 Flash enough? GLM is not live on Luminal today.
3. Which env var names? I proposed `LUMINAL_API_KEY` as a secret, plus `LUMINAL_BASE_URL` and `LUMINAL_MODEL` as vars.
4. Once you have a key, run the smoke test to confirm `/v1/chat/completions`, `json_schema`, and `reasoning_effort` support.

---

## 2. TypeSafe Jev: picking the dispatch action

### Verified facts (sources: https://docs.typesafe.ai/api.md and https://docs.typesafe.ai/models.md unless noted)

- **Endpoint:** `POST https://api.typesafe.ai/v1/systemone`, with headers `Authorization: Bearer <API_KEY>` and `Content-Type: application/json`. `GET /v1/models` lists the aliases.
- **Request body:** `{ model, state, questions }`, all three required.
  - `state` can be a string, an object or an array. Prefer named JSON fields, and reference nested values in instructions as `` `path.to.field` ``.
  - `questions` is a map from an id you choose to a Question. **The id is not sent to the model**, so put the full meaning in `instructions`.
- **Choice question:** `{ "type": "choice", "instructions": string|object|array, "criteria": { "<option>": string|object|array|null } }`.
  - **At most 255 options.**
  - Option descriptions can be objects such as `{what, not_for, examples}` to separate confusable options.
  - Include a no-match or no-op option. Source: https://docs.typesafe.ai/primitives/choice.md.
- **Other question types:**
  - `noul` returns the probability of yes, with optional `criteria: {true, false}`.
  - `score` takes 2–10 ordered levels and returns a probability-weighted index.
- **Response:** `{ model: "jev-1.13.0", answers: { <id>: { type:"choice", choice, probabilities:{<option>: p}, confidence } }, usage: { input_tokens, output_tokens } }`.
  - `probabilities` sum to 1.
  - `confidence` (0–1) measures how concentrated that distribution is. It does not mean the action is correct. Source: https://docs.typesafe.ai/confidence.md.
- **Errors:** 401 (bad key), 422 (validation; the body names the field), 429 (rate limit), 529 (overloaded). Retry 429 and 529 with exponential backoff.
- **Models:** `jev-1.13.0` is current. `jev-latest` and `jev-preview` both point to it. **Pin `jev-1.13.0`** if you tune thresholds. The response's `model` field reports the version that answered.
- **Price:** $0.042 per M input tokens; **output is free**.
- **Rate limits:** 100K tokens/s and 80 requests/s. These are "adjusting dynamically" and may change without notice.
- **Context:** 64k tokens per request in total, with **32k for `state` plus the longest question**. Input is text only. English is strongest.
- **Latency:** the TypeSafe docs give none. The OpenRouter model page shows **P50 0.16 s** with 100% uptime. Source: https://openrouter.ai/typesafe/jev-1.13.
- **JavaScript SDK `@typesafe-ai/sdk` 0.6.0** (published to npm 2026-09-15, MIT, **zero runtime dependencies**). Usage: `new TypeSafeClient({ apiKey, baseURL })` then `client.systemOne({...})`. The package also exports a `choice()` helper. Env vars: `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL`, `TYPESAFE_DEFAULT_MODEL`. Defaults: 10 s timeout, 2 retries on 408, 429 and 5xx, honours `retry-after`.
- **Workers compatibility of the SDK** (judged by reading the v0.6.0 source):
  - It uses `globalThis.fetch`, `AbortController` and `setTimeout`.
  - Its `process.env` reads are guarded with `typeof process === "undefined"`.
  - It detects `navigator.userAgent === "Cloudflare-Workers"` explicitly.
  - It refuses to run in a browser unless you pass `dangerouslyAllowBrowser`.
  - The verdict is **fetch-only and should run in Workers if you pass `apiKey` explicitly** (there is no `process.env` without `nodejs_compat`). `engines: node>=20` is advisory only. I did **not** execute it in workerd, so it is UNTESTED there. The snippet below uses raw `fetch` anyway, because it is about 30 lines. Sources: https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts, src/env.ts, src/runtime.ts, src/retry.ts.

### OpenRouter (VERIFIED)

Sources: https://openrouter.ai/docs/guides/community/jev, /jev-tutorial and /typesafe-sdk.

- **Model ID:** `typesafe/jev-1.13`. The alias `~typesafe/jev-latest` also works, and responses report the dated snapshot `typesafe/jev-1.13-20260917`.
- **No TypeSafe account is needed;** you use your OpenRouter key.
- **Two surfaces:**
  - `POST https://openrouter.ai/api/alpha/decisions`: the same `state` and `questions` body as TypeSafe, with `model: "typesafe/jev-1.13"`.
  - `POST https://openrouter.ai/api/v1/systemone`: TypeSafe-compatible. Point the SDK at `baseURL: "https://openrouter.ai/api"`. Bare `jev-1.13` maps to `typesafe/jev-1.13`, and `jev-latest` maps to `~typesafe/jev-latest`.
- **Probabilities are exposed.** The tutorial's captured live response includes `choice`, `probabilities` and `confidence`, plus the extra fields `id`, `provider` and `usage.cost`.
- **Price:** $0.042/M input; output is free.
- **Context:** OpenRouter's docs say 32,000 tokens; its endpoint metadata says 64k context with a 32k prompt limit. **Budget 32k or less.**
- The SDK's `client.models.list()` does **not** work against OpenRouter.
- Do not confuse Jev with `typesafe/jev-router`, which is a chat-model router.

### Best pattern for "pick one legal dispatch action given the situation and operating instructions"

This combines several pieces of the TypeSafe docs:

- the **Choice** primitive;
- "route and fill known arguments" from https://docs.typesafe.ai/cookbooks/function_calling.md;
- "rank then verify" from https://docs.typesafe.ai/cookbooks/skill_suggestion.md;
- **confidence-gated routing** with risk-scaled thresholds from https://docs.typesafe.ai/patterns/confidence-routing.md;
- **speculative fan-out** from https://docs.typesafe.ai/patterns/fan-out.md.

OpenRouter's "Gate Agent Tool Calls with Jev" cookbook is the closest published analogue.

1. **Code decides what is legal.** Build the `criteria` map each tick from the currently legal actions only (at most 254, plus a no-op option). If only one action is legal, skip the call.
2. **Build the state.** Put `operating_instructions` (written by the Luminal policy designer), the policy parameters and a compact `situation` in `state`. Keep observed facts separate from inferred ones.
3. **One request per tick.** Add one Choice question per controllable unit, such as each train or depot. The questions run in parallel and **cannot see each other's answers**, so resolve conflicts in code.
4. **Gate on confidence.** Act when `confidence` is at or above a threshold that scales with risk; otherwise fall back to a deterministic heuristic or `no_action`. Tune thresholds on playtests; the numbers below are illustrative.
5. **Check freshness.** Tag each request with the sim tick. Drop the answer if the state changed or the action is no longer legal.

Example request body:

```json
{
  "model": "jev-1.13.0",
  "state": {
    "tick": 18342,
    "operating_instructions": "Protect red line headways. Hold at most 60 s. Short-turn only when 3+ trains bunch.",
    "policy": { "target_headway_s": 240, "max_hold_s": 60, "short_turn_allowed": true },
    "situation": {
      "line": "red",
      "trains": [
        { "id": "T7", "at": "Central", "gap_ahead_s": 95, "gap_behind_s": 410, "load": 1.2 },
        { "id": "T8", "at": "Market", "gap_ahead_s": 410, "gap_behind_s": 120, "load": 0.6 }
      ],
      "incidents": ["signal fault at Harbor, ~5 min"]
    }
  },
  "questions": {
    "T7": {
      "type": "choice",
      "instructions": "Train T7 is in `situation.trains[0]`. Which single action should dispatch take for T7 right now to follow `operating_instructions`?",
      "criteria": {
        "hold_60": { "what": "Hold T7 at Central for 60 s", "effect": "Widens the gap ahead, shrinks the gap behind" },
        "short_turn_market": { "what": "Short-turn T7 at Market", "not_for": "Normal running without bunching" },
        "no_action": "No intervention: T7 continues normally"
      }
    }
  }
}
```

### Worker client (fetch only)

```ts
// jev.ts: TypeSafe System One over fetch. Works with TypeSafe directly or with OpenRouter.
export interface JevEnv {
  TYPESAFE_API_KEY: string;   // secret: a TypeSafe key, or an OpenRouter key when using OpenRouter
  TYPESAFE_BASE_URL?: string; // var: "https://api.typesafe.ai" (default) | "https://openrouter.ai/api"
  TYPESAFE_MODEL?: string;    // var: "jev-1.13.0" (direct) | "typesafe/jev-1.13" (OpenRouter)
}

export type Text = string | Record<string, unknown> | unknown[];
export type ChoiceQuestion = { type: "choice"; instructions: Text; criteria: Record<string, Text | null> };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type JevResult<K extends string> = {
  model: string;
  answers: Record<K, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number; cost?: number }; // `cost` is OpenRouter-only
};

export async function jevChoices<K extends string>(
  env: JevEnv,
  state: Text,
  questions: Record<K, ChoiceQuestion>,
  opts: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<JevResult<K>> {
  const base = (env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  const body = JSON.stringify({ model: env.TYPESAFE_MODEL ?? "jev-1.13.0", state, questions });
  const maxRetries = opts.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    if (res.ok) return (await res.json()) as JevResult<K>;
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`TypeSafe ${res.status}: ${(await res.text()).slice(0, 300)}`); // 422 names the bad field
    }
    const retryAfterS = Number(res.headers.get("retry-after"));
    const delayMs = retryAfterS > 0 ? retryAfterS * 1_000 : 500 * 2 ** attempt * (0.75 + Math.random() * 0.5);
    await new Promise((r) => setTimeout(r, Math.min(delayMs, 5_000)));
  }
}

// ---- Dispatcher: legal actions in, at most one action per unit out ----
export type LegalAction = { id: string; unit: string; what: string; effect: string; risk: "low" | "high" };

export async function chooseDispatch(
  env: JevEnv,
  tick: number,
  situation: Record<string, unknown>,
  operatingInstructions: string,
  legal: LegalAction[],
): Promise<Map<string, { action: LegalAction | null; confidence: number }>> {
  const byUnit = new Map<string, LegalAction[]>();
  for (const a of legal) byUnit.set(a.unit, [...(byUnit.get(a.unit) ?? []), a]);

  const questions: Record<string, ChoiceQuestion> = {};
  for (const [unit, actions] of byUnit) {
    const criteria: Record<string, Text | null> = { no_action: `No intervention: ${unit} continues normally` };
    for (const a of actions.slice(0, 254)) criteria[a.id] = { what: a.what, effect: a.effect };
    questions[unit] = {
      type: "choice",
      instructions: `Which single action should dispatch take for ${unit} right now to follow \`operating_instructions\`?`,
      criteria,
    };
  }
  const out = new Map<string, { action: LegalAction | null; confidence: number }>();
  if (Object.keys(questions).length === 0) return out;

  const res = await jevChoices(env, { tick, operating_instructions: operatingInstructions, situation }, questions);
  for (const [unit, answer] of Object.entries(res.answers) as [string, ChoiceAnswer][]) {
    const picked = byUnit.get(unit)?.find((a) => a.id === answer.choice) ?? null; // re-check legality in code
    const threshold = picked?.risk === "high" ? 0.6 : 0.3; // illustrative: tune on playtests
    out.set(unit, { action: picked && answer.confidence >= threshold ? picked : null, confidence: answer.confidence });
  }
  return out;
}
```

### Failure modes and limits (Jev)

- **Errors:** 401 means a bad key. 422 means a malformed question; common causes are more than 255 options or too few Score levels. 429 means 80 RPS or 100K TPS was exceeded. 529 means TypeSafe is overloaded. On a timeout, fall back to the heuristic.
- **Token budget:** keep the state plus the longest question under 32k tokens. Send compact situation JSON, not the whole sim.
- **Confidence:** it can be low when two actions are both acceptable. That is not always an error; a harmless preference can still be applied.
- **Typed output guarantees the interface, not correctness.** Validate the chosen action against the sim before applying it.
- **Rough cost:** about 2k input tokens is $0.000084 per request. One request per second for an hour costs about $0.30.

### Open questions for you (Jev)

1. Do you have a TypeSafe key, or will you use OpenRouter? This decides `TYPESAFE_BASE_URL` and `TYPESAFE_MODEL`. Pin `jev-1.13.0` direct or `typesafe/jev-1.13` on OpenRouter.
2. Is Jev a judged requirement? If so, the direct TypeSafe endpoint is the safer choice for attribution.
3. How often does the sim tick for dispatch, and how many units does it decide per tick? This sets the fan-out size and the request rate.

---

## 3. OpenAI Decisions API: it exists (VERIFIED)

Sources: https://developers.openai.com/api/docs/guides/decisions and https://developers.openai.com/api/reference/resources/decisions/methods/create.

- **Status and model:** public beta, with GA expected "in the coming weeks". `gpt-6-luna` is the only model, served at `POST https://api.openai.com/v1/decisions` with `Authorization: Bearer $OPENAI_API_KEY`.
- **Request:** `{model, input: string | user messages with input_text/input_image (≤128 images), questions: [{type: "predicate"|"choice"|"score", name, instructions, choices: [{value, description}] (2–255) | levels: [{label, description}]}]}`.
- **Response:** `answers[]` in question order. A choice answer is `{type, name, choice, probabilities: [{value, probability}], confidence}`; a predicate answer has a `probability`; any question may come back as `{type: "refusal", name}`.
- **Price and SDKs:** $0.10/M input tokens with no output charges. JS SDK `openai` ≥7.30.0 via `client.decisions.create(...)`. Vercel AI Gateway also exposes it as `openai/gpt-6-luna-decisions`.

---

## Sources

- **Luminal:** https://luminal.com/pricing · https://dash.luminal.com/terms · https://dash.luminal.com/privacy · https://images.luminal.cloud/docs/ · https://github.com/luminal-ai/luminal
- **LLM Gateway (third party):** https://llmgateway.io/providers/luminal · https://llmgateway.io/models/deepseek-v4.1-flash/luminal · https://api.llmgateway.io/v1/models · https://github.com/theopenco/llmgateway/blob/main/packages/actions/src/prepare-request-body.ts
- **DeepSeek:** https://api-docs.deepseek.com/guides/json_mode · https://api-docs.deepseek.com/guides/thinking_mode · https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash
- **TypeSafe:** https://docs.typesafe.ai/llms.txt · https://docs.typesafe.ai/api.md · https://docs.typesafe.ai/models.md · https://docs.typesafe.ai/sdk/javascript.md · https://docs.typesafe.ai/primitives/choice.md · https://docs.typesafe.ai/confidence.md · https://docs.typesafe.ai/patterns/fan-out.md · https://docs.typesafe.ai/patterns/confidence-routing.md · https://docs.typesafe.ai/cookbooks/function_calling.md · https://docs.typesafe.ai/cookbooks/skill_suggestion.md · https://registry.npmjs.org/@typesafe-ai/sdk · https://github.com/typesafe-ai/typesafe-sdk-js/tree/v0.6.0/src
- **OpenRouter:** https://openrouter.ai/docs/guides/community/jev · https://openrouter.ai/docs/guides/community/jev-tutorial · https://openrouter.ai/docs/guides/community/typesafe-sdk · https://openrouter.ai/typesafe/jev-1.13 · https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints
- **OpenAI:** https://developers.openai.com/api/docs/guides/decisions · https://developers.openai.com/api/reference/resources/decisions/methods/create · https://community.openai.com/t/decisions-api-is-now-available-in-public-beta/1403877 · https://vercel.com/changelog/openai-decisions-api-now-available-on-ai-gateway
- **Cloudflare:** https://developers.cloudflare.com/workers/platform/limits/
