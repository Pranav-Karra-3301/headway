// Owner: T1b. Demand generation (spec §5.1, §5.4, §5.7).
//
// Everything is drawn before the run, so every controller faces the identical crowd:
// - `stream(seed, 'demand')`: first the per-run demandScale, then per passenger (generator order) spawn time, origin
//   zone, destination entry and destination zone.
// - `stream(seed, 'behavior:' + pid)`: the passenger's personal draws, after the list is sorted and numbered.
// Spawn-time profiles are piecewise-linear rate curves sampled by inverse CDF (arithmetic + Math.sqrt only),
// truncated to the spawning window [0, durationS).
import type { PassengerSpec, ScenarioDef, SimConfig, TimeProfile, TownMap, Zone, ZoneSelector } from '../contracts';
import { stream, type Rng } from '../rng';

/** Personal-draw ranges (spec §5.4). */
export const PERSONAL = {
  walkWeight: [1, 2], waitWeight: [1.5, 2.5], transferPenaltyS: [120, 300], oneTransferChance: 0.85,
  patienceS: [420, 900], switchPenaltyS: 120, tints: 6,
} as const;

/** Zones matching a selector, in map order: explicit `zones` ids, else neighborhood AND tag (omitted = any). */
export function selectZones(map: TownMap, sel: ZoneSelector): Zone[] {
  if (sel.zones) {
    const ids = new Set(sel.zones);
    return map.zones.filter((z) => ids.has(z.id));
  }
  return map.zones.filter((z) =>
    (sel.neighborhood === undefined || z.neighborhood === sel.neighborhood) && (sel.tag === undefined || z.tags.includes(sel.tag)));
}

/** A time profile as a piecewise-linear rate curve [t, rate]; zero outside the first..last point.
 *  pulse = linear ramp from `at` up to the peak at `at + rampS`, then linear decay to zero over `decayS`. */
export function profilePoints(p: TimeProfile): Array<[number, number]> {
  switch (p.kind) {
    case 'uniform': return [[p.start, 1], [p.end, 1]];
    case 'pulse': return [[p.at, 0], [p.at + p.rampS, 1], [p.at + p.rampS + p.decayS, 0]];
    case 'piecewise': return p.points.map(([t, r]): [number, number] => [t, Math.max(0, r)]).sort((a, b) => a[0] - b[0]);
  }
}

const clampSecond = (x: number, limit: number) => Math.min(limit - 1, Math.max(0, Math.floor(x)));

/** Integer spawn second in [0, limit) for u ∈ [0, 1): inverse CDF of the rate curve truncated to [0, limit). */
export function sampleSpawnT(points: Array<[number, number]>, u: number, limit: number): number {
  const segs: Array<{ a: number; b: number; ra: number; rb: number; m: number }> = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [t0, r0] = points[i]!;
    const [t1, r1] = points[i + 1]!;
    if (!(t1 > t0)) continue; // vertical jump
    const a = Math.max(t0, 0);
    const b = Math.min(t1, limit);
    if (!(b > a)) continue;
    const ra = r0 + ((r1 - r0) * (a - t0)) / (t1 - t0);
    const rb = r0 + ((r1 - r0) * (b - t0)) / (t1 - t0);
    const m = ((ra + rb) / 2) * (b - a);
    if (!(m > 0)) continue;
    segs.push({ a, b, ra, rb, m });
    total += m;
  }
  if (segs.length === 0) return clampSecond(points[0]?.[0] ?? 0, limit);
  let target = u * total;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (target < s.m || i === segs.length - 1) {
      const m = Math.min(Math.max(target, 0), s.m);
      if (m <= 0) return clampSecond(s.a, limit);
      // mass(x) = ra·x + k·x²/2 over the segment; stable root x = 2m / (ra + sqrt(ra² + 2km))
      const k = (s.rb - s.ra) / (s.b - s.a);
      const den = s.ra + Math.sqrt(Math.max(0, s.ra * s.ra + 2 * k * m));
      const x = den > 0 ? s.a + (2 * m) / den : s.b;
      return clampSecond(Math.min(x, s.b), limit);
    }
    target -= s.m;
  }
  return clampSecond(segs[segs.length - 1]!.b, limit);
}

