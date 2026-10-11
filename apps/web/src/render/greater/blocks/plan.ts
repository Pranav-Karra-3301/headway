// Owner: G2. Outer neighbourhoods: dress the greater-town blocks (G0's g.blocks) with suburbs, shop parades and a
// strip mall, the works yard, parks, woods, tree belts and fields; street lights, traffic lights, stop signs and
// power lines along the streets. Pure data (no three.js, deterministic, memoised per map); ./layer renders it.
//
//   const plan = planGreaterBlocks(TOWN);
//   plan.items   — PlacedAssets (registry kinds; `kenney:<id>` = a raw Kenney model) with a role + owning block
//   plan.lots    — flat ground patches (gardens, lawns, parking, yards, crops, paths, paint lines)
//   plan.lines   — power lines: item indices of consecutive poles (wires are strung by the layer)
//   plan.styles  — block id → style ('skip' = waterfront, left to G3)
//
// Rules: block items stay inside their block rect (free cells only — never on roads, rail, the ridge, the bay, the
// highway band or the board); street items (lamps, signals, signs) stand on road-tile sidewalks only. Camera-side
// blocks (south / east of the board) keep low buildings so nothing hides the playable town.
import type { TownMap, Vec2 } from '@headway/sim';
import { BUILDING_SPEC_BY_KIND } from '../../assets/families/kenney-buildings';
import type { AssetParams } from '../../assets/types';
import { greaterGrid, type Block, type Dir, type GreaterGrid, type Rect, type RoadClass } from '../grid';
import { footprintRect, frameOf, inset, pick, rng, sizeOf, type Frame } from './frame';
import { planStreetFurniture } from './street';

export type BlockStyle = 'houses' | 'shops' | 'works' | 'park' | 'woods' | 'belt' | 'field' | 'skip';
export type ItemRole = 'building' | 'tree' | 'prop' | 'car' | 'street' | 'pole';

export interface BlockItem {
  /** Asset kind (registry) or `kenney:<KenneyId>` for a raw Kenney model. */
  kind: string;
  x: number;
  z: number;
  rot: number;
  /** Lift above the ground (stacked containers). */
  y?: number;
  scale?: number;
  params?: AssetParams;
  role: ItemRole;
  /** Owning block id, or the road tile id for street items. */
  block: string;
  /** World footprint (buildings, cars and big props). */
  fp?: Rect;
}

export type LotKind = 'garden' | 'lawn' | 'meadow' | 'drive' | 'parking' | 'yard' | 'cropA' | 'cropB' | 'path' | 'soil' | 'paving' | 'line';
export interface Lot { kind: LotKind; rect: Rect; idx?: number }

export interface BlocksPlan {
  styles: Record<string, BlockStyle>;
  items: BlockItem[];
  lots: Lot[];
  /** Power lines: indices into items (poles in order). */
  lines: number[][];
}

// ---------------------------------------------------------------- kinds
const HOUSES_SHALLOW = ['kn.house.bungalow', 'kn.house.family', 'kn.house.family', 'kn.house.narrow', 'kn.house.modern'];
const HOUSES_DEEP = ['kn.house.ranch', 'kn.house.large', 'kn.house.wide', 'kn.house.family', 'kn.house.bungalow', 'kn.house.modern'];
const HOUSES_LOW = ['kn.house.bungalow', 'kn.house.modern', 'kn.house.ranch', 'kn.house.bungalow'];
const SHOPS = ['kn.shop.small', 'kn.shop.low', 'kn.shop.small', 'kn.shop.wide'];
const SHOPS_LOW = ['kn.shop.low', 'kn.shop.wide'];
const YARD_TREES = ['veg.oak', 'veg.oak', 'veg.maple', 'veg.birch', 'veg.cherry', 'veg.poplar'];
const PARK_TREES = ['veg.oak', 'veg.oak', 'veg.maple', 'veg.maple', 'veg.cherry', 'veg.birch'];
const WOOD_TREES_W = ['veg.pine', 'veg.pine', 'veg.pine', 'veg.oak', 'veg.birch'];
const WOOD_TREES = ['veg.oak', 'veg.pine', 'veg.maple', 'veg.oak', 'veg.birch', 'veg.pine'];
const BELT_TREES = ['veg.oak', 'veg.poplar', 'veg.maple', 'veg.oak', 'veg.pine'];
/** Distinct shapes per tree kind (the layer instances one prototype per kind × variant). */
export const TREE_VARIANTS: Record<string, number> = { 'veg.oak': 4, 'veg.pine': 3, 'veg.maple': 2, 'veg.birch': 2, 'veg.poplar': 1, 'veg.cherry': 1, 'veg.bush': 2 };

