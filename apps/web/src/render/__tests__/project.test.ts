// Owner: T2.2. Pure renderer helpers (no WebGL): snapshot interpolation, queue slots, scenery composition.
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { approach, lerpDist, queueSlot, simTimeAt, stopFrame, walkAt } from '../dynamic/interp';
import { composeScenery, inRegion } from '../town/compose';
import { SCENERY } from '../scenery';
import type { DistrictScenery } from '../districts/types';
import { createStaticTown } from '../town/index';

describe('lerpDist', () => {
  it('interpolates forward along a path', () => {
    expect(lerpDist(10, 20, 0, 100, true)).toBeCloseTo(10);
    expect(lerpDist(10, 20, 0.5, 100, true)).toBeCloseTo(15);
    expect(lerpDist(10, 20, 1, 100, true)).toBeCloseTo(20);
  });
  it('wraps on closed paths (short way forward across the seam)', () => {
    expect(lerpDist(95, 5, 0.5, 100, true)).toBeCloseTo(0);
    expect(lerpDist(98, 4, 0.25, 100, true)).toBeCloseTo(99.5);
    expect(lerpDist(98, 4, 0.75, 100, true)).toBeCloseTo(2.5);
    const v = lerpDist(99, 1, 0.9, 100, true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(100);
  });
  it('never wraps on open paths and clamps to the path', () => {
    expect(lerpDist(10, 20, 0.5, 30, false)).toBeCloseTo(15);
    expect(lerpDist(25, 5, 0.5, 30, false)).toBeCloseTo(15);
    expect(lerpDist(28, 40, 1, 30, false)).toBeCloseTo(30);
  });
  it('is safe on degenerate paths', () => {
    expect(lerpDist(3, 4, 0.5, 0, true)).toBe(0);
  });
});

describe('queueSlot', () => {
  const p = { x: 4, z: -2 };
  const dir = { x: 0, z: 1 };
  it('puts slot 0 just off the stop along queueDir and grows the line along queueDir', () => {
    const s0 = queueSlot(p, dir, 0);
    const s1 = queueSlot(p, dir, 1);
    expect(s0.x).toBeCloseTo(4);
    expect(s0.z).toBeGreaterThan(p.z);
    expect(s1.z).toBeGreaterThan(s0.z);
    expect(s1.x).toBeCloseTo(s0.x);
  });
  it('starts a parallel line after perRow slots and keeps every slot distinct', () => {
    const opts = { spacing: 0.4, perRow: 5, rowGap: 0.45, offset: 0.8 };
    const pts = Array.from({ length: 40 }, (_, i) => queueSlot(p, dir, i, opts));
    expect(pts[5]!.x).not.toBeCloseTo(4);
    expect(pts[5]!.z).toBeCloseTo(pts[0]!.z);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThan(0.3);
    for (const q of pts) expect((q.x - p.x) * dir.x + (q.z - p.z) * dir.z).toBeGreaterThanOrEqual(0.8 - 1e-9);
  });
  it('puts extra rows on one side by default, on the other with side -1, and alternates with side 0', () => {
    const o = { perRow: 2 };
    const left = queueSlot(p, dir, 2, o), right = queueSlot(p, dir, 2, { ...o, side: -1 as const });
    expect(Math.sign(left.x - p.x)).toBe(-Math.sign(right.x - p.x));
    const alt = [2, 4, 6].map((i) => queueSlot(p, dir, i, { ...o, side: 0 as const }).x - p.x);
    expect(Math.sign(alt[0]!)).toBe(-Math.sign(alt[1]!));
    expect(Math.abs(alt[2]!)).toBeGreaterThan(Math.abs(alt[0]!));
  });
});

describe('walkAt', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 10, z: -4 };
  it('interpolates a straight walk over [t0, t1] and clamps outside it', () => {
    expect(walkAt(from, to, 100, 110, 90)).toEqual({ x: 0, z: 0 });
    expect(walkAt(from, to, 100, 110, 105)).toEqual({ x: 5, z: -2 });
    expect(walkAt(from, to, 100, 110, 200)).toEqual({ x: 10, z: -4 });
    expect(walkAt(from, to, 100, 100, 100)).toEqual({ x: 10, z: -4 });
  });
});

