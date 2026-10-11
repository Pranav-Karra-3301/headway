// Owner: K1 (vegetation part, this file) / K2 (./kenney-vehicles.ts) / K3 (./kenney-buildings.ts) — see plan v5/v7.
// Registers kn.* kinds and Kenney upgrades of veg.* kinds (createRegistry registers this family last, so these win).
//
// K1 vegetation: every veg.* kind (oak, maple, pine, birch, poplar, cherry, bush, hedge, flowerbed, planter) is built
// from recoloured nature-kit models: per placement one of 2–4 fitting models, scale jitter 0.85–1.2, a random yaw and
// a leaf tone from a hue-jittered role (`knv*`: derived from the palette / A5 roles, so palette switches and the
// autumn palette c follow; birches use Kenney's white-trunk `_fall` models). Trees and bushes keep `sway`.
// Parts draw through `k.mat(role, idx)`, so the composer bakes them like any kit asset (clay shading, recolour).
// Variety contract (as A5): one k.rand() — or params.variant, which picks the model directly — becomes a few
// discrete choices named in root.userData.variant (equal key = identical geometry). Every builder falls back to the
// A5 builder until its models are preloaded (declared with declareKenney → kenneyIdsFor → preloadKenney).
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTES } from '../../palettes';
import { CATALOG_BY_KIND } from '../catalog';
import { declareKenney, KENNEY_ROLES, kenneyReady, kenneyTemplate, type KenneyId } from '../kenney';
import type { KenneyTemplate } from '../kenney/template';
import { fromOklab, hexToRgb, oklab, rgbToHex } from '../kenney/colors';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';
import { buildBush, buildFlowerbed, buildHedge, buildPlanter } from './vegetation/garden';
import { VEG_ROLES } from './vegetation/roles';
import { buildBirch, buildCherry, buildMaple, buildOak, buildPine, buildPoplar } from './vegetation/trees';
import { choices, int, type Rng } from './vegetation/util';
import * as vehicles from './kenney-vehicles'; // K2: kn.car.* + kn.boat.*
import * as buildings from './kenney-buildings'; // K3: kn.house.* + kn.shop.* + kn.works.* + kn.prop.*, res.house/res.townhouses

// ======================================================================= K1 vegetation: roles

/** OKLab hue (radians) / lightness / chroma nudges: base, warmer + lighter, cooler + darker. */
const TONES: readonly (readonly [dh: number, dL: number, dc: number])[] = [[0, 0, 1], [-0.12, 0.03, 1.04], [0.14, -0.03, 0.96]];

/** A colour nudged in OKLab hue (radians), lightness and chroma. */
export function nudgeHex(hex: string, dh: number, dL: number, dc = 1): string {
  const [L, a, b] = oklab(hexToRgb(hex));
  const h = Math.atan2(b, a) + dh, c = Math.hypot(a, b) * dc;
  return rgbToHex(fromOklab([Math.min(0.97, Math.max(0.12, L + dL)), c * Math.cos(h), c * Math.sin(h)]));
}
const spread = (v: string | string[]): string[] => {
  const list = Array.isArray(v) ? v : [v];
  return TONES.flatMap(([dh, dL, dc]) => list.map((c) => nudgeHex(c, dh, dL, dc)));
};
const jitterRole = (src: RoleColors[string]): RoleColors[string] => [spread(src[0]), spread(src[1]), spread(src[2])];
const fromPalette = (role: 'leaf' | 'pine'): RoleColors[string] => [PALETTES.a[role], PALETTES.b[role], PALETTES.c[role]];

/** Hue-jittered leaf roles (3 tones per source colour; palette c stays autumn where A5's roles are). */
export const VEG_KN_ROLES: RoleColors = {
  knvLeaf: jitterRole(fromPalette('leaf')),
  knvPine: jitterRole(fromPalette('pine')),
  knvMaple: jitterRole(VEG_ROLES.vegMaple!),
  knvBirch: jitterRole(VEG_ROLES.vegBirchLeaf!),
  knvPoplar: jitterRole(VEG_ROLES.vegPoplar!),
  knvBlossom: jitterRole(VEG_ROLES.vegBlossom!),
  knvBush: jitterRole(VEG_ROLES.vegBush!),
  knvHedge: jitterRole(VEG_ROLES.vegHedge!),
};
const toneCount = (role: string): number => Math.max(...(VEG_KN_ROLES[role] ?? [[''], [''], ['']]).map((v) => (Array.isArray(v) ? v.length : 1)));

// ======================================================================= K1 vegetation: model prep

