// Owner: T2.3. Visual-only ambient traffic: 14–24 cars on every road edge (render/traffic/model.ts drives them;
// they never touch the sim or the score). One InstancedMesh per car variant (≤ 3 draw calls), all sharing one
// KitMaterial: body panels take a per-instance palette `car` colour (aTint + instanceColor), headlights and tail
// lights glow at dusk (aGlow × uDusk), and the whole layer fades 60 % toward the background while a route is
// highlighted. Kit cars by default; Kenney cars (K0 `KENNEY_CARS`) replace them as soon as their models are loaded.
//
// Time base: cars move in sim time (they share roads with the buses, so they keep pace with them at any speed and
// freeze when the sim pauses). With no sim running (static town) they idle along in real time.
// Stadium exodus: after the scenario's advertised stadium closing time more cars pull out near the stadium.
// The time comes from `opts.closingT` / `setClosingT`, else it is read once per sim from the app's runner.
// Seed: renderer-local mulberry32 (never @headway/sim streams), seeded by the running session's scenario seed when
// the app has one (traffic restarts with each new run of a crowd, so it replays identically), else `opts.seed`.
import * as THREE from 'three';
import { deadheadPath, pointAt } from '@headway/sim';
import type { Polyline, SimSnapshot, TownMap, VehicleView } from '@headway/sim';
import { frame } from '../../state/frame';
import { useApp } from '../../state/store';
import { KENNEY_CARS, kenneyModel, kenneyReady, kenneyTemplate, preloadKenney, type KenneyId } from '../assets/kenney/index';
import { bakeGeometry, recolorBaked, type Baked } from '../kit/bake';
import { CAR_SIZE, CAR_VARIANTS, makeCar } from '../kit/cars';
import { at, box } from '../kit/prims';
import { BUS } from '../kit/vehicles';
import type { FrameContext, RenderLayer } from '../layers';
import { KitMaterial } from '../materials';
import { DEFAULT_PALETTE, PALETTES } from '../palettes';
import type { PaletteId } from '../types';
import { buildLaneGraph } from './lanes';
import { spaceBuses, type BusSlot } from '../dynamic/busSpacing';
import { KIT_VARIANTS, MAX_CARS, createTrafficModel, type BusPose, type CarVariantSpec, type TrafficModel } from './model';

export { LANE_OFFSET, buildLaneGraph } from './lanes';
export { MAX_CARS, MIN_CARS, DEFAULT_CARS, MIN_SPACING, createTrafficModel, mapBuses } from './model';
export type { BusPose, TrafficCar, TrafficEnv, TrafficModel } from './model';

/** Road surface top (matches render/town: ROAD.top). The composer may move `layer.object` if roads change height. */
export const ROAD_TOP = 0.04;
/** Buses are drawn this far right of the route centreline (render/town LANE_OFFSET). */
const BUS_LANE = 0.6;
/** Kenney cars used for traffic (one InstancedMesh each), in order of preference. */
export const TRAFFIC_KENNEY: KenneyId[] = ['car-kit/sedan', 'car-kit/suv', 'car-kit/van', 'car-kit/hatchback-sports', 'car-kit/taxi'];
const FADE = 0.6;
/** Real-time speed-up while no sim is running (static town). */
const IDLE_RATE = 4;

export interface TrafficLayerOptions {
  seed: number;
  carCount?: number;
  /** Advertised stadium closing time (sim s); null = none; omit to read it from the running sim. */
  closingT?: number | null;
  /** Use Kenney cars when loaded (default true). */
  kenney?: boolean;
}

export interface TrafficLayer extends RenderLayer {
  readonly model: TrafficModel;
  /** Seed of the current traffic (the session's scenario seed while the app runs one, else opts.seed). */
  readonly seed: number;
  /** Pin the stadium closing time (sim s), null for none, undefined to read it from the running sim again. */
  setClosingT(t: number | null | undefined): void;
  /** 'kit' or 'kenney' (which car models are drawn). */
  readonly cars: 'kit' | 'kenney';
}

