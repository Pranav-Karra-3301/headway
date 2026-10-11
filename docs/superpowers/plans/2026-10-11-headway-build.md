# Headway Build Implementation Plan (Wave 0b + Wave 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Hackathon speed mode (user-approved):** tasks are *track briefs* run by parallel agents in a workflow. Each brief fixes the owned files, the exact interfaces, the tests to write **first**, and the commands that must pass. Agents write the implementation test-first. Agents do **not** commit (the coordinator commits per wave) and do **not** add dependencies.

**Goal:** A playable, deployable Headway prototype: deterministic transit sim, isometric Three.js town, Watch / Play / Lab, Luminal-designed policy evolution, Jev station holds, on Cloudflare.

**Architecture:** One deterministic TypeScript sim (`@headway/sim`) shared by the browser, the Node CLI and the Worker. `@headway/evolve` runs evolution rounds against it. `apps/web` renders and plays. `apps/worker` serves the app and the API over D1. Spec: `docs/superpowers/specs/2026-10-11-headway-design.md`.

**Tech Stack:** TypeScript (strict, ESM), pnpm 11 workspaces, zod, vitest, Vite + React 19 + zustand, three@0.186.1, Hono on Cloudflare Workers + D1, Luminal (`deepseek-ai/DeepSeek-V4.1-Flash`), OpenRouter (fallback `deepseek/deepseek-v4-pro`, Jev `typesafe/jev-1.13`).

## Global Constraints

- `packages/sim/src/contracts.ts` (spec §4) and `packages/sim/src/internal.ts` (below) are **frozen**. Need a change? Stop and report it; the coordinator decides.
- Interface-first stubs exist for every module before Wave 1 starts (coordinator creates them; signatures below). **Owners replace stub bodies; nobody changes a stub's exported signature.** Every module is already exported from its package barrel.
- `@headway/sim`: no DOM, no `three`, no network, no `Date`, no `Math.random`; dependency `zod` only; state updates use integer seconds and no transcendental math (`Math.sqrt` allowed; `Math.atan2` only for viewer headings).
- `@headway/evolve`: `fetch` only; `node:*` imports only under `src/cli/`.
- Ownership: edit **only** the paths your task owns. Barrels (`packages/*/src/index.ts`) belong to the coordinator.
- No new dependencies, no edits to root config, lockfile, `package.json` files or `wrangler.jsonc` (report needs instead). No `git` commands.
- Shell: `export npm_config_registry=https://registry.npmjs.org/` before any pnpm/npx command. Node may need `source ~/.nvm/nvm.sh && nvm use default`.
- Commands that must pass for your package before you report done: `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test`. Web also: `pnpm --filter @headway/web build`.
- Secrets come only from root `.env` / `apps/worker/.dev.vars`. Never print, log or commit them.
- Visual source: `.superpowers/wip/kit-sheet.html` (kit builders, 3 palettes). Fonts: **Gumball Rounded** (`/fonts/GumballRounded.ttf`) for wordmark, chips, labels, numbers, queue markers; `"Avenir Next Rounded Std", Nunito, system-ui` for body.
- Time: hackathon, hours left. Prefer the simplest correct implementation; no speculative features.

---

## Shared seams (coordinator writes these before Wave 1)

### `packages/sim/src/internal.ts` (frozen)

```ts
import type {
  ControllerRef, DecisionRecord, Itinerary, Leg, PassengerSpec, QueuePlace, RouteId, RunResult,
  RunningMetrics, ScenarioDef, SimConfig, SimEvent, TownMap, Vec2,
} from './contracts';

/** A vehicle "mode" for queueing and boarding: a bus route or the train. */
export type Mode = RouteId | 'train';

// ---------- T1b passengers ----------
export interface TripPlanner {
  /** Choose the itinerary at spawn (spec §5.4). Walk legs use spec.walkSpeed. Pure + deterministic. */
  plan(spec: PassengerSpec): Itinerary;
  /** Patience check (spec §5.4). Return a walk leg from `from` to the destination door if walking now is
   *  cheaper than the remaining plan (+ switchPenaltyS), else null. The engine calls it at most once per passenger. */
  reconsider(spec: PassengerSpec, from: Vec2, waitedS: number, remaining: Leg[]): Extract<Leg, { kind: 'walk' }> | null;
}

// ---------- T1c metrics ----------
export interface CollectorInit {
  map: TownMap; scenario: ScenarioDef; seed: number; cfg: SimConfig;
  targetHeadwayS: (r: RouteId) => number;
}
export interface Collector {
  spawn(pid: number, t: number): void;
  /** Passenger joins a queue. `transferFrom` is the mode they just left (null if they walked from home).
   *  Returns a `missed_connection` event when a vehicle of an accepted mode left this place < missedWindowS ago. */
  queueJoin(pid: number, at: QueuePlace, accepts: Mode[], transferFrom: Mode | null, t: number): SimEvent | null;
  /** Returns a `transfer_made` event when wasTransfer. */
  board(pid: number, vehicleId: string, mode: Mode, at: QueuePlace, t: number, waitedS: number, wasTransfer: boolean): SimEvent | null;
  /** Counted once per (pid, place). Returns a `left_behind` event the first time. */
  leftBehind(pid: number, at: QueuePlace, mode: Mode, t: number): SimEvent | null;
  alight(pid: number, vehicleId: string, at: QueuePlace, t: number): void;
  walkaway(pid: number, at: QueuePlace, t: number): void;
  arrive(pid: number, t: number): void;
  departure(vehicleId: string, mode: Mode, at: QueuePlace, t: number, onboard: number, capacity: number): void;
  hold(vehicleId: string, at: QueuePlace, seconds: number, onboard: number, transfersExpected: number, t: number): void;
  decision(rec: DecisionRecord): void;
  distance(vehicleId: string, du: number, deadhead: boolean): void;
  trainDwell(seconds: number): void;
  /** Engine calls every 30 s for every stop and platform. */
  queueSample(t: number, at: QueuePlace, byMode: Partial<Record<Mode, number>>): void;
  running(): RunningMetrics;
  finalize(
    tEnd: number,
    unfinished: Array<{ pid: number; spawnT: number }>,
    meta: { controller: ControllerRef; simVersion: string; mapVersion: string; scenarioId: string; seed: number },
  ): RunResult;
}
```

### Stub signatures (coordinator creates; owners fill)

| File | Exports (exact) | Owner |
|---|---|---|
| `packages/sim/src/rng.ts` | `interface Rng { next(): number; int(lo: number, hi: number): number; range(lo: number, hi: number): number; normal(mean: number, sd: number): number; pick<T>(xs: readonly T[]): T; weighted<T>(xs: readonly T[], w: readonly number[]): T }` · `cyrb128(s: string): [number, number, number, number]` · `stream(seed: number, name: string): Rng` | M |
| `packages/sim/src/config.ts` | `DEFAULT_CONFIG: SimConfig` · `withConfig(p?: Partial<SimConfig>): SimConfig` | M |
| `packages/sim/src/map/geometry.ts` | `polyline(points: Vec2[], closed: boolean): Polyline` · `pointAt(poly: Polyline, dist: number): { x: number; z: number; heading: number }` · `nearestDist(poly: Polyline, p: Vec2): number` · `roundCorners(points: Vec2[], radius: number, closed: boolean, segments?: number): Vec2[]` · `distance(a: Vec2, b: Vec2): number` | M |
| `packages/sim/src/map/town.ts` | `TOWN: TownMap` · `stopById(m: TownMap, id: StopId): Stop` · `stationById(m: TownMap, id: StationId): Station` · `routeById(m: TownMap, id: RouteId): Route` · `zoneById(m: TownMap, id: string): Zone` | M |
| `packages/sim/src/map/roadGraph.ts` | `shortestPath(m: TownMap, fromNode: string, toNode: string): Polyline` · `deadheadPath(m: TownMap, from: RouteId, to: RouteId): Polyline` | M |
| `packages/sim/src/scenarios.ts` | `SCENARIOS: Record<ScenarioKind, ScenarioDef>` · `SEEDS: { train: ScenarioInstance[]; val: ScenarioInstance[]; showcase: ScenarioInstance[] }` · `playInstance(dayIndex: number): ScenarioInstance` · `scenarioDef(id: string): ScenarioDef` | M |
| `packages/sim/src/stub.ts` | `createStubSim(a: { map: TownMap; scenario: ScenarioInstance }): Sim` | M |
| `packages/sim/src/policy/features.ts` | `interface FeatureSpec { min: number; max: number; desc: string }` · `FEATURES: Record<DecisionKind, Record<string, FeatureSpec>>` · `PLACEHOLDERS: Record<DecisionKind, string[]>` | P |
| `packages/sim/src/policy/schema.ts` | `PolicySchema` (zod) · `type ValidationResult = { ok: true; policy: Policy } \| { ok: false; errors: string[] }` · `validatePolicy(input: unknown): ValidationResult` · `legalActionTypes(kind: DecisionKind): Action['type'][]` · `POLICY_DSL_DOC: string` (markdown for LLM prompts) | P |
| `packages/sim/src/policy/explain.ts` | `explain(say: string, features: FeatureVector, action: Action): string` | P |
| `packages/sim/src/policy/builtin.ts` | `G0: Policy` · `REF: Policy` · `EXAMPLE_G3: Policy` | P |
| `packages/sim/src/passengers/index.ts` | `generatePassengers(map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig): PassengerSpec[]` · `createTripPlanner(map: TownMap, cfg: SimConfig): TripPlanner` | T1b |
| `packages/sim/src/metrics/index.ts` | `createCollector(init: CollectorInit): Collector` · `canonicalHash(x: unknown): string` · `findingSentence(f: FailureFinding, clockStart: string): string` · `clockAt(clockStart: string, t: number): string` | T1c |
| `packages/sim/src/engine/index.ts` | `createSim(a: CreateSimArgs): Sim` · `runSync(a: CreateSimArgs & { controller: Controller }): RunResult` · `runAsync(a: CreateSimArgs): Promise<RunResult>` · `computeFeatures(kind: DecisionKind, ctx: FeatureContext): FeatureVector` · `type FeatureContext` (engine-defined, opaque to others) | T1a |
| `packages/sim/src/controllers/policy.ts` | `class PolicyController implements Controller { constructor(policy: Policy); readonly id: string; readonly policy: Policy; decide(dp: DecisionPoint, obs: Observation): Decision }` | T1a |
| `packages/sim/src/controllers/advisor.ts` | `interface DecisionProvider { choose(req: { instructions: string; situation: string; options: string[] }): Promise<{ index: number; probs: number[]; latencyMs: number }> }` · `class JevController implements AsyncController { constructor(policy: Policy, provider: DecisionProvider, opts?: { timeoutMs?: number; map?: TownMap }) }` · `situationText(dp: DecisionPoint, obs: Observation): string` · `holdOptions(policy: Policy, dp: DecisionPoint, cfg: SimConfig): Array<{ label: string; action: Action }>` | T6 |
| `apps/web/src/render/types.ts` | see T2 | T2 |

Barrel `packages/sim/src/index.ts` re-exports all of the above plus `contracts` and `internal`. Barrel `packages/evolve/src/index.ts` re-exports T4 + T6 modules.

---

## Wave 0b — foundation (2 agents, parallel; T2/T4/T5 part 1 run alongside)

### Task M: map, geometry, RNG, config, scenarios, scenery, stub sim

