// Worker bindings and injectable dependencies.

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

/** Things tests swap out. Defaults are the real runtime globals. */
export interface AppDeps {
  /** Outbound fetch for upstream APIs (OpenRouter/Jev, Luminal). */
  fetch: typeof fetch;
  /** Shared Cache API cache, or null to skip that layer. */
  cache: () => Cache | null;
  /** Wall clock in ms (rate-limit windows, latency). */
  now: () => number;
}

export type AppContext = { Bindings: AppEnv };
