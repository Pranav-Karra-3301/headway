// Owner: T4. Evidence digest for designers (spec §8.3), at most 6,000 characters.
// Training evidence only: validation results are reduced to the verdict ("Rejected: validation worse").
import { SCENARIOS, TOWN } from '@headway/sim';
import type { Action, DecisionKind, Policy, Proposal, RouteId, Rule, RunResult, ScenarioDef, SplitScore, StopId, Zone, ZoneSelector } from '@headway/sim';
import { aggregateResults, findingLabel, groupFindings } from './aggregate';

export const DIGEST_MAX_CHARS = 6000;
const PROMOTION_GAIN_PCT = 1;
const VERDICT_MARKERS = ['Promoted to ', 'Rejected: ', 'Not promoted: '];

interface Limits {
  findings: number; stops: number; proposals: number; summaryChars: number; errorChars: number; ideaChars: number;
  sharedStops: boolean; probes: number; ruleJson: number;
}
const LIMITS: Limits[] = [
  { findings: 8, stops: 8, proposals: 12, summaryChars: 130, errorChars: 140, ideaChars: 160, sharedStops: true, probes: 8, ruleJson: 3 },
  { findings: 6, stops: 5, proposals: 12, summaryChars: 90, errorChars: 100, ideaChars: 120, sharedStops: true, probes: 8, ruleJson: 3 },
  { findings: 5, stops: 0, proposals: 12, summaryChars: 70, errorChars: 70, ideaChars: 100, sharedStops: false, probes: 8, ruleJson: 3 },
  { findings: 4, stops: 0, proposals: 9, summaryChars: 60, errorChars: 60, ideaChars: 80, sharedStops: false, probes: 8, ruleJson: 2 },
  { findings: 3, stops: 0, proposals: 6, summaryChars: 50, errorChars: 50, ideaChars: 60, sharedStops: false, probes: 6, ruleJson: 1 },
];

/** A measured one-step variant of the champion (see `runProbes` in evaluate.ts). */
export interface DigestProbe { label: string; deltaPct: number; rule?: Rule }

const hours = (s: number) => (s / 3600).toFixed(1);
const mins = (s: number) => (s / 60).toFixed(1);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function signedPct(x: number): string {
  const r = Math.round(x * 10) / 10;
  if (r === 0) return '0.0%';
  return `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(1)}%`;
}

/** The verdict appended to a proposal's narrative by the round runner, if any. */
export function proposalVerdict(p: Proposal): string {
  if (!p.valid) return `invalid: ${p.errors[0] ?? 'unknown error'}`;
  const at = Math.max(...VERDICT_MARKERS.map((m) => p.narrative.lastIndexOf(m)));
  if (at >= 0) return p.narrative.slice(at).trim();
  return p.train ? '' : 'not scored';
}

function scoreRow(label: string, s: SplitScore): string {
  const m = s.metrics;
  return `| ${label} | ${hours(s.J)} | ${mins(m.meanJourneyS)} | ${mins(m.meanWaitS)} / ${mins(m.p95WaitS)} | ${m.completionPct.toFixed(1)} | ${m.missedConnections} | ${m.leftBehind} | ${m.walkaways} | ${m.transfersMade} | ${Math.round(m.effort.holdS)} | ${Math.round(m.effort.deadheadDistanceU)} |`;
}

function scoresSection(policy: Policy, results: RunResult[], baseline: SplitScore, reference: SplitScore): string[] {
  const champ = aggregateResults(results);
  const lines = [
    `## Scores on the training split (${results.length} runs; J in passenger-hours, lower is better)`,
    '| policy | J h | journey min | wait min mean / p95 | completion % | missed connections | left behind | walkaways | transfers | hold s | deadhead u |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    scoreRow(`champion ${policy.meta?.id ?? ''}`.trim(), champ),
    scoreRow('baseline g0', baseline),
    scoreRow('reference ref', reference),
  ];
  const byScenario = new Map<string, { J: number; runs: number }>();
  for (const r of results) {
    const e = byScenario.get(r.scenarioId) ?? { J: 0, runs: 0 };
    e.J += r.metrics.J;
    e.runs++;
    byScenario.set(r.scenarioId, e);
  }
  if (byScenario.size > 1) {
    lines.push(`Champion by scenario: ${[...byScenario].map(([id, e]) => `${id} ${hours(e.J)} h (${e.runs} runs)`).join(' · ')}`);
  }
  return lines;
}