const N = (name: string): KenneyId => `nature-kit/${name}`;
/** Nature-kit materials that are foliage (take the kind's leaf role). `_defaultMat` = untextured crown bits. */
const LEAFY = new Set(['leafsGreen', 'leafsDark', 'leafsFall', 'grass', '_defaultMat']);

interface PrepPart { geometry: THREE.BufferGeometry; source: string; role: string; idx: number; leafy: boolean }
interface Bounds { minY: number; maxY: number; cx: number; cz: number; w: number; d: number; radius: number }
interface Prep { parts: PrepPart[]; all: Bounds; crown: Bounds }
const preps = new WeakMap<KenneyTemplate, Prep>();

function bounds(parts: PrepPart[], centred: boolean): Bounds {
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  const cx = centred ? (minX + maxX) / 2 : 0, cz = centred ? (minZ + maxZ) / 2 : 0;
  let r2 = 0;
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) r2 = Math.max(r2, (pos.getX(i) - cx) ** 2 + (pos.getZ(i) - cz) ** 2);
  }
  return { minY, maxY, cx, cz, w: maxX - minX, d: maxZ - minZ, radius: Math.sqrt(r2) };
}

/** Parts + bounds of a loaded model (board units, KENNEY_SCALE baked in), or undefined if not loaded. */
function prep(id: KenneyId): Prep | undefined {
  const t = kenneyTemplate(id);
  if (!t) return undefined;
  let p = preps.get(t);
  if (!p) {
    const parts = t.parts.map((q) => ({ geometry: q.geometry, source: q.info.source, role: q.info.role, idx: q.info.idx, leafy: LEAFY.has(q.info.source) }));
    const leaves = parts.filter((q) => q.leafy);
    p = { parts, all: bounds(parts, false), crown: bounds(leaves.length ? leaves : parts, true) };
    preps.set(t, p);
  }
  return p;
}

/** Pick model `want` (index into ids) if loaded, else another loaded one; undefined when none is loaded. */
function pickModel(ids: readonly KenneyId[], want: number): { id: KenneyId; prep: Prep } | undefined {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[(want + i) % ids.length]!;
    const p = kenneyReady(id) ? prep(id) : undefined;
    if (p) return { id, prep: p };
  }
  return undefined;
}

/** Foliage normals are crease-smoothed (70°): Kenney's faceted crowns read as soft clay, silhouettes unchanged. */
const LEAF_CREASE = (70 * Math.PI) / 180;
const smoothed = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = smoothed.get(g);
  if (!out) {
    const src = g.clone();
    src.deleteAttribute('uv');
    out = mergeVertices(toCreasedNormals(src, LEAF_CREASE));
    src.dispose();
    smoothed.set(g, out);
  }
  return out;
}

/** A mesh of one model part through the kit material of `role`/`idx`. */
function partMesh(k: KitContext, p: PrepPart, role: string, idx: number): THREE.Mesh {
  const m = new THREE.Mesh(p.leafy ? smooth(p.geometry) : p.geometry, k.mat(role, idx));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** The variant's model index: params.variant picks it directly (so the composer's few variants differ), else rand. */
function modelIndex(params: AssetParams, r: Rng, n: number): number {
  const v = params.variant;
  return typeof v === 'number' && Number.isFinite(v) ? ((Math.round(v) % n) + n) % n : int(r, n);
}

function root(kind: string, key: string, body: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.name = kind;
  g.userData.variant = `${kind}#kn.${key}`;
  g.userData.kenney = true;
  g.add(body);
  return g;
}

const SIZE_STEPS = 8; // 0.85, 0.90 … 1.20
const sizeOf = (step: number) => 0.85 + step * 0.05;
const YAW_STEPS = 12;
const footprintOf = (kind: string) => {
  const c = CATALOG_BY_KIND.get(kind);
  return { w: c?.w ?? 1, d: c?.d ?? 1, h: c?.h ?? 1 };
};
/** Largest uniform scale that keeps a radius-`r` model inside the footprint (±10 %) at any yaw. */
const fitScale = (kind: string, r: number) => (0.55 * Math.min(footprintOf(kind).w, footprintOf(kind).d)) / Math.max(1e-3, r);

// ======================================================================= K1 vegetation: trees

interface TreeSpec { kind: string; models: KenneyId[]; leaf: string; fallback: (k: KitContext, p: AssetParams) => THREE.Object3D }