interface Variant { baked: Baked; mesh: THREE.InstancedMesh; length: number }

function lerpDist(a: number, b: number, alpha: number, length: number, closed: boolean): number {
  if (!(length > 0)) return 0;
  if (!closed) return Math.min(length, Math.max(0, a + (b - a) * alpha));
  let d = b - a;
  if (d > length / 2) d -= length;
  else if (d < -length / 2) d += length;
  const v = (a + d * alpha) % length;
  return v < 0 ? v + length : v;
}

function pathOf(map: TownMap, v: VehicleView): Polyline | null {
  const p = v.path;
  if (p.kind === 'rail') return map.rail.loop;
  if (p.kind === 'route') return map.routes.find((r) => r.id === p.routeId)?.path ?? null;
  try { return deadheadPath(map, p.from, p.to); } catch { return null; }
}
const pathKey = (v: VehicleView) => (v.path.kind === 'deadhead' ? `d:${v.path.from}:${v.path.to}` : v.path.kind === 'route' ? `r:${v.path.routeId}` : 'rail');

/** Bus poses (as the renderer draws them) and the train's arc position, interpolated between snapshots. */
export function vehiclePoses(map: TownMap, prev: SimSnapshot, next: SimSnapshot, alpha: number): { buses: BusPose[]; trainDist: number | null } {
  const before = new Map(prev.vehicles.map((v) => [v.id, v] as const));
  const buses: BusPose[] = [];
  const slots: (BusSlot & { stopped: boolean })[] = [];
  let trainDist: number | null = null;
  for (const v of next.vehicles) {
    const path = pathOf(map, v);
    if (!path || path.points.length < 2) continue;
    const pv = before.get(v.id);
    const dist = pv && pathKey(pv) === pathKey(v) ? lerpDist(pv.dist, v.dist, alpha, path.length, path.closed) : v.dist;
    if (v.kind === 'train') { trainDist = dist; continue; }
    slots.push({ id: v.id, path, dist, stopped: v.state === 'dwelling' || v.state === 'holding' || v.state === 'layover' });
  }
  const spaced = spaceBuses(slots, BUS.length, BUS_LANE);
  for (const { id, path, dist: raw, stopped } of slots) {
    const p = pointAt(path, spaced.get(id) ?? raw);
    const dx = Math.cos(p.heading), dz = -Math.sin(p.heading);
    buses.push({
      id, x: p.x - dz * BUS_LANE, z: p.z + dx * BUS_LANE, dx, dz, halfLen: BUS.length / 2, stopped,
    });
  }
  return { buses, trainDist };
}

/** Scenario seed of the session the app is running, or null (previews, tests, static town). */
function sessionSeed(): number | null {
  try {
    const seed = useApp.getState().session?.scenario.seed;
    return typeof seed === 'number' && Number.isFinite(seed) ? seed : null;
  } catch { return null; }
}

const closingCache = new WeakMap<object, number | null>();
/** Advertised stadium closing time of the sim the app is running (read once per sim), or null. */
function runnerClosingT(): number | null {
  const sim = frame.runner?.sim;
  if (!sim) return null;
  if (closingCache.has(sim)) return closingCache.get(sim)!;
  let t: number | null = null;
  try { t = sim.observe().scenario.advertised.find((e) => e.kind === 'stadium_closing')?.t ?? null; } catch { t = null; }
  closingCache.set(sim, t);
  return t;
}

/** Kit car of a variant: baked once; body panels are tint-tagged (instance colour), lights glow at dusk. */
function kitVariant(i: number, palette: PaletteId): { baked: Baked; length: number } {
  const name = CAR_VARIANTS[i % CAR_VARIANTS.length]!;
  return { baked: bakeGeometry(makeCar(name, 0), palette), length: CAR_SIZE[name].length };
}