**Files:** fill `packages/sim/src/{rng,config,scenarios,stub}.ts`, `packages/sim/src/map/{geometry,town,roadGraph}.ts`; create `packages/sim/test/{rng,map,stub}.test.ts`, `packages/sim/scripts/map-svg.ts`, `apps/web/src/render/scenery.ts`; output `docs/map-preview.svg` + `docs/map-preview.png`.

**Produces:** the stub-table exports owned by M, plus:

```ts
// apps/web/src/render/scenery.ts
import type { StationId } from '@headway/sim';
export interface SceneryItem {
  kind: 'small' | 'tall' | 'hall' | 'clockTower' | 'stadium' | 'station' | 'tree' | 'lawn';
  x: number; z: number; rot?: number;          // rot in radians, multiples of π/2 for buildings
  w?: number; d?: number;                      // lawn size
  wall?: number; roof?: number; leaf?: number; // palette array indices
  scale?: number; stationId?: StationId;
}
export const SCENERY: SceneryItem[];
```

**Layout rules** (spec §4 topology table is binding):
- Bounds x −36…36, z −26…26. Campus NW (lawn, clock tower at `stop_old_main`, 2–3 halls), Downtown centre/east (6–8 small/tall blocks on a main street), Apartments SE (4–5 tall blocks), Stadium SW (bowl ≈ 10.8 × 8.4 u, `stop_stadium_gate` beside it).
- Rail loop: one rounded rectangle/oval, length 160–200 u, travel order `stn_stadium → stn_university → stn_central`, stations on the loop with platforms facing the town.
- Roads: graph of nodes/edges, rounded corners (radius ≈ 2 u), road width 2.4 u (visual). Route paths follow road edges, closed loops starting at the terminal, lengths 95–125 u.
- Stops sit ≤ 1.2 u from every serving route's path; each route's `stopDist` is strictly increasing and `stopDist[0] ≈ 0` (terminal). Station-paired stops are ≤ 4 u from their platform. `queueDir` points away from the road.
- 14–20 zones: doors 5–12 u from the nearest stop or platform (≤ accessRadius 14). Tags: campus halls `hall` (incl. Old Main), downtown `retail`, apartments `housing`, stadium `stadium` (≥ 3 gates), each station `station`.
- Route colours (palette A): r1 `#1FA99A`, r2 `#F0A830`, r3 `#8A6BD8`.
- `nominalLoopS = round(path.length / cfg.bus.speed + stops.length * 20)`; `advertisedHeadwayS = round(nominalLoopS / 2)`; `rail.advertisedHeadwayS = 360`.
- Scenery: buildings never overlap roads, rails or each other; every building module from the kit appears; trees sparingly; generous empty space.
- **General roads (user request):** besides the route roads, a believable street network — side streets per neighbourhood, 1–2 arterials, and 3–4 roads running off the board edges. Connected graph, no dead ends except board-edge exits. Buildings line the streets, doors facing roads. (Renderer drives visual-only ambient cars on all edges.)

**Scenarios** (spec §5.7): `stadium_exit` (1,200 stadium pulse at 600 s, ramp 120, decay 420; 45% apartments / 25% downtown / 15% campus / 15% central; + 300 background), `class_change` (2 × 350 from halls at 300 s and 1,500 s; + 200 background), `evening_commute` (stretch, define but simple). Seeds: train 1001–1004, val 2001–2002, showcase 4001–4003 (both main scenarios); `playInstance(d)` = stadium_exit, seed 50000 + d, split `play`.

**Stub sim:** contract-conformant fake for renderer/HUD development: buses loop their routes at `cfg.bus.speed` with ~10 s dwells at stops, the train loops with 45 s dwells, ~150 people spawn at zone doors, walk straight to the nearest stop, queue in slots along `queueDir`, and vanish when a serving bus dwells there (emit `board` events). `observe()` returns a plausible `Observation`; `result()` returns a plausible `RunResult`; `done` after 2,700 steps.

- [ ] Write `rng.test.ts`: same `(seed, name)` → same 5 values; different names differ; `int(1, 3)` only yields 1–3 and all three appear in 300 draws; mean of 10,000 `normal(0, 1)` within ±0.05.
- [ ] Write `map.test.ts`: every `StopId`, `StationId`, `RouteId` appears exactly once; stop-to-path ≤ 1.2; `stopDist` strictly increasing with `stopDist[0] < 0.01`; loop and rail lengths in range; every zone has a stop or platform within 14 u; `deadheadPath(TOWN, 'r1', 'r3')` starts ≤ 3 u from the r1 terminal stop and ends ≤ 3 u from the r3 terminal stop; all geometry inside bounds.
- [ ] Write `stub.test.ts`: 300 steps → snapshot has 6 buses + 1 train, bus `dist` changes, ≥ 1 walking and ≥ 1 waiting person; 2,700 steps → `done`.
- [ ] Run tests → fail; implement; run → pass. `pnpm --filter @headway/sim typecheck` passes.
- [ ] `pnpm --filter @headway/sim exec tsx scripts/map-svg.ts` writes `docs/map-preview.svg` (roads, rail, stations, labelled stops, route loops in route colours, zone doors, scenery footprints); render it to `docs/map-preview.png` with headless Chrome and look at it; fix anything cramped or overlapping.

### Task P: policy DSL, built-in policies, web fixtures

**Files:** fill `packages/sim/src/policy/{features,schema,explain,builtin}.ts`; create `packages/sim/test/policy.test.ts`, `apps/web/src/fixtures/{runResult,generations,evolveEvents,index}.ts`.

**Rules:** spec §6 exactly — semantics, validation list, feature whitelist and ranges, the complete example policy (`EXAMPLE_G3`), g0 and ref as described. `validatePolicy` returns every error as a short human/LLM-readable line (`rules[2].when[0].f: unknown feature "train_eta" for bus_at_stop`). `explain` replaces `{name}` with the feature value (integers as integers, else one decimal) or the resolved action parameter (`seconds`, `dwellS`, `to`); unknown placeholders stay verbatim. `POLICY_DSL_DOC` is a compact markdown description of the DSL (kinds, features with ranges, actions with bounds, semantics, validation limits, one example) for LLM prompts (≤ 5,000 chars).

**Fixtures:** typed, mutually consistent sample data for the HUD/Lab: one `RunResult` each for g0 / champion / human on stadium_exit seed 50000; `GENERATIONS: Generation[]` g0…g4 with J falling ~4–8% per generation and one rejected round; one `Round` with 3 `Proposal`s (valid, valid, invalid); `EVOLVE_EVENTS: EvolveEvent[]` for one full round. Use realistic findings and narratives (spec §8.4).

- [ ] Write `policy.test.ts`: G0, REF and EXAMPLE_G3 validate; rejection cases (unknown feature, value out of range, bad op, allocation not summing to 6, 25 rules, unknown placeholder, hold seconds 200 at a stop, `reassign` on `bus_at_stop`) each produce ≥ 1 error naming the path; `explain('Holding {seconds}s ({train_eta_s}s away)', { train_eta_s: 34 }, { type: 'hold', seconds: 45 })` → `'Holding 45s (34s away)'`.
- [ ] Run → fail; implement; run → pass; typecheck sim and web.

---

## Wave 1 — parallel tracks (after Wave 0b; T2/T4/T5 start their part 1 during Wave 0b)

### T1a: engine core + PolicyController

> **Early-engine lock protocol (coordinator, 15:30):** T1a/T1b/T1c were started early in a separate "engine" workflow. If `packages/sim/src/engine/.owner-early`, `packages/sim/src/passengers/.owner-early` or `packages/sim/src/metrics/.owner-early` exists when you start, that module is owned by the early agent: **do not edit anything in that directory**; report "deferred to early engine workflow" and stop. If the lock is gone and the module is no longer a stub, your job is only to verify it against the real `TOWN`, fix gaps you find in your own module, and finish.

**Owns:** `packages/sim/src/engine/**`, `packages/sim/src/controllers/policy.ts`, `packages/sim/test/{engine,golden,determinism,intents}.test.ts`, `packages/sim/test/fakes.ts`.
**Consumes:** contracts, internal (`TripPlanner`, `Collector`), `TOWN`, `SCENARIOS`, `withConfig`, `stream`, geometry, `deadheadPath`, `validatePolicy`, `explain`, `FEATURES`, `generatePassengers`, `createTripPlanner`, `createCollector` (T1b/T1c fill these in parallel — use `test/fakes.ts` until they land, then run against the real ones).
**Behaviour:** spec §5.1–5.6 exactly: tick order, dwell model, holds and budgets, terminals and layover cap, reassign + deadhead, train loop with `setTrainDeparture` and pre-drawn delays, decision-point resolution order (replay → human intent → controller), async pending, intents, `Replay` capture, feature computation per §6 whitelist (same numbers the HUD shows), `Observation`, `SimSnapshot` (people: walking/waiting with queue slots; riders omitted; arrived kept 3 s), `PassengerInfo.reason` ("Waiting for Route 2 — next bus in ~3 min" style), `RunResult` via the collector. `PolicyController.decide`: first matching applicable rule by priority, else defaults; explanation via `explain`; `ruleId` = rule id or `'default'`.
- [ ] Tests first: golden journey (spec §12, one passenger Apartments South → University via r2 + train, forced itinerary through an exported test hook `__forceItinerary`), determinism (two runs of stadium_exit seed 1001 with G0 → identical `hash`), hold clamping (`hold 500` → ≤ maxHoldS and per-loop budget), reassign illegal cases ignored → default, terminal layover auto-dispatch at 300 s, intent applies at next decision point, replay round-trip (run with intents → `replay()` → re-run → same hash), async controller halts `step()` until `resolve()`.
- [ ] Perf: stadium_exit full run with G0 < 400 ms in vitest (target 150 ms); log the time.
- [ ] Implement until green; `pnpm --filter @headway/sim typecheck` + `test` pass.

### T1b: passengers (demand, itineraries, choice, reconsideration)

**Owns:** `packages/sim/src/passengers/**`, `packages/sim/test/passengers.test.ts`.
**Behaviour:** spec §5.4 + §5.1 streams: `generatePassengers` draws everything up front from `stream(seed, 'demand')` and per-passenger `stream(seed, 'behavior:' + pid)`; sorted by `spawnT`, ids 0…n−1; demand scaled by the per-run `demandScale` draw. `createTripPlanner` precomputes candidate itineraries per (origin, dest) zone pair once (walk; one bus leg listing every route serving both stops; one train leg; one-transfer bus↔bus at a shared stop or bus↔train at a paired station), with stop/platform candidates within `accessRadius`. `plan` picks the min generalized cost using **advertised** headways only. `reconsider` per §5.4.
- [ ] Tests first: same seed → identical list; different seed → different; counts within ±1 of scaled totals; stadium pulse shape (most stadium spawns within 600–1,140 s); a downtown→apartments trip chooses r2 for a typical passenger; an apartments_south→university trip with maxTransfers 1 chooses r2 + train; a far-patient passenger never walks away, an impatient one near the destination does.
- [ ] Implement; typecheck + test pass.

### T1c: metrics, findings, hashing, sentences