describe('simTimeAt / approach', () => {
  it('interpolates sim time between snapshots', () => {
    expect(simTimeAt(10, 12, 0.5)).toBeCloseTo(11);
    expect(simTimeAt(10, 10, 0.3)).toBe(10);
  });
  it('eases toward a target and snaps when far away', () => {
    const a = approach({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.1, 10, 3);
    expect(a.x).toBeGreaterThan(0.5);
    expect(a.x).toBeLessThan(1);
    expect(approach({ x: 0, z: 0 }, { x: 9, z: 0 }, 0.016, 10, 3)).toEqual({ x: 9, z: 0 });
  });
});

describe('stopFrame', () => {
  it('faces the kit stop toward the road and keeps its shelter clear of the queue line', () => {
    for (const s of TOWN.stops) {
      const f = stopFrame(s.p, s.queueDir);
      // local +z of the model (sin rot, cos rot) points back toward the road (−queueDir)
      expect(Math.sin(f.rot) * s.queueDir.x + Math.cos(f.rot) * s.queueDir.z).toBeCloseTo(-1);
      // the queue line (slot centres) stays ≥ 1.2 u from the shelter's centre line
      for (let i = 0; i < 6; i++) {
        const q = queueSlot(s.p, s.queueDir, i);
        const dx = q.x - f.x, dz = q.z - f.z;
        const lateral = Math.abs(dx * Math.cos(f.rot) - dz * Math.sin(f.rot));
        expect(lateral).toBeGreaterThanOrEqual(1.2);
      }
    }
  });
});

describe('composeScenery', () => {
  const empty = (id: DistrictScenery['id']): DistrictScenery => ({ id, region: { center: { x: 0, z: 0 }, radius: 0 }, items: [], paths: [], areas: [] });
  it('keeps every base item when no district provides items', () => {
    const c = composeScenery(SCENERY, [empty('campus'), empty('downtown')]);
    expect(c.base.length).toBe(SCENERY.length);
    expect(c.items.length).toBe(0);
  });
  it('drops base items inside a district region that has items, but always keeps stations', () => {
    const campus: DistrictScenery = {
      ...empty('campus'),
      region: { center: { x: -13.5, z: -8 }, radius: 10.5 },
      items: [{ kind: 'lm.clockTower', x: -10.5, z: -9 }],
    };
    const c = composeScenery(SCENERY, [campus]);
    expect(c.base.some((i) => i.kind === 'clockTower')).toBe(false);
    expect(c.base.filter((i) => i.kind === 'station').length).toBe(3);
    expect(c.items).toEqual(campus.items);
    for (const i of c.base) if (i.kind !== 'station') expect(inRegion(campus.region, i)).toBe(false);
  });
  it('marks a station platform-only when a district places a station building next to it', () => {
    const stadium: DistrictScenery = { ...empty('stadium'), region: { polygon: [{ x: 100, z: 100 }, { x: 101, z: 100 }, { x: 101, z: 101 }] }, items: [] };
    const st = SCENERY.find((i) => i.kind === 'station' && i.stationId === 'stn_central')!;
    stadium.items.push({ kind: 'lm.stationCentral', x: st.x - 2, z: st.z });
    const c = composeScenery(SCENERY, [stadium]);
    expect(c.platformOnly.has('stn_central')).toBe(true);
    expect(c.platformOnly.has('stn_university')).toBe(false);
    expect(c.owned.size).toBe(0);
  });
  it('marks stations inside an active district region as owned (no kit building, no kit clock)', () => {
    const st = SCENERY.find((i) => i.kind === 'station' && i.stationId === 'stn_stadium')!;
    const d: DistrictScenery = { ...empty('stadium'), region: { center: { x: st.x, z: st.z }, radius: 3 }, items: [{ kind: 'st.bench', x: st.x + 1, z: st.z - 4 }] };
    const c = composeScenery(SCENERY, [d]);
    expect(c.owned.has('stn_stadium')).toBe(true);
    expect(c.platformOnly.has('stn_stadium')).toBe(true);
    expect(c.base.some((i) => i.kind === 'station' && i.stationId === 'stn_stadium')).toBe(true);
  });
  it('handles polygon regions', () => {
    const sq = { polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }] };
    expect(inRegion(sq, { x: 5, z: 5 })).toBe(true);
    expect(inRegion(sq, { x: 15, z: 5 })).toBe(false);
  });
});

describe('createStaticTown (geometry only, no WebGL)', () => {
  it('composes the whole static town within the draw-call budget with a pickable mesh per stop', () => {
    const town = createStaticTown(TOWN, { palette: 'a', detail: 'toy' });
    let draws = 0;
    town.object.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) draws++; });
    expect(draws).toBeLessThan(80);
    expect(town.stops.map((s) => s.id).sort()).toEqual(TOWN.stops.map((s) => s.id).sort());
    for (const s of town.stops) expect(s.mesh.userData.pick).toEqual({ kind: 'stop', id: s.id });
    expect(town.stats.items).toBeGreaterThan(100);
    town.setPalette('c');
    town.setHighlight('r1');
    town.update(1);
    expect(town.stops.find((s) => !s.routes.includes('r1'))!.material.fade.value).toBeGreaterThan(0.3);
    town.dispose();
  });
});
