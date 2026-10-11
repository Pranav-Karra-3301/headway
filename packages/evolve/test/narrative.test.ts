import { describe, expect, it } from 'vitest';
import { proposalNarrative } from '../src/narrative';
import { bunching, gap, missed, overload, runResult } from './fixtures';

describe('proposalNarrative', () => {
  it('formats the training delta with a real minus sign or a plus', () => {
    expect(proposalNarrative([], [], -6.14)).toMatch(/^ΔJ −6\.1% on training/);
    expect(proposalNarrative([], [], 2.26)).toMatch(/^ΔJ \+2\.3% on training/);
    expect(proposalNarrative([], [], -0.02)).toMatch(/^ΔJ 0\.0% on training/);
  });

  it('names the top gains and costs versus the champion, matched by kind and place', () => {
    const champion = [
      runResult({ seed: 1001, findings: [missed(9000), bunching(4000), overload(800)] }),
      runResult({ seed: 1002, findings: [missed(7000)] }),
    ];
    const candidate = [
      runResult({ seed: 1001, findings: [gap(6000), bunching(1000, 1, 'Route 1 buses bunched 1× (as close as 90 s).'), overload(800)] }),
      runResult({ seed: 1002, findings: [] }),
    ];
    const text = proposalNarrative(candidate, champion, -6.1);
    // gains: the missed transfers vanished (biggest drop), bunching eased
    expect(text).toContain('Fixed: 38 riders reached Central from the train just after Route 2 left.');
    expect(text).toContain('Eased: Route 1 buses bunched 4× (as close as 40 s) (now 1×).');
    expect(text.indexOf('Fixed:')).toBeLessThan(text.indexOf('Eased:'));
    // cost: a new service gap
    expect(text).toContain('New: Apartments South went 14 min without a Route 2 bus (21:52–22:06).');
    // unchanged findings are not mentioned
    expect(text).not.toContain('left behind');
  });

  it('keeps at most 2 gains and 2 costs', () => {
    const champion = [runResult({ findings: [missed(9000), bunching(8000), overload(7000)] })];
    const candidate = [runResult({ findings: [gap(5000), { ...gap(4000), stopId: 'stop_downtown', text: 'Downtown went 9 min without a Route 2 bus.' },
      { ...gap(3000), stopId: 'stop_old_main', text: 'Old Main went 8 min without a Route 2 bus.' }] })];
    const text = proposalNarrative(candidate, champion, -1);
    expect((text.match(/Fixed:|Eased:/g) ?? []).length).toBe(2);
    expect((text.match(/New:|Worse:/g) ?? []).length).toBe(2);
    expect(text).not.toContain('Old Main');
    expect(text).not.toContain('left behind');
  });

  it('marks a finding that got worse with its previous size', () => {
    const champion = [runResult({ findings: [overload(1000, 5, '5 people were left behind at Stadium Gate; the queue peaked at 60.')] })];
    const candidate = [runResult({ findings: [overload(5000)] })];
    expect(proposalNarrative(candidate, champion, 3)).toContain('Worse: 23 people were left behind at Stadium Gate; the queue peaked at 140 (was 5 left behind).');
  });

  it('never pairs a cost with a smaller headline number (or a gain with a bigger one)', () => {
    // the strongest instance shrank (41 → 24 riders) but more runs missed the connection: the summed impact grew
    const champion = [runResult({ seed: 1001, findings: [missed(3000, 41, '41 riders reached Central from the train just after Route 2 left.')] }), runResult({ seed: 1002 })];
    const candidate = [runResult({ seed: 1001, findings: [missed(2400, 24, '24 riders reached Central from the train just after Route 2 left.')] }),
      runResult({ seed: 1002, findings: [missed(2400, 20, '20 riders reached Central from the train just after Route 2 left.')] })];
    const worse = proposalNarrative(candidate, champion, 1.2);
    expect(worse).toContain('Worse: 24 riders reached Central from the train just after Route 2 left (+30 pax-min over the training runs).');
    expect(worse).not.toContain('was 41');
    // and the mirror image for a gain
    const eased = proposalNarrative(champion, candidate, -1.2);
    expect(eased).toContain('Eased: 24 riders reached Central from the train just after Route 2 left (−30 pax-min over the training runs).');
  });

  it('says so when nothing notable changed', () => {
    const same = [runResult({ findings: [missed(9000)] })];
    expect(proposalNarrative(same, same, -0.4)).toBe('ΔJ −0.4% on training. No finding changed noticeably.');
  });
});
