// Worker bindings and injectable dependencies.
import type { LlmClient } from '@headway/evolve';
import type { Policy, RunResult, SplitScore } from '@headway/sim';

/** Bindings: wrangler.jsonc vars + D1 + assets, and secrets (.dev.vars locally / `wrangler secret put`). */
export interface AppEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  SIM_VERSION: string;
  LUMINAL_BASE_URL: string;
  LUMINAL_MODEL: string;
  OPENROUTER_BASE_URL: string;
  JEV_MODEL: string;
  LUMINAL_API_KEY: string;
  OPENROUTER_API_KEY: string;
  ADMIN_TOKEN: string;
  /** JSON array of sealed test seeds; never in the repo. */
  SEALED_TEST_SEEDS?: string;
}

/** The plan's name for the bindings type. */
export type Env = AppEnv;

/** Scores a policy on an evolution split (spec §7): the same shape as `RoundDeps.evaluate`. */
export type Evaluate = (policy: Policy, split: 'train' | 'val') => Promise<{ score: SplitScore; results: RunResult[] }>;

/** The designer LLM for `/api/evolve` and the model id it is asked for. */
export interface Designer {
  llm: LlmClient;
  model: string;
}

/** Things tests swap out. Defaults are the real runtime globals. */
export interface AppDeps {
  /** Outbound fetch for upstream APIs (OpenRouter/Jev, Luminal). */
  fetch: typeof fetch;
  /** Shared Cache API cache, or null to skip that layer. */
  cache: () => Cache | null;
  /** Wall clock in ms (rate-limit windows, latency, timestamps, play seeds). */
  now: () => number;
  /** Designer LLM for `/api/evolve`; null when no API key is configured. Default: Luminal, falling back to OpenRouter. */
  designer: (env: AppEnv) => Designer | null;
  /** Policy scoring for `/api/evolve`. Default: the real engine over `SEEDS.train` / `SEEDS.val`. */
  evaluate: Evaluate;
}

export type AppContext = { Bindings: AppEnv };
