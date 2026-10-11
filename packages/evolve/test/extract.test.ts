import { describe, expect, it } from 'vitest';
import { extractJson } from '../src/extract';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1,"b":{"c":[1,2]}}')).toEqual({ a: 1, b: { c: [1, 2] } });
  });

  it('extracts from a fenced block with prose before and after', () => {
    const text = 'Sure! Here is the policy:\n```json\n{ "summary": "x", "policy": { "rules": [] } }\n```\nLet me know.';
    expect(extractJson(text)).toEqual({ summary: 'x', policy: { rules: [] } });
  });

  it('extracts from a fence without a language tag', () => {
    expect(extractJson('```\n{"ok": true}\n```')).toEqual({ ok: true });
  });

  it('skips prose braces that are not JSON', () => {
    const text = 'I changed the {threshold} in rule {anti-bunch}. Result: {"ok": true, "n": 2} done';
    expect(extractJson(text)).toEqual({ ok: true, n: 2 });
  });

  it('handles braces and escaped quotes inside strings', () => {
    const text = 'reply: {"say": "Holding {seconds}s \\"now\\" }", "x": {"y": "}"}} trailing } junk';
    expect(extractJson(text)).toEqual({ say: 'Holding {seconds}s "now" }', x: { y: '}' } });
  });

  it('returns the first balanced object, not an inner one', () => {
    expect(extractJson('{"outer": {"inner": 1}} {"second": 2}')).toEqual({ outer: { inner: 1 } });
  });

  it('returns null for truncated JSON instead of an inner fragment', () => {
    expect(extractJson('{"summary": "x", "policy": {"rules": [{"f": "a", "v": 1}, {"f": "b"')).toBeNull();
  });

  it('returns null when there is no object', () => {
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('')).toBeNull();
    expect(extractJson('[1, 2, 3]')).toBeNull();
  });

  it('ignores <think> blocks', () => {
    expect(extractJson('<think>maybe {"draft": true}</think>\n{"final": true}')).toEqual({ final: true });
  });

  it('tolerates trailing commas', () => {
    expect(extractJson('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 });
  });
});
