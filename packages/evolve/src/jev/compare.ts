// Owner: T6. The Jev comparison shown in the Lab (spec §9): the rules-only champion vs Jev with fixed generic instructions
// vs Jev with evolved instructions, all on the same seeds (stadium_exit × 2 train seeds by default). fetch-free: the
// provider is injected (live Jev in the CLI, fakes in tests).
import { DEFAULT_CONFIG, JevController, PolicyController, SEEDS, TOWN, runAsync, runSync } from '@headway/sim';
import type { DecisionProvider, Policy, RunResult, ScenarioInstance, SplitScore, TownMap } from '@headway/sim';
import { aggregateResults } from '../aggregate';

export type JevAdvisor = NonNullable<Policy['advisor']>;
type Req = Parameters<DecisionProvider['choose']>[0];

/** The fixed, deliberately generic instructions of the comparison's middle arm. */
export const JEV_GENERIC_INSTRUCTIONS =
  'You dispatch city buses. A bus is ready to leave a stop next to a train station. Decide whether it departs now or ' +
  'holds briefly. Holding can let riders from an arriving train catch this bus, and can space out a bus that is running ' +
  'too close behind the one ahead. Holding also delays everyone aboard and everyone waiting further along the route. ' +
  'Hold only when the gain clearly outweighs the delay; otherwise depart now.';

export const JEV_DEFAULT_ASK_WHEN: JevAdvisor['askWhen'] = [{ f: 'train_eta_s', op: '<=', v: 120 }];
export const JEV_DEFAULT_HOLD_OPTIONS_S = [0, 20, 40, 60];
const DEFAULT_MODEL = 'typesafe/jev-1.13';
/** CLI deadline per Jev decision (spec §9: 5 s in the CLI, 800 ms in the browser). */
export const JEV_CLI_TIMEOUT_MS = 5_000;

/** stadium_exit × the first 2 train seeds. */
export function jevInstances(): ScenarioInstance[] {
  return SEEDS.train.filter((x) => x.scenarioId === 'stadium_exit').slice(0, 2).map((x) => ({ ...x }));
}

/** A copy of `base` with Jev enabled (unless `enabled: false` is given); missing advisor fields take the defaults. */
export function withJevAdvisor(base: Policy, advisor: Partial<JevAdvisor> & { instructions: string }, idSuffix: string): Policy {
  const p = structuredClone(base);
  p.meta = { ...p.meta, id: `${base.meta.id}-${idSuffix}` };
  p.advisor = {
    provider: 'jev',
    enabled: advisor.enabled ?? true,
    askWhen: structuredClone(advisor.askWhen ?? JEV_DEFAULT_ASK_WHEN),
    holdOptionsS: [...(advisor.holdOptionsS ?? JEV_DEFAULT_HOLD_OPTIONS_S)],
    instructions: advisor.instructions,
  };
  return p;
}

export interface JevRunSummary {
  scenarioId: string; seed: number; J: number; completionPct: number; meanWaitS: number;
  missedConnections: number; transfersMade: number; holdS: number; hash: string;
}
export interface JevSample { situation: string; options: string[]; chosen: string; p: number }
export interface JevArmStats {
  asked: number; answered: number; timeouts: number; errors: number;
  /** Option label → times Jev chose it. */
  chosen: Record<string, number>;
  meanLatencyMs: number | null;
  /** A few requests Jev answered (first ones), for the Lab and the Jev-track designers. */
  samples: JevSample[];
}
export interface JevArm {
  id: 'rules' | 'jev_generic' | 'jev_evolved';
  label: string;
  policyId: string;
  advisor: JevAdvisor | null;
  score: SplitScore;
  /** (J − J_rules) / J_rules × 100; negative = better than the rules. */
  deltaPct: number;
  runs: JevRunSummary[];
  jev: JevArmStats | null;
}
export interface JevCompareReport {
  createdAt: string; simVersion: string; mapVersion: string; model: string; championId: string;
  instances: ScenarioInstance[]; arms: JevArm[]; notes: string[];
  /** Filled by the CLI when it designed the evolved instructions (Jev-track round). */
  design?: unknown;
}

function summarize(r: RunResult): JevRunSummary {
  const m = r.metrics;
  return {
    scenarioId: r.scenarioId, seed: r.seed, J: m.J, completionPct: m.completionPct, meanWaitS: m.meanWaitS,
    missedConnections: m.missedConnections, transfersMade: m.transfersMade, holdS: m.effort.holdS, hash: r.hash,
  };
}

const deltaPct = (j: number, base: number) => (base > 0 ? ((j - base) / base) * 100 : 0);

/** Records the first `limit` answered requests (with the argmax label) while passing calls through. */
function sampling(p: DecisionProvider, samples: JevSample[], limit: number): DecisionProvider {
  const model = (p as { model?: unknown }).model;
  return {
    ...(typeof model === 'string' ? { model } : {}),
    async choose(req: Req) {
      const r = await p.choose(req);
      if (samples.length < limit && Array.isArray(r.probs) && r.probs.length === req.options.length) {
        let best = 0;
        for (let i = 1; i < r.probs.length; i++) if (r.probs[i]! > r.probs[best]!) best = i;
        if (!(r.probs[best]! > 0)) best = r.index;
        samples.push({ situation: req.situation, options: [...req.options], chosen: req.options[best] ?? '?', p: r.probs[best] ?? 0 });
      }
      return r;
    },
  } as DecisionProvider;
}

