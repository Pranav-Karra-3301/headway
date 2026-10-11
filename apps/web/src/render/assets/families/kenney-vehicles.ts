// Owner: K2 (plan v5 + v7). Kenney car-kit + watercraft-pack models as placeable kinds (catalog entries in catalog.ts):
//   kn.car.*   parked / standing cars, trucks and service vehicles. Front faces +z (length along z), wheels on y = 0.
//   kn.boat.*  moored boats, a buoy and a cargo ship. Bow faces +z. Origin = the WATERLINE (hulls sink below y = 0):
//              place them at the water level (e.g. world/water WATER_LEVEL).
// Everyday cars and marina boats get a per-placement paint from the palette `car` role (harmonised with the kit cars,
// follows palette switches, bakes through bakeGeometry); taxis, service vehicles, the tractor and wooden rowing boats
// keep their colours. Car windows (Kenney's white glass) take the palette `glass` role like our bus and kit cars; the
// cargo ship's loud containers are toned to palette paints.
// params:
//   model: number  pick the model of a mixed kind (kn.car.random, kn.boat.random) instead of k.rand()
//   paint: number  palette `car` colour index; -1 keeps the pipeline colour
// Builders are synchronous: `await preloadKenney(kenneyIdsFor(kinds))` first. Until a model is loaded the builder
// returns a small toy stand-in built from KitContext primitives (same footprint).
// Train (v7 evaluation): KENNEY_TRAIN stays null. See the comment on it for the reasoning.
import * as THREE from 'three';
import { declareKenney, kenneyModel, kenneyReady, recolorKenney, type KenneyId } from '../kenney';
import type { AssetRegistry } from '../registry';
import type { AssetDef, AssetParams, KitContext, RoleColors } from '../types';

export const ROLES: RoleColors = {};

/** Number of palette `car` colours (6 in every palette). */
export const CAR_PAINTS = 6;

export interface VehicleSpec {
  kind: string;
  /** Candidate models; mixed kinds pick one per placement (weights, else uniform). */
  ids: readonly KenneyId[];
  weights?: readonly number[];
  /** Catalog footprint (x by z) and height, board units (KENNEY_SCALE baked into the models). */
  w: number; d: number; h: number;
  /** Recolour the paint part to the palette `car` role. */
  paint: boolean;
  /** Extra part roles that take the paint too (e.g. the delivery truck's green box). */
  paintRoles?: readonly string[];
  /** Fixed per-role recolours (role → [palette role, idx]), applied before paint. */
  recolor?: Readonly<Record<string, readonly [string, number]>>;
  /** Boats: how deep the keel sits below the waterline (u), per model or one value. */
  sink?: number | readonly number[];
  boat?: boolean;
  note: string;
}

const car = (kind: string, ids: KenneyId[], w: number, d: number, h: number, paint: boolean, note: string, extra: Partial<VehicleSpec> = {}): VehicleSpec =>
  ({ kind, ids, w, d, h, paint, note, ...extra });
const boat = (kind: string, ids: KenneyId[], w: number, d: number, h: number, sink: number | number[], paint: boolean, note: string, extra: Partial<VehicleSpec> = {}): VehicleSpec =>
  ({ kind, ids, w, d, h, sink, paint, boat: true, note, ...extra });

/** Models that never take a paint even inside a painted kind (wooden rowing boats stay wood). */
export const NO_PAINT: ReadonlySet<KenneyId> = new Set(['watercraft-pack/boat-row-small', 'watercraft-pack/boat-row-large']);
/** car-kit glass: Kenney's white windows (the lighter of the two white blocks) → our vehicle glass. */
const isCarGlass = (role: string, shade: number) => role === 'knWhite' && Math.abs(shade + 0.03) < 1e-6;

/** Everyday parked cars (kn.car.random) with relative frequency. */
const EVERYDAY: KenneyId[] = [
  'car-kit/sedan', 'car-kit/suv', 'car-kit/hatchback-sports', 'car-kit/van', 'car-kit/sedan-sports', 'car-kit/suv-luxury', 'car-kit/truck', 'car-kit/taxi',
];
const EVERYDAY_W = [3, 3, 2, 2, 1, 1, 1.5, 0.5];
/** Small-marina boats (kn.boat.random). */
const MARINA: KenneyId[] = [
  'watercraft-pack/boat-speed-a', 'watercraft-pack/boat-sail-a', 'watercraft-pack/boat-speed-c', 'watercraft-pack/boat-fishing-small',
  'watercraft-pack/boat-row-small', 'watercraft-pack/boat-sail-b', 'watercraft-pack/boat-speed-e',
];
const MARINA_SINK = [0.17, 0.2, 0.17, 0.2, 0.08, 0.2, 0.17];
const MARINA_W = [2, 2, 1.5, 1.5, 1.5, 1, 1];

