// Owner: K3 (plan v5 + v7). Kenney city kits as placeable buildings and props (catalog entries in catalog.ts):
//   kn.house.*  city-kit-suburban houses: per-placement siding, roof, door and window-glow colours from our roles
//   kn.shop.*   city-kit-commercial low-rises (≤ 3 storeys): brick/cream facades, painted shopfronts, palette awnings
//   kn.works.*  city-kit-industrial pieces for an outskirts works yard (sheds, halls, factory, tanks, containers…)
//   kn.prop.*   street + survival props (cones, barriers, dumpster, power poles, signs, street light, crates, parasol…)
// v7 overrides (Kenney wins once preloaded, the A3 builder stays the fallback): res.house (narrow two-storey
// houses, 2.5 u lot) and res.townhouses (a pair of narrow houses, 6 u lot).
//
// Every part is drawn with `k.mat(role, idx)` (the same seam as every other family), so the composer bakes Kenney
// parts like kit parts and palette switches recolour them; colours come from palette roles (window, door, awning,
// leaf…) and the knb* ROLES below. Kenney's part roles (K0 template) are mapped per building class; parts K0 merges
// that we need apart (house roofs vs. the shrubs at their feet, shop awnings vs. planters) are split by height.
// Models are re-centred on their footprint (Kenney industrial pieces are off-centre); front faces +z.
// params (all optional, else seeded per placement via k.rand()):
//   model: number   pick the model of a multi-model kind
//   wall, roof, door, front, awning: number   colour variant indices (res.house keeps A3's `wall` / `roof`)
//   lit: boolean    windows glow at dusk (default: about half the buildings)
// Builders are synchronous: `await preloadKenney(kenneyIdsFor(kinds))` first. Until a model is loaded a kind falls
// back to the previous builder (res.*) or a small toy stand-in with the catalog footprint.
import * as THREE from 'three';
import { declareKenney, KENNEY_ROLES, kenneyReady, kenneyTemplate, type KenneyId } from '../kenney';
import type { KenneyTemplate } from '../kenney/template';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, FamilyId, KitContext, RoleColors } from '../types';

/** Catalog/registry family of every kn.* kind ('kenney' is not in FamilyId yet — coordinator seam). */
export const KENNEY_FAMILY = 'kenney' as FamilyId;

