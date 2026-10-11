// Owner: Task M. Scenario definitions and seed splits (spec §5.7, §7). Totals are tunable.
//
// ZoneSelector semantics (for demand generators): `zones` lists explicit zone ids; otherwise every zone matching
// `neighborhood` AND `tag` (an omitted field matches all). Zones are weighted by `zone.weight`. Generators never
// send a passenger to their own origin zone (the passenger generator redraws).
import type { ScenarioDef, ScenarioInstance, ScenarioKind, ZoneSelector } from './contracts';

function fail(what: string): never {
  throw new Error(`scenarios: unknown ${what}`);
}

/** Every zone except the stadium gates (background trips start and end anywhere else). */
const EVERYWHERE_BUT_STADIUM: ZoneSelector = {
  zones: [
    'z_old_main', 'z_willard', 'z_pattee', 'z_west_halls',
    'z_main_market', 'z_beaver_shops', 'z_allen_corner', 'z_central_plaza',
    'z_eastview', 'z_parkside', 'z_southside', 'z_garden_row',
    'z_stn_stadium', 'z_stn_university', 'z_stn_central',
  ],
};
const background = (total: number) => ({
  id: 'background', from: EVERYWHERE_BUT_STADIUM, to: [{ sel: EVERYWHERE_BUT_STADIUM, share: 1 }], total,
  profile: { kind: 'uniform' as const, start: 0, end: 1800 },
});
const HALLS: ZoneSelector = { neighborhood: 'campus', tag: 'hall' };
const SHOPS: ZoneSelector = { neighborhood: 'downtown', tag: 'retail' };
const HOMES: ZoneSelector = { neighborhood: 'apartments', tag: 'housing' };

const STADIUM_EXIT: ScenarioDef = {
  id: 'stadium_exit', kind: 'stadium_exit', name: 'Stadium exit', clockStart: '21:30',
  durationS: 1800, clearingS: 900,
  demand: [
    {
      id: 'stadium_crowd', from: { neighborhood: 'stadium', tag: 'stadium' },
      to: [
        { sel: HOMES, share: 0.45 },
        { sel: SHOPS, share: 0.25 },
        { sel: HALLS, share: 0.15 },
        { sel: { zones: ['z_stn_central'] }, share: 0.15 },
      ],
      // Tuned (Wave 1 integration): 1,000 rather than the spec's 1,200 keeps g0 above 85% completion on every
      // train/val/showcase/play seed while Old Main still queues 250–300 at the peak.
      total: 1000, profile: { kind: 'pulse', at: 600, rampS: 120, decayS: 420 },
    },
    background(300),
  ],
  advertised: [{ kind: 'stadium_closing', t: 600, label: 'Stadium closes' }],
  perturb: {
    demandScale: [0.9, 1.1],
    trafficScale: [0.85, 1.15],
    stadiumCongestion: { radius: 10, speedScale: 0.6, fromT: 600, toT: 1200 },
    trainDelay: { chance: 0.15, extraS: [10, 60] },
  },
};

const classPulse = (id: string, at: number) => ({
  id, from: HALLS,
  to: [
    { sel: SHOPS, share: 0.4 },
    { sel: HOMES, share: 0.35 },
    { sel: { zones: ['z_stn_university'] }, share: 0.25 },
  ],
  total: 350, profile: { kind: 'pulse' as const, at, rampS: 90, decayS: 300 },
});

const CLASS_CHANGE: ScenarioDef = {
  id: 'class_change', kind: 'class_change', name: 'Class change', clockStart: '11:45',
  durationS: 1800, clearingS: 900,
  demand: [classPulse('class_change_1', 300), classPulse('class_change_2', 1500), background(200)],
  advertised: [
    { kind: 'class_change', t: 300, label: 'Classes change' },
    { kind: 'class_change', t: 1500, label: 'Classes change' },
  ],
  perturb: {
    demandScale: [0.9, 1.1],
    trafficScale: [0.85, 1.15],
    stadiumCongestion: null,
    trainDelay: { chance: 0.1, extraS: [10, 45] },
  },
};

/** Stretch scenario: defined so the pipeline can run it; not tuned. */
const RUSH: Array<[number, number]> = [[0, 0.5], [600, 1.4], [1200, 1.2], [1800, 0.4]];
const EVENING_COMMUTE: ScenarioDef = {
  id: 'evening_commute', kind: 'evening_commute', name: 'Evening commute', clockStart: '17:15',
  durationS: 1800, clearingS: 900,
  demand: [
    { id: 'commute_campus', from: HALLS, to: [{ sel: HOMES, share: 1 }], total: 300, profile: { kind: 'piecewise', points: RUSH } },
    { id: 'commute_downtown', from: SHOPS, to: [{ sel: HOMES, share: 1 }], total: 400, profile: { kind: 'piecewise', points: RUSH } },
    {
      id: 'train_arrivals', from: { tag: 'station' }, to: [{ sel: HOMES, share: 0.7 }, { sel: HALLS, share: 0.3 }],
      total: 200, profile: { kind: 'uniform', start: 0, end: 1800 },
    },
    background(150),
  ],
  advertised: [],
  perturb: {
    demandScale: [0.9, 1.1],
    trafficScale: [0.85, 1.15],
    stadiumCongestion: null,
    trainDelay: { chance: 0.1, extraS: [10, 45] },
  },
};

export const SCENARIOS: Record<ScenarioKind, ScenarioDef> = {
  stadium_exit: STADIUM_EXIT,
  class_change: CLASS_CHANGE,
  evening_commute: EVENING_COMMUTE,
};

const MAIN: ScenarioKind[] = ['stadium_exit', 'class_change'];
const instances = (seeds: number[], split: ScenarioInstance['split']): ScenarioInstance[] =>
  MAIN.flatMap((scenarioId) => seeds.map((seed) => ({ scenarioId, seed, split })));

export const SEEDS: { train: ScenarioInstance[]; val: ScenarioInstance[]; showcase: ScenarioInstance[] } = {
  train: instances([1001, 1002, 1003, 1004], 'train'),
  val: instances([2001, 2002], 'val'),
  showcase: instances([4001, 4002, 4003], 'showcase'),
};

/** Play mode: stadium_exit on seed 50000 + UTC days since 2026-10-11. */
export function playInstance(dayIndex: number): ScenarioInstance {
  return { scenarioId: 'stadium_exit', seed: 50000 + dayIndex, split: 'play' };
}

export function scenarioDef(id: string): ScenarioDef {
  return (SCENARIOS as Record<string, ScenarioDef>)[id] ?? fail('scenario ' + id);
}
