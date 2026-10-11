// Owner: S1 streetscape. Sidewalks + curbs along every road edge (rounded curb corners at junctions, clear of the
// rail and inside the board), zebra crossings at the junctions nearest the stops, district paths as footpaths and
// areas as lawn / plaza / parking / sports / garden surfaces, all merged into one kit-material mesh.
// Geometry is checked by casting rays straight down onto the built mesh (front faces only, so winding counts too).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pointAt, projectOnPolyline, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import type { DistrictScenery, GroundArea } from '../districts/types';
import { buildStreetscape, createStreetscapeLayer, STREETSCAPE } from '../streetscape';
import { okL, resolveRole } from '../streetscape/roles';
import { type Palette, PALETTES } from '../palettes';

const S = STREETSCAPE;
const H = S.roadHalf;
const W = S.walk;
const EPS = 0.006;

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] =>
  [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

/** Paths and one area of every kind, all inside TOWN blocks (clear of roads and sidewalks). */
const FIXTURE: DistrictScenery = {
  id: 'campus',
  region: { center: { x: -10, z: -7 }, radius: 10 },
  items: [],
  paths: [
    { points: [{ x: -15, z: -11 }, { x: -6, z: -4 }], width: 0.8, kind: 'footpath' },
    { points: [{ x: -15, z: -4 }, { x: -6, z: -11 }], width: 0.8, kind: 'footpath' },
    { points: [{ x: -10.5, z: -12.8 }, { x: -10.5, z: -11.0 }], width: 0.8, kind: 'footpath' },
  ],
  areas: [
    { kind: 'lawn', polygon: rect(-16, -12, -5, -3) },
    { kind: 'plaza', polygon: rect(1, -5.5, 9, -2.6) },
    { kind: 'parking', polygon: rect(1, 9.2, 9, 12.2) },
    { kind: 'sports', polygon: rect(-23, 3, -16, 8) },
    { kind: 'garden', polygon: rect(-14, 9, -10, 12) },
  ],
};

const plain = buildStreetscape(TOWN, []);
const full = buildStreetscape(TOWN, [FIXTURE]);
const probe = (geometry: THREE.BufferGeometry) => {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  /** Top of the streetscape at (x, z); 0 = bare board (nothing hit). */
  return (x: number, z: number): number => {
    rc.set(new THREE.Vector3(x, 3, z), down);
    const hit = rc.intersectObject(mesh, false)[0];
    return hit ? hit.point.y : 0;
  };
};
const topPlain = probe(plain.baked.geometry);
const topFull = probe(full.baked.geometry);

const edgeDist = (p: Vec2, skip?: string): number =>
  Math.min(...TOWN.roads.edges.filter((e) => e.id !== skip).map((e) => projectOnPolyline(e.path, p).d));
const railDist = (p: Vec2): number => projectOnPolyline(TOWN.rail.loop, p).d;
const b = TOWN.bounds;
const inBoard = (p: Vec2, m: number) => p.x > b.minX + m && p.x < b.maxX - m && p.z > b.minZ + m && p.z < b.maxZ - m;

describe('streetscape layer', () => {
  it('is one merged kit-material mesh with the kit vertex attributes', () => {
    const layer = createStreetscapeLayer(TOWN, [FIXTURE]);
    expect(layer.name).toBe('streetscape');
    const meshes: THREE.Mesh[] = [];
    layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes.length).toBeLessThanOrEqual(2);
    for (const n of ['position', 'normal', 'color', 'aGlow', 'aTint']) expect(meshes[0]!.geometry.getAttribute(n), n).toBeTruthy();
    expect(meshes[0]!.receiveShadow).toBe(true);
    layer.dispose();
  });

  it('recolours in place for every palette', () => {
    const layer = createStreetscapeLayer(TOWN, [FIXTURE]);
    let mesh: THREE.Mesh | undefined;
    layer.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) mesh ??= o as THREE.Mesh; });
    const col = () => Array.from((mesh!.geometry.getAttribute('color').array as Float32Array).slice(0, 600));
    const a = col();
    layer.setPalette?.('b');
    const bb = col();
    layer.setPalette?.('c');
    const c = col();
    expect(bb).not.toEqual(a);
    expect(c).not.toEqual(bb);
    layer.setPalette?.('a');
    expect(col()).toEqual(a);
    layer.dispose();
  });

  it('builds with stub districts and stays on the board', () => {
    const stub: DistrictScenery = { id: 'outskirts', region: { center: { x: 0, z: 0 }, radius: 0 }, items: [], paths: [], areas: [] };
    const s = buildStreetscape(TOWN, [stub]);
    const box = new THREE.Box3().setFromBufferAttribute(s.baked.geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(box.min.x).toBeGreaterThanOrEqual(b.minX - 0.01);
    expect(box.max.x).toBeLessThanOrEqual(b.maxX + 0.01);
    expect(box.min.z).toBeGreaterThanOrEqual(b.minZ - 0.01);
    expect(box.max.z).toBeLessThanOrEqual(b.maxZ + 0.01);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(box.max.y).toBeLessThan(0.2);
  });

  it('is deterministic and cheap', () => {
    const again = buildStreetscape(TOWN, [FIXTURE]);
    const p1 = full.baked.geometry.getAttribute('position').array as Float32Array;
    const p2 = again.baked.geometry.getAttribute('position').array as Float32Array;
    expect(p2.length).toBe(p1.length);
    let d = 0;
    for (let i = 0; i < p1.length; i += 97) d = Math.max(d, Math.abs(p1[i]! - p2[i]!));
    expect(d).toBe(0);
    expect(full.stats.triangles).toBeLessThan(60_000);
    expect(full.stats.ms).toBeLessThan(2500);
  });
});