**Owns:** `packages/sim/src/metrics/**`, `packages/sim/test/metrics.test.ts`.
**Behaviour:** implement `Collector` (internal.ts) per spec §5.4 counting rules and §7 objective: `J = Σ completed (arriveT − spawnT) + Σ unfinished ((tEnd − spawnT) + unfinishedPenaltyS)`; waits p95 via sorted array; effort totals; `StopStats` (max queue, mean wait, max gap per route); findings per §4 `FailureFinding` with `impactS` ranking (service_gap > 600 s, missed_transfer aggregated by place/from/to, bunching when headway < bunchingFraction × target, overload from left-behind + peak queue, unused_capacity when a route's mean departure load < 0.3 while another route's stop peaks > 40, long_hold for holds ≥ 30 s). `text` = `findingSentence(f, clockStart)` using the spec §8.4 templates with real stop/route names from the map. `canonicalHash` = FNV-1a 32-bit hex over JSON with sorted keys and numbers rounded to 3 decimals. `clockAt('21:30', 125)` → `'21:32'`.
- [ ] Tests first: J on a hand-built event sequence; p95; missed connection detected only inside the window and only for transfers; left-behind counted once per place; service gap finding with correct gap and affected count; sentences match the templates; hash stable under key reordering.
- [ ] Implement; typecheck + test pass.

### T2: TownRenderer (part 1 during Wave 0b, part 2 after)

**Owns:** `apps/web/src/render/**` except `scenery.ts` (Task M).
**Produces:**

```ts
// apps/web/src/render/types.ts
import type { RouteId, SimSnapshot } from '@headway/sim';
export type PaletteId = 'a' | 'b' | 'c';
export type DetailMode = 'min' | 'toy';
export type LightMode = 'day' | 'dusk';
export type Pick = { kind: 'bus' | 'train' | 'stop' | 'person'; id: string };
export interface TownRendererOptions { palette?: PaletteId; detail?: DetailMode; light?: LightMode }
export interface TownRendererApi {
  render(prev: SimSnapshot, next: SimSnapshot, alpha: number): void;
  pick(clientX: number, clientY: number): Pick | null;
  select(p: Pick | null): void;
  highlightRoute(id: RouteId | null): void;
  setPalette(p: PaletteId): void; setDetail(d: DetailMode): void; setLight(l: LightMode): void;
  /** world → CSS pixels relative to the canvas, for HTML overlays (queue markers, labels). */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  resize(): void; dispose(): void;
}
// apps/web/src/render/index.ts
export class TownRenderer implements TownRendererApi { constructor(canvas: HTMLCanvasElement, map: TownMap, opts?: TownRendererOptions) }
export * from './types';
```

- **Part 1 (no map needed):** port the kit from `.superpowers/wip/kit-sheet.html` into `render/kit/*.ts` (one builder per file family), `render/palettes.ts` (3 palettes, role registry recoloured in place), `render/materials.ts`; camera rig (orthographic isometric, pan + zoom only, damping, zoom-to-cursor), lights, shadows, dusk mode (emissive windows, vehicle lights, stadium floodlights). Dev page `apps/web/render-dev.html` + `src/render/dev.ts` that shows the kit on a board (like the kit sheet) — for visual checks.
- **User visual feedback on the kit sheet (binding):**
  - **Palette A "Wooden Toy" is the default** (B and C stay switchable).
  - "A little more detailed and proportional": default detail = `toy`; add tasteful small details (window frames/sills, door canopies, roof trims, chimneys, rooftop units, awnings) — never fussy. Consistent scale: person ≈ 0.8 u tall, door ≈ 1.0 u, one storey ≈ 1.1 u, bus ≈ 3.3 × 1.25 u footprint.
  - **Buses are too tall:** lower and longer — total height ≈ 1.1 u including wheels (was ≈ 1.45), body ≈ 0.8 u, footprint ≈ 3.3 × 1.25; rounded front cap, wheel arches, window band with thin pillars, destination display, route-colour stripe, front door. Keep it readable from the game camera.
  - **Better trees:** ≥ 5 variants built from primitives — round deciduous, 2–3 sphere cluster, layered pine (stacked cones), columnar poplar, low bush/hedge — with per-instance size and colour jitter; rendered as InstancedMeshes per variant.
  - **More building types:** ≥ 8 modules from the same primitives and roles: small shop (awning), tall apartment block, campus hall (pitched roof + portico), gabled house with chimney, row of 3 townhouses (varied roof colours), corner café (striped awning, tiny tables), brick mid-rise dorm (flat roof, rooftop garden), library/chapel landmark (columns or a small dome/spire). Variants via palette indices.
  - Bus stop, station, train and people are approved as they are.
  - Static scenery must stay cheap: merge static geometry per material (`BufferGeometryUtils.mergeGeometries`) or instance it, so the whole static town is < 80 draw calls.
  - **PUBLISH "kit-v2"** as soon as the improved kit renders on the dev page (palette A, toy detail) so the user can review it while other tracks continue; then continue part 1.
- **Part 2 (needs TOWN, SCENERY, stub sim):** static town from `TOWN` + `SCENERY` (board slab, roads as flat strips with rounded corners from road edges, rail loop with ties as one InstancedMesh, stations, stops with route chips, landmarks, lawns, trees as InstancedMesh, route ribbons offset side by side on shared roads); dynamic layer per spec §10: 6 buses + 2-car train positioned by `pointAt` with interpolation (wrap on closed paths), people as two InstancedMeshes (body, head; tint palette), walking interpolated by `t0/t1`, waiting in queue slots along `queueDir`, small bounce while walking, board = 1 s walk-to-door then hide, arrived fade 3 s; `pick` via raycast (vehicles, stops, people instanced id); `select` = soft outline/raise + ring; `highlightRoute` lerps other routes and scenery 60 % toward the background; dev page switches to the full town driven by `createStubSim`.
- **Look-dev (user: "as aesthetic as can be", shaders welcome) — part 1 builds the pipeline, part 2 applies it to the town:**
  - Post chain (classic `EffectComposer`): RenderPass → GTAOPass (soft contact darkening) → gentle tilt-shift (miniature effect, focus band at screen centre) → UnrealBloomPass (dusk only; emissive windows, lamps, headlights) → warm grade pass (lift, slight saturation, soft vignette, faint grain) → OutputPass → SMAA.
  - Materials: shared `onBeforeCompile` "clay" tweak on all kit materials (wrap diffuse, subtle camera rim, height-based ambient darkening near the ground); soft shadows fitted to the board; gradient sky backdrop and a blurred drop shadow under the board slab.
  - Part 2 town shaders: route ribbons with animated dashes flowing in travel direction (highlighted route glows, others desaturate), gentle wind sway on tree crowns (instanced vertex shader, phase per instance), subtle procedural colour variation on the board/lawns (no textures needed), clock-tower hands driven by the sim clock, street lamps that glow at dusk, people bob in the vertex shader.
  - `setQuality('high' | 'low')`; auto-downgrade to low when frame time stays > 22 ms for 2 s. Must still render in headless SwiftShader.
- **Ambient traffic (user request, part 2):** 14–24 visual-only cars (kit `makeCar` variants, palette role `car`) driving on **all** road edges: at each node pick the next edge with a seeded PRNG (renderer-local mulberry32 seeded by the scenario seed — never `@headway/sim` streams), no U-turns, ease through corners, keep ≥ 2.5 u spacing behind any car or bus ahead on the same edge, enter/leave via board-edge roads. More cars near the stadium after the advertised closing time. Cars never affect the sim or the score. One InstancedMesh per car variant (≤ 3 draw calls); headlights at dusk.
- [ ] Test: `apps/web/src/render/__tests__/project.test.ts` (pure helpers only: interpolation of `dist` with wrap; queue slot positions; traffic step keeps spacing and never leaves the road graph) — vitest, no WebGL.
- [ ] Visual verification: headless Chrome screenshots of the dev page (palettes a/b/c, day + dusk) read back and judged; 60 fps target (≤ 10 dynamic draw calls); zero console errors.
- [ ] `pnpm --filter @headway/web typecheck` + `build` pass.

### T3: app shell, store, runner, HUD, modes

**Owns:** `apps/web/index.html`, `apps/web/src/{main.tsx,App.tsx}`, `apps/web/src/{state,sim,ui,modes,api,styles}/**`, `apps/web/public/data/**` (dev fallbacks), `apps/web/src/**/__tests__/` for these.
**Consumes:** `TownRenderer` (T2 — mount it if `apps/web/src/render/index.ts` exports a working class; otherwise render a plain placeholder canvas and keep going), fixtures (Task P), `createStubSim`, later `createSim`/`runSync` (T1a), `PolicyController`, `G0`.
**Produces:**

```ts
// apps/web/src/sim/runner.ts
export type Speed = 1 | 4 | 8 | 16;
export class SimRunner {
  constructor(create: () => Sim, speed?: Speed);
  readonly sim: Sim; prev: SimSnapshot; next: SimSnapshot; alpha: number; speed: Speed; paused: boolean;
  setSpeed(s: Speed): void; pause(): void; resume(): void; reset(create: () => Sim): void;
  /** Advance by real seconds: steps = floor(acc * speed), max 64 per frame; snapshot once per frame. */
  frame(dtS: number): void;
  intent(i: Intent): void;
}
// apps/web/src/api.ts — every call falls back to /data/*.json when /api fails
export function fetchChampion(): Promise<{ policy: Policy; generation: Generation | null }>;
export function fetchGenerations(): Promise<{ generations: Generation[]; rounds: Round[] }>;
export function streamEvolve(token: string, onEvent: (e: EvolveEvent) => void): Promise<void>;
export function fetchLeaderboard(seed: number): Promise<Array<{ name: string; j: number; verified: boolean }>>;
export function submitRun(name: string, replay: Replay): Promise<{ ok: boolean; j?: number; error?: string }>;
```

- **Store (zustand):** mode, speed, paused, palette/detail/light, highlighted route, selection, HUD metrics (updated at 4 Hz, never per frame), inspector payload, toasts. Snapshots never go into React state.
- **HUD:** spec §10 — top bar (Gumball wordmark, Watch · Play · Lab tabs, scenario chip with clock via `clockAt`, speed chips, metrics), route legend chips (toggle highlight), queue markers (HTML overlay positioned with `renderer.project`, count + longest wait text + severity colour), inspector card (vehicle / stop / person per spec), toasts (transfer made, missed connection, walkaway), dispatcher dock in Play (Dispatch · Hold 30 s · Reassign ▸ · Set train departure; enabled only when legal from `Observation`).
- **Modes:** Watch (champion via `fetchChampion` → `PolicyController`; until T1a lands use `createStubSim`; controller switcher g0 / ref / champion); Play (stadium_exit play seed, start → dispatch → Finish fast-forward → results screen You / Champion / Baseline from the headless Web Worker `sim/headless.worker.ts` → name + submit); Lab (timeline, J_train/J_val SVG chart with g0 and ref lines, proposal cards, rule diff, "Replay on stadium exit", "Evolve next generation" with token prompt and live `EvolveEvent` feed, sealed panel labelled "never shown to agents").
- **Play mechanics (user priority — must feel like a real, fair game):**
  - **Goal card** at start: "Get the stadium crowd home. Beat the AI dispatcher." Shows the advertised closing time, your fleet (6 buses, 1 train) and the 4 controls; a 3-step coach-mark tour (click a bus → choose an action; watch queue markers; time the train). Skippable, remembered in localStorage.
  - **Fairness:** you play exactly the baseline (g0) plus your interventions on the same seed the champion and the baseline are scored on. Doing nothing = the baseline score. Same information as the AI: everything shown comes from `Observation` (no future events).
  - **Controls:** click a bus/train or press keys — `D` dispatch, `H` hold (30 s; `Shift+H` 60 s), `R` reassign (opens r1/r2/r3 picker; shows the deadhead path), `T` set train departure (+30 s / depart now). Space pauses; 1/2/3/4 set speed 1×/4×/8×/16×. Disabled actions explain why (tooltip: "Only at a terminal"). Pending intents show as a small badge on the vehicle until applied; holds show a ring timer.
  - **Live pace vs AI:** at start the Web Worker runs the champion and g0 on the same seed while sampling `observe().running` every 30 sim-s; the top bar shows a pace chip "You vs AI at 21:41: +6.2 pax-h" (green when ahead) using `jSoFar`.
  - **Alerts** (toasts, rate-limited): "Stadium closing in 2:00", "Apartments South: 8 min without a bus", "Train arriving Central with 23 transfers", "Bus b4 full — 12 left behind".
  - **Results screen:** You / Champion / Baseline side by side — J as passenger-hours and mean journey minutes, mean & p95 wait, completion %, missed connections, walkaways, effort. A verdict line ("You beat the baseline by 7% — the AI by 2%" / "The AI wins by 5%"). "What made the difference": top 3 findings where you and the champion differ most (reuse `findingSentence`). Your interventions timeline (each intent and its result). Buttons: Watch the AI on this crowd · Play again · Submit to leaderboard (name).
  - Session length ≈ 3–4 real minutes at the default 8× with Finish fast-forward.
