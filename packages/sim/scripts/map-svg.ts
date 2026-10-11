// Owner: Task M. Writes docs/map-preview.svg (top-down review overlay of TOWN + base SCENERY) and validates the layout.
// Run: pnpm --filter @headway/sim exec tsx scripts/map-svg.ts   (exit code 1 when the layout has problems)
// Render: Chrome --headless --screenshot=docs/map-preview.png file://…/docs/map-preview.svg
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneryFootprint, SCENERY, type SceneryItem } from '../../../apps/web/src/render/scenery';
import type { Polyline, Vec2 } from '../src/contracts';
import { pointAt, projectOnPolyline } from '../src/map/geometry';
import { nearestAccess, STREET_NAMES, TOWN } from '../src/map/town';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../../docs/map-preview.svg');
const PX = 15; // pixels per board unit
const PAD = 40;
const LEGEND_H = 120;
const b = TOWN.bounds;
const W = (b.maxX - b.minX) * PX + PAD * 2;
const H = (b.maxZ - b.minZ) * PX + PAD * 2 + LEGEND_H;
const X = (x: number) => +(PAD + (x - b.minX) * PX).toFixed(1);
const Y = (z: number) => +(PAD + (z - b.minZ) * PX).toFixed(1);
const pts = (ps: Vec2[]) => ps.map((p) => `${X(p.x)},${Y(p.z)}`).join(' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ------------------------------------------------------------------ validation
type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const problems: string[] = [];
const boxCorners = (f: Box): Vec2[] => [
  { x: f.minX, z: f.minZ }, { x: f.maxX, z: f.minZ }, { x: f.minX, z: f.maxZ }, { x: f.maxX, z: f.maxZ },
  { x: (f.minX + f.maxX) / 2, z: f.minZ }, { x: (f.minX + f.maxX) / 2, z: f.maxZ },
  { x: f.minX, z: (f.minZ + f.maxZ) / 2 }, { x: f.maxX, z: (f.minZ + f.maxZ) / 2 },
];
const polyDist = (poly: Polyline, p: Vec2) => projectOnPolyline(poly, p).d;
/** Distance from a polyline to a box (0 if they intersect), sampled along the polyline. */
function polyToBox(poly: Polyline, f: Box): number {
  let best = Infinity;
  for (const c of boxCorners(f)) best = Math.min(best, polyDist(poly, c));
  for (let d = 0; d <= poly.length; d += 0.25) {
    const p = pointAt(poly, d);
    const dx = Math.max(f.minX - p.x, 0, p.x - f.maxX);
    const dz = Math.max(f.minZ - p.z, 0, p.z - f.maxZ);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}
const overlap = (a: Box, c: Box, gap = 0) => a.minX < c.maxX + gap && c.minX < a.maxX + gap && a.minZ < c.maxZ + gap && c.minZ < a.maxZ + gap;
const label = (it: SceneryItem, i: number) => `#${i} ${it.building ?? it.kind}${it.stationId ? ' ' + it.stationId : ''} @(${it.x},${it.z})`;

const solid = SCENERY.map((it, i) => ({ it, i, f: sceneryFootprint(it) })).filter(({ it }) => it.kind !== 'lawn');
const buildings = solid.filter(({ it }) => it.kind !== 'tree' && it.kind !== 'station');
// stop keep-out: shelter (3.6 along the road, 1.8 deep) + the first queue rows along queueDir, plus 1 u
const stopBoxes = TOWN.stops.map((s) => {
  const ax = Math.abs(s.queueDir.x) > 0.5; // queue grows along x → road runs along z
  const along = 1.8 + 1, deep = 3.2 + 1;
  const ex = s.p.x + s.queueDir.x * deep, ez = s.p.z + s.queueDir.z * deep;
  const f: Box = ax
    ? { minX: Math.min(s.p.x, ex), maxX: Math.max(s.p.x, ex), minZ: s.p.z - along, maxZ: s.p.z + along }
    : { minX: s.p.x - along, maxX: s.p.x + along, minZ: Math.min(s.p.z, ez), maxZ: Math.max(s.p.z, ez) };
  return { id: s.id, f };
});

for (const { it, i, f } of solid) {
  if (f.minX < b.minX || f.maxX > b.maxX || f.minZ < b.minZ || f.maxZ > b.maxZ) problems.push(`${label(it, i)} outside the board`);
  if (it.kind !== 'station') {
    for (const e of TOWN.roads.edges) {
      const d = polyToBox(e.path, f);
      if (d < (it.kind === 'tree' ? 1.2 : 1.5) - 1e-6) problems.push(`${label(it, i)} too close to road ${e.id} (${d.toFixed(2)} u)`);
    }
    const rd = polyToBox(TOWN.rail.loop, f);
    if (rd < 1.2) problems.push(`${label(it, i)} on the rail (${rd.toFixed(2)} u)`);
    for (const s of stopBoxes) if (overlap(f, s.f)) problems.push(`${label(it, i)} blocks stop ${s.id}`);
  } else {
    for (const e of TOWN.roads.edges) {
      const d = polyToBox(e.path, f);
      if (d < 1.2) problems.push(`${label(it, i)} touches road ${e.id} (${d.toFixed(2)} u)`);
    }
  }
}
for (let p = 0; p < solid.length; p++) for (let q = p + 1; q < solid.length; q++) {
  const A = solid[p]!, B = solid[q]!;
  const gap = A.it.kind === 'tree' || B.it.kind === 'tree' ? 0 : 0.4;
  if (overlap(A.f, B.f, gap)) problems.push(`${label(A.it, A.i)} overlaps ${label(B.it, B.i)}`);
}
// every zone door: 5–12 u from access; non-gate, non-station doors sit at a building front
for (const z of TOWN.zones) {
  const a = nearestAccess(TOWN, z.door);
  if (a.d < 5 || a.d > 12) problems.push(`zone ${z.id} door is ${a.d.toFixed(1)} u from ${a.at}`);
  if (z.tags.includes('stadium') || z.tags.includes('station')) continue;
  const near = buildings.some(({ f }) => z.door.x >= f.minX - 0.6 && z.door.x <= f.maxX + 0.6 && z.door.z >= f.minZ - 0.6 && z.door.z <= f.maxZ + 0.6);
  if (!near) problems.push(`zone ${z.id} door (${z.door.x},${z.door.z}) is not at a building`);
}
const kitTypes = ['small', 'tall', 'hall', 'shop', 'house', 'townhouses', 'cafe', 'dorm', 'library'];
for (const k of kitTypes) if (!SCENERY.some((it) => (it.building ?? it.kind) === k)) problems.push(`kit building "${k}" is never placed`);
for (const k of ['clockTower', 'stadium', 'station', 'tree', 'lawn']) if (!SCENERY.some((it) => it.kind === k)) problems.push(`kind "${k}" is never placed`);

// ------------------------------------------------------------------ drawing
const C = {
  bg: '#DDEFE5', board: '#A8D8B9', edge: '#7FBF98', lawn: '#8FCB9B', road: '#F4EBDD', roadEdge: '#D9CDB8',
  ballast: '#D9CBB3', ties: '#B08B63', rail: '#7E848E', wall: '#F6EEDC', wallLine: '#9B8E78', roof: '#E9785A',
  hall: '#F3E6CF', hallRoof: '#3FA796', stadium: '#F3EDE2', field: '#6FC07F', seats: '#5A8BD6', leaf: '#4FAF6E',
  platform: '#E8DCC8', canopy: '#D7443E', stop: '#F6C945', ink: '#22304A', door: '#C0553A', muted: '#5F6F66',
};
const ROUTE_OFFSET: Record<string, number> = { r1: -0.55, r2: 0, r3: 0.55 };
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs><style>
  @font-face { font-family: Gumball; src: url("../apps/web/public/fonts/GumballRounded.ttf"); }
  text { font-family: Gumball, "Avenir Next Rounded Std", Nunito, system-ui, sans-serif; fill: ${C.ink}; }
  .street { font-size: 10px; fill: #8A7B63; letter-spacing: 0.4px; }
  .stop { font-size: 12px; font-weight: 700; }
  .zone { font-size: 9px; fill: ${C.muted}; }
  .hood { font-size: 22px; fill: rgba(34,48,74,0.22); letter-spacing: 3px; }
</style></defs>`);
out.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
out.push(`<rect x="${X(b.minX)}" y="${Y(b.minZ)}" width="${(b.maxX - b.minX) * PX}" height="${(b.maxZ - b.minZ) * PX}" rx="18" fill="${C.board}" stroke="${C.edge}" stroke-width="6"/>`);

// neighbourhood names (under everything)
for (const n of TOWN.neighborhoods) {
  out.push(`<circle cx="${X(n.center.x)}" cy="${Y(n.center.z)}" r="${n.radius * PX}" fill="none" stroke="rgba(34,48,74,0.10)" stroke-width="2" stroke-dasharray="6 6"/>`);
}
// lawns
for (const it of SCENERY.filter((s) => s.kind === 'lawn')) {
  const f = sceneryFootprint(it);
  out.push(`<rect x="${X(f.minX)}" y="${Y(f.minZ)}" width="${(f.maxX - f.minX) * PX}" height="${(f.maxZ - f.minZ) * PX}" rx="8" fill="${C.lawn}"/>`);
}
// rail
const railPts = pts([...TOWN.rail.loop.points, TOWN.rail.loop.points[0]!]);
out.push(`<polyline points="${railPts}" fill="none" stroke="${C.ballast}" stroke-width="${2.0 * PX}" stroke-linejoin="round"/>`);
out.push(`<polyline points="${railPts}" fill="none" stroke="${C.ties}" stroke-width="${1.5 * PX}" stroke-dasharray="3 ${0.55 * PX - 3}" stroke-linejoin="round"/>`);
for (const s of [-0.38, 0.38]) {
  const off = TOWN.rail.loop.points.map((p, i, a) => offsetPoint(a, i, s, true));
  out.push(`<polyline points="${pts([...off, off[0]!])}" fill="none" stroke="${C.rail}" stroke-width="2" stroke-linejoin="round"/>`);
}
// roads
for (const e of TOWN.roads.edges) out.push(`<polyline points="${pts(e.path.points)}" fill="none" stroke="${C.roadEdge}" stroke-width="${2.4 * PX + 3}" stroke-linecap="round" stroke-linejoin="round"/>`);
for (const e of TOWN.roads.edges) out.push(`<polyline points="${pts(e.path.points)}" fill="none" stroke="${C.road}" stroke-width="${2.4 * PX}" stroke-linecap="round" stroke-linejoin="round"/>`);
// route ribbons with direction chevrons
for (const r of TOWN.routes) {
  const o = ROUTE_OFFSET[r.id] ?? 0;
  const off = r.path.points.map((_, i, a) => offsetPoint(a, i, o, true));
  out.push(`<polyline points="${pts([...off, off[0]!])}" fill="none" stroke="${r.color}" stroke-width="4" stroke-linejoin="round" opacity="0.9"/>`);
  for (let d = 6; d < r.path.length; d += 9) {
    const p = pointAt(r.path, d);
    const nx = Math.sin(p.heading), nz = Math.cos(p.heading); // left normal of heading (x right, z down)
    const cx = p.x + nx * o, cz = p.z + nz * o;
    const deg = (-p.heading * 180) / Math.PI;
    out.push(`<path d="M -4 -4 L 3 0 L -4 4" transform="translate(${X(cx)},${Y(cz)}) rotate(${deg.toFixed(1)})" fill="none" stroke="${r.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
}
// street names
const named = new Set<string>();
for (const e of [...TOWN.roads.edges].sort((p, q) => q.path.length - p.path.length)) {
  const name = STREET_NAMES[e.id] ?? e.id;
  if (named.has(name) && e.path.length < 30) continue;
  named.add(name);
  const p = pointAt(e.path, e.path.length * 0.5);
  let deg = (-p.heading * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  out.push(`<text class="street" text-anchor="middle" dominant-baseline="central" transform="translate(${X(p.x)},${Y(p.z)}) rotate(${deg.toFixed(1)})">${esc(name)}</text>`);
}
// scenery footprints
for (const { it, f } of solid.filter(({ it }) => it.kind !== 'station')) {
  const x = X(f.minX), y = Y(f.minZ), w = (f.maxX - f.minX) * PX, h = (f.maxZ - f.minZ) * PX;
  if (it.kind === 'tree') { out.push(`<circle cx="${X(it.x)}" cy="${Y(it.z)}" r="${0.8 * (it.scale ?? 1) * PX}" fill="${C.leaf}" stroke="#3E9A5F" stroke-width="1.5"/>`); continue; }
  if (it.kind === 'stadium') {
    out.push(`<ellipse cx="${X(it.x)}" cy="${Y(it.z)}" rx="${5.4 * PX}" ry="${4.2 * PX}" fill="${C.stadium}" stroke="${C.wallLine}" stroke-width="2"/>`);
    out.push(`<ellipse cx="${X(it.x)}" cy="${Y(it.z)}" rx="${4.7 * PX}" ry="${3.5 * PX}" fill="${C.seats}"/>`);
    out.push(`<ellipse cx="${X(it.x)}" cy="${Y(it.z)}" rx="${3.9 * PX}" ry="${2.8 * PX}" fill="${C.field}"/>`);
    continue;
  }
  const isHall = it.kind === 'hall' || it.kind === 'clockTower';
  out.push(`<rect x="${x}" y="${y}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${isHall ? C.hall : C.wall}" stroke="${isHall ? C.hallRoof : C.roof}" stroke-width="3"/>`);
  // front edge marker (door side)
  const q = Math.round((it.rot ?? 0) / (Math.PI / 2)) & 3;
  const [fx1, fz1, fx2, fz2] = q === 0 ? [f.minX, f.maxZ, f.maxX, f.maxZ] : q === 2 ? [f.minX, f.minZ, f.maxX, f.minZ] : q === 1 ? [f.maxX, f.minZ, f.maxX, f.maxZ] : [f.minX, f.minZ, f.minX, f.maxZ];
  out.push(`<line x1="${X(fx1)}" y1="${Y(fz1)}" x2="${X(fx2)}" y2="${Y(fz2)}" stroke="${C.door}" stroke-width="4" stroke-linecap="round"/>`);
  out.push(`<text x="${X(it.x)}" y="${Y(it.z)}" text-anchor="middle" dominant-baseline="central" style="font-size:9px;fill:#7A6A55">${esc(it.kind === 'clockTower' ? 'clock' : it.building ?? it.kind)}</text>`);
}
// stations: platform + kit footprint
for (const st of TOWN.rail.stations) {
  const it = SCENERY.find((s) => s.stationId === st.id);
  if (it) {
    const f = sceneryFootprint(it);
    out.push(`<rect x="${X(f.minX)}" y="${Y(f.minZ)}" width="${((f.maxX - f.minX) * PX).toFixed(1)}" height="${((f.maxZ - f.minZ) * PX).toFixed(1)}" rx="5" fill="none" stroke="${C.canopy}" stroke-width="2" stroke-dasharray="5 4"/>`);
  }
  const c = pointAt(TOWN.rail.loop, st.dist);
  const tx = Math.cos(c.heading), tz = -Math.sin(c.heading); // track direction
  const nx = st.platform.x - c.x, nz = st.platform.z - c.z;
  const nl = Math.hypot(nx, nz) || 1;
  const inx = (Math.abs(tx) > 0.5 ? 0 : Math.sign(nx)) || 0, inz = (Math.abs(tz) > 0.5 ? Math.sign(nz) : 0) || 0;
  void nl;
  const corners = [-4.5, 4.5].flatMap((u) => [0.75, 3.15].map((v) => ({ x: c.x + tx * u + inx * v, z: c.z + tz * u + inz * v })));
  const xs = corners.map((p) => p.x), zs = corners.map((p) => p.z);
  out.push(`<rect x="${X(Math.min(...xs))}" y="${Y(Math.min(...zs))}" width="${((Math.max(...xs) - Math.min(...xs)) * PX).toFixed(1)}" height="${((Math.max(...zs) - Math.min(...zs)) * PX).toFixed(1)}" rx="3" fill="${C.platform}" stroke="${C.canopy}" stroke-width="2.5"/>`);
  out.push(`<circle cx="${X(st.platform.x)}" cy="${Y(st.platform.z)}" r="4" fill="${C.canopy}"/>`);
  out.push(`<line x1="${X(st.platform.x)}" y1="${Y(st.platform.z)}" x2="${X(st.platform.x + st.queueDir.x * 2)}" y2="${Y(st.platform.z + st.queueDir.z * 2)}" stroke="${C.canopy}" stroke-width="2"/>`);
  const lx = c.x + inx * 4.2, lz = c.z + inz * 4.2;
  out.push(`<text x="${X(lx + tx * -3)}" y="${Y(lz + tz * -3)}" text-anchor="middle" dominant-baseline="central" style="font-size:13px;font-weight:700;fill:${C.canopy}">🚆 ${esc(st.name)}</text>`);
}
// zone doors
for (const z of TOWN.zones) {
  out.push(`<rect x="${X(z.door.x) - 4}" y="${Y(z.door.z) - 4}" width="8" height="8" rx="2" fill="${C.door}" stroke="#fff" stroke-width="1.5"/>`);
  out.push(`<text class="zone" x="${X(z.door.x) + 7}" y="${Y(z.door.z) + 3}">${esc(z.name)}</text>`);
}
// stops: kerb point, queue direction, name + route chips
for (const s of TOWN.stops) {
  const ex = s.p.x + s.queueDir.x * 2.4, ez = s.p.z + s.queueDir.z * 2.4;
  out.push(`<line x1="${X(s.p.x)}" y1="${Y(s.p.z)}" x2="${X(ex)}" y2="${Y(ez)}" stroke="${C.ink}" stroke-width="2" stroke-dasharray="2 3"/>`);
  out.push(`<circle cx="${X(s.p.x)}" cy="${Y(s.p.z)}" r="7" fill="${C.stop}" stroke="${C.ink}" stroke-width="2"/>`);
  const lx = X(s.p.x + s.queueDir.x * 3.3), ly = Y(s.p.z + s.queueDir.z * 3.3);
  const anchor = s.queueDir.x > 0.5 ? 'start' : s.queueDir.x < -0.5 ? 'end' : 'middle';
  const dy = s.queueDir.z > 0.5 ? 10 : s.queueDir.z < -0.5 ? -4 : 4;
  out.push(`<text class="stop" x="${lx}" y="${ly + dy}" text-anchor="${anchor}" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(s.name)}</text>`);
  s.servedRoutes.forEach((rid, i) => {
    const col = TOWN.routes.find((r) => r.id === rid)!.color;
    out.push(`<rect x="${X(s.p.x) - 10 + i * 9}" y="${Y(s.p.z) - 17}" width="8" height="8" rx="2" fill="${col}" stroke="#fff" stroke-width="1"/>`);
  });
}
// neighbourhood labels on top (faint)
for (const n of TOWN.neighborhoods) out.push(`<text class="hood" x="${X(n.center.x)}" y="${Y(n.center.z - n.radius * 0.62)}" text-anchor="middle">${esc(n.name.toUpperCase())}</text>`);

// legend
const ly0 = H - LEGEND_H + 8;
out.push(`<text x="${PAD}" y="${ly0 + 22}" style="font-size:24px;font-weight:700">Headway — town map</text>`);
TOWN.routes.forEach((r, i) => {
  const x = PAD + i * 260;
  out.push(`<rect x="${x}" y="${ly0 + 40}" width="22" height="12" rx="4" fill="${r.color}"/>`);
  out.push(`<text x="${x + 30}" y="${ly0 + 51}" style="font-size:14px">${r.id} ${esc(r.name)} · ${r.path.length.toFixed(0)} u · loop ${(r.nominalLoopS / 60).toFixed(1)} min</text>`);
});
out.push(`<rect x="${PAD + 780}" y="${ly0 + 40}" width="22" height="12" rx="3" fill="${C.ballast}" stroke="${C.ties}" stroke-width="2"/>`);
out.push(`<text x="${PAD + 810}" y="${ly0 + 51}" style="font-size:14px">rail loop ${TOWN.rail.loop.length.toFixed(0)} u · 3 stations · Stadium → University → Central</text>`);
out.push(`<text x="${PAD}" y="${ly0 + 78}" class="zone" style="font-size:12px">● stop (dotted line = queue direction) · ■ zone door (5–12 u from access) · red edge = building front · ${TOWN.roads.edges.length} road edges, ${TOWN.zones.length} zones, ${SCENERY.length} scenery items · map v${TOWN.version}</text>`);
out.push(`<text x="${PAD}" y="${ly0 + 98}" class="zone" style="font-size:12px;fill:${problems.length ? '#C0392B' : '#2E7D4F'}">${problems.length ? `${problems.length} layout problems — see console` : 'layout check: no overlaps with roads, rails, stops or each other'}</text>`);
out.push('</svg>');

writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT} (${W}×${H})`);
if (problems.length) {
  console.log(`${problems.length} layout problems:`);
  for (const p of problems) console.log('  - ' + p);
  process.exitCode = 1;
} else console.log('layout check passed');

/** Point i of a polyline offset sideways by `o` (left of travel when o < 0 in screen space). */
function offsetPoint(a: Vec2[], i: number, o: number, closed: boolean): Vec2 {
  const n = a.length;
  const p = a[i]!;
  const prev = a[(i - 1 + n) % n]!, next = a[(i + 1) % n]!;
  const useP = closed || i > 0 ? prev : p, useN = closed || i < n - 1 ? next : p;
  let dx = useN.x - useP.x, dz = useN.z - useP.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  return { x: p.x - dz * o, z: p.z + dx * o };
}