const yawTo = (d: Vec2) => Math.atan2(d.x, d.z);
/** Raw Kenney traffic light (city-kit-roads). */
export const TRAFFIC_LIGHT = 'kenney:city-kit-roads/traffic-light';

const CLASS_RANK: Record<RoadClass, number> = { parkway: 5, ring: 4, avenue: 3, radial: 2, local: 1 };
const OPP: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };
/** Frame ends: which block side the u = 0 / u = L end of a strip along `side` touches. */
const ENDS: Record<Dir, [Dir, Dir]> = { n: ['w', 'e'], s: ['e', 'w'], w: ['s', 'n'], e: ['n', 's'] };
const STRIP = 4.4;
/** Shipping containers at toy scale (K3's 3.2 u box reads as big as a house). */
const CONTAINER = 0.62;

// ---------------------------------------------------------------- context
interface Ctx {
  g: GreaterGrid;
  board: Rect;
  items: BlockItem[];
  lots: Lot[];
  lines: number[][];
  block: Block;
  r: () => number;
  /** Camera-side block: keep buildings low. */
  low: boolean;
  west: boolean;
  site: { done: boolean };
  streetClass: Map<string, RoadClass>;
}

function add(c: Ctx, kind: string, p: Vec2, rot: number, role: ItemRole, extra: Partial<BlockItem> = {}): BlockItem {
  const it: BlockItem = { kind, x: round(p.x), z: round(p.z), rot: rot + frontYaw(kind), role, block: c.block.id, ...extra };
  if (role === 'building' || role === 'car' || SOLID.test(kind)) {
    const s = sizeOf(kind);
    it.fp = footprintRect(it.x, it.z, s.w * (extra.scale ?? 1), s.d * (extra.scale ?? 1), rot);
  }
  c.items.push(it);
  return it;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Yaw that turns a Kenney city-kit building's front to +z. The kits' doors / shopfronts / loading bays face −z as
 * authored and K3's kn.house / kn.shop / kn.works builders keep that (measured in the ?solo= preview); if K3 adds a
 * spec `yaw` to fix it, this correction steps back automatically.
 */
export function frontYaw(kind: string): number {
  if (!/^kn\.(house|shop|works)\./.test(kind) || kind === 'kn.works.container') return 0;
  return Math.PI - (BUILDING_SPEC_BY_KIND.get(kind)?.yaw ?? 0);
}
/** Props with a footprint worth checking (no overlaps with buildings). */
const SOLID = /^kn\.works\.|^kn\.prop\.dumpster$|^res\./;

function tree(c: Ctx, kinds: readonly string[], p: Vec2, s = 1): BlockItem {
  const kind = pick(c.r, kinds);
  const n = TREE_VARIANTS[kind] ?? 1;
  return add(c, kind, p, c.r() * Math.PI * 2, 'tree', { scale: round(s * (0.88 + c.r() * 0.3)), params: { variant: Math.floor(c.r() * n) } });
}

function lot(c: Ctx, kind: LotKind, rect: Rect, idx?: number): void {
  if (rect.maxX - rect.minX < 0.05 || rect.maxZ - rect.minZ < 0.05) return;
  c.lots.push({ kind, rect: { minX: round(rect.minX), maxX: round(rect.maxX), minZ: round(rect.minZ), maxZ: round(rect.maxZ) }, ...(idx !== undefined ? { idx } : {}) });
}

// ---------------------------------------------------------------- styles
function styleOf(b: Block, board: Rect): BlockStyle {
  const r = b.rect, cz = (r.minZ + r.maxZ) / 2, area = b.cells.w * b.cells.h;
  if (b.zone === 'waterfront') return 'skip';
  const west = r.maxX <= board.minX + 0.01;
  if (b.zone === 'industrial' || (west && cz > 0 && cz < board.maxZ + 2 && area >= 2 && (b.zone === 'park' || b.zone === 'frontage'))) return 'works';
  if (b.zone === 'commercial') return 'shops';
  if (b.zone === 'verge') return b.cells.w === 1 && b.cells.h >= 3 ? 'woods' : 'belt';
  if (b.zone === 'park') return 'park';
  if (b.density < 0.25) return 'woods';
  return 'houses';
}

/** Frontage sides ordered best first (long sides, then street rank). */
function frontSides(c: Ctx, b: Block): Dir[] {
  const long: Dir[] = b.cells.w >= b.cells.h ? ['n', 's'] : ['e', 'w'];
  const rank = (d: Dir) => {
    const f = b.frontage.find((x) => x.side === d);
    if (!f) return -1;
    const cls = c.streetClass.get(f.street);
    // locals and avenues make the nicest house fronts; the parkway belongs to G3's promenade
    return (long.includes(d) ? 10 : 0) + (cls === 'local' ? 4 : cls === 'avenue' ? 3 : cls === 'ring' ? 2 : cls === 'radial' ? 1 : 0);
  };
  return (['n', 's', 'e', 'w'] as Dir[]).filter((d) => rank(d) >= 0).sort((a, b2) => rank(b2) - rank(a));
}

function nearRoundabout(c: Ctx, p: Vec2, R = 13): boolean {
  return c.g.roundabouts.some((rb) => Math.hypot(rb.center.x - p.x, rb.center.z - p.z) < R);
}

// ---------------------------------------------------------------- houses (with shop parades by the roundabouts)
function fillStrip(c: Ctx, f: Frame, u0: number, u1: number): void {
  const { r } = c;
  let u = u0 + 0.25 + r() * 0.35;
  let n = 0;
  while (u < u1 - 2.6) {
    const mid = f.at(Math.min(u + 2, u1), f.D / 2);
    const shop = nearRoundabout(c, mid);
    const setback = shop ? 0.85 : f.D >= 5.4 ? 0.9 + r() * 0.4 : 0.55 + r() * 0.15;
    const room = f.D - setback - (shop ? 0.2 : 0.3);
    const pool = (shop ? (c.low ? SHOPS_LOW : SHOPS) : c.low ? HOUSES_LOW : f.D >= 5.4 ? HOUSES_DEEP : HOUSES_SHALLOW).filter((k) => sizeOf(k).d <= room);
    if (!pool.length) break;
    let kind = pick(r, pool);
    let { w, d } = sizeOf(kind);
    let gap = shop ? 0.12 : 0.55 + r() * 0.95;
    const drive = !shop && gap > 1.0 && r() < 0.7;
    if (drive) gap = Math.max(gap, 1.3);
    if (u + gap + w > u1 - 0.15) {
      const narrow = pool.slice().sort((a, b) => sizeOf(a).w - sizeOf(b).w)[0]!;
      kind = narrow; ({ w, d } = sizeOf(kind));
      if (u + gap + w > u1 - 0.15) break;
    }
    const lotW = gap + w;
    // construction site: one empty plot in the whole greater town
    if (!shop && !c.site.done && n > 1 && r() < 0.18) {
      c.site.done = true;
      constructionSite(c, f, u, u + lotW);
      u += lotW;
      n++;
      continue;
    }
    if (shop) {
      lot(c, 'paving', f.rect(u - 0.06, u + lotW + 0.06, 0, setback + 0.2));
      lot(c, 'garden', f.rect(u, u + lotW, setback + 0.2, f.D), n % 3);
    } else {
      lot(c, 'garden', f.rect(u + 0.06, u + lotW - 0.06, 0.06, f.D - 0.06), n % 3);
    }
    const hu = u + gap + w / 2, hv = setback + d / 2;
    add(c, kind, f.at(hu, hv), f.rot, 'building');
    if (drive) {
      lot(c, 'drive', f.rect(u + 0.2, u + gap - 0.2, 0, Math.min(setback + d - 0.3, f.D - 0.3)));
      if (r() < 0.75) add(c, 'kn.car.random', f.at(u + gap / 2, 1.15), f.rot + (r() < 0.5 ? 0 : Math.PI), 'car');
      if (r() < 0.35) add(c, 'st.mailbox', f.at(u + gap - 0.05, 0.3), f.rot, 'prop');
    } else if (!shop && gap >= 1.05) {
      if (r() < 0.55) tree(c, YARD_TREES, f.at(u + gap / 2, setback + 0.4 + r() * Math.max(0, d - 0.8)), 0.72);
      else add(c, 'veg.bush', f.at(u + gap / 2, setback + 0.5 + r() * 0.6), r() * 6.28, 'tree', { params: { variant: Math.floor(r() * 2) } });
    }
    if (shop && r() < 0.6) add(c, r() < 0.55 ? 'kn.prop.parasol' : 'kn.prop.planter', f.at(hu + (r() - 0.5) * (w - 1.2), 0.42), f.rot, 'prop');
    // back garden
    const back = setback + d;
    if (f.D - back >= 1.5 && r() < 0.85) {
      const tv = back + (f.D - back) / 2;
      tree(c, YARD_TREES, f.at(u + 0.8 + r() * Math.max(0.1, lotW - 1.6), tv), f.D - back < 2.2 ? 0.8 : 1);
      if (f.D - back >= 3 && r() < 0.5) tree(c, YARD_TREES, f.at(u + 0.8 + r() * Math.max(0.1, lotW - 1.6), back + (f.D - back) * 0.75));
    }
    u += lotW;
    n++;
  }
  // leftover side garden
  if (u1 - u >= 1.6) {
    lot(c, 'garden', f.rect(u + 0.06, u1 - 0.06, 0.06, f.D - 0.06), (n + 1) % 3);
    tree(c, YARD_TREES, f.at((u + u1) / 2, f.D * (0.35 + c.r() * 0.3)), Math.min(1, (u1 - u) / 2.2));
  }
}

function constructionSite(c: Ctx, f: Frame, u0: number, u1: number): void {
  lot(c, 'soil', f.rect(u0 + 0.15, u1 - 0.15, 0.15, f.D - 0.2));
  const m = (u0 + u1) / 2;
  for (let k = 0; k * 1.05 + 0.6 < u1 - u0 - 0.6; k++) add(c, 'kn.prop.roadworks', f.at(u0 + 0.9 + k * 1.05, 0.35), f.rot + Math.PI / 2, 'prop');
  add(c, 'kn.prop.dumpster', f.at(m - 0.9, f.D * 0.62), f.rot + Math.PI / 2, 'prop');
  add(c, 'kn.prop.crates', f.at(m + 0.7, f.D * 0.55), f.rot + 0.3, 'prop');
  add(c, 'kn.prop.crates', f.at(m + 1.1, f.D * 0.7), f.rot - 0.2, 'prop');
  add(c, 'kn.prop.barrel', f.at(m + 0.2, f.D * 0.78), 0, 'prop');
  add(c, 'kn.prop.cone', f.at(u0 + 0.5, 0.75), 0, 'prop');
  add(c, 'kn.prop.cone', f.at(u1 - 0.5, 0.75), 0, 'prop');
  add(c, 'kn.prop.barrier', f.at(m + 0.2, 0.75), f.rot + Math.PI / 2, 'prop');
}

function fillHouses(c: Ctx): void {
  const b = c.block, R = b.rect;
  const sides = frontSides(c, b);
  if (!sides.length) return fillPark(c, R);
  const small = Math.min(b.cells.w, b.cells.h) <= 2;
  if (small) {
    const s0 = sides[0]!, f0 = frameOf(R, s0);
    const pair = sides.includes(OPP[s0]) && f0.D >= 7.5;
    if (pair) {
      const half = f0.D / 2;
      const strip0 = f0.rect(0, f0.L, 0, half), strip1 = f0.rect(0, f0.L, half, f0.D);
      fillStrip(c, frameOf(strip0, s0), 0, f0.L);
      fillStrip(c, frameOf(strip1, OPP[s0]), 0, f0.L);
    } else {
      fillStrip(c, f0, 0, f0.L);
    }
    return;
  }
  // big block: perimeter strips on frontage sides (trimmed at shared corners), interior park / woods / field
  const taken = new Set<Dir>();
  const bands: Dir[] = [];
  for (const s of sides) {
    const f = frameOf(R, s);
    const [e0, e1] = ENDS[s];
    const u0 = taken.has(e0) ? STRIP : 0, u1 = f.L - (taken.has(e1) ? STRIP : 0);
    if (u1 - u0 < 4) continue;
    const band = f.rect(0, f.L, 0, STRIP);
    fillStrip(c, frameOf(band, s), u0, u1);
    taken.add(s);
    bands.push(s);
  }
  const inner: Rect = {
    minX: R.minX + (taken.has('w') ? STRIP : 0), maxX: R.maxX - (taken.has('e') ? STRIP : 0),
    minZ: R.minZ + (taken.has('n') ? STRIP : 0), maxZ: R.maxZ - (taken.has('s') ? STRIP : 0),
  };
  if (inner.maxX - inner.minX < 3 || inner.maxZ - inner.minZ < 3) return;
  if (b.density >= 0.55) fillPark(c, inner);
  else if (c.r() < 0.5 || (inner.maxX - inner.minX) * (inner.maxZ - inner.minZ) < 60) fillWoods(c, inner);
  else fillField(c, inner);
}

// ---------------------------------------------------------------- strip mall (commercial)
function fillShops(c: Ctx): void {
  const b = c.block, R = b.rect, { r } = c;
  const long: Dir[] = b.cells.w >= b.cells.h ? ['n', 's'] : ['e', 'w'];
  const rankOf = (d: Dir) => {
    const f = b.frontage.find((x) => x.side === d);
    return f ? (CLASS_RANK[c.streetClass.get(f.street) ?? 'local'] ?? 0) + (long.includes(d) ? 10 : 0) + (d === 's' || d === 'e' ? 0.5 : 0) : -1;
  };
  const side = (['n', 's', 'e', 'w'] as Dir[]).sort((a, b2) => rankOf(b2) - rankOf(a))[0]!;
  const f = frameOf(R, side);
  if (f.D < 7.5) return fillStrip(c, f, 0, f.L);
  const shopV = f.D - 3.05; // shop fronts line
  // planting strip with entrances, parking bays + aisle, a paved apron in front of the shops
  lot(c, 'parking', f.rect(0.35, f.L - 0.35, 0.65, shopV - 0.45));
  lot(c, 'paving', f.rect(0.2, f.L - 0.2, shopV - 0.45, shopV + 0.05));
  const entries = [f.L * 0.22, f.L * 0.74];
  for (let u = 1.2; u < f.L - 1.4; u += 3.4) {
    if (entries.some((e) => Math.abs(e - (u + 1.5)) < 2.6)) continue;
    add(c, 'veg.hedge', f.at(u + 1.5, 0.38), f.rot, 'prop', { params: { length: 2.8 } });
  }
  const stall = 1.3, v0 = 0.75, depth = 2.05;
  for (let u = 0.6; u + stall < f.L - 0.6; u += stall) {
    if (entries.some((e) => Math.abs(e - (u + stall / 2)) < 1.6)) continue;
    lot(c, 'line', f.rect(u - 0.03, u + 0.03, v0, v0 + depth));
    lot(c, 'line', f.rect(u + stall - 0.03, u + stall + 0.03, v0, v0 + depth));
    if (r() < 0.62) add(c, 'kn.car.random', f.at(u + stall / 2, v0 + depth / 2 + 0.05), f.rot + Math.PI, 'car');
  }
  for (let u = f.L * 0.12; u < f.L - 1; u += f.L * 0.38) add(c, 'kn.prop.streetLight', f.at(u, v0 + depth + 0.15), f.rot + Math.PI, 'prop');
  // shop row (a walkway through the middle), backs to the far street
  const walk = f.L / 2;
  let u = 0.45, n = 0;
  while (u < f.L - 2.4) {
    if (Math.abs(u + 1.1 - walk) < 1.4 && n > 0) {
      lot(c, 'paving', f.rect(u, u + 1.3, shopV, f.D - 0.1));
      add(c, 'kn.prop.planter', f.at(u + 0.65, shopV + 0.6), f.rot + Math.PI / 2, 'prop');
      u += 1.3;
    }
    const kind = pick(r, SHOPS);
    const { w, d } = sizeOf(kind);
    if (u + w > f.L - 0.35) break;
    add(c, kind, f.at(u + w / 2, shopV + 0.15 + d / 2), f.rot, 'building');
    u += w + 0.12;
    n++;
  }
  if (f.L - u >= 1.3) add(c, 'kn.prop.dumpster', f.at(u + 0.6, f.D - 0.6), f.rot + Math.PI / 2, 'prop');
}

// ---------------------------------------------------------------- works yard
function fillWorks(c: Ctx): void {
  const b = c.block, R = b.rect, { r } = c;
  const sides = frontSides(c, b);
  const side = sides.find((s) => c.streetClass.get(b.frontage.find((x) => x.side === s)!.street) === 'local') ?? sides[0] ?? 's';
  const f = frameOf(R, side);
  lot(c, 'yard', inset(R, 0.18));
  if (f.D >= 7.5) {
    // back row: factory, warehouse, tank, hall facing the street; a chimney if there is room; container stacks
    // (long side along the street) and barrels in the front yard
    let u = 0.45, k = 0, deepest = 0;
    const back = ['kn.works.factory', 'kn.works.warehouse', 'kn.works.tank', 'kn.works.hall'];
    while (u < f.L - 2) {
      let kind = back[(k + Math.floor(r() * 2)) % back.length]!;
      if (u + sizeOf(kind).w > f.L - 0.3) kind = 'kn.works.hall';
      const { w, d } = sizeOf(kind);
      if (u + w > f.L - 0.3) break;
      add(c, kind, f.at(u + w / 2, f.D - 0.35 - d / 2), f.rot, 'building');
      deepest = Math.max(deepest, d);
      u += w + 0.35;
      k++;
    }
    if (f.L - u >= 1.5) add(c, 'kn.works.chimney', f.at(u + 0.65, f.D - 1.0), 0, 'building');
    const frontV = Math.min(1.55, (f.D - 0.35 - deepest) / 2);
    let cu = 0.5;
    while (cu + 2.3 < f.L - 0.4) {
      const stack = r() < 0.55 ? 2 : 1;
      for (let s = 0; s < stack; s++) {
        add(c, 'kn.works.container', f.at(cu + 1.1, frontV), f.rot + Math.PI / 2 + (s ? 0.05 : 0), 'prop', { y: s * 1.38 * CONTAINER, scale: CONTAINER, params: { model: Math.floor(r() * 3) } });
      }
      cu += 2.5;
      if (cu + 1 < f.L - 0.4 && r() < 0.6) { add(c, 'kn.prop.barrel', f.at(cu + 0.2, frontV - 0.3), 0, 'prop'); add(c, 'kn.prop.crates', f.at(cu + 0.4, frontV + 0.35), f.rot, 'prop'); cu += 1; }
    }
    return;
  }
  // one-deep strip: sheds and warehouses facing the street, containers / crates in the gaps, poplars at the ends
  let u = 0.4, n = 0;
  const kinds = ['kn.works.warehouse', 'kn.works.hall', 'kn.works.shed', 'kn.works.hall', 'kn.works.solar'];
  while (u < f.L - 2) {
    const room = f.D - 0.55;
    const pool = kinds.filter((k) => sizeOf(k).d <= room);
    const kind = pool[(n + Math.floor(r() * 2)) % pool.length]!;
    const { w, d } = sizeOf(kind);
    if (u + w > f.L - 0.3) break;
    add(c, kind, f.at(u + w / 2, f.D - 0.3 - d / 2), f.rot, 'building');
    u += w + 0.25;
    const gap = 1.6 + r() * 1.4;
    if (u + gap < f.L - 0.3) {
      if (r() < 0.6 && f.D >= 3.6) {
        const two = r() < 0.5;
        for (let s = 0; s < (two ? 2 : 1); s++) add(c, 'kn.works.container', f.at(u + gap / 2, f.D * 0.55), f.rot + (s ? 0.06 : 0), 'prop', { y: s * 1.38 * CONTAINER, scale: CONTAINER, params: { model: Math.floor(r() * 3) } });
      }
      else { add(c, 'kn.prop.crates', f.at(u + gap / 2 - 0.3, f.D * 0.5), f.rot + 0.2, 'prop'); add(c, 'kn.prop.barrel', f.at(u + gap / 2 + 0.35, f.D * 0.6), 0, 'prop'); }
      u += gap;
    }
    n++;
  }
  if (f.L - u > 1.4) tree(c, ['veg.poplar'], f.at((u + f.L) / 2, f.D * 0.5), 0.9);
}

// ---------------------------------------------------------------- parks, woods, belts, fields
function fillPark(c: Ctx, R: Rect): void {
  const { r } = c;
  const W = R.maxX - R.minX, H = R.maxZ - R.minZ;
  lot(c, 'lawn', inset(R, 0.12));
  const cx = (R.minX + R.maxX) / 2, cz = (R.minZ + R.maxZ) / 2;
  if (W * H < 20) {
    // pocket park: three trees in the corners, a bench facing a flower bed
    const corners = [{ x: R.minX + 0.95, z: R.minZ + 0.95 }, { x: R.maxX - 0.95, z: R.minZ + 0.95 }, { x: R.minX + 0.95, z: R.maxZ - 0.95 }, { x: R.maxX - 0.95, z: R.maxZ - 0.95 }];
    const skip = Math.floor(r() * 4);
    corners.forEach((p, k) => { if (k !== skip) tree(c, PARK_TREES, p, 0.85); });
    const sk = corners[skip]!;
    add(c, 'st.bench', { x: (sk.x + cx) / 2, z: (sk.z + cz) / 2 }, yawTo({ x: cx - sk.x, z: cz - sk.z }), 'prop');
    add(c, 'veg.flowerbed', { x: cx, z: cz }, W >= H ? 0 : Math.PI / 2, 'prop');
    return;
  }
  const pathW = 0.8;
  const crossX = W >= 6, crossZ = H >= 6;
  const pathX = crossX || W >= H, pathZ = crossZ || H > W;
  if (pathX) lot(c, 'path', { minX: R.minX + 0.12, maxX: R.maxX - 0.12, minZ: cz - pathW / 2, maxZ: cz + pathW / 2 });
  if (pathZ) lot(c, 'path', { minX: cx - pathW / 2, maxX: cx + pathW / 2, minZ: R.minZ + 0.12, maxZ: R.maxZ - 0.12 });
  const onPath = (x: number, z: number, m: number) => (pathX && Math.abs(z - cz) < pathW / 2 + m) || (pathZ && Math.abs(x - cx) < pathW / 2 + m);
  // perimeter trees (a second inner ring in big parks)
  const step = 2.5;
  const ring: Vec2[] = [];
  const e = 0.85;
  for (let x = R.minX + e; x <= R.maxX - e + 1e-6; x += step) ring.push({ x, z: R.minZ + e }, { x, z: R.maxZ - e });
  for (let z = R.minZ + e + step; z <= R.maxZ - e - step * 0.5; z += step) ring.push({ x: R.minX + e, z }, { x: R.maxX - e, z });
  if (W >= 12 && H >= 12) for (let k = 0; k < 4; k++) ring.push({ x: cx + (k % 2 ? 1 : -1) * W * 0.22, z: cz + (k < 2 ? 1 : -1) * H * 0.22 });
  for (const p of ring) {
    if (r() < 0.15) continue;
    const q = { x: p.x + (r() - 0.5) * 0.4, z: p.z + (r() - 0.5) * 0.4 };
    if (onPath(q.x, q.z, 0.45)) continue;
    tree(c, PARK_TREES, q, W * H < 40 ? 0.85 : 1);
  }
  // benches by the path, a flower bed at the crossing, a lamp; a playground in a big park
  const horizontal = pathX;
  const off = Math.min(2.4, (horizontal ? W : H) / 4);
  add(c, 'st.bench', horizontal ? { x: cx - off, z: cz - pathW / 2 - 0.4 } : { x: cx - pathW / 2 - 0.4, z: cz - off }, horizontal ? 0 : Math.PI / 2, 'prop');
  add(c, 'st.bench', horizontal ? { x: cx + off, z: cz + pathW / 2 + 0.4 } : { x: cx + pathW / 2 + 0.4, z: cz + off }, horizontal ? Math.PI : -Math.PI / 2, 'prop');
  if (pathX && pathZ) add(c, 'veg.flowerbed', { x: cx + pathW / 2 + 1.3, z: cz - pathW / 2 - 0.75 }, 0, 'prop');
  if (W * H >= 30) add(c, 'kn.prop.streetLight', { x: cx + pathW / 2 + 0.25, z: cz + pathW / 2 + 0.25 }, Math.PI * 1.25, 'prop');
  if (W >= 10 && H >= 8 && r() < 0.8) {
    const px = cx + W / 4 + 0.2, pz = cz + H / 4 + 0.1;
    if (px + 2 < R.maxX - 0.5 && pz + 1.5 < R.maxZ - 0.5) add(c, 'res.playground', { x: px, z: pz }, 0, 'building');
  }
}

function fillWoods(c: Ctx, R: Rect, front?: Dir): void {
  const { r } = c;
  lot(c, 'meadow', inset(R, 0.1));
  const kinds = c.west ? WOOD_TREES_W : WOOD_TREES;
  const sp = 1.85;
  const m = 0.75;
  const keep = (x: number, z: number) => {
    if (!front) return true;
    const d = front === 'n' ? z - R.minZ : front === 's' ? R.maxZ - z : front === 'w' ? x - R.minX : R.maxX - x;
    return d > 1.25;
  };
  const dens = Math.max(0.45, Math.min(0.9, 1 - c.block.density));
  for (let z = R.minZ + m; z <= R.maxZ - m + 1e-6; z += sp) {
    for (let x = R.minX + m; x <= R.maxX - m + 1e-6; x += sp) {
      if (r() > dens) continue;
      const q = { x: Math.min(R.maxX - m, Math.max(R.minX + m, x + (r() - 0.5) * 0.9)), z: Math.min(R.maxZ - m, Math.max(R.minZ + m, z + (r() - 0.5) * 0.9)) };
      if (!keep(q.x, q.z)) continue;
      tree(c, kinds, q, 0.95 + r() * 0.2);
    }
  }
  if (front) powerPoles(c, frameOf(R, front));
}

function fillBelt(c: Ctx, R: Rect): void {
  const b = c.block, { r } = c;
  const side = frontSides(c, b)[0];
  lot(c, 'meadow', inset(R, 0.1));
  if (!side) return fillWoods(c, R);
  const f = frameOf(R, side);
  powerPoles(c, f);
  let u = 0.9 + r(), k = 0;
  while (u < f.L - 0.9) {
    if (r() < 0.16) { u += 1.4 + r() * 1.6; continue; }
    const v = Math.min(f.D - 0.85, (k++ % 2 ? 2.95 : 1.85) + (r() - 0.5) * 0.35);
    tree(c, BELT_TREES, f.at(u, v), 0.92 + r() * 0.18);
    u += 1.5 + r() * 0.9;
  }
}

function powerPoles(c: Ctx, f: Frame): void {
  const idx: number[] = [];
  const n = Math.max(1, Math.round((f.L - 1.2) / 9.5));
  const step = (f.L - 1.2) / n;
  for (let k = 0; k <= n; k++) {
    const p = f.at(0.6 + k * step, 0.55);
    c.items.push({ kind: 'kn.prop.powerPole', x: round(p.x), z: round(p.z), rot: f.rot, role: 'pole', block: c.block.id });
    idx.push(c.items.length - 1);
  }
  c.lines.push(idx);
}

function fillField(c: Ctx, R: Rect): void {
  const { r } = c;
  const W = R.maxX - R.minX, H = R.maxZ - R.minZ;
  lot(c, 'meadow', inset(R, 0.1));
  const F = inset(R, 0.7);
  const alongX = W >= H;
  const n = Math.floor((alongX ? F.maxZ - F.minZ : F.maxX - F.minX) / 0.85);
  for (let k = 0; k < n; k++) {
    const a = (alongX ? F.minZ : F.minX) + k * 0.85, b = a + 0.72;
    lot(c, k % 2 ? 'cropB' : 'cropA', alongX ? { minX: F.minX, maxX: F.maxX, minZ: a, maxZ: b } : { minX: a, maxX: b, minZ: F.minZ, maxZ: F.maxZ });
  }
  // a barn and a tractor at one corner, trees on the others
  const corner = { x: F.maxX - 1.9, z: F.minZ + 1.9 };
  add(c, 'kn.works.shed', corner, Math.PI / 2, 'building');
  add(c, 'kn.car.tractor', { x: F.minX + 1.6, z: (F.minZ + F.maxZ) / 2 }, alongX ? Math.PI / 2 : 0, 'car');
  tree(c, ['veg.oak', 'veg.maple'], { x: R.minX + 0.9, z: R.maxZ - 0.9 });
  tree(c, ['veg.oak', 'veg.poplar'], { x: R.maxX - 0.9, z: R.maxZ - 0.9 });
  if (r() < 0.6) tree(c, ['veg.oak'], { x: R.minX + 0.9, z: R.minZ + 0.9 });
}

// ---------------------------------------------------------------- planner
const cache = new WeakMap<TownMap, BlocksPlan>();

export function planGreaterBlocks(map: TownMap): BlocksPlan {
  const hit = cache.get(map);
  if (hit) return hit;
  const g = greaterGrid(map);
  const board = map.bounds;
  const items: BlockItem[] = [];
  const lots: Lot[] = [];
  const lines: number[][] = [];
  const styles: Record<string, BlockStyle> = {};
  const streetClass = new Map(g.streets.map((s) => [s.name, s.cls] as const));
  const site = { done: false };
  for (const block of g.blocks) {
    const style = styleOf(block, board);
    styles[block.id] = style;
    if (style === 'skip') continue;
    const R = block.rect;
    const c: Ctx = {
      g, board, items, lots, lines, block, r: rng(block.seed ^ 0x9e3779b9), streetClass, site,
      low: R.minX >= board.maxX - 0.01 || R.minZ >= board.maxZ - 0.01,
      west: R.maxX <= board.minX + 0.01,
    };
    switch (style) {
      case 'houses': fillHouses(c); break;
      case 'shops': fillShops(c); break;
      case 'works': fillWorks(c); break;
      case 'park': fillPark(c, R); break;
      case 'belt': fillBelt(c, R); break;
      case 'field': fillField(c, R); break;
      case 'woods': {
        const f = frontSides(c, block).find((s) => {
          const cls = streetClass.get(block.frontage.find((x) => x.side === s)!.street);
          return cls === 'avenue' || cls === 'ring';
        });
        fillWoods(c, R, f);
        break;
      }
    }
  }
  mergeLines(items, lines);
  planStreetFurniture(g, items, styles);
  const plan = { styles, items, lots, lines };
  cache.set(map, plan);
  return plan;
}

/** Join power lines whose ends are close (across a junction or around a corner). */
function mergeLines(items: BlockItem[], lines: number[][]): void {
  const P = (i: number) => items[i]!;
  const d = (a: number, b: number) => Math.hypot(P(a).x - P(b).x, P(a).z - P(b).z);
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines.length; j++) {
        if (i === j) continue;
        const A = lines[i]!, B = lines[j]!;
        const opts: Array<[number, () => number[]]> = [
          [d(A[A.length - 1]!, B[0]!), () => [...A, ...B]],
          [d(A[A.length - 1]!, B[B.length - 1]!), () => [...A, ...B.slice().reverse()]],
          [d(A[0]!, B[0]!), () => [...A.slice().reverse(), ...B]],
        ];
        for (const [dist, join] of opts) {
          if (dist < 13.5) {
            lines[i] = join();
            lines.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
  }
}
