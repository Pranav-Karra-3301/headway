import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES, CAR_VARIANTS, TREE_VARIANTS, bakeGeometry, buildingSize, createForest, makeBuilding, makeBus, makeCar,
  makeClockTower, makePerson, makeStadium, makeStation, makeStop, makeTree, mergeBaked, partOf, recolorBaked, setBakedDetail,
  type BakeRange,
} from '../kit';
import { clayTweak, KitMaterial, shared } from '../materials';
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
    expect(ranges.reduce((s: number, r: BakeRange) => s + r.count, 0)).toBe(n);
    expect(geometry.index).toBeTruthy();
    expect(baseIndexCount).toBeGreaterThan(0);
    expect(baseIndexCount).toBeLessThan(geometry.index!.count);
    const firstDetail = ranges.findIndex((r: BakeRange) => r.detail);
    expect(ranges.slice(firstDetail).every((r: BakeRange) => r.detail)).toBe(true);
  });
  it('writes palette colours, lit-window glow only, and recolours in place', () => {
    const b = bakeGeometry(makeBuilding('tall', { seed: 3 }), 'a');
    const col = b.geometry.getAttribute('color'), glow = b.geometry.getAttribute('aGlow');
    const wall = b.ranges.find((r) => r.role === 'wall')!;
    const expectA = new THREE.Color(PALETTES.a.wall[0]);
    expect(col.getX(wall.start)).toBeCloseTo(expectA.r, 5);
    const lit = b.ranges.filter((r) => r.role === 'window' && r.idx === 1);
    const dark = b.ranges.filter((r) => r.role === 'window' && r.idx === 0);
    expect(lit.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
    expect(glow.getX(lit[0]!.start) + glow.getY(lit[0]!.start)).toBeGreaterThan(0.1);
    expect(glow.getX(dark[0]!.start) + glow.getY(dark[0]!.start) + glow.getZ(dark[0]!.start)).toBe(0);
    expect(glow.getX(wall.start)).toBe(0);
    recolorBaked(b, 'b');
    expect(col.getX(wall.start)).toBeCloseTo(new THREE.Color(PALETTES.b.wall[0]).r, 5);
  });
  it('detail = min draws only the base parts', () => {
    const b = bakeGeometry(makeBuilding('small'));
    setBakedDetail(b, false);
    expect(b.geometry.drawRange.count).toBe(b.baseIndexCount);
    setBakedDetail(b.geometry, true);
    expect(b.geometry.drawRange.count).toBe(Infinity);
  });
  it('tints car bodies, shirts and tree crowns but not tyres, heads or trunks', () => {
    const tinted = (o: THREE.Object3D, role: string) => bakeGeometry(o).ranges.filter((r) => r.role === role).every((r) => r.tint);
    const untinted = (o: THREE.Object3D, role: string) => bakeGeometry(o).ranges.filter((r) => r.role === role).every((r) => !r.tint);
    for (let v = 0; v < CAR_VARIANTS.length; v++) {
      expect(tinted(makeCar(v), 'car')).toBe(true);
      expect(untinted(makeCar(v), 'tire')).toBe(true);
    }
    expect(tinted(makePerson(2), 'shirt')).toBe(true);
    expect(untinted(makePerson(2), 'skin')).toBe(true);
    expect(tinted(makeTree('round'), 'leaf')).toBe(true);
    expect(tinted(makeTree('pine'), 'pine')).toBe(true);
    expect(untinted(makeTree('round'), 'trunk')).toBe(true);
  });
  it('mergeBaked keeps every base index before every detail index', () => {
    const a = bakeGeometry(makeBus(0)), b = bakeGeometry(makeBuilding('house'));
    const m = mergeBaked([a, b]);
    expect(m.geometry.getAttribute('position').count).toBe(a.geometry.getAttribute('position').count + b.geometry.getAttribute('position').count);
    expect(m.baseIndexCount).toBe(a.baseIndexCount + b.baseIndexCount);
    expect(m.geometry.index!.count).toBe(a.geometry.index!.count + b.geometry.index!.count);
    const off = a.geometry.getAttribute('position').count;
    expect(m.geometry.index!.getX(a.baseIndexCount)).toBe(b.geometry.index!.getX(0) + off);
  });
});