/** Kenney car turned to face +x like the kit cars, centred on its length, paint tint-tagged, plus small head/tail
 *  lights on the bumpers so it glows at dusk like the kit cars. Null when the model is not loaded. */
function kenneyVariant(id: KenneyId, palette: PaletteId): { baked: Baked; length: number } | null {
  const t = kenneyTemplate(id);
  if (!t || !kenneyReady(id)) return null;
  const model = kenneyModel(id, { palette });
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.userData.kenney as { paint?: boolean } | undefined)?.paint) o.userData.tint = true; });
  const turn = new THREE.Group();
  turn.rotation.y = Math.PI / 2; // Kenney vehicles face +z → +x
  const c = t.box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -t.box.min.y, -c.z);
  turn.add(model);
  const root = new THREE.Group();
  root.add(turn);
  const len = t.size.z, wid = t.size.x, h = t.size.y;
  const ly = Math.max(0.18, h * 0.3);
  for (const s of [-1, 1]) {
    root.add(at(box(0.03, 0.07, 0.13, 'headlight'), len / 2 + 0.005, ly, s * wid * 0.3));
    root.add(at(box(0.03, 0.07, 0.11, 'taillight'), -len / 2 - 0.005, ly + 0.02, s * wid * 0.3));
  }
  return { baked: bakeGeometry(root, palette), length: len };
}