function findingsSection(results: RunResult[], n: number): string[] {
  const groups = [...groupFindings(results).values()].sort((a, b) => b.impactS - a.impactS).slice(0, n);
  if (!groups.length) return ['## Top findings for the champion', '(none)'];
  return [
    '## Top findings for the champion (strongest first)',
    ...groups.map((g, i) => `${i + 1}. ${findingLabel(g.top)} [${g.scenarioId}, ${g.runs}/${results.length} runs, ${Math.round(g.impactS / 60)} pass-min]`),
  ];
}

function stopsSection(results: RunResult[], n: number): string[] {
  const stops = new Map<StopId, { maxQueue: number; waitSum: number; runs: number; gaps: Record<string, number> }>();
  for (const r of results) {
    for (const s of r.stops) {
      const e = stops.get(s.id) ?? { maxQueue: 0, waitSum: 0, runs: 0, gaps: {} };
      e.maxQueue = Math.max(e.maxQueue, s.maxQueue);
      e.waitSum += s.meanWaitS;
      e.runs++;
      for (const [route, g] of Object.entries(s.maxGapS)) if (typeof g === 'number') e.gaps[route] = Math.max(e.gaps[route] ?? 0, g);
      stops.set(s.id, e);
    }
  }
  if (!stops.size || n <= 0) return [];
  const rows = [...stops].sort((a, b) => b[1].maxQueue - a[1].maxQueue).slice(0, n);
  return [
    '## Stops (champion, worst over the training runs)',
    '| stop | max queue | mean wait min | max gap min by route |',
    '|---|---|---|---|',
    ...rows.map(([id, e]) => `| ${id} | ${e.maxQueue} | ${mins(e.waitSum / e.runs)} | ${Object.entries(e.gaps).sort().map(([r, g]) => `${r} ${mins(g)}`).join(', ') || '-'} |`),
  ];
}

function ruleFiresSection(policy: Policy, results: RunResult[]): string[] {
  const fires = new Map<string, number>();
  for (const r of results) for (const [id, n] of Object.entries(r.ruleFires)) fires.set(id, (fires.get(id) ?? 0) + n);
  const fired = [...fires].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const never = (policy.rules ?? []).map((r) => r.id).filter((id) => !(fires.get(id) ?? 0));
  const lines = ['## Rule fires (champion, summed over the training runs)', fired.length ? fired.map(([id, n]) => `${id} ${n}`).join(' · ') : '(no decisions recorded)'];
  if (never.length) lines.push(`never fired: ${never.join(', ')}`);
  return lines;
}

// ---------- routes: pressure from the champion's findings, coverage from the scenario demand ----------

const shortStop = (id: string) => id.replace(/^stop_/, '');
const int = (x: number) => Math.round(x).toLocaleString('en-US');

function selectZones(sel: ZoneSelector): Zone[] {
  if (sel.zones) return TOWN.zones.filter((z) => sel.zones!.includes(z.id));
  return TOWN.zones.filter((z) => (sel.neighborhood === undefined || z.neighborhood === sel.neighborhood) && (sel.tag === undefined || z.tags.includes(sel.tag)));
}

const NEAREST_STOP = new Map<string, StopId>(TOWN.zones.map((z) => {
  let best: { id: StopId; d: number } = { id: TOWN.stops[0]!.id, d: Infinity };
  for (const s of TOWN.stops) {
    const d = Math.hypot(z.door.x - s.p.x, z.door.z - s.p.z);
    if (d < best.d) best = { id: s.id, d };
  }
  return [z.id, best.id];
}));

