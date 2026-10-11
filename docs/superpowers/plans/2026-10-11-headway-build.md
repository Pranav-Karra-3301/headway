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

- [ ] `pnpm -r typecheck` and `pnpm test` green across the workspace; fix cross-track seams (only via the owners' files; contracts unchanged).
- [ ] §12 sanity gates on train: `ref` beats `g0` by ≥ 5 % J; g0 stadium_exit completion ≥ 85 %; g0 has ≥ 1 service gap > 10 min and ≥ 10 missed connections; stadium_exit run < 150 ms. Tune `SCENARIOS` totals / `DEFAULT_CONFIG` if not (report changes).
- [ ] **Baseline must be respectable (user priority):** g0 keeps even headways via terminal holds with a 2/2/2 allocation and never strands a route; check its per-route headway spread and bunching on class_change and stadium_exit. If g0 behaves like a strawman (absurd waits, a route with no service, completion < 85 %), fix g0's rules — not the sim — and report the change. A thoughtful human should be able to beat g0 by 3–10 %; the champion should be hard but beatable.
- [ ] **Play is winnable and fair:** run g0 + a scripted "sensible human" intent list (pre-stage one r1 bus to r3 before closing, hold the r2 bus at Central for the first post-closing train) on the play seed and confirm it beats g0; confirm doing nothing reproduces g0's J exactly.
- [ ] Web: Watch runs the **real** sim with G0; golden journey visible; screenshot.
- [ ] **Checkpoint B** to the user: screenshot + first real Luminal proposal summary + API URL.

## Wave 2 preview — art-direction loop (after integration)

A dedicated look-dev workflow: an "art director" agent screenshots Watch (day + dusk, palette A, three zoom levels) and the HUD, writes a ranked critique (composition, proportion, colour harmony, readability of vehicles/people/queues, clutter, post-processing artefacts), a "renderer" agent fixes the top items, repeat until two consecutive critiques find nothing above "minor". Every iteration publishes before/after screenshots for the user.
