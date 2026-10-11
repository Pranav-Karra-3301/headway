// Owner: G2. Street furniture on the greater-town road tiles (sidewalks only, never the carriageway): curved street
// lights along straight stretches, traffic lights at signalled junctions, stop signs on the minor arm of plain tees.
// Pure data; appended to the block plan's items with role 'street' and the road tile id as `block`.
import type { Vec2 } from '@headway/sim';
import { DIR_VEC, KERB, type Dir, type GreaterGrid } from '../grid';
import type { BlockItem, BlockStyle } from './plan';

/** Kenney traffic light (raw model; see plan TRAFFIC_LIGHT). */
const LIGHT = 'kenney:city-kit-roads/traffic-light';
/** Streets G2 lights (the lakeshore parkway is G3's boulevard). */
const SKIP_STREETS = new Set(['Lakeshore Pkwy']);
/** Sidewalk line: between the curb (KERB.carriage) and the tile edge (KERB.walk). */
export const WALK_OFFSET = (KERB.carriage + KERB.walk) / 2 + 0.02;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Yaw that turns +z toward d. */
const yawTo = (d: Vec2) => Math.atan2(d.x, d.z);

export function planStreetFurniture(g: GreaterGrid, items: BlockItem[], _styles: Record<string, BlockStyle>): void {
  const useAt = (c: number, r: number) => (c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.use[r]![c]! : null);
  const junctionNear = (p: Vec2, R: number) =>
    g.junctions.some((j) => Math.hypot(j.center.x - p.x, j.center.z - p.z) < R) ||
    g.roundabouts.some((rb) => Math.hypot(rb.center.x - p.x, rb.center.z - p.z) < rb.outerR + 2.5);

  // street lights: every other straight tile, on a side that faces land (not water / rail), alternating sides
  let n = 0;
  for (const t of g.roads) {
    if (t.kind !== 'straight' || t.bridge || t.railCrossing || SKIP_STREETS.has(t.street) || !t.model) continue;
    const { c, r } = t.cells;
    if ((c + r) % 2) continue;
    if (junctionNear(t.center, 3)) continue;
    const alongZ = t.open.includes('n') || t.open.includes('s');
    const sides: Dir[] = alongZ ? ['w', 'e'] : ['n', 's'];
    const okSide = (s: Dir) => {
      const v = DIR_VEC[s];
      const u = useAt(c + v.x, r + v.z);
      return u === 'free' || u === 'board' || u === 'hill' || u === 'highway';
    };
    const cand = sides.filter(okSide);
    if (!cand.length) continue;
    const side = cand.length === 2 ? cand[n % 2]! : cand[0]!;
    n++;
    const v = DIR_VEC[side];
    const p = { x: t.center.x + v.x * WALK_OFFSET, z: t.center.z + v.z * WALK_OFFSET };
    items.push({ kind: 'kn.prop.streetLight', x: r3(p.x), z: r3(p.z), rot: yawTo({ x: -v.x, z: -v.z }), role: 'street', block: t.id });
  }

  // junction furniture: lights at signalled junctions (one per arm, on the approaching driver's right-hand corner),
  // a stop sign on the minor arm of other tees
  for (const j of g.junctions) {
    if (j.kind !== 'tee' && j.kind !== 'cross') continue;
    const arms = j.arms;
    const place = (a: (typeof arms)[number]): { p: Vec2; rot: number } => {
      const d = a.dir; // outward
      const right = { x: d.z, z: -d.x }; // right of the approaching heading (−d)
      const back = Math.hypot(a.p.x - j.center.x, a.p.z - j.center.z) - 0.35;
      return { p: { x: j.center.x + d.x * back + right.x * WALK_OFFSET, z: j.center.z + d.z * back + right.z * WALK_OFFSET }, rot: yawTo(d) };
    };
    if (j.signals) {
      for (const a of arms) {
        const { p, rot } = place(a);
        items.push({ kind: LIGHT, x: r3(p.x), z: r3(p.z), rot, role: 'street', block: j.id });
      }
      continue;
    }
    if (j.kind !== 'tee' || arms.length !== 3) continue;
    // minor arm: the one not collinear with another arm
    const minor = arms.find((a) => !arms.some((b) => b !== a && a.dir.x * b.dir.x + a.dir.z * b.dir.z < -0.9));
    if (!minor) continue;
    const { p, rot } = place(minor);
    items.push({ kind: 'kn.prop.signStop', x: r3(p.x), z: r3(p.z), rot, role: 'street', block: j.id });
  }
}