/** Kenney models per tree kind (variant v → models[v % n]); leaves take `leaf`, bark keeps its Kenney role. */
export const KENNEY_TREES: readonly TreeSpec[] = [
  { kind: 'veg.oak', models: [N('tree_oak'), N('tree_default'), N('tree_detailed'), N('tree_plateau')], leaf: 'knvLeaf', fallback: buildOak },
  { kind: 'veg.maple', models: [N('tree_fat'), N('tree_default'), N('tree_thin')], leaf: 'knvMaple', fallback: buildMaple },
  { kind: 'veg.pine', models: [N('tree_pineDefaultA'), N('tree_pineRoundA'), N('tree_pineRoundE'), N('tree_pineTallC_detailed')], leaf: 'knvPine', fallback: buildPine },
  { kind: 'veg.birch', models: [N('tree_simple_fall'), N('tree_thin_fall'), N('tree_small_fall'), N('tree_default_fall')], leaf: 'knvBirch', fallback: buildBirch },
  { kind: 'veg.poplar', models: [N('tree_tall'), N('tree_simple'), N('tree_cone')], leaf: 'knvPoplar', fallback: buildPoplar },
  { kind: 'veg.cherry', models: [N('tree_oak'), N('tree_plateau'), N('tree_detailed'), N('tree_thin')], leaf: 'knvBlossom', fallback: buildCherry },
];

function buildTree(spec: TreeSpec, k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const mi = modelIndex(params, r, spec.models.length);
  const tone = int(r, toneCount(spec.leaf)), size = int(r, SIZE_STEPS), yaw = int(r, YAW_STEPS);
  const pick = pickModel(spec.models, mi);
  if (!pick) return spec.fallback(k, params);
  const { all } = pick.prep;
  const H = footprintOf(spec.kind).h;
  const s = Math.min((sizeOf(size) * H) / (all.maxY - all.minY), fitScale(spec.kind, all.radius));
  const body = new THREE.Group();
  body.rotation.y = (yaw / YAW_STEPS) * Math.PI * 2;
  body.scale.setScalar(s);
  body.position.y = -all.minY * s;
  for (const p of pick.prep.parts) body.add(p.leafy ? partMesh(k, p, spec.leaf, tone) : partMesh(k, p, p.role, p.idx));
  return root(spec.kind, `${pick.id.slice(11)}.${tone}.${size}.${yaw}`, body);
}

// ======================================================================= K1 vegetation: bushes, hedges, beds, planters

/** Crowns reused as low shrubs (leaf parts only, squashed onto the ground). */
const BUSH_CROWNS: KenneyId[] = [N('tree_oak'), N('tree_fat')]; // single rounded crowns (flat-topped ones squash into discs)
/** Planter shrubs: the bush crowns plus Kenney's cube-cluster crown (reads as a little topiary in a pot). */
const PLANTER_CROWNS: KenneyId[] = [N('tree_oak'), N('tree_detailed'), N('tree_fat')];

/** The foliage parts of a model as a group: crown centred on x/z, bottom at y = 0, scaled to (w, h, d). */
function crown(k: KitContext, pr: Prep, role: string, idx: number, w: number, h: number, d: number): THREE.Group {
  const c = pr.crown;
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(-c.cx, -c.minY, -c.cz);
  for (const p of pr.parts) if (p.leafy) inner.add(partMesh(k, p, role, idx));
  g.add(inner);
  g.scale.set(w / Math.max(1e-3, c.w), h / Math.max(1e-3, c.maxY - c.minY), d / Math.max(1e-3, c.d));
  return g;
}

/** Bush: a main crown and 1–2 smaller ones (a low cluster), each squashed onto the ground. */
const BUSH_CLUSTER: readonly (readonly [x: number, z: number, w: number, h: number, yaw: number])[] = [
  [0.07, 0.05, 0.7, 0.7, 0], [-0.25, -0.12, 0.48, 0.48, 2.1], [0.16, -0.3, 0.38, 0.4, 4.2],
];