/** Expected trips per run (mean demand scale) starting and ending nearest each bus stop. */
export function tripsByStop(def: ScenarioDef): Map<StopId, { from: number; to: number }> {
  const out = new Map<StopId, { from: number; to: number }>(TOWN.stops.map((s) => [s.id, { from: 0, to: 0 }]));
  const spread = (sel: ZoneSelector, total: number, key: 'from' | 'to') => {
    const zones = selectZones(sel);
    const w = zones.reduce((a, z) => a + z.weight, 0);
    for (const z of zones) out.get(NEAREST_STOP.get(z.id)!)![key] += (total * z.weight) / (w || 1);
  };
  for (const g of def.demand) {
    spread(g.from, g.total, 'from');
    for (const t of g.to) spread(t.sel, g.total * t.share, 'to');
  }
  return out;
}

interface RouteStats {
  leftBehind: number; missed: number; missedFrom: Map<string, number>; gapRiders: number; gapFlags: number;
  worstGapS: number; worstGapStop: string; bunching: number; unused: Map<string, { runs: number; loadSum: number }>;
}

function routeStats(results: RunResult[]): Map<RouteId, RouteStats> {
  const m = new Map<RouteId, RouteStats>(TOWN.routes.map((r) => [r.id, {
    leftBehind: 0, missed: 0, missedFrom: new Map(), gapRiders: 0, gapFlags: 0, worstGapS: 0, worstGapStop: '', bunching: 0, unused: new Map(),
  }]));
  for (const r of results) {
    for (const s of r.stops) {
      for (const [route, g] of Object.entries(s.maxGapS)) {
        const e = m.get(route as RouteId);
        if (e && typeof g === 'number' && g > e.worstGapS) { e.worstGapS = g; e.worstGapStop = shortStop(s.id); }
      }
    }
    for (const f of r.findings) {
      if (f.kind === 'overload' && f.routeId !== 'train') m.get(f.routeId)!.leftBehind += f.leftBehind;
      else if (f.kind === 'missed_transfer' && f.to !== 'train') {
        const e = m.get(f.to)!;
        e.missed += f.count;
        const k = `${f.from}→${f.to} at ${shortStop(f.at.id)}`;
        e.missedFrom.set(k, (e.missedFrom.get(k) ?? 0) + f.count);
      } else if (f.kind === 'service_gap') { const e = m.get(f.routeId)!; e.gapRiders += f.affected; e.gapFlags++; }
      else if (f.kind === 'bunching') m.get(f.routeId)!.bunching += f.events;
      else if (f.kind === 'unused_capacity') {
        const u = m.get(f.routeId)!.unused;
        const e = u.get(r.scenarioId) ?? { runs: 0, loadSum: 0 };
        e.runs++; e.loadSum += f.meanLoad;
        u.set(r.scenarioId, e);
      }
    }
  }
  return m;
}

/** Riders hurt on each route (left behind + missed connections onto it + caught in flagged service gaps), most first. */
export function pressureRanking(results: RunResult[]): Array<{ routeId: RouteId; hurt: number; worstGapS: number }> {
  return [...routeStats(results)]
    .map(([routeId, e]) => ({ routeId, hurt: e.leftBehind + e.missed + e.gapRiders, worstGapS: e.worstGapS }))
    .sort((a, b) => b.hurt - a.hurt || b.worstGapS - a.worstGapS || a.routeId.localeCompare(b.routeId));
}

