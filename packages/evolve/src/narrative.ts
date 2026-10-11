// Owner: T4. Proposal narratives from typed findings (spec §8.4).
// "ΔJ −6.1% on training" + top 2 gains + top 2 costs versus the champion, matched by kind and place
// (per scenario) and ranked by the change in summed impactS.
import type { FailureFinding, RunResult } from '@headway/sim';
import { findingLabel, groupFindings, type FindingGroup } from './aggregate';
import { signedPct } from './digest';

const MIN_CHANGE_S = 60; // ignore changes under one passenger-minute
const TOP = 2;

/** The size of a finding in its own unit, for "(now …)" / "(was …)". */
function size(f: FailureFinding): string {
  switch (f.kind) {
    case 'service_gap': return `${Math.round(f.gapS / 60)} min`;
    case 'missed_transfer': return `${f.count} riders`;
    case 'bunching': return `${f.events}×`;
    case 'overload': return `${f.leftBehind} left behind`;
    case 'unused_capacity': return `${Math.round((1 - f.meanLoad) * 100)}% empty`;
    case 'long_hold': return `${f.holdS} s hold`;
  }
}

const noDot = (s: string) => s.trim().replace(/[.\s]+$/, '');

export function proposalNarrative(candidate: RunResult[], champion: RunResult[], deltaTrainPct: number): string {
  const head = `ΔJ ${signedPct(deltaTrainPct)} on training.`;
  const cand = groupFindings(candidate);
  const champ = groupFindings(champion);
  const changes: Array<{ delta: number; c?: FindingGroup; p?: FindingGroup }> = [];
  for (const key of new Set([...cand.keys(), ...champ.keys()])) {
    const c = cand.get(key);
    const p = champ.get(key);
    const delta = (c?.impactS ?? 0) - (p?.impactS ?? 0);
    if (Math.abs(delta) >= MIN_CHANGE_S) changes.push({ delta, ...(c ? { c } : {}), ...(p ? { p } : {}) });
  }
  const gains = changes.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, TOP);
  const costs = changes.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, TOP);
  if (!gains.length && !costs.length) return `${head} No finding changed noticeably.`;

  const parts = [head];
  for (const { c, p } of gains) {
    // p always exists for a gain (impact went down from something)
    parts.push(c ? `Eased: ${noDot(findingLabel(p!.top))} (now ${size(c.top)}).` : `Fixed: ${noDot(findingLabel(p!.top))}.`);
  }
  for (const { c, p } of costs) {
    parts.push(p ? `Worse: ${noDot(findingLabel(c!.top))} (was ${size(p.top)}).` : `New: ${noDot(findingLabel(c!.top))}.`);
  }
  return parts.join(' ');
}