/** K3 roles (palette a Wooden Toy, b Miniature Railway, c State College Autumn) + K0's kn* roles for props. */
export const ROLES: RoleColors = {
  ...KENNEY_ROLES,
  /** House siding: cream, powder blue, blush, butter, sage (a). */
  knbSiding: [['#F6EEDC', '#D3E4EE', '#F5D5C5', '#F7E3A9', '#DDEBD3'], ['#E3CBA8', '#D8C8A8', '#C8694C', '#B5BFA8', '#EADCC4'], ['#F5F2EA', '#EADFC9', '#C9D3DC', '#A8483A', '#E2D3B5']],
  /** House frames, fascias, foundations (Kenney's grey trim). */
  knbTrim: ['#FFFDF8', '#F5EFE3', '#FFFFFF'],
  /** Pitched house roofs: terracotta ×2, sea green, slate, apricot (a). */
  knbRoof: [['#E9785A', '#D9694F', '#4FA391', '#8C96A8', '#EBA25E'], ['#5E6B73', '#8F3F2C', '#4A4F55', '#7A5A40', '#6E7F6A'], ['#3E4B5C', '#1E3A6E', '#5B6573', '#7A3E34', '#4A5A48']],
  /** Front doors: wood, teal, coral, blue (a). */
  knbDoor: [['#9B6B43', '#3FA796', '#E9785A', '#5A8BD6'], ['#5A3A2A', '#2F7F7A', '#8F3F2C', '#22407A'], ['#6B4A35', '#1E3A6E', '#A8483A', '#2E8B57']],
  /** Timber cladding of the modern flat-roof houses (Kenney's dark upper storeys). */
  knbCladding: [['#B98C5E', '#A8784E'], ['#8C6B4E', '#7A5A40'], ['#8A6A4E', '#6B4A35']],
  /** Clipped shrubs at house/shop feet: stay green in every palette. */
  knbHedge: [['#5DB57A', '#4FAF6E'], ['#7E9F6B', '#6B8C5C'], ['#7F9C58', '#6E8C4E']],
  /** Shop facades: red brick ×3, cream, tan, pale blue (a) — college-town main street. */
  knbFacade: [['#D98A6C', '#C97A5E', '#E3A07E', '#F3E6CF', '#E9C9A2', '#CFE0E8'], ['#A9503A', '#93452F', '#C8694C', '#E6DCC6', '#D8BE98', '#B5BFA8'], ['#A8483A', '#8F3C30', '#B85A48', '#EADFC9', '#D6C2A2', '#C9D3DC']],
  /** Limestone trims, cornices and sills of shops. */
  knbStone: ['#F4EEE2', '#EADCC4', '#F5F2EA'],
  /** Painted shopfronts (Kenney's dark ground floors): deep green, navy, wood, oxblood, slate blue (a). */
  knbShopfront: [['#2F7A66', '#3E5A7A', '#9B6B43', '#B5553C', '#5E8299'], ['#2F5D50', '#2F4470', '#5A3A2A', '#8F3F2C', '#4A6A8F'], ['#0B2A5B', '#2E5B3A', '#6B4A35', '#A8483A', '#3E5B70']],
  /** Works yard: pale cladding, darker accent cladding, roofs, steel, safety yellow. */
  knbWorksWall: [['#E9E3D6', '#E4DACB', '#DDE3E4'], ['#D8D0BF', '#CFC6B4', '#C9CCC4'], ['#E2E0DA', '#D9D1C2', '#D5D9DD']],
  knbWorksAccent: [['#6F8FA6', '#7FA08A', '#C9785A'], ['#4A6A8F', '#6E8F6A', '#A9503A'], ['#3B5B92', '#5E7F5A', '#A8483A']],
  knbWorksRoof: [['#8E98A6', '#A39A8C'], ['#6E6A64', '#7A7268'], ['#5B6573', '#6B6A66']],
  knbSteel: ['#C9CFD6', '#B9B4AA', '#BFC5CD'],
  knbSafety: ['#F2C14E', '#D9A441', '#E9B03B'],
};

// ---------------------------------------------------------------- derived parts (split + re-centred, cached)
/** A Kenney template part, possibly split by height (`low` = triangle centroid below LOW_Y). */
export interface BuildingPart { geometry: THREE.BufferGeometry; role: string; up: boolean; low: boolean; tris: number; /** y extent */ minY: number; maxY: number }
interface Derived { parts: BuildingPart[]; cx: number; cz: number; size: THREE.Vector3 }
/** Roles K0 merges across very different things: green = roofs (suburban) or shrubs/awnings; yellow = awnings/stripes. */
const SPLIT = new Set(['roof', 'knGreen', 'knYellow']);
const LOW_Y = 0.6;
const derivedCache = new WeakMap<KenneyTemplate, Derived>();

