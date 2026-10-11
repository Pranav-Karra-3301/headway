// Owner: G0. The greater-town grid seam: frame, network, lanes, ports, blocks.
import { describe, expect, it } from 'vitest';
import { pointAt, TOWN } from '@headway/sim';
import type { Vec2 } from '@headway/sim';
import { cellCenter, cellOf, greaterGrid, inGrid, KERB, linkLanes, roadAt, useAt, type Lane } from '../../grid';
import { across, boardExits, planNetwork } from '../plan';
import { gridFrame } from '../cells';

const g = greaterGrid(TOWN);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

describe('greater grid frame', () => {
  it('is 32 × 27 cells of 4 u around the board', () => {
    expect(g.tile).toBe(4);
    expect([g.cols, g.rows]).toEqual([32, 27]);
    expect(g.origin).toEqual({ x: TOWN.bounds.minX - 28, z: TOWN.bounds.minZ - 28 });
    expect(g.board).toEqual({ c: 7, r: 7, w: 18, h: 13 });
    expect(g.highway).toEqual({ c: 0, r: 0, w: 32, h: 4 });
    expect(g.bounds).toEqual({ minX: -64, maxX: 64, minZ: -54, maxZ: 54 });
  });

  it('maps cells and points both ways', () => {
    for (const [c, r] of [[0, 0], [7, 7], [31, 26], [15, 5]] as const) {
      const p = cellCenter(g, c, r);
      expect(cellOf(g, p.x, p.z)).toEqual({ c, r });
    }
    expect(cellCenter(g, 15, 5)).toEqual({ x: -2, z: -32 });
    expect(useAt(g, 0, 0)).toBe('board');
    expect(useAt(g, 0, -50)).toBe('highway');
    expect(greaterGrid(TOWN)).toBe(g);
  });
});

describe('greater road network', () => {
  const net = planNetwork(TOWN, gridFrame(TOWN));

  it('never puts road on the board or in the highway band', () => {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const u = g.use[r]![c]!;
      if (r < 4) expect(u === 'highway' || u === 'road' ? u : 'x').not.toBe('x');
      if (c >= 7 && c <= 24 && r >= 7 && r <= 19) expect(u).toBe('board');
      if (u === 'road') expect(roadAt(g, c, r)).not.toBeNull();
      else expect(roadAt(g, c, r)).toBeNull();
    }
    for (let c = 0; c < g.cols; c++) for (let r = 0; r < 4; r++) expect(g.use[r]![c]).toBe('highway');
  });

  it('tiles never overlap', () => {
    const seen = new Map<string, string>();
    for (const t of g.roads) {
      for (let r = t.cells.r; r < t.cells.r + t.cells.h; r++) for (let c = t.cells.c; c < t.cells.c + t.cells.w; c++) {
        const k = `${c},${r}`;
        expect(seen.get(k), `${t.id} overlaps ${seen.get(k)} at ${k}`).toBeUndefined();
        seen.set(k, t.id);
      }
      if (t.kind !== 'connector') expect(t.model).toMatch(/^city-kit-roads\/road-/);
      expect(Math.abs(t.rot / (Math.PI / 2) - Math.round(t.rot / (Math.PI / 2)))).toBeLessThan(1e-9);
    }
  });

  it('every link and roundabout/curve arm meets a road or a port (no dangling ends)', () => {
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const m = net.links[r * g.cols + c]!;
      for (const [d, bit] of [['n', 1], ['e', 2], ['s', 4], ['w', 8]] as const) {
        if (m & bit) expect(across(g, net, c, r, d).kind, `link ${c},${r} ${d}`).not.toBe('dangling');
      }
    }
    for (const p of net.pieces) for (const a of p.arms) {
      expect(across(g, net, a.c, a.r, a.side).kind, `${p.id} arm ${a.c},${a.r} ${a.side}`).not.toBe('dangling');
    }
  });

  it('puts a roundabout on every road leaving the board, plus the foothill and harbour circles', () => {
    const exits = boardExits(TOWN);
    expect(exits.length).toBe(4);
    expect(g.roundabouts.length).toBe(6);
    for (const e of exits) {
      const rb = g.roundabouts.filter((r) => dist(r.center, e.p) < 13);
      expect(rb.length, `roundabout near ${e.side} exit`).toBeGreaterThanOrEqual(1);
      const port = g.ports.find((p) => p.kind === 'board' && dist(p.p, e.p) < 0.01);
      expect(port, `board port at ${e.side} exit`).toBeDefined();
      expect(port!.inLane && port!.outLane).toBeTruthy();
    }
    for (const r of g.roundabouts) expect(r.islandR).toBeLessThan(r.laneR);
  });

  it('has the named streets with centrelines inside the grid', () => {
    const names = g.streets.map((s) => s.name);
    for (const n of ['Ring Rd', 'Foothill Rd', 'Lakeshore Pkwy', 'Bayview Ave', 'Mill St', 'Harbor St']) expect(names).toContain(n);
    for (const s of g.streets) for (const p of s.paths) for (const q of p.points) {
      expect(q.x).toBeGreaterThanOrEqual(g.bounds.minX - 1e-9);
      expect(q.x).toBeLessThanOrEqual(g.bounds.maxX + 1e-9);
      expect(q.z).toBeGreaterThanOrEqual(g.bounds.minZ + 16 - 1e-9);
      expect(q.z).toBeLessThanOrEqual(g.bounds.maxZ + 1e-9);
    }
    expect(g.junctions.some((j) => j.kind === 'tee' && j.signals)).toBe(true);
  });
});