function routesSection(policy: Policy, results: RunResult[], lim: Limits): string[] {
  if (!results.length) return [];
  const stats = routeStats(results);
  const runsBy = new Map<string, number>();
  for (const r of results) runsBy.set(r.scenarioId, (runsBy.get(r.scenarioId) ?? 0) + 1);
  const scen = [...runsBy.keys()].flatMap((id) => {
    const def = (SCENARIOS as Record<string, ScenarioDef | undefined>)[id];
    return def ? [{ id, trips: tripsByStop(def) }] : [];
  });
  const demand = (stops: StopId[]) => scen.map(({ id, trips }) => {
    const t = stops.reduce((a, s) => ({ from: a.from + trips.get(s)!.from, to: a.to + trips.get(s)!.to }), { from: 0, to: 0 });
    return `${id} ${int(t.from)}→${int(t.to)}`;
  }).join(' · ') || '-';
  const sole = (s: StopId) => TOWN.stops.find((x) => x.id === s)!.servedRoutes.length === 1;
  const rows = TOWN.routes.map((route) => {
    const e = stats.get(route.id)!;
    const stops = route.stops.map((s) => `${shortStop(s)}${sole(s) ? '*' : ''}`).join(' → ');
    const top = [...e.missedFrom].sort((a, b) => b[1] - a[1])[0];
    const missed = e.missed ? `${int(e.missed)}${top ? ` (${top[0]} ${int(top[1])})` : ''}` : '0';
    const gap = e.worstGapS ? `${mins(e.worstGapS)} at ${e.worstGapStop}${e.gapFlags ? `; ${e.gapFlags} gaps >10 min hit ${int(e.gapRiders)} riders` : ''}` : '-';
    const unused = [...e.unused].map(([id, u]) => `${id} ${u.runs}/${runsBy.get(id) ?? u.runs} runs, ${Math.round((100 * u.loadSum) / u.runs)}% full`).join('; ') || '-';
    return `| ${route.id} ${route.name} | ${policy.params.allocation[route.id]} | ${stops} | ${demand(route.stops.filter(sole))} | ${int(e.leftBehind)} | ${missed} | ${gap} | ${unused} | ${e.bunching} |`;
  });
  const shared = TOWN.stops.filter((s) => s.servedRoutes.length > 1)
    .map((s) => `${shortStop(s.id)} (${s.servedRoutes.join(' ')}${s.stationId ? ', rail station' : ''}) ${demand([s.id])}`);
  const rank = pressureRanking(results);
  return [
    '## Routes (champion, over the training runs)',
    '| route | buses at start | stops, terminal first (* = only this route) | trips/run starting→ending nearest its * stops | left behind | missed connections onto it | worst gap min | flagged unused capacity (mean load) | bunching events |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    ...(lim.sharedStops && shared.length ? [`Shared stops, trips/run starting→ending nearest: ${shared.join('; ')}`] : []),
    `Pressure ranking (most → least): ${rank.map((r) => r.routeId).join(' > ')} (riders hurt = left behind + missed connections + riders in >10 min gaps: ${rank.map((r) => `${r.routeId} ${int(r.hurt)}`).join(', ')})`,
  ];
}

function probesSection(probes: DigestProbe[] | undefined, n: number, ruleJson: number): string[] {
  if (!probes?.length) return [];
  const sorted = [...probes].sort((a, b) => a.deltaPct - b.deltaPct);
  const best = sorted.slice(0, n);
  const rules = sorted.filter((p) => p.rule && p.deltaPct < 0).slice(0, ruleJson);
  return [
    `## Probes (training ΔJ vs champion; negative = better; ${best.length} best of ${probes.length} one-change experiments)`,
    ...best.map((p) => `- ${p.label} → ${signedPct(p.deltaPct)}`),
    ...(best[0]!.deltaPct > -PROMOTION_GAIN_PCT ? [`No one-change probe reaches the −${PROMOTION_GAIN_PCT.toFixed(1)}% promotion gate.`] : []),
    ...(rules.length ? ['Best new-rule probes as rule JSON (adopt exactly or refine):', ...rules.map((p) => `${signedPct(p.deltaPct)} ${JSON.stringify(p.rule)}`)] : []),
  ];
}

// ---------- ideas: a proposal's exact change vs the current champion ----------

const KIND_SHORT: Record<DecisionKind, string> = { bus_at_stop: 'stop', bus_at_terminal: 'terminal', train_at_station: 'train' };

function actionText(a: Action): string {
  switch (a.type) {
    case 'continue': return 'continue';
    case 'dispatch': return 'dispatch';
    case 'hold': return 'seconds' in a ? `hold ${a.seconds}s` : 'hold to headway';
    case 'reassign': return `reassign→${a.to}`;
    case 'setTrainDeparture': return `dwell ${a.dwellS}s`;
  }
}

