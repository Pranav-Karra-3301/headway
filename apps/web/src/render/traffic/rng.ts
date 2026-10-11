// Owner: T2.3. Renderer-local PRNG for ambient traffic. Never use @headway/sim streams here: traffic is visual-only
// and must not touch the sim's random state.

/** mulberry32: a tiny, fast, seeded PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Index into `weights` drawn proportionally (weights ≤ 0 never win unless all are ≤ 0, then uniform). */
export function weightedIndex(rand: () => number, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(rand() * weights.length));
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]! > 0 ? weights[i]! : 0;
    if (r < w) return i;
    r -= w;
  }
  return weights.length - 1;
}
