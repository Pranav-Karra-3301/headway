import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bakeGeometry } from '../bake';
import {
  BUILDING_TYPES, CAR_VARIANTS, TREE_VARIANTS, makeBuilding, makeBus, makeCar, makePerson, makeStation, makeStop, makeTree,
  partOf,
} from '../kit';
import { DEFAULT_DETAIL, DEFAULT_PALETTE, PALETTES } from '../palettes';

const size = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z, minY: b.min.y, maxY: b.max.y };
};
const partsWithRole = (o: THREE.Object3D, role: string) => {
  const out: THREE.Mesh[] = [];
  o.traverse((c) => { if (c instanceof THREE.Mesh && partOf(c)?.role === role) out.push(c); });
  return out;
};

describe('palettes', () => {
  it('defaults to Wooden Toy with toy detail', () => {
    expect(DEFAULT_PALETTE).toBe('a');
    expect(DEFAULT_DETAIL).toBe('toy');
  });
  it('has 5-6 car colours per palette, distinct from route colours and the bus body', () => {
    for (const p of Object.values(PALETTES)) {
      expect(p.car.length).toBeGreaterThanOrEqual(5);
      expect(p.car.length).toBeLessThanOrEqual(6);
      const taken = new Set([...p.route, p.bus].map((c) => c.toLowerCase()));
      for (const c of p.car) expect(taken.has(c.toLowerCase())).toBe(false);
    }
  });
});

describe('vehicle proportions', () => {
  it('bus is low and long: ~3.3 x 1.25 footprint, ~1.1 tall including wheels', () => {
    const s = size(makeBus(0));
    expect(s.minY).toBeGreaterThanOrEqual(-0.001);
    expect(s.x).toBeGreaterThan(3.2);
    expect(s.x).toBeLessThan(3.45);
    expect(s.z).toBeGreaterThan(1.2);
    expect(s.z).toBeLessThan(1.35);
    expect(s.y).toBeGreaterThan(1.0);
    expect(s.y).toBeLessThan(1.16);
  });
  it('bus body is ~0.8 tall', () => {
    const body = partsWithRole(makeBus(1), 'bus').map(size).sort((a, b) => b.x * b.y * b.z - a.x * a.y * a.z)[0]!;
    expect(body.y).toBeGreaterThan(0.7);
    expect(body.y).toBeLessThan(0.9);
  });
  it('has >= 3 car variants, all clearly smaller and lower than the bus', () => {
    expect(CAR_VARIANTS.length).toBeGreaterThanOrEqual(3);
    const bus = size(makeBus(0));
    for (let v = 0; v < CAR_VARIANTS.length; v++) {
      const s = size(makeCar(v));
      expect(s.minY).toBeGreaterThanOrEqual(-0.001);
      expect(s.x).toBeLessThan(bus.x * 0.7);
      expect(s.y).toBeLessThan(bus.y * 0.9);
      expect(s.z).toBeLessThan(bus.z);
    }
  });
  it('car ~1.7 x 0.85 x 0.7 and van ~2.1 x 0.95 x 0.95', () => {
    const car = size(makeCar(CAR_VARIANTS.indexOf('hatchback')));
    expect(car.x).toBeGreaterThan(1.5); expect(car.x).toBeLessThan(1.9);
    expect(car.z).toBeGreaterThan(0.78); expect(car.z).toBeLessThan(0.95);
    expect(car.y).toBeGreaterThan(0.6); expect(car.y).toBeLessThan(0.78);
    const van = size(makeCar(CAR_VARIANTS.indexOf('van')));
    expect(van.x).toBeGreaterThan(1.95); expect(van.x).toBeLessThan(2.25);
    expect(van.z).toBeGreaterThan(0.88); expect(van.z).toBeLessThan(1.05);
    expect(van.y).toBeGreaterThan(0.88); expect(van.y).toBeLessThan(1.02);
  });
  it('people are ~0.8 tall', () => {
    const s = size(makePerson(0));
    expect(s.y).toBeGreaterThan(0.75);
    expect(s.y).toBeLessThan(0.85);
  });
});

describe('buildings and trees', () => {
  it('has >= 8 building types and every door is ~1.0 tall', () => {
    expect(BUILDING_TYPES.length).toBeGreaterThanOrEqual(8);
    for (const t of BUILDING_TYPES) {
      const g = makeBuilding(t, { wall: 1, roof: 2 });
      const doors = partsWithRole(g, 'door');
      expect(doors.length, t).toBeGreaterThan(0);
      for (const d of doors) {
        const s = size(d);
        expect(s.y, t).toBeGreaterThan(0.85);
        expect(s.y, t).toBeLessThan(1.25);
      }
      expect(size(g).minY, t).toBeGreaterThanOrEqual(-0.001);
    }
  });
  it('has >= 5 tree variants built from primitives', () => {
    expect(TREE_VARIANTS.length).toBeGreaterThanOrEqual(5);
    for (const v of TREE_VARIANTS) {
      const s = size(makeTree(v));
      expect(s.y, v).toBeGreaterThan(0.4);
      expect(s.y, v).toBeLessThan(3.2);
    }
  });
  it('stop and station still build (approved pieces)', () => {
    expect(size(makeStop([0, 1])).y).toBeGreaterThan(2);
    expect(size(makeStation()).x).toBeGreaterThan(9);
  });
});

describe('bakeGeometry', () => {
  it('merges parts into one geometry with colour, glow and tint attributes; detail parts last', () => {
    const { geometry, ranges, baseIndexCount } = bakeGeometry(makeBus(2));
    for (const a of ['position', 'normal', 'color', 'aGlow', 'aTint']) expect(geometry.getAttribute(a), a).toBeTruthy();
    const n = geometry.getAttribute('position').count;
    expect(ranges.reduce((s, r) => s + r.count, 0)).toBe(n);
    expect(geometry.index).toBeTruthy();
    expect(baseIndexCount).toBeGreaterThan(0);
    expect(baseIndexCount).toBeLessThan(geometry.index!.count);
    const firstDetail = ranges.findIndex((r) => r.detail);
    expect(ranges.slice(firstDetail).every((r) => r.detail)).toBe(true);
  });
});
