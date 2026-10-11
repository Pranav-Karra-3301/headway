// Owner: T1a. The deterministic engine (spec §5): public entry points.
import type { Controller, CreateSimArgs, DecisionKind, FeatureVector, Itinerary, PassengerSpec, RunResult, Sim } from '../contracts';
import { Engine, engineTestHooks, setEngineTestHooks, type EngineTestHooks } from './engine';

export type { EngineTestHooks };

/** Opaque handle for `computeFeatures`: a sim created by `createSim` plus the deciding vehicle. */
export interface FeatureContext { sim: Sim; vehicleId: string }

export function createSim(a: CreateSimArgs): Sim {
  return new Engine(a);
}

/** Headless run with a sync controller. */
export function runSync(a: CreateSimArgs & { controller: Controller }): RunResult {
  if ((a.controller as { async?: boolean }).async) throw new Error('runSync needs a sync controller (use runAsync)');
  const sim = new Engine(a);
  while (!sim.done) sim.step();
  return sim.result();
}

/** Headless run that awaits async decisions. */
export async function runAsync(a: CreateSimArgs): Promise<RunResult> {
  const sim = new Engine(a);
  while (!sim.done) {
    const { pending } = sim.step();
    if (pending) await sim.waitPending();
  }
  return sim.result();
}

/** The §6 feature vector for a vehicle right now (the numbers the rules and the HUD inspector see). */
export function computeFeatures(kind: DecisionKind, ctx: FeatureContext): FeatureVector {
  if (!(ctx?.sim instanceof Engine)) throw new Error('computeFeatures: ctx.sim must come from createSim');
  return ctx.sim.featuresFor(kind, ctx.vehicleId);
}

/** Test hook (spec §12): replace demand / planner / collector / scenario for sims created while set. */
export function __setEngineTestHooks(h: EngineTestHooks | null): void {
  setEngineTestHooks(h);
}

/** Test hook (spec §12 golden journey): force itineraries for sims created while set (null clears). */
export function __forceItinerary(f: ((spec: PassengerSpec) => Itinerary | null) | null): void {
  const h = { ...engineTestHooks() };
  if (f) h.itinerary = f; else delete h.itinerary;
  setEngineTestHooks(h);
}
