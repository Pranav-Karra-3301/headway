// Owner: G1. The highway plan + network: everything inside the band, lanes linked end to end, the interchange
// joined to G0's North Gate Circle, cars only enter / leave at world exits, heights on the overpass.
import { describe, expect, it } from 'vitest';
import { TOWN } from '@headway/sim';
import { greaterGrid } from '../../grid';
import { HW, highwayPlan, laneHeightAt } from '../plan';
import { greaterLanes } from '../network';

const plan = highwayPlan(TOWN);
const g = greaterGrid(TOWN);
const net = greaterLanes(TOWN);

describe('highway plan', () => {
  it('sits in the northern band and meets the north port', () => {
    const port = g.ports.find((p) => p.kind === 'highway')!;
    expect(plan.xn).toBeCloseTo(port.p.x, 6);
    expect(plan.z1).toBeCloseTo(port.p.z, 6);
    for (const l of plan.lanes) for (const p of l.path.points) {
      expect(p.z, l.id).toBeGreaterThanOrEqual(plan.z0 - 1e-6);
      expect(p.z, l.id).toBeLessThanOrEqual(plan.z1 + 1e-6);
      expect(p.x, l.id).toBeGreaterThanOrEqual(plan.xw - 1e-6);
      expect(p.x, l.id).toBeLessThanOrEqual(plan.xe + 1e-6);
    }
  });

  it('raises the through carriageways over the link road and keeps ramps / junctions at grade', () => {
    expect(plan.heightAt(plan.xn)).toBeCloseTo(HW.H, 6);
    expect(plan.heightAt(plan.xn - HW.flatHalf - HW.slant - 0.01)).toBe(0);
    const fast = plan.lanes.find((l) => l.id === 'hw:eb-fast')!;
    const d = fast.path.cum[fast.path.points.findIndex((p) => Math.abs(p.x - plan.xn) < 0.6)]!;
    expect(laneHeightAt(fast, d)).toBeCloseTo(HW.H, 1);
    expect(laneHeightAt(fast, 0)).toBe(0);
    for (const l of plan.lanes) if (l.kind === 'ramp' || l.kind === 'junction') expect(l.y).toBeUndefined();
    // the slip roads diverge / merge only where the expressway is at grade
    for (const s of plan.slips) for (const p of s.path) {
      if (Math.abs(p.z - plan.zEB) < 3.5 && Math.abs(p.z - plan.zWB) > 0.1) expect(plan.heightAt(p.x), s.id).toBe(0);
    }
  });

  it('links every highway lane into a through network with no dead ends inside the region', () => {
    const exits = new Set(net.ports.flatMap((p) => ('outLanes' in p ? p.outLanes : p.outLane ? [p.outLane] : [])));
    for (const l of net.lanes.filter((x) => x.id.startsWith('hw:'))) {
      if (exits.has(l.id)) continue;
      expect(l.next.length, `${l.id} has no successor`).toBeGreaterThan(0);
    }
    const id = (s: string) => net.byId.get(`hw:${s}`)!;
    expect(id('eb-slow-1').next).toEqual(['hw:eb-off', 'hw:eb-slow-2']);
    expect(id('eb-on').next).toEqual(['hw:eb-slow-3']);
    expect(id('wb-slow-1').next).toEqual(['hw:wb-off', 'hw:wb-slow-2']);
  });

  it('joins the interchange to North Gate Circle and replaces the band port with two world exits', () => {
    const port = g.ports.find((p) => p.kind === 'highway')!;
    const toRb = net.lanes.filter((l) => l.next.includes(port.inLane!));
    expect(toRb.length).toBeGreaterThanOrEqual(2); // straight down from the link + right turn off the eastbound ramp
    const fromRb = net.byId.get(port.outLane!)!;
    expect(fromRb.next.some((n) => n.startsWith('hw:j-s:s>'))).toBe(true);
    const hw = net.ports.filter((p) => p.kind === 'highway');
    expect(hw.map((p) => p.side).sort()).toEqual(['e', 'w']);
    for (const p of hw) {
      expect(net.byId.has(p.inLane!)).toBe(true);
      expect(net.byId.has(p.outLane!)).toBe(true);
    }
    // the town's own lanes are untouched
    expect(g.lanes.every((l) => !l.next.some((n) => n.startsWith('hw:')))).toBe(true);
  });

  it('reaches every exit from every entrance (west tunnel ↔ east end ↔ North Gate Circle)', () => {
    const reach = (from: string): Set<string> => {
      const seen = new Set<string>([from]);
      const q = [from];
      while (q.length) for (const n of net.byId.get(q.shift()!)!.next) if (!seen.has(n)) { seen.add(n); q.push(n); }
      return seen;
    };
    const west = reach('hw:eb-slow-1'), east = reach('hw:wb-slow-1');
    expect(west.has('hw:eb-slow-3')).toBe(true);
    expect(west.has('hw:eb-off')).toBe(true);
    expect(east.has('hw:wb-slow-3')).toBe(true);
    const port = g.ports.find((p) => p.kind === 'highway')!;
    expect(west.has(port.inLane!)).toBe(true);
    expect(east.has(port.inLane!)).toBe(true);
    const town = reach(port.outLane!);
    expect(town.has('hw:eb-slow-3') || town.has('hw:eb-on')).toBe(true);
    expect(town.has('hw:wb-on')).toBe(true);
  });

  it('keeps props out of the lanes and off the board', () => {
    for (const p of plan.props) {
      // inside the grid everything stays in the band; west of the grid (mountain land) the hill pines may spill south
      if (p.x >= g.bounds.minX) expect(p.z, `${p.kind} at ${p.x.toFixed(1)}`).toBeLessThan(plan.z1 + 0.01);
      if ((p.kind === 'pine' || p.kind === 'tree' || p.kind === 'bush') && p.x > plan.xPortal) { // (hill pines stand over the bores)
        expect(Math.abs(p.z - plan.zc), `${p.kind} at ${p.x.toFixed(1)}`).toBeGreaterThan(HW.outer + 0.3);
      }
    }
  });
});