/** Rules only: `runSync` + `PolicyController` (which ignores `advisor`). */
export function runRulesArm(policy: Policy, instances: ScenarioInstance[], map: TownMap = TOWN): RunResult[] {
  return instances.map((scenario) => runSync({ map, scenario, controller: new PolicyController(policy) }));
}

/** Jev: `runAsync` + `JevController` per instance; stats summed over the runs. */
export async function runJevArm(o: {
  policy: Policy; provider: DecisionProvider; instances: ScenarioInstance[]; timeoutMs?: number; map?: TownMap;
  samples?: number; log?: (s: string) => void;
}): Promise<{ results: RunResult[]; stats: JevArmStats }> {
  const stats: JevArmStats = { asked: 0, answered: 0, timeouts: 0, errors: 0, chosen: {}, meanLatencyMs: null, samples: [] };
  const provider = sampling(o.provider, stats.samples, o.samples ?? 4);
  const results: RunResult[] = [];
  let latency = 0;
  for (const scenario of o.instances) {
    const ctl = new JevController(o.policy, provider, { timeoutMs: o.timeoutMs ?? JEV_CLI_TIMEOUT_MS, ...(o.map ? { map: o.map } : {}) });
    const r = await runAsync({ map: o.map ?? TOWN, scenario, controller: ctl });
    results.push(r);
    const s = ctl.stats;
    stats.asked += s.asked; stats.answered += s.answered; stats.timeouts += s.timeouts; stats.errors += s.errors;
    latency += s.latencyMs;
    for (const [k, v] of Object.entries(s.chosen)) stats.chosen[k] = (stats.chosen[k] ?? 0) + v;
    o.log?.(`  ${o.policy.meta.id} ${scenario.scenarioId}#${scenario.seed}: J ${r.metrics.J} · Jev asked ${s.asked}, answered ${s.answered}`);
  }
  stats.meanLatencyMs = stats.answered > 0 ? Math.round((latency / stats.answered) * 10) / 10 : null;
  return { results, stats };
}

/**
 * Runs the comparison. The evolved arm uses `evolved`, else the champion's own advisor when its instructions differ
 * from the generic ones, else it is omitted (and a note says so).
 */
export async function compareJev(o: {
  champion: Policy;
  provider: DecisionProvider;
  evolved?: JevAdvisor | null;
  genericInstructions?: string;
  instances?: ScenarioInstance[];
  timeoutMs?: number;
  model?: string;
  map?: TownMap;
  now?: () => string;
  log?: (s: string) => void;
}): Promise<JevCompareReport> {
  const createdAt = o.now?.() ?? new Date().toISOString();
  const instances = (o.instances ?? jevInstances()).map((x) => ({ ...x }));
  const generic = o.genericInstructions ?? JEV_GENERIC_INSTRUCTIONS;
  const map = o.map ?? TOWN;
  const providerModel = (o.provider as { model?: unknown }).model;
  const model = o.model ?? (typeof providerModel === 'string' ? providerModel : DEFAULT_MODEL);
  const notes: string[] = [];
  const champAdvisor = o.champion.advisor;
  const evolved: JevAdvisor | null = o.evolved
    ?? (champAdvisor && champAdvisor.instructions.trim() && champAdvisor.instructions !== generic ? { ...champAdvisor, enabled: true } : null);
  if (!evolved) notes.push('No evolved Jev instructions yet (the champion has no advisor of its own): the evolved arm is omitted.');

  o.log?.(`rules-only ${o.champion.meta.id} on ${instances.length} runs`);
  const rulesResults = runRulesArm(o.champion, instances, map);
  const rulesScore = aggregateResults(rulesResults);
  const arms: JevArm[] = [{
    id: 'rules', label: `Rules only (${o.champion.meta.id})`, policyId: o.champion.meta.id, advisor: null,
    score: rulesScore, deltaPct: 0, runs: rulesResults.map(summarize), jev: null,
  }];

  const jevArm = async (id: 'jev_generic' | 'jev_evolved', label: string, policy: Policy): Promise<JevArm> => {
    o.log?.(`${label}: ${policy.meta.id}`);
    const { results, stats } = await runJevArm({ policy, provider: o.provider, instances, timeoutMs: o.timeoutMs, map, log: o.log });
    const score = aggregateResults(results);
    return {
      id, label, policyId: policy.meta.id, advisor: structuredClone(policy.advisor!), score,
      deltaPct: deltaPct(score.J, rulesScore.J), runs: results.map(summarize), jev: stats,
    };
  };
  arms.push(await jevArm('jev_generic', 'Jev, generic instructions', withJevAdvisor(o.champion, { instructions: generic }, 'jev-generic')));
  if (evolved) {
    arms.push(await jevArm('jev_evolved', 'Jev, evolved instructions', withJevAdvisor(o.champion, { ...evolved, enabled: true }, 'jev-evolved')));
  }
  for (const a of arms) if (a.jev && a.jev.timeouts + a.jev.errors > 0) notes.push(`${a.label}: ${a.jev.timeouts} timeouts and ${a.jev.errors} errors fell back to the rules.`);

  return {
    createdAt, simVersion: DEFAULT_CONFIG.simVersion, mapVersion: map.version, model, championId: o.champion.meta.id,
    instances, arms, notes,
  };
}
