// Owner: T4. Designer prompts (spec §8.3). Town and scenario numbers are read from @headway/sim (never hard-coded).
import { DEFAULT_CONFIG, POLICY_DSL_DOC, SCENARIOS, SEEDS, TOWN } from '@headway/sim';
import type { DemandGenerator, Emphasis, Policy, ScenarioDef, Zone, ZoneSelector } from '@headway/sim';

const MAX_REPAIR_ERRORS = 20;
export const MAX_CHANGES = 2;

const DIRECTIVES: Record<Emphasis, string> = {
  transfers:
    'TRANSFERS: reduce missed train↔bus connections (riders who reach a stop or platform just after their vehicle left) without starving other stops.',
  spacing:
    'SPACING: keep same-route buses evenly spaced (less bunching, shorter service gaps) without holding so long that riders aboard or downstream pay for it.',
  allocation:
    'ALLOCATION: put buses where the riders are (params.allocation, reassign at terminals, pre-staging before advertised events) without leaving any route without service; check the digest\'s route table and pressure ranking first.',
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const about = (n: number) => fmt(n >= 200 ? Math.round(n / 10) * 10 : n);
const shortStop = (id: string) => id.replace(/^stop_/, '');
const stopName = (id: string) => TOWN.stops.find((s) => s.id === id)?.name ?? shortStop(id);

function selectZones(sel: ZoneSelector): Zone[] {
  if (sel.zones) return TOWN.zones.filter((z) => sel.zones!.includes(z.id));
  return TOWN.zones.filter((z) => (sel.neighborhood === undefined || z.neighborhood === sel.neighborhood) && (sel.tag === undefined || z.tags.includes(sel.tag)));
}

/** "the apartments 72%, Central Station 14%": destination shares grouped by neighbourhood (stations by name). */
function destinations(g: DemandGenerator, top = 3): string {
  const by = new Map<string, number>();
  for (const t of g.to) {
    const zones = selectZones(t.sel);
    const w = zones.reduce((a, z) => a + z.weight, 0) || 1;
    for (const z of zones) {
      const k = z.tags.includes('station') ? z.name : z.neighborhood === 'apartments' ? 'the apartments' : z.neighborhood;
      by.set(k, (by.get(k) ?? 0) + (t.share * z.weight) / w);
    }
  }
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
}

const origin = (g: DemandGenerator) => {
  const names = selectZones(g.from).map((z) => z.name);
  return names.length <= 3 ? names.join(' + ') : g.from.neighborhood ?? 'many zones';
};

function scenarioLine(def: ScenarioDef, seeds: number): string {
  const crowds = def.demand.filter((g) => g.id !== 'background');
  const background = def.demand.filter((g) => g.id === 'background').reduce((a, g) => a + g.total, 0);
  const crowd = crowds.reduce((a, g) => a + g.total, 0);
  const labels = [...new Set(def.advertised.map((e) => e.label))];
  const events = labels.map((l) => `${l.toLowerCase()} at t = ${def.advertised.filter((e) => e.label === l).map((e) => `${fmt(e.t)} s`).join(' and ')}`).join('; ');
  const parts = crowds.map((g) => {
    const window = g.profile.kind === 'pulse' ? ` from t ≈ ${fmt(g.profile.at)} s over ~${Math.round((g.profile.rampS + g.profile.decayS) / 60)} min` : '';
    return `${about(g.total)} from ${origin(g)}${window} (to ${destinations(g)})`;
  });
  return `  - ${def.id} (clock ${def.clockStart}, ${seeds} training seeds): advertised: ${events || 'nothing'} (event_in_s counts down to the next one). About ${about(crowd)} riders in the crowd: ${parts.join('; ')}; plus about ${about(background)} background trips. Counts vary ×${def.perturb.demandScale.join('–')} per run.`;
}

function townText(): string {
  const { bus, train } = DEFAULT_CONFIG;
  const stations = TOWN.rail.stations;
  const hw = TOWN.rail.advertisedHeadwayS;
  const seedsOf = (id: string) => SEEDS.train.filter((i) => i.scenarioId === id).length;
  const trained = [...new Set(SEEDS.train.map((i) => i.scenarioId))].map((id) => (SCENARIOS as Record<string, ScenarioDef>)[id]).filter((d): d is ScenarioDef => !!d);
  return `Town (fixed): ${TOWN.stops.length} stops, ${TOWN.routes.length} bus routes with ${bus.count} buses (capacity ${bus.capacity}), a train (capacity ${train.capacity}) on a ${stations.length}-station rail line.
${TOWN.routes.map((r) => `- ${r.id} ${r.name}: ${r.stops.map(shortStop).join(' → ')} (terminal ${stopName(r.stops[0]!)}; nominal loop ${Math.round(r.nominalLoopS / 60)} min)`).join('\n')}
- Rail, in travel order: ${stations.map((s) => s.name).join(' → ')} → (back to ${stations[0]!.name}); trains every ${fmt(hw)} s (${Math.round(hw / 30) / 2} min) advertised. Each station pairs with a bus stop (${stations.map((s) => s.stopId).join(', ')}).
- r1 and r2 share the Central terminal, so moving a bus between them is instant; reassigning to or from r3 deadheads empty along the roads.
- Scenarios (J sums every training run):
${trained.map((d) => scenarioLine(d, seedsOf(d.id))).join('\n')}`;
}

const GUIDANCE = `Guidance (facts about this town; follow them):
- Make at most ${MAX_CHANGES} focused changes. One well-aimed change beats several speculative ones.
- The digest's "Probes" section is measured, not guessed: each line is the champion with ONE change (a rule removed, guarded or re-thresholded, a bus moved, a default swapped, or one new single-condition rule added), re-simulated on the training runs. Prefer changes the probes support; you may adopt a probe's rule JSON exactly or refine it (add a guard condition, tune the threshold). Validation runs still decide promotion.
- Promotion needs at least 1% on training, so copying a probe that is less than 1.0% better gets rejected: combine or refine probes, or design a better-guarded new rule.
- "Left behind" means the bus was full when it left: holding a full bus longer cannot pick those riders up; only more capacity there (allocation, a reassign, faster cycles) can.
- Novelty: do not resubmit an idea that failed in the last 4 rounds. "Recent proposals" shows each one's exact change vs the current champion ("idea"); a variant that only moves a threshold or reorders conditions counts as the same idea.
- If you change params.allocation, take buses only from the least-pressured route in the digest's "Pressure ranking" line, and keep every route at >= 1 bus.
- Central is the r1/r2 terminal and a rail station: train riders transfer there to r2, the only route to apts_north and apts_south, so starving r2 strands them (missed connections cost a whole headway).
- There is no bus_at_stop decision at Central (it is a terminal): a bus there only raises bus_at_terminal, which has no train features. A bus_at_stop rule with is_station == 1 fires only for r1 at university_stn and r3 at stadium_stn; it never holds r2.
- bus_at_terminal features cannot tell r1 from r2 (both start at Central) or the stadium closing from a class change, so a terminal reassign rule (especially to "busiest") also pulls r2 buses off the Central transfers unless its conditions rule that out.
- Jev (the advisor) is off for evolution: do not add an "advisor" block; only your rules decide.`;

const CONTRACT = `Output contract: reply with ONE json object and nothing else (no markdown, no code fences, no commentary):
{
  "summary": "one sentence, at most 200 characters, saying what changed",
  "rationale": "2-4 sentences: which findings motivated the change and why it should lower J",
  "changes": ["at most ${MAX_CHANGES} short items"],
  "policy": { "meta": {...}, "params": {...}, "rules": [...], "defaults": {...} }
}
- "policy" is the COMPLETE policy (not a diff) in exactly the champion's format.
- Start from the champion and make at most ${MAX_CHANGES} focused, attributable changes (add, edit or remove a rule; move a threshold; change params). Small, targeted edits win more often than rewrites.
- Keep meta as given; the runner stamps id, parent, generation, author and emphasis. You may rewrite meta.summary.
- Never violate minimum service: allocation integers >= 1 summing to ${DEFAULT_CONFIG.bus.count}, and no rule that can leave a stop without its bus for long (a stop going more than 15 minutes without service blocks promotion).
- Use only features whitelisted for each rule's "on" kind with values inside their ranges, legal actions within bounds, unique rule ids matching ^[a-z0-9-]{3,32}$, and only known placeholders in "say".`;

export function designerSystemPrompt(): string {
  const dsl = POLICY_DSL_DOC.trim() || 'Follow the structure of the champion policy exactly.';
  return `You are a transit policy designer for Headway, a small college town. You improve the town's dispatch policy: a bounded JSON rulebook that a deterministic simulator interprets at every decision point (bus at a stop, bus at its terminal, train at a station). No model runs at dispatch time; only your rules do.

Scoring: J = total passenger journey time in passenger-seconds (lower is better); riders still travelling at the end pay a heavy penalty. A proposal is evaluated on fixed training runs, then promoted only if it is at least 1% better on training, no worse on unseen validation runs, keeps completion within 1 point, and does not create long service gaps. Overfitting to the training runs gets rejected.

${townText()}

${GUIDANCE}

# Policy DSL
${dsl}

# ${CONTRACT}`;
}

export const NEW_RULE_REQUIREMENT = 'This round you MUST add at least one NEW rule (a new id with its own conditions and action), not only threshold, allocation or default edits. A new-rule probe from the digest, adopted or refined, counts.';

export function designerUserPrompt(a: { emphasis: Emphasis; champion: Policy; digest: string; requireNewRule?: boolean }): string {
  return `# Your emphasis
${DIRECTIVES[a.emphasis]}${a.requireNewRule ? `\n\n# Your extra requirement\n${NEW_RULE_REQUIREMENT}` : ''}

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
