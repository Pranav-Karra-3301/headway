import { describe, expect, it } from 'vitest';
import { keyCommand } from '../keys';

const k = (key: string, p: Partial<{ code: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key, code: p.code ?? '', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...p,
});

describe('keyCommand', () => {
  it('maps the dispatcher keys', () => {
    expect(keyCommand(k('d'), { picker: null })).toEqual({ kind: 'dispatch' });
    expect(keyCommand(k('h'), { picker: null })).toEqual({ kind: 'hold', seconds: 30 });
    expect(keyCommand(k('H', { shiftKey: true }), { picker: null })).toEqual({ kind: 'hold', seconds: 60 });
    expect(keyCommand(k('r'), { picker: null })).toEqual({ kind: 'reassign-open' });
    expect(keyCommand(k('t'), { picker: null })).toEqual({ kind: 'train', mode: 'extend' });
    expect(keyCommand(k('T', { shiftKey: true }), { picker: null })).toEqual({ kind: 'train', mode: 'now' });
  });

  it('maps pause and speeds by physical digit keys', () => {
    expect(keyCommand(k(' ', { code: 'Space' }), { picker: null })).toEqual({ kind: 'pause-toggle' });
    expect(keyCommand(k('1', { code: 'Digit1' }), { picker: null })).toEqual({ kind: 'speed', speed: 1 });
    expect(keyCommand(k('2', { code: 'Digit2' }), { picker: null })).toEqual({ kind: 'speed', speed: 4 });
    expect(keyCommand(k('3', { code: 'Digit3' }), { picker: null })).toEqual({ kind: 'speed', speed: 8 });
    expect(keyCommand(k('4', { code: 'Digit4' }), { picker: null })).toEqual({ kind: 'speed', speed: 16 });
  });

  it('uses digits to pick a route while the reassign picker is open', () => {
    expect(keyCommand(k('1', { code: 'Digit1' }), { picker: 'reassign' })).toEqual({ kind: 'reassign', to: 'r1' });
    expect(keyCommand(k('3', { code: 'Digit3' }), { picker: 'reassign' })).toEqual({ kind: 'reassign', to: 'r3' });
    expect(keyCommand(k('4', { code: 'Digit4' }), { picker: 'reassign' })).toBeNull();
    expect(keyCommand(k('Escape'), { picker: 'reassign' })).toEqual({ kind: 'close' });
    expect(keyCommand(k('r'), { picker: 'reassign' })).toEqual({ kind: 'close' });
  });

  it('cycles the selection and ignores modified keys', () => {
    expect(keyCommand(k(']'), { picker: null })).toEqual({ kind: 'cycle', dir: 1 });
    expect(keyCommand(k('['), { picker: null })).toEqual({ kind: 'cycle', dir: -1 });
    expect(keyCommand(k('d', { metaKey: true }), { picker: null })).toBeNull();
    expect(keyCommand(k('r', { ctrlKey: true }), { picker: null })).toBeNull();
    expect(keyCommand(k('x'), { picker: null })).toBeNull();
  });
});
