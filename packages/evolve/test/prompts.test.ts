import { POLICY_DSL_DOC, SCENARIOS, TOWN } from '@headway/sim';
import { describe, expect, it } from 'vitest';
import { designerSystemPrompt, designerUserPrompt, repairPrompt } from '../src/prompts';
import { POLICY } from './fixtures';

describe('designer prompts', () => {
  it('system prompt has the role, the DSL doc and the JSON output contract', () => {
    const sys = designerSystemPrompt();
    expect(sys).toContain(POLICY_DSL_DOC);
    expect(sys).toMatch(/policy designer/i);
    for (const key of ['"summary"', '"rationale"', '"changes"', '"policy"']) expect(sys).toContain(key);
    expect(sys).toMatch(/json/i);
    expect(sys).toMatch(/at most 2 focused changes/i);
    expect(sys).not.toMatch(/at most 3/i);
    // topology is spelled out so rules can be reasoned about
    expect(sys).toContain('central_stn → downtown → old_main → university_stn');
  });

  it('reads scenario numbers from @headway/sim instead of hard-coding them', () => {
    const sys = designerSystemPrompt();
    const crowd = SCENARIOS.stadium_exit.demand.filter((g) => g.id !== 'background').reduce((a, g) => a + g.total, 0);
    expect(sys).toContain(`About ${(Math.round(crowd / 10) * 10).toLocaleString('en-US')} riders in the crowd`);
    expect(sys).toContain(`trains every ${TOWN.rail.advertisedHeadwayS} s`);
    expect(sys).toContain(TOWN.rail.stations.map((s) => s.name).join(' → '));
    expect(sys).not.toContain('1,200');
  });

  it('guides allocation changes towards the least-pressured route and protects Central transfers', () => {
    const sys = designerSystemPrompt();
    expect(sys).toMatch(/take buses only from the least-pressured route/);
    expect(sys).toMatch(/every route at >= 1 bus/);
    expect(sys).toMatch(/Central is the r1\/r2 terminal/);
    expect(sys).toMatch(/Jev \(the advisor\) is off/);
  });

  it('asks designer c (only when told) to add a new rule, and states the novelty rule', () => {
    const digest = 'x';
    expect(designerUserPrompt({ emphasis: 'spacing', champion: POLICY, digest, requireNewRule: true })).toContain('MUST add at least one NEW rule');
    expect(designerUserPrompt({ emphasis: 'spacing', champion: POLICY, digest })).not.toContain('MUST add at least one NEW rule');
    expect(designerSystemPrompt()).toMatch(/Novelty: do not resubmit an idea that failed in the last 4 rounds/);
  });

  it('user prompt carries the emphasis directive, the champion JSON and the digest', () => {
    const digest = '## Findings\n1. Apartments South went 14 min without a Route 2 bus.';
    const u = designerUserPrompt({ emphasis: 'transfers', champion: POLICY, digest });
    expect(u).toContain('TRANSFERS:');
    expect(u).toContain(JSON.stringify(POLICY, null, 2));
    expect(u).toContain(digest);
    expect(u.indexOf('TRANSFERS:')).toBeLessThan(u.indexOf('"rules"'));
    expect(u.indexOf('"rules"')).toBeLessThan(u.indexOf(digest));
    expect(designerUserPrompt({ emphasis: 'spacing', champion: POLICY, digest })).toContain('SPACING:');
    expect(designerUserPrompt({ emphasis: 'allocation', champion: POLICY, digest })).toContain('ALLOCATION:');
  });

  it('repair prompt lists at most 20 errors and asks for the full JSON again', () => {
    const errors = Array.from({ length: 25 }, (_, i) => `rules[${i}].when[0].f: unknown feature "x${i}" for bus_at_stop`);
    const r = repairPrompt(errors);
    expect(r).toContain(errors[0]);
    expect(r).toContain(errors[19]);
    expect(r).not.toContain(errors[20]);
    expect(r).toMatch(/5 more/);
    expect(r).toMatch(/json/i);
    expect(r).toContain('"policy"');
  });
});
