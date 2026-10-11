// Owner: T4. Evidence digest for designers (spec §8.3), at most 6,000 characters.
// Training evidence only: validation results are reduced to the verdict ("Rejected: validation worse").
import type { Policy, Proposal, RunResult, SplitScore, StopId } from '@headway/sim';
import { aggregateResults, findingLabel, groupFindings } from './aggregate';

export const DIGEST_MAX_CHARS = 6000;
const VERDICT_MARKERS = ['Promoted to ', 'Rejected: ', 'Not promoted: '];

interface Limits { findings: number; stops: number; proposals: number; summaryChars: number; errorChars: number }
const LIMITS: Limits[] = [
  { findings: 8, stops: 8, proposals: 6, summaryChars: 160, errorChars: 160 },
  { findings: 6, stops: 8, proposals: 4, summaryChars: 90, errorChars: 100 },
  { findings: 4, stops: 5, proposals: 2, summaryChars: 60, errorChars: 60 },
];

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
  if (!stops.size) return [];
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

const roundNo = (p: Proposal) => Number(/\d+/.exec(p.roundId)?.[0] ?? 0);

function historySection(history: Proposal[], lim: Limits): string[] {
  const sorted = [...history].sort((x, y) => roundNo(x) - roundNo(y) || x.id.localeCompare(y.id));
  const roundIds = [...new Set(sorted.map((p) => p.roundId))].slice(-2);
  const recent = sorted.filter((p) => roundIds.includes(p.roundId)).slice(-lim.proposals);
  if (!recent.length) return ['## Recent proposals', '(none yet: this is the first round)'];
  return [
    '## Recent proposals (last 2 rounds; validation details are withheld)',
    ...recent.map((p) => {
      const delta = p.deltaTrainPct === null ? '' : ` ΔJ_train ${signedPct(p.deltaTrainPct)}`;
      const verdict = clip(proposalVerdict(p), lim.errorChars);
      return `- ${p.id} [${p.emphasis}]${delta}${verdict ? ` · ${verdict}` : ''} · "${clip(p.summary, lim.summaryChars)}"`;
    }),
  ];
}

export function buildDigest(a: { champion: { policy: Policy; results: RunResult[] }; baseline: SplitScore; reference: SplitScore; history: Proposal[] }): string {
  const { policy, results } = a.champion;
  let text = '';
  for (const lim of LIMITS) {
    text = [
      scoresSection(policy, results, a.baseline, a.reference),
      findingsSection(results, lim.findings),
      stopsSection(results, lim.stops),
      ruleFiresSection(policy, results),
      historySection(a.history, lim),
    ].filter((s) => s.length).map((s) => s.join('\n')).join('\n\n');
    if (text.length <= DIGEST_MAX_CHARS) return text;
  }
  return `${text.slice(0, DIGEST_MAX_CHARS - 1)}…`;
}
