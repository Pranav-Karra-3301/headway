// Owner: T3c (+P2). Keyboard → Play command (pure). D dispatch · H hold 30 (Shift 60) · R reassign · T train +30 (Shift: depart now)
// · Space pause · 1/2/3/4 speed (or r1/r2/r3 while the reassign or deploy picker is open) · [ ] cycle the selected bus · Esc close.
// Play is click-first (fleet board + action cards); these are shortcuts only.
import type { RouteId } from '@headway/sim';
import type { Speed } from '../../sim/runner';

export type Picker = 'reassign' | 'train' | 'deploy' | null;
export type Command =
  | { kind: 'dispatch' }
  | { kind: 'hold'; seconds: 30 | 60 }
  | { kind: 'reassign-open' }
  | { kind: 'reassign'; to: RouteId }
  | { kind: 'deploy'; to: RouteId }
  | { kind: 'train'; mode: 'extend' | 'now'; extraS?: number }
  | { kind: 'pause-toggle' }
  | { kind: 'speed'; speed: Speed }
  | { kind: 'cycle'; dir: 1 | -1 }
  | { kind: 'close' };

export interface KeyLike { key: string; code: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }

const SPEEDS: Record<string, Speed> = { 1: 1, 2: 4, 3: 8, 4: 16 };
const ROUTE_KEYS: Record<string, RouteId> = { 1: 'r1', 2: 'r2', 3: 'r3' };

function digit(e: KeyLike): string | null {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) return m[1]!;
  return /^[0-9]$/.test(e.key) ? e.key : null;
}

export function keyCommand(e: KeyLike, ctx: { picker: Picker }): Command | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const d = digit(e);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (ctx.picker === 'reassign') {
    if (d !== null) { const to = ROUTE_KEYS[d]; return to ? { kind: 'reassign', to } : null; }
    if (key === 'Escape' || key === 'r') return { kind: 'close' };
  }
  if (ctx.picker === 'deploy') {
    if (d !== null) { const to = ROUTE_KEYS[d]; return to ? { kind: 'deploy', to } : null; }
    if (key === 'Escape') return { kind: 'close' };
  }
  if (ctx.picker === 'train' && (key === 'Escape')) return { kind: 'close' };

  if (d !== null) { const speed = SPEEDS[d]; return speed ? { kind: 'speed', speed } : null; }
  switch (key) {
    case 'd': return { kind: 'dispatch' };
    case 'h': return { kind: 'hold', seconds: e.shiftKey ? 60 : 30 };
    case 'r': return { kind: 'reassign-open' };
    case 't': return { kind: 'train', mode: e.shiftKey ? 'now' : 'extend' };
    case ' ': return { kind: 'pause-toggle' };
    case ']': return { kind: 'cycle', dir: 1 };
    case '[': return { kind: 'cycle', dir: -1 };
    case 'Escape': return { kind: 'close' };
    default: return e.code === 'Space' ? { kind: 'pause-toggle' } : null;
  }
}
