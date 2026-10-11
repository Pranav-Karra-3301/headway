// What the canvas host runs (T3a). Mode code asks for a session through the store (`loadSession`);
// the host builds the sim: the real engine when it works, else the stub sim, else nothing (static town).
import {
  G0, PolicyController, REF, SEEDS, TOWN, createSim, createStubSim, playInstance,
} from '@headway/sim';
import type { Policy, Replay, ScenarioInstance, Sim } from '@headway/sim';

export type SimKind = 'real' | 'stub' | 'none';
export type WatchChoice = 'g0' | 'ref' | 'champion';

export interface SessionSpec {
  /** Identity. The host rebuilds the sim when the key (or the store's sessionNonce) changes. */
  key: string;
  scenario: ScenarioInstance;
  /** Policy the controller runs (Play: G0 + human intents). */
  policy: Policy;
  /** Short display name, e.g. "Champion g4", "Baseline g0", "You". */
  label: string;
  /** Play: the player's intents apply on top of `policy`. */
  human?: boolean;
  /** Start paused (Play waits on the goal card). */
  paused?: boolean;
  intents?: Replay['intents'];
}

const FALLBACK_SHOWCASE: ScenarioInstance[] = [
  { scenarioId: 'stadium_exit', seed: 4001, split: 'showcase' },
  { scenarioId: 'class_change', seed: 4001, split: 'showcase' },
];

/** Showcase crowds for Watch: stadium exits first (the demo story), stable order otherwise. */
export function showcaseInstances(): ScenarioInstance[] {
  const list = SEEDS?.showcase?.length ? [...SEEDS.showcase] : FALLBACK_SHOWCASE;
  const rank = (s: ScenarioInstance) => (s.scenarioId === 'stadium_exit' ? 0 : s.scenarioId === 'class_change' ? 1 : 2);
  return list.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}

export function showcaseAt(index: number): ScenarioInstance {
  const list = showcaseInstances();
  return list[((index % list.length) + list.length) % list.length]!;
}

/** Day index of the play seed: 0 on 2026-10-11 (UTC), +1 per UTC day. */
export const PLAY_EPOCH_UTC = Date.UTC(2026, 9, 11);
export function playDayIndex(nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - PLAY_EPOCH_UTC) / 86_400_000));
}

export function policyLabel(choice: WatchChoice, champion: Policy | null): string {
  if (choice === 'g0') return 'Baseline g0';
  if (choice === 'ref') return 'Reference';
  return champion ? `Champion ${champion.meta.id}` : 'Champion';
}

export function watchSpec(a: {
  choice: WatchChoice; champion: Policy | null; override: { policy: Policy; label: string } | null; showcaseIndex: number;
}): SessionSpec {
  const scenario = showcaseAt(a.showcaseIndex);
  const policy = a.override?.policy ?? (a.choice === 'g0' ? G0 : a.choice === 'ref' ? REF : a.champion ?? G0);
  const label = a.override?.label ?? policyLabel(a.choice, a.choice === 'champion' ? policy : null);
  return {
    key: `watch:${a.showcaseIndex}:${scenario.scenarioId}:${scenario.seed}:${a.override ? 'replay:' : ''}${policy.meta.id}`,
    scenario, policy, label,
  };
}

export function playSpec(seed?: number): SessionSpec {
  const scenario = seed === undefined || seed <= 0 ? playInstance(playDayIndex()) : { ...playInstance(0), seed };
  return { key: `play:${scenario.scenarioId}:${scenario.seed}`, scenario, policy: G0, label: 'You', human: true, paused: true };
}

/** Builds the sim for a session: real engine → stub sim → throws (caller shows the static town). */
export function createSessionSim(spec: SessionSpec): { sim: Sim; kind: Exclude<SimKind, 'none'>; error: string | null } {
  let realError: string | null = null;
  try {
    const sim = createSim({
      map: TOWN, scenario: spec.scenario, controller: new PolicyController(spec.policy),
      intents: spec.intents,
    });
    sim.snapshot(); // probe: half-built engines throw here rather than mid-frame
    return { sim, kind: 'real', error: null };
  } catch (e) {
    realError = e instanceof Error ? e.message : String(e);
  }
  const sim = createStubSim({ map: TOWN, scenario: spec.scenario });
  sim.snapshot();
  return { sim, kind: 'stub', error: realError };
}
