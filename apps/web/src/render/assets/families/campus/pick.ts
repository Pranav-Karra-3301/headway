// Owner: A2. Param helpers for campus builders.
import type { KitContext } from '../../types';

/** A numeric param as a variant index in 0..n-1, or a per-placement random one when unset. */
export function pick(v: unknown, n: number, k: KitContext): number {
  if (typeof v === 'number' && Number.isFinite(v)) return ((Math.round(v) % n) + n) % n;
  return Math.min(n - 1, Math.floor(k.rand() * n));
}

/** A boolean param, or a per-placement coin flip (probability `p`) when unset. */
export function flag(v: unknown, p: number, k: KitContext): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return k.rand() < p;
}
