// Owner: G3. The greater-town waterfront as pure data (no three.js, deterministic): the stone LAKESHORE PROMENADE
// along the parkway, timber BOARDWALKS on piles where the land strip is thin (the beach under the board, the harbour
// front), small PIERS (a fishing pier at a cul-de-sac, jetties off the promenade, a lookout) and the HARBOUR at the
// end of Marina Rd (main pier + finger slips + moored boats) that meets the marina. Built from the G0 grid seam
// (g.shore / g.water / g.blocks / g.junctions): only 'free' cells of waterfront blocks and open water are used,
// never roads, rail, the ridge or the board; the rail and its bay bridge keep RAIL_CLEAR.
//
// Frame: x east, z south, y up (board top 0). Items face +z at rot 0 (rot = atan2(f.x, f.z) faces f).
import { projectOnPolyline } from '@headway/sim';
import type { TownMap, Vec2 } from '@headway/sim';
import type { AssetParams } from '../../assets/types';
import { cellOf, greaterGrid, inGrid, isWater, rightOf, roadAt, type Block, type CellUse, type GreaterGrid } from '../grid';

/** Heights and cross-sections (u). Water level matches E2 (world/water WATER_Y). */
export const WF = {
  waterY: -0.75,
  /** Promenade paving top (a hair under the sidewalks' 0.08 so kerbs read). */
  paveTop: 0.07,
  /** Boardwalk + pier deck tops. Piers sit a touch lower so a boardwalk always wins where they overlap. */
  walkTop: 0.18,
  pierTop: 0.16,
  deckThick: 0.12,
  pileBottom: -1.6,
  /** Stone promenade: centreline offset inland from the shore, width. */
  prom: { offset: 2.7, width: 2.0 },
  /** Timber boardwalk: centreline offset (negative = seaward, over the water on piles), width. */
  walk: { offset: -0.95, width: 1.8 },
  /** Land deeper than this (shore → first road / board cell) gets the promenade, else a boardwalk. */
  promDepth: 6,
  /** Keep every deck and item this far from the rail centreline (bay bridge, beach run). */
  railClear: 2.9,
  sample: 0.5,
} as const;

export type RunKind = 'promenade' | 'boardwalk';
export interface WfRun {
  id: string;
  kind: RunKind;
  /** Centreline, shore order (east → west); `sea` = unit seaward normal per point. */
  pts: Vec2[];
  sea: Vec2[];
  width: number;
  length: number;
  /** Promenades: arc-length spans with no sea wall (where a jetty or lookout leaves it). */
  gaps?: Array<[number, number]>;
}

export type DeckKind = 'pier' | 'head' | 'finger' | 'lookout';
/** A rectangular timber deck on piles. `dir` runs along `len` (from the shore outward); rails per side:
 *  l / r = left / right of dir, s = the shore end, e = the far end. `railFrom` = rails start this far along. */
export interface WfDeck {
  id: string;
  kind: DeckKind;
  c: Vec2;
  dir: Vec2;
  len: number;
  w: number;
  top: number;
  rails: Array<'l' | 'r' | 's' | 'e'>;
  railFrom?: number;
}

/** A gazebo / bandstand (built procedurally): centre, radius, base height. */
export interface WfPavilion { id: string; c: Vec2; r: number; y: number }

/** A placed registry asset; `y` = base height (deck top, paving, or the waterline for boats). */
export interface WfItem { kind: string; x: number; z: number; y: number; rot: number; scale?: number; params?: AssetParams; boat?: boolean }

export interface WaterfrontPlan {
  runs: WfRun[];
  decks: WfDeck[];
  pavilions: WfPavilion[];
  items: WfItem[];
  /** The marina meeting point: the harbour's main pier (root on the shore, outward dir, length), or null. */
  harbour: { root: Vec2; dir: Vec2; len: number; street: string } | null;
  /** Capsules (segment + radius) covering everything G3 builds — E2 / G2 / G5 keep their props out of them. */
  footprints: Array<{ a: Vec2; b: Vec2; r: number }>;
}