function kBush(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const mi = modelIndex(params, r, BUSH_CROWNS.length);
  const tone = int(r, toneCount('knvBush')), size = int(r, SIZE_STEPS), yaw = int(r, YAW_STEPS), extra = int(r, 2);
  const pick = pickModel(BUSH_CROWNS, mi);
  if (!pick) return buildBush(k, params);
  const c = pick.prep.crown;
  const j = Math.min(sizeOf(size), 1.1);
  const body = new THREE.Group();
  body.rotation.y = (yaw / YAW_STEPS) * Math.PI * 2;
  const n = 2 + extra, tones = toneCount('knvBush'), base = tone % (tones / 3);
  const aspect = c.d / Math.max(1e-3, c.w);
  // shrink the cluster in x/z (not height) until every crown stays inside the 1 × 1 footprint (±10 %) at any yaw
  let reach = 0;
  for (let i = 0; i < n; i++) {
    const [x, z, w] = BUSH_CLUSTER[i]!;
    reach = Math.max(reach, (c.radius * w * j) / Math.max(1e-3, c.w) + Math.hypot(x, z) * j);
  }
  const f = Math.min(1, (0.55 * 0.98) / Math.max(1e-3, reach));
  for (let i = 0; i < n; i++) {
    const [x, z, w, h, a] = BUSH_CLUSTER[i]!;
    // the crown's other tones of the same base colour: main, warmer, cooler
    const g = crown(k, pick.prep, 'knvBush', (base + i * (tones / 3)) % tones, w * j * f, h * j, w * j * f * aspect);
    g.position.set(x * j * f, 0, z * j * f);
    g.rotation.y = a;
    body.add(g);
  }
  return root('veg.bush', `${pick.id.slice(11)}.${tone}.${size}.${yaw}.${extra}`, body);
}

/** Hedge: a row of overlapping squashed crowns (clipped, slightly lumpy), params.length along x (default 3). */
const HEDGE_CROWNS: KenneyId[] = [N('tree_default'), N('tree_fat')];

function kHedge(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const len = typeof params.length === 'number' && Number.isFinite(params.length) ? Math.max(0.6, Math.min(60, params.length)) : 3;
  const mi = modelIndex(params, r, HEDGE_CROWNS.length);
  const tone = int(r, toneCount('knvHedge')), lump = int(r, 4);
  const pick = pickModel(HEDGE_CROWNS, mi);
  if (!pick) return buildHedge(k, params);
  const n = Math.max(1, Math.round(len / 1.4));
  const seg = len / n, H = 0.74, D = 0.72;
  const body = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const h = H * (1 - 0.06 * ((i * 7 + lump * 3) % 4) / 3);
    const c = crown(k, pick.prep, 'knvHedge', tone, Math.min(len, seg * 1.45), h, D);
    c.position.x = n === 1 ? 0 : -len / 2 + c.scale.x * pick.prep.crown.w / 2 + (i * (len - c.scale.x * pick.prep.crown.w)) / (n - 1);
    if ((i + lump) % 2) c.rotation.y = Math.PI;
    body.add(c);
  }
  return root('veg.hedge', `${pick.id.slice(11)}.${tone}.${lump}.L${len.toFixed(2)}`, body);
}

/** Flowerbed: oval stone edging + soil (as A5's), a staggered row of 6 Kenney flowers in a 2–3 colour scheme. */
const FLOWERS: KenneyId[] = [N('flower_redA'), N('flower_yellowA'), N('flower_purpleA'), N('flower_redC'), N('flower_yellowC'), N('flower_purpleC')];
/** vegFlower colour schemes (indices into A5's 5 flower colours). */
const SCHEMES: readonly (readonly number[])[] = [[0, 1], [3, 2], [4, 1], [0, 2, 3], [1, 4]];
const BED_SPOTS: readonly (readonly [number, number])[] = [[-0.58, 0.06], [-0.3, -0.18], [-0.05, 0.16], [0.22, -0.16], [0.48, 0.14], [0.66, -0.06]];

function flower(k: KitContext, pr: Prep, colour: number, scale: number): THREE.Group {
  const g = new THREE.Group();
  for (const p of pr.parts) {
    const m = p.source === 'grass' ? partMesh(k, p, 'vegBed', colour % 3)
      : p.source === 'colorWhite' ? partMesh(k, p, 'vegFlower', 2)
      : partMesh(k, p, 'vegFlower', colour);
    g.add(m);
  }
  g.scale.setScalar(scale);
  g.position.y = -pr.all.minY * scale;
  return g;
}

function kFlowerbed(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const scheme = modelIndex(params, r, SCHEMES.length), shape = int(r, 2), yaw = int(r, 4);
  const ids = FLOWERS.slice(shape * 3, shape * 3 + 3);
  if (!ids.every(kenneyReady)) return buildFlowerbed(k, params);
  const body = new THREE.Group();
  const edge = k.cyl(1, 1, 0.14, k.mat('vegEdge'), 16);
  edge.position.y = 0.07;
  edge.scale.set(0.98, 1, 0.48);
  const soil = k.cyl(1, 1, 0.04, k.mat('vegSoil'), 16);
  soil.position.y = 0.13;
  soil.scale.set(0.9, 1, 0.41);
  body.add(edge, soil);
  const cols = SCHEMES[scheme]!;
  BED_SPOTS.forEach(([x, z], i) => {
    const pr = prep(ids[(i + yaw) % ids.length]!)!;
    const f = flower(k, pr, cols[i % cols.length]!, Math.min(0.85, 0.3 / (pr.all.maxY - pr.all.minY)));
    f.position.set(x, 0.15 + f.position.y, z);
    f.rotation.y = ((i * 5 + yaw) % 8) * (Math.PI / 4);
    body.add(k.detail(f));
  });
  return root('veg.flowerbed', `${scheme}.${shape}.${yaw}`, body);
}