- **Styling (user: "as aesthetic as can be"):** palette-driven CSS variables (match the renderer palette), one token set for radii/spacing/shadows, rounded chips and cards with soft depth, Gumball for system text. Motion: 150–250 ms ease-out for panels/toasts, springy number tickers for metrics, no layout jank, respects `prefers-reduced-motion`. Before building the HUD, invoke the `emil-design-eng` skill (UI polish principles) and apply it. Nothing should look like default browser UI.
- [ ] Tests first: `SimRunner.frame` step accounting (speed 8, dt 0.5 s → 4 steps; cap 64), store selectors, rule-diff helper (`diffPolicies(a, b)` → added/removed/changed rules and params), api fallback (mock fetch failing → reads `/data`).
- [ ] Implement; `typecheck`, `test`, `build` pass; headless screenshot of Watch / Play / Lab with the stub sim; zero console errors.

### T4: evolve (part 1 during Wave 0b, part 2 after)

**Owns:** `packages/evolve/src/**` except `src/jev/**`; `packages/evolve/test/**`; `data/generations/**`, `data/rounds/**`; writes `apps/web/public/data/{champion,generations}.json` from the CLI only.
**Produces:**

```ts
// llm.ts
export interface LlmRequest { model: string; system: string; user: string; temperature?: number; maxTokens?: number; json?: boolean; timeoutMs?: number }
export interface LlmResponse { text: string; latencyMs: number; model: string; provider: string }
export interface LlmClient { complete(req: LlmRequest): Promise<LlmResponse> }
export function createOpenAICompatClient(o: { baseUrl: string; apiKey: string; provider: string; headers?: Record<string, string>; fetchImpl?: typeof fetch }): LlmClient;
/** Calls primary; on timeout/429/5xx/network error calls fallback with `fallbackModel`. */
export function withFallback(primary: LlmClient, fallback: LlmClient, fallbackModel: string): LlmClient;
// extract.ts
export function extractJson(text: string): unknown | null;   // strips fences, first balanced {...}
// prompts.ts
export function designerSystemPrompt(): string;               // role + POLICY_DSL_DOC + output contract
export function designerUserPrompt(a: { emphasis: Emphasis; champion: Policy; digest: string }): string;
export function repairPrompt(errors: string[]): string;
// digest.ts
export function buildDigest(a: { champion: { policy: Policy; results: RunResult[] }; baseline: SplitScore; reference: SplitScore; history: Proposal[] }): string; // ≤ 6,000 chars
// evaluate.ts
export function evaluatePolicy(policy: Policy, instances: ScenarioInstance[]): { score: SplitScore; results: RunResult[] };  // runSync + PolicyController
// narrative.ts
export function proposalNarrative(candidate: RunResult[], champion: RunResult[], deltaTrainPct: number): string;
// round.ts
export interface EvolveStore {
  champion(): Promise<Generation>; history(limit: number): Promise<Proposal[]>; nextRoundNumber(): Promise<number>;
  saveRound(r: Round): Promise<void>; saveGeneration(g: Generation): Promise<void>;
}
export interface RoundDeps {
  llm: LlmClient; model: string; store: EvolveStore; emit(e: EvolveEvent): void; now(): string;
  evaluate(policy: Policy, split: 'train' | 'val'): Promise<{ score: SplitScore; results: RunResult[] }>;
  temperatures?: [number, number, number];
}
export function runRound(deps: RoundDeps): Promise<{ round: Round; generation: Generation | null }>;
// store-file.ts (Node only, imported by cli)
export function createFileStore(dir: string): EvolveStore;
```

- **Part 1:** `llm.ts`, `extract.ts`, `prompts.ts` (using `POLICY_DSL_DOC` once Task P lands; stub string until then), `round.ts` against a fake `evaluate` + fake `LlmClient`, `narrative.ts`, `digest.ts`. Tests: extraction from fenced + prose responses; repair path (invalid → repair → valid); one designer throwing does not fail the round; promotion rule (spec §7: ≥ 1 % train gain, val not worse, completion −1 pt max, gap guard; second-best gets one val attempt); events emitted in order; temperatures/emphases rotate per spec §8.2.
- **Part 2:** `evaluate.ts` with real `runSync` (once T1a lands — until then keep the fake), `store-file.ts`, `cli/evolve.ts` (`pnpm evolve --rounds N [--publish <url>]`, reads `.env`, Luminal primary `https://flash.luminal.cloud/v1` model `deepseek-ai/DeepSeek-V4.1-Flash`, OpenRouter fallback `deepseek/deepseek-v4-pro`, `response_format json_object`, maxTokens 8,000; writes `data/` and `apps/web/public/data/`), `cli/sim-run.ts` (`pnpm sim:run --policy g0|ref|<file> --scenario stadium_exit --seed 1001` prints metrics). One live smoke: a single designer call to Luminal that returns a policy which validates (print summary only).
- [ ] typecheck + test pass.

### T5: Worker API (part 1 during Wave 0b, part 2 after)

**Owns:** `apps/worker/src/**`, `apps/worker/test/**`, `apps/worker/migrations/**` (0001 exists — add new migrations only if needed).
**Endpoints:** spec §11 table exactly. `Env` type: `DB: D1Database; ASSETS: Fetcher; SIM_VERSION: string; LUMINAL_BASE_URL: string; LUMINAL_MODEL: string; OPENROUTER_BASE_URL: string; JEV_MODEL: string; LUMINAL_API_KEY: string; OPENROUTER_API_KEY: string; ADMIN_TOKEN: string; SEALED_TEST_SEEDS?: string`.
- **Part 1:** Hono app structure (`routes/{public,evolve,leaderboard,jev,admin}.ts`, `db.ts` with typed row mappers), `GET /api/champion` + `/api/generations` + `/api/generations/:id` reading D1 (fall back to G0 when empty), `POST /api/admin/publish` (Bearer ADMIN_TOKEN; upserts rounds/proposals/generations), `POST /api/jev/decide` proxy to `${OPENROUTER_BASE_URL}/systemone` (validate body: instructions ≤ 1,200 chars, situation ≤ 1,500, 2–8 options; Cache API by SHA-256 of body; simple per-IP limit via the Cache API or an in-memory map), CORS for local dev.
- **Part 2:** `POST /api/evolve` (NDJSON stream of `EvolveEvent` from `runRound` with a D1-backed `EvolveStore`; lock via `rounds.status = 'running'`, stale after 10 min), `GET/POST /api/leaderboard` with server re-simulation via `runSync` (verify `simVersion`, `mapVersion`, play seed within last 7 days, name rule), `/api/admin/sealed-eval` + `/api/sealed`.
- [ ] Tests with `@cloudflare/vitest-plugin` (or Hono `app.request` with a mocked env if the pool fights the workspace): endpoint shapes, admin auth 401, publish → generations round-trip, jev proxy validation 400s.
- [ ] `pnpm --filter @headway/worker typecheck` + `test` pass; `wrangler deploy --dry-run` passes. (Coordinator does real deploys.)

### T6: Jev station holds

**Owns:** `packages/sim/src/controllers/advisor.ts`, `packages/sim/test/advisor.test.ts`, `packages/evolve/src/jev/**`, `packages/evolve/test/jev.test.ts`.
**Behaviour:** spec §9. `JevController.decide`: if `policy.advisor?.enabled`, `dp.kind === 'bus_at_stop'`, the stop is a station stop, and `advisor.askWhen` conditions hold → build `situationText` + `holdOptions` (from `advisor.holdOptionsS`, default `[0, 20, 40, 60]`, clamped by limits; label `'Depart now'` / `'Hold 20 s'`) → `provider.choose` with `advisor.instructions` → argmax (ties → lowest index) → `Decision` with source `'jev'` and explanation `Jev chose Hold 40 s (p 0.71)`. Timeout (default 800 ms) or error → `new PolicyController(policy).decide` with source `'fallback'`. Otherwise delegate to `PolicyController` (source unchanged).
`packages/evolve/src/jev/provider.ts`: `createJevProvider({ baseUrl, apiKey, model, fetchImpl? }): DecisionProvider` (POST `${baseUrl}/systemone`, body `{ model, state: { situation, operating_instructions }, questions: { decision: { type: 'choice', instructions: 'Which option should dispatch choose now to follow operating_instructions?', criteria: { o0: label0, o1: label1, … } } } }`, map `answers.decision` → index/probs); `withCache(p: DecisionProvider): DecisionProvider` (in-memory, key = SHA-256 via `crypto.subtle`). `packages/evolve/src/jev/compare.ts` + `cli/jev-compare.ts`: rules-only champion vs Jev fixed generic instructions vs Jev evolved instructions on stadium_exit × 2 train seeds → `data/jev-compare.json`.
- [ ] Tests first (fake provider): asks only at station stops under askWhen; argmax + tie rule; timeout → fallback; explanation text; provider request body shape (mock fetch) and response mapping.
- [ ] Implement; typecheck + test pass. One live smoke call through OpenRouter (print choice + probabilities only).

---

## Wave 1 integration (coordinator + 1 integration agent)

> If any `packages/sim/src/{engine,passengers,metrics}/.owner-early` lock exists, the early engine workflow is still running: integrate everything else (web, worker, evolve, renderer) against the engine's signatures, do not edit those three directories, and list what remains for the coordinator.

