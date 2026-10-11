// Owner: K0. Kenney CC0 kits (apps/web/public/models/kenney/<kit>/<name>.glb): preload, recolour to our palette roles,
// clay-shade, scale to board units. Builders stay synchronous: call preloadKenney() before building the town.
//
// Pipeline: GLTFLoader → `buildTemplate` (./template) splits each model into a few flat-coloured parts — nature kit by
// material name (`NATURE_REMAP`), colormap kits by Kenney colour block (`SWATCH_ROLE`) — with the kit scale and node
// transforms baked in. `kenneyModel` returns a Group of Meshes sharing the template geometry and one shared clay
// material per (role, variant, shade) — the same MeshStandardMaterial + `applyClay` look as the rest of the town.
//
// Frames (as authored by Kenney, kept): y up, ground at y = 0 (nature models sit ~0.1 u into the ground), centred on
// the origin; buildings face +z (our convention); vehicles and boats face +z — rotate by +π/2 about y to face +x like
// the kit bus/cars.
//
// Downstream:
//  - families declare which models a kind needs: `declareKenney(kind, ids)`; pages/the composer then
//    `await preloadKenney(kenneyIdsFor(kinds))`. Builders check `kenneyReady(id)` and fall back to the old builder.
//  - per-placement colour variety: `recolorKenney(obj, (part) => part.role === 'leaf' ? { role: 'leaf', idx: 2 } : null)`;
//    car/boat paint: `part.paint` (or set mesh.userData.tint = true for instanceColor after bakeGeometry).
//  - palette: `setKenneyPalette(p)` recolours every live Kenney material in place (models built without opts.palette).
//  - kit materials instead: `kenneyUseKit(obj, k)` swaps parts to `k.mat(role, idx)` (register KENNEY_ROLES first).
//  - bakeGeometry works too: palette-role parts carry material.userData.role/idx, kn* parts bake their colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyClay } from '../../materials';
import type { PaletteId } from '../../types';
import { BUILDING_UP_ROLE, isPaletteRole, kenneyColor, modelRoleMap, shadeHex } from './colors';
import { buildTemplate, type ColormapPixels, type KenneyPartInfo, type KenneyTemplate } from './template';

export type KenneyKit =
  | 'nature-kit' | 'car-kit' | 'watercraft-pack' | 'city-kit-suburban' | 'city-kit-commercial'
  | 'city-kit-industrial' | 'city-kit-roads' | 'train-kit' | 'survival-kit';
/** e.g. 'nature-kit/tree_oak' */
export type KenneyId = `${KenneyKit}/${string}`;

/**
 * Kit units → board units (person ≈ 0.8 u, door ≈ 1 u, bus 3.3 u long, car ≈ 1.7 u, trees 2.2–3.2 u tall).
 * Measured from manifest.json (see kenney.test.ts):
 *  nature   1.9  — broadleaf trees 1.11–1.71 → 2.1–3.25 u, bushDetailed 0.36 → 0.7 u, fence 0.35 → 0.67 u
 *  car      0.65 — sedan 2.55 → 1.66 u long (kit hatchback 1.72), van 2.75 → 1.79 u
 *  boats    0.65 — same toy scale as the cars: speedboat 3.37 → 2.2 u, rowboat 2.37 → 1.5 u
 *  city-*   2.6  — suburban door 0.27 → 0.7 u, storey ≈ 0.42 → 1.1 u, street light 0.6 → 1.56 u, road tile 2.6 u
 *  train    1.13 — carriage width 1.2 → 1.36 u (our train)
 *  survival 1.25 — barrel 0.34 → 0.43 u, fence 0.52 → 0.65 u, tent 0.49 → 0.61 u
 */
export const KENNEY_SCALE: Record<KenneyKit, number> = {
  'nature-kit': 1.9, 'car-kit': 0.65, 'watercraft-pack': 0.65, 'city-kit-suburban': 2.6, 'city-kit-commercial': 2.6,
  'city-kit-industrial': 2.6, 'city-kit-roads': 2.6, 'train-kit': 1.13, 'survival-kit': 1.25,
};
export const KENNEY_KITS = Object.keys(KENNEY_SCALE) as KenneyKit[];

