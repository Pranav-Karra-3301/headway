// Owner: Task M. Seeded PRNG (sfc32 + cyrb128) with named streams (spec §5.1).
// Pure integer/IEEE arithmetic only (no Math.random, no transcendental math), so every runtime
// (browser, Node, Worker) draws the identical sequence for the same (seed, stream name).

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi] (both inclusive). */
  int(lo: number, hi: number): number;
  /** Uniform real in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Approximately normal (Irwin–Hall, 12 uniforms): exact mean and sd, bounded at ±6 sd. */
  normal(mean: number, sd: number): number;
  pick<T>(xs: readonly T[]): T;
  /** Weighted choice; non-positive weights are never chosen (all non-positive → uniform pick). */
  weighted<T>(xs: readonly T[], w: readonly number[]): T;
}

/** 128-bit string hash (bryc's cyrb128) → four uint32 seeds for sfc32. */
export function cyrb128(s: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A named, independent random stream: `sfc32(cyrb128(`${seed}:${name}`))`. */
export function stream(seed: number, name: string): Rng {
  const [a, b, c, d] = cyrb128(`${seed}:${name}`);
  const next = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) next(); // warm-up: decorrelate nearby seeds
  return {
    next,
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    normal(mean, sd) {
      let s = 0;
      for (let i = 0; i < 12; i++) s += next();
      return mean + (s - 6) * sd;
    },
    pick<T>(xs: readonly T[]): T {
      if (xs.length === 0) throw new Error('rng.pick: empty array');
      return xs[Math.floor(next() * xs.length)] as T;
    },
    weighted<T>(xs: readonly T[], w: readonly number[]): T {
      if (xs.length === 0) throw new Error('rng.weighted: empty array');
      let total = 0;
      for (let i = 0; i < xs.length; i++) total += Math.max(0, w[i] ?? 0);
      if (!(total > 0)) return xs[Math.floor(next() * xs.length)] as T;
      const r = next() * total;
      let acc = 0;
      let last = 0;
      for (let i = 0; i < xs.length; i++) {
        const wi = Math.max(0, w[i] ?? 0);
        if (wi <= 0) continue;
        acc += wi;
        last = i;
        if (r < acc) return xs[i] as T;
      }
      return xs[last] as T;
    },
  };
}
