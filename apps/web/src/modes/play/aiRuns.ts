// Owner: T3c. Main-thread client for headless.worker.ts. Runs champion + baseline once per (seed, champion) and caches
// the promise; falls back to running inline (deferred a tick) when Workers are unavailable.
import { PolicyController, TOWN, createSim, createStubSim } from '@headway/sim';
import type { CreateSimArgs, Policy, ScenarioInstance, Sim } from '@headway/sim';
import { runJob, type HeadlessJob, type HeadlessReply, type HeadlessRun, type Who } from './headless';

export interface AiRuns { champion: HeadlessRun; baseline: HeadlessRun }

const SAMPLE_EVERY_S = 30;
const cache = new Map<string, Promise<AiRuns>>();
let jobId = 0;

export function aiKey(scenario: ScenarioInstance, champion: Policy, baseline: Policy): string {
  return `${scenario.scenarioId}:${scenario.seed}:${champion.meta.id}:${baseline.meta.id}`;
}

/** Champion and baseline runs on this crowd. `onRun` fires as each finishes (champion first). */
export function aiRunsFor(
  scenario: ScenarioInstance, champion: Policy, baseline: Policy, onRun?: (r: HeadlessRun) => void,
): Promise<AiRuns> {
  const key = aiKey(scenario, champion, baseline);
  const hit = cache.get(key);
  if (hit) {
    if (onRun) void hit.then((r) => { onRun(r.champion); onRun(r.baseline); }, () => {});
    return hit;
  }
  const job: HeadlessJob = {
    id: ++jobId, scenario, sampleEveryS: SAMPLE_EVERY_S,
    runs: [{ who: 'champion', policy: champion }, { who: 'baseline', policy: baseline }],
  };
  const p = viaWorker(job, onRun).catch(() => inline(job, onRun));
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

function collect(runs: HeadlessRun[]): AiRuns {
  const by = (w: Who) => runs.find((r) => r.who === w);
  const champion = by('champion');
  const baseline = by('baseline');
  if (!champion || !baseline) throw new Error('headless runs incomplete');
  return { champion, baseline };
}

function viaWorker(job: HeadlessJob, onRun?: (r: HeadlessRun) => void): Promise<AiRuns> {
  return new Promise<AiRuns>((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./headless.worker.ts', import.meta.url), { type: 'module', name: 'headway-headless' });
    } catch (e) {
      reject(e);
      return;
    }
    const runs: HeadlessRun[] = [];
    const timer = setTimeout(() => { w.terminate(); reject(new Error('headless worker timed out')); }, 60_000);
    const finish = (fn: () => void) => { clearTimeout(timer); w.terminate(); fn(); };
    w.onmessage = (e: MessageEvent<HeadlessReply>) => {
      const m = e.data;
      if (!m || m.id !== job.id) return;
      if (m.type === 'run') { runs.push(m.run); onRun?.(m.run); }
      else if (m.type === 'done') finish(() => { try { resolve(collect(runs)); } catch (err) { reject(err); } });
      else finish(() => reject(new Error(m.message)));
    };
    w.onerror = (e) => { e.preventDefault(); finish(() => reject(new Error(e.message || 'headless worker failed'))); };
    w.postMessage({ type: 'run', job });
  });
}

const stubs = new WeakSet<Sim>();
function createWithFallback(a: CreateSimArgs): Sim {
  try {
    const sim = createSim(a);
    sim.snapshot();
    return sim;
  } catch {
    const sim = createStubSim({ map: a.map, scenario: a.scenario });
    stubs.add(sim);
    return sim;
  }
}

/** Same job on the main thread (deferred so the click that started Play paints first). */
function inline(job: HeadlessJob, onRun?: (r: HeadlessRun) => void): Promise<AiRuns> {
  return new Promise<AiRuns>((resolve, reject) => {
    setTimeout(() => {
      try {
        const runs = runJob(job, {
          createSim: createWithFallback, makeController: (p) => new PolicyController(p), map: TOWN,
          now: () => performance.now(), isStub: (s) => stubs.has(s),
        }, onRun);
        resolve(collect(runs));
      } catch (e) {
        reject(e);
      }
    }, 30);
  });
}