function pickDest(rng: Rng, to: Array<{ share: number; zones: Zone[] }>, originId: string, genId: string): Zone {
  const options = to.map((e) => e.zones.filter((z) => z.id !== originId));
  let idx = to.map((_, i) => i).filter((i) => options[i]!.length > 0 && to[i]!.share > 0);
  if (idx.length === 0) idx = to.map((_, i) => i).filter((i) => options[i]!.length > 0);
  if (idx.length === 0) throw new Error(`passengers: generator ${genId} has no destination other than origin ${originId}`);
  const entry = rng.weighted(idx, idx.map((i) => to[i]!.share));
  const zones = options[entry]!;
  return rng.weighted(zones, zones.map((z) => z.weight));
}

function personal(seed: number, id: number, cfg: SimConfig): Omit<PassengerSpec, 'id' | 'spawnT' | 'origin' | 'dest'> {
  const r = stream(seed, `behavior:${id}`);
  const w = cfg.walk;
  const walkSpeed = Math.min(w.maxSpeed, Math.max(w.minSpeed, r.normal(w.meanSpeed, w.sdSpeed)));
  const walk = r.range(PERSONAL.walkWeight[0], PERSONAL.walkWeight[1]);
  const wait = r.range(PERSONAL.waitWeight[0], PERSONAL.waitWeight[1]);
  const transferPenaltyS = r.int(PERSONAL.transferPenaltyS[0], PERSONAL.transferPenaltyS[1]);
  const maxTransfers: 0 | 1 = r.next() < PERSONAL.oneTransferChance ? 1 : 0;
  const patienceS = r.int(PERSONAL.patienceS[0], PERSONAL.patienceS[1]);
  const choiceNoise = r.range(-1, 1);
  const tint = r.int(0, PERSONAL.tints - 1);
  return {
    walkSpeed, weights: { walk, wait, ride: 1 }, transferPenaltyS, maxTransfers, patienceS,
    switchPenaltyS: PERSONAL.switchPenaltyS, choiceNoise, tint,
  };
}

/** The run's passenger list: sorted by spawnT (ties keep generation order), ids 0…n−1 (spec §5.1, §5.4). */
export function generatePassengers(map: TownMap, def: ScenarioDef, seed: number, cfg: SimConfig): PassengerSpec[] {
  const rng = stream(seed, 'demand');
  const scale = rng.range(def.perturb.demandScale[0], def.perturb.demandScale[1]);
  const drafts: Array<{ spawnT: number; origin: string; dest: string; seq: number }> = [];
  for (const g of def.demand) {
    const n = Math.max(0, Math.round(g.total * scale));
    if (n === 0) continue;
    const from = selectZones(map, g.from);
    if (from.length === 0) throw new Error(`passengers: generator ${g.id} matches no origin zones`);
    const fromW = from.map((z) => z.weight);
    const to = g.to.map((e) => ({ share: e.share, zones: selectZones(map, e.sel) }));
    const profile = profilePoints(g.profile);
    for (let i = 0; i < n; i++) {
      const spawnT = sampleSpawnT(profile, rng.next(), def.durationS);
      const origin = rng.weighted(from, fromW);
      const dest = pickDest(rng, to, origin.id, g.id);
      drafts.push({ spawnT, origin: origin.id, dest: dest.id, seq: drafts.length });
    }
  }
  drafts.sort((a, b) => a.spawnT - b.spawnT || a.seq - b.seq);
  return drafts.map((d, id) => ({ id, spawnT: d.spawnT, origin: d.origin, dest: d.dest, ...personal(seed, id, cfg) }));
}
