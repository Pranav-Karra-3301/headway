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

/** The same size as a number, to check that "(now …)" / "(was …)" moves in the direction of the change. */
function magnitude(f: FailureFinding): number {
  switch (f.kind) {
    case 'service_gap': return f.gapS;
    case 'missed_transfer': return f.count;
    case 'bunching': return f.events;
    case 'overload': return f.leftBehind;
    case 'unused_capacity': return 1 - f.meanLoad;
    case 'long_hold': return f.holdS;
  }
}

/** Groups are ranked by impact summed over runs, while the sentence shows the strongest single instance; when that
 *  instance moved the other way (fewer riders, but in more runs), quote the summed change instead. */
const paxMin = (deltaS: number) => `${deltaS < 0 ? '−' : '+'}${Math.round(Math.abs(deltaS) / 60)} pax-min over the training runs`;

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
  for (const { delta, c, p } of gains) {
    // p always exists for a gain (impact went down from something)
    if (!c) parts.push(`Fixed: ${noDot(findingLabel(p!.top))}.`);
    else parts.push(`Eased: ${noDot(findingLabel(p!.top))} (${magnitude(c.top) < magnitude(p!.top) ? `now ${size(c.top)}` : paxMin(delta)}).`);
  }
  for (const { delta, c, p } of costs) {
    if (!p) parts.push(`New: ${noDot(findingLabel(c!.top))}.`);
    else parts.push(`Worse: ${noDot(findingLabel(c!.top))} (${magnitude(c!.top) > magnitude(p.top) ? `was ${size(p.top)}` : paxMin(delta)}).`);
  }
  return parts.join(' ');
}
