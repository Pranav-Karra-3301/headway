import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { G0 } from '@headway/sim';
import type { Generation, Metrics, Policy } from '@headway/sim';
import {
  LANDING_SEEN_KEY, PITCH, cleanIntroSearch, isForced, markSeen, readSeen, shouldShowLanding,
} from '../landingLogic';
import { LandingCard } from '../LandingCard';

const ctx = (p: Partial<Parameters<typeof shouldShowLanding>[0]> = {}) =>
  ({ pathname: '/', search: '', seen: false, automated: false, ...p });

describe('shouldShowLanding', () => {
  it('shows on a first human visit to Watch (/)', () => {
    expect(shouldShowLanding(ctx())).toBe(true);
  });
  it('stays hidden once seen', () => {
    expect(shouldShowLanding(ctx({ seen: true }))).toBe(false);
  });
  it('never covers a deep link to Play or the Lab', () => {
    for (const pathname of ['/play', '/lab', '/lab/g3', '/play/']) {
      expect(shouldShowLanding(ctx({ pathname }))).toBe(false);
      expect(shouldShowLanding(ctx({ pathname, search: '?intro' }))).toBe(false);
    }
  });
  it('stays out of the way of automated browsers (smoke tests, screenshots)', () => {
    expect(shouldShowLanding(ctx({ automated: true }))).toBe(false);
  });
  it('?intro forces it on / (demo), even when seen or automated', () => {
    expect(shouldShowLanding(ctx({ search: '?intro', seen: true }))).toBe(true);
    expect(shouldShowLanding(ctx({ search: '?x=1&intro=1', automated: true }))).toBe(true);
    expect(shouldShowLanding(ctx({ search: '?intro=0', seen: true }))).toBe(false);
  });
});

describe('isForced / cleanIntroSearch', () => {
  it('detects the intro flag', () => {
    expect(isForced('')).toBe(false);
    expect(isForced('?intro')).toBe(true);
    expect(isForced('?intro=1')).toBe(true);
    expect(isForced('?intro=0')).toBe(false);
    expect(isForced('?introduction=1')).toBe(false);
  });
  it('removes only the intro flag', () => {
    expect(cleanIntroSearch('?intro')).toBe('');
    expect(cleanIntroSearch('?a=1&intro&b=2')).toBe('?a=1&b=2');
    expect(cleanIntroSearch('?a=1')).toBe('?a=1');
    expect(cleanIntroSearch('')).toBe('');
  });
});

describe('seen flag storage', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it('round-trips through storage', () => {
    const s = mem();
    expect(readSeen(s)).toBe(false);
    markSeen(s);
    expect(s.m.get(LANDING_SEEN_KEY)).toBe('1');
    expect(readSeen(s)).toBe(true);
  });
  it('tolerates missing or throwing storage (private mode)', () => {
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readSeen(boom)).toBe(false);
    expect(() => markSeen(boom)).not.toThrow();
    expect(readSeen(null)).toBe(false);
    expect(() => markSeen(undefined)).not.toThrow();
  });
});

const metrics = (J: number): Metrics => ({
  J, spawned: 100, completed: 95, unfinished: 5, completionPct: 95, meanJourneyS: 600, meanWaitS: 120, p95WaitS: 400,
  maxWaitS: 700, transfersMade: 10, missedConnections: 4, leftBehind: 2, walkaways: 1,
  effort: { busDistanceU: 1, deadheadDistanceU: 0, holdS: 0, trainDwellS: 0 },
});
const gen = (id: string, number: number, J: number, policy: Policy = G0): Generation => ({
  id, number, parentId: number ? `g${number - 1}` : null, policy, fromProposal: null, explanation: '',
  train: { J, metrics: metrics(J), runs: 8 }, val: { J, metrics: metrics(J), runs: 4 }, findings: [], createdAt: '2026-10-11T00:00:00Z',
});

describe('LandingCard', () => {
  const html = (p: Partial<Parameters<typeof LandingCard>[0]> = {}) =>
    renderToStaticMarkup(<LandingCard onChoose={() => {}} onAbout={() => {}} champion={null} generations={[]} {...p} />);

  it('shows the wordmark, the pitch line and the three modes', () => {
    const out = html();
    expect(out).toContain('HEADWAY');
    expect(out).toContain(PITCH.replace("'", '&#x27;'));
    for (const m of ['Watch', 'Play', 'Lab']) expect(out).toContain(m);
  });
  it('makes only precise claims about the AI', () => {
    const out = html();
    expect(out).toContain('DeepSeek V4.1 Flash');
    expect(out).toContain('Luminal');
    expect(out).toMatch(/never retrained/);
    expect(out).toMatch(/no model calls/);
    expect(out).not.toMatch(/GLM/);
  });
  it('shows the champion gain vs the baseline when the data is loaded', () => {
    const g4 = gen('g4', 4, 877);
    const out = html({ champion: { policy: g4.policy, generation: g4 }, generations: [gen('g0', 0, 1000), g4] });
    expect(out).toContain('g4');
    expect(out).toContain('12.3%');
  });
  it('omits the champion line when nothing is loaded', () => {
    expect(html()).not.toContain('Now dispatching');
  });
});
