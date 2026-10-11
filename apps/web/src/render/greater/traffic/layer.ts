// Owner: G4. Visual-only greater-town traffic layer: cars and delivery trucks on G0's ring road, roundabouts, streets
// (and G1's highway lanes when passed in), entering and leaving only through world exits. Never touches the sim.
// Draw calls: 3 vehicle InstancedMeshes (one KitMaterial: per-instance paint via instanceColor + aTint, head/tail
// lights glow with uDusk) + 1 headlight-beam InstancedMesh that is only drawn at dusk = ≤ 4.
// Kenney car-kit models (sedan, SUV, delivery truck) when preloaded (`await preloadGreaterTraffic()`), else the kit
// cars, upgrading in place once the Kenney models arrive.
// Time: real seconds, frozen while the app's sim is paused, a little faster when the sim runs fast.
import * as THREE from 'three';
import type { Lane } from '../grid';
import type { SimSnapshot, TownMap } from '@headway/sim';
import { frame } from '../../../state/frame';
import { kenneyModel, kenneyReady, kenneyTemplate, preloadKenney, type KenneyId } from '../../assets/kenney/index';
import { bakeGeometry, recolorBaked, type Baked } from '../../kit/bake';
import { CAR_SIZE, CAR_VARIANTS, makeCar } from '../../kit/cars';
import { at, box } from '../../kit/prims';
import type { FrameContext, RenderLayer } from '../../layers';
import { KitMaterial, shared } from '../../materials';
import { DEFAULT_PALETTE, PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import { KERB } from '../roads/cells';
import { buildTrafficGraph, type TrafficGraph } from './graph';
import { createGreaterTrafficModel, DEFAULT_SPECS, MAX_CARS, type GreaterCar, type GreaterTrafficModel, type TrafficEnv, type VehicleSpec } from './model';

/** Kenney models used (one InstancedMesh each): everyday car, SUV, delivery truck. */
export const GREATER_TRAFFIC_MODELS: readonly KenneyId[] = ['car-kit/sedan', 'car-kit/suv', 'car-kit/delivery'];
const WEIGHTS = [0.5, 0.32, 0.18];
const SPEED = [1, 1, 0.85];
const FADE = 0.6;
const BEAM = { length: 2.6, width: 1.5, y: 0.025, opacity: 0.55, color: '#FFE0A6' } as const;

/** Load the Kenney vehicles (safe to call repeatedly; never rejects). */
export function preloadGreaterTraffic(): Promise<void> {
  return preloadKenney([...GREATER_TRAFFIC_MODELS]);
}

export interface GreaterTrafficLayerOptions {
  seed?: number;
  /** Target number of vehicles (default 36, max 64). */
  cars?: number;
  palette?: PaletteId;
  /** Extra lanes to drive (G1 highway + ramps); merged with G0's lanes and relinked. */
  lanes?: readonly Lane[];
  /** Approach length beyond the grid edge at world exits (default 8 u): cars appear / vanish there. */
  approach?: number;
  /** Height of the road surface under a lane point (e.g. G1's overpass); default 0 (flat at KERB.roadTop). */
  laneY?: (laneId: string, s: number, x: number, z: number) => number;
  /** Seconds of traffic simulated up front so the first frame is already busy (default 150). */
  warm?: number;
  /** Use Kenney vehicles when loaded (default true). */
  kenney?: boolean;
  /** Town hand-off (see GreaterTrafficModelOptions): cars reaching the board edge through a board port. */
  onBoardExit?: (portId: string, car: Readonly<GreaterCar>) => void;
  boardShare?: number;
}

export interface GreaterTrafficLayer extends RenderLayer {
  readonly graph: TrafficGraph;
  readonly model: GreaterTrafficModel;
  /** 'kit' or 'kenney' (which vehicle models are drawn). */
  readonly vehicles: 'kit' | 'kenney';
  /** A car arriving from the town at a board port (`g.ports` id, kind 'board'); false when there is no room. */
  admit(portId: string): boolean;
  /** Advance and redraw without a FrameContext (previews, tests): real seconds. */
  tick(dtS: number, env?: TrafficEnv): void;
}

interface Built { baked: Baked; length: number }
interface Variant extends Built { mesh: THREE.InstancedMesh }

/** Kit car: role-tagged, body panels tinted per instance; already faces +x with lights on the bumpers. */
function kitVariant(i: number, palette: PaletteId): Built {
  const name = CAR_VARIANTS[[0, 2, 1][i] ?? 0]!; // hatchback, pickup, van
  return { baked: bakeGeometry(makeCar(name, 0), palette), length: CAR_SIZE[name].length };
}

/** Kenney vehicle turned to face +x, centred on its footprint, paint tint-tagged, with small head/tail lights. */
function kenneyVariant(id: KenneyId, palette: PaletteId): Built | null {
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
  const ly = Math.min(0.42, Math.max(0.18, h * 0.3));
  for (const s of [-1, 1]) {
    root.add(at(box(0.03, 0.07, 0.13, 'headlight'), len / 2 + 0.005, ly, s * wid * 0.3));
    root.add(at(box(0.03, 0.07, 0.11, 'taillight'), -len / 2 - 0.005, ly + 0.02, s * wid * 0.3));
  }
  return { baked: bakeGeometry(root, palette), length: len };
}

/** Soft headlight fan on the road: x 0..1 forward from the bumper, z −0.5..0.5 across. */
function beamGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0.5, 0, 0);
  return geo;
}
function beamTexture(): THREE.DataTexture {
  const W = 64, H = 32, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = i / (W - 1), v = (j / (H - 1)) * 2 - 1;
    const half = 0.32 + 0.62 * u;
    const across = Math.max(0, 1 - Math.abs(v) / half);
    const k = Math.pow(across, 1.4) * Math.pow(1 - u, 1.3) * Math.min(1, u / 0.06);
    const b = Math.round(255 * Math.max(0, Math.min(1, k)));
    const o = (j * W + i) * 4;
    data[o] = data[o + 1] = data[o + 2] = b;
    data[o + 3] = b;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Train front arc distance (interpolated), or null. */
function trainDistOf(prev: SimSnapshot | undefined, next: SimSnapshot | undefined, alpha: number, railLen: number): number | null {
  const t = next?.vehicles.find((v) => v.kind === 'train');
  if (!t) return null;
  const p = prev?.vehicles.find((v) => v.id === t.id && v.path.kind === t.path.kind);
  if (!p || !(railLen > 0)) return t.dist;
  let d = t.dist - p.dist;
  if (d > railLen / 2) d -= railLen;
  else if (d < -railLen / 2) d += railLen;
  const v = (p.dist + d * alpha) % railLen;
  return v < 0 ? v + railLen : v;
}

export function createGreaterTrafficLayer(map: TownMap, opts: GreaterTrafficLayerOptions = {}): GreaterTrafficLayer {
  const object = new THREE.Group();
  object.name = 'greater-traffic';
  object.position.y = KERB.roadTop;
  const graph = buildTrafficGraph(map, { ...(opts.lanes ? { lanes: opts.lanes } : {}), ...(opts.approach !== undefined ? { approach: opts.approach } : {}) });
  let palette: PaletteId = opts.palette ?? DEFAULT_PALETTE;
  const material = new KitMaterial({ roughness: 0.55 });
  const useKenney = opts.kenney !== false;
  const kenneyAll = () => GREATER_TRAFFIC_MODELS.every((id) => kenneyReady(id));
  let kind: 'kit' | 'kenney' = useKenney && kenneyAll() ? 'kenney' : 'kit';

  const build = (): Built[] => (kind === 'kenney'
    ? GREATER_TRAFFIC_MODELS.map((id) => kenneyVariant(id, palette)).filter((b): b is Built => !!b)
    : [0, 1, 2].map((i) => kitVariant(i, palette)));
  let built = build();
  const specsOf = (b: Built[]): VehicleSpec[] => b.map((x, i) => ({ length: x.length, weight: WEIGHTS[i] ?? 0.2, speed: SPEED[i] ?? 1 }));
  const model = createGreaterTrafficModel(graph, {
    seed: opts.seed ?? 1, variants: built.length ? specsOf(built) : DEFAULT_SPECS, colors: PALETTES[palette].car.length,
    ...(opts.cars !== undefined ? { cars: opts.cars } : {}),
    ...(opts.onBoardExit ? { onBoardExit: opts.onBoardExit } : {}),
    ...(opts.boardShare !== undefined ? { boardShare: opts.boardShare } : {}),
  });
  model.warm(opts.warm ?? 150);

  let variants: Variant[] = [];
  const mount = () => {
    for (const v of variants) { object.remove(v.mesh); v.mesh.dispose(); v.baked.geometry.dispose(); }
    variants = built.map((b, i) => {
      const mesh = new THREE.InstancedMesh(b.baked.geometry, material, MAX_CARS);
      mesh.name = `greater-traffic:${kind}:${i}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      object.add(mesh);
      return { ...b, mesh };
    });
  };
  mount();

  // headlight beams (drawn only at dusk)
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTexture(), color: BEAM.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const beams = new THREE.InstancedMesh(beamGeometry(), beamMat, MAX_CARS);
  beams.name = 'greater-traffic:beams';
  beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  beams.count = 0;
  beams.frustumCulled = false;
  beams.renderOrder = 2;
  beams.visible = false;
  object.add(beams);

  // upgrade to Kenney vehicles once loaded
  let loading = false;
  const maybeUpgrade = () => {
    if (!useKenney || kind === 'kenney') return;
    if (!kenneyAll()) {
      if (!loading) { loading = true; void preloadGreaterTraffic(); }
      return;
    }
    kind = 'kenney';
    const next = build();
    if (next.length < GREATER_TRAFFIC_MODELS.length) { kind = 'kit'; return; }
    built = next;
    model.setVariants(specsOf(built));
    mount();
  };

  let fade = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  let carColors: THREE.Color[] = [];
  const setColors = () => { carColors = PALETTES[palette].car.map((hex) => new THREE.Color(hex)); };
  setColors();

  function draw(): void {
    const dusk = shared.uDusk.value;
    const showBeams = dusk > 0.02;
    beams.visible = showBeams;
    beamMat.opacity = BEAM.opacity * dusk * (1 - fade);
    const counts = variants.map(() => 0);
    let nb = 0;
    for (const c of model.cars) {
      if (c.scale <= 0.001) continue;
      const vi = c.variant % Math.max(1, variants.length);
      const v = variants[vi];
      if (!v) continue;
      const k = counts[vi]!++;
      const y = opts.laneY ? opts.laneY(c.lane.id, c.s, c.x, c.z) : 0;
      pos.set(c.x, y, c.z);
      q.setFromAxisAngle(yAxis, c.heading);
      scl.setScalar(c.scale);
      m4.compose(pos, q, scl);
      v.mesh.setMatrixAt(k, m4);
      v.mesh.setColorAt(k, carColors[c.color % carColors.length]!);
      if (showBeams) {
        const dx = Math.cos(c.heading), dz = -Math.sin(c.heading);
        pos.set(c.x + dx * c.halfLen * c.scale, y + BEAM.y, c.z + dz * c.halfLen * c.scale);
        scl.set(BEAM.length * c.scale, 1, BEAM.width * c.scale);
        m4.compose(pos, q, scl);
        beams.setMatrixAt(nb++, m4);
      }
    }
    variants.forEach((v, i) => {
      v.mesh.count = counts[i]!;
      v.mesh.instanceMatrix.needsUpdate = true;
      if (v.mesh.instanceColor) v.mesh.instanceColor.needsUpdate = true;
    });
    beams.count = nb;
    beams.instanceMatrix.needsUpdate = true;
  }

  const advance = (dtS: number, env: TrafficEnv, highlighted: boolean) => {
    maybeUpgrade();
    model.step(dtS, env);
    const goal = highlighted ? FADE : 0;
    fade += (goal - fade) * (1 - Math.exp(-Math.max(0, dtS) * 6));
    if (Math.abs(goal - fade) < 0.002) fade = goal;
    material.fade.value = fade;
    draw();
  };
  draw();

  const layer: GreaterTrafficLayer = {
    name: 'greater-traffic',
    object,
    graph,
    model,
    get vehicles() { return kind; },
    admit: (portId) => model.admit(portId),
    tick(dtS, env = {}) { advance(Math.max(0, dtS), env, false); },
    update(ctx: FrameContext) {
      const runner = frame.runner;
      let rate = 1;
      if (runner) rate = runner.paused ? 0 : Math.min(2, Math.max(0.6, Math.sqrt(runner.speed / 8)));
      const dt = Math.min(0.1, Math.max(0, ctx.dtS)) * rate;
      advance(dt, { trainDist: trainDistOf(ctx.prev, ctx.next, ctx.alpha, graph.railLength) }, !!ctx.highlightedRoute);
    },
    setPalette(p: PaletteId) {
      if (p === palette) return;
      palette = p;
      setColors();
      if (kind === 'kenney') { built = build(); mount(); }
      else for (const v of variants) recolorBaked(v.baked, p);
      draw();
    },
    dispose() {
      for (const v of variants) { v.mesh.dispose(); v.baked.geometry.dispose(); }
      variants = [];
      beams.geometry.dispose();
      beamMat.map?.dispose();
      beamMat.dispose();
      beams.dispose();
      material.dispose();
      object.clear();
    },
  };
  return layer;
}
