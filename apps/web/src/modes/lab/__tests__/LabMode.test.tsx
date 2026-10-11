import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { BASELINE, EVOLVE_EVENTS, GENERATIONS, REFERENCE, ROUNDS } from '../../../fixtures';
import type { LabState } from '../../../state/store';
import { LabView } from '../LabMode';
import type { LabLocal } from '../labStore';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let lab: LabState;
let local: LabLocal;

function setup(over: { selected?: string | null; events?: typeof EVOLVE_EVENTS; liveOpen?: boolean; focusRoundId?: string | null; focusProposalId?: string | null } = {}) {
  lab = {
    generations: GENERATIONS, rounds: ROUNDS, selectedGenerationId: over.selected ?? null,
    evolveEvents: over.events ?? [], evolving: false,
  };
  local = {
    status: 'ready', source: 'sample', baseline: BASELINE.train, reference: REFERENCE.train,
    sealed: [
      { policyId: 'g0', J: BASELINE.val.J, metrics: BASELINE.val.metrics, runs: 6, simVersion: null, createdAt: null },
      { policyId: 'ref', J: REFERENCE.val.J, metrics: REFERENCE.val.metrics, runs: 6, simVersion: null, createdAt: null },
      { policyId: 'g4', J: GENERATIONS[4]!.val.J, metrics: GENERATIONS[4]!.val.metrics, runs: 6, simVersion: null, createdAt: null },
    ],
    focusRoundId: over.focusRoundId ?? null, focusProposalId: over.focusProposalId ?? null,
    tokenOpen: false, liveOpen: over.liveOpen ?? false,
  };
}

const render = () => text(renderToString(<LabView lab={lab} local={local} />));

describe('LabView (server render with fixtures)', () => {
  beforeEach(() => setup());

  it('renders explainer, champion summary, chart, collapsed round timeline, diff and sealed panel in order', () => {
    const t = render();
    const order = ['three AI designers on Luminal', 'Champion', 'Objective J by round', 'Rounds', 'Rule diff g3 → g4', 'Sealed test'];
    let at = -1;
    for (const s of order) { const i = t.indexOf(s, at + 1); expect(i, s).toBeGreaterThan(at); at = i; }
    expect(t).toContain('Unseen validation');
    expect(t).toContain('Hand-written ref');
    expect(t).toContain('Replay on stadium exit');
    expect(t).toContain('Evolve next generation');
    expect(t).toContain('never shown to agents');
    expect(t).toContain('sample data');
    for (const r of ROUNDS) expect(t).toContain(`Round ${r.number}`);
    const champRound = ROUNDS.find((r) => r.championAfter === 'g4')!;
    const runnerUp = champRound.proposals.find((p) => p.valid && p.summary && p.id !== GENERATIONS[4]!.fromProposal)!;
    expect(t).not.toContain(runnerUp.summary.slice(0, 30));
  });

  it('expands a round to show its three proposals', () => {
    const champRound = ROUNDS.find((r) => r.championAfter === 'g4')!;
    setup({ focusRoundId: champRound.id });
    const t = render();
    for (const p of champRound.proposals) expect(t).toContain(p.emphasis);
    expect(t).toContain('Promoted');
  });

  it('shows the rules of g0 when the baseline is picked', () => {
    setup({ selected: 'g0' });
    const t = render();
    expect(t).toContain('Rules in g0');
    expect(t).toContain('even-headway');
  });

  it('shows a rejected round when picked on the timeline', () => {
    const rejected = ROUNDS.find((r) => r.championAfter === r.championBefore)!;
    setup({ selected: rejected.championBefore, focusRoundId: rejected.id });
    const t = render();
    expect(t).toContain(`Round ${rejected.number}`);
    expect(t).toContain('rejected');
  });

  it('shows validation errors for an invalid proposal', () => {
    const round = ROUNDS[ROUNDS.length - 1]!;
    const bad = round.proposals.find((p) => !p.valid)!;
    setup({ focusRoundId: round.id, focusProposalId: bad.id });
    const t = render();
    expect(t).toContain(`${bad.id} · validation errors`);
    expect(t).toContain(bad.errors[0]!.slice(0, 20));
  });

  it('still diffs a generation whose round was not published', () => {
    setup({ selected: 'g2' });
    lab = { ...lab, rounds: [] };
    const t = render();
    expect(t).toContain('No rounds are published yet');
    expect(t).toContain('Rule diff g1 → g2');
  });

  it('renders the live feed lanes from streamed events', () => {
    setup({ events: EVOLVE_EVENTS, liveOpen: true });
    const t = render();
    expect(t).toMatch(/Live round \d+/);
    expect(t).toMatch(/Promoted g\d|No promotion/);
  });
});
