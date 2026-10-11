// Owner: T4. Pure helpers over RunResult[]: split scores, worst gaps, finding keys.
import type { FailureFinding, Metrics, QueuePlace, RunResult, SplitScore } from '@headway/sim';

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Sum J and counts over runs; completion from totals; means weighted (journey by completed, waits by spawned). */
export function aggregateResults(results: RunResult[]): SplitScore {
  const ms = results.map((r) => r.metrics);
  const sum = (f: (m: Metrics) => number) => ms.reduce((acc, m) => acc + f(m), 0);
  const spawned = sum((m) => m.spawned);
  const completed = sum((m) => m.completed);
  const weighted = (f: (m: Metrics) => number, w: (m: Metrics) => number) => {
    const total = sum(w);
    return total > 0 ? round2(sum((m) => f(m) * w(m)) / total) : 0;
  };
  const J = round2(sum((m) => m.J));
  return {
    J,
    runs: results.length,
    metrics: {
      J, spawned, completed, unfinished: sum((m) => m.unfinished),
      completionPct: spawned > 0 ? round2((100 * completed) / spawned) : 0,
      meanJourneyS: weighted((m) => m.meanJourneyS, (m) => m.completed),
      meanWaitS: weighted((m) => m.meanWaitS, (m) => m.spawned),
      p95WaitS: weighted((m) => m.p95WaitS, (m) => m.spawned),
      maxWaitS: ms.reduce((acc, m) => Math.max(acc, m.maxWaitS), 0),
      transfersMade: sum((m) => m.transfersMade),
      missedConnections: sum((m) => m.missedConnections),
      leftBehind: sum((m) => m.leftBehind),
      walkaways: sum((m) => m.walkaways),
      effort: {
        busDistanceU: round2(sum((m) => m.effort.busDistanceU)),
        deadheadDistanceU: round2(sum((m) => m.effort.deadheadDistanceU)),
        holdS: sum((m) => m.effort.holdS),
        trainDwellS: sum((m) => m.effort.trainDwellS),
      },
    },
  };
}

/** Worst per-stop maximum service gap over all runs, stops and routes (seconds). */
export function worstGapS(results: RunResult[]): number {
  let worst = 0;
  for (const r of results) for (const s of r.stops) for (const g of Object.values(s.maxGapS)) if (typeof g === 'number' && g > worst) worst = g;
  return worst;
}

export function placeKey(p: QueuePlace): string {
  return `${p.kind}:${p.id}`;
}

/** Kind + place, used to match findings across runs and between policies (spec §8.4). */
export function findingKey(f: FailureFinding): string {
  switch (f.kind) {
    case 'service_gap': return `service_gap|${f.stopId}|${f.routeId}`;
    case 'missed_transfer': return `missed_transfer|${placeKey(f.at)}|${f.from}|${f.to}`;
    case 'bunching': return `bunching|${f.routeId}`;
    case 'overload': return `overload|${placeKey(f.at)}|${f.routeId}`;
    case 'unused_capacity': return `unused_capacity|${f.routeId}`;
    case 'long_hold': return `long_hold|${f.stopId}`;
  }
}

/** A fallback sentence when a finding carries no text. */
export function findingLabel(f: FailureFinding): string {
  if (f.text) return f.text;
  switch (f.kind) {
    case 'service_gap': return `${f.stopId} went ${Math.round(f.gapS / 60)} min without a ${f.routeId} bus.`;
    case 'missed_transfer': return `${f.count} riders missed the ${f.from} → ${f.to} connection at ${f.at.id}.`;
    case 'bunching': return `${f.routeId} buses bunched ${f.events}× (as close as ${f.minHeadwayS} s).`;
    case 'overload': return `${f.leftBehind} people were left behind at ${f.at.id}; the queue peaked at ${f.peakQueue}.`;
    case 'unused_capacity': return `${f.routeId} ran ${Math.round((1 - f.meanLoad) * 100)}% empty while ${f.elsewhere.stopId} queued ${f.elsewhere.queue}.`;
    case 'long_hold': return `Holding ${f.vehicleId} ${f.holdS} s at ${f.stopId} gained ${f.transfersGained} transfers but delayed ${f.delayedOnboard} riders.`;
  }
}

/** Top `n` findings by impactS across runs (for Proposal/Generation records). */
export function topFindings(results: RunResult[], n = 8): FailureFinding[] {
  return results.flatMap((r) => r.findings).sort((a, b) => b.impactS - a.impactS).slice(0, n);
}

export interface FindingGroup { key: string; scenarioId: string; top: FailureFinding; impactS: number; runs: number }

/** Group findings by scenario + kind + place, summing impact; the strongest instance represents the group. */
export function groupFindings(results: RunResult[]): Map<string, FindingGroup> {
  const groups = new Map<string, FindingGroup>();
  const seen = new Set<string>();
  results.forEach((r, i) => {
    for (const f of r.findings) {
      const key = `${r.scenarioId}|${findingKey(f)}`;
      const g = groups.get(key);
      if (!g) groups.set(key, { key, scenarioId: r.scenarioId, top: f, impactS: f.impactS, runs: 0 });
      else {
        g.impactS += f.impactS;
        if (f.impactS > g.top.impactS) g.top = f;
      }
      const runKey = `${i}|${key}`;
      if (!seen.has(runKey)) { seen.add(runKey); groups.get(key)!.runs++; }
    }
  });
  return groups;
}
