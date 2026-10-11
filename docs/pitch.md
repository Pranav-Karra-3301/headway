# Headway: pitch

## One line

> **A team of AI planners teaches the town's dispatcher, and you can try to beat it.**

## 30 seconds

Headway is a small isometric transit game set in a fictional college town that is loosely modelled on State
College. A stadium lets out, six buses and one train have to get everyone home, and every rider is simulated.

The dispatcher is a short, readable rulebook. Between games, three AI designers (DeepSeek V4.1 Flash on Luminal)
study where it failed and propose changes. A change is kept only if it helps on eight training runs and holds up on
four validation runs that the designers never see.

The models are never retrained; the rulebook gets better. You can watch it work, read why each bus did what it did,
and then take the controls on the same crowd to try to beat it.

## 90 seconds

1. **The problem is real, the town is a toy.** Bus dispatchers juggle conflicting goals. Holding a bus for a late
   train saves a dozen transfers but strands the next stop. Headway packs that trade-off into a town you can read at
   a glance: 4 neighbourhoods, 8 stops, 3 bus routes, a 3-station rail loop and a stadium crowd at closing time.
2. **The AI writes policy, not actions.** Each round, three policy designers read an evidence digest. It has the
   metrics, the costliest failures ("Apartments South went 14 min without a Route 2 bus") and how often each rule
   fired. Each designer is then asked for at most three focused changes to the champion rulebook. All three run
   DeepSeek V4.1 Flash on Luminal, with DeepSeek V4 Pro on OpenRouter as the fallback.
3. **Only measured gains survive.** Every valid proposal is simulated on the same 8 training runs. The best one is
   promoted only if all of these hold:
   - it cuts total passenger time by at least 1%;
   - it is no worse on 4 hidden validation runs;
   - completion stays within 1 point;
   - no stop's longest gap between buses grows past the champion's worst (or 15 min, if that is longer).

   Every report shows the costs next to the gains.
4. **It runs anywhere, instantly, and explains itself.** The champion is plain JSON. The same deterministic
   simulation runs it in your browser, in Node and on a Cloudflare Worker, with no model calls. When a bus holds,
   the inspector shows the rule's own sentence filled in with live numbers: "Holding 45 s for the train (34 s away,
   14 transfers)".
5. **One fast model where speed matters.** For one narrow call, Jev (TypeSafe's decision model) can be consulted:
   whether a bus at a train station should leave now or hold 20, 40 or 60 s. Code generates the legal options, Jev
   picks one, and the rules take over if Jev errors or misses its deadline. Every Jev decision is logged, so replays
   never call it again.
6. **You can try to beat it.** In Play you get the baseline dispatcher plus your own interventions on the exact seed
   the AI is scored on. Doing nothing scores exactly the baseline.
7. **Honest scoring.** A set of sealed test seeds is kept out of the repo, the prompts and the evolution code. It
   scores the champion, the baseline and a hand-written reference only after optimization is done.

## Claims we make, and how each is true

| Claim | Why it holds |
|---|---|
| The models are never retrained; the policy evolves | Designers return JSON policies through an OpenAI-compatible chat API. No weights change anywhere. |
| Rules are designed by DeepSeek V4.1 Flash on Luminal | All 3 designers call `deepseek-ai/DeepSeek-V4.1-Flash` at `flash.luminal.cloud`. A fallback to `deepseek/deepseek-v4-pro` on OpenRouter happens once per call on a timeout, 429 or 5xx, and it is recorded on the proposal. |
| Changes survive only if they measurably help | The promotion gate requires all of: ≥ 1% J gain on 8 training runs, val not worse, completion −1 pt max, and the worst service gap ≤ max(the champion's worst, 15 min). |
| The explanations are not post-hoc | The inspector text is the fired rule's `say` template filled with the actual feature values. |
| Watching and playing make no model calls | The browser runs the rulebook through the deterministic sim. Jev is used only when a policy enables it, and only for station holds. |
| Jev is for station holds | Jev only decides `bus_at_stop` at the 3 station stops, when the advisor is on and its ask condition holds (default: train ≤ 120 s away). |
| The sealed test is never shown to agents | `SEALED_TEST_SEEDS` is kept out of the repo (in the gitignored `.env`). Only the sealed-evaluation path reads it, and nothing in the evolve loop does. The results appear in the Lab panel labelled "never shown to agents". |
| The comparison is fair | All randomness is drawn from the seed before the run. Play is the baseline plus your intents, on the same seed. |

## Fill in before the demo (from the Lab or `sweep`)

| Number | Where to get it |
|---|---|
| Champion id and ΔJ vs g0 on training | the Lab chart, or the "Now dispatching" line on the title card |
| ΔJ vs g0 on validation | the Lab generation card |
| Sealed test: champion vs g0 vs ref | the Lab sealed panel (after `eval-sealed`) |
| Your Play result vs the champion | the Play results screen |

Do not quote a number you have not seen on screen today.

## Why it is interesting

- **Self-improvement without training.** The artifact that improves is small, versioned, diffable and auditable.
  Every generation has a parent, a rule diff and a failure report.
- **Generalisation is checked, not assumed.** There are train, validation and sealed splits. Designers only ever
  hear "promoted" or "rejected: validation worse".
- **Fast at run time by construction.** The LLMs work between games. At run time it is rules (plus Jev for one
  narrow, logged call), so the town plays at 16× in a browser tab.
- **Humans stay in the loop as competitors.** The same Observation, the same seed and the same score are used for
  human and AI.

## What we are not claiming

- That this is a real transit network. It is a toy town with synthetic demand, and the gains hold in this simulator.
- That the baseline is a strawman. `g0` runs 2 buses per route and holds at the terminal to keep even headways.
  `ref` is a hand-written queue-responsive policy that is shown for comparison and never used as a parent.
- That LLMs drive the buses. Designers write rules between games.

## Sponsors and stack

- **Luminal:** serves DeepSeek V4.1 Flash for all three policy designers.
- **OpenRouter:** the designer fallback (DeepSeek V4 Pro), and the route to Jev.
- **TypeSafe Jev:** fast choice-with-probabilities decisions for station holds.
- **Cloudflare:** one Worker serves the app and the Hono API, with D1 for rounds, proposals, generations and the
  leaderboard.
- **Three.js, React, TypeScript:** an isometric town with a deterministic sim that is shared across browser, Node and
  Worker.

## Likely questions

**Is the model learning?**
No weights change. The rulebook improves. Each generation is a new JSON policy written by the designers and kept
only if it passes the gates.

**Isn't this just overfitting to your seeds?**
That is what the validation gate and the sealed test are for. Designers never see validation numbers, and the
sealed seeds never enter the repo, a prompt or the evolve code.

**Why not let the LLM dispatch live?**
Latency, cost and determinism. A rule fires in microseconds and replays exactly. The one decision that benefits from
judgment, the station hold, goes to Jev. Jev has a deadline and a rules fallback, and its answers are logged for
replay.

**How do you know the explanation is what actually happened?**
It is the fired rule's own template, filled with the same feature values the rule tested. Nothing is generated after
the fact.

**Can a human beat it?**
Sometimes, and that is the point of Play. You start from the baseline on the identical seed, so any gain is yours.

**What happens if Luminal is down?**
Each designer call falls back once to OpenRouter. Evolution rounds also run ahead of time from the CLI, so the demo
never waits on a live call.
