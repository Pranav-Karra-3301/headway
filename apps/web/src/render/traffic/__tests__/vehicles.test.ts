// Real sim + ambient traffic, as the renderer draws them: buses never overlap each other, and no car is drawn
// through a bus (cars give way at junctions a bus is about to enter, and pull off if a bus would drive into them).
import { describe, expect, it } from 'vitest';
import { G0, PolicyController, REF, TOWN, createSim } from '@headway/sim';
import { buildLaneGraph } from '../lanes';
import { createTrafficModel, type BusPose, type TrafficCar } from '../model';
import { vehiclePoses } from '../index';

const graph = buildLaneGraph(TOWN);
const BUS_HALF_W = 0.625, CAR_HALF_W = 0.4;

/** Oriented-box overlap (separating axis test) shrunk by `slack` on each side. */
function overlaps(b: BusPose, c: TrafficCar, slack: number): boolean {
  const cx = Math.cos(c.heading), cz = -Math.sin(c.heading);
  const boxes = [
    { x: b.x, z: b.z, ax: [b.dx, b.dz], ay: [-b.dz, b.dx], hl: b.halfLen - slack, hw: BUS_HALF_W - slack },
    { x: c.x, z: c.z, ax: [cx, cz], ay: [-cz, cx], hl: c.halfLen * c.scale - slack, hw: CAR_HALF_W * c.scale - slack },
  ];
  for (const k of boxes) for (const axis of [k.ax, k.ay]) {
    const proj = (o: typeof k) => Math.abs(o.ax[0]! * axis[0]! + o.ax[1]! * axis[1]!) * o.hl + Math.abs(o.ay[0]! * axis[0]! + o.ay[1]! * axis[1]!) * o.hw;
    const d = Math.abs((boxes[1]!.x - boxes[0]!.x) * axis[0]! + (boxes[1]!.z - boxes[0]!.z) * axis[1]!);
    if (d > proj(boxes[0]!) + proj(boxes[1]!)) return false;
  }
  return true;
}

function drive(scenarioId: string, seed: number, policy: typeof G0) {
  const sim = createSim({ map: TOWN, scenario: { scenarioId, seed, split: 'showcase' }, controller: new PolicyController(policy) });
  const model = createTrafficModel(graph, { seed, carCount: 16 });
  let prev = sim.snapshot();
  let busBus = 0, carBus = 0, frames = 0, cars = 0, shrinking = 0, moving = 0;
  while (!sim.done && sim.t < 4000) {
    sim.step();
    const next = sim.snapshot();
    for (const alpha of [0.5, 1]) {
      const { buses, trainDist } = vehiclePoses(TOWN, prev, next, alpha);
      model.step(0.5, { simT: sim.t - 1 + alpha, buses, trainDist });
      frames++;
      for (let i = 0; i < buses.length; i++) for (let j = i + 1; j < buses.length; j++) {
        const a = buses[i]!, b = buses[j]!;
        const rx = b.x - a.x, rz = b.z - a.z;
        if (a.dx * b.dx + a.dz * b.dz < 0.5 || Math.abs(rx * a.dz - rz * a.dx) > 1.0) continue;
        if (Math.abs(rx * a.dx + rz * a.dz) < a.halfLen + b.halfLen - 0.05) busBus++;
      }
      for (const c of model.cars) if (c.scale > 0.5 && buses.some((b) => overlaps(b, c, 0.1))) carBus++;
      cars += model.cars.length;
      shrinking += model.cars.filter((c) => c.dying > 0).length;
      moving += model.cars.filter((c) => c.v > 0.05).length;
    }
    prev = next;
  }
  return { busBus, carBus, frames, cars: +(cars / frames).toFixed(1), shrinking: +(shrinking / frames).toFixed(2), moving: +(moving / cars).toFixed(2) };
}

describe('vehicles as drawn (real sim)', () => {
  for (const [scenario, seed, policy, name] of [['stadium_exit', 4001, G0, 'g0'], ['stadium_exit', 4002, REF, 'ref'], ['class_change', 4003, REF, 'ref'], ['stadium_exit', 50000, G0, 'g0']] as const) {
    it(`${scenario} ${seed} ${name}: no bus ↔ bus or car ↔ bus overlaps`, () => {
      const r = drive(scenario, seed, policy);
      expect(r.frames).toBeGreaterThan(1000);
      expect(r.busBus).toBe(0);
      expect(r.carBus).toBeLessThanOrEqual(r.frames * 0.002);
      expect(r.cars).toBeGreaterThan(12); // traffic keeps flowing: cars give way, they don't all vanish
      expect(r.moving).toBeGreaterThan(0.5);
    });
  }
});