/** A geometry with only the vertices `ids` uses (same attributes, re-indexed). */
function compact(src: THREE.BufferGeometry, ids: number[]): THREE.BufferGeometry {
  const map = new Map<number, number>();
  const index = ids.map((i) => { let n = map.get(i); if (n === undefined) { n = map.size; map.set(i, n); } return n; });
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const out = new Float32Array(map.size * a.itemSize);
    for (const [from, to] of map) for (let c = 0; c < a.itemSize; c++) out[to * a.itemSize + c] = a.getComponent(from, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  g.setIndex(new THREE.BufferAttribute(map.size > 65535 ? new Uint32Array(index) : new Uint16Array(index), 1));
  return g;
}

function derive(t: KenneyTemplate): Derived {
  let d = derivedCache.get(t);
  if (d) return d;
  const parts: BuildingPart[] = [];
  for (const p of t.parts) {
    const base = { role: p.info.role, up: !!p.info.up };
    const index = p.geometry.getIndex();
    const ext = (g: THREE.BufferGeometry) => { if (!g.boundingBox) g.computeBoundingBox(); return { minY: g.boundingBox!.min.y, maxY: g.boundingBox!.max.y }; };
    if (!SPLIT.has(p.info.role) || !index) { parts.push({ ...base, geometry: p.geometry, low: false, tris: p.tris, ...ext(p.geometry) }); continue; }
    const pos = p.geometry.getAttribute('position');
    const lo: number[] = [], hi: number[] = [];
    for (let i = 0; i + 2 < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      ((pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 < LOW_Y ? lo : hi).push(a, b, c);
    }
    for (const [ids, low] of [[lo, true], [hi, false]] as const) {
      if (!ids.length) continue;
      if (ids.length === index.count) { parts.push({ ...base, geometry: p.geometry, low, tris: p.tris, ...ext(p.geometry) }); continue; }
      const g = compact(p.geometry, ids);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      g.name = `${p.geometry.name}:${low ? 'low' : 'high'}`;
      parts.push({ ...base, geometry: g, low, tris: ids.length / 3, ...ext(g) });
    }
  }
  const c = t.box.getCenter(new THREE.Vector3());
  d = { parts, cx: c.x, cz: c.z, size: t.size.clone() };
  derivedCache.set(t, d);
  return d;
}

// ---------------------------------------------------------------- looks (Kenney part role → our role)
export interface Variant { wall: number; roof: number; door: number; front: number; awning: number; lit: boolean }
export type RoleRef = { role: string; idx?: number; detail?: boolean };
type Look = (p: BuildingPart, v: Variant) => RoleRef;

/** Parts every class shares: glass, planter soil, flat roof tops; anything unmapped keeps K0's role. */
function common(p: BuildingPart, v: Variant): RoleRef {
  switch (p.role) {
    case 'knSky': return { role: 'window', idx: v.lit ? 1 : 0 };
    case 'knPeach': return p.up ? { role: 'knDirtDark' } : { role: 'knPeach' };
    case 'knRoofFlat': return { role: 'knRoofFlat' };
    case 'knGreen': case 'roof': return p.low ? { role: 'knbHedge', idx: v.wall % 2, detail: true } : { role: 'awning', idx: v.awning };
    case 'knYellow': return { role: 'awning', idx: v.awning };
    default: return { role: p.role };
  }
}

export const LOOKS = {
  house: ((p, v) => {
    switch (p.role) {
      case 'knWhite': return { role: 'knbSiding', idx: v.wall };
      case 'knGreyLight': return { role: 'knbTrim' };
      // doors are ≤ 0.7 u tall; Kenney's dark storeys (modern flat-roof houses, type l) become timber cladding
      case 'knSlate': return p.maxY - p.minY > 2 ? { role: 'knbCladding', idx: v.door % 2 } : { role: 'knbDoor', idx: v.door };
      case 'roof': return p.low ? { role: 'knbHedge', idx: v.wall % 2, detail: true } : { role: 'knbRoof', idx: v.roof };
      default: return common(p, v);
    }
  }) as Look,
  shop: ((p, v) => {
    switch (p.role) {
      case 'knWhite': return { role: 'knbFacade', idx: v.wall };
      case 'knGreyLight': return { role: 'knbStone' };
      case 'knSlate': return { role: 'knbShopfront', idx: v.front };
      default: return common(p, v);
    }
  }) as Look,
  works: ((p, v) => {
    switch (p.role) {
      case 'knGreyLight': return p.up ? { role: 'knbWorksRoof', idx: v.roof % 2 } : { role: 'knbWorksWall', idx: v.wall % 3 };
      case 'knWhite': return { role: 'knbStone' };
      case 'knSlate': return { role: 'knbWorksAccent', idx: v.front % 3 };
      case 'knSilver': return { role: 'knbSteel' };
      case 'knYellow': return { role: 'knbSafety' };
      default: return common(p, v);
    }
  }) as Look,
  /** Props keep K0's harmonised kn* roles. */
  prop: ((p) => ({ role: p.role })) as Look,
  /** Cafe parasols: the canopy takes the awning colours. */
  parasol: ((p, v) => (p.role === 'knGreen' && !p.low ? { role: 'awning', idx: v.awning } : { role: p.role })) as Look,
  /** Street lights: dark posts like the kit lamps; the head lights up at dusk (palette `lamp`). */
  lamp: ((p) => (p.role === 'knWhite' ? { role: 'lamp' } : p.role === 'knSilver' ? { role: 'knSlate' } : { role: p.role })) as Look,
};
export type LookId = keyof typeof LOOKS;

// ---------------------------------------------------------------- specs
export interface BuildingSpec {
  kind: string;
  ids: readonly KenneyId[];
  /** Catalog footprint (x by z) and height in board units, at `scale`. */
  w: number; d: number; h: number;
  look: LookId;
  /** Extra scale on top of KENNEY_SCALE (containers, power poles). */
  scale?: number;
  /** Yaw applied to the model before placement (Kenney street lights point their arm to −z). */
  yaw?: number;
  /** Props: instanced-friendly fixed geometry. */
  prop?: boolean;
  note: string;
}

const SUB = (n: string) => `city-kit-suburban/building-type-${n}` as KenneyId;
const COM = (n: string) => `city-kit-commercial/building-${n}` as KenneyId;
const IND = (n: string) => `city-kit-industrial/${n}` as KenneyId;
const ROAD = (n: string) => `city-kit-roads/${n}` as KenneyId;
const SURV = (n: string) => `survival-kit/${n}` as KenneyId;

const HOUSE_BUNGALOW = ['a', 'h', 'i'].map(SUB);
const HOUSE_FAMILY = ['c', 'e', 'o', 'j', 's', 'u'].map(SUB);
const HOUSE_NARROW = ['k', 'l', 'r'].map(SUB);
const HOUSE_MODERN = ['p', 'q'].map(SUB);

const b = (kind: string, ids: KenneyId[], w: number, d: number, h: number, look: LookId, note: string, extra: Partial<BuildingSpec> = {}): BuildingSpec =>
  ({ kind, ids, w, d, h, look, note, ...extra });
const prop = (kind: string, ids: KenneyId[], w: number, d: number, h: number, note: string, extra: Partial<BuildingSpec> = {}): BuildingSpec =>
  ({ kind, ids, w, d, h, look: 'prop', prop: true, note, ...extra });

/** Every K3 kn.* kind (catalog.ts carries the same footprints; the test checks they agree and fit the models). */
export const BUILDING_SPECS: readonly BuildingSpec[] = [
  b('kn.house.bungalow', HOUSE_BUNGALOW, 3.4, 2.7, 2.1, 'house', 'one-storey suburban house, pitched roof'),
  b('kn.house.family', HOUSE_FAMILY, 3.7, 2.9, 2.9, 'house', 'two-storey suburban family house'),
  b('kn.house.narrow', HOUSE_NARROW, 2.7, 2.7, 2.9, 'house', 'narrow two-storey house (tight lots)'),
  b('kn.house.large', ['b', 'd', 'n'].map(SUB), 4.8, 3.6, 3.1, 'house', 'large two-storey house with garage wing'),
  b('kn.house.wide', ['f', 't'].map(SUB), 3.7, 3.7, 3.0, 'house', 'deep two-storey house, square lot'),
  b('kn.house.modern', HOUSE_MODERN, 3.3, 2.6, 2.4, 'house', 'modern flat-roof house, timber upper storey'),
  b('kn.house.ranch', ['g', 'm'].map(SUB), 3.8, 3.8, 2.0, 'house', 'wide one-storey ranch house'),
  b('kn.house.random', [...HOUSE_BUNGALOW, ...HOUSE_FAMILY, ...HOUSE_NARROW], 3.7, 2.9, 2.9, 'house', 'random suburban house per placement (bungalow / family / narrow)'),
  b('kn.shop.small', ['a', 'b', 'd', 'h'].map(COM), 2.6, 2.7, 3.4, 'shop', '3-storey shop, painted shopfront'),
  b('kn.shop.low', [COM('c')], 2.3, 2.9, 2.3, 'shop', '2-storey shop with planters'),
  b('kn.shop.wide', [COM('e')], 4.3, 2.7, 2.3, 'shop', 'wide 2-storey shop with awning'),
  b('kn.shop.random', ['a', 'b', 'c', 'd', 'h'].map(COM), 2.6, 2.9, 3.4, 'shop', 'random small shop per placement'),
  b('kn.works.shed', ['building-h', 'building-i', 'building-j'].map(IND), 3.5, 3.5, 2.2, 'works', 'works shed (pitched / round roof)'),
  b('kn.works.hall', [IND('building-k')], 3.4, 2.4, 2.0, 'works', 'sawtooth-roof workshop hall'),
  b('kn.works.warehouse', ['building-s', 'building-p'].map(IND), 5.6, 2.6, 2.2, 'works', 'long low warehouse with loading doors'),
  b('kn.works.factory', [IND('building-e')], 4.4, 3.4, 4.3, 'works', 'factory with two chimneys'),
  b('kn.works.tank', [IND('detail-tank-large')], 4.0, 4.3, 2.5, 'works', 'large storage tank'),
  b('kn.works.tankSmall', [IND('detail-tank')], 2.2, 1.4, 1.1, 'works', 'small horizontal tank'),
  b('kn.works.chimney', [IND('chimney-medium')], 1.2, 1.2, 5.0, 'works', 'tall works chimney'),
  b('kn.works.container', ['shipping-container-a', 'shipping-container-b', 'shipping-container-c'].map(IND), 1.4, 3.0, 1.3, 'prop', 'shipping container (red / blue / green), long side along z', { scale: 1.4 }),
  b('kn.works.solar', [IND('solar-panel-landscape-group')], 4.0, 2.4, 0.7, 'works', 'ground solar panel array'),
  prop('kn.prop.cone', [ROAD('construction-cone')], 0.25, 0.25, 0.25, 'traffic cone'),
  prop('kn.prop.barrier', [ROAD('construction-barrier')], 0.4, 0.6, 0.35, 'road works barrier'),
  prop('kn.prop.roadworks', [ROAD('construction-fence')], 0.25, 1.0, 0.5, 'road works fence panel'),
  prop('kn.prop.dumpster', [ROAD('dumpster')], 0.8, 1.0, 0.55, 'dumpster'),
  prop('kn.prop.powerPole', [ROAD('electricity-pole')], 2.5, 0.9, 2.2, 'pair of wooden power poles with wires (along x)', { scale: 1.6 }),
  prop('kn.prop.signStop', [ROAD('road-sign-stop')], 0.25, 0.4, 1.3, 'stop sign (faces +z)'),
  prop('kn.prop.signWarning', [ROAD('road-sign-warning')], 0.25, 0.45, 1.3, 'warning sign (faces +z)'),
  prop('kn.prop.signStreet', [ROAD('road-sign-street')], 0.55, 0.55, 1.3, 'street name sign'),
  { kind: 'kn.prop.streetLight', ids: [ROAD('light-curved')], w: 0.2, d: 0.6, h: 1.8, look: 'lamp', prop: true, yaw: Math.PI, note: 'curved street light, arm over +z (face the road), head glows at dusk' },
  prop('kn.prop.barrel', [SURV('barrel')], 0.35, 0.35, 0.45, 'barrel'),
  prop('kn.prop.crates', [SURV('box-large'), SURV('box')], 0.35, 0.65, 0.4, 'wooden crate'),
  prop('kn.prop.parasol', ['city-kit-commercial/detail-parasol-a', 'city-kit-commercial/detail-parasol-b'], 1.0, 1.1, 1.2, 'cafe table with parasol (awning colours)', { look: 'parasol' }),
  prop('kn.prop.planter', ['city-kit-suburban/planter'], 1.1, 0.8, 0.5, 'stone planter with shrubs'),
];
export const BUILDING_SPEC_BY_KIND = new Map(BUILDING_SPECS.map((s) => [s.kind, s] as const));

/** v7 overrides of existing kinds: models + look + lot (kept from the catalog). */
export const RES_HOUSE_IDS: readonly KenneyId[] = HOUSE_NARROW;
/** Townhouse rows use twin pitched-roof narrow houses (k, r) in different colours. */
export const RES_TOWNHOUSE_IDS: readonly KenneyId[] = ['k', 'r'].map(SUB);

// ---------------------------------------------------------------- building
const SIDING = 5, ROOF = 5, DOOR = 4, FRONT = 5, AWNING = 3, FACADE = 6;
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined);
const pick = (k: KitContext, n: number, p?: number): number => (p !== undefined ? ((p % n) + n) % n : Math.floor(k.rand() * n) % n);

/** Per-placement colours. Draw order is fixed so the same placement always gets the same building. */
export function variant(k: KitContext, params: AssetParams, look: LookId): Variant {
  const wallN = look === 'shop' ? FACADE : SIDING;
  const wall = pick(k, wallN, int(params.wall));
  // roofs: mostly terracotta, sometimes sea green / slate / apricot (gameplay owns saturation)
  const r = k.rand();
  const roof = int(params.roof) ?? (r < 0.34 ? 0 : r < 0.6 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4);
  const door = pick(k, DOOR, int(params.door));
  const front = pick(k, FRONT, int(params.front));
  const awning = pick(k, AWNING, int(params.awning));
  const lit = typeof params.lit === 'boolean' ? params.lit : k.rand() < 0.5;
  return { wall, roof: ((roof % ROOF) + ROOF) % ROOF, door, front, awning, lit };
}

/** One Kenney model through a look: meshes share the template geometry; materials come from the kit. */
export function kenneyBuilding(k: KitContext, id: KenneyId, look: LookId, v: Variant, opts: { scale?: number; yaw?: number } = {}): THREE.Group {
  const t = kenneyTemplate(id);
  if (!t) throw new Error(`kenney model not loaded: ${id}`);
  const d = derive(t);
  const s = opts.scale ?? 1;
  const inner = new THREE.Group();
  inner.scale.setScalar(s);
  inner.position.set(-d.cx * s, 0, -d.cz * s);
  for (const p of d.parts) {
    const r = LOOKS[look](p, v);
    const m = new THREE.Mesh(p.geometry, k.mat(r.role, r.idx ?? 0));
    m.castShadow = true;
    m.receiveShadow = true;
    if (r.detail) k.detail(m);
    inner.add(m);
  }
  const g = new THREE.Group();
  g.name = `kenney:${id}`;
  g.userData.kenneyId = id;
  if (opts.yaw) { const y = new THREE.Group(); y.rotation.y = opts.yaw; y.add(inner); g.add(y); } else g.add(inner);
  return g;
}

/** Size of a model at the given extra scale (board units), or undefined until loaded. */
export function kenneyBuildingSize(id: KenneyId, scale = 1): THREE.Vector3 | undefined {
  const t = kenneyTemplate(id);
  return t ? t.size.clone().multiplyScalar(scale) : undefined;
}

function chooseModel(k: KitContext, ids: readonly KenneyId[], params: AssetParams): KenneyId | undefined {
  const ready = ids.filter((id) => kenneyReady(id));
  if (!ready.length) return undefined;
  const m = int(params.model);
  const r = k.rand();
  const want = m !== undefined ? ids[((m % ids.length) + ids.length) % ids.length]! : undefined;
  return want && kenneyReady(want) ? want : ready[Math.floor(r * ready.length) % ready.length];
}

/** Toy stand-in with the catalog footprint while a model is not loaded (walls + roof slab + door, or a crate). */
function standIn(k: KitContext, spec: { w: number; d: number; h: number; prop?: boolean }): THREE.Group {
  const g = new THREE.Group();
  if (spec.prop) {
    const box = k.rbox(spec.w * 0.8, spec.h * 0.9, spec.d * 0.8, Math.min(spec.w, spec.d) * 0.12, k.mat('knWood'));
    box.position.y = spec.h * 0.45;
    g.add(box);
    return g;
  }
  const wall = k.rbox(spec.w * 0.9, spec.h * 0.72, spec.d * 0.9, 0.08, k.mat('knbSiding', 0));
  wall.position.y = spec.h * 0.36;
  const roof = k.rbox(spec.w * 0.98, spec.h * 0.2, spec.d * 0.98, 0.08, k.mat('knbRoof', 0));
  roof.position.y = spec.h * 0.82;
  const door = k.rbox(0.45, 0.8, 0.06, 0.03, k.mat('knbDoor', 0));
  door.position.set(0, 0.4, spec.d * 0.45 + 0.02);
  g.add(wall, roof, door);
  return g;
}

function specBuilder(spec: BuildingSpec): AssetDef['build'] {
  return (k, params) => {
    const id = chooseModel(k, spec.ids, params);
    if (!id) return standIn(k, spec);
    return kenneyBuilding(k, id, spec.look, variant(k, params, spec.look), { scale: spec.scale ?? 1, yaw: spec.yaw ?? 0 });
  };
}

/** res.house → one narrow Kenney house on the 2.5 u lot (A3's `wall` / `roof` params pick siding / roof). */
function resHouse(prev: AssetDef | undefined): AssetDef['build'] {
  return (k, params) => {
    const id = chooseModel(k, RES_HOUSE_IDS, params);
    if (!id) return prev ? prev.build(k, params) : standIn(k, { w: 2.5, d: 2.5, h: 2.4 });
    return kenneyBuilding(k, id, 'house', variant(k, params, 'house'));
  };
}

/** res.townhouses → twin narrow Kenney houses side by side on the 6 u lot, in different colours. */
function resTownhouses(prev: AssetDef | undefined): AssetDef['build'] {
  return (k, params) => {
    const ready = RES_TOWNHOUSE_IDS.filter((id) => kenneyReady(id));
    if (!ready.length) return prev ? prev.build(k, params) : standIn(k, { w: 6, d: 2.5, h: 2.8 });
    const g = new THREE.Group();
    const model = int(params.model);
    const id = model !== undefined && kenneyReady(RES_TOWNHOUSE_IDS[((model % 2) + 2) % 2]!) ? RES_TOWNHOUSE_IDS[((model % 2) + 2) % 2]! : ready[Math.floor(k.rand() * ready.length) % ready.length]!;
    const ids = [id, id];
    const widths = ids.map((id) => kenneyBuildingSize(id)!.x);
    const gap = 0.08;
    let x = -(widths[0]! + widths[1]! + gap) / 2;
    const v0 = variant(k, params, 'house');
    ids.forEach((id, i) => {
      const v = i === 0 ? v0 : { ...v0, wall: (v0.wall + 2) % SIDING, door: (v0.door + 1) % DOOR, roof: (v0.roof + (k.rand() < 0.5 ? 0 : 1)) % ROOF, lit: k.rand() < 0.5 };
      const house = kenneyBuilding(k, id, 'house', v);
      house.position.x = x + widths[i]! / 2;
      x += widths[i]! + gap;
      g.add(house);
    });
    return g;
  };
}

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const spec of BUILDING_SPECS) {
    declareKenney(spec.kind, spec.ids);
    r.register({
      kind: spec.kind, family: KENNEY_FAMILY, footprint: { w: spec.w, d: spec.d }, height: spec.h, build: specBuilder(spec),
      ...(spec.prop ? { instanced: true } : {}),
    });
  }
  // v7 overrides: keep footprint/height/family of the original def; fall back to its builder until preloaded
  const house = r.get('res.house');
  declareKenney('res.house', RES_HOUSE_IDS);
  r.register({ kind: 'res.house', family: house?.family ?? 'residential', footprint: house?.footprint ?? { w: 2.5, d: 2.5 }, height: house?.height ?? 2.4, build: resHouse(house) });
  const rows = r.get('res.townhouses');
  declareKenney('res.townhouses', RES_TOWNHOUSE_IDS);
  r.register({ kind: 'res.townhouses', family: rows?.family ?? 'residential', footprint: rows?.footprint ?? { w: 6, d: 2.5 }, height: rows?.height ?? 2.8, build: resTownhouses(rows) });
}
