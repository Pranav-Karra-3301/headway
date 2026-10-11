// Owner: T2.2. The static town: board, roads, rail, stations and stops from TOWN; base SCENERY (Task M) where no
// district provides items; every DISTRICTS item through the asset registry with the clay KitContext adapter.
// Everything static is baked (kit/bake) into a few vertex-coloured meshes drawn with the shared clay KitMaterial:
//   ground   board + lawns + roads + rail + station platforms     (fades 30 % when a route is highlighted)
//   scenery  buildings, landmarks, furniture; one chunk per source (fades 60 %)
//   stops    one mesh per stop (stays bright when it serves the highlighted route)
//   trees    kit forest for base trees + one InstancedMesh per swaying district asset variant (fades 60 %)
//   live     textured models (e.g. Kenney colormap kits) auto-instanced by geometry + material
import * as THREE from 'three';
import { stationPlacement } from '@headway/sim';
import type { RouteId, StationId, StopId, TownMap } from '@headway/sim';
import { AssetRegistry, createRegistry } from '../assets/index';
import type { PlacedAsset } from '../assets/types';
import { DISTRICTS } from '../districts/index';
import type { DistrictScenery } from '../districts/types';
import {
  bakeGeometry, createForest, makeBoard, makeBuilding, makeClockTower, makeLawn, makeStadium, makeStation, makeStop,
  recolorBaked, setBakedDetail, STATION_CLOCK, type Baked, type BuildingType, type Forest, type TreePlacement,
} from '../kit';
import { KitMaterial } from '../materials';
import { SCENERY, type SceneryItem } from '../scenery';
import type { DetailMode, PaletteId } from '../types';
import { hashString, stopFrame } from '../dynamic/interp';
import { composeScenery } from './compose';
import { createClayKit, createClayKitShared, disposeClayKitShared, placementSeed, roleResolver } from './kitContext';
import { makeRail, makeRoads } from './network';

export { LANE_OFFSET, ROAD, sweep } from './network';
export { composeScenery, inRegion } from './compose';

export interface StaticTownOptions {
  palette: PaletteId;
  detail: DetailMode;
  scenery?: readonly SceneryItem[];
  districts?: readonly DistrictScenery[];
  registry?: AssetRegistry;
}

export interface StopModel {
  id: StopId;
  routes: RouteId[];
  mesh: THREE.Mesh;
  material: KitMaterial;
  /** Model origin + yaw (see dynamic/interp stopFrame). */
  frame: { x: number; z: number; rot: number };
}

export interface StaticTownStats { meshes: number; instanced: number; vertices: number; items: number; placeholders: number; live: number }

export interface StaticTown {
  readonly object: THREE.Group;
  readonly stops: StopModel[];
  readonly stats: StaticTownStats;
  /** Where base SCENERY drew its clock tower (for FX hands), if any. */
  readonly clockTower: { x: number; z: number; rot: number; source: 'kit' | 'lm.clockTower' } | null;
  setPalette(p: PaletteId): void;
  setDetail(d: DetailMode): void;
  /** Highlight a route: other stops and all scenery lerp toward the background (eased in update). */
  setHighlight(route: RouteId | null): void;
  update(dtS: number): void;
  dispose(): void;
}

const ROUTE_IDX: Record<RouteId, number> = { r1: 0, r2: 1, r3: 2 };
/** Kit stand-in for scenery kinds without a finer building type. */
const KIND_BUILDING: Partial<Record<SceneryItem['kind'], BuildingType>> = { small: 'small', tall: 'tall', hall: 'hall' };
/** Distinct shapes per swaying district kind (params.variant is pinned to one of these when absent). */
const SWAY_VARIANTS = 4;
const MAX_PROTOTYPES = 6;
const FADE = { ground: 0.3, scenery: 0.6, trees: 0.6, stop: 0.6 } as const;