/** Everyday town traffic, most common first (all ≈ 1.6–2.1 u long, facing +z). */
export const KENNEY_CARS: KenneyId[] = [
  'car-kit/sedan', 'car-kit/hatchback-sports', 'car-kit/suv', 'car-kit/van', 'car-kit/taxi',
  'car-kit/truck', 'car-kit/sedan-sports', 'car-kit/suv-luxury', 'car-kit/delivery',
];
/** Occasional service vehicles (use sparingly). */
export const KENNEY_SERVICE: KenneyId[] = ['car-kit/police', 'car-kit/ambulance', 'car-kit/garbage-truck', 'car-kit/firetruck', 'car-kit/truck-flat'];
/** Small-town marina boats (≈ 1.5–3 u long, facing +z). */
export const KENNEY_BOATS: KenneyId[] = [
  'watercraft-pack/boat-sail-a', 'watercraft-pack/boat-sail-b', 'watercraft-pack/boat-speed-a', 'watercraft-pack/boat-speed-c',
  'watercraft-pack/boat-speed-e', 'watercraft-pack/boat-fishing-small', 'watercraft-pack/boat-row-small',
  'watercraft-pack/boat-row-large', 'watercraft-pack/boat-tug-b', 'watercraft-pack/boat-house-a',
];

export type { KenneyPartInfo } from './template';
export { KENNEY_ROLES, NATURE_REMAP, SWATCH_ROLE, kenneyColor, modelRoleMap, roleVariants } from './colors';

// ---------- loading ----------
const BASE = `${import.meta.env?.BASE_URL ?? '/'}models/kenney/`;
const templates = new Map<KenneyId, KenneyTemplate>();
const pending = new Map<KenneyId, Promise<void>>();
const colormaps = new Map<KenneyKit, Promise<ColormapPixels>>();
let loader: GLTFLoader | null = null;

export function kenneyKitOf(id: KenneyId): KenneyKit { return id.slice(0, id.indexOf('/')) as KenneyKit; }
export function kenneyUrl(id: KenneyId): string { return `${BASE}${id}.glb`; }