- [ ] `pnpm -r typecheck` and `pnpm test` green across the workspace; fix cross-track seams (only via the owners' files; contracts unchanged).
- [ ] §12 sanity gates on train: `ref` beats `g0` by ≥ 5 % J; g0 stadium_exit completion ≥ 85 %; g0 has ≥ 1 service gap > 10 min and ≥ 10 missed connections; stadium_exit run < 150 ms. Tune `SCENARIOS` totals / `DEFAULT_CONFIG` if not (report changes).
- [ ] **Baseline must be respectable (user priority):** g0 keeps even headways via terminal holds with a 2/2/2 allocation and never strands a route; check its per-route headway spread and bunching on class_change and stadium_exit. If g0 behaves like a strawman (absurd waits, a route with no service, completion < 85 %), fix g0's rules — not the sim — and report the change. A thoughtful human should be able to beat g0 by 3–10 %; the champion should be hard but beatable.
- [ ] **Play is winnable and fair:** run g0 + a scripted "sensible human" intent list (pre-stage one r1 bus to r3 before closing, hold the r2 bus at Central for the first post-closing train) on the play seed and confirm it beats g0; confirm doing nothing reproduces g0's J exactly.
- [ ] Web: Watch runs the **real** sim with G0; golden journey visible; screenshot.
- [ ] **Checkpoint B** to the user: screenshot + first real Luminal proposal summary + API URL.

## Wave 2 preview — art-direction loop (after integration)

A dedicated look-dev workflow: an "art director" agent screenshots Watch (day + dusk, palette A, three zoom levels) and the HUD, writes a ranked critique (composition, proportion, colour harmony, readability of vehicles/people/queues, clutter, post-processing artefacts), a "renderer" agent fixes the top items, repeat until two consecutive critiques find nothing above "minor". Every iteration publishes before/after screenshots for the user.

---

## v2 parallel split (supersedes ownership in T2 and T3 above; their requirements still apply)

**Restart note:** the first workflow was stopped at 14:56 and checkpointed (`git log`: "wip: wave 0b/1 partial progress"). Foundation agents **continue from the files on disk**: read what exists, keep what is good, finish the rest. Two duplicate agents briefly collided in `apps/web/src/render/**` and possibly `packages/sim/src/map/**`; T2.1 and M reconcile those files into one coherent design (e.g. `render/__tests__/kit.test.ts` and `project.test.ts` import `../bake`, `../kit`, `../interp`, which do not exist).

**New seams (coordinator wrote them; owners may extend, never break):** `apps/web/src/state/store.ts` (zustand `useApp`), `apps/web/src/state/frame.ts` (per-frame `frame.runner` / `frame.renderer`), `apps/web/src/sim/runner.ts` (`SimRunner`, working), `apps/web/src/render/layers.ts` (`RenderLayer`, `FrameContext`), stub components (`ui/hud/*`, `modes/{watch,play,lab}/*`, `ui/landing/Landing.tsx`, `ui/about/AboutPanel.tsx`), stub layers `render/traffic/index.ts` (`createTrafficLayer`) and `render/fx/index.ts` (`createTownFxLayer`).

### Renderer split
| Track | Owns | Starts after | Delivers |
|---|---|---|---|
| T2.1 kit + look | `render/kit/**`, `render/palettes.ts`, `render/materials.ts`, `render/post/**`, `render/camera.ts`, `render/lights.ts`, `render/dev.ts`, `apps/web/render-dev.html`, `render/__tests__/kit.test.ts` | now | kit per user feedback (lower buses, ≥ 5 trees incl. sway material variant, ≥ 8 building types, 3 car variants, palette role `car`), Wooden Toy default, look pipeline (post chain, clay material tweak with shared `uTime`/`uSimT` uniforms, gradient sky, board drop shadow, quality tiers). PUBLISH "kit-v2", then "look-v1-day" / "look-v1-dusk". Final message lists every exported builder and its signature. |
| T2.2 town composition | `render/index.ts` (TownRenderer), `render/town/**` (static town from TOWN + SCENERY, merged/instanced), `render/dynamic/**` (buses, train, people, picking, select, highlight), `render/__tests__/project.test.ts` | T2.1 + M | TownRenderer per spec §10 composing static town, dynamic layer, `createTrafficLayer`, `createTownFxLayer`; drives shared uniforms. PUBLISH "town-3d-day" / "town-3d-dusk". |
| T2.3 traffic | `render/traffic/**` | T2.1 + M | ambient cars per the T2 traffic bullet. |
| T2.4 town FX | `render/fx/**` | T2.1 + M | route ribbons (T2.2 draws none) with flowing dashes + highlight glow/desaturate, street lamps (dusk glow), clock-tower hands from `simT`, stadium floodlight cones at dusk, subtle procedural board/lawn variation decal, a small celebratory confetti burst over the stadium at the advertised closing time. |

### App split
| Track | Owns | Delivers |
|---|---|---|
| T3a shell | `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/**`, `src/state/**`, `src/sim/**`, `src/api.ts`, `src/modes/watch/**`, `src/ui/shell/**`, `public/data/**` | canvas host (rAF: `runner.frame` → `renderer.render`; 4 Hz `setHudFeed`; event → toasts), top bar frame (wordmark, tabs, slots for T3b components), routing `/` `/play` `/lab`, Watch mode, api with `/data` fallbacks, `window.__headway = { t, mode, ready }` for smoke tests, design tokens. Mounts every T3b/T3c/T3d/T7 component. |
| T3b HUD | `src/ui/hud/**` | MetricsCluster, SpeedControls, ScenarioChip, RouteLegend, QueueMarkers, Inspector, Toasts, `alerts.ts` (observation → alert toasts, rate-limited) |
| T3c Play | `src/modes/play/**` | everything in "Play mechanics" above, incl. `headless.worker.ts` (champion + g0 runs on the play seed with pace sampling), results screen, leaderboard panel, keyboard controls, coach marks |
| T3d Lab | `src/modes/lab/**` | timeline, J chart (SVG), proposal cards, `diffPolicies` + diff view, evolve feed (`streamEvolve`), sealed panel, replay-generation |
| T7 story | `src/ui/landing/**`, `src/ui/about/**`, `docs/demo-script.md`, `docs/pitch.md`, `README.md` | landing title card + about panel (precise claims: evolves the dispatch policy, not the model; DeepSeek designers on Luminal; Jev for station holds; sealed test never shown to agents), 4-minute demo script with fallbacks, pitch, README with run/deploy commands |

### Tooling tracks
| Track | Owns | Delivers |
|---|---|---|
| T8 eval CLIs | `packages/evolve/src/cli/{eval-sealed,export-web,sweep,verify-leaderboard}.ts`, `packages/evolve/test/cli-*.test.ts` | `sweep` (policies × scenarios × seeds → metrics table, for tuning), `export-web` (data/ → `apps/web/public/data/{champion,generations}.json`), `eval-sealed` (seeds from `SEALED_TEST_SEEDS` in `.env`, generating 3 random seeds into `.env` if absent; evaluates champion/g0/ref; POSTs to `/api/admin/sealed-eval`), `verify-leaderboard`. Run via `pnpm --filter @headway/evolve exec tsx src/cli/<name>.ts`. |
| T9 smoke | `scripts/smoke/**` | dependency-free smoke harness (Node 26 + Chrome DevTools Protocol over the global WebSocket): launches headless Chrome, visits `/`, `/play`, `/lab` on a given base URL, fails on console errors or a blank canvas (pixel sample), waits for `window.__headway.ready`, checks sim time advances, saves screenshots to `.superpowers/wip/smoke/`. `node scripts/smoke/run.mjs --url <base>`. |

---

## v3 town art (user: "the buildings, trees, paths — everything needs a lot of work; use more agents")

**Architecture (seams written by the coordinator, all under `apps/web/src/render/`):**
- `assets/types.ts` — `PlacedAsset`, `AssetDef { kind, family, footprint, height, build(k, params), instanced?, sway? }`, `KitContext` (`mat(role, idx)`, `rbox`, `cyl`, `sphere`, `cone`, `detail`, `rand`), `RoleColors`.
- `assets/catalog.ts` — **the shared catalog** of every kind with footprint (w × d at rot 0, front faces +z) and height. Families implement exactly these kinds; districts place only these kinds. Unknown/unimplemented kinds render as pink placeholder boxes.
- `assets/registry.ts` (`AssetRegistry`), `assets/index.ts` (`createRegistry()`), `assets/basicKit.ts` (`createBasicKit` for previews/tests), `assets/validate.ts` (`validatePlacements(map, items)`).
- `assets/families/{downtown,campus,residential,landmarks,vegetation,street}.ts` — each exports `ROLES` (extra palette roles, colours for palettes a/b/c) and `register(r)`.
- `districts/types.ts` (`DistrictScenery { id, region, items, paths, areas }`), `districts/{campus,downtown,apartments,stadium,outskirts}.ts`, `districts/index.ts` (`DISTRICTS`).
- `streetscape/index.ts` — `createStreetscapeLayer(map, districts)`.
- Preview pages (Vite dev): `/assets-dev.html?family=<id>` (grid of a family) and `/districts-dev.html?d=<id>` (roads/rail strips + one district).

**Quality bar for every art track:** a beautiful, coherent toy diorama in the Wooden Toy palette — rounded primitives only, consistent scale (person ≈ 0.8 u, door ≈ 1.0 u, storey ≈ 1.1 u), soft colour variety from palette roles, tasteful small details marked with `k.detail`, nothing fussy or noisy. Match `.superpowers/wip/kit-sheet.html` and T2.1's `kit-v2` when it is published. Budgets: buildings ≤ 3,000 triangles, landmarks ≤ 8,000, vegetation and street furniture ≤ 600 (they are instanced). Every asset's bounding box stays within its catalog footprint (±10 %) and height (±25 %).

### Asset family tracks (start immediately)
| Track | Owns | Delivers |
|---|---|---|
| A1 downtown | `assets/families/downtown.ts` (+ helper files `assets/families/downtown/**`), tests `src/render/__tests__/assets-downtown.test.ts` | every `dt.*` kind; red-brick college-town main street, varied facades, awnings, signs as shapes |
| A2 campus | `assets/families/campus.ts`, `assets/families/campus/**`, `__tests__/assets-campus.test.ts` | every `cp.*` kind; Georgian brick + limestone, white trim, porticos, a dome, a spire |
| A3 residential | `assets/families/residential.ts`, `assets/families/residential/**`, `__tests__/assets-residential.test.ts` | every `res.*` kind; balconies, porches, playground, parking |
| A4 landmarks | `assets/families/landmarks.ts`, `assets/families/landmarks/**`, `__tests__/assets-landmarks.test.ts` | every `lm.*` kind; the stadium must be a showpiece (tiers, scoreboard, light towers, gates, banners) |
| A5 vegetation | `assets/families/vegetation.ts`, `assets/families/vegetation/**`, `__tests__/assets-vegetation.test.ts` | every `veg.*` kind, `instanced: true`, crowns `sway: true`; per-instance variety via `k.rand()` |
| A6 street | `assets/families/street.ts`, `assets/families/street/**`, `__tests__/assets-street.test.ts` | every `st.*` kind, `instanced: true` where possible; lamp heads use role `lamp` (FX makes them glow) |

Each asset track: write the test first (all family kinds registered; `build` with `createBasicKit()` does not throw; bounding box within footprint/height tolerances; triangle budget), implement, then screenshot `/assets-dev.html?family=<id>` and PUBLISH "assets-<id>". Iterate on looks until it is genuinely charming.

### District + streetscape tracks (start after the asset tracks)
| Track | Owns | Delivers |
|---|---|---|
| D1 campus | `districts/campus.ts`, `__tests__/district-campus.test.ts` | the campus: lawn quad with criss-cross footpaths, clock tower as focal point, halls/library/chapel/dorms framing the quad, many trees, benches, lamps, flags |
| D2 downtown | `districts/downtown.ts`, `__tests__/district-downtown.test.ts` | dense main street with continuous storefront rows, corner buildings, café tables, planters, lamps, bike racks, a small plaza with a fountain |
| D3 apartments | `districts/apartments.ts`, `__tests__/district-apartments.test.ts` | towers + garden apartments + townhouses, parking lots, playground, hedges, trees |
| D4 stadium + rail | `districts/stadium.ts`, `__tests__/district-stadium.test.ts` | stadium showpiece with gates and parking, flags, station buildings (`lm.stationCentral` at Central, `lm.stationHalt` at University and Stadium) aligned to platforms, level crossings at every road/rail crossing, rail signals |
| D5 outskirts | `districts/outskirts.ts`, `__tests__/district-outskirts.test.ts` | everything outside the four neighbourhoods: tree belts along arterials and board edges, a few houses, water tower, fields/gardens as areas, hedges and fences — the town should feel like it continues past the board |
| S1 streetscape | `streetscape/**`, `__tests__/streetscape.test.ts` | sidewalks + curbs along every road edge, zebra crosswalks at intersections near stops, district `paths` as footpaths, `areas` as lawn/plaza/parking/sports/garden surfaces (parking with painted lines), merged into few draw calls |

Each district track: region consistent with `TOWN.neighborhoods`; keep 2 u clear around stops, platforms and their queue lines (`queueDir`); fronts face streets; generous breathing room; a test asserting `validatePlacements(TOWN, items)` returns no errors. Screenshot `/districts-dev.html?d=<id>` and PUBLISH "district-<id>".

### T2.2 change (supersedes its v2 row where they differ)
T2.2 composes: base `SCENERY` (Task M) only where no district provides items (districts in order campus, downtown, apartments, stadium, outskirts), every `DISTRICTS` item through `createRegistry()` with a **clay-material KitContext adapter** backed by T2.1's materials/palettes (the same roles; unknown roles from `registry.roles`), static meshes merged per material and `instanced` assets drawn as InstancedMeshes (vegetation with the shared sway tweak), plus `createStreetscapeLayer`, `createTrafficLayer`, `createTownFxLayer`. T2.2 does not author art.

---

## Art notes from coordinator review (apply in T2.2 / T2.4 / the art-direction loop)

- **kit-v2 (15:35):** big step up — lower/longer buses, 9 building types, 5 trees, 3 cars, soft shadows, tilt-shift. Fix next:
  - Windows read as heavy navy holes: use a lighter slate-blue glass (`window` ≈ #4A6380) with thin white frames/sills (`trim`), and a faint sky reflection gradient in the clay shader; dusk keeps them emissive.
  - Tilt-shift is a touch strong at full-board zoom: keep the focus band wide at the default game camera and fade the effect out when zoomed out past the board.
  - Slightly more contrast/saturation in the grade at full-board zoom (colours wash out when small).
  - The kit's stadium is the weakest piece (inner ring reads as water, a pole stands in the field): superseded by A4's `lm.stadium` — make sure the composer uses A4's.
  - Roads are plain strips: streetscape (S1) adds sidewalks/curbs/crosswalks; keep the dashed centre line subtle.
- **Play screens (15:45):** goal card, dock (bus chips, hold/reassign picker with deadhead path, pending-intent badges) and results (You / AI / Baseline, verdict, race chart, "what made the difference", interventions timeline, leaderboard) are excellent. Integration fixes: "What made the difference" shows raw ids (`stop_apts_south`) — use map display names everywhere user-facing; the leaderboard must never ship fixture names (show "Be the first on this crowd" when empty); results numbers must come from the real engine runs.
- **HUD (15:40):** default camera should frame the town larger; show at most 2–3 toasts at once.

---

## v4 world + camera (user: "detailed city, good views, best default camera; ocean on one end, mountains on the others, tunnels — plan it properly")

**Read first:** `docs/research/iso-art-direction.md` (art + camera bible distilled from the user's references; may still be in progress — read it when present and re-check before you finish).

**World framing (camera looks from +x/+z):** mountains at the back (north, west), water at the front (south, east), so nothing tall ever hides gameplay. Seam: `apps/web/src/render/world/layout.ts` → `worldLayout(TOWN)` gives the diorama `extent` (34 u of mountains beyond the north/west board edges, 30 u of water beyond south/east, a 4 u beach strip), every road `exit` (side, point, direction, `tunnel` on mountain sides / `bridge` on water sides) and a `railTunnel` span on the west half far from stations. `world/index.ts` composes `createBaseLayer`, `createTerrainLayer`, `createWaterLayer`, `createSkyLayer`. Preview: `/world-dev.html?elev=35&az=45&view=100&light=day|dusk`.

- **Mountains ("Nittany Ridge", a nod to Mount Nittany):** layered low-poly ridges 8–22 u tall rising from foothills at the board edge, pine forests on the slopes (instanced), rock outcrops, a ridge line that reads well against the sky; stone tunnel portals with lamps where roads exit north/west; a foothill spur over the `railTunnel` span with portals at both ends so the train visibly enters and leaves a tunnel.
- **Water ("Nittany Lake", reads like a bay):** stylized water shader (deep→shallow gradient, gentle animated waves, soft foam line at the shore, sparkle glints; dusk reflections of warm lights), a sandy beach strip along the south/east board edges, a small marina with bobbing boats at the south-east corner, a lighthouse on a little point, causeway bridges where roads exit south/east, headlands where mountains meet water at the NE/SW corners.
- **Sky + base:** vertical gradient sky (day mint→cream, dusk indigo→peach), 2–3 layers of distant ridges behind the mountains with aerial perspective, a few slow low-poly clouds; the whole diorama sits on a base with cut edges showing soil/rock layers (and blue water layers under the lake) — a "slice of a world" model.
- Never place terrain over stops, platforms, queue lines or the playable roads; the town board stays flat and readable.

**Camera ("most information by default"):**
- Orthographic. Study elevations 30°, 35.26°, 45° (and azimuth 45° vs 35°/55°) on the real town blockout; measure the fraction of stops, queue slots, platform edges and route segments hidden behind buildings/terrain (raycast from camera through each sample point against building bounding boxes) plus the projected screen area used by the transit network; recommend the most readable view.
- Default framing fits the transit network (rail loop bounding box + stops) into the **HUD-safe rectangle** (excluding top bar, legend, bottom card/dock, and the right inspector when open) with 4 % padding; recomputed on resize; zoom range [0.8×, 4×] of fit.
- Presets with smooth spring transitions: Overview (default), Stadium, Downtown hub, Campus, Central Station; double-click / "focus" on a selected vehicle or stop; optional Q/E rotate in 90° steps.
- **X-ray occlusion:** buildings and terrain between the camera and the selected entity, any queue marker with ≥ 1 waiting, or a moving vehicle fade to ~30 % with a dithered fade so gameplay never hides.
- Composition rules for district art: tall buildings on the far side of streets from the camera, low buildings on the camera side of stops; stations, stadium and clock tower as focal points; roads and rail as leading lines; quiet scenery around busy stops.

### Tracks
| Track | Owns | Delivers |
|---|---|---|
| C1 camera study | `src/render/camera/study/**`, `apps/web/camera-study.html` | the measured comparison above (table + screenshot grid), PUBLISH "camera-study", a recommendation in the final message |
| E1 terrain | `src/render/world/terrain/**` | mountains, forests, rocks, tunnel portals (roads + rail), headlands; PUBLISH "world-terrain" |
| E2 water | `src/render/world/water/**` | lake, shore, beach, marina, boats, lighthouse, causeway bridges; PUBLISH "world-water" |
| E3 sky + base | `src/render/world/sky/**`, `src/render/world/base/**` | sky gradient, distant ridges, clouds, diorama base with cut edges; PUBLISH "world-sky" |
| C2 camera rig (after C1) | `src/render/camera/**` except `study/` | `CameraRig` (elevation/azimuth from C1's recommendation, safe-area fit, presets, focus, rotate, x-ray occlusion helper the composer can call); exposes `fitToSafeArea(rect)`; tests for the fit math |
| E4 world integration (after E1–E3) | `src/render/world/index.ts`, `src/render/world/dev.ts`, `apps/web/world-dev.html` | seamless board↔terrain↔water transitions, exits aligned with roads, rail tunnel aligned with the loop, day + dusk; PUBLISH "world-v1-day" and "world-v1-dusk" |

---

## v5 Kenney kits (user: "trees need more detail/randomness than ovals and blobs — the pine is fine; check the 3D kits I downloaded, might save a ton of work")

**What we have (CC0, licence files kept):** `apps/web/public/models/kenney/<kit>/<name>.glb` — 821 models, 30 MB: `nature-kit` (329: ~60 trees incl. `_dark`/`_fall` variants, pines, palms, bushes, flowers, rocks, stones, cliffs, ground/path tiles, bridges, fences, logs, crops; **no textures — named materials** `leafsGreen`, `leafsDark`, `leafsFall`, `stone`, `stoneDark`, `dirt`, `grass`, … so recolouring is a material-name → palette-role map), `car-kit` (sedan, suv, taxi, police, ambulance, delivery, van, truck, garbage-truck, firetruck, hatchback-sports…), `watercraft-pack` (sail/speed/fishing/row/tug boats, house boats, buoys, cargo, ships), `city-kit-suburban` (houses, fences), `city-kit-commercial`, `city-kit-industrial`, `city-kit-roads` (road tiles + lights/signs), `train-kit`, `survival-kit` (props). All non-nature kits share one `Textures/colormap.png` swatch texture per kit. Manifest with sizes/triangles/materials: `apps/web/src/render/assets/kenney/manifest.json`; contact sheet: `.superpowers/kenney-sheets/kits-overview.png`.

**Rules:** Kenney models must look like they belong to our toy world: recolour to the Wooden Toy palette roles (nature kit via material names; colormap kits via a palette-harmonised copy of `colormap.png` or a shader tint), apply the shared clay shading tweak, scale to our proportions (person ≈ 0.8 u, door ≈ 1 u, bus 3.3 u, car ≈ 1.7 u, trees 2.2–3.2 u). Keep our approved bus, train, stop, station and people. Builders stay synchronous — the composer and every preview page `await preloadKenney(ids)` first; every Kenney-backed builder falls back to the previous builder if its model is not loaded.

| Track | Owns | Delivers |
|---|---|---|
| K0 pipeline (first) | `src/render/assets/kenney/**` (seam signatures fixed), plus the `await preloadKenney` lines in `src/render/assets/dev.ts`, `src/render/districts/dev.ts`, `src/render/world/dev.ts` | GLTFLoader cache, material-name → role remap for the nature kit, harmonised colormaps for the other kits, clay tweak, per-kit `KENNEY_SCALE` measured from the manifest, `KENNEY_CARS` / `KENNEY_BOATS` lists, `/assets-dev.html?family=kenney` preview; tests for the remap/scale tables |
| K1 vegetation (after K0) | `src/render/assets/families/kenney.ts` (vegetation part) | upgrade `veg.oak`, `veg.maple`, `veg.birch`, `veg.poplar`, `veg.cherry`, `veg.bush`, `veg.hedge`, `veg.flowerbed`, `veg.planter` with Kenney models — **and `veg.pine` too (Kenney pines; v7 Kenney-first policy)**: per placement pick among 2–4 fitting models (`k.rand()`), scale jitter 0.85–1.2, random yaw, gentle colour variation, `_fall` models for palette c; keep `sway`. PUBLISH "assets-vegetation-v2" |
| K2 vehicles + boats (after K0) | `src/render/assets/families/kenney-vehicles.ts` (imported by `families/kenney.ts`) | `kn.car.*` and `kn.boat.*` kinds with catalog footprints (append entries to `catalog.ts`), car colour variety harmonised to the palette, PUBLISH "assets-kenney-vehicles" |
| K3 buildings + props (after K0) | `src/render/assets/families/kenney-buildings.ts` (imported by `families/kenney.ts`) | `kn.house.*` (suburban, roofs recoloured to palette roles), low-rise `kn.shop.*` (≤ 3 storeys only), a few `kn.works.*` industrial pieces for an outskirts works yard, `kn.prop.*` street/survival props; catalog entries appended; PUBLISH "assets-kenney-buildings" |

**Downstream (read this if you are T2.2, T2.3, E2 or the art-direction loop):** T2.3 traffic uses `KENNEY_CARS` (via `kenneyModel`) when preloaded, else the kit cars. E2's marina uses `KENNEY_BOATS` when available. The composer awaits `preloadKenney` for every `kn.*` kind in `DISTRICTS` plus the upgraded `veg.*` models before building. A later dressing pass adds Kenney houses/props to apartments/outskirts and Kenney cliffs/rocks/pines to the mountains.

---

## v6 greater town (user: "use the road systems to make a good, detailed, large town with highways and roundabouts and everything")

**Principle:** the playable town (`TOWN`: 8 stops, 3 routes, rail loop) stays exactly as it is — the sim, engine and district art depend on it. Around it we build a **visual-only greater town ring** (28 u wide on every side) with Kenney `city-kit-roads` tiles, so the town reads as a real, large place. The default camera still frames the playable network; zooming out reveals the region, then the mountains and lake beyond it.

**Grid:** one Kenney road tile = **4 u** (tiles are 1 × 1 kit units; the roundabout is 3 × 3). Grid origin `(bounds.minX − 28, bounds.minZ − 28)`, 32 columns × 27 rows; the board occupies columns 7–24, rows 7–19 (72 × 52 u). Rows 0–3 (the northern 16 u strip) are reserved for the highway.

**Network:**
- Every road that leaves the board (`worldLayout(TOWN).exits`) continues outward into a **roundabout** within the ring.
- An **orbital ring road** links the roundabouts all the way around the board.
- A **highway** (dual carriageway with barriers) runs east–west across the northern strip, with an **interchange** (side exit/entry ramps, slants up to an overpass on bridge pillars) where the north exit road meets it, highway signs and light poles, continuing west into a mountain tunnel and east toward the lakeshore.
- A **lakeshore parkway** (boulevard with street lights) along the south and east, meeting the waterfront.
- Local streets subdivide the ring into blocks.

**Dressing:**
- **Suburbs:** Kenney suburban houses, fences and gardens (north-east and north-west).
- **Commercial strip:** low-rise Kenney commercial (two to three storeys) with parking lots along the ring road.
- **Industrial works yard:** Kenney industrial, near the rail and mountains in the south-west.
- Parks, street trees, power poles with wires along roads, traffic lights at major junctions, construction props for a little life.
- A **waterfront district:** boardwalk and promenade meeting E2's marina.

**Traffic:** visual-only cars and trucks drive the ring, roundabouts and highway (Kenney `car-kit` via `KENNEY_CARS`), despawning and spawning at board-edge exits and highway ends. They never affect the sim.

| Track | Owns | Delivers |
|---|---|---|
| G0 grid + streets (first) | `src/render/greater/{grid.ts,roads/**}` | the grid seam (`greaterGrid`, `cellCenter`, `cellOf`, `RoadCell` tile map, `Lane` polylines for traffic, block polygons for dressing), roundabouts at every exit, ring road, parkway, local streets, rendered with Kenney road tiles (merged per material), sidewalks where tiles allow; PUBLISH "greater-roads" |
| G1 highway + interchange (after G0) | `src/render/greater/highway/**` | the northern highway band, interchange, ramps, overpass, barriers, signs, lights, tunnel approach; adds its `Lane`s; PUBLISH "greater-highway" |
| G2 outer neighbourhoods (after G0) | `src/render/greater/blocks/**` | suburbs, commercial strip, works yard, parks, parking, poles and wires, traffic lights, props; never on roads; PUBLISH "greater-blocks" |
| G3 waterfront + parkway dressing (after G0) | `src/render/greater/waterfront/**` | boardwalk, promenade, benches, lamps, small piers meeting the marina; PUBLISH "greater-waterfront" |
| G4 greater traffic (after G0) | `src/render/greater/traffic/**` | cars and trucks on ring, roundabouts (yield-and-merge feel) and highway lanes with spacing; headlights at dusk; ≤ 4 draw calls |
| G5 integration (after G1–G4) | `src/render/greater/index.ts`, `src/render/greater/dev.ts`, `apps/web/greater-dev.html` | `createGreaterTownLayer(map)`, a preview of the full region with the town board, a recommendation for `world/layout.ts` margins (terrain and water start beyond the ring); PUBLISH "greater-town-v1" (full region) and "greater-town-v1-close" |

Kenney models load through `src/render/assets/kenney` (K0): `await preloadKenney([...])` before building; use the road tile names from `apps/web/src/render/assets/kenney/manifest.json` (`city-kit-roads`). If K0 is not finished when you start, load the GLBs with three's `GLTFLoader` behind a tiny local helper and switch to K0's API when it exists.


---

## v7 Kenney-first policy (user: "assume the Kenney kits are better — don't keep our own models unless needed; no sunk cost")

**Default: use the Kenney model wherever an equivalent exists**; keep ours only where Kenney has none or gameplay/identity needs it. Applies to every track that has not finished and to the grand integration / art loop.

| Use Kenney (override our kinds via the registry, falling back until preloaded) | Keep ours (no Kenney equivalent, or gameplay/identity) |
|---|---|
| all `veg.*` incl. pine (nature-kit trees/pines/bushes/flowers/plants), rocks, logs | buses (Kenney has no city bus) |
| `st.lamp` → `city-kit-roads` light-curved/light-square; `st.trafficLight` → traffic-light*; signs, power poles + wires, construction props, dumpsters | bus stops (route chips + queue area are gameplay) |
| `st.fence` / `veg.hedge` → suburban/nature fences and hedges where they read better | stations + platforms, people (gameplay readability) |
| cars, trucks, emergency vehicles, boats (`car-kit`, `watercraft-pack`) | campus halls, library, chapel, Old Main clock tower, stadium (State College identity) |
| `res.house`, `res.townhouses` → `city-kit-suburban` houses (roofs recoloured to palette); `res.tower`/`res.garden` → `city-kit-commercial` mid-rises if they read as apartments | red-brick downtown rows (`dt.*`) unless a Kenney low-rise reads as college-town brick |
| outer-town buildings: suburban, low-rise commercial, industrial | the rail track along the curved loop (procedural) |
| road tiles, bridges, pillars, highway signs | |
| **train:** K2 evaluates `train-kit` passenger sets; if a 2-car unit with clear front/rear looks better, export `KENNEY_TRAIN = { front, rear }` and T2.2/the integration uses it | |

Owners: K1 (vegetation incl. pine), K2 (vehicles, boats, train evaluation), K3 (buildings, street furniture overrides: `st.*`, `res.house`, `res.townhouses`, optional `res.tower`/`res.garden`, props). The registry's family order makes Kenney overrides win. Core-town streets: if `TOWN.roads` centrelines sit on the 4 u greater-town grid, G5 / the grand integration renders them with the same Kenney road tiles (S1 then keeps only sidewalks where tiles lack them, plazas, footpaths, lawns and parking).

---

## v8 notes (16:35): engine landed; sim tuning; art bible

- **Engine done** (early-engine workflow): real engine + passengers + metrics, 193 sim tests green, 10–17 ms per run, Play fairness exact (doing nothing = g0). Gaps found: train↔bus transfers almost never happen (1 / 5,348 stadium riders) because the rail ran Stadium → University → Central; REF beats g0 by only 1.7 %. A tuning agent is **reversing the rail to Stadium → Central → University** and retuning demand/behaviour (owns town.ts rail order, scenarios.ts, config.ts, builtin.ts, sim tests; report in `docs/research/sim-tuning.md`). Anything that shows fan counts or the rail order in copy (prompts, UI, demo script) must read them from `SCENARIOS` / `TOWN`, never hard-code "1,200".
- **Art bible ready:** `docs/research/iso-art-direction.md` (30-item scoring checklist). Binding for the grand integration and the art loop: ortho camera 35.264° elevation, 45° azimuth from the south-east, no free rotation by default; fit the transit network into the HUD-safe rectangle; tall buildings only on the north/west sides of stops (University Station's building currently hides 7 of 8 platform slots — fix); **gameplay owns saturation** (route, stop, train and queue colours) — tone down teal/mustard roofs and the red canopy where they compete; mountains at the back, water at the front; post effects never blur gameplay.

---

## v9 user feedback (17:45) — binding for every agent that starts from now, the grand integration and the art loop

**Resources (the laptop crashed once):** never launch Chrome directly — use `scripts/shot.sh <url> <out.png> [w] [h] [virtual_ms]` (one headless Chrome at a time machine-wide, GPU, low priority, 60 s cap; defaults 1280 × 800). Never start your own Vite: use the shared dev server **http://127.0.0.1:5173** (serves every page incl. `/render-dev.html`, `/assets-dev.html`, `/districts-dev.html`, `/world-dev.html`, `/greater-roads-dev.html`, `/camera-study.html`). Run tests by file; vitest is capped at 2 workers; no parallel full builds. A governor (`scripts/governor.py`) pauses extra headless Chromes and stops stray dev servers. Integrated testing and monitoring happen on Cloudflare deploys (`https://headway.pranavkarra001.workers.dev`), not extra local servers.

**Don't duplicate work:** the current app on the shared dev server is approved — build on existing files, don't replace working pieces unless the plan says so; read before writing.

**Roads:** no cream/"dirt" roads. All drivable roads — the playable town's streets and the greater town — use the Kenney `city-kit-roads` look (asphalt, lane markings, sidewalks, crosswalk/intersection/roundabout pieces). Where the playable town's road centrelines don't sit on the 4 u tile grid, render them procedurally in the same asphalt + marking style with Kenney-matched colours.

**Traffic:** ambient cars never spawn or vanish inside the city. They enter and leave only through world exits — mountain tunnels (north/west) and bridges/causeways (south/east) — and pass through the greater town on their way in and out.

**Tunnels must make sense:** a portal only where a road or the rail meets a mountain slope, the road visibly continuing into it, with a stone portal face, lights and a hillside above; no free-standing portals on flat ground.

**Rail:** no rectangle around the town. The sim-tuning agent is reshaping `TOWN.rail.loop` into a regional line: out of a north-west ridge tunnel → University → Central → off the board south-east across a bay bridge → back west along the lakeshore → Stadium → back into the ridge tunnel (same 3 stations and stops, direction Stadium → Central → University). Rail may now extend outside `TOWN.bounds`; world agents place the tunnel portal and the bay bridge from `docs/research/sim-tuning.md`.

**Organic city:** the city must not read as a fixed rectangle. Blocks thin out irregularly into parks, fields, forest, foothills and an irregular shoreline; the greater-town ring road and parkway follow organic curves; the diorama base may stay a rounded slab, but the town on it is irregular.

**Typography & UX:** Gumball Rounded only for the wordmark, headings and titles; **General Sans** (self-hosted `/fonts/GeneralSans-*.otf`) for all other UI text, labels, chips and numbers. Explainers are short and visual (icons, small diagrams, one-line captions), never walls of text; follow good UX practice (clear hierarchy, generous spacing, progressive disclosure).

**Version control:** the coordinator commits after every completed track; agents still never run git.

---

## v10 (18:15) sim tuning landed — read before touching rail, camera, Jev or copy

- `simVersion` is now **'2'** (sim + Worker `SIM_VERSION`); results cached under '1' are stale.
- **Rail:** regional line, 234.5 u, travel order Stadium → Central → University, train speed 1.2 u/s, advertised headway 330 s. It leaves the board: `RAIL_SPANS` (packages/sim) gives the **ridge tunnel (dist 169.0–216.3)** and the **bay bridge (27.8–54.7)** — world agents place the tunnel portals and bridge exactly there; the renderer hides the train inside the tunnel span.
- **Camera fit** must frame the transit network *inside the board* (stops, stations, on-board rail), not the off-board rail spans.
- **Transfers now matter:** g0 stadium_exit ≈ 9 % of riders change between train and bus, 63 missed connections per run at Central/University; REF beats g0 by 5.1 %; a sensible human beats g0 by ~7 %. Central is the r1/r2 terminal, so "hold for the train at Central" is a human move; **Jev decides holds at University (r1) and Stadium (r3)**.
- **Copy:** the stadium crowd is ~1,030 fans; trains every 5½ min. Read numbers from `SCENARIOS`/`TOWN`, never hard-code.
- Known web test breakages from the new rail (owners fix in their tracks or the integration fixes): traffic level-crossing count, camera fit, terrain tunnel/triangle bound, water plan (a beach lamp sits on the track).
- **Camera study (18:25):** default camera = true iso 35.26° elevation, 45° azimuth, HUD-safe Overview fit. With two placement moves (campus library, a Downtown oak) 0 % of queues and stops are hidden, but **42 % of bus-route length is hidden** behind about 10 tall camera-side buildings — the integration/art loop must move those buildings to the far (north/west) side of their streets or lower them, and the camera rig's x-ray fade must cover moving buses.

---

## v11 (18:55) — binding for G5 and the grand integration: fit the greater town INTO the world, organically

`world-v1-day` (E4) now frames the playable town with the Nittany Ridge behind and the lake wrapping the front, with a beach right at the town edge. Do **not** push the world outward to insert a uniform 28 u rectangular ring. Instead:
- **North / west (ridge side):** the highway runs along the foot of the ridge (an easy curve following the contour), the interchange sits where the north exit meets it, and the highway disappears into the ridge tunnels at both ends; suburbs climb the lower foothills in irregular clusters between forest patches.
- **East:** a suburban fringe and the small works yard near the rail, thinning into fields and forest.
- **South / lakeside:** no suburbs on the beach — the lakeshore parkway, promenade/boardwalk (G3) and the marina; roads leave across the causeway bridges.
- Roundabouts only where they read naturally (exit roads meeting the highway/parkway); the ring road becomes curved connector roads, not a rectangle.
- Every outer road joins the playable town's exits; cars enter/leave only via the ridge tunnels and the causeway bridges.
- Keep it cheap and readable: the playable town stays the visual focus; outer areas are quieter (lower saturation, fewer props).

---

## Grand-integration checklist (collected from finished tracks, 19:00)

**Camera + occlusion (C1/C2):** switch the game to the C2 rig (`stage.ts` imports `'../camera/rig'`; TownRenderer passes `camera: { map }`, calls `rig.fitToSafeArea()`, wires `xray.attach` / `xray.update`). Overview must frame the in-board network (people are only ~10 px at 1600 × 1000 because the west rail detour widened the fit). Move occluders: `cp.library` at (−7, −11) and the `veg.oak` at (10, 4) (→ 0 % queues/stops hidden); the 10 worst route occluders incl. `res.tower` (15, 3), `lm.stationCentral`, `res.townhouses` (→ ~10 % of route length hidden). At Overview the bottom-left shows ~9 u past the water's edge — clamp or extend the base.
**World (E1–E4):** `layout.railTunnel` is stale — derive it from `RAIL_SPANS.tunnel`; add lamps to the rail portals; move D5's `lm.waterTower` east (it hides the NW rail portal at (−36, −21.9)); causeways should run to the base edge, not stop mid-lake; terrain trees/ridges hide the rail approaching both portals (thin them); keep world draw calls ≤ 15.
**Post:** tilt-shift off below 0.95× zoom and gentler at the beauty-shot zoom; never blur gameplay.
**Kenney:** verify every `families/kenney*.ts` import resolves (E1 saw `./kenney-vegetation-k1` missing in `world-dev`), preload all Kenney ids used by DISTRICTS + greater town before building.
**Traffic:** cars spawn/despawn only at tunnels and causeway bridges (v9).
**Art notes (v8/v10):** downtown gray blocks → warm brick/cream; route ribbons ~20 % dimmer at dusk; gameplay owns saturation.
**Copy/UX (v9):** General Sans everywhere except titles; short, visual explainers; no hard-coded fan counts.
**Kenney (K0–K3 done):** add `'kenney'` to `FamilyId` in `assets/types.ts` and drop the catalog cast; give K1's vegetation test a permanent home (`src/render/__tests__/assets-kenney-vegetation.test.ts`, copy from `/tmp/k1test/k1veg.test.ts` if still present); `st.lamp`/`st.trafficLight`/`st.fence` stay ours (Kenney lamp heads face down and wouldn't glow); our train stays (Kenney cars are 2.7 u vs our 4.2 u platforms). Fix the rail-layout failures in `district-stadium.test.ts` (3) and the type error in `district-outskirts.test.ts` caused by the new rail.
**Town art (showcase done, 583/583 tests):** remaining, ranked — two apartment towers and Central Station still hide route length (~39 % hidden now); teal/mustard roofs compete with route colours (palette roles); the south-west edge is sparse (will meet the greater town / world).

---

## v12 Play UX v2 (user: "make sure the gameplay for people works and is intuitive; completely click-based; a bus depot on the side; add buses to a line; trains with more cars")

**Decisions (coordinator):**
1. **Click-first Play.** Every control reachable by mouse; keyboard keeps shortcuts only. A **Fleet board** panel (left side, replaces the plain route legend in Play): one lane per route (colour, name, waiting count), bus tokens placed along the lane by loop progress, showing load (fill bar), state (moving / dwelling / holding ⏸ / at terminal / deadheading) and pending intents (badges). Below the lanes a **Depot** tray with reserve buses and the **Train** strip (cars, load, next station, departure timer).
   - Click a bus (map or token) → an action card next to it: **Hold 30 s / Hold 60 s / Send now / Move to route ▸** (route chips; also: click a route lane or a route line on the map). Drag a token onto another lane = reassign (applies at its terminal, deadhead path previewed on the map).
   - Click a depot bus → **Deploy to route ▸** (r1/r2/r3 chips). Click the train → **Leave now / Wait 30 s / Wait 60 s** (within limits).
   - ≤ 2 clicks for every common action; disabled actions explain why in plain words; every action gives visible feedback within 1 s (badge, map highlight, toast).
2. **Bus depot + reserves (new mechanic, AI parity):** `bus.reserve = 2` extra buses parked in a depot lot near Central (beside the r1/r2 terminal; visible on the map). New intent/action **deploy(route)**: a reserve bus leaves the depot, deadheads to the route's terminal and joins the route; it can later return only via reassign→depot (not needed in v1). The AI gets the same action through a new decision kind **`depot_check`** raised every 60 s while reserves remain (features: reserves_left, each route's queue/left-behind/gap, event_in_s), actions `deploy {to: RouteId | 'busiest'}` or `continue`. g0 baseline deploys a reserve when any route's queue ≥ 60 (simple, respectable); REF deploys to `busiest` when queue_ratio is high.
3. **Train: 3 cars**, capacity 240 (80 per car), dwell unchanged; renderer draws 3 linked cars; the train control remains departure timing.
4. **simVersion → '3'**; retune gates (transfers, completion, REF ≥ 3 %, Play winnable 3–12 %, doing nothing = g0) and re-run + republish the evolution campaign afterwards.
5. **Tutorial:** 3 click-through coach steps in Play using the real UI (select a bus → move it to Stadium before closing → deploy a reserve), skippable, remembered.

**Contract changes (coordinator applies before agents start):** `DecisionKind` += `'depot_check'`; `Action` += `{ type: 'deploy'; to: RouteId | 'busiest' }`; `Intent` += `{ type: 'deploy'; to: RouteId }`; `Observation` += `depot: { reserves: string[]; deploying: string[] }`; `VehicleState` += `'depot'`; `SimConfig.bus` += `reserve: number`; `SimConfig.train` += `cars: number`.

| Track | Owns | Delivers |
|---|---|---|
| P1 sim depot + train | `packages/sim/src/{engine,controllers/policy.ts,policy,config.ts,scenarios.ts}`, `packages/sim/test/**` | depot mechanic, deploy intents/actions, `depot_check` decision point + features, 3-car train, g0/REF updates, simVersion 3, gates green |
| P2 Play UI v2 | `apps/web/src/modes/play/**`, `apps/web/src/ui/hud/**` | Fleet board, depot tray, train strip, action cards, drag-to-reassign, click-a-route-to-pick, plain-language disabled states, feedback, tutorial; keyboard shortcuts kept |
| P3 renderer bits | `apps/web/src/render/dynamic/**` (+ a `render/town/depot.ts` static lot) | depot lot with parked reserve buses, deploying buses drive out, 3-car train, clickable route lines (`pick` returns `{kind:'route', id}`), hover highlight |
| P4 evolve + DSL | `packages/evolve/src/**`, `packages/sim/src/policy/{features,schema}.ts` docs only via P1 | DSL doc + prompts + probes cover `depot_check`/`deploy`; dry campaign on simVersion 3 |
| P5 playtest + UX QA (after P1–P3) | `scripts/playtest/**`, small fixes anywhere in Play/HUD | scripted players (novice / sensible / expert) through intents: doing nothing = g0, sensible beats g0 3–12 %, expert can beat the champion sometimes; a click-path audit (every action ≤ 2 clicks, no dead ends, no console errors) with screenshots of each step; fixes |

---

## v13 final UX pass (user, 19:25) — run right after the submission polish workflow

User: too much text; make it visual; the player's job is unclear; baseline vs reference vs champion — "what exactly is changing? I can't see the improvement"; Next Crowd and the bottom panel are unclear; the Lab is too much (objective J, round 10, spacing/allocation/transfers jargon); "what does Evolve do / what is the admin token"; route bus counts unclear and no way to change them in Play; remove the three dots after the title; legend bottom-left, controls bottom.

1. Wordmark: remove the three coloured dots.
2. Layout: route legend bottom-left (route colour, name, **bus icons × N**, waiting count); all controls in one bottom panel; nothing else floating except the top bar and the inspector.
3. Watch bottom panel: title **"Who's dispatching?"** with a segmented control **Baseline · Hand-written · AI champion**; under it a **comparison strip for this exact crowd** (computed headlessly with runSync — ~10 ms each — for all three): three short horizontal bars each for *average wait*, *people who gave up*, *% home*, the selected one highlighted, caption "Same crowd · different dispatcher". **"Next crowd" → "New crowd"** with hint "Same town, new random riders".
4. Play: each route in the legend gets **"Move a bus here"** (reassign intent for a bus on the route with the most buses, preferring one at/near its terminal; pending badge until applied). Whole flow click-only.
5. Onboarding / About: replace text with 3 visual steps using simple palette SVG icons (person, stop, bus, train, clock): "People wait at stops" · "You send buses and time the train" · "Score: total minutes people spend getting home — lower wins". ≤ 12 words per step. About panel: a small diagram, ≤ 40 words.
6. Lab: headline **−6.0% (training) / −5.3% (unseen)** big, then g0 → g1 → g2 chips each with its one-line change in plain words; chart small; rounds collapsed; humanise jargon (J → "total passenger time", spacing/allocation/transfers → "Spacing fix / Fleet move / Train link"); **hide "Evolve next generation" unless `?admin=1`**.