describe('sidewalks and curbs', () => {
  it('runs a sidewalk along both sides of every road edge', () => {
    const misses: string[] = [];
    let checked = 0;
    for (const e of TOWN.roads.edges) {
      for (let d = 0.5; d < e.path.length - 0.5; d += 1.25) {
        const p = pointAt(e.path, d), q = pointAt(e.path, d + 0.05);
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const n = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
        for (const side of [-1, 1]) {
          const s = { x: p.x + n.x * side * (H + W / 2), z: p.z + n.z * side * (H + W / 2) };
          if (!inBoard(s, 0.6) || edgeDist(s, e.id) < H + W + 0.6 || railDist(s) < S.railClear + W) continue;
          checked++;
          const y = topPlain(s.x, s.z);
          if (Math.abs(y - S.walkTop) > EPS) misses.push(`${e.id}@${d.toFixed(1)}${side > 0 ? 'L' : 'R'}: ${y.toFixed(3)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(250);
    expect(misses).toEqual([]);
  });

  it('keeps the carriageway at road level and puts the curb on the road edge', () => {
    const bad: string[] = [];
    for (const e of TOWN.roads.edges) {
      for (let d = 0.3; d < e.path.length; d += 1.1) {
        const p = pointAt(e.path, d), q = pointAt(e.path, d + 0.05);
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const n = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
        for (const off of [0, -(H - 0.05), H - 0.05]) {
          const s = { x: p.x + n.x * off, z: p.z + n.z * off };
          if (!inBoard(s, 0.05)) continue;
          const y = topPlain(s.x, s.z);
          if (y > S.markTop + 0.002) bad.push(`${e.id}@${d.toFixed(1)}/${off.toFixed(2)}: ${y.toFixed(3)}`);
        }
        for (const off of [-(H + 0.07), H + 0.07]) {
          const s = { x: p.x + n.x * off, z: p.z + n.z * off };
          if (!inBoard(s, 0.6) || edgeDist(s, e.id) < H + W + 0.6 || railDist(s) < S.railClear + 0.3) continue;
          if (Math.abs(projectOnPolyline(e.path, s).d - Math.abs(off)) > 0.01) continue; // inside of a tight bend
          const y = topPlain(s.x, s.z);
          if (Math.abs(y - S.walkTop) > EPS) bad.push(`curb ${e.id}@${d.toFixed(1)}/${off.toFixed(2)}: ${y.toFixed(3)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('grooves paving joints across the sidewalks', () => {
    expect(full.stats.joints).toBeGreaterThan(150);
  });

  it('rounds the curb at every corner of a crossroads', () => {
    const j = TOWN.roads.nodes.find((n) => n.id === 'j_main_atherton')!.p;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const cut = topPlain(j.x + sx * (H + 0.06), j.z + sz * (H + 0.06));
      expect(cut, `corner ${sx},${sz} fillet`).toBeLessThan(S.walkTop - 0.02);
      expect(topPlain(j.x + sx * (H + S.cornerR * 0.8), j.z + sz * (H + S.cornerR * 0.8)), `corner ${sx},${sz}`).toBeCloseTo(S.walkTop, 2);
      expect(topPlain(j.x + sx * (H + W * 0.9), j.z + sz * (H + W * 0.9)), `corner ${sx},${sz} back`).toBeCloseTo(S.walkTop, 2);
    }
  });

  it('keeps the rail and its ballast clear of sidewalks', () => {
    const bad: string[] = [];
    const rail = TOWN.rail.loop;
    for (let d = 0; d < rail.length; d += 0.8) {
      const p = pointAt(rail, d), q = pointAt(rail, d + 0.05);
      const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const n = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
      for (const off of [0, -0.9, 0.9]) {
        const y = topPlain(p.x + n.x * off, p.z + n.z * off);
        if (y > S.walkTop - 0.02) bad.push(`${d.toFixed(1)}/${off}: ${y.toFixed(3)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('reports walking-surface heights that match the geometry', () => {
    const pts: Vec2[] = [
      { x: -9, z: -1.7 }, { x: 3.5, z: 1.7 }, { x: 22.6 - 1.7, z: 3.4 }, // sidewalks at three stops
      { x: -10.5, z: -7.5 }, { x: -15.5, z: -7.5 }, { x: 5, z: -4 }, { x: -33, z: -10 }, // path, lawn, plaza, board
    ];
    for (const p of pts) expect(full.heightAt(p.x, p.z), `${p.x},${p.z}`).toBeCloseTo(topFull(p.x, p.z), 2);
    expect(full.heightAt(-9, 0)).toBe(0); // the road itself belongs to the composer
  });
});

describe('zebra crossings', () => {
  it('marks the junctions nearest every stop', () => {
    expect(full.crossings.length).toBeGreaterThanOrEqual(8);
    for (const s of TOWN.stops) {
      const near = Math.min(...full.crossings.map((c) => Math.hypot(c.x - s.p.x, c.z - s.p.z)));
      expect(near, s.id).toBeLessThan(13);
    }
  });

  it('lies across the road just outside the junction, stripes on top of the road', () => {
    for (const c of full.crossings) {
      const e = TOWN.roads.edges.find((x) => x.id === c.edge)!;
      const node = TOWN.roads.nodes.find((n) => n.id === c.node)!.p;
      expect(projectOnPolyline(e.path, c).d, c.edge).toBeLessThan(0.05);
      const from = Math.hypot(c.x - node.x, c.z - node.z);
      expect(from).toBeGreaterThan(H);
      expect(from).toBeLessThan(H + W + 1.6);
      expect(topPlain(c.x, c.z), `${c.node}/${c.edge}`).toBeCloseTo(S.markTop, 3);
    }
  });
});

describe('district paths and areas', () => {
  it('turns district paths into footpaths that run into the sidewalk', () => {
    expect(topFull(-10.5, -7.5)).toBeCloseTo(S.heights.footpath, 3); // where the two diagonals cross
    expect(topFull(-13.5, -9.83)).toBeCloseTo(S.heights.footpath, 3);
    expect(topFull(-10.5, -11.8)).toBeCloseTo(S.heights.footpath, 3); // spur from the North Rd sidewalk
    expect(topFull(-10.5, -12.75)).toBeCloseTo(S.walkTop, 3);
    expect(topFull(-13.5 - 0.75, -9.83 + 0.95)).toBeCloseTo(S.heights.lawn, 3); // beside the path
    expect(topPlain(-10.5, -7.5)).toBe(0);
  });

  it('surfaces every area kind at its own height', () => {
    const at = (a: GroundArea) => {
      const xs = a.polygon.map((p) => p.x), zs = a.polygon.map((p) => p.z);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    };
    const areas = FIXTURE.areas;
    expect(topFull(-15.5, -7.5)).toBeCloseTo(S.heights.lawn, 3);
    for (const a of areas.filter((x) => x.kind !== 'lawn')) {
      const c = at(a);
      const y = topFull(c.x + 0.37, c.z + 0.23); // off-centre: clear of centre lines / spots
      const want = S.heights[a.kind];
      expect(y, a.kind).toBeGreaterThanOrEqual(want - 0.002);
      expect(y, a.kind).toBeLessThanOrEqual(want + S.paintTop + 0.002);
    }
  });

  it('paints parking bays and sports lines', () => {
    expect(full.stats.parkingBays).toBeGreaterThanOrEqual(6);
    expect(full.stats.sportsLines).toBeGreaterThanOrEqual(4);
    expect(plain.stats.parkingBays).toBe(0);
  });

  it('plants big gardens as allotment rows and small ones as flowerbeds', () => {
    expect(full.stats.gardenRows).toBe(0); // the FIXTURE garden (12 u²) is a flowerbed
    const allot = buildStreetscape(TOWN, [{ ...FIXTURE, paths: [], areas: [{ kind: 'garden', polygon: rect(-16, -12, -5, -3) }] }]);
    expect(allot.stats.gardenRows).toBeGreaterThanOrEqual(8);
    const y = probe(allot.baked.geometry);
    expect(y(-10.5, -7.5)).toBeGreaterThanOrEqual(S.heights.garden - 0.002);
    expect(y(-10.5, -7.5)).toBeLessThanOrEqual(S.heights.garden + 0.06);
  });

  it('lays plazas in a flagstone checker', () => {
    // FIXTURE plaza is 8 × 2.9 u: ~7 × 2 flags of ~1.1 u, every other one in the lighter tone
    expect(full.stats.plazaFlags).toBeGreaterThanOrEqual(5);
    expect(plain.stats.plazaFlags).toBe(0);
  });
});

describe('paving reads against the road (value contrast)', () => {
  const L = (role: string, p: Palette) => okL(resolveRole(role, 0, p)!);
  const cases = (['a', 'b', 'c'] as const).flatMap((id) => [false, true].map((cream) => [id, cream] as const));
  it.each(cases)('palette %s (cream road: %s): sidewalk, zebra, plaza and curb line each read', (id, cream) => {
    // also check the other road look, so a palette change in either direction keeps the streets readable
    const p: Palette = cream ? { ...PALETTES[id], road: '#F4EBDD' } : { ...PALETTES[id], road: '#515566' };
    const road = okL(p.road);
    expect(Math.abs(L('ssWalk', p) - road)).toBeGreaterThanOrEqual(0.06);
    expect(Math.abs(L('ssZebra', p) - road)).toBeGreaterThanOrEqual(0.08);
    expect(Math.abs(L('ssPlaza', p) - road)).toBeGreaterThanOrEqual(0.03);
    expect(Math.abs(L('ssCurb', p) - L('ssWalk', p))).toBeGreaterThanOrEqual(0.05);
    expect(Math.abs(L('ssLine', p) - L('ssLot', p))).toBeGreaterThanOrEqual(0.12);
  });
  it('matches the live palette', () => {
    for (const id of ['a', 'b', 'c'] as const) {
      const p = PALETTES[id];
      expect(Math.abs(L('ssZebra', p) - okL(p.road)), id).toBeGreaterThanOrEqual(0.08);
    }
  });
});
