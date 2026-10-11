// Owner: T3c. Headless full runs (champion and baseline on the play seed) with pace sampling. Pure: the Web Worker
// (headless.worker.ts) and the main-thread fallback both call runJob with real sim factories; tests pass fakes.
import type { Controller, CreateSimArgs, Policy, RunResult, ScenarioInstance, Sim, TownMap } from '@headway/sim';
import type { PacePoint } from './logic';

export type Who = 'champion' | 'baseline';
export interface HeadlessJob {
  id: number; scenario: ScenarioInstance; sampleEveryS: number;
  runs: Array<{ who: Who; policy: Policy }>;
}
export interface HeadlessRun { who: Who; policyId: string; samples: PacePoint[]; result: RunResult; ms: number; stub: boolean }
export type HeadlessRequest = { type: 'run'; job: HeadlessJob };
export type HeadlessReply =
  | { type: 'run'; id: number; run: HeadlessRun }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };

/** Step a sim to the end, sampling running.jSoFar at t = 0, every `everyS` sim-seconds, and at the end. */
export function runHeadless(create: () => Sim, everyS: number): { samples: PacePoint[]; result: RunResult } {
  const sim = create();
  const samples: PacePoint[] = [{ t: sim.t, j: sim.observe().running.jSoFar }];
  let guard = 0;
  while (!sim.done && guard++ < 100_000) {
    sim.step();
    if (sim.t % everyS === 0) samples.push({ t: sim.t, j: sim.observe().running.jSoFar });
  }
  if (samples[samples.length - 1]!.t !== sim.t) samples.push({ t: sim.t, j: sim.observe().running.jSoFar });
  return { samples, result: sim.result() };
}

export interface RunDeps {
  createSim(a: CreateSimArgs): Sim;
  makeController(p: Policy): Controller;
  map?: TownMap;
  now?: () => number;
  /** True when the factory fell back to the stub sim (engine not ready): the UI labels those numbers. */
  isStub?: (s: Sim) => boolean;
}

export function runJob(job: HeadlessJob, deps: RunDeps, onRun?: (r: HeadlessRun) => void): HeadlessRun[] {
  const now = deps.now ?? (() => 0);
  return job.runs.map(({ who, policy }) => {
    const t0 = now();
    const sim = deps.createSim({ map: deps.map as TownMap, scenario: job.scenario, controller: deps.makeController(policy) });
    const { samples, result } = runHeadless(() => sim, job.sampleEveryS);
    const run: HeadlessRun = { who, policyId: policy.meta.id, samples, result, ms: now() - t0, stub: deps.isStub?.(sim) ?? false };
    onRun?.(run);
    return run;
  });
}
