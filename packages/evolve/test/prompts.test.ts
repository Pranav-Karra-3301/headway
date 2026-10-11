import { POLICY_DSL_DOC } from '@headway/sim';
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
    expect(sys).toMatch(/at most 3/i);
    // topology is spelled out so rules can be reasoned about
    expect(sys).toContain('central_stn → downtown → old_main → university_stn');
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
