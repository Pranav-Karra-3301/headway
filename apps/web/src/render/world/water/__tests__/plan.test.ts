// E2 water: pure layout of the lake (beach profile, causeways, marina, point, boats) — no three.js.
import { describe, expect, it } from 'vitest';
import { pointAt, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { worldLayout } from '../../layout';
import { boatPose, BEACH_Y, capsuleDist, LAKE_BED_Y, planWater, WATER_Y, type WaterPlan } from '../plan';

const layout = worldLayout(TOWN);
const plan: WaterPlan = planWater(TOWN, layout);
const b = TOWN.bounds;
const onBoard = (x: number, z: number, m = 0) => x < b.maxX - m && z < b.maxZ - m && x > b.minX + m && z > b.minZ + m;

/** Every gameplay sample: stops + queue lines, platforms + queue lines, road and rail polylines. */
function gameplayPoints(): Vec2[] {
  const out: Vec2[] = [];
  for (const s of TOWN.stops) for (let k = 0; k <= 4; k++) out.push({ x: s.p.x + s.queueDir.x * k * 0.6, z: s.p.z + s.queueDir.z * k * 0.6 });
  for (const s of TOWN.rail.stations) for (let k = 0; k <= 4; k++) out.push({ x: s.platform.x + s.queueDir.x * k * 0.6, z: s.platform.z + s.queueDir.z * k * 0.6 });
  for (const e of TOWN.roads.edges) for (let d = 0; d <= e.path.length; d += 1) out.push(pointAt(e.path, d));
  for (let d = 0; d < TOWN.rail.loop.length; d += 1) out.push(pointAt(TOWN.rail.loop, d));
  return out;
}

describe('beach profile', () => {
  it('sits flush with the board at its edge and slides under the lake at the shoreline', () => {
    for (let x = b.minX; x <= b.maxX; x += 3) {
      expect(plan.shore.ground(x, b.maxZ + 0.01)).toBeCloseTo(BEACH_Y, 1);
      const w = plan.shore.width(plan.shore.along(x, b.maxZ + 1));
      expect(plan.shore.ground(x, b.maxZ + w)).toBeCloseTo(WATER_Y, 2);
      expect(plan.shore.ground(x, b.maxZ + w * 0.5)).toBeGreaterThan(WATER_Y);
      expect(plan.shore.ground(x, b.maxZ + w + 1)).toBeLessThan(WATER_Y);
    }
    for (let z = b.minZ; z <= b.maxZ; z += 3) {
      expect(plan.shore.ground(b.maxX + 0.01, z)).toBeCloseTo(BEACH_Y, 1);
      expect(plan.shore.ground(b.maxX + 9, z)).toBeLessThan(WATER_Y);
    }
  });

  it('is never wider than 4.8 u nor narrower than 3.2 u (the layout reserves a 4 u strip)', () => {
    for (let s = plan.shore.sMin; s <= plan.shore.sMax; s += 0.5) {
      expect(plan.shore.width(s)).toBeGreaterThanOrEqual(3.2);
      expect(plan.shore.width(s)).toBeLessThanOrEqual(4.8);
    }
  });

  it('slopes monotonically down from the board to the lake bed', () => {
    for (const x of [-30, 0, 20]) {
      let prev = Infinity;
      for (let z = b.maxZ; z < b.maxZ + 12; z += 0.25) {
        const y = plan.shore.ground(x, z);
        expect(y).toBeLessThanOrEqual(prev + 1e-9);
        expect(y).toBeGreaterThanOrEqual(LAKE_BED_Y);
        prev = y;
      }
    }
  });

  it('walks the shore continuously around the south-east corner', () => {
    let prev = plan.shore.at(plan.shore.sMin, 0);
    for (let s = plan.shore.sMin + 0.25; s <= plan.shore.sMax; s += 0.25) {
      const p = plan.shore.at(s, 2);
      const q = plan.shore.at(s, 0);
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.3);
      expect(plan.shore.along(p.x, p.z)).toBeCloseTo(s, 4);
      prev = q;
    }
  });

  it('shore distance is negative on land, positive on water, zero at the waterline', () => {
    expect(plan.waterDist(0, 0)).toBeLessThan(-10);
    expect(plan.waterDist(0, b.maxZ + 1)).toBeLessThan(0);
    expect(plan.waterDist(0, b.maxZ + 12)).toBeGreaterThan(5);
    expect(plan.waterDist(b.maxX + 15, 8)).toBeGreaterThan(5);
    const w = plan.shore.width(plan.shore.along(5, b.maxZ + 1));
    expect(Math.abs(plan.waterDist(5, b.maxZ + w))).toBeLessThan(0.05);
    // the lighthouse point is land
    expect(plan.waterDist(plan.point.b.x, plan.point.b.z)).toBeLessThan(0);
  });
});

