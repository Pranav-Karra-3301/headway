# Headway

> A team of AI planners teaches the town's dispatcher, and you can try to beat it.

**Live:** https://headway.pranavkarra001.workers.dev

Headway is a small isometric transit-dispatch game set in a fictional, State College–inspired college town. You can
watch the town run, dispatch it yourself, or replay how successive AI-designed controllers handled the same rush hour.

Between games, three LLM **policy designers** rewrite the town's **dispatch policy**: a bounded, versioned JSON
rulebook. Only changes that measurably help are kept. The language models are never retrained. What improves is the
policy, and the policy runs in your browser with no model calls.

## What is actually going on

- **What evolves.** The dispatch policy, which is at most 24 rules of the form "when these features hold, do this
  action". The actions are hold, dispatch, reassign a bus to another route, or set the train's departure. When a
  rule fires, its explanation is the rule's own `say` template filled with the real feature values. It is never
  written after the fact.
- **Who designs it.** Each round, 3 designers propose changes. All three run `deepseek-ai/DeepSeek-V4.1-Flash` on
  [Luminal](https://luminal.com), and they differ only in emphasis (transfers, spacing or allocation) and
  temperature. If Luminal times out, rate-limits or returns a 5xx, the call falls back once to
  `deepseek/deepseek-v4-pro` on OpenRouter, and the proposal records which model answered. Proposals are validated
  with zod plus semantic checks, and each designer gets one repair attempt.
- **How a change survives.** Valid proposals are simulated on 8 training runs (`stadium_exit` and `class_change` ×
  seeds 1001–1004). The best one is promoted only if all of these hold:
  - J improves by at least 1% on training;
  - it is no worse on 4 validation runs that the designers never see;
  - completion drops by at most 1 percentage point;
  - the worst service gap at any stop stays within max(the champion's worst, 15 min).

  If the best fails validation, the runner-up gets one try.
- **Jev for station holds.** A policy can hand a single decision to Jev (TypeSafe `typesafe/jev-1.13` via
  OpenRouter). The decision is whether a bus at one of the 3 station stops leaves now or holds 20, 40 or 60 s when a
  train is due. Code generates the legal options, and Jev picks one with probabilities. On a timeout or error, the
  rules decide. Every Jev decision is logged, so replays never call Jev again. What evolves on this track is the
  advisor's instructions and when it is asked. Jev itself does not change.
- **The sealed test.** 3 extra seeds are kept secret as `SEALED_TEST_SEEDS` in the gitignored root `.env`. They are
  never in a prompt, in `evolve`'s code paths or in the repo. After optimization, the champion, `g0` and `ref` are scored
  on them, and the results appear in the Lab's "never shown to agents" panel.
- **Fair comparisons.** All randomness (crowd, traffic, train delays, rider behaviour) is drawn from the seed before
  the run starts, so every controller faces the identical crowd. In Play you control the baseline `g0` plus your own
  interventions, on the same seed the champion and baseline are scored on. Doing nothing scores exactly the
  baseline.

The objective is **J**, total passenger time, and lower is better. Everyone who got home contributes their
door-to-door time. Anyone still travelling at the end contributes their time so far plus a penalty
(`objective.unfinishedPenaltyS`, 2,700 s by default). The full design is in
[`docs/superpowers/specs/2026-10-11-headway-design.md`](docs/superpowers/specs/2026-10-11-headway-design.md).

## Modes

| Route | Mode | What you do |
|---|---|---|
| `/` | Watch | The current champion runs the showcase crowds. Click a bus, stop or person to inspect it, and switch the controller between g0, ref and champion. |
| `/play` | Play | Dispatch the `stadium_exit` crowd on today's play seed, then compare yourself with the champion and the baseline on the identical seed. |
| `/lab`, `/lab/:generationId` | Lab | See the generation timeline, the J chart, proposal cards, rule diffs, the evolve feed and the sealed-test panel. |

- **Play keys:**
  - `D` dispatch, `H` hold 30 s (`Shift+H` 60 s), `Space` pause, `1`–`4` for 1×/4×/8×/16×.
  - `R` reassign, then `1`/`2`/`3` to pick the route.
  - `T` holds the train 30 s more (`Shift+T` departs now).
  - `[` and `]` cycle the selected bus. `Esc` closes a picker.
- **Anywhere:** `?` opens "How Headway works" and `Esc` closes it. `/#about` deep-links to that panel.
- **Title card:** it shows on the first visit to `/`. Use `/?intro` to show it again, for example in a demo.

## Repository layout

```
packages/sim/      @headway/sim     deterministic sim: contracts, town, scenarios, engine, policy DSL + interpreter, metrics
packages/evolve/   @headway/evolve  LLM client (Luminal + OpenRouter fallback), prompts, rounds, narratives, Jev provider, CLIs
apps/web/          @headway/web     Vite + React HUD + Three.js TownRenderer; SimRunner; Web Worker for headless runs
apps/worker/       @headway/worker  Cloudflare Worker: static assets + Hono /api/*, D1 migrations
scripts/smoke/                      dependency-free headless-Chrome smoke test
data/                               CLI output: generations/, rounds/ (published to D1 with --publish)
docs/                               spec, plan, research, demo script, pitch
```

- **Dependency rules:** `sim` depends only on `zod`. It has no DOM, network, `Date` or `Math.random`, and it runs
  identically in the browser, in Node and in the Worker.
- `evolve` reaches models only through `fetch`. `node:*` imports are allowed only under `src/cli/`.
- `web` never imports `evolve`.

## Setup

You need:

- Node ≥ 22 (developed on Node 26);
- pnpm 11 (`corepack enable`);
- Google Chrome, for the smoke test;
- a Cloudflare login, for deploys.

```bash
export npm_config_registry=https://registry.npmjs.org/   # the repo .npmrc pins this too
pnpm install
```

Secrets live in two gitignored files. Never commit or print them.

| File | Keys |
|---|---|
| `.env` (repo root, used by the CLIs) | `LUMINAL_API_KEY`, `OPENROUTER_API_KEY`, `ADMIN_TOKEN` (`SEALED_TEST_SEEDS` is added by `eval-sealed`) |
| `apps/worker/.dev.vars` (`wrangler dev`) | the same keys |

## Run locally

```bash
pnpm dev                     # web app on http://localhost:5173 (Vite)
```

In `pnpm dev` there is no API. Every `/api` read falls back to the static files in `apps/web/public/data/*.json`,
which `export-web` writes (see below).

To run the full stack locally (Worker + D1 + the built app):

```bash
pnpm build                                                                    # apps/web/dist
pnpm --filter @headway/worker exec wrangler d1 migrations apply headway --local
pnpm --filter @headway/worker dev                                             # http://localhost:8787
```

## Test

```bash
pnpm test                                  # vitest across all packages
pnpm typecheck                             # tsc in every package
pnpm --filter @headway/web build           # production build of the web app
pnpm --filter @headway/web test            # one package (or: pnpm --filter @headway/sim test, ...)
node scripts/smoke/run.mjs --url http://localhost:8787   # headless Chrome on /, /play, /lab
```

## Simulate and evolve (CLI)

```bash
pnpm sim:run --policy g0 --scenario stadium_exit --seed 1001     # one run, prints metrics (g0 | ref | <policy file>)
pnpm evolve --rounds 3                                           # 3 rounds with Luminal designers → data/generations, data/rounds
pnpm evolve --rounds 3 --publish https://headway.pranavkarra001.workers.dev   # also POSTs to /api/admin/publish (ADMIN_TOKEN)
```

Tooling CLIs run from the evolve package:

```bash
pnpm --filter @headway/evolve exec tsx src/cli/export-web.ts      # data/ → apps/web/public/data/{champion,generations}.json
pnpm --filter @headway/evolve exec tsx src/cli/sweep.ts --policies g0,ref,champion --split train   # metrics table + sanity gates
pnpm --filter @headway/evolve exec tsx src/cli/eval-sealed.ts --url https://headway.pranavkarra001.workers.dev  # sealed test
pnpm --filter @headway/evolve exec tsx src/cli/verify-leaderboard.ts   # re-simulate leaderboard replays from D1
```

`eval-sealed` reads `SEALED_TEST_SEEDS` from `.env`. If it is missing, it generates 3 seeds and appends them there.
It never prints the seeds; only a short fingerprint identifies the set.

## Deploy (Cloudflare)

The app deploys as a single Worker named `headway`. The Worker serves `apps/web/dist` as static assets and handles
`/api/*` with Hono over D1. Config: [`apps/worker/wrangler.jsonc`](apps/worker/wrangler.jsonc).

One-time setup:

```bash
cd apps/worker
pnpm exec wrangler login
pnpm exec wrangler d1 migrations apply headway --remote
pnpm exec wrangler secret put LUMINAL_API_KEY
pnpm exec wrangler secret put OPENROUTER_API_KEY
pnpm exec wrangler secret put ADMIN_TOKEN
```

To deploy, run this from the repo root. It runs `pnpm build`, then `wrangler deploy`. Use `pnpm run deploy`: plain
`pnpm deploy` is pnpm's own built-in command.

```bash
pnpm run deploy
```

To check the deploy:

```bash
curl https://headway.pranavkarra001.workers.dev/api/health
curl https://headway.pranavkarra001.workers.dev/api/champion
node scripts/smoke/run.mjs --url https://headway.pranavkarra001.workers.dev
```

## API

| Endpoint | Behaviour |
|---|---|
| `GET /api/health` | `{ ok, simVersion, time }` |
| `GET /api/champion` | `{ policy, generation, train, val }` (falls back to `g0`) |
| `GET /api/generations`, `GET /api/generations/:id` | generation summaries with baseline and reference scores; one generation with its round |
| `POST /api/evolve` (Bearer `ADMIN_TOKEN`) | runs one round, streaming `EvolveEvent`s as NDJSON; one round at a time |
| `GET /api/leaderboard?seed=`, `POST /api/leaderboard` | top 20 for a play seed; submit `{ name, replay }`, which the server re-simulates |
| `POST /api/jev/decide` | rate-limited, cached proxy to Jev on OpenRouter `/systemone` |
| `POST /api/admin/publish`, `POST /api/admin/sealed-eval`, `GET /api/sealed` | CLI publish; sealed results |

## Docs

- [Design spec](docs/superpowers/specs/2026-10-11-headway-design.md) and
  [build plan](docs/superpowers/plans/2026-10-11-headway-build.md)
- [4-minute demo script](docs/demo-script.md) and [pitch](docs/pitch.md)
- [LLM provider research](docs/research/llm-providers.md)