// ---------------------------------------------------------------- tiny deterministic helpers
function hash(a: number, b: number): number {
  let h = (Math.imul(Math.round(a * 16) + 7919, 73856093) ^ Math.imul(Math.round(b * 16) + 104729, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const add = (p: Vec2, d: Vec2, s: number): Vec2 => ({ x: p.x + d.x * s, z: p.z + d.z * s });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const facing = (f: Vec2) => Math.atan2(f.x, f.z);
const neg = (v: Vec2): Vec2 => ({ x: -v.x, z: -v.z });

/** Resample a polyline every `step` u (keeps the ends). */
function resample(pts: readonly Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!, L = dist(a, b);
    let t = step - carry;
    while (t <= L) { out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L }); t += step; }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1]!;
  if (dist(out[out.length - 1]!, last) > step * 0.25) out.push(last);
  return out;
}

/** Unit tangents of a polyline (central differences). */
function tangents(pts: readonly Vec2[]): Vec2[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const L = dist(a, b) || 1;
    return { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  });
}

function pathLength(pts: readonly Vec2[]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += dist(pts[i]!, pts[i + 1]!);
  return L;
}

/** Point + seaward normal at arc length s along a run. */
export function runAt(run: Pick<WfRun, 'pts' | 'sea'>, s: number): { p: Vec2; sea: Vec2; tan: Vec2 } {
  const P = run.pts;
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i]!, b = P[i + 1]!, L = dist(a, b);
    if (acc + L >= s || i + 2 === P.length) {
      const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0;
      const sa = run.sea[i]!, sb = run.sea[i + 1]!;
      const sx = sa.x + (sb.x - sa.x) * t, sz = sa.z + (sb.z - sa.z) * t, sl = Math.hypot(sx, sz) || 1;
      const tl = L || 1;
      return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, sea: { x: sx / sl, z: sz / sl }, tan: { x: (b.x - a.x) / tl, z: (b.z - a.z) / tl } };
    }
    acc += L;
  }
  return { p: P[0]!, sea: run.sea[0]!, tan: { x: 1, z: 0 } };
}

// ---------------------------------------------------------------- the planner
const cache = new WeakMap<TownMap, WaterfrontPlan>();
/** Piers may reach this far past the grid's south / east edge into E2's bay (the world's water continues there). */
const BAY_BEYOND = 2;

/** The waterfront plan for a map (memoised). */
export function planWaterfront(map: TownMap): WaterfrontPlan {
  let plan = cache.get(map);
  if (!plan) { plan = buildPlan(map, greaterGrid(map)); cache.set(map, plan); }
  return plan;
}