/** Every K2 kind. Sizes = manifest size × KENNEY_SCALE (0.65), rounded up (kenney-vehicles test checks them). */
export const VEHICLE_SPECS: readonly VehicleSpec[] = [
  car('kn.car.sedan', ['car-kit/sedan'], 1.0, 1.7, 0.95, true, 'Kenney sedan, palette paint'),
  car('kn.car.hatchback', ['car-kit/hatchback-sports'], 0.9, 1.9, 0.8, true, 'Kenney hatchback, palette paint'),
  car('kn.car.sports', ['car-kit/sedan-sports'], 0.9, 1.7, 0.8, true, 'Kenney sports coupe, palette paint'),
  car('kn.car.suv', ['car-kit/suv'], 1.0, 1.7, 0.9, true, 'Kenney SUV, palette paint'),
  car('kn.car.suvLuxury', ['car-kit/suv-luxury'], 1.0, 1.9, 0.95, true, 'Kenney large SUV, palette paint'),
  car('kn.car.van', ['car-kit/van'], 1.0, 1.8, 0.95, true, 'Kenney minivan, palette paint'),
  car('kn.car.pickup', ['car-kit/truck'], 1.0, 1.95, 0.95, true, 'Kenney pickup truck, palette paint'),
  car('kn.car.flatbed', ['car-kit/truck-flat'], 1.0, 1.8, 0.95, true, 'Kenney flatbed truck, palette paint'),
  car('kn.car.taxi', ['car-kit/taxi'], 1.0, 1.8, 1.05, false, 'Kenney taxi (keeps yellow)'),
  car('kn.car.delivery', ['car-kit/delivery'], 1.0, 2.15, 1.65, true, 'Kenney box delivery truck, palette paint', { paintRoles: ['knGreen'] }),
  car('kn.car.police', ['car-kit/police'], 1.0, 1.9, 0.9, false, 'Kenney police car'),
  car('kn.car.ambulance', ['car-kit/ambulance'], 1.0, 2.15, 1.25, false, 'Kenney ambulance'),
  car('kn.car.firetruck', ['car-kit/firetruck'], 1.0, 2.15, 1.2, false, 'Kenney fire truck'),
  car('kn.car.garbage', ['car-kit/garbage-truck'], 1.05, 2.25, 1.15, false, 'Kenney garbage truck'),
  car('kn.car.tractor', ['car-kit/tractor'], 0.9, 1.3, 1.25, false, 'Kenney farm tractor (outskirts fields)'),
  car('kn.car.random', EVERYDAY, 1.0, 1.95, 1.05, true, 'random everyday car per placement (parking lots, driveways)', { weights: EVERYDAY_W }),
  boat('kn.boat.sail', ['watercraft-pack/boat-sail-a'], 1.2, 2.5, 2.55, 0.2, true, 'sailboat, tall mast (moored: place at water level)'),
  boat('kn.boat.sailLarge', ['watercraft-pack/boat-sail-b'], 1.2, 2.65, 2.1, 0.2, true, 'longer sailboat with cabin'),
  boat('kn.boat.speed', ['watercraft-pack/boat-speed-a'], 1.2, 2.2, 1.0, 0.17, true, 'speedboat with windscreen'),
  boat('kn.boat.runabout', ['watercraft-pack/boat-speed-c'], 1.2, 2.1, 0.85, 0.17, true, 'small open runabout'),
  boat('kn.boat.fishing', ['watercraft-pack/boat-fishing-small'], 1.2, 2.55, 1.7, 0.2, true, 'small fishing boat with wheelhouse'),
  boat('kn.boat.row', ['watercraft-pack/boat-row-small'], 1.8, 1.55, 0.55, 0.08, false, 'wooden rowing boat with oars'),
  boat('kn.boat.rowLarge', ['watercraft-pack/boat-row-large'], 1.8, 1.9, 0.55, 0.08, false, 'larger wooden rowing boat with oars'),
  boat('kn.boat.tug', ['watercraft-pack/boat-tug-b'], 1.2, 1.9, 1.5, 0.2, false, 'harbour tug'),
  boat('kn.boat.house', ['watercraft-pack/boat-house-a'], 1.75, 3.05, 1.45, 0.18, false, 'house boat'),
  boat('kn.boat.buoy', ['watercraft-pack/buoy'], 0.6, 0.6, 1.2, 0.25, false, 'channel buoy'),
  boat('kn.boat.cargoShip', ['watercraft-pack/ship-cargo-a'], 2.55, 6.9, 2.2, 0.35, false, 'coastal cargo ship (far out in the bay)', {
    recolor: { knYellow: ['car', 1], knRed: ['car', 0], knGreen: ['car', 3], knBlue: ['car', 2] },
  }),
  boat('kn.boat.random', MARINA, 1.8, 2.65, 2.55, MARINA_SINK, true, 'random marina boat per placement (moorings)', { weights: MARINA_W }),
];
export const VEHICLE_KINDS: readonly string[] = VEHICLE_SPECS.map((s) => s.kind);
const SPEC_BY_KIND = new Map(VEHICLE_SPECS.map((s) => [s.kind, s] as const));
export function vehicleSpec(kind: string): VehicleSpec | undefined { return SPEC_BY_KIND.get(kind); }