export function createTrafficLayer(map: TownMap, opts: TrafficLayerOptions): TrafficLayer {
  const object = new THREE.Group();
  object.name = `traffic:${map.version}:${opts.seed}`;
  object.position.y = ROAD_TOP;
  const material = new KitMaterial({ roughness: 0.55 });
  const graph = buildLaneGraph(map);
  let palette: PaletteId = DEFAULT_PALETTE;
  const useKenney = opts.kenney !== false;
  const pickKenney = () => TRAFFIC_KENNEY.filter((id) => kenneyReady(id)).slice(0, 3);
  const ready0 = useKenney ? pickKenney() : [];
  let kind: 'kit' | 'kenney' = ready0.length >= 2 ? 'kenney' : 'kit';
  let kenneyIds: KenneyId[] = kind === 'kenney' ? ready0 : [];

  const build = (): Array<{ baked: Baked; length: number }> =>
    kind === 'kenney'
      ? kenneyIds.map((id) => kenneyVariant(id, palette)!).filter(Boolean)
      : [0, 1, 2].map((i) => kitVariant(i, palette));
  let built = build();
  let specs: CarVariantSpec[] = kind === 'kenney'
    ? built.map((b, i) => ({ length: b.length, weight: [0.45, 0.3, 0.25][i] ?? 0.2 }))
    : KIT_VARIANTS;
  let closingPinned = opts.closingT !== undefined;
  let seed = opts.seed;
  const makeModel = (s: number, closingT: number | null | undefined) => createTrafficModel(graph, {
    seed: s, variants: specs, colors: PALETTES[palette].car.length,
    ...(opts.carCount !== undefined ? { carCount: opts.carCount } : {}),
    ...(closingT !== undefined ? { closingT } : {}),
  });
  let model = makeModel(seed, opts.closingT);
  /** The runner's sim at the last update (undefined before the first update). */
  let lastSim: object | null | undefined;

  let variants: Variant[] = [];
  const mount = () => {
    for (const v of variants) { object.remove(v.mesh); v.mesh.dispose(); v.baked.geometry.dispose(); }
    variants = built.map((b, i) => {
      const mesh = new THREE.InstancedMesh(b.baked.geometry, material, MAX_CARS);
      mesh.name = `traffic:${kind}:${i}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      object.add(mesh);
      return { baked: b.baked, mesh, length: b.length };
    });
  };
  mount();

  // Upgrade to Kenney cars once their models load (the composer may already have preloaded them).
  let loaded = !useKenney || kind === 'kenney';
  if (!loaded) void preloadKenney(TRAFFIC_KENNEY.slice(0, 3)).catch(() => undefined).then(() => { loaded = true; });
  const maybeUpgrade = () => {
    if (!useKenney || kind === 'kenney' || !loaded) return;
    const ready = pickKenney();
    if (ready.length < 2) { loaded = false; return; } // stay on kit cars for good
    kind = 'kenney';
    kenneyIds = ready;
    built = build();
    if (built.length < 2) { kind = 'kit'; built = build(); return; }
    specs = built.map((b, i) => ({ length: b.length, weight: [0.45, 0.3, 0.25][i] ?? 0.2 }));
    model.setVariants(specs);
    mount();
  };

  let lastSimT: number | null = null;
  let fade = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const carColors: THREE.Color[] = [];
  const setColors = () => {
    carColors.length = 0;
    for (const hex of PALETTES[palette].car) carColors.push(new THREE.Color(hex));
  };
  setColors();

  function draw(): void {
    const counts = variants.map(() => 0);
    for (const c of model.cars) {
      if (c.scale <= 0.001) continue;
      const vi = c.variant < variants.length ? c.variant : c.variant % Math.max(1, variants.length);
      const v = variants[vi];
      if (!v) continue;
      const k = counts[vi]!++;
      pos.set(c.x, 0, c.z);
      q.setFromAxisAngle(yAxis, c.heading);
      scl.setScalar(c.scale);
      m4.compose(pos, q, scl);
      v.mesh.setMatrixAt(k, m4);
      col.copy(carColors[c.color % carColors.length]!);
      v.mesh.setColorAt(k, col);
    }
    variants.forEach((v, i) => {
      v.mesh.count = counts[i]!;
      v.mesh.instanceMatrix.needsUpdate = true;
      if (v.mesh.instanceColor) v.mesh.instanceColor.needsUpdate = true;
    });
  }

  const layer: TrafficLayer = {
    name: 'traffic',
    object,
    get model() { return model; },
    get seed() { return seed; },
    get cars() { return kind; },
    setClosingT(t) {
      closingPinned = t !== undefined;
      model.closingT = t ?? null;
    },
    update(ctx: FrameContext) {
      maybeUpgrade();
      const runner = frame.runner;
      const sim = runner?.sim ?? null;
      if (sim !== lastSim) {
        const first = lastSim === undefined;
        lastSim = sim;
        const s = sim ? sessionSeed() : null;
        if (s !== null && (!first || s !== seed)) { // a new run: fresh traffic from the crowd's seed
          seed = s;
          model = makeModel(seed, closingPinned ? model.closingT : undefined);
        }
      }
      if (!closingPinned) model.closingT = runnerClosingT();
      const simT = ctx.simT;
      let dt = 0;
      if (lastSimT !== null && Number.isFinite(simT)) dt = simT - lastSimT;
      if (!(dt > 0)) dt = 0;
      if (dt === 0 && !runner && ctx.next.t === ctx.prev.t) dt = ctx.dtS * IDLE_RATE; // static town: idle along
      lastSimT = simT;
      const poses = vehiclePoses(map, ctx.prev, ctx.next, ctx.alpha);
      model.step(dt, { simT: Number.isFinite(simT) ? simT : 0, buses: poses.buses, trainDist: poses.trainDist });
      const goal = ctx.highlightedRoute ? FADE : 0;
      fade += (goal - fade) * (1 - Math.exp(-Math.max(0, ctx.dtS) * 6));
      if (Math.abs(goal - fade) < 0.002) fade = goal;
      material.fade.value = fade;
      draw();
    },
    setPalette(p: PaletteId) {
      if (p === palette) return;
      palette = p;
      setColors();
      if (kind === 'kenney') { built = build(); mount(); }
      else for (const v of variants) recolorBaked(v.baked, p);
    },
    dispose() {
      for (const v of variants) { v.mesh.dispose(); v.baked.geometry.dispose(); }
      variants = [];
      material.dispose();
      object.clear();
    },
  };
  return layer;
}