/** Planter: Kenney wooden box (pot_large) or round pot (pot_small) in an A5 pot colour, with a crown shrub or flowers. */
const POTS: KenneyId[] = [N('pot_large'), N('pot_small')];

function kPlanter(k: KitContext, params: AssetParams): THREE.Object3D {
  const r = choices(k, params);
  const pot = modelIndex(params, r, POTS.length), colour = int(r, 4), tone = int(r, toneCount('knvBush')), shrub = int(r, 3), yaw = int(r, 4);
  const potPick = pickModel(POTS, pot);
  const shrubPick = pickModel(PLANTER_CROWNS, shrub);
  if (!potPick || !shrubPick || potPick.id !== POTS[pot]) return buildPlanter(k, params);
  const pp = potPick.prep.all;
  // box planter ≈ 0.9 u wide, round pot ≈ 0.7 u wide
  const potScale = Math.min((pot === 0 ? 0.9 : 0.7) / Math.max(1e-3, pp.w, pp.d), fitScale('veg.planter', pp.radius));
  const body = new THREE.Group();
  body.rotation.y = (yaw / 4) * Math.PI * 2;
  const pg = new THREE.Group();
  for (const p of potPick.prep.parts) {
    const isSoil = p.source === 'woodBarkDark' || p.source === '_defaultMat';
    pg.add(isSoil ? partMesh(k, p, 'vegSoil', 0) : partMesh(k, p, 'vegPot', colour));
  }
  pg.scale.setScalar(potScale);
  pg.position.y = -pp.minY * potScale;
  body.add(pg);
  const rim = (pp.maxY - pp.minY) * potScale;
  const w = pot === 0 ? 0.62 : 0.56;
  const sh = crown(k, shrubPick.prep, 'knvBush', tone, w, 0.5, w);
  sh.position.y = rim - 0.06;
  body.add(sh);
  return root('veg.planter', `${pot}.${colour}.${shrubPick.id.slice(11)}.${tone}.${yaw}`, body);
}

// ======================================================================= K1 vegetation: registration

type Builder = (k: KitContext, params: AssetParams) => THREE.Object3D;
const GARDEN: Record<string, { build: Builder; sway: boolean; ids: KenneyId[] }> = {
  'veg.bush': { build: kBush, sway: true, ids: BUSH_CROWNS },
  'veg.hedge': { build: kHedge, sway: false, ids: HEDGE_CROWNS },
  'veg.flowerbed': { build: kFlowerbed, sway: false, ids: FLOWERS },
  'veg.planter': { build: kPlanter, sway: false, ids: [...POTS, ...PLANTER_CROWNS] },
};

/** Every veg.* kind this family upgrades, with the Kenney models it needs. */
export const KENNEY_VEG_KINDS: Readonly<Record<string, readonly KenneyId[]>> = {
  ...Object.fromEntries(KENNEY_TREES.map((t) => [t.kind, t.models])),
  ...Object.fromEntries(Object.entries(GARDEN).map(([kind, g]) => [kind, g.ids])),
};

export function registerKenneyVegetation(r: AssetRegistry): void {
  r.addRoles({ ...KENNEY_ROLES, ...VEG_ROLES, ...VEG_KN_ROLES });
  const add = (kind: string, build: Builder, sway: boolean, ids: readonly KenneyId[]) => {
    const c = CATALOG_BY_KIND.get(kind);
    if (!c) return;
    const def: AssetDef = { kind, family: 'vegetation', footprint: { w: c.w, d: c.d }, height: c.h, build, instanced: true };
    if (sway) def.sway = true;
    r.register(def);
    declareKenney(kind, ids);
  };
  for (const t of KENNEY_TREES) add(t.kind, (k, p) => buildTree(t, k, p), true, t.models);
  for (const [kind, g] of Object.entries(GARDEN)) add(kind, g.build, g.sway, g.ids);
}

// ======================================================================= family entry (K2/K3 add theirs here)

export const ROLES: RoleColors = { ...KENNEY_ROLES, ...VEG_KN_ROLES };

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  registerKenneyVegetation(r);
  vehicles.register(r); // K2
  buildings.register(r); // K3
}