function buildPlan(map: TownMap, g: GreaterGrid): WaterfrontPlan {
  const blockAt = (p: Vec2): Block | undefined => g.blocks.find((b) => p.x >= b.rect.minX && p.x < b.rect.maxX && p.z >= b.rect.minZ && p.z < b.rect.maxZ);
  const use = (p: Vec2): CellUse | 'out' => {
    const { c, r } = cellOf(g, p.x, p.z);
    return inGrid(g, c, r) ? g.use[r]![c]! : 'out';
  };
  const railD = (p: Vec2) => projectOnPolyline(map.rail.loop, p).d;
  /** Waterfront land (a free cell of a waterfront block) or open water — and clear of the rail. */
  const open = (p: Vec2, inset = 1.2): boolean => {
    const u = use(p);
    if (u === 'water' || u === 'rail') return railD(p) >= WF.railClear && (u === 'water' || isWater(g, p.x, p.z));
    if (u !== 'free') return false;
    const b = blockAt(p);
    if (!b || b.zone !== 'waterfront') return false;
    return p.x > g.bounds.minX + inset && p.x < g.bounds.maxX - inset && p.z > g.bounds.minZ + inset && p.z < g.bounds.maxZ - inset && railD(p) >= WF.railClear;
  };
  const land = (p: Vec2) => use(p) === 'free' && blockAt(p)?.zone === 'waterfront';

  // ---- shore samples: seaward normal (the bay lies to the left of the east → west shore), land depth
  const S = resample(g.shore, WF.sample);
  const T = tangents(S);
  const N = T.map((t) => neg(rightOf(t))); // seaward
  const depth = S.map((p, i) => {
    let d = 0;
    for (let t = 0.5; t <= 9; t += 0.5) {
      const q = add(p, N[i]!, -t);
      const u = use(q);
      if (u === 'free' || u === 'water' || (u === 'rail' && isWater(g, q.x, q.z))) d = t; else break;
    }
    return d;
  });
  const okAt = (i: number, kind: RunKind): boolean => {
    const { offset, width } = kind === 'promenade' ? WF.prom : WF.walk;
    const c = add(S[i]!, N[i]!, -offset);
    for (const e of [-width / 2 - 0.15, 0, width / 2 + 0.15]) {
      const q = add(c, N[i]!, e);
      // a boardwalk may brush a kerb corner with its landward edge (the deck steps up from the sidewalk)
      if (!open(q) && !(kind === 'boardwalk' && e < 0 && use(q) === 'road' && open(c))) return false;
    }
    // promenades stay on land; boardwalks need waterfront land or shore within reach (not a lone deck in the bay)
    if (kind === 'promenade') return land(add(c, N[i]!, -width / 2)) && land(add(c, N[i]!, width / 2 - 0.4));
    return [0.6, 1.6, 2.6].some((t) => { const u = use(add(S[i]!, N[i]!, -t)); return u === 'free' || u === 'road'; });
  };
  // promenade where the land is deep enough along a stretch of ≥ 10 u, a boardwalk everywhere else
  const pf = S.map((_, i) => depth[i]! >= WF.promDepth && okAt(i, 'promenade'));
  for (let i = 0; i < pf.length;) {
    if (!pf[i]) { i++; continue; }
    let j = i;
    while (j < pf.length && pf[j]) j++;
    if ((j - i) * WF.sample < 10) for (let k = i; k < j; k++) pf[k] = false;
    i = j;
  }
  const kinds: RunKind[] = pf.map((f) => (f ? 'promenade' : 'boardwalk'));

  const runs: WfRun[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      const kind = kinds[cur[0]!]!;
      const { offset, width } = kind === 'promenade' ? WF.prom : WF.walk;
      // trim 0.5 u off both ends so decks never butt into kerbs
      const trim = Math.ceil(0.5 / WF.sample);
      const idx = cur.slice(trim, cur.length - trim);
      const pts = idx.map((i) => add(S[i]!, N[i]!, -offset));
      const length = pts.length > 1 ? pathLength(pts) : 0;
      if (length >= (kind === 'promenade' ? 7 : 5)) runs.push({ id: `wf-${kind}-${runs.length}`, kind, pts, sea: idx.map((i) => N[i]!), width, length });
    }
    cur = [];
  };
  for (let i = 0; i < S.length; i++) {
    const k = kinds[i]!;
    if (okAt(i, k) && (cur.length === 0 || kinds[cur[cur.length - 1]!] === k)) cur.push(i);
    else { flush(); if (okAt(i, k)) cur.push(i); }
  }
  flush();

  const decks: WfDeck[] = [];
  const pavilions: WfPavilion[] = [];
  const items: WfItem[] = [];
  const footprints: WaterfrontPlan['footprints'] = [];
  const item = (kind: string, p: Vec2, y: number, rot: number, extra: Partial<WfItem> = {}) => items.push({ kind, x: p.x, z: p.z, y, rot, ...extra });

  for (const r of runs) for (let i = 0; i + 1 < r.pts.length; i += 4) footprints.push({ a: r.pts[i]!, b: r.pts[Math.min(i + 4, r.pts.length - 1)]!, r: r.width / 2 + 0.4 });

  /** Clear water (or waterfront land) along a ray; returns the usable length (≤ maxLen). */
  const reach = (root: Vec2, dir: Vec2, halfW: number, maxLen: number): number => {
    const side = rightOf(dir);
    let L = 0;
    for (let t = 0.25; t <= maxLen; t += 0.25) {
      const q = add(root, dir, t);
      if (![-halfW, 0, halfW].every((e) => {
        const p = add(q, side, e);
        const u = use(p);
        const bay = u === 'water' || (u === 'rail' && isWater(g, p.x, p.z)) || (u === 'out' && p.x > g.bounds.minX && (p.z > g.bounds.maxZ || p.x > g.bounds.maxX) && isWater(g, Math.min(p.x, g.bounds.maxX - 0.01), Math.min(p.z, g.bounds.maxZ - 0.01)));
        return (bay || land(p)) && railD(p) >= WF.railClear && p.x > g.bounds.minX + 1 && p.x < g.bounds.maxX + BAY_BEYOND && p.z < g.bounds.maxZ + BAY_BEYOND;
      })) break;
      L = t;
    }
    return L;
  };
  const nearBoardwalk = (p: Vec2, r = 1.8) => runs.some((run) => run.kind === 'boardwalk' && run.pts.some((q) => dist(q, p) < r));
  const deck = (d: Omit<WfDeck, 'top'> & { top?: number }) => {
    const full: WfDeck = { top: WF.pierTop, ...d };
    decks.push(full);
    footprints.push({ a: add(full.c, full.dir, -full.len / 2), b: add(full.c, full.dir, full.len / 2), r: full.w / 2 + 0.3 });
    return full;
  };
  const piers: Vec2[] = [];

  // ---- cul-de-sacs that end at the water: the harbour (Marina Rd), a fishing pier, a lookout
  const ends = g.junctions
    .filter((j) => j.kind === 'end' && j.arms.length === 1)
    .map((j) => {
      const away = neg(j.arms[0]!.dir);
      const root = add(j.center, away, g.tile / 2);
      const { c, r } = cellOf(g, j.center.x, j.center.z);
      return { j, away, root, street: roadAt(g, c, r)?.street ?? j.arms[0]!.street, reach: reach(root, away, 0.9, 12) };
    })
    .filter((e) => e.reach >= 2.5)
    .sort((a, b) => b.reach - a.reach);
  let harbour: WaterfrontPlan['harbour'] = null;
  const harbourEnd = ends.find((e) => /marina|harbou?r/i.test(e.street) && e.reach >= 8) ?? ends.find((e) => e.reach >= 10);
  for (const e of ends) {
    const { away, root } = e;
    const side = rightOf(away);
    const onWalk = nearBoardwalk(add(root, away, 0.9), 1.6);
    let tShore = 0;
    while (tShore < 3 && !isWater(g, root.x + away.x * tShore, root.z + away.z * tShore)) tShore += 0.1;
    // decks clear of the land / boardwalk start here (rails, lamps)
    const railFrom = tShore + (onWalk ? WF.walk.width - WF.walk.offset - 0.85 : 0.2);
    if (e === harbourEnd) {
      // HARBOUR: main pier with two rows of finger slips each side, a T head, moored boats, lamps
      const len = Math.min(e.reach - 0.4, 13);
      harbour = { root, dir: away, len, street: e.street };
      piers.push(add(root, away, len / 2));
      deck({ id: 'harbour-main', kind: 'pier', c: add(root, away, len / 2), dir: away, len, w: 1.6, rails: [], railFrom });
      const headW = 6.2;
      deck({ id: 'harbour-head', kind: 'head', c: add(root, away, len - 0.8), dir: away, len: 1.6, w: headW, rails: ['e'] });
      const rows = len >= 11 ? [len * 0.3, len * 0.52, len * 0.74] : [len * 0.38, len * 0.66];
      rows.forEach((at, ri) => {
        for (const s of [-1, 1]) {
          const fl = 3.0;
          const fc = add(add(root, away, at), side, s * (0.8 + fl / 2));
          if (reach(add(root, away, at), s > 0 ? side : neg(side), 0.45, 0.8 + fl + 1.6) < 0.8 + fl + 1.2) continue;
          deck({ id: `harbour-finger-${ri}-${s}`, kind: 'finger', c: fc, dir: s > 0 ? side : neg(side), len: fl, w: 0.6, rails: [] });
          // moored boats: in the slip on the shore side of the finger, bow toward the main pier... and one outside
          const boats = ['kn.boat.sail', 'kn.boat.speed', 'kn.boat.fishing', 'kn.boat.runabout', 'kn.boat.sailLarge', 'kn.boat.speed'];
          const bk = boats[(ri * 2 + (s > 0 ? 1 : 0)) % boats.length]!;
          const bp = add(add(add(root, away, at - 1.25), side, s * (0.8 + fl * 0.55)), away, 0);
          item(bk, bp, WF.waterY, facing(s > 0 ? neg(side) : side), { boat: true });
          // bollards on the finger
          item('wf.bollard', add(fc, away, -0.22), WF.pierTop, 0);
        }
      });
      // lamps along the main pier + at the head, a flag at the head, life ring post
      for (const at of [railFrom + 0.6, len * 0.41, len * 0.63]) item('st.lamp', add(add(root, away, at), side, -0.62), WF.pierTop, facing(side), { scale: 0.92 });
      item('st.flag', add(add(root, away, len - 0.5), side, headW / 2 - 0.35), WF.pierTop, facing(away), { params: { color: 0 } });
      item('st.kiosk', add(add(root, away, len - 0.85), side, -headW / 2 + 0.85), WF.pierTop, facing(neg(away)), { params: { color: 0 } });
      item('st.bench', add(add(root, away, len - 0.45), side, 1.1), WF.pierTop, facing(away));
      item('kn.boat.sail', add(add(root, away, len + 1.7), side, 2.4), WF.waterY, facing(side) + 0.25, { boat: true });
      continue;
    }
    const headOk = (len: number, w: number) => reach(add(root, away, len - 0.1), side, 0.7, w / 2) >= w / 2 - 0.3 && reach(add(root, away, len - 0.1), neg(side), 0.7, w / 2) >= w / 2 - 0.3;
    if (e.reach >= 6 && headOk(Math.min(e.reach - 1.2, 9) + 0.7, 4.4)) {
      // FISHING PIER: a long jetty with a T head, lamps, benches facing out, a moored rowboat
      const len = Math.min(e.reach - 1.2, 9);
      piers.push(add(root, away, len / 2));
      deck({ id: `pier-${e.j.id}`, kind: 'pier', c: add(root, away, len / 2), dir: away, len, w: 1.5, rails: ['l', 'r'], railFrom });
      deck({ id: `pier-${e.j.id}-head`, kind: 'head', c: add(root, away, len + 0.7), dir: away, len: 1.6, w: 4.4, rails: ['l', 'r', 'e'] });
      item('st.lamp', add(add(root, away, railFrom + 0.5), side, 0.55), WF.pierTop, 0, { scale: 0.92 });
      item('st.lamp', add(add(root, away, len + 0.9), side, 1.8), WF.pierTop, 0, { scale: 0.92 });
      item('st.bench', add(add(root, away, len + 1.05), side, -0.9), WF.pierTop, facing(away));
      item('st.bin', add(add(root, away, len + 1.05), side, 0.35), WF.pierTop, 0);
      item('kn.boat.row', add(add(root, away, len * 0.55), side, 1.75), WF.waterY, facing(away) + 0.12, { boat: true });
      item('kn.boat.row', add(add(root, away, len * 0.8), side, -1.8), WF.waterY, facing(neg(away)) - 0.1, { boat: true });
      continue;
    }
    // LOOKOUT: a short deck out over the water with a flag, a bench and a telescope
    const len = Math.min(e.reach, railFrom + 3.0);
    piers.push(add(root, away, len / 2));
    deck({ id: `lookout-${e.j.id}`, kind: 'lookout', c: add(root, away, len / 2), dir: away, len, w: 2.8, rails: ['l', 'r', 'e'], railFrom });
    item('st.bench', add(add(root, away, len - 0.75), side, -0.55), WF.pierTop, facing(away));
    item('wf.telescope', add(add(root, away, len - 0.6), side, 0.75), WF.pierTop, facing(away));
    item('st.flag', add(add(root, away, 0.6), side, 1.05), WF.pierTop, 0, { params: { color: 0 } });
  }

  // ---- per run: jetties (promenades), sea-wall gaps, lamps + benches, a café kiosk, tree rows
  const longestProm = runs.filter((r) => r.kind === 'promenade').sort((a, b) => b.length - a.length)[0];
  for (const run of runs) {
    const prom = run.kind === 'promenade';
    const hw = run.width / 2;
    if (prom) {
      // jetties off long promenades (spaced from each other and the cul-de-sac piers), the longest gets a pavilion
      if (run.length >= 14) {
        const cand: Array<{ s: number; reach: number }> = [];
        for (let s = 6; s <= run.length - 6; s += 1) {
          const { p, sea } = runAt(run, s);
          const root = add(p, sea, hw);
          if (piers.some((q) => dist(q, root) < 16)) continue;
          const rch = reach(add(root, sea, 0.2), sea, 1.0, 9);
          if (rch >= 4.6) cand.push({ s, reach: rch });
        }
        let made = 0;
        for (const c of cand.sort((a, b) => b.reach - a.reach || a.s - b.s)) {
          if (made >= 2) break;
          const { p, sea } = runAt(run, c.s);
          const root = add(p, sea, hw - 0.1);
          if (piers.some((q) => dist(q, root) < 16)) continue;
          const side = rightOf(sea);
          const len = Math.min(c.reach - (made === 0 ? 2.8 : 1.5), 6.5);
          if (len < 1.6) continue;
          piers.push(add(root, sea, len / 2));
          deck({ id: `jetty-${run.id}-${made}`, kind: 'pier', c: add(root, sea, len / 2), dir: sea, len, w: 1.4, rails: ['l', 'r'], railFrom: 0.5 });
          if (made === 0) {
            deck({ id: `jetty-${run.id}-${made}-head`, kind: 'head', c: add(root, sea, len + 1.25), dir: sea, len: 2.8, w: 2.8, rails: [] });
            pavilions.push({ id: `pavilion-${run.id}`, c: add(root, sea, len + 1.25), r: 1.25, y: WF.pierTop });
            item('kn.boat.speed', add(add(root, sea, len * 0.6), side, 1.7), WF.waterY, facing(sea), { boat: true });
          } else {
            deck({ id: `jetty-${run.id}-${made}-head`, kind: 'head', c: add(root, sea, len + 0.6), dir: sea, len: 1.4, w: 3.4, rails: ['l', 'r', 'e'] });
            item('st.lamp', add(add(root, sea, len + 0.7), side, 1.4), WF.pierTop, 0, { scale: 0.92 });
            item('st.bench', add(add(root, sea, len + 0.85), side, -0.6), WF.pierTop, facing(sea));
          }
          made++;
        }
      }
    }
    // gaps in the sea wall / sea rail where a deck crosses the run's sea edge
    const gaps: Array<[number, number]> = [];
    const edgeS: Array<{ q: Vec2; s: number }> = [];
    for (let i = 0, acc = 0; i < run.pts.length; i++) {
      if (i > 0) acc += dist(run.pts[i - 1]!, run.pts[i]!);
      edgeS.push({ q: add(run.pts[i]!, run.sea[i]!, hw), s: acc });
    }
    for (const d of decks) {
      const root = add(d.c, d.dir, -d.len / 2);
      let hit: number | null = null;
      for (let t = 0; t <= Math.min(d.len, 4.5) && hit === null; t += 0.1) {
        const q = add(root, d.dir, t);
        for (const e of edgeS) if (dist(e.q, q) < 0.3) { hit = e.s; break; }
      }
      if (hit !== null) gaps.push([hit - d.w / 2 - 0.2, hit + d.w / 2 + 0.2]);
    }
    run.gaps = gaps;
    const inGap = (s: number, pad: number) => gaps.some(([a, b]) => s > a - pad && s < b + pad);
    // lamps and benches alternate along the sea side (inside the wall on promenades, by the rail on boardwalks)
    const lampStep = prom ? 8 : 6.5;
    const phase = (hash(run.pts[0]!.x, run.pts[0]!.z) * 2) | 0;
    const nearPier = (p: Vec2, r: number) => decks.some((d) => dist(add(d.c, d.dir, -d.len / 2), p) < r);
    const top = prom ? WF.paveTop : WF.walkTop;
    let n = 0;
    for (let s = 1.2; s <= run.length - 1.0; s += lampStep / 2, n++) {
      const { p, sea, tan } = runAt(run, s);
      if (inGap(s, 1.2) || nearPier(add(p, sea, hw), 1.4)) continue;
      if ((n + phase) % 2 === 0) {
        item('st.lamp', add(p, sea, hw - (prom ? 0.38 : 0.22)), top, facing(tan), { scale: prom ? 1 : 0.92 });
      } else {
        const bench = add(p, sea, hw - (prom ? 0.72 : 0.42));
        item('st.bench', bench, top, facing(sea));
        if (n % 4 === 1) item('st.bin', add(bench, tan, 1.0), top, 0);
      }
    }
    if (!prom) continue;
    // a café kiosk with parasol tables on the lawn behind the longest promenade (near its middle)
    const kiosks: Vec2[] = [];
    for (const frac of [0.5, 0.35, 0.65]) {
      const { p, sea, tan } = runAt(run, run.length * frac);
      const k = add(p, sea, -(hw + 1.9));
      if (run !== longestProm) break;
      if (![k, add(k, tan, 2.6), add(k, tan, -2.6), add(k, sea, -1.2)].every(land) || piers.some((q) => dist(q, k) < 5)) continue;
      kiosks.push(k);
      item('st.kiosk', k, 0, facing(sea), { params: { color: 1 } });
      item('st.tableUmbrella', add(add(k, tan, 1.9), sea, 0.2), 0, 0);
      item('st.tableUmbrella', add(add(k, tan, -1.9), sea, 0.2), 0, 0.6);
      break;
    }
      // two loose tree rows on the land side (by the promenade, and staggered toward the parkway), bushes between
    const TREES = ['veg.oak', 'veg.maple', 'veg.birch'];
    const clearOf = (q: Vec2, r: number) => !kiosks.some((k) => dist(k, q) < r + 1.6) && !piers.some((k) => dist(k, q) < r + 1.2);
    const roomy = (q: Vec2, r: number) => land(q) && [0, 1, 2, 3, 4, 5].every((k) => land(add(q, { x: Math.cos(k * 1.047), z: Math.sin(k * 1.047) }, r)));
    for (const [off, step, s0] of [[hw + 1.3, 4.6, 2.2], [hw + 3.7, 5.6, 4.4]] as const) {
      for (let s = s0; s <= run.length - 1.5; s += step) {
        const j = hash(s * 1.7 + off, run.length);
        const { p, sea } = runAt(run, Math.min(run.length - 1, s + (j - 0.5) * 1.4));
        const tp = add(p, sea, -(off + (j - 0.5) * 0.6));
        if (!roomy(tp, 0.95) || !clearOf(tp, 1)) continue;
        item(TREES[Math.floor(hash(tp.x, tp.z) * TREES.length)]!, tp, 0, hash(tp.z, tp.x) * Math.PI * 2, { scale: 0.88 + hash(tp.x + 3, tp.z) * 0.3, params: { variant: Math.floor(hash(tp.x, tp.z + 9) * 2) } });
        if (off > hw + 2) continue;
        const bp = add(add(tp, runAt(run, s).tan, 2.6), sea, -1.3);
        if (j > 0.4 && roomy(bp, 0.6) && clearOf(bp, 0.6)) item(j > 0.72 ? 'veg.flowerbed' : 'veg.bush', bp, 0, facing(sea), { params: { variant: 0 } });
      }
    }
  }

  return { runs, decks, pavilions, items, harbour, footprints };
}

/** True when (x, z) is inside something the waterfront builds (for E2 / G2 / G5 prop placement). */
export function inWaterfront(plan: WaterfrontPlan, p: Vec2, pad = 0): boolean {
  return plan.footprints.some(({ a, b, r }) => {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < r + pad;
  });
}