describe('causeways', () => {
  it('carries every water-side road exit to the diorama edge, aligned with the road', () => {
    const exits = layout.exits.filter((e) => e.kind === 'bridge');
    expect(exits.length).toBeGreaterThan(0);
    expect(plan.bridges.length).toBe(exits.length);
    for (const e of exits) {
      const br = plan.bridges.find((x) => x.edgeId === e.edgeId)!;
      expect(br).toBeTruthy();
      expect(br.from.x).toBeCloseTo(e.p.x, 6);
      expect(br.from.z).toBeCloseTo(e.p.z, 6);
      expect(br.dir.x).toBeCloseTo(e.dir.x, 6);
      expect(br.dir.z).toBeCloseTo(e.dir.z, 6);
      const end = { x: br.from.x + br.dir.x * br.len, z: br.from.z + br.dir.z * br.len };
      const ex = layout.extent;
      const atEdge = Math.abs(end.x - ex.maxX) < 1e-6 || Math.abs(end.z - ex.maxZ) < 1e-6 || Math.abs(end.x - ex.minX) < 1e-6 || Math.abs(end.z - ex.minZ) < 1e-6;
      expect(atEdge).toBe(true);
      expect(br.width).toBeGreaterThanOrEqual(3.2);
    }
  });

  it('stands its piers in open water, evenly spaced, and leaves the beach on an abutment', () => {
    for (const br of plan.bridges) {
      expect(br.piers.length).toBeGreaterThanOrEqual(3);
      for (const at of br.piers) {
        const p = { x: br.from.x + br.dir.x * at, z: br.from.z + br.dir.z * at };
        expect(plan.shore.ground(p.x, p.z)).toBeLessThan(WATER_Y - 0.2);
        expect(at).toBeLessThan(br.len - 0.5);
      }
      for (let i = 1; i < br.piers.length; i++) {
        const gap = br.piers[i]! - br.piers[i - 1]!;
        expect(gap).toBeGreaterThan(3.5);
        expect(gap).toBeLessThan(6);
      }
      expect(br.shoreAt).toBeGreaterThan(2.5);
      expect(br.shoreAt).toBeLessThan(br.piers[0]!);
      expect(br.lamps.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('props', () => {
  it('never puts anything on the town board', () => {
    for (const p of plan.props) {
      const r = Math.max(p.w ?? 1, p.d ?? 1) / 2;
      // nearest point of the prop's footprint must be outside the board (a 0.3 u overlap for things rooted at the edge)
      expect(onBoard(p.x, p.z, -r + 0.3)).toBe(false);
    }
    for (const bt of plan.boats) expect(onBoard(bt.x, bt.z, -2)).toBe(false);
  });

  it('has a lighthouse on the point, a marina with boats, beach huts and causeway lamps', () => {
    const kinds = new Set(plan.props.map((p) => p.kind));
    for (const k of ['lighthouse', 'boathouse', 'hut', 'pierDeck', 'pile', 'lamp', 'rock'] as const) expect(kinds.has(k)).toBe(true);
    const lh = plan.props.find((p) => p.kind === 'lighthouse')!;
    expect(Math.hypot(lh.x - plan.point.b.x, lh.z - plan.point.b.z)).toBeLessThan(1.5);
    expect(plan.boats.filter((x) => x.kind === 'sail' || x.kind === 'motor').length).toBeGreaterThanOrEqual(5);
    expect(plan.boats.some((x) => x.loop)).toBe(true);
    expect(plan.lights.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps tall things from hiding stops, platforms, queue lines, roads or rail from the iso camera', () => {
    const pts = gameplayPoints();
    for (const elevDeg of [30, 35.26, 45]) {
      const reachK = 1 / Math.tan((elevDeg * Math.PI) / 180);
      const back = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }; // camera looks from +x/+z
      for (const p of plan.props) {
        const h = p.h ?? 0;
        if (h < 0.6) continue;
        const reach = h * reachK, r = Math.max(p.w ?? 1, p.d ?? 1) / 2;
        for (const q of pts) {
          const rx = q.x - p.x, rz = q.z - p.z;
          const along = rx * back.x + rz * back.z;
          const across = Math.abs(rx * back.z - rz * back.x);
          const hidden = along > 0 && along < reach && across < r;
          if (hidden) throw new Error(`${p.kind} at ${p.x},${p.z} hides ${q.x.toFixed(1)},${q.z.toFixed(1)} at ${elevDeg}°`);
        }
      }
    }
  });

  it('floats moored boats in the water clear of piers, causeways and each other', () => {
    const moored = plan.boats.filter((x) => !x.loop && !x.follow);
    for (const bt of moored) {
      expect(plan.waterDist(bt.x, bt.z)).toBeGreaterThan(0.6);
      for (const br of plan.bridges) {
        const rx = bt.x - br.from.x, rz = bt.z - br.from.z;
        const across = Math.abs(rx * br.dir.z - rz * br.dir.x);
        expect(across).toBeGreaterThan(br.width / 2 + 1);
      }
    }
    for (let i = 0; i < moored.length; i++) for (let j = i + 1; j < moored.length; j++) {
      const a = moored[i]!, c = moored[j]!;
      expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeGreaterThan(0.9);
    }
  });

  it('sails moving boats on open water, clear of the causeways, the marina and the point', () => {
    for (const bt of plan.boats.filter((x) => x.loop || x.follow)) {
      for (let t = 0; t < 240; t += 0.5) {
        const p = boatPose(plan, bt, t);
        expect(plan.waterDist(p.x, p.z)).toBeGreaterThan(bt.kind === 'duck' || bt.kind === 'duckling' ? 0.6 : 2);
        for (const br of plan.bridges) {
          const rx = p.x - br.from.x, rz = p.z - br.from.z;
          const along = rx * br.dir.x + rz * br.dir.z;
          const across = Math.abs(rx * br.dir.z - rz * br.dir.x);
          if (along > -2 && along < br.len + 2) expect(across).toBeGreaterThan(br.width / 2 + 1.2);
        }
        for (const o of plan.foam) expect(capsuleDist(p, o)).toBeGreaterThan(0.4);
      }
    }
  });

  it('bobs boats gently and turns moving boats along their path', () => {
    const sail = plan.boats.find((x) => x.loop)!;
    const a = boatPose(plan, sail, 0), c = boatPose(plan, sail, 1);
    expect(Math.hypot(c.x - a.x, c.z - a.z)).toBeGreaterThan(0.05);
    expect(Math.hypot(c.x - a.x, c.z - a.z)).toBeLessThan(1.5);
    const fwd = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
    expect(fwd.x * (c.x - a.x) + fwd.z * (c.z - a.z)).toBeGreaterThan(0);
    const moored = plan.boats.find((x) => x.kind === 'sail' && !x.loop)!;
    for (let t = 0; t < 20; t += 0.7) {
      const p = boatPose(plan, moored, t);
      expect(Math.abs(p.roll)).toBeLessThan(0.12);
      expect(Math.abs(p.pitch)).toBeLessThan(0.08);
      expect(Math.abs(p.heave)).toBeLessThan(0.12);
      expect(Math.hypot(p.x - moored.x, p.z - moored.z)).toBeLessThan(0.3);
    }
  });
});
