# Headway: 4-minute demo script

**URL:** https://headway.pranavkarra001.workers.dev · **Spoken line to land:** *"A team of AI planners teaches the
town's dispatcher, and you can try to beat it."*

The story follows spec §1: **Watch → Play → Lab → Finale.** Times are cumulative. Each beat lists what to click and
what to say. If anything goes wrong, use the fallbacks at the end.

---

## T−30 min checklist

1. **Health:** `curl https://headway.pranavkarra001.workers.dev/api/health` returns `ok: true`, and
   `curl …/api/champion` returns a policy whose `generation` is g1 or later.
2. **Smoke:** `node scripts/smoke/run.mjs --url https://headway.pranavkarra001.workers.dev` passes on `/`, `/play` and
   `/lab`.
3. **Evolution is already done.** Rounds ran earlier with
   `pnpm evolve --rounds 4 --publish https://headway.pranavkarra001.workers.dev`. Never evolve live in the 4 minutes
   (spec §14).
4. **Sealed test is published.** Run
   `pnpm --filter @headway/evolve exec tsx src/cli/eval-sealed.ts --url https://headway.pranavkarra001.workers.dev`.
   The Lab's sealed panel should show champion / g0 / ref.
5. **Numbers on a sticky note:** the champion id, its ΔJ vs g0 on training and on validation, and the sealed-test
   result. Read them off the Lab today. Say only numbers you have seen on screen.
6. **Rehearse one Play round** on today's seed, so you know the two winning moves below land.
7. **Browser:**
   - Open Tab 1 at `…/?intro`, which shows the title card even if you have visited before.
   - Open Tab 2 at `…/lab` as a backup.
   - Set window width ≥ 1440 px and zoom to 100%.
   - Hide the bookmarks bar and turn on Do Not Disturb.
8. **Local fallback is warm** (see Fallbacks):
   - `pnpm build && pnpm --filter @headway/worker dev` is serving http://localhost:8787, or at least `pnpm dev` is
     serving http://localhost:5173.
   - A screen recording of a full run-through is on the desktop.

---

## The script

### 0:00–0:20 Title card

*On screen: the HEADWAY title card over the live town.*

> "This is Headway, a small transit game in a made-up college town loosely based on State College. A stadium just let
> out, six buses and one train have to get everyone home, and every rider is simulated. A team of AI planners teaches
> the town's dispatcher, and you can try to beat it."

Click **Watch the AI** (or press Enter).

### 0:20–1:00 Watch: the rule that actually fired

*On screen: the champion runs the stadium exit. The clock starts at 21:30, and the stadium closes at 21:40.*

1. Click **16×** in the speed chips so the closing comes sooner. As the stadium empties after 21:40, point at the
   queue markers growing at Stadium Gate.
2. Click a bus. In the inspector, read the explanation aloud, for example "Holding 45 s for the train (34 s away, 14
   transfers)".

> "That sentence isn't an AI explaining itself after the fact. It's the rule's own template filled in with the live
> numbers. The dispatcher is a short JSON rulebook, and it runs right here in the browser, with no model calls. The
> AI's job happened earlier: it wrote these rules."

Optional, if time allows: switch the controller to **g0** for a few seconds, then back to **Champion**, to show the
difference.

### 1:00–2:10 Play: same crowd, your turn

1. Click the **Play** tab, skip the coach marks and start. Press `4` for 16×.

   > "Same stadium crowd, same random seed the AI is scored on. I start from the baseline dispatcher. If I do nothing,
   > I score exactly the baseline."
2. **Move 1, pre-stage (before 21:40):** click a Route 1 bus (the inspector says Route 1), press `R`, then `3`. It
   deadheads to Stadium Gate from its next terminal (Central).

   > "Sending a spare bus to the stadium before the doors open."
3. **Move 2, hold for the train:** when the train is about to reach Central with transfers aboard, click the Route 2
   bus at Central and press `H` to hold it 30 s.

   > "Holding this bus so the train's riders make the connection."
4. Click **Finish** to fast-forward the rest.
5. On the results screen, read the verdict line and the You / Champion / Baseline columns.

   > "Identical crowd, identical delays: the only difference is the decisions."

   If you lost, that is fine and on message: "The AI wins this one; that's what the evolved rules are worth."

