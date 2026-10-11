// Owner: C1 (camera study). The town as the study page draws it (world-dev style, no TownRenderer needed): board,
// roads, route ribbons, rail, stops, stations and every placed asset (registry + basic kit) baked into ONE
// geometry on the clay KitMaterial; buses, the train and people from a stub-sim snapshot as a few InstancedMeshes;
// the world layer (terrain / water / sky / base) around it.
import * as THREE from 'three';
import { deadheadPath, pointAt, stationPlacement } from '@headway/sim';
import type { Polyline, RouteId, SimSnapshot, TownMap, Vec2, VehicleView } from '@headway/sim';
import { createBasicKit } from '../../assets/basicKit';
import { createRegistry } from '../../assets/index';
import { at, bakeGeometry, box, makeBus, makePerson, makeStation, makeStop, makeTrain, rbox } from '../../kit';
import type { Baked, RoleResolver } from '../../kit';
import type { FrameContext, RenderLayer } from '../../layers';
import { KitMaterial } from '../../materials';
import { PALETTES } from '../../palettes';
import type { LightMode } from '../../types';
import { createWorldLayer } from '../../world/index';
import { DECK_Y, queueSlot } from './samples';
import type { StudyTown } from './town';

const ROUTE_IDX: Record<RouteId, number> = { r1: 0, r2: 1, r3: 2 };