describe('greater lanes', () => {
  const byId = new Map(g.lanes.map((l) => [l.id, l] as const));

  it('lanes are continuous: every successor starts where its predecessor ends', () => {
    expect(g.lanes.length).toBeGreaterThan(100);
    for (const l of g.lanes) {
      expect(l.path.points.length).toBeGreaterThanOrEqual(2);
      expect(l.speed).toBeGreaterThan(0);
      for (const n of l.next) {
        const m = byId.get(n)!;
        expect(dist(l.path.points[l.path.points.length - 1]!, m.path.points[0]!)).toBeLessThan(1e-3);
      }
    }
  });

  it('lanes run on road cells (or the boundary they leave through)', () => {
    for (const l of g.lanes) {
      for (let d = 0; d <= l.path.length; d += 0.5) {
        const p = pointAt(l.path, d);
        const u = useAt(g, p.x, p.z);
        const onEdge = !inGrid(g, cellOf(g, p.x, p.z).c, cellOf(g, p.x, p.z).r);
        if (u !== 'road' && !onEdge) {
          // allowed only on a cell boundary shared with a road cell (ports at the board / highway edge)
          const q = [[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]].some(([dx, dz]) => useAt(g, p.x + dx!, p.z + dz!) === 'road');
          expect(q, `${l.id} at ${p.x.toFixed(2)},${p.z.toFixed(2)} on ${u}`).toBe(true);
        }
      }
    }
  });

  it('dead ends only at ports; every lane reaches a port and is reachable from one', () => {
    const outs = new Set(g.ports.map((p) => p.outLane).filter(Boolean));
    const ins = g.ports.map((p) => p.inLane).filter((x): x is string => !!x);
    for (const l of g.lanes) if (l.next.length === 0) expect(outs.has(l.id), `${l.id} dead-ends`).toBe(true);
    const reach = new Set<string>();
    const stack = [...ins];
    while (stack.length) {
      const id = stack.pop()!;
      if (reach.has(id)) continue;
      reach.add(id);
      for (const n of byId.get(id)!.next) stack.push(n);
    }
    for (const l of g.lanes) expect(reach.has(l.id), `${l.id} unreachable`).toBe(true);
    // reverse reachability to an exit
    const prev = new Map<string, string[]>();
    for (const l of g.lanes) for (const n of l.next) prev.set(n, [...(prev.get(n) ?? []), l.id]);
    const back = new Set<string>();
    const st2 = [...outs] as string[];
    while (st2.length) {
      const id = st2.pop()!;
      if (back.has(id)) continue;
      back.add(id);
      for (const p of prev.get(id) ?? []) st2.push(p);
    }
    for (const l of g.lanes) expect(back.has(l.id), `${l.id} cannot reach an exit`).toBe(true);
  });

  it('keeps right: two-way lanes sit KERB.lane right of the street centreline', () => {
    const ring = g.lanes.filter((l) => l.kind === 'ring');
    expect(ring.length).toBeGreaterThan(4);
    const centre = g.streets.find((s) => s.name === 'Ring Rd')!;
    for (const l of ring) {
      const mid = pointAt(l.path, l.path.length / 2);
      let best = Infinity;
      for (const p of centre.paths) for (let d = 0; d <= p.length; d += 0.25) best = Math.min(best, dist(pointAt(p, d), mid));
      expect(best).toBeGreaterThan(KERB.lane - 0.08);
      expect(best).toBeLessThan(KERB.lane + 0.08);
    }
  });

  it('roundabouts circulate anticlockwise seen from above, entries give way', () => {
    const rb = g.roundabouts[0]!;
    const ringLanes = g.lanes.filter((l) => l.id.startsWith(`${rb.id}:ring-`) || l.id.startsWith(`${rb.id}:pass-`));
    expect(ringLanes.length).toBe(8);
    for (const l of ringLanes) {
      const a = l.path.points[0]!, b = l.path.points[1]!;
      const cross = (a.x - rb.center.x) * (b.z - rb.center.z) - (a.z - rb.center.z) * (b.x - rb.center.x);
      expect(cross).toBeLessThan(0); // angle decreasing in x/z = anticlockwise with north up
      expect(Math.abs(dist(a, rb.center) - rb.laneR)).toBeLessThan(1e-6);
    }
    expect(g.lanes.filter((l) => l.yield).length).toBe(6 * 4);
  });

  it('linkLanes joins foreign lanes by geometry', () => {
    const port = g.ports.find((p) => p.kind === 'highway')!;
    expect(port).toBeDefined();
    const out = byId.get(port.outLane!)!;
    const end = out.path.points[out.path.points.length - 1]!;
    const extra: Lane = { id: 'hw:test', kind: 'ramp', path: { points: [end, { x: end.x, z: end.z - 5 }], cum: [0, 5], length: 5, closed: false }, speed: 5, next: [] };
    const all = linkLanes([...g.lanes.map((l) => ({ ...l, next: [...l.next] })), extra]);
    expect(all.find((l) => l.id === out.id)!.next).toContain('hw:test');
  });
});

describe('greater blocks', () => {
  it('cover every free cell exactly once, never roads, board or highway', () => {
    const cover = new Map<string, string>();
    for (const b of g.blocks) {
      for (let r = b.cells.r; r < b.cells.r + b.cells.h; r++) for (let c = b.cells.c; c < b.cells.c + b.cells.w; c++) {
        expect(g.use[r]![c], `${b.id} on ${c},${r}`).toBe('free');
        expect(cover.has(`${c},${r}`)).toBe(false);
        cover.set(`${c},${r}`, b.id);
      }
    }
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (g.use[r]![c] === 'free') expect(cover.has(`${c},${r}`)).toBe(true);
  });

  it('give zone hints and street frontage', () => {
    const zones = new Set(g.blocks.map((b) => b.zone));
    for (const z of ['suburb', 'commercial', 'industrial', 'frontage', 'waterfront', 'verge'] as const) expect(zones.has(z), z).toBe(true);
    for (const b of g.blocks) if (b.zone === 'suburb' || b.zone === 'commercial' || b.zone === 'industrial') expect(b.frontage.length, b.id).toBeGreaterThan(0);
  });
});
