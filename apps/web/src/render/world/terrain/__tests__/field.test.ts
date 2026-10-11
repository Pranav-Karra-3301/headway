// Owner: E1. Terrain field contract: the board stays flat and readable (no terrain over roads, stops, platforms,
// queue lines or open rail), the rail-tunnel spur really covers the train, every tunnel has portals, Nittany Ridge
// reaches 18–22 u behind low foothills, and the lake beyond the headlands stays open water.
import { describe, expect, it } from 'vitest';
import { pointAt, RAIL_SPANS, TOWN } from '@headway/sim';
import { worldLayout } from '../../layout';
import { createTerrainField, RAIL_PORTAL, ROAD_PORTAL, WATER_LEVEL } from '../field';

const layout = worldLayout(TOWN);
const f = createTerrainField(TOWN, layout);
const B = TOWN.bounds;
const E = layout.extent;
const inBoard = (x: number, z: number) => x > B.minX + 1e-6 && x < B.maxX - 1e-6 && z > B.minZ + 1e-6 && z < B.maxZ - 1e-6;
/** Terrain visible above the board/ground at (x, z)? */
const covered = (x: number, z: number) => !f.cut(x, z) && f.region(x, z) >= 0 && f.height(x, z) > 0.02;

describe('terrain field: the board stays playable', () => {
  it('keeps the board flat except the rail-tunnel spur on the west strip', () => {
    for (let x = B.minX + 0.25; x < B.maxX; x += 0.5) {
      for (let z = B.minZ + 0.25; z < B.maxZ; z += 0.5) {
        if (x < -27 && z > -15 && z < 11) continue; // the spur
        expect(covered(x, z), `(${x}, ${z})`).toBe(false);
      }
    }
  });

  it('never covers a road on the board (incl. kerbs)', () => {
    for (const e of TOWN.roads.edges) {
      const pts = e.path.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, c = pts[i + 1]!, len = Math.hypot(c.x - a.x, c.z - a.z);
        const tx = (c.x - a.x) / (len || 1), tz = (c.z - a.z) / (len || 1);
        for (let s = 0; s <= len; s += 0.25) {
          for (const o of [-1.5, -0.75, 0, 0.75, 1.5]) {
            const x = a.x + tx * s - tz * o, z = a.z + tz * s + tx * o;
            if (!inBoard(x, z)) continue;
            expect(covered(x, z), `${e.id} at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
          }
        }
      }
    }
  });

  it('never covers stops, platforms or their queue lines', () => {
    const places = [
      ...TOWN.stops.map((s) => ({ p: s.p, dir: s.queueDir })),
      ...TOWN.rail.stations.map((s) => ({ p: s.platform, dir: s.queueDir })),
    ];
    for (const { p, dir } of places) {
      for (let r = 0; r <= 2; r += 0.5) for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        expect(covered(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r)).toBe(false);
      }
      for (let s = 0; s <= 4; s += 0.25) expect(covered(p.x + dir.x * s, p.z + dir.z * s)).toBe(false);
    }
  });

  it('keeps the rail open outside the tunnels and buries it (train + crust) inside', () => {
    const L = TOWN.rail.loop.length;
    const inside = (d: number, m: number) => f.tunnels.some((t) => d > t.fromDist - m && d < t.toDist + m);
    let roofs = 0;
    for (let d = 0; d < L; d += 0.25) {
      const p = pointAt(TOWN.rail.loop, d);
      const nx = -Math.sin(p.heading), nz = -Math.cos(p.heading); // perpendicular to the heading (cos h, -sin h)
      for (const o of [-1.1, -0.68, 0, 0.68, 1.1]) {
        const x = p.x + nx * o, z = p.z + nz * o;
        // margins: a skew portal (facade along the board edge, track at an angle) moves the mouth by up to ~1 u
        if (inside(d, -1.5) && Math.abs(o) <= 0.7) {
          roofs++;
          expect(f.height(x, z), `tunnel roof at d=${d.toFixed(2)} o=${o}`).toBeGreaterThan(2.4);
        } else if (!inside(d, 1.2)) {
          expect(covered(x, z), `open rail at d=${d.toFixed(2)} o=${o}`).toBe(false);
        }
      }
    }
    expect(roofs).toBeGreaterThan(100);
  });
});

describe('terrain field: tunnels and portals', () => {
  it('covers the layout span, growing only over off-board ground (the whole run through the ridge is underground)', () => {
    const rt = layout.railTunnel!;
    expect([rt.fromDist, rt.toDist]).toEqual(RAIL_SPANS.tunnel);
    expect(f.tunnels.length).toBeGreaterThanOrEqual(1);
    const total = f.tunnels.reduce((a, t) => a + (t.toDist - t.fromDist), 0);
    expect(total).toBeGreaterThan(0.5 * (rt.toDist - rt.fromDist));
    for (const t of f.tunnels) {
      expect(t.toDist - t.fromDist).toBeGreaterThanOrEqual(2.4);
      for (let d = t.fromDist + 0.05; d < t.toDist; d += 0.25) {
        if (d >= rt.fromDist && d <= rt.toDist) continue;
        const p = pointAt(TOWN.rail.loop, d);
        expect(p.x < B.minX || p.z < B.minZ, `grown tunnel on the board at d=${d.toFixed(2)}`).toBe(true);
      }
    }
    // no off-board rail on the mountain sides is left open (it would be buried by the foothills)
    for (let d = 0; d < TOWN.rail.loop.length; d += 0.5) {
      const p = pointAt(TOWN.rail.loop, d);
      const mountainSide = (p.x < B.minX - 0.5 || p.z < B.minZ - 0.5) && p.x < B.maxX && p.z < B.maxZ;
      // (a portal sits up to ~2.5 u in from the board edge, square to the track: an open forecourt in front of it)
      if (mountainSide) expect(f.tunnels.some((t) => d >= t.fromDist - 2.5 && d <= t.toDist + 2.5), `open rail in the ridge at d=${d}`).toBe(true);
    }
  });

  it('has a rail portal at both ends of every tunnel, square to the track, off the board, lit by lamps', () => {
    const rail = f.portals.filter((p) => p.kind === 'rail');
    expect(rail).toHaveLength(f.tunnels.length * 2);
    for (const t of f.tunnels) {
      for (const [d, sign] of [[t.fromDist, -1], [t.toDist, 1]] as const) {
        const p = pointAt(TOWN.rail.loop, d);
        const portal = rail.find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.05);
        expect(portal, `portal at d=${d}`).toBeTruthy();
        const tx = Math.cos(p.heading) * sign, tz = -Math.sin(p.heading) * sign;
        expect(portal!.face.x * tx + portal!.face.z * tz, `${portal!.id} square to the track`).toBeGreaterThan(0.999);
        expect(portal!.x <= B.minX + 1e-6 || portal!.z <= B.minZ + 1e-6, `${portal!.id} off the board`).toBe(true);
        expect(portal!.half).toBe(RAIL_PORTAL.half);
        // the facade stands wholly off the board, and the hill behind it is facade-high
        for (const a of [-RAIL_PORTAL.half, 0, RAIL_PORTAL.half]) {
          const x = portal!.x - portal!.face.x * 0.3 + portal!.face.z * a, z = portal!.z - portal!.face.z * 0.3 - portal!.face.x * a;
          expect(f.height(x, z), `hill behind ${portal!.id}`).toBeGreaterThan(RAIL_PORTAL.top - 0.6);
        }
      }
    }
  });

  it('has a road portal at every tunnel exit, set into a hill taller than the facade', () => {
    const exits = layout.exits.filter((e) => e.kind === 'tunnel');
    const road = f.portals.filter((p) => p.kind === 'road');
    expect(road).toHaveLength(exits.length);
    for (const e of exits) {
      const p = road.find((q) => q.id === e.edgeId)!;
      expect(p).toBeTruthy();
      expect(Math.hypot(p.x - e.p.x, p.z - e.p.z)).toBeLessThan(1e-6);
      expect(p.face.x * -e.dir.x + p.face.z * -e.dir.z).toBeGreaterThan(0.99);
      // just behind the facade the hill stands at least facade-high (minus the parapet)
      for (const a of [-ROAD_PORTAL.half, 0, ROAD_PORTAL.half]) {
        const x = e.p.x + e.dir.x * 0.3 - e.dir.z * a, z = e.p.z + e.dir.z * 0.3 + e.dir.x * a;
        expect(f.height(x, z)).toBeGreaterThan(ROAD_PORTAL.top - 0.6);
      }
      // the road in front of the portal is clear
      for (let s = 0.2; s < 4; s += 0.4) expect(covered(e.p.x - e.dir.x * s, e.p.z - e.dir.z * s)).toBe(false);
    }
  });
});

describe('terrain field: Nittany Ridge and the lake', () => {
  it('rises from low foothills at the board edge to an 18–22 u ridge line', () => {
    let max = 0;
    const near: number[] = [];
    const far: number[] = [];
    for (let x = E.minX; x <= E.maxX; x += 1) {
      for (let z = E.minZ; z <= E.maxZ; z += 1) {
        if (f.region(x, z) !== 0) continue;
        const h = f.height(x, z), d = f.depth(x, z);
        max = Math.max(max, h);
        const nearPortal = f.portals.some((p) => Math.hypot(p.x - x, p.z - z) < 12);
        if (d > 0 && d < 2 && !nearPortal && f.coast(x, z) > 6) near.push(h);
        if (d > 20 && d < 30 && f.coast(x, z) > 12) far.push(h);
      }
    }
    expect(max).toBeGreaterThan(18);
    expect(max).toBeLessThanOrEqual(22.01);
    expect(Math.max(...near)).toBeLessThan(2.5);
    far.sort((a, b) => a - b);
    expect(far[Math.floor(far.length / 2)]!).toBeGreaterThan(8);
  });

  it('meets the water at headlands on the NE and SW corners and leaves the open lake clear', () => {
    expect(f.headlands).toHaveLength(2);
    for (const h of f.headlands) {
      expect(f.height(h.x, h.z)).toBeGreaterThan(WATER_LEVEL);
      expect(h.x > B.maxX || h.z > B.maxZ).toBe(true);
    }
    for (let x = E.minX; x <= E.maxX; x += 1) {
      for (let z = E.minZ; z <= E.maxZ; z += 1) {
        const lake = (x > 40 && z > -20) || (z > 32 && x > -36) || x > E.maxX - 6 || z > E.maxZ - 5;
        if (lake) expect(f.height(x, z) < WATER_LEVEL || f.region(x, z) < 0, `(${x}, ${z})`).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    const g = createTerrainField(TOWN, layout);
    for (const [x, z] of [[-50, -40], [-40, 10], [-30, 0], [50, -45], [-55, 44], [-2, -27]] as const) {
      expect(g.height(x, z)).toBe(f.height(x, z));
    }
  });
});
