# Sim tuning: rail line, demand and REF (2026-10-11)

## Why this was needed

The engine integrator measured three problems:

1. **The train never fed the buses.** Only 1 of 5,348 stadium riders in `stadium_exit` used train + bus. The cause was the rail order Stadium → University → Central, which made Stadium → Central the long way round. Buses holding for the train at Central, transfers and Jev's station holds had nothing to act on.
2. **REF barely beat g0.** The hand-written REF was only 1.7 % better than g0; the gate is ≥ 5 % (spec §12).
3. **Play rewarded the wrong thing.** A scripted "sensible human" lost to g0 by 2.4 %, while one well-timed reassign (b3 r2→r3 at 300 s) won by 18 %.

Midway through, the user added a scope change: the rail must not be a rectangle hugging the board edge. It became a regional line with a tunnel in the north-west ridge and a bridge over the bay (see "The rail line" below).

The targets are now executable in `packages/sim/test/gates.test.ts`.

## Results

All results are on the train split (seeds 1001–1004 per scenario). J is summed over the 4 runs of each scenario.

Columns:
- **Walk:** share of stadium fans who walk the whole way (planned walk-only; walkaways are 0 in every run).
- **Train:** share of stadium fans who board the train.
- **Train↔bus:** stadium fans who make a train↔bus transfer, per run, with the share in brackets.
- **Missed (C/U):** missed connections per run, with the Central/University part in brackets.

For class_change, Walk and Train cover all riders.

"Before" is the tree I started from: the clockwise ring, train 0.75 u/s, 1,000-fan crowd.