function loadColormap(kit: KenneyKit): Promise<ColormapPixels> {
  let p = colormaps.get(kit);
  if (!p) {
    p = (async () => {
      const res = await fetch(`${BASE}${kit}/Textures/colormap.png`);
      if (!res.ok) throw new Error(`colormap ${kit}: HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bmp.width, bmp.height)
        : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      bmp.close();
      return { width: img.width, height: img.height, data: img.data };
    })();
    colormaps.set(kit, p);
  }
  return p;
}

function disposeGltf(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

function loadOne(id: KenneyId): Promise<void> {
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      try {
        const kit = kenneyKitOf(id);
        if (!(kit in KENNEY_SCALE)) throw new Error(`unknown kit "${kit}"`);
        loader ??= new GLTFLoader();
        const [gltf, cm] = await Promise.all([loader.loadAsync(kenneyUrl(id)), kit === 'nature-kit' ? null : loadColormap(kit)]);
        const building = kit === 'city-kit-suburban' || kit === 'city-kit-commercial' || kit === 'city-kit-industrial';
        templates.set(id, buildTemplate(id, gltf.scene, KENNEY_SCALE[kit], cm, {
          paint: kit === 'car-kit' || kit === 'watercraft-pack', splitUp: building, upRole: building ? BUILDING_UP_ROLE : undefined,
          roleMap: modelRoleMap(id),
        }));
        disposeGltf(gltf.scene);
      } catch (err) {
        console.warn(`[kenney] could not load ${id}:`, err);
      }
    })();
    pending.set(id, p);
  }
  return p;
}

/** Load models once (cached); resolves when all are ready. Safe to call repeatedly and concurrently.
 *  Never rejects: a model that fails to load stays not-ready (builders fall back) and logs a warning. */
export function preloadKenney(ids: KenneyId[]): Promise<void> {
  return Promise.all([...new Set(ids)].map(loadOne)).then(() => undefined);
}
export function kenneyReady(id: KenneyId): boolean {
  return templates.has(id);
}
/** Loaded template (parts, size in board units, triangle count), or undefined. */
export function kenneyTemplate(id: KenneyId): KenneyTemplate | undefined {
  return templates.get(id);
}
/** Install a template directly (tests, tools, procedurally built templates). */
export function _setKenneyTemplate(id: KenneyId, t: KenneyTemplate): void {
  templates.set(id, t);
  pending.set(id, Promise.resolve());
}

// ---------- which models each asset kind needs ----------
const needs = new Map<string, Set<KenneyId>>();
/** Families call this (at registration) for every kind whose builder uses Kenney models. */
export function declareKenney(kind: string, ids: readonly KenneyId[]): void {
  let s = needs.get(kind);
  if (!s) { s = new Set(); needs.set(kind, s); }
  for (const id of ids) s.add(id);
}
/** Every Kenney model the given kinds need (for preloadKenney before building). */
export function kenneyIdsFor(kinds: Iterable<string>): KenneyId[] {
  const out = new Set<KenneyId>();
  for (const k of kinds) for (const id of needs.get(k) ?? []) out.add(id);
  return [...out];
}

// ---------- materials ----------
interface LiveMat { m: THREE.MeshStandardMaterial; role: string; idx: number; shade: number }
let current: PaletteId = 'a';
const live = new Map<string, LiveMat>();
const fixed = new Map<string, THREE.MeshStandardMaterial>();

function clayMat(color: string, side: THREE.Side, name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side });
  m.name = name;
  return applyClay(m);
}

/** Shared clay material for a role variant with a lightness shade. Without opts.palette it follows setKenneyPalette. */
export function kenneyMaterial(role: string, idx = 0, shade = 0, opts: { palette?: PaletteId; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  const side = opts.side ?? THREE.FrontSide;
  const key = `${opts.palette ?? '*'}|${role}#${idx}|${shade}|${side}`;
  let m = opts.palette ? fixed.get(key) : live.get(key)?.m;
  if (!m) {
    m = clayMat(shadeHex(kenneyColor(role, idx, opts.palette ?? current), shade), side, `kenney:${role}#${idx}`);
    if (isPaletteRole(role)) { m.userData.role = role; m.userData.idx = idx; }
    if (opts.palette) fixed.set(key, m); else live.set(key, { m, role, idx, shade });
  }
  return m;
}
/** Shared clay material of a literal colour (no palette following). */
export function kenneyHexMaterial(hex: string, shade = 0, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const key = `${hex.toLowerCase()}|${shade}|${side}`;
  let m = fixed.get(key);
  if (!m) { m = clayMat(shadeHex(hex, shade), side, `kenney:${hex}`); fixed.set(key, m); }
  return m;
}

/** Palette for models built without opts.palette; recolours their (shared) materials in place. */
export function setKenneyPalette(p: PaletteId): void {
  current = p;
  for (const l of live.values()) l.m.color.set(shadeHex(kenneyColor(l.role, l.idx, p), l.shade));
}
export function kenneyPalette(): PaletteId { return current; }

// ---------- models ----------
/** Recoloured, clay-shaded clone (geometry and materials shared). Throws if the model was not preloaded.
 *  opts.scale multiplies KENNEY_SCALE (already baked into the geometry); opts.palette pins the colours. */
export function kenneyModel(id: KenneyId, opts: { scale?: number; palette?: PaletteId } = {}): THREE.Object3D {
  const t = templates.get(id);
  if (!t) throw new Error(`kenney model not loaded: ${id} ${JSON.stringify(opts)}`);
  const g = new THREE.Group();
  g.name = `kenney:${id}`;
  for (const p of t.parts) {
    const mesh = new THREE.Mesh(p.geometry, kenneyMaterial(p.info.role, p.info.idx, p.info.shade, { palette: opts.palette, side: p.info.side }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kenney = p.info;
    g.add(mesh);
  }
  if (opts.scale !== undefined && opts.scale !== 1) g.scale.setScalar(opts.scale);
  g.userData.kenneyId = id;
  return g;
}

/** A recolour decision for one part: a role variant (keeps the part's Kenney shade unless `shade` is given),
 *  a literal hex colour (used exactly), or null/undefined to keep the part as it is. */
export type KenneyRecolor = (part: Readonly<KenneyPartInfo>) => { role: string; idx?: number; shade?: number } | string | null | undefined;

/** Recolour parts of a kenneyModel (e.g. leaf variant per tree, car paint, house roof/walls). Returns obj. */
export function recolorKenney(obj: THREE.Object3D, fn: KenneyRecolor, opts: { palette?: PaletteId } = {}): THREE.Object3D {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const info = mesh.userData?.kenney as KenneyPartInfo | undefined;
    if (!mesh.isMesh || !info) return;
    const r = fn(info);
    if (!r) return;
    if (typeof r === 'string') {
      mesh.material = kenneyHexMaterial(r, 0, info.side);
      mesh.userData.kenney = { ...info, hex: r };
    } else {
      const idx = r.idx ?? 0, shade = r.shade ?? info.shade;
      mesh.material = kenneyMaterial(r.role, idx, shade, { palette: opts.palette, side: info.side });
      mesh.userData.kenney = { ...info, role: r.role, idx, shade, hex: undefined };
    }
  });
  return obj;
}

/** Swap every part to the KitContext material of its role (`k.mat(role, idx)`), e.g. for a composer that colours by
 *  role. kn* roles must be known to the kit: register KENNEY_ROLES (r.addRoles) in the family. Returns obj. */
export function kenneyUseKit(obj: THREE.Object3D, k: { mat(role: string, idx?: number): THREE.Material }): THREE.Object3D {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const info = mesh.userData?.kenney as KenneyPartInfo | undefined;
    if (mesh.isMesh && info && !info.hex) mesh.material = k.mat(info.role, info.idx);
  });
  return obj;
}
