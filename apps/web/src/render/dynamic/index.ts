// Owner: T2.2. The dynamic layer (spec §10): buses and the 2-car train positioned by `pointAt` on their paths with
// `dist` interpolated between snapshots (loop wrap), people as two InstancedMeshes (body tinted by shirt, head)
// walking by t0/t1, waiting in queue slots along `queueDir`, a 1 s walk-to-door when they board, a 3 s fade when
// they arrive; selection (raise + glow + ground ring), route highlight (other vehicles fade) and picking.
// Draw calls: one per bus, 2 train cars, 2 people meshes, 1 selection ring (≤ 11 with 6 buses).
import * as THREE from 'three';
import { deadheadPath, pointAt } from '@headway/sim';
import type { PersonView, Polyline, QueuePlace, RouteId, SimEvent, SimSnapshot, TownMap, Vec2, VehicleView } from '@headway/sim';
import { bakeGeometry, BUS, makeBus, makePersonBody, makePersonHead, makeTrainCar, PERSON, recolorBaked, setBakedDetail, TRAIN, type Baked } from '../kit';
import { addInstanceFade, KitMaterial } from '../materials';
import { colorOf, PALETTES } from '../palettes';
import type { DetailMode, PaletteId, Pick } from '../types';
import { LANE_OFFSET, ROAD } from '../town/network';
import { spaceBuses, type BusSlot } from './busSpacing';
import { stopFrame, approach, crowdWalkAt, lerpDist, PLATFORM_QUEUE, queueSlot, queueVisible, STOP_QUEUE, type QueueSlotOptions } from './interp';

export interface DynamicFrame {
  prev: SimSnapshot;
  next: SimSnapshot;
  alpha: number;
  simT: number;
  dtS: number;
  timeS: number;
}

export interface DynamicLayer {
  readonly object: THREE.Group;
  update(f: DynamicFrame): void;
  /** Raycast / screen-space pick. `ndc` in [-1, 1]; `toScreen` maps world → CSS px relative to the canvas. */
  pick(ndc: THREE.Vector2, camera: THREE.Camera, cssX: number, cssY: number, toScreen: (v: THREE.Vector3) => { x: number; y: number }): Pick | null;
  select(p: Pick | null): void;
  setHighlight(route: RouteId | null): void;
  setPalette(p: PaletteId): void;
  setDetail(d: DetailMode): void;
  /** Current world position of a pickable (vehicles, people; stops are static), or null. */
  positionOf(p: Pick): THREE.Vector3 | null;
  stats(): { buses: number; people: number; drawCalls: number };
  dispose(): void;
}

const ROUTE_IDX: Record<RouteId, number> = { r1: 0, r2: 1, r3: 2 };
const FADE_OTHER = 0.6;
const BOARD_WALK_S = 0.9;
const ARRIVE_FADE_S = 3;
const SPAWN_POP_S = 0.25;
const PERSON_PICK_PX = 11;

interface VehicleState { mesh: THREE.Mesh; material: KitMaterial; route: RouteId | null; raise: number; x: number; z: number; heading: number }
interface PersonState { x: number; z: number; y: number; seen: number; born: number; tint: number }
interface Ghost { id: number; x: number; z: number; tint: number; vehicleId: string; start: number; place: QueuePlace | null }
interface Rect { x: number; z: number; cos: number; sin: number; hw: number; hd: number; y: number }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();

function pathKey(v: VehicleView): string {
  const p = v.path;
  return p.kind === 'route' ? `r:${p.routeId}` : p.kind === 'deadhead' ? `d:${p.from}>${p.to}` : 'rail';
}