describe('kit pieces', () => {
  it('building footprints are compact and consistent', () => {
    for (const t of BUILDING_TYPES) {
      const s = buildingSize(t);
      expect(s.w, t).toBeGreaterThan(2);
      expect(s.w, t).toBeLessThan(7.5);
      expect(s.d, t).toBeGreaterThan(2);
      expect(s.d, t).toBeLessThan(6.5);
      expect(s.h, t).toBeGreaterThan(1.6);
      expect(s.h, t).toBeLessThan(7.5);
    }
    expect(buildingSize('tall').h).toBeGreaterThan(buildingSize('dorm').h);
    expect(buildingSize('dorm').h).toBeGreaterThan(buildingSize('house').h);
  });
  it('landmarks build, stadium ≈ 10.8 × 8.4', () => {
    expect(size(makeClockTower()).y).toBeGreaterThan(7);
    const st = size(makeStadium());
    expect(st.x).toBeGreaterThan(10.5);
    expect(st.x).toBeLessThan(11.5);
    expect(st.z).toBeGreaterThan(8.2);
    expect(st.z).toBeLessThan(9.2);
  });
  it('createForest makes one InstancedMesh per used variant with per-instance colours', () => {
    const f = createForest([
      { x: 0, z: 0, variant: 'round' }, { x: 2, z: 0, variant: 'round' }, { x: 4, z: 0, variant: 'pine' },
      { x: 6, z: 0, variant: 'bush' }, { x: 8, z: 0, variant: 3 },
    ], { seed: 3 });
    expect(f.meshes.length).toBe(4);
    const round = f.meshes.find((m) => m.name === 'trees:round')!;
    expect(round.count).toBe(2);
    expect(round.instanceColor).toBeTruthy();
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    round.getColorAt(0, c0); round.getColorAt(1, c1);
    expect(c0.equals(c1)).toBe(false);
    f.setPalette('c');
    f.setDetail('min');
    f.dispose();
  });
});

describe('clay material', () => {
  const patch = (src: { vertexShader: string; fragmentShader: string }, kit: boolean) => {
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
    clayTweak(shader as unknown as THREE.WebGLProgramParametersWithUniforms, { kit, sway: true, fade: { value: 0.6 } });
    return shader;
  };
  it('finds every anchor in three\'s standard shader (wrap, glow, tint, fade, rim, sway)', () => {
    const s = patch(THREE.ShaderLib.standard, true);
    expect(s.vertexShader).toContain('mix( vColor.rgb, instanceColor.rgb, aTint )');
    expect(s.vertexShader).toContain('HW_SWAY');
    expect(s.vertexShader).toContain('vHwY = hwW.y');
    expect(s.fragmentShader).toContain('vHwGlow * uDusk');
    expect(s.fragmentShader).toContain('mix( diffuseColor.rgb, uFadeColor, hwFade )');
    expect(s.fragmentShader).toContain('hwRim');
    expect(s.fragmentShader).toContain('hwIrr');
    expect(s.fragmentShader).not.toContain('#include <lights_physical_pars_fragment>');
    expect(s.uniforms.uTime).toBe(shared.uTime);
    expect(s.uniforms.uDusk).toBe(shared.uDusk);
    expect((s.uniforms.uFade as THREE.IUniform).value).toBe(0.6);
  });
  it('non-kit materials keep the standard instance colour multiply', () => {
    const s = patch(THREE.ShaderLib.standard, false);
    expect(s.vertexShader).toContain('#include <color_vertex>');
    expect(s.fragmentShader).toContain('hwRim');
  });
  it('KitMaterial variants get distinct program cache keys', () => {
    const a = new KitMaterial(), b = new KitMaterial({ sway: true });
    expect(a.vertexColors).toBe(true);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    a.fade.value = 0.6;
    expect(b.fade.value).toBe(0);
  });
});