/** Flat strip along a polyline (mitred joins), normals up, material named "role#idx" so the bake colours it. */
function ribbon(points: readonly Vec2[], closed: boolean, width: number, y: number, role: string, idx = 0, offset = 0): THREE.Mesh {
  const n = points.length;
  const pos: number[] = [], ix: number[] = [];
  const pt = (i: number) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  for (let i = 0; i < n; i++) {
    const p = pt(i), a = pt(i - 1), b = pt(i + 1);
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    // segment normal of the incoming segment for the mitre length
    const ix0 = p.x - a.x, iz0 = p.z - a.z, il = Math.hypot(ix0, iz0);
    const nx = -tz, nz = tx;
    let m = 1;
    if (il > 1e-6) { const sx = -iz0 / il, sz = ix0 / il; m = 1 / Math.max(0.35, sx * nx + sz * nz); }
    const h = (width / 2) * m;
    pos.push(p.x + nx * (offset * m + h), y, p.z + nz * (offset * m + h), p.x + nx * (offset * m - h), y, p.z + nz * (offset * m - h));
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    ix.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(ix);
  g.computeVertexNormals();
  // make sure every strip faces up whatever the winding
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  mat.name = `${role}#${idx}`;
  return new THREE.Mesh(g, mat);
}

function flatPolygon(poly: readonly Vec2[], y: number, role: string, idx = 0): THREE.Mesh {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const mat = new THREE.MeshStandardMaterial();
  mat.name = `${role}#${idx}`;
  return new THREE.Mesh(g, mat);
}

const AREA_ROLE: Record<string, string> = { lawn: 'lawn', garden: 'lawn', plaza: 'curb', parking: 'road', sports: 'field' };

/** Everything static in one Group (not yet baked) + the colour resolver for family roles the palette lacks. */
export function buildStaticTown(map: TownMap, town: StudyTown): { group: THREE.Group; resolve: RoleResolver } {
  const g = new THREE.Group();
  const b = map.bounds;
  g.add(at(rbox(b.maxX - b.minX, 0.6, b.maxZ - b.minZ, 0.12, 'board'), (b.minX + b.maxX) / 2, -0.3, (b.minZ + b.maxZ) / 2));
  for (const a of town.areas) g.add(flatPolygon(a.polygon, 0.008, AREA_ROLE[a.kind] ?? 'lawn'));
  for (const e of map.roads.edges) g.add(ribbon(e.path.points, e.path.closed, 2.4, 0.016, 'road'));
  for (const r of map.routes) g.add(ribbon(r.path.points, true, 0.3, 0.03, 'route', ROUTE_IDX[r.id], (ROUTE_IDX[r.id] - 1) * 0.42));
  // rail: ballast bed, ties, two rails
  const loop = map.rail.loop;
  g.add(ribbon(loop.points, true, 1.8, 0.035, 'ballast'));
  for (let d = 0; d < loop.length; d += 0.6) {
    const p = pointAt(loop, d);
    const tie = box(0.26, 0.07, 1.4, 'ties'); tie.position.set(p.x, 0.07, p.z); tie.rotation.y = p.heading; g.add(tie);
  }
  for (const o of [-0.45, 0.45]) g.add(ribbon(loop.points, true, 0.1, 0.13, 'rail', 0, o));
  // stations: the kit station (platform, canopy, house) or just the platform where a district owns the building
  for (const st of town.stations) {
    const sp = stationPlacement(st.id);
    const s = st.kitBuilding ? makeStation({ track: false }) : at(rbox(9, 0.55, 2.4, 0.1, 'platform'), 0, 0.275, -0.2);
    const holder = new THREE.Group(); holder.add(s); holder.position.set(sp.x, 0, sp.z); holder.rotation.y = sp.rot; g.add(holder);
  }
  for (const s of map.stops) {
    const stop = makeStop(s.servedRoutes.map((r) => ROUTE_IDX[r]));
    stop.position.set(s.p.x, 0, s.p.z);
    stop.rotation.y = Math.atan2(-s.queueDir.x, -s.queueDir.z);
    g.add(stop);
  }
  const registry = createRegistry();
  const kit = createBasicKit(registry.roles, 0, 7);
  for (const p of town.placements) g.add(registry.build(kit, p));
  // Family parts are tagged with family roles (e.g. downtown's); colour them exactly like the basic kit does.
  const resolve: RoleResolver = (role, idx) => {
    const m = kit.mat(role, idx) as THREE.MeshStandardMaterial;
    return m.color ? '#' + m.color.getHexString() : undefined;
  };
  return { group: g, resolve };
}

function pathOf(map: TownMap, v: VehicleView, cache: Map<string, Polyline>): Polyline {
  if (v.path.kind === 'rail') return map.rail.loop;
  if (v.path.kind === 'route') { const id = v.path.routeId; return map.routes.find((r) => r.id === id)!.path; }
  const key = `${v.path.from}>${v.path.to}`;
  let p = cache.get(key);
  if (!p) { p = deadheadPath(map, v.path.from, v.path.to); cache.set(key, p); }
  return p;
}

/** Positions of the gameplay things in a snapshot (for drawing and for the dynamic-occlusion overlay). */
export function snapshotPlacements(map: TownMap, snap: SimSnapshot): {
  buses: Array<{ x: number; z: number; heading: number; route: number }>;
  train: { x: number; z: number; heading: number } | null;
  people: Array<{ x: number; y: number; z: number; tint: number; rot: number }>;
} {
  const cache = new Map<string, Polyline>();
  const buses: Array<{ x: number; z: number; heading: number; route: number }> = [];
  let train: { x: number; z: number; heading: number } | null = null;
  for (const v of snap.vehicles) {
    const p = pointAt(pathOf(map, v, cache), v.dist);
    if (v.kind === 'train') train = { x: p.x, z: p.z, heading: p.heading };
    else buses.push({ x: p.x, z: p.z, heading: p.heading, route: v.routeId ? ROUTE_IDX[v.routeId] : 0 });
  }
  const people: Array<{ x: number; y: number; z: number; tint: number; rot: number }> = [];
  for (const pv of snap.people) {
    if (pv.state === 'waiting' && pv.at) {
      const place = pv.at.kind === 'stop' ? map.stops.find((s) => s.id === pv.at!.id) : map.rail.stations.find((s) => s.id === pv.at!.id);
      if (!place) continue;
      const origin = 'p' in place ? place.p : place.platform;
      const q = queueSlot(origin, place.queueDir, pv.slot ?? 0);
      people.push({ x: q.x, y: pv.at.kind === 'platform' ? DECK_Y : 0, z: q.z, tint: pv.tint, rot: Math.atan2(-place.queueDir.x, -place.queueDir.z) });
    } else if (pv.state === 'walking' && pv.from && pv.to && pv.t0 !== undefined && pv.t1 !== undefined) {
      const f = pv.t1 > pv.t0 ? Math.min(1, Math.max(0, (snap.t - pv.t0) / (pv.t1 - pv.t0))) : 1;
      people.push({ x: pv.from.x + (pv.to.x - pv.from.x) * f, y: 0, z: pv.from.z + (pv.to.z - pv.from.z) * f, tint: pv.tint, rot: Math.atan2(pv.to.x - pv.from.x, pv.to.z - pv.from.z) });
    }
  }
  return { buses, train, people };
}

function instanced(baked: Baked, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(baked.geometry, mat, Math.max(1, mats.length));
  m.count = mats.length;
  mats.forEach((x, i) => m.setMatrixAt(i, x));
  colors?.forEach((c, i) => m.setColorAt(i, c));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export interface StudyScene {
  root: THREE.Group;
  world: RenderLayer | null;
  stats: { triangles: number; staticMeshes: number; dynamicMeshes: number };
  update(ctx: Omit<FrameContext, 'map'>): void;
  dispose(): void;
}

export function buildStudyScene(map: TownMap, town: StudyTown, snap: SimSnapshot | null, opts: { world?: boolean; light?: LightMode } = {}): StudyScene {
  const root = new THREE.Group();
  root.name = 'camera-study';
  const P = PALETTES.a;
  const disposables: Array<{ dispose(): void }> = [];

  const { group: statics, resolve } = buildStaticTown(map, town);
  const baked = bakeGeometry(statics, P, { resolve });
  const kitMat = new KitMaterial();
  const town3d = new THREE.Mesh(baked.geometry, kitMat);
  town3d.castShadow = true; town3d.receiveShadow = true;
  root.add(town3d);
  disposables.push(baked.geometry, kitMat);
  statics.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); } });

  let dynamicMeshes = 0;
  if (snap) {
    const pl = snapshotPlacements(map, snap);
    const M = (x: number, y: number, z: number, ry: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
    for (let r = 0; r < 3; r++) {
      const list = pl.buses.filter((b) => b.route === r);
      if (!list.length) continue;
      const bb = bakeGeometry(makeBus(r), P);
      root.add(instanced(bb, kitMat, list.map((b) => M(b.x, 0, b.z, b.heading))));
      dynamicMeshes++;
    }
    if (pl.train) {
      const tb = bakeGeometry(makeTrain(), P);
      const t = new THREE.Mesh(tb.geometry, kitMat);
      t.position.set(pl.train.x, 0.2, pl.train.z); t.rotation.y = pl.train.heading; t.castShadow = true;
      root.add(t);
      dynamicMeshes++;
    }
    if (pl.people.length) {
      const pb = bakeGeometry(makePerson(0), P);
      const cols = pl.people.map((p) => new THREE.Color(P.shirt[p.tint % P.shirt.length]!));
      root.add(instanced(pb, kitMat, pl.people.map((p) => M(p.x, p.y, p.z, p.rot)), cols));
      dynamicMeshes++;
    }
  }

  let world: RenderLayer | null = null;
  if (opts.world ?? true) {
    try {
      world = createWorldLayer(map);
      world.setLight?.(opts.light ?? 'day');
      root.add(world.object);
    } catch (err) {
      console.warn('camera-study: world layer failed to build', err);
      world = null;
    }
  }
  const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return {
    root, world,
    stats: { triangles: tri(baked.geometry), staticMeshes: 1, dynamicMeshes },
    update(ctx) { world?.update({ ...ctx, map }); },
    dispose() { world?.dispose(); disposables.forEach((d) => d.dispose()); },
  };
}