/** Rounded-rectangle outline (w × d outer, `t` thick) lying flat, for the selection ring. */
function ringGeometry(w: number, d: number, t: number): THREE.BufferGeometry {
  const r = Math.min(w, d) / 2;
  const rr = (s: THREE.Shape | THREE.Path, hw: number, hd: number, rad: number, ccw: boolean) => {
    const rd = Math.max(0.01, Math.min(rad, hw, hd));
    if (ccw) {
      s.moveTo(-hw + rd, -hd); s.lineTo(hw - rd, -hd); s.absarc(hw - rd, -hd + rd, rd, -Math.PI / 2, 0, false);
      s.lineTo(hw, hd - rd); s.absarc(hw - rd, hd - rd, rd, 0, Math.PI / 2, false);
      s.lineTo(-hw + rd, hd); s.absarc(-hw + rd, hd - rd, rd, Math.PI / 2, Math.PI, false);
      s.lineTo(-hw, -hd + rd); s.absarc(-hw + rd, -hd + rd, rd, Math.PI, Math.PI * 1.5, false);
    } else {
      s.moveTo(-hw + rd, -hd); s.absarc(-hw + rd, -hd + rd, rd, Math.PI * 1.5, Math.PI, true);
      s.lineTo(-hw, hd - rd); s.absarc(-hw + rd, hd - rd, rd, Math.PI, Math.PI / 2, true);
      s.lineTo(hw - rd, hd); s.absarc(hw - rd, hd - rd, rd, Math.PI / 2, 0, true);
      s.lineTo(hw, -hd + rd); s.absarc(hw - rd, -hd + rd, rd, 0, -Math.PI / 2, true);
    }
  };
  const shape = new THREE.Shape();
  rr(shape, w / 2, d / 2, r, true);
  const hole = new THREE.Path();
  rr(hole, w / 2 - t, d / 2 - t, r - t, false);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 12);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function createDynamicLayer(map: TownMap, opts: { palette: PaletteId; detail: DetailMode }): DynamicLayer {
  let palette = opts.palette;
  let detail = opts.detail;
  const object = new THREE.Group();
  object.name = 'town:dynamic';
  const bakes: Baked[] = [];
  const bake = (o: THREE.Object3D) => { const b = bakeGeometry(o, palette); bakes.push(b); setBakedDetail(b, detail === 'toy'); return b; };

  // ---------------------------------------------------------------- shared geometry
  const busGeo = new Map<number, Baked>();
  const busBaked = (route: RouteId | null) => {
    const i = route ? ROUTE_IDX[route] ?? 0 : 0;
    let b = busGeo.get(i);
    if (!b) { b = bake(makeBus(i)); busGeo.set(i, b); }
    return b;
  };
  const trainFront = bake(makeTrainCar(true));
  const trainRear = bake(makeTrainCar(false));
  const bodyB = bake(makePersonBody());
  const headB = bake(makePersonHead());

  // ---------------------------------------------------------------- places, paths, platform heights
  const routePath = new Map<RouteId, Polyline>(map.routes.map((r) => [r.id, r.path]));
  const deadheads = new Map<string, Polyline>();
  const pathOf = (v: VehicleView): Polyline | null => {
    const p = v.path;
    if (p.kind === 'route') return routePath.get(p.routeId) ?? null;
    if (p.kind === 'rail') return map.rail.loop;
    const k = `${p.from}>${p.to}`;
    let pl = deadheads.get(k);
    if (!pl) {
      try { pl = deadheadPath(map, p.from, p.to); } catch { return null; }
      deadheads.set(k, pl);
    }
    return pl;
  };
  const places = new Map<string, { p: Vec2; dir: Vec2; opts: QueueSlotOptions }>();
  for (const s of map.stops) places.set(`stop:${s.id}`, { p: s.p, dir: s.queueDir, opts: STOP_QUEUE });
  for (const s of map.rail.stations) places.set(`platform:${s.id}`, { p: s.platform, dir: s.queueDir, opts: PLATFORM_QUEUE });
  const placeKey = (q: QueuePlace) => `${q.kind}:${q.id}`;
  // raised surfaces people stand on: station platforms (kit: 9 × 2.4 at local z −0.2, 0.55 tall) and stop pads
  const rects: Rect[] = [];
  for (const st of map.rail.stations) {
    const d = map.rail.loop;
    const pt = pointAt(d, st.dist);
    // platform centre: from the rail toward the platform queue point, 1.75 − (−0.2) = 1.95 in
    const nx = st.platform.x - pt.x, nz = st.platform.z - pt.z;
    const ax = Math.cos(pt.heading), az = -Math.sin(pt.heading); // along-track unit
    const along = nx * ax + nz * az;
    let ix = nx - ax * along, iz = nz - az * along;
    const il = Math.hypot(ix, iz) || 1; ix /= il; iz /= il;
    rects.push({ x: pt.x + ix * 1.95, z: pt.z + iz * 1.95, cos: ax, sin: az, hw: 4.5, hd: 1.2, y: 0.55 });
  }
  for (const s of map.stops) {
    const f = stopFrame(s.p, s.queueDir);
    rects.push({ x: f.x, z: f.z, cos: Math.cos(f.rot), sin: -Math.sin(f.rot), hw: 1.8, hd: 0.9, y: 0.12 });
  }
  const groundY = (x: number, z: number): number => {
    let y = 0;
    for (const r of rects) {
      const dx = x - r.x, dz = z - r.z;
      const u = dx * r.cos + dz * r.sin, w = -dx * r.sin + dz * r.cos;
      if (Math.abs(u) <= r.hw && Math.abs(w) <= r.hd && r.y > y) y = r.y;
    }
    return y;
  };

  // ---------------------------------------------------------------- vehicles
  const buses = new Map<string, VehicleState>();
  const trainMat = new KitMaterial();
  const trainCars = [new THREE.Mesh(trainFront.geometry, trainMat), new THREE.Mesh(trainRear.geometry, trainMat)];
  for (const m of trainCars) { m.castShadow = m.receiveShadow = true; m.visible = false; m.name = 'train'; object.add(m); }
  const trainState = { raise: 0, x: 0, z: 0, heading: 0 };

  const ensureBus = (v: VehicleView): VehicleState => {
    const route = v.routeId ?? (v.path.kind === 'deadhead' ? v.path.to : null);
    let b = buses.get(v.id);
    if (!b) {
      const material = new KitMaterial();
      const mesh = new THREE.Mesh(busBaked(route).geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.name = `bus:${v.id}`;
      mesh.userData.pick = { kind: 'bus', id: v.id };
      object.add(mesh);
      b = { mesh, material, route, raise: 0, x: 0, z: 0, heading: 0 };
      buses.set(v.id, b);
      applyFade(b);
    } else if (b.route !== route) {
      b.route = route;
      b.mesh.geometry = busBaked(route).geometry;
      applyFade(b);
    }
    return b;
  };

  // ---------------------------------------------------------------- people
  let capacity = 0;
  let bodies: THREE.InstancedMesh | null = null;
  let heads: THREE.InstancedMesh | null = null;
  let bodyFade: THREE.InstancedBufferAttribute | null = null;
  let headFade: THREE.InstancedBufferAttribute | null = null;
  const peopleMat = new KitMaterial({ instanceFade: true });
  const ensureCapacity = (n: number) => {
    if (n <= capacity) return;
    let cap = Math.max(512, capacity);
    while (cap < n) cap *= 2;
    for (const m of [bodies, heads]) if (m) { object.remove(m); m.dispose(); }
    // body and head have their own baked geometry, so each mesh gets its own iFade attribute (replaced on growth)
    bodies = new THREE.InstancedMesh(bodyB.geometry, peopleMat, cap);
    heads = new THREE.InstancedMesh(headB.geometry, peopleMat, cap);
    for (const m of [bodies, heads]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0; m.name = 'people'; object.add(m); }
    bodies.setColorAt(0, tmpC.set('#ffffff'));
    bodyFade = addInstanceFade(bodies);
    headFade = addInstanceFade(heads);
    capacity = cap;
  };
  ensureCapacity(512);
  const shirt = (tint: number) => colorOf(PALETTES[palette], 'shirt', tint);
  const people = new Map<number, PersonState>();
  const ghosts: Ghost[] = [];
  let frameNo = 0;
  let lastNext: SimSnapshot | null = null;
  /** World positions of what was drawn this frame, for screen-space picking. */
  const drawn: Array<{ id: number; x: number; y: number; z: number }> = [];

  // ---------------------------------------------------------------- selection + highlight
  let selected: Pick | null = null;
  let highlight: RouteId | null = null;
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTES[palette].accent, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.BufferGeometry(), ringMat);
  ring.renderOrder = 2;
  ring.visible = false;
  ring.name = 'selection';
  object.add(ring);
  const fadeGoal = new Map<KitMaterial, number>();
  function applyFade(b: VehicleState): void {
    fadeGoal.set(b.material, highlight && b.route !== highlight ? FADE_OTHER : 0);
  }
  const setRing = (p: Pick | null) => {
    ring.geometry.dispose();
    if (!p) { ring.visible = false; ring.geometry = new THREE.BufferGeometry(); return; }
    const size = p.kind === 'bus' ? [BUS.length + 0.7, BUS.width + 0.7, 0.16]
      : p.kind === 'train' ? [TRAIN.pitch + TRAIN.carLength + 0.8, TRAIN.width + 0.8, 0.18]
      : p.kind === 'stop' ? [4.6, 2.8, 0.16] : [0.7, 0.7, 0.1];
    ring.geometry = ringGeometry(size[0]!, size[1]!, size[2]!);
    ring.visible = true;
  };

  // ---------------------------------------------------------------- per frame
  const vehicleById = new Map<string, VehicleView>();
  const update = (f: DynamicFrame) => {
    frameNo++;
    const { prev, next, alpha, simT, dtS, timeS } = f;
    const kf = 1 - Math.exp(-Math.max(0, dtS) * 8);
    for (const [mat, goal] of fadeGoal) mat.fade.value += (goal - mat.fade.value) * kf;
    trainMat.fade.value += ((highlight ? FADE_OTHER : 0) - trainMat.fade.value) * kf;

    // vehicles
    const prevById = new Map<string, VehicleView>();
    for (const v of prev.vehicles) prevById.set(v.id, v);
    vehicleById.clear();
    const seenBus = new Set<string>();
    let trainSeen = false;
    const busSlots: BusSlot[] = [];
    for (const v of next.vehicles) {
      if (v.kind === 'train') continue;
      const path = pathOf(v);
      if (!path || path.points.length < 2) continue;
      const pv = prevById.get(v.id);
      busSlots.push({ id: v.id, path, dist: pv && pathKey(pv) === pathKey(v) ? lerpDist(pv.dist, v.dist, alpha, path.length, path.closed) : v.dist });
    }
    const spaced = spaceBuses(busSlots, BUS.length, LANE_OFFSET); // bunched buses queue on screen instead of overlapping
    for (const v of next.vehicles) {
      vehicleById.set(v.id, v);
      const path = pathOf(v);
      if (!path || path.points.length === 0) continue;
      const pv = prevById.get(v.id);
      const dist = spaced.get(v.id) ?? (pv && pathKey(pv) === pathKey(v) ? lerpDist(pv.dist, v.dist, alpha, path.length, path.closed) : v.dist);
      if (v.kind === 'train') {
        trainSeen = true;
        const sel = selected?.kind === 'train' && selected.id === v.id;
        trainState.raise += ((sel ? 0.14 : 0) - trainState.raise) * kf;
        const half = TRAIN.pitch / 2;
        [dist + half, dist - half].forEach((d, i) => {
          const p = pointAt(path, d);
          const car = trainCars[i]!;
          car.position.set(p.x, TRAIN.deckY + trainState.raise, p.z);
          car.rotation.y = p.heading;
          car.visible = true;
          car.userData.pick = { kind: 'train', id: v.id };
        });
        const c = pointAt(path, dist);
        trainState.x = c.x; trainState.z = c.z; trainState.heading = c.heading;
        trainMat.emissive.set(sel ? PALETTES[palette].accent : '#000000').multiplyScalar(sel ? 0.18 : 0);
        continue;
      }
      const b = ensureBus(v);
      seenBus.add(v.id);
      const p = pointAt(path, dist);
      const rx = Math.sin(p.heading), rz = Math.cos(p.heading); // right-hand side of travel
      const sel = selected?.kind === 'bus' && selected.id === v.id;
      b.raise += ((sel ? 0.14 : 0) - b.raise) * kf;
      b.x = p.x + rx * LANE_OFFSET; b.z = p.z + rz * LANE_OFFSET; b.heading = p.heading;
      b.mesh.position.set(b.x, ROAD.top + b.raise, b.z);
      b.mesh.rotation.y = p.heading;
      b.mesh.visible = true;
      b.material.emissive.set(sel ? PALETTES[palette].accent : '#000000').multiplyScalar(sel ? 0.2 : 0);
    }
    for (const [id, b] of buses) if (!seenBus.has(id)) b.mesh.visible = false;
    if (!trainSeen) for (const c of trainCars) c.visible = false;

    // boarding ghosts from this snapshot's events
    if (next !== lastNext) {
      for (const e of next.events as SimEvent[]) {
        if (e.kind !== 'board') continue;
        const st = people.get(e.personId);
        // only riders drawn last frame walk to the door (hidden queue overflow just boards)
        if (!st || frameNo - st.seen > 2) continue;
        ghosts.push({ id: e.personId, x: st.x, z: st.z, tint: st.tint, vehicleId: e.vehicleId, start: timeS, place: e.at });
      }
      lastNext = next;
    }

    // people
    const list = next.people;
    ensureCapacity(list.length + ghosts.length + 1);
    const B = bodies!, H = heads!, bf = bodyFade!.array as Float32Array, hf = headFade!.array as Float32Array;
    let n = 0;
    drawn.length = 0;
    const put = (id: number, x: number, y: number, z: number, scale: number, fade: number, tint: number) => {
      tmpQ.identity();
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(scale, scale, scale));
      B.setMatrixAt(n, tmpM);
      H.setMatrixAt(n, tmpM);
      B.setColorAt(n, tmpC.set(shirt(tint)));
      bf[n] = fade; hf[n] = fade;
      drawn.push({ id, x, y: y + PERSON.height * 0.5 * scale, z });
      n++;
    };
    for (const pv of list as PersonView[]) {
      let target: Vec2 | null = null;
      let rate = 12, walking = false, fade = 0, scale = 1;
      if (pv.state === 'walking' && pv.from && pv.to) {
        target = crowdWalkAt(pv.from, pv.to, pv.t0 ?? simT, pv.t1 ?? simT, simT, pv.id);
        walking = simT < (pv.t1 ?? simT);
        rate = 14;
      } else if (pv.state === 'waiting' && pv.at) {
        if (!queueVisible(pv.slot)) continue; // long queues compress; the marker shows the full count
        const pl = places.get(placeKey(pv.at));
        if (pl) target = queueSlot(pl.p, pl.dir, pv.slot ?? 0, pl.opts);
        rate = 5;
      } else if (pv.state === 'arrived' && pv.to) {
        target = pv.to;
        const t0 = pv.t0 ?? simT, t1 = pv.t1 ?? t0 + ARRIVE_FADE_S;
        const k = t1 > t0 ? Math.min(1, Math.max(0, (simT - t0) / (t1 - t0))) : 1;
        fade = k;
        scale = 1 - Math.max(0, (k - 0.55) / 0.45);
        if (scale <= 0.02) continue;
      }
      if (!target) continue;
      let st = people.get(pv.id);
      if (!st || frameNo - st.seen > 2) {
        st = { x: target.x, z: target.z, y: groundY(target.x, target.z), seen: frameNo, born: timeS, tint: pv.tint };
        people.set(pv.id, st);
      } else {
        const a = approach(st, target, dtS, rate, 3.5);
        st.x = a.x; st.z = a.z;
      }
      st.seen = frameNo;
      st.tint = pv.tint;
      st.y += (groundY(st.x, st.z) - st.y) * (1 - Math.exp(-Math.max(0, dtS) * 14));
      const pop = Math.min(1, (timeS - st.born) / SPAWN_POP_S);
      const bob = walking ? Math.abs(Math.sin(timeS * 15.7 + pv.id * 1.3)) * 0.055 : Math.max(0, Math.sin(timeS * 2.1 + pv.id)) * 0.012;
      put(pv.id, st.x, st.y + bob, st.z, scale * (0.35 + 0.65 * pop), fade, pv.tint);
    }
    // ghosts: walk to the vehicle door, then vanish
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const g = ghosts[i]!;
      const k = (timeS - g.start) / BOARD_WALK_S;
      const v = vehicleById.get(g.vehicleId);
      if (k >= 1 || !v) { ghosts.splice(i, 1); continue; }
      let door: Vec2;
      if (v.kind === 'train') {
        door = { x: trainState.x, z: trainState.z };
        // step toward the nearer car's side facing the ghost
        const dx = g.x - door.x, dz = g.z - door.z, L = Math.hypot(dx, dz) || 1;
        door = { x: door.x + (dx / L) * 0.75, z: door.z + (dz / L) * 0.75 };
      } else {
        const b = buses.get(v.id);
        if (!b) { ghosts.splice(i, 1); continue; }
        const fx = Math.cos(b.heading), fz = -Math.sin(b.heading), rx = Math.sin(b.heading), rz = Math.cos(b.heading);
        door = { x: b.x + fx * 1.2 + rx * (BUS.width / 2 + 0.15), z: b.z + fz * 1.2 + rz * (BUS.width / 2 + 0.15) };
      }
      const e = k * k * (3 - 2 * k);
      const x = g.x + (door.x - g.x) * e, z = g.z + (door.z - g.z) * e;
      const s = 1 - Math.max(0, (k - 0.7) / 0.3);
      put(g.id, x, groundY(x, z) + Math.abs(Math.sin(timeS * 15.7 + g.id)) * 0.05, z, Math.max(0.05, s), 0, g.tint);
    }
    B.count = n; H.count = n;
    B.instanceMatrix.needsUpdate = true; H.instanceMatrix.needsUpdate = true;
    if (B.instanceColor) B.instanceColor.needsUpdate = true;
    bodyFade!.needsUpdate = true; headFade!.needsUpdate = true;
    if (frameNo % 120 === 0) for (const [id, st] of people) if (frameNo - st.seen > 240) people.delete(id);

    // selection ring
    if (selected) {
      const at = positionOfPick(selected);
      if (at) {
        ring.visible = true;
        ring.position.set(at.x, (selected.kind === 'person' ? groundY(at.x, at.z) : selected.kind === 'stop' ? 0.13 : ROAD.top) + 0.03, at.z);
        ring.rotation.y = selected.kind === 'bus' ? buses.get(selected.id)?.heading ?? 0
          : selected.kind === 'train' ? trainState.heading
          : selected.kind === 'stop' ? stopRot(selected.id) : 0;
        ringMat.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(timeS * 4));
      } else ring.visible = false;
    }
  };

  const stopRot = (id: string): number => {
    const s = map.stops.find((x) => x.id === id);
    return s ? stopFrame(s.p, s.queueDir).rot : 0;
  };

  function positionOfPick(p: Pick): THREE.Vector3 | null {
    if (p.kind === 'bus') { const b = buses.get(p.id); return b && b.mesh.visible ? new THREE.Vector3(b.x, ROAD.top, b.z) : null; }
    if (p.kind === 'train') return trainCars[0]!.visible ? new THREE.Vector3(trainState.x, TRAIN.deckY, trainState.z) : null;
    if (p.kind === 'stop') {
      const s = map.stops.find((x) => x.id === p.id);
      if (!s) return null;
      const f = stopFrame(s.p, s.queueDir);
      // centre the ring between the shelter and its queue line
      const mx = (f.x + s.p.x + s.queueDir.x * 0.95) / 2, mz = (f.z + s.p.z + s.queueDir.z * 0.95) / 2;
      return new THREE.Vector3(mx, 0.12, mz);
    }
    const id = Number(p.id);
    const d = drawn.find((q) => q.id === id);
    if (d) return new THREE.Vector3(d.x, d.y, d.z);
    const st = people.get(id);
    return st && frameNo - st.seen <= 2 ? new THREE.Vector3(st.x, st.y, st.z) : null;
  }

  const raycaster = new THREE.Raycaster();
  return {
    object,
    update,
    pick(ndc, camera, cssX, cssY, toScreen) {
      raycaster.setFromCamera(ndc, camera);
      const vehicles: THREE.Object3D[] = [...[...buses.values()].map((b) => b.mesh).filter((m) => m.visible), ...trainCars.filter((c) => c.visible)];
      const hit = raycaster.intersectObjects(vehicles, false)[0];
      if (hit?.object.userData.pick) return { ...(hit.object.userData.pick as Pick) };
      let best: { id: number; d: number } | null = null;
      for (const q of drawn) {
        const s = toScreen(tmpP.set(q.x, q.y, q.z));
        const d = Math.hypot(s.x - cssX, s.y - cssY);
        if (d <= PERSON_PICK_PX && (!best || d < best.d)) best = { id: q.id, d };
      }
      return best ? { kind: 'person', id: String(best.id) } : null;
    },
    select(p) {
      selected = p ? { ...p } : null;
      setRing(selected);
    },
    setHighlight(route) {
      highlight = route;
      for (const b of buses.values()) applyFade(b);
    },
    setPalette(p) {
      palette = p;
      for (const b of bakes) recolorBaked(b, p);
      ringMat.color.set(PALETTES[p].accent);
    },
    setDetail(d) {
      detail = d;
      for (const b of bakes) setBakedDetail(b, d === 'toy');
    },
    positionOf: positionOfPick,
    stats: () => ({ buses: [...buses.values()].filter((b) => b.mesh.visible).length, people: bodies?.count ?? 0, drawCalls: buses.size + 2 + 2 + 1 }),
    dispose() {
      for (const b of bakes) b.geometry.dispose();
      for (const m of [bodies, heads]) m?.dispose();
      for (const b of buses.values()) b.material.dispose();
      trainMat.dispose();
      peopleMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      object.clear();
    },
  };
}