/**
 * v7 train evaluation: `train-kit` passenger sets (electric-city / subway / tram, locomotive-passenger) are short, tall
 * toy cars (≈ 2.7 u long × 2.3 u tall at our 1.36 u train width) against our 4.2 × 1.62 u cars, the platforms and the
 * station canopies built around them; stretching them distorts their windows and doors. Our approved train stays.
 */
export const KENNEY_TRAIN: { front: KenneyId; rear: KenneyId } | null = null;

const mod = (i: number, n: number) => ((Math.floor(i) % n) + n) % n;

function pickIndex(spec: VehicleSpec, roll: number): number {
  const n = spec.ids.length;
  if (n === 1) return 0;
  const w = spec.weights ?? spec.ids.map(() => 1);
  const total = w.reduce((s, x) => s + x, 0);
  let t = roll * total;
  for (let i = 0; i < n; i++) { t -= w[i]!; if (t < 0) return i; }
  return n - 1;
}

/** Which model + paint a placement gets (k.rand() is consumed in a fixed order: model, then paint). */
export function vehicleChoice(spec: VehicleSpec, k: Pick<KitContext, 'rand'>, params: AssetParams = {}): { id: KenneyId; index: number; paint: number } {
  const modelRoll = k.rand();
  const paintRoll = k.rand();
  const index = typeof params.model === 'number' ? mod(params.model, spec.ids.length) : pickIndex(spec, modelRoll);
  const paint = !spec.paint || NO_PAINT.has(spec.ids[index]!) ? -1 : typeof params.paint === 'number' ? (params.paint < 0 ? -1 : mod(params.paint, CAR_PAINTS)) : Math.min(CAR_PAINTS - 1, Math.floor(paintRoll * CAR_PAINTS));
  return { id: spec.ids[index]!, index, paint };
}

function sinkOf(spec: VehicleSpec, index: number): number {
  const s = spec.sink;
  if (s === undefined) return 0;
  return typeof s === 'number' ? s : (s[index] ?? 0);
}

function buildVehicle(spec: VehicleSpec, k: KitContext, params: AssetParams): THREE.Object3D {
  const { id, index, paint } = vehicleChoice(spec, k, params);
  const sink = sinkOf(spec, index);
  const g = new THREE.Group();
  g.name = spec.kind;
  if (!kenneyReady(id)) {
    const toy = spec.boat ? toyBoat(k, spec, paint) : toyCar(k, spec, paint);
    toy.position.y = -sink;
    g.add(toy);
    g.userData.variant = `toy:${spec.kind}#${paint}`;
    g.userData.fallback = true;
    return g;
  }
  const m = kenneyModel(id);
  const fixed = spec.recolor, extra = spec.paintRoles, glass = !spec.boat;
  recolorKenney(m, (p) => {
    if (paint >= 0 && (p.paint || extra?.includes(p.role))) return { role: 'car', idx: paint, shade: 0 };
    if (glass && isCarGlass(p.role, p.shade)) return { role: 'glass', idx: 0, shade: 0 };
    const f = fixed?.[p.role];
    return f ? { role: f[0], idx: f[1], shade: 0 } : null;
  });
  m.position.y = -sink;
  g.add(m);
  g.userData.variant = `${id}#${paint}`;
  g.userData.kenneyId = id;
  return g;
}