### 2:10–3:20 Lab: how it learned

1. Click the **Lab** tab.
2. **Timeline and chart:** g0 → gN, with J falling and horizontal lines for g0 and ref.

   > "Each generation is a new rulebook, not a new model. The language models are never retrained."
3. Open the latest generation and show the **rule diff**: added, removed and changed rules and thresholds.
4. Show a round's **three proposal cards**. All are DeepSeek V4.1 Flash on Luminal, each with a different emphasis:
   transfers, spacing or allocation. Show one that was **rejected** and read its failure note, e.g. "Holding at
   Central gained transfers but left Apartments South without service for 14 minutes".

   > "A change survives only if it cuts total passenger time by at least 1% on 8 training runs and is no worse on 4
   > validation runs the designers never see. Every report shows the costs next to the gains."
5. Optional: click **Replay on stadium exit** on a generation to load it into Watch.

### 3:20–3:50 Finale: the sealed test

Point at the sealed panel, labelled **"never shown to agents"**: champion vs g0 vs ref on secret seeds.

> "These seeds never touched the repo, a prompt or the evolution code. They're scored only after optimization,
> for us, not for the AI."

If asked about Jev:

> "One narrow decision, whether a bus at a station holds for a train, can go to Jev, TypeSafe's fast decision model.
> Code offers only legal options, the rules take over if Jev misses its deadline, and every answer is logged so
> replays are exact."

### 3:50–4:00 Close

> "The models never changed. The rulebook got better, it explains every move, and you can try to beat it. Headway."

Press `?` to leave "How Headway works" on screen during Q&A.

---

## Fallbacks

| If… | Then… |
|---|---|
| The title card doesn't appear | Load `…/?intro`. Or skip it: the pitch line works over Watch. |
| The live URL is down or slow | Switch to the local full stack at http://localhost:8787. If that fails, use `pnpm dev` at http://localhost:5173: every `/api` read falls back to `apps/web/public/data/*.json`. If that also fails, play the recording. |
| The canvas is blank on the projector machine (WebGL) | Mirror the laptop instead. If it is still blank, use the recording. |
| Watch shows "Baseline g0" instead of a champion | The champion fetch fell back. Say so plainly, go to the Lab (which also falls back to `/data`), and show the generations there. |
| A bus inspector shows a default action, not a rule | Click another bus that is holding (it has a ring timer), or a bus at Central when the train is due. |
| The Play moves don't win | Read the verdict honestly: "The AI wins by N%." That is the point of the game. |
| The leaderboard submit fails or shows unverified | Skip it. Scores are re-simulated server-side or by `verify-leaderboard`, so mention that and move on. |
| The sealed panel is empty | Say "sealed seeds are scored after optimization; that run isn't published yet", then close on the Lab chart. |
| The Lab has only g0 | Rounds weren't published. Run `pnpm --filter @headway/evolve exec tsx src/cli/export-web.ts` locally and demo from localhost, or narrate one round from the evolve feed. |
| Someone asks for live evolution | Explain that one round is 3–6 model calls plus about 30 simulations, and a designer call may take up to its 90 s timeout. Offer to run it after the demo. "Evolve next generation" replays the last recorded round from `/data/evolve-events.json` (and says so) when the live stream is unavailable. |
| Time is short | Drop the optional beats (g0 toggle, Replay), then the finale. Never drop Watch → Play → Lab. |

## Q&A crib

- **"Is the model being trained?"** No. The rulebook is what improves. Designers propose JSON changes, and only
  measured gains are promoted.
- **"Overfitting?"** There is a validation gate that the designers never see, and a sealed test kept out of the
  repo, the prompts and the evolve code.
- **"Why not have the LLM drive the buses?"** Latency, cost and replayability. Rules fire instantly and replay
  exactly. Jev covers the one judgment call, with a deadline and a rules fallback.
- **"Is the baseline a strawman?"** No. g0 runs 2 buses per route and holds at the terminal for even headways, and
  ref is a hand-written queue-responsive policy shown for comparison.
- **"What's real?"** The town and the demand are synthetic, and gains are measured in this simulator only.
