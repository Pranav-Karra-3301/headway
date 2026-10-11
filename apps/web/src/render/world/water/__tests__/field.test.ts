// E2 water: the shore field the water shader samples (signed shore distance + foam obstacle distance).
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { worldLayout } from '../../layout';
import { buildShoreField, edt2d, sampleField } from '../field';
import { capsuleDist, planWater, WATER_Y } from '../plan';

const layout = worldLayout(TOWN);
const plan = planWater(TOWN, layout);

describe('edt2d', () => {
  it('measures Euclidean distance in cells to the nearest seed', () => {
    const w = 9, h = 7, seed = new Uint8Array(w * h);
    seed[3 * w + 4] = 1;
    seed[0] = 1;
    const d = edt2d(seed, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const want = Math.min(Math.hypot(x - 4, y - 3), Math.hypot(x, y));
      expect(d[y * w + x]).toBeCloseTo(want, 5);
    }
  });
});

describe('shore field', () => {
  const f = buildShoreField(plan, { cell: 0.5 });
  it('covers the whole diorama', () => {
    expect(f.minX).toBeLessThanOrEqual(layout.extent.minX);
    expect(f.minZ).toBeLessThanOrEqual(layout.extent.minZ);
    expect(f.minX + f.w * f.cell).toBeGreaterThanOrEqual(layout.extent.maxX);
    expect(f.minZ + f.h * f.cell).toBeGreaterThanOrEqual(layout.extent.maxZ);
  });
  it('matches the analytic shore distance (negative on land, positive on water)', () => {
    for (const [x, z] of [[0, 40], [10, 33], [50, 5], [-20, 31], [30, -10], [0, 0]] as const) {
      expect(sampleField(f, x, z).shore).toBeCloseTo(plan.waterDist(x, z), 0);
    }
    expect(sampleField(f, 0, 0).shore).toBeLessThan(0);
    expect(sampleField(f, 0, 45).shore).toBeGreaterThan(8);
  });
  it('rings piles, piers and moored hulls with small object distances', () => {
    for (const c of plan.foam.slice(0, 12)) {
      const p = { x: (c.a.x + c.b.x) / 2 + c.r + 0.5, z: (c.a.z + c.b.z) / 2 };
      const want = Math.min(...plan.foam.map((o) => capsuleDist(p, o)));
      expect(sampleField(f, p.x, p.z).objects).toBeCloseTo(want, 0);
    }
    expect(sampleField(f, 12, 50).objects).toBeGreaterThan(2);
  });
  it('wraps the foam around terrain headlands when given their height', () => {
    const head = { x: -50, z: 40, r: 6 };
    const g = buildShoreField(plan, { cell: 0.5, landHeight: (x, z) => (Math.hypot(x - head.x, z - head.z) < head.r ? 1 : WATER_Y - 1) });
    expect(sampleField(g, head.x, head.z).shore).toBeLessThan(-3);
    expect(sampleField(g, head.x + head.r + 2, head.z).shore).toBeCloseTo(2, 0);
    expect(sampleField(f, head.x, head.z).shore).toBeGreaterThan(5);
  });
});