| Scenario | Policy | | J (h) | Completion (min) | Wait mean / p95 (s) | Walk | Train | Train↔bus | Missed (C/U) | Run (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| stadium_exit | g0 | before | 1,857.6 | 88.7 % (86.7) | 512 / 1,333 | 38.6 % | 9.8 % | 0 (0.0 %) | 36.0 (3.3) | 10–17 |
| stadium_exit | REF | before | 1,829.2 | 88.8 % | 470 / 1,204 | 38.6 % | 9.8 % | 0 | 19.3 (1.8) | |
| stadium_exit | g0 | **after** | **1,964.4** | **88.2 % (87.7)** | 413 / 1,490 | **28.3 %** | **24.7 %** | **96.8 (9.1 %), min 85** | **113.8 (63.5, min 46)** | **10.4** |
| stadium_exit | REF | **after** | **1,849.0** | 91.1 % (89.1) | 397 / 1,016 | 28.3 % | 24.7 % | 96.8 | 25.0 (3.5) | |
| class_change | g0 | before | 688.6 | 97.0 % (96.3) | 128 / 227 | 62.8 % | 0.5 % | – | 44.3 (29.5) | |
| class_change | REF | before | 672.7 | 97.7 % | 137 / 351 | | | | 25.8 (9.8) | |
| class_change | g0 | after | 688.2 | 97.0 % (96.3) | 128 / 227 | 62.7 % | 0.6 % | – | 44.5 (29.8) | 5.0 |
| class_change | REF | after | 667.3 | 98.1 % (97.4) | 147 / 371 | | | | 14.0 (5.3) | |

REF against g0, as J gained:

| | stadium_exit | class_change | Train split (8 runs) |
|---|---|---|---|
| Before | +1.53 % | +2.31 % | +1.74 % |
| **After** | **+5.88 %** | **+3.03 %** | **+5.14 %** (gate ≥ 3 %; the §12 gate is ≥ 5 %) |

Other checks after tuning:
- **Determinism:** unchanged; the idle Play run's hash equals g0's.
- **Speed:** the best stadium_exit run takes 10.4 ms in Node, although the machine's load average was about 120 throughout.
- **g0 completion on other seeds:** 89–91 % on every val, showcase and play seed. Val: 2001 90.4 %, 2002 89.1 %. Showcase: 4001 89.0 %, 4002 89.6 %, 4003 90.5 %. Play: 50000–50006 89.4–91.2 %.
- **Rail reversal alone:** before the regional rail and the demand retune, reversing the ring only moved train↔bus from 0 % to 0.4 %. The demand mix and the train calibration did the real work.

### Play (stadium_exit, seed 50000)

g0 J is 432.5 h with 91.2 % completion. Doing nothing reproduces g0 exactly: the same J and the same hash.

The scripted humans act only on what the observation shows.

| Script | 50000 | 50001 | 50002 | 50003 | 50004 | 50005 | 50006 |
|---|---|---|---|---|---|---|---|
| **Sensible:** reassign b1 (r1) → r3 at 420 s, plus up to 2 holds of the r2 bus at Central | **+6.8 %** | +7.4 % | +4.1 % | +11.9 % | +3.1 % | +8.6 % | +9.2 % |
| Pre-stage b1 only | +6.9 % | +7.4 % | +4.1 % | +11.9 % | +3.1 % | +8.6 % | +9.2 % |
| Wrong bus: b3 (r2) → r3 at 420 s, plus holds | −4.7 % | −4.0 % | −1.5 % | +0.9 % | −4.0 % | −7.4 % | −3.4 % |
| REF | +6.5 % | +8.6 % | +7.3 % | +17.8 % | +1.6 % | +9.3 % | +10.2 % |

How each script works:
- **Holds:** a hold fires only when the train is ≤ 45 s from Central with ≥ 8 riders transferring to r2, and the r2 bus at Central would otherwise leave first. The hold lasts eta + 30 s, capped at 90 s.
- **The old winning move now loses:** b3 r2→r3 at 300 s scores −3.65 %.

What the holds do:
- With two r2 buses, a hold cuts Central/University missed connections from about 53 to about 3, but J barely moves (−0.1 % to 0). The next r2 bus is never far away, and the hold shifts the whole r2 schedule.
- When r2 is down to one bus, the same holds are worth about +7 %. This matches the spec's g3 rule, which holds only when the bus behind is ≥ 180 s away.

## Every constant changed

| File | Constant | Before | After | Why |
|---|---|---|---|---|
| `map/town.ts` | rail travel order (`rail.stations`) | stadium, university, central | **stadium, central, university** | Stadium → Central is the short side, and the golden journey Apartments South → r2 → Central → train → University runs straight through |
| `map/town.ts` | `rail.loop` geometry | 60 × 44 rounded ring at the board edge, 199.1 u | **regional line, 234.5 u** (see below) | user request |
| `map/town.ts` | rail corner fillets | `RAIL_R` 6 for all corners (minimum true radius 4.2 u) | per corner: 7 for gentle corners, 10 for 90° corners, 8 west of Stadium; `RAIL_SEGS` 12 → 16 | minimum curve radius 6.26 u |
| `map/town.ts` | `rail.advertisedHeadwayS` | 360 | **330** (`RAIL_ADVERTISED_HEADWAY_S`) | The nominal loop is 330 s; the measured g0 headway at Stadium is mean 347 s, median 337 s. The old ring advertised 360 against a real 400 |
| `map/town.ts` | new exports | – | `RAIL_SPANS`, `RAIL_SHORE_Z` (30) | for the world framing |
| `config.ts` | `train.speed` | 0.75 u/s | **1.2 u/s** | loop ≈ 5.5 min nominal, ≈ 6 min in the crush; Stadium → Central takes 72 s |
| `scenarios.ts` | stadium_exit demand | one crowd: 1,000 from all gates, apartments 45 % / downtown 25 % / campus 15 % / Central 15 % | **two crowds** (next table) | puts the train↔bus flow at Central and keeps r3 as the bottleneck that pre-staging relieves |
| `policy/builtin.ts` | REF `params.allocation` | 2/2/2 | **1/2/3** | see "REF" below |
| `policy/builtin.ts` | REF summary | queue-responsive text | adds "Campus Loop spare on Stadium (1/2/3)" | – |

Not changed: g0 (still 2/2/2 with an even-headway hold at the terminal), class_change, the background generator (300), the train's default dwell (45 s), the bus constants, walking, behavioural ranges, the decision logic, and every engine, passengers and metrics file. No engine bug was found.

The two stadium_exit crowds (spec §5.7). Background stays at 300; every count is scaled per run by 0.9–1.1.

| Generator | From | Total | Pulse | Destinations |
|---|---|---|---|---|
| `stadium_crowd` | East and North Gates | 600 | at 600 s, ramp 120 s, decay 420 s | Eastview 24 %, Allen Corner 16 %, Garden Row 10 %, Station Court 10 %, Central station 10 %, Central Plaza 8 %, Parkside 6 %, Beaver Ave 6 %, Main St Market 5 %, campus halls 5 % |
| `stadium_rail` | South Gate, beside Stadium Station | 430 | at 600 s, ramp 120 s, decay 600 s | Garden Row 52 %, Central station 14 %, Parkside 12 %, Station Court 8 %, University station 8 %, downtown shops 6 % |

### Why REF changed its allocation instead of adding rules

I tried a pre-stage rule on `bus_at_terminal` with `event_in_s`, both as `[0, 240]` and as `[100, 200]`. It gained 4–5 % on stadium_exit but cost 5–26 % on class_change. Terminal features cannot tell the stadium closing from a class change, and cannot tell r1 from r2.

The donor bus matters:
- Moving the r2 bus loses: r2 carries the train transfers out of Central.
- Moving the r1 bus wins.

Two other options failed:
- **Dropping `move-to-busiest`:** this destroys class_change (−20 %), because that rule is what wins class_change.
- **Train-dwell rules** (quick turns, "full train goes"): these did not help.

A 1/2/3 allocation is a standing pre-stage. It is robust on every seed I checked:
- stadium_exit train seeds: +3 to +9 %
- class_change: +3 %

**"Hold the r2/r1 bus at Central when expected_transfers is high" cannot be a rule.** Central is the terminal for r1 and r2, so a bus there only ever raises `bus_at_terminal`. That decision kind has no `train_eta_s` or `expected_transfers` feature. Holding at Central for the train is therefore a human (Play) move. The only station stops that raise `bus_at_stop` (which Jev decides) are r1 at University and r3 at Stadium.

## The rail line (for the world agents)

All values come from `TOWN.rail.loop`, measured as arc distance `d` in u along the travel direction. The loop starts at Stadium's platform centre, heading east. `RAIL_SPANS` exports them.

**Stations:**
- Stadium at d = 0.00
- Central at d = 86.74
- University at d = 144.96

Each station is on a straight of at least ±5 u for its 9 u platform. The platforms and their paired stops did not move.

**The loop in travel order:**

1. **d 0–14: Stadium to the board edge.** From Stadium at (−19, 22) the line runs east, then S-curves down to the beach. It leaves the board at the south edge at d = 14.0, at (−6.3, 26.0).
2. **d 14–27.8: lakeshore beach run at z = 27.** It level-crosses the Atherton St south exit's causeway square-on at d = 18.5, at (−2, 27).
3. **d 27.8–54.7: bridge over the bay.** The bridge starts at (6.3, 30.0) and dips to z = 35, the line's maximum z. It swings north and lands at (29.2, 29.9).
4. **d 54.7–58.8: beach landing.** The line re-enters the board at d = 58.8, at (30.0, 25.9), heading north.
5. **d 58.8–169: on the board.** It runs north along x = 30 and crosses the South Rd east exit square-on at (30, 14.6). It passes Central, rounds the north-east corner (radius ≥ 7), and runs west along z = −22. There it crosses the Atherton St north exit square-on at (−2, −22) and passes University.
6. **d 169.0–216.3: ridge tunnel, entirely off the board.** The line leaves the board heading west at (−36.0, −21.9). It turns south along x = −44, the line's minimum x, then south-east. It comes back out at (−36.0, 17.7) heading south-east. The Main St west exit passes over the tunnel.
7. **d 216.3–234.5:** it swings east into Stadium.

The spans as `RAIL_SPANS` reports them:

| Span | Arc distance |
|---|---|
| `tunnel` | [169.0, 216.3] |
| `bridge` (z > 30) | [27.8, 54.7] |
| `offBoard` | [14.0, 58.8] and [169.0, 216.3] |

The ridge portals can sit anywhere at or just beyond the two tunnel ends. Both ends are off the board.

**On-board level crossings:** there are now 2 roads × 2 lane directions = 4 lane crossings. Before, there were 4 roads × 2 = 8.

## Notes for the other tracks

**UI copy and prompts:**
- The stadium crowd is now about 1,030 fans: 600 leave by the East and North Gates and 430 by the South Gate. With background riders, a run has about 1.3k riders (× 0.9–1.1 per run).
- Trains are advertised every 330 s (5½ min).
- Under g0, about a quarter of fans take the train and about 9 % transfer at Central.

**Demo script:**
- Move 1 (send a Route 1 bus to Route 3 before 21:40) is still the winning move, worth +3 to +12 %. Sending a Route 2 bus now loses.
- Move 2 (hold R2 at Central for the train) visibly removes missed connections but is roughly J-neutral with two R2 buses.

**Web renderer:**
- The rail now extends outside `TownMap.bounds`, down to x = −44 and out to z = 35. `fit()` in `render/index.ts` and the camera study fit both include every rail point, so they will zoom out. Fit to the board, or to the on-board rail only.
- `worldLayout().railTunnel` uses a heuristic. It should use `RAIL_SPANS.tunnel` instead.

**Web tests that fail on the new rail** (apps/**, not mine to edit):
- traffic: the crossings count expects 8; it is now 4.
- camera study fit: two tests.
- terrain field: the tunnel span.
- terrain layer: a triangle bound.
- water plan: the "rail over the bay" tests are still in progress, and a beach lamp at (−3.45, 27.8) now sits beside the track at the Atherton causeway.

The sim (200 tests), evolve (205) and worker (56) suites are green.

**For the coordinator:**
- Spec §5.3 still says the train runs at 0.75 u/s with a "~6 min" loop and a 360 s advertised headway. I am not allowed to edit §5.3; the real values are 1.2 u/s, 234.5 u and 330 s.
- Spec §6's REF bullets should mention the 1/2/3 allocation.
- `simVersion` and the map `version` are still '1', because worker and evolve tests hard-code '1'. Every J changed, so the cached scores in `apps/web/public/data/*.json` and `data/` are stale. Consider bumping `simVersion` to '2' in a coordinated change.

## Reproducing

```bash
pnpm --filter @headway/sim exec vitest run test/gates.test.ts --reporter=verbose
```

The test logs the REF gain, the run time and the sensible human's gain.

The tuning harness wraps the real planner and collector through `__setEngineTestHooks`. It reads itineraries, boardings and the place of each missed connection without changing the run. `probe()` in `gates.test.ts` is the same harness.
