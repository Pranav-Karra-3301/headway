// Owner: T3c. Web Worker: runs the champion and the baseline (g0) on the play seed, sampling pace every 30 sim-s,
// so Play can show "You vs AI" live and the results screen without blocking the main thread.
import { PolicyController, TOWN, createSim, createStubSim } from '@headway/sim';
import type { CreateSimArgs, Sim } from '@headway/sim';
import { runJob, type HeadlessReply, type HeadlessRequest } from './headless';

interface WorkerScope {
  postMessage(m: HeadlessReply): void;
  addEventListener(type: 'message', h: (e: MessageEvent<HeadlessRequest>) => void): void;
}
const scope = self as unknown as WorkerScope;
const stubs = new WeakSet<Sim>();

/** The real engine when it works, else the contract-conformant stub sim (labelled in the UI). */
function create(a: CreateSimArgs): Sim {
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

scope.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'run') return;
  const { job } = msg;
  try {
    runJob(
      job,
      { createSim: create, makeController: (p) => new PolicyController(p), map: TOWN, now: () => performance.now(), isStub: (s) => stubs.has(s) },
      (run) => scope.postMessage({ type: 'run', id: job.id, run }),
    );
    scope.postMessage({ type: 'done', id: job.id });
  } catch (err) {
    scope.postMessage({ type: 'error', id: job.id, message: err instanceof Error ? err.message : String(err) });
  }
});
