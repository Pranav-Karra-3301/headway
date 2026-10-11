# Headway — screen-recording guide

Live: **https://headway.pranavkarra.me** (fallback https://headway.pranavkarra001.workers.dev)

## Before you hit record (2 minutes)
1. Open the site once and let the town finish loading (first visit downloads the 3D models) — then reload, it is cached.
2. Chrome window at 1920×1080 (or 1440×900), zoom 100 %, hide the bookmarks bar (⌘⇧B), full screen (⌘⌃F), close other tabs.
3. Do Not Disturb on; nothing else running (all build agents are stopped).
4. Optional: open `https://headway.pranavkarra.me/?intro` in a second tab for the opening title card.

## Shot list (≈ 2 minutes, record each part separately and cut together)

| Part | Where | What to do | One-line voice-over |
|---|---|---|---|
| 1 · Hook (10 s) | `/?intro` | Hold on the title card, click **Watch the AI**. | "Headway is a little town whose bus dispatcher learns." |
| 2 · The town (15 s) | Watch | Drag to pan slowly from campus → stadium → lake; scroll to zoom in a little; click the moon to switch to dusk. | "Campus, downtown, a stadium, a lake — and a regional train through the ridge." |
| 3 · Watch the AI (25 s) | Watch | Click a bus: the card shows the rule that fired. In **Who's dispatching?** switch Baseline → AI champion and point at the comparison bars. | "Every move comes from a readable rule — and on the same crowd the AI gets people home faster." |
| 4 · Play (35 s) | Play | Start → click a bus → **Move a bus here** on the Stadium route before closing → click the train to wait for transfers → **Finish** → results (You vs AI vs Baseline). | "Now you're the dispatcher: same crowd, same tools — can you beat the AI?" |
| 5 · Lab (25 s) | Lab | Hold on the **−6.0 %** headline, then the g0 → g1 → g2 chips and the chart. | "Between games, AI designers on Luminal propose rule changes; the simulator keeps only what holds up on unseen crowds." |
| 6 · Close (5 s) | any | Hold on the town at dusk. | "Headway — headway.pranavkarra.me." |

## Facts to say (all measured, all live)
- Evolved champion **g2: −6.0 % total passenger time on training, −5.3 % on unseen crowds**, beating the hand-written reference (−5.1 % / −4.6 %).
- 16 evolution rounds, 48 proposals from DeepSeek V4.1 Flash on Luminal; only 2 survived the tests — the loop rejects anything that doesn't measurably help.
- The language models are never retrained — the dispatch rulebook evolves. Jev (TypeSafe) can decide station holds in ~0.2 s.
- Deterministic sim (~10 ms per scenario) — the same result in your browser and on the server, so leaderboard scores are verified. Three.js + Cloudflare Workers + D1, built in one day.

## 90-second script (say this)
- **0:00–0:10 Title card** (`/?intro`, then click Watch the AI): "This is Headway — a little college town whose bus dispatcher is designed by AI. You can watch it, play against it, and see how it learned."
- **0:10–0:25 The town** (pan campus → stadium → lake; moon for dusk): "Everything here is simulated: every person has a trip, buses run three routes, and a regional train runs through the ridge and across the bay."
- **0:25–0:45 Watch** (click a bus; switch Who's dispatching? Baseline → AI champion): "When you click a bus, you see the exact rule it just followed — no black box. And on the same crowd, the AI's rules get people home faster than the baseline."
- **0:45–1:10 Play** (Start → click a bus → Move a bus here on Stadium → click the train to wait → Finish): "Now I'm the dispatcher. The stadium is about to empty, so I move a bus to the stadium route and hold the train for transfers. Same crowd, same tools as the AI — and here's my score against it."
- **1:10–1:25 Lab** (−6% headline, g0 → g2): "Between games, DeepSeek designers on Luminal propose rule changes. The simulator tests each one and keeps only what holds up on crowds it's never seen: six percent less total travel time, beating the hand-written plan."
- **1:25–1:30 Close**: "Headway — headway.pranavkarra.me."
Tip: if a crowd's comparison bars don't favour the AI, click New crowd (it wins on average, not on every crowd).
