// Owner: T7. Facts the landing card and the About panel state. Tunable numbers are read from the live sim
// config and seed splits (spec values are only the fallback), so tuning can never make the copy wrong.
import type { Generation, Policy, ScenarioInstance, SimConfig } from '@headway/sim';

/** Spec §1 pitch line, verbatim. */
export const PITCH = "A team of AI planners teaches the town's dispatcher, and you can try to beat it.";
/** Spec §2/§8.2: all three designers run this model on Luminal; OpenRouter serves the fallback and Jev. */
export const DESIGNER_MODEL = 'DeepSeek V4.1 Flash';
export const FALLBACK_MODEL = 'DeepSeek V4 Pro';

export interface AboutFacts {
  buses: number;
  /** Hard cap on any single hold (SimConfig.limits.maxHoldS). */
  maxHoldS: number;
  /** Penalty per unfinished rider, in minutes (SimConfig.objective.unfinishedPenaltyS). */
  penaltyMin: number;
  trainRuns: number;
  valRuns: number;
  /** e.g. "stadium exit and class change". */
  trainScenarios: string;
  /** Seeds per training scenario, when the split is balanced. */
  seedsPerScenario: number | null;
}

const SPEC = { buses: 6, maxHoldS: 90, penaltyS: 2700, trainRuns: 8, valRuns: 4, scenarios: ['stadium_exit', 'class_change'] };

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

function humanList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function aboutFacts(
  cfg: SimConfig | undefined,
  seeds: { train: ScenarioInstance[]; val: ScenarioInstance[] } | undefined,
): AboutFacts {
  const train = seeds?.train?.length ? seeds.train : null;
  const val = seeds?.val?.length ? seeds.val : null;
  const scenarioIds = train ? [...new Set(train.map((s) => s.scenarioId))] : SPEC.scenarios;
  const trainRuns = train?.length ?? SPEC.trainRuns;
  const perScenario = trainRuns / Math.max(1, scenarioIds.length);
  const penaltyS = positive(cfg?.objective?.unfinishedPenaltyS) ? cfg.objective.unfinishedPenaltyS : SPEC.penaltyS;
  return {
    buses: positive(cfg?.bus?.count) ? cfg.bus.count : SPEC.buses,
    maxHoldS: positive(cfg?.limits?.maxHoldS) ? cfg.limits.maxHoldS : SPEC.maxHoldS,
    penaltyMin: Math.round(penaltyS / 60),
    trainRuns,
    valRuns: val?.length ?? SPEC.valRuns,
    trainScenarios: humanList(scenarioIds.map((id) => id.replace(/_/g, ' '))),
    seedsPerScenario: Number.isInteger(perScenario) ? perScenario : null,
  };
}

export type ChampionInfo = { policy: Policy; generation: Generation | null } | null;

/** "g4 · 12.3% less passenger time than baseline g0 on the training runs", computed from loaded data only. */
export function championLine(champion: ChampionInfo, generations: Generation[]): string | null {
  if (!champion) return null;
  const isBaseline = champion.generation ? champion.generation.number === 0 : champion.policy.meta.id === 'g0';
  if (isBaseline) return 'baseline g0';
  const id = champion.generation?.id ?? champion.policy.meta.id;
  const j = champion.generation?.train?.J;
  const j0 = generations.find((g) => g.number === 0)?.train?.J;
  if (positive(j) && positive(j0) && j < j0) {
    return `${id} · ${(((j0 - j) / j0) * 100).toFixed(1)}% less passenger time than baseline g0 on the training runs`;
  }
  return id;
}

type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown };

/** `?` toggles the About panel, except while typing in a field. */
export function isAboutHotkey(e: KeyLike): boolean {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''))) return false;
  return true;
}