/** The asset registry, or an empty one if a family fails to register (its kinds then draw as placeholders). */
function safeRegistry(): AssetRegistry {
  try {
    return createRegistry();
  } catch (e) {
    console.warn('[town] asset registry failed; district items will be placeholders', e);
    return new AssetRegistry();
  }
}

function hasTexture(o: THREE.Object3D): boolean {
  let tex = false;
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) if ((mm as THREE.MeshStandardMaterial).map) tex = true;
  });
  return tex;
}

function isPlaceholder(o: THREE.Object3D): boolean {
  return !!o.userData.placeholder;
}

/** Station model without the kit's own building (and, when a district owns the area, without its clock). */
function platformOnly(station: THREE.Group, dropClock: boolean): THREE.Group {
  for (const c of [...station.children]) {
    if (c.position.z < -1.5 || (dropClock && Math.abs(c.position.x - STATION_CLOCK.x) < 0.01)) station.remove(c);
  }
  return station;
}

export function createStaticTown(map: TownMap, opts: StaticTownOptions): StaticTown {
  let palette = opts.palette;
  const registry = opts.registry ?? safeRegistry();
  const resolve = roleResolver(registry.roles);
  const kitShared = createClayKitShared(registry.roles, palette);
  const composed = composeScenery(opts.scenery ?? SCENERY, opts.districts ?? DISTRICTS);
  const object = new THREE.Group();
  object.name = 'town:static';
  const bakes: Baked[] = [];
  const stats: StaticTownStats = { meshes: 0, instanced: 0, vertices: 0, items: 0, placeholders: 0, live: 0 };
  const disposables: Array<{ dispose(): void }> = [];

  const groundMat = new KitMaterial();
  const sceneryMat = new KitMaterial();
  const treeMat = new KitMaterial({ sway: true });
  disposables.push(groundMat, sceneryMat, treeMat);

  const addBaked = (b: Baked, mat: THREE.Material, name: string, castShadow = true): THREE.Mesh => {
    bakes.push(b);
    const mesh = new THREE.Mesh(b.geometry, mat);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    object.add(mesh);
    stats.meshes++;
    stats.vertices += b.geometry.getAttribute('position').count;
    return mesh;
  };
  const place = <T extends THREE.Object3D>(o: T, x: number, z: number, rot = 0, y = 0): T => {
    o.position.set(x, y, z);
    o.rotation.y = rot;
    return o;
  };
  const build = (p: PlacedAsset): THREE.Object3D => {
    const k = createClayKit(kitShared, placementSeed(p.kind, p.x, p.z));
    try {
      return registry.build(k, p);
    } catch (e) {
      console.warn(`[town] ${p.kind} failed to build`, e);
      const g = new THREE.Group();
      g.userData.placeholder = true;
      return g;
    }
  };

  // ---------------------------------------------------------------- ground: board, lawns, roads, rail, platforms
  const b = map.bounds;
  const ground = new THREE.Group();
  const board = makeBoard(b.maxX - b.minX, b.maxZ - b.minZ);
  board.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.add(board);
  for (const it of composed.base) if (it.kind === 'lawn') ground.add(place(makeLawn(it.w ?? 2, it.d ?? 2), it.x, it.z));
  ground.add(makeRoads(map));
  ground.add(makeRail(map));
  for (const it of composed.base) {
    if (it.kind !== 'station' || !it.stationId) continue;
    const s = makeStation({ track: false, hands: false });
    if (composed.platformOnly.has(it.stationId)) platformOnly(s, composed.owned.has(it.stationId));
    ground.add(place(s, it.x, it.z, it.rot ?? 0));
  }
  // stations the scenery does not list still get their platform
  for (const st of map.rail.stations) {
    if (composed.base.some((i) => i.kind === 'station' && i.stationId === st.id)) continue;
    const pl = stationPlacement(st.id as StationId);
    const s = makeStation({ track: false, hands: false });
    platformOnly(s, true);
    ground.add(place(s, pl.x, pl.z, pl.rot));
  }
  addBaked(bakeGeometry(ground, palette, { resolve }), groundMat, 'ground');

  // ---------------------------------------------------------------- stops (one mesh each)
  const stops: StopModel[] = map.stops.map((s) => {
    const frame = stopFrame(s.p, s.queueDir);
    const model = makeStop(s.servedRoutes.map((r) => ROUTE_IDX[r] ?? 0));
    const baked = bakeGeometry(model, palette);
    const material = new KitMaterial();
    disposables.push(material);
    const mesh = addBaked(baked, material, `stop:${s.id}`);
    mesh.position.set(frame.x, 0, frame.z);
    mesh.rotation.y = frame.rot;
    mesh.updateMatrix();
    mesh.userData.pick = { kind: 'stop', id: s.id };
    return { id: s.id, routes: [...s.servedRoutes], mesh, material, frame };
  });

  // ---------------------------------------------------------------- base scenery (kit modules + A4 landmarks)
  const baseGroup = new THREE.Group();
  const trees: TreePlacement[] = [];
  let clockTower: StaticTown['clockTower'] = null;
  for (const it of composed.base) {
    const rot = it.rot ?? 0;
    switch (it.kind) {
      case 'tree':
        trees.push({ x: it.x, z: it.z, variant: it.variant ?? 0, ...(it.leaf !== undefined ? { leaf: it.leaf } : {}), ...(it.scale !== undefined ? { scale: it.scale } : {}) });
        break;
      // Base landmarks stay kit models: FX anchors hands/floodlights to kit CLOCK_TOWER / STADIUM for base scenery
      // (districts place A4's lm.clockTower / lm.stadium, which FX anchors separately).
      case 'clockTower':
        baseGroup.add(place(makeClockTower({ hands: false }), it.x, it.z, rot));
        clockTower = { x: it.x, z: it.z, rot, source: 'kit' };
        stats.items++;
        break;
      case 'stadium':
        baseGroup.add(place(makeStadium(), it.x, it.z, rot));
        stats.items++;
        break;
      case 'small': case 'tall': case 'hall': {
        const type = it.building ?? KIND_BUILDING[it.kind]!;
        const seed = hashString(`${type}@${it.x},${it.z}`) % 997;
        baseGroup.add(place(makeBuilding(type, { wall: it.wall ?? 0, roof: it.roof ?? 0, seed }), it.x, it.z, rot));
        stats.items++;
        break;
      }
      default: break; // lawns + stations are ground
    }
  }
  if (baseGroup.children.length) addBaked(bakeGeometry(baseGroup, palette, { resolve }), sceneryMat, 'scenery:base');
  let forest: Forest | null = null;
  if (trees.length) {
    forest = createForest(trees, { palette, seed: 11, sway: true });
    forest.material.dispose();
    for (const m of forest.meshes) { m.material = treeMat; m.matrixAutoUpdate = false; m.updateMatrix(); }
    object.add(forest.object);
    stats.instanced += forest.meshes.length;
  }

  // ---------------------------------------------------------------- district items through the registry
  const live: THREE.Object3D[] = [];
  const protoByKind = new Map<string, Map<string, { baked: Baked; matrices: THREE.Matrix4[] }>>();
  const districts = (opts.districts ?? DISTRICTS).filter((d) => d.items.length > 0);
  for (const d of districts) {
    const statics = new THREE.Group();
    for (const raw of d.items) {
      const def = registry.get(raw.kind);
      let p = raw;
      if (def?.instanced && def.sway && (raw.params?.variant === undefined)) {
        p = { ...raw, params: { ...raw.params, variant: placementSeed(raw.kind, raw.x, raw.z) % SWAY_VARIANTS } };
      }
      const obj = build(p);
      stats.items++;
      if (isPlaceholder(obj)) stats.placeholders++;
      if (hasTexture(obj)) { live.push(obj); continue; }
      if (def?.instanced && def.sway) {
        let byKey = protoByKind.get(p.kind);
        if (!byKey) { byKey = new Map(); protoByKind.set(p.kind, byKey); }
        let key = String(obj.userData.variant ?? p.params?.variant ?? '');
        if (!byKey.has(key) && byKey.size >= MAX_PROTOTYPES) key = [...byKey.keys()][hashString(key) % byKey.size]!;
        let proto = byKey.get(key);
        if (!proto) { proto = { baked: bakeGeometry(obj, palette, { resolve }), matrices: [] }; byKey.set(key, proto); }
        obj.updateMatrix();
        proto.matrices.push(obj.matrix.clone());
        continue;
      }
      statics.add(obj);
    }
    if (statics.children.length) addBaked(bakeGeometry(statics, palette, { resolve }), sceneryMat, `scenery:${d.id}`);
  }
  const swayMeshes: THREE.InstancedMesh[] = [];
  for (const [kind, byKey] of protoByKind) {
    for (const [key, proto] of byKey) {
      bakes.push(proto.baked);
      const mesh = new THREE.InstancedMesh(proto.baked.geometry, treeMat, proto.matrices.length);
      mesh.name = `trees:${kind}:${key}`;
      proto.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      object.add(mesh);
      swayMeshes.push(mesh);
      stats.instanced++;
      stats.vertices += proto.baked.geometry.getAttribute('position').count;
    }
  }
  // textured models: one InstancedMesh per (geometry, material)
  if (live.length) {
    const groups = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; ms: THREE.Matrix4[]; cast: boolean }>();
    for (const o of live) {
      o.updateMatrixWorld(true);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || !m.visible) return;
        const mats = Array.isArray(m.material) ? m.material.map((x) => x.uuid).join(',') : m.material.uuid;
        const key = `${m.geometry.uuid}|${mats}`;
        let gr = groups.get(key);
        if (!gr) { gr = { geo: m.geometry, mat: m.material, ms: [], cast: m.castShadow }; groups.set(key, gr); }
        gr.ms.push(m.matrixWorld.clone());
      });
    }
    for (const gr of groups.values()) {
      const mesh = new THREE.InstancedMesh(gr.geo, gr.mat, gr.ms.length);
      gr.ms.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = gr.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      object.add(mesh);
      stats.live++;
    }
  }

  // ---------------------------------------------------------------- palette / detail / highlight
  const fades = { ground: 0, scenery: 0, trees: 0 };
  const goals = { ground: 0, scenery: 0, trees: 0 };
  const stopGoal = new Map<StopId, number>(stops.map((s) => [s.id, 0]));
  const applyDetail = (d: DetailMode) => {
    for (const bk of bakes) setBakedDetail(bk, d === 'toy');
    forest?.setDetail(d);
  };
  applyDetail(opts.detail);

  return {
    object,
    stops,
    stats,
    clockTower,
    setPalette(p) {
      palette = p;
      kitShared.palette = p;
      for (const bk of bakes) recolorBaked(bk, p);
      forest?.setPalette(p);
    },
    setDetail: applyDetail,
    setHighlight(route) {
      const on = route !== null;
      goals.ground = on ? FADE.ground : 0;
      goals.scenery = on ? FADE.scenery : 0;
      goals.trees = on ? FADE.trees : 0;
      for (const s of stops) stopGoal.set(s.id, on && !s.routes.includes(route) ? FADE.stop : 0);
    },
    update(dtS) {
      const k = 1 - Math.exp(-Math.max(0, dtS) * 7);
      for (const key of ['ground', 'scenery', 'trees'] as const) fades[key] += (goals[key] - fades[key]) * k;
      groundMat.fade.value = fades.ground;
      sceneryMat.fade.value = fades.scenery;
      treeMat.fade.value = fades.trees;
      for (const s of stops) s.material.fade.value += ((stopGoal.get(s.id) ?? 0) - s.material.fade.value) * k;
    },
    dispose() {
      for (const bk of bakes) bk.geometry.dispose();
      for (const m of swayMeshes) m.dispose();
      forest?.dispose();
      for (const d of disposables) d.dispose();
      disposeClayKitShared(kitShared);
      object.clear();
    },
  };
}

