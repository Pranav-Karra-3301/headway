// Owner: T4. Designer prompts (spec §8.3).
import { POLICY_DSL_DOC } from '@headway/sim';
import type { Emphasis, Policy } from '@headway/sim';

const MAX_REPAIR_ERRORS = 20;

const DIRECTIVES: Record<Emphasis, string> = {
  transfers:
    'TRANSFERS: reduce missed train↔bus connections (riders who reach a stop or platform just after their vehicle left) without starving other stops.',
  spacing:
    'SPACING: keep same-route buses evenly spaced (less bunching, shorter service gaps) without holding so long that riders aboard or downstream pay for it.',
  allocation:
    'ALLOCATION: put buses where the riders are (params.allocation, reassign at terminals, pre-staging before advertised events) without leaving any route without service.',
};

const TOWN = `Town (fixed): 8 stops, 3 bus routes with 6 buses (capacity 40), a 2-car train (capacity 160) on a 3-station rail loop.
- r1 Campus Loop: central_stn → downtown → old_main → university_stn (terminal Central)
- r2 Apartments: central_stn → apts_north → apts_south → downtown (terminal Central)
- r3 Stadium: stadium_gate → stadium_stn → old_main → downtown (terminal Stadium Gate)
- Rail loop: stadium → university → central. Each station pairs with a bus stop (stop_stadium_stn, stop_university_stn, stop_central_stn).
- r1 and r2 share the Central terminal, so moving a bus between them is instant; reassigning to or from r3 deadheads empty along the roads.
- Scenarios (training runs 4 seeds of each; J sums all runs):
  - stadium_exit (clock 21:30): the stadium closing is advertised for t = 600 s (event_in_s counts down to it); about 1,200 fans then leave over roughly 10 minutes, mostly to the apartments, then downtown, campus and Central; plus light background trips.
  - class_change (clock 11:45): class changes advertised at t = 300 s and t = 1,500 s release two pulses of about 350 students from the campus halls to downtown, the apartments and University station; plus background trips.`;

const CONTRACT = `Output contract: reply with ONE json object and nothing else (no markdown, no code fences, no commentary):
{
  "summary": "one sentence, at most 200 characters, saying what changed",
  "rationale": "2-4 sentences: which findings motivated the change and why it should lower J",
  "changes": ["at most 3 short items"],
  "policy": { "meta": {...}, "params": {...}, "rules": [...], "defaults": {...} }
}
- "policy" is the COMPLETE policy (not a diff) in exactly the champion's format.
- Start from the champion and make at most 3 focused, attributable changes (add, edit or remove a rule; move a threshold; change params). Small, targeted edits win more often than rewrites.
- Keep meta as given; the runner stamps id, parent, generation, author and emphasis. You may rewrite meta.summary.
- Never violate minimum service: allocation integers >= 1 summing to 6, and no rule that can leave a stop without its bus for long (a stop going more than 15 minutes without service blocks promotion).
- Use only features whitelisted for each rule's "on" kind with values inside their ranges, legal actions within bounds, unique rule ids matching ^[a-z0-9-]{3,32}$, and only known placeholders in "say".`;

export function designerSystemPrompt(): string {
  const dsl = POLICY_DSL_DOC.trim() || 'Follow the structure of the champion policy exactly.';
  return `You are a transit policy designer for Headway, a small college town. You improve the town's dispatch policy: a bounded JSON rulebook that a deterministic simulator interprets at every decision point (bus at a stop, bus at its terminal, train at a station). No model runs at dispatch time; only your rules do.

Scoring: J = total passenger journey time in passenger-seconds (lower is better); riders still travelling at the end pay a heavy penalty. A proposal is evaluated on fixed training runs, then promoted only if it is at least 1% better on training, no worse on unseen validation runs, keeps completion within 1 point, and does not create long service gaps. Overfitting to the training runs gets rejected.

${TOWN}

# Policy DSL
${dsl}

# ${CONTRACT}`;
}

export function designerUserPrompt(a: { emphasis: Emphasis; champion: Policy; digest: string }): string {
  return `# Your emphasis
${DIRECTIVES[a.emphasis]}

# Champion policy (${a.champion.meta?.id ?? 'champion'})
${JSON.stringify(a.champion, null, 2)}

# Evidence from the training runs
${a.digest}

Propose your improved policy now as a single json object with "summary", "rationale", "changes" and "policy".`;
}

export function repairPrompt(errors: string[]): string {
  const shown = errors.slice(0, MAX_REPAIR_ERRORS);
  const more = errors.length - shown.length;
  return `Your previous reply was rejected by the policy validator:
${shown.map((e) => `- ${e}`).join('\n')}${more > 0 ? `\n- (and ${more} more)` : ''}

Fix every error (remove or rewrite the offending rules if needed) and reply again with the complete json object { "summary", "rationale", "changes", "policy" }. JSON only.`;
}