// ---------- toy stand-ins (until the Kenney model is loaded) ----------
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }

function toyCar(k: KitContext, s: VehicleSpec, paint: number): THREE.Group {
  const g = new THREE.Group();
  const body = k.mat('car', Math.max(0, paint));
  const tall = s.h > 1.1; // vans/trucks: one tall box
  const r = 0.13, w = s.w * 0.86, d = s.d * 0.96;
  const bodyH = tall ? s.h - r - 0.08 : s.h * 0.42;
  g.add(at(k.rbox(w, bodyH, d, 0.1, body), 0, r + 0.04 + bodyH / 2, 0));
  if (!tall) {
    const cabH = s.h - (r + 0.04 + bodyH) - 0.02;
    g.add(at(k.rbox(w * 0.88, cabH, d * 0.52, 0.08, k.mat('glass')), 0, r + 0.04 + bodyH + cabH / 2, -d * 0.06));
    g.add(at(k.rbox(w * 0.9, 0.06, d * 0.5, 0.03, body), 0, s.h - 0.03, -d * 0.06));
  } else {
    g.add(at(k.rbox(w * 1.01, 0.26, d * 0.2, 0.05, k.mat('glass')), 0, s.h * 0.68, d * 0.38));
  }
  const tire = k.mat('dark');
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const wh = k.cyl(r, r, 0.12, tire, 12);
    wh.rotation.z = Math.PI / 2;
    g.add(at(wh, x * (s.w / 2 - 0.08), r, z * d * 0.32));
  }
  return g;
}

function toyBoat(k: KitContext, s: VehicleSpec, paint: number): THREE.Group {
  const g = new THREE.Group();
  if (s.kind === 'kn.boat.buoy') {
    g.add(at(k.cyl(0.26, 0.3, 0.5, k.mat('car', 0), 12), 0, 0.25, 0));
    g.add(at(k.cone(0.16, 0.6, k.mat('car', 0), 10), 0, 0.8, 0));
    return g;
  }
  const w = Math.min(s.w, s.d * 0.48) * 0.9, d = s.d * 0.95;
  const hullH = Math.min(0.42, s.h * 0.8);
  g.add(at(k.rbox(w, hullH, d, Math.min(0.14, hullH / 2.2), k.mat('trim')), 0, hullH / 2, 0));
  g.add(at(k.rbox(w + 0.02, 0.08, d + 0.02, 0.03, k.mat('car', Math.max(0, paint))), 0, hullH * 0.62, 0));
  if (s.h > 0.8 && s.h < 2.3) {
    const cab = Math.min(s.h - hullH, 0.9);
    g.add(at(k.rbox(w * 0.7, cab, d * 0.36, 0.06, k.mat('wall')), 0, hullH + cab / 2, -d * 0.05));
    g.add(at(k.rbox(w * 0.72, cab * 0.35, d * 0.3, 0.04, k.mat('glass')), 0, hullH + cab * 0.66, -d * 0.04));
  }
  if (s.h >= 2.3) {
    const mast = s.h - hullH;
    g.add(at(k.cyl(0.035, 0.035, mast, k.mat('metal'), 8), 0, hullH + mast / 2, d * 0.08));
    g.add(at(k.rbox(0.04, mast * 0.8, d * 0.42, 0.02, k.mat('trim')), 0, hullH + mast * 0.48, -d * 0.14));
  }
  return g;
}

// ---------- registration ----------
export function vehicleDefs(): AssetDef[] {
  return VEHICLE_SPECS.map((spec): AssetDef => ({
    kind: spec.kind,
    family: 'street', // FamilyId has no 'kenney' member (types.ts is the coordinator's)
    footprint: { w: spec.w, d: spec.d },
    height: spec.h,
    instanced: true,
    build: (k, params) => buildVehicle(spec, k, params),
  }));
}

/** Kenney model ids every K2 kind needs (for preloadKenney). */
export const VEHICLE_KENNEY_IDS: readonly KenneyId[] = [...new Set(VEHICLE_SPECS.flatMap((s) => s.ids))];

export function register(r: AssetRegistry): void {
  r.addRoles(ROLES);
  for (const spec of VEHICLE_SPECS) declareKenney(spec.kind, spec.ids);
  for (const def of vehicleDefs()) r.register(def);
}
