// Owner: Task M. Seeded PRNG (sfc32 + cyrb128) with named streams. Stub until filled.
function ni(what: string): never {
  throw new Error(`not implemented yet: ${what}`);
}

export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  range(lo: number, hi: number): number;
  normal(mean: number, sd: number): number;
  pick<T>(xs: readonly T[]): T;
  weighted<T>(xs: readonly T[], w: readonly number[]): T;
}
export function cyrb128(s: string): [number, number, number, number] { return ni('rng.cyrb128 ' + s); }
export function stream(seed: number, name: string): Rng { return ni(`rng.stream ${seed}:${name}`); }
