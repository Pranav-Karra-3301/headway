// Owner: G2. Outer-neighbourhood plan: deterministic, everything on dressable land, nothing on roads / rail / the
// bay / the ridge / the highway band / the board, buildings never overlap, street furniture only on sidewalks.
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { cellOf, greaterGrid, KERB, roadAt, type Rect } from '../../grid';
import { rectInside, rectsOverlap } from '../frame';
import { planGreaterBlocks } from '../plan';

const g = greaterGrid(TOWN);
const plan = planGreaterBlocks(TOWN);
const blockById = new Map(g.blocks.map((b) => [b.id, b]));
const useOf = (x: number, z: number) => {
  const { c, r } = cellOf(g, x, z);
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.use[r]![c]! : null;
};

describe('greater blocks plan', () => {
  it('is deterministic', () => {
    // a fresh map object bypasses the memo
    const again = planGreaterBlocks({ ...TOWN });
    expect(again.items.length).toBe(plan.items.length);
    expect(JSON.stringify(again.items.slice(0, 50))).toBe(JSON.stringify(plan.items.slice(0, 50)));
    expect(again.lots.length).toBe(plan.lots.length);
  });

  it('dresses a lively town (houses, shops, works, trees, parks, poles, lights)', () => {
    const count = (f: (k: string) => boolean) => plan.items.filter((i) => f(i.kind)).length;
    expect(count((k) => k.startsWith('kn.house.'))).toBeGreaterThanOrEqual(30);
    expect(count((k) => k.startsWith('kn.shop.'))).toBeGreaterThanOrEqual(10);
    expect(count((k) => k.startsWith('kn.works.'))).toBeGreaterThanOrEqual(6);
    expect(count((k) => k.startsWith('veg.') && k !== 'veg.hedge' && k !== 'veg.flowerbed')).toBeGreaterThanOrEqual(120);
    expect(count((k) => k === 'kn.prop.powerPole')).toBeGreaterThanOrEqual(10);
    expect(count((k) => k.includes('traffic-light'))).toBeGreaterThanOrEqual(3);
    expect(count((k) => k === 'kn.prop.streetLight')).toBeGreaterThanOrEqual(12);
    expect(count((k) => k === 'kn.car.random')).toBeGreaterThanOrEqual(15);
    expect(plan.lines.every((l) => l.length >= 2)).toBe(true);
  });

  it('leaves waterfront blocks to G3', () => {
    for (const b of g.blocks) if (b.zone === 'waterfront') expect(plan.styles[b.id]).toBe('skip');
    const skipped = new Set(g.blocks.filter((b) => plan.styles[b.id] === 'skip').map((b) => b.id));
    expect(plan.items.some((i) => skipped.has(i.block))).toBe(false);
  });

  it('keeps block items inside their block, on free cells only', () => {
    for (const it of plan.items) {
      if (it.role === 'street') continue;
      const b = blockById.get(it.block);
      expect(b, it.block).toBeTruthy();
      const R = b!.rect;
      expect(it.x >= R.minX && it.x <= R.maxX && it.z >= R.minZ && it.z <= R.maxZ, `${it.kind} @ ${it.x},${it.z} outside ${b!.id}`).toBe(true);
      expect(useOf(it.x, it.z), `${it.kind} @ ${it.x},${it.z}`).toBe('free');
      if (it.fp) expect(rectInside(it.fp, R, 0.12), `${it.kind} footprint leaves ${b!.id}`).toBe(true);
    }
    for (const l of plan.lots) {
      const cx = (l.rect.minX + l.rect.maxX) / 2, cz = (l.rect.minZ + l.rect.maxZ) / 2;
      expect(useOf(cx, cz), `${l.kind} lot`).toBe('free');
    }
  });

  it('never overlaps buildings, cars and solid props', () => {
    const solid = plan.items.filter((i) => i.fp && !i.y);
    const shrink = (r: Rect, d: number): Rect => ({ minX: r.minX + d, maxX: r.maxX - d, minZ: r.minZ + d, maxZ: r.maxZ - d });
    const clashes: string[] = [];
    for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) {
      const A = solid[a]!, B = solid[b]!;
      if (rectsOverlap(shrink(A.fp!, 0.04), shrink(B.fp!, 0.04))) clashes.push(`${A.kind}@${A.x},${A.z} × ${B.kind}@${B.x},${B.z}`);
    }
    expect(clashes).toEqual([]);
  });

  it('puts street furniture on road-tile sidewalks, never on the carriageway', () => {
    const street = plan.items.filter((i) => i.role === 'street');
    expect(street.length).toBeGreaterThan(10);
    for (const it of street) {
      const { c, r } = cellOf(g, it.x, it.z);
      const t = roadAt(g, c, r);
      expect(t, `${it.kind} @ ${it.x},${it.z} not on a road tile`).toBeTruthy();
      // distance to the nearest lane centreline must clear the carriageway
      let best = Infinity;
      for (const s of g.streets) for (const pl of s.paths) {
        const P = pl.points;
        for (let k = 0; k + 1 < P.length; k++) {
          const a = P[k]!, b = P[k + 1]!;
          const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
          const t2 = Math.max(0, Math.min(1, ((it.x - a.x) * dx + (it.z - a.z) * dz) / L2));
          best = Math.min(best, Math.hypot(a.x + dx * t2 - it.x, a.z + dz * t2 - it.z));
        }
      }
      expect(best, `${it.kind} @ ${it.x},${it.z}`).toBeGreaterThan(KERB.carriage);
    }
  });

  it('keeps camera-side blocks low (south / east of the board)', () => {
    const B = TOWN.bounds;
    for (const it of plan.items) {
      if (it.role !== 'building') continue;
      const b = blockById.get(it.block)!;
      const camSide = b.rect.minX >= B.maxX - 0.01 || b.rect.minZ >= B.maxZ - 0.01;
      if (camSide) expect(['kn.house.bungalow', 'kn.house.modern', 'kn.house.ranch', 'kn.shop.low', 'kn.shop.wide', 'kn.shop.small', 'kn.works.shed', 'res.playground']).toContain(it.kind);
    }
  });
});