/** What `p` changes relative to `champion`, compactly ("+terminal reassign→busiest if route_queue<5; alloc 1/2/3"). */
export function ideaOf(p: Policy, champion: Policy): string {
  const body = (r: Rule) => JSON.stringify({ on: r.on, priority: r.priority, when: r.when, do: r.do });
  const champ = new Map(champion.rules.map((r) => [r.id, body(r)]));
  const ids = new Set(p.rules.map((r) => r.id));
  const parts: string[] = [];
  for (const r of p.rules) {
    const prev = champ.get(r.id);
    if (prev === body(r)) continue;
    parts.push(`${prev ? '~' : '+'}${KIND_SHORT[r.on]} ${actionText(r.do)} if ${r.when.map((c) => `${c.f}${c.op}${c.v}`).join('&') || 'always'}`);
  }
  for (const r of champion.rules) if (!ids.has(r.id)) parts.push(`-rule ${r.id}`);
  const a = p.params.allocation, b = champion.params.allocation;
  if (a.r1 !== b.r1 || a.r2 !== b.r2 || a.r3 !== b.r3) parts.push(`alloc ${a.r1}/${a.r2}/${a.r3}`);
  if (p.params.maxHoldS !== champion.params.maxHoldS) parts.push(`maxHoldS ${p.params.maxHoldS}`);
  if (p.params.trainDefaultDwellS !== champion.params.trainDefaultDwellS) parts.push(`trainDefaultDwellS ${p.params.trainDefaultDwellS}`);
  if (JSON.stringify(p.params.targetHeadwayS ?? {}) !== JSON.stringify(champion.params.targetHeadwayS ?? {})) parts.push(`targetHeadwayS ${JSON.stringify(p.params.targetHeadwayS ?? {})}`);
  for (const k of Object.keys(KIND_SHORT) as DecisionKind[]) {
    if (JSON.stringify(p.defaults[k]) !== JSON.stringify(champion.defaults[k])) parts.push(`default ${KIND_SHORT[k]} ${actionText(p.defaults[k])}`);
  }
  return parts.join('; ') || 'same as the champion';
}

const roundNo = (p: Proposal) => Number(/\d+/.exec(p.roundId)?.[0] ?? 0);

function historySection(history: Proposal[], champion: Policy, lim: Limits): string[] {
  const sorted = [...history].sort((x, y) => roundNo(x) - roundNo(y) || x.id.localeCompare(y.id));
  const recent = sorted.slice(-lim.proposals);
  if (!recent.length) return ['## Recent proposals', '(none yet: this is the first round)'];
  const lastRound = sorted.at(-1)!.roundId;
  return [
    `## Recent proposals (last ${new Set(recent.map((p) => p.roundId)).size} rounds, oldest first; idea = exact change vs the current champion; validation details are withheld)`,
    ...recent.map((p) => {
      const delta = p.deltaTrainPct === null ? '' : ` ΔJ_train ${signedPct(p.deltaTrainPct)}`;
      const verdict = clip(proposalVerdict(p).replace(/ \(ΔJ [^)]*\)/, ''), lim.errorChars);
      const summary = p.roundId === lastRound || !p.policy ? ` · "${clip(p.summary, lim.summaryChars)}"` : '';
      const idea = p.policy ? ` · idea: ${clip(ideaOf(p.policy, champion), lim.ideaChars)}` : '';
      return `- ${p.id} [${p.emphasis}]${delta}${verdict ? ` · ${verdict}` : ''}${summary}${idea}`;
    }),
  ];
}

export function buildDigest(a: {
  champion: { policy: Policy; results: RunResult[] }; baseline: SplitScore; reference: SplitScore; history: Proposal[]; probes?: DigestProbe[];
}): string {
  const { policy, results } = a.champion;
  let text = '';
  for (const lim of LIMITS) {
    text = [
      scoresSection(policy, results, a.baseline, a.reference),
      routesSection(policy, results, lim),
      probesSection(a.probes, lim.probes, lim.ruleJson),
      findingsSection(results, lim.findings),
      stopsSection(results, lim.stops),
      ruleFiresSection(policy, results),
      historySection(a.history, policy, lim),
    ].filter((s) => s.length).map((s) => s.join('\n')).join('\n\n');
    if (text.length <= DIGEST_MAX_CHARS) return text;
  }
  return `${text.slice(0, DIGEST_MAX_CHARS - 1)}…`;
}
