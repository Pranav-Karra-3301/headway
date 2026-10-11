import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { G0 } from '@headway/sim';
import type { Generation, Metrics, ScenarioInstance, SimConfig } from '@headway/sim';
import { aboutFacts, championLine, isAboutHotkey } from '../facts';
import { AboutSheet } from '../AboutSheet';

const metrics = (J: number): Metrics => ({
  J, spawned: 100, completed: 95, unfinished: 5, completionPct: 95, meanJourneyS: 600, meanWaitS: 120, p95WaitS: 400,
  maxWaitS: 700, transfersMade: 10, missedConnections: 4, leftBehind: 2, walkaways: 1,
  effort: { busDistanceU: 1, deadheadDistanceU: 0, holdS: 0, trainDwellS: 0 },
});
const gen = (id: string, number: number, J: number): Generation => ({
  id, number, parentId: number ? `g${number - 1}` : null, policy: { ...G0, meta: { ...G0.meta, id, generation: number } },
  fromProposal: null, explanation: '', train: { J, metrics: metrics(J), runs: 8 }, val: { J, metrics: metrics(J), runs: 4 },
  findings: [], createdAt: '2026-10-11T00:00:00Z',
});
const inst = (scenarioId: string, seed: number, split: ScenarioInstance['split']): ScenarioInstance => ({ scenarioId, seed, split });

describe('aboutFacts', () => {
  it('falls back to the spec values while config and seeds are not loaded', () => {
    const f = aboutFacts({} as SimConfig, { train: [], val: [] });
    expect(f).toEqual({
      buses: 6, maxHoldS: 90, penaltyMin: 45, trainRuns: 8, valRuns: 4,
      trainScenarios: 'stadium exit and class change', seedsPerScenario: 4,
    });
  });
  it('reads the live config and seed splits so tuning never makes the panel wrong', () => {
    const cfg = { bus: { count: 6 }, limits: { maxHoldS: 75 }, objective: { unfinishedPenaltyS: 1800 } } as unknown as SimConfig;
    const train = [1001, 1002, 1003].flatMap((s) => [inst('stadium_exit', s, 'train'), inst('class_change', s, 'train')]);
    const f = aboutFacts(cfg, { train, val: [inst('stadium_exit', 2001, 'val'), inst('class_change', 2001, 'val')] });
    expect(f.maxHoldS).toBe(75);
    expect(f.penaltyMin).toBe(30);
    expect(f.trainRuns).toBe(6);
    expect(f.valRuns).toBe(2);
    expect(f.seedsPerScenario).toBe(3);
    expect(f.trainScenarios).toBe('stadium exit and class change');
  });
});

describe('championLine', () => {
  it('is null before the champion loads', () => {
    expect(championLine(null, [])).toBeNull();
  });
  it('reports the gain over the baseline on the training runs', () => {
    const g4 = gen('g4', 4, 877);
    expect(championLine({ policy: g4.policy, generation: g4 }, [gen('g0', 0, 1000), g4]))
      .toBe('g4 · 12.3% less passenger time than baseline g0 on the training runs');
  });
  it('says so plainly when the baseline is still the champion', () => {
    expect(championLine({ policy: G0, generation: null }, [])).toBe('baseline g0');
    expect(championLine({ policy: G0, generation: gen('g0', 0, 1000) }, [])).toBe('baseline g0');
  });
  it('gives just the id when the baseline score is missing or not beaten', () => {
    const g2 = gen('g2', 2, 1100);
    expect(championLine({ policy: g2.policy, generation: g2 }, [])).toBe('g2');
    expect(championLine({ policy: g2.policy, generation: g2 }, [gen('g0', 0, 1000), g2])).toBe('g2');
  });
});

describe('isAboutHotkey', () => {
  it('opens on ? but not while typing or with modifiers', () => {
    expect(isAboutHotkey({ key: '?' })).toBe(true);
    expect(isAboutHotkey({ key: '?', metaKey: true })).toBe(false);
    expect(isAboutHotkey({ key: '/' })).toBe(false);
    expect(isAboutHotkey({ key: '?', target: { tagName: 'INPUT' } })).toBe(false);
    expect(isAboutHotkey({ key: '?', target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
  });
});

describe('AboutSheet copy', () => {
  const out = renderToStaticMarkup(
    <AboutSheet facts={aboutFacts({} as SimConfig, { train: [], val: [] })} champion={null} generations={[]} onClose={() => {}} />,
  );
  const text = out.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('says what evolves: the dispatch policy, not the model', () => {
    expect(text).toMatch(/dispatch policy/);
    expect(text).toMatch(/never retrained/);
    expect(text).toMatch(/no model calls/);
  });
  it('names the designers and their fallback precisely', () => {
    expect(text).toMatch(/three policy designers/i);
    expect(text).toContain('DeepSeek V4.1 Flash');
    expect(text).toContain('Luminal');
    expect(text).toContain('DeepSeek V4 Pro');
    expect(text).toContain('OpenRouter');
    expect(text).not.toMatch(/GLM/);
  });
  it('scopes Jev to station holds', () => {
    expect(text).toContain('Jev');
    expect(text).toContain('TypeSafe');
    expect(text).toMatch(/station/);
    expect(text).toMatch(/not Jev itself/);
  });
  it('states the evaluation protocol with the live numbers', () => {
    expect(text).toContain('8 training runs');
    expect(text).toContain('4 validation runs');
    expect(text).toContain('45-minute penalty');
    expect(text).toMatch(/at least 1%/);
  });
  it('keeps the sealed test sealed', () => {
    expect(text).toContain('never shown to agents');
    expect(text).toMatch(/never appear in a prompt/);
  });
  it('is a labelled modal dialog with a close button', () => {
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-label="Close/);
  });
});
