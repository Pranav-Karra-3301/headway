// Owner: T2.3. The traffic RenderLayer without WebGL: draw-call budget, instance updates, tint colours, highlight
// fade, palette switches, sim-time stepping and the bus/train poses it derives from snapshots.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TOWN, pointAt } from '@headway/sim';
import type { SimSnapshot, VehicleView } from '@headway/sim';
import type { SimRunner } from '../../../sim/runner';
import { frame } from '../../../state/frame';
import type { FrameContext } from '../../layers';
import { PALETTES } from '../../palettes';
import { MAX_CARS, ROAD_TOP, createTrafficLayer, vehiclePoses } from '../index';

const vehicle = (id: string, kind: 'bus' | 'train', dist: number, state: VehicleView['state'] = 'moving'): VehicleView => ({
  id, kind, routeId: kind === 'bus' ? 'r1' : null, path: kind === 'bus' ? { kind: 'route', routeId: 'r1' } : { kind: 'rail' }, dist,
  state, onboard: 0, capacity: 40, nextStopId: null, holdUntil: null, lastDecision: null,
});
const snap = (t: number, vehicles: VehicleView[]): SimSnapshot => ({
  t, phase: 'running', vehicles, people: [], queues: [], events: [],
  running: { spawned: 0, completed: 0, waitingNow: 0, ridingNow: 0, meanWaitS: 0, missedConnections: 0, leftBehind: 0, jSoFar: 0 },
});
const ctx = (prev: SimSnapshot, next: SimSnapshot, alpha: number, over: Partial<FrameContext> = {}): FrameContext => ({
  prev, next, alpha, simT: prev.t + (next.t - prev.t) * alpha, dtS: 1 / 60, timeS: 0, map: TOWN,
  camera: new THREE.OrthographicCamera(), light: 'day', highlightedRoute: null, ...over,
});
const meshes = (o: THREE.Object3D) => o.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);

describe('vehiclePoses', () => {
  it('puts buses right of their route centreline and interpolates the train across the loop seam', () => {
    const r1 = TOWN.routes.find((r) => r.id === 'r1')!;
    const L = TOWN.rail.loop.length;
    const a = snap(10, [vehicle('b1', 'bus', 20), vehicle('t1', 'train', L - 1)]);
    const b = snap(11, [vehicle('b1', 'bus', 22, 'dwelling'), vehicle('t1', 'train', 1)]);
    const { buses, trainDist } = vehiclePoses(TOWN, a, b, 0.5);
    expect(buses).toHaveLength(1);
    const c = pointAt(r1.path, 21);
    const off = Math.hypot(buses[0]!.x - c.x, buses[0]!.z - c.z);
    expect(off).toBeCloseTo(0.55, 2);
    const right = { x: Math.sin(c.heading), z: Math.cos(c.heading) };
    expect((buses[0]!.x - c.x) * right.x + (buses[0]!.z - c.z) * right.z).toBeGreaterThan(0.5);
    expect(buses[0]!.stopped).toBe(true);
    expect(trainDist).toBeCloseTo(0, 6);
  });
});

describe('createTrafficLayer', () => {
  it('draws every car with ≤ 3 instanced meshes on the road, tinted from the palette `car` role', () => {
    const layer = createTrafficLayer(TOWN, { seed: 4, kenney: false });
    expect(layer.name).toBe('traffic');
    expect(layer.cars).toBe('kit');
    const ms = meshes(layer.object);
    expect(ms.length).toBeLessThanOrEqual(3);
    expect(layer.object.position.y).toBeCloseTo(ROAD_TOP);
    const s0 = snap(0, []), s1 = snap(1, []);
    layer.update(ctx(s0, s1, 0.5));
    layer.update(ctx(s0, s1, 1));
    const drawn = ms.reduce((n, m) => n + m.count, 0);
    expect(drawn).toBe(layer.model.cars.filter((c) => c.scale > 0.001).length);
    expect(drawn).toBeGreaterThanOrEqual(14);
    expect(drawn).toBeLessThanOrEqual(MAX_CARS);
    for (const m of ms) {
      expect(m.material).toBe(ms[0]!.material);
      expect(m.instanceColor).toBeTruthy();
      expect((m.geometry.getAttribute('aTint').array as Float32Array).some((v) => v > 0.5)).toBe(true);
      const glow = m.geometry.getAttribute('aGlow').array as Float32Array;
      expect(glow.some((v) => v > 0)).toBe(true); // headlights / tail lights glow at dusk
    }
    const palette = new Set(PALETTES.a.car.map((h) => new THREE.Color(h).getHexString()));
    const m = ms.find((x) => x.count > 0)!;
    const c = new THREE.Color();
    m.getColorAt(0, c);
    expect(palette.has(c.getHexString())).toBe(true);
    const mat = new THREE.Matrix4(), p = new THREE.Vector3();
    m.getMatrixAt(0, mat);
    p.setFromMatrixPosition(mat);
    expect(Math.abs(p.x)).toBeLessThan(40);
    expect(Math.abs(p.z)).toBeLessThan(30);
    layer.dispose();
  });

  it('moves cars in sim time (frozen while the sim is paused) and fades with a highlighted route', () => {
    const layer = createTrafficLayer(TOWN, { seed: 9, kenney: false });
    const where = () => layer.model.cars.map((c) => `${c.x},${c.z}`).join('|');
    const s = snap(100, []);
    frame.runner = { paused: true, sim: { observe: () => { throw new Error('no observation'); } } } as unknown as SimRunner;
    try {
      layer.update(ctx(s, s, 1));
      const frozen = where();
      for (let i = 0; i < 30; i++) layer.update(ctx(s, s, 1, { highlightedRoute: 'r2' }));
      expect(where()).toBe(frozen); // a sim is running but its time did not advance
    } finally {
      frame.runner = null;
    }
    const idle = where();
    layer.update(ctx(s, s, 1));
    expect(where()).not.toBe(idle); // no sim at all (static town): cars idle along in real time
    const before = where();
    const mat = meshes(layer.object)[0]!.material as THREE.Material & { fade: { value: number } };
    expect(mat.fade.value).toBeGreaterThan(0.4);
    const a = snap(100, []), b = snap(101, []);
    layer.update(ctx(a, b, 0.5));
    layer.update(ctx(a, b, 1));
    expect(layer.model.cars.map((c) => `${c.x},${c.z}`).join('|')).not.toBe(before);
    for (let i = 0; i < 60; i++) layer.update(ctx(b, b, 1));
    expect(mat.fade.value).toBeLessThan(0.05);
    layer.dispose();
  });

  it('recolours on palette switch and honours an explicit stadium closing time', () => {
    const layer = createTrafficLayer(TOWN, { seed: 2, kenney: false, closingT: 600 });
    expect(layer.model.closingT).toBe(600);
    layer.setPalette?.('c');
    const s0 = snap(0, []), s1 = snap(1, []);
    layer.update(ctx(s0, s1, 1));
    expect(layer.model.closingT).toBe(600);
    const m = meshes(layer.object).find((x) => x.count > 0)!;
    const c = new THREE.Color();
    m.getColorAt(0, c);
    expect(new Set(PALETTES.c.car.map((h) => new THREE.Color(h).getHexString())).has(c.getHexString())).toBe(true);
    layer.setClosingT(null);
    expect(layer.model.closingT).toBeNull();
    layer.dispose();
  });
});
