// Owner: G0. The greater-town road layer: every RoadCell's Kenney city-kit-roads tile, recoloured to the Wooden
// Toy roles (cream lanes like the town's streets, white markings, warm sidewalks + light curbs) and merged into ONE
// clay KitMaterial mesh; the east-exit S-bend swept procedurally with the same cross-section; roundabout islands
// planted (one small shadow-casting mesh); and the ring's ground (board colour, one mesh, optional).
// Draw calls: 3. Kenney models must be preloaded (`await preloadGreaterRoads()`); without them the streets are swept
// procedurally from the grid centrelines (same look, simpler junctions).
import * as THREE from 'three';
import type { TownMap, Vec2 } from '@headway/sim';
import { KENNEY_SCALE, kenneyTemplate, preloadKenney } from '../../assets/kenney/index';
import type { KenneyId } from '../../assets/kenney/index';
import type { Baked } from '../../kit/bake';
import type { RenderLayer } from '../../layers';
import { KitMaterial } from '../../materials';
import { PALETTES, type Palette } from '../../palettes';
import type { PaletteId } from '../../types';
import { greaterGrid, type GreaterGrid } from '../grid';
import { KERB, TILE } from './cells';
import { offsetRight } from './lanes';
import { ROAD_MODELS, ROUNDABOUT } from './plan';
import { classifyRoadTri, roadColors, ROAD_ROLES, type RoadRole } from './tiles';

export interface GreaterRoadsOptions {
  palette?: PaletteId;
  /** Draw the ring's ground surface (default true). Turn off when another layer provides it. */
  ground?: boolean;
}

export interface GreaterRoadsLayer extends RenderLayer {
  readonly grid: GreaterGrid;
  /** Kenney tiles (or the procedural fallback) + connector, merged. */
  readonly roads: THREE.Mesh;
  readonly islands: THREE.Mesh;
  readonly ground: THREE.Mesh | null;
  /** True when every tile came from a Kenney model. */
  readonly kenney: boolean;
}

/** Kenney models the road layer uses (preload before createGreaterRoadsLayer). */
export const GREATER_ROAD_MODELS: readonly KenneyId[] = ROAD_MODELS;
export function preloadGreaterRoads(): Promise<void> {
  return preloadKenney([...GREATER_ROAD_MODELS]);
}

// ---------------------------------------------------------------- geometry accumulator (per-role buckets)
interface Bucket { pos: number[]; nor: number[]; idx: number[] }
class Acc {
  readonly b = new Map<RoadRole, Bucket>();
  bucket(role: RoadRole): Bucket {
    let k = this.b.get(role);
    if (!k) { k = { pos: [], nor: [], idx: [] }; this.b.set(role, k); }
    return k;
  }
  vert(role: RoadRole, p: THREE.Vector3 | Vec2 & { y?: number }, n: THREE.Vector3 | { x: number; y: number; z: number }): number {
    const k = this.bucket(role);
    const i = k.pos.length / 3;
    k.pos.push(p.x, (p as { y?: number }).y ?? 0, p.z);
    k.nor.push(n.x, n.y, n.z);
    return i;
  }
  quad(role: RoadRole, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void {
    // a-b-c-d counter-clockwise seen from the front face
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const k = this.bucket(role);
    const i = this.vert(role, a, n);
    this.vert(role, b, n); this.vert(role, c, n); this.vert(role, d, n);
    k.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** Indexed geometry with the given transform. `roleOf` decides per triangle (null = drop). */
  geometry(geo: THREE.BufferGeometry, m: THREE.Matrix4, roleOf: (tri: { uv: [number, number]; ny: number }) => RoadRole | null): void {
    const P = geo.getAttribute('position'), N = geo.getAttribute('normal'), UV = geo.getAttribute('uv');
    const I = geo.getIndex();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const count = I ? I.count : P.count;
    const remap = new Map<number, number>();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tmp = new THREE.Vector3(), tn = new THREE.Vector3();
    for (let t = 0; t + 2 < count; t += 3) {
      const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
      va.fromBufferAttribute(P, ia).applyMatrix4(m);
      vb.fromBufferAttribute(P, ib).applyMatrix4(m);
      vc.fromBufferAttribute(P, ic).applyMatrix4(m);
      const fn = e1.subVectors(vb, va).cross(e2.subVectors(vc, va));
      const L = fn.length();
      if (L < 1e-12) continue;
      const ny = (flip ? -fn.y : fn.y) / L;
      const uv: [number, number] = UV ? [(UV.getX(ia) + UV.getX(ib) + UV.getX(ic)) / 3, (UV.getY(ia) + UV.getY(ib) + UV.getY(ic)) / 3] : [0.28, 0.87];
      const role = roleOf({ uv, ny });
      if (!role) continue;
      const k = this.bucket(role);
      const ri = ROAD_ROLES.indexOf(role);
      const tri = flip ? [ia, ic, ib] : [ia, ib, ic];
      for (const vi of tri) {
        const key = ri * 1_000_000 + vi;
        let ni = remap.get(key);
        if (ni === undefined) {
          tmp.fromBufferAttribute(P, vi).applyMatrix4(m);
          if (N) tn.fromBufferAttribute(N, vi).applyMatrix3(nm).normalize(); else tn.set(0, 1, 0);
          ni = this.vert(role, tmp, tn);
          remap.set(key, ni);
        }
        k.idx.push(ni);
      }
    }
  }
  build(palette: PaletteId): THREE.BufferGeometry {
    let nv = 0, ni = 0;
    for (const r of ROAD_ROLES) { const k = this.b.get(r); if (k) { nv += k.pos.length / 3; ni += k.idx.length; } }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const ranges: Baked['ranges'] = [];
    let vo = 0, io = 0;
    for (const r of ROAD_ROLES) {
      const k = this.b.get(r);
      if (!k || !k.idx.length) continue;
      pos.set(k.pos, vo * 3);
      nor.set(k.nor, vo * 3);
      for (let i = 0; i < k.idx.length; i++) index[io + i] = k.idx[i]! + vo;
      const n = k.pos.length / 3;
      ranges.push({ role: ROLE_NAME[r], idx: 0, start: vo, count: n, detail: false, tint: false });
      vo += n; io += k.idx.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(nv), 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const baked: Baked = { geometry: geo, ranges, baseIndexCount: ni, resolve: resolveRole };
    geo.userData.kit = baked;
    recolor(geo, palette);
    return geo;
  }
}

/** Baked-range role names (prefixed so they never collide with palette roles like `mark` / `curb`). */
const ROLE_NAME: Record<RoadRole, string> = Object.fromEntries(ROAD_ROLES.map((r) => [r, `gx${r[0]!.toUpperCase()}${r.slice(1)}`])) as Record<RoadRole, string>;
const ROLE_OF = new Map(ROAD_ROLES.map((r) => [ROLE_NAME[r], r] as const));
const paletteIdOf = (P: Palette): PaletteId => (Object.keys(PALETTES) as PaletteId[]).find((k) => PALETTES[k] === P || PALETTES[k].name === P.name) ?? 'a';
function resolveRole(role: string, _idx: number, P: Palette): string | undefined {
  const r = ROLE_OF.get(role);
  return r ? roadColors(paletteIdOf(P))[r] : undefined;
}

const col = new THREE.Color();
function recolor(geo: THREE.BufferGeometry, palette: PaletteId): void {
  const baked = geo.userData.kit as Baked | undefined;
  if (!baked) return;
  const colors = roadColors(palette);
  const a = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = a.array as Float32Array;
  for (const r of baked.ranges) {
    col.set(colors[ROLE_OF.get(r.role) ?? 'lane']);
    for (let i = r.start; i < r.start + r.count; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  }
  a.needsUpdate = true;
}

// ---------------------------------------------------------------- procedural cross-section (connector, fallback)
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Sweep the Kenney road cross-section along a centreline (sidewalks ±KERB.walk, curbs at ±KERB.carriage). */
function sweepRoad(acc: Acc, pts: readonly Vec2[], opts: { mark?: boolean } = {}): void {
  if (pts.length < 2) return;
  const yW = KERB.walkTop, yR = KERB.roadTop, ym = yR + 0.0015;
  const line = (lat: number) => (lat === 0 ? [...pts] : offsetRight(pts, lat));
  const strip = (l0: number, l1: number, y: number, role: RoadRole) => {
    const A = line(l0), B = line(l1);
    for (let i = 0; i + 1 < pts.length; i++) {
      // l0 is left of l1 (looking along the path): quad a(l0,i) → b(l1,i) → c(l1,i+1) → d(l0,i+1) faces up
      acc.quad(role, V(A[i]!.x, y, A[i]!.z), V(B[i]!.x, y, B[i]!.z), V(B[i + 1]!.x, y, B[i + 1]!.z), V(A[i + 1]!.x, y, A[i + 1]!.z));
    }
  };
  const wall = (lat: number, y0: number, y1: number, facingRight: boolean, role: RoadRole) => {
    const A = line(lat);
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = A[i]!, q = A[i + 1]!;
      if (facingRight) acc.quad(role, V(p.x, y0, p.z), V(q.x, y0, q.z), V(q.x, y1, q.z), V(p.x, y1, p.z));
      else acc.quad(role, V(q.x, y0, q.z), V(p.x, y0, p.z), V(p.x, y1, p.z), V(q.x, y1, q.z));
    }
  };
  const W = KERB.walk, C = KERB.carriage, G = KERB.carriage - 0.4, M = opts.mark === false ? 0 : 0.04;
  strip(-W, -C, yW, 'walk'); strip(C, W, yW, 'walk');
  wall(-C, yR, yW, true, 'curb'); wall(C, yR, yW, false, 'curb');
  wall(-W, 0, yW, false, 'curb'); wall(W, 0, yW, true, 'curb');
  strip(-C, -G, yR, 'gutter'); strip(G, C, yR, 'gutter');
  if (M) { strip(-G, -M, yR, 'lane'); strip(M, G, yR, 'lane'); strip(-M, M, ym, 'mark'); }
  else strip(-G, G, yR, 'lane');
}

function disc(acc: Acc, center: Vec2, r0: number, r1: number, y: number, role: RoadRole, segs = 40): void {
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2, b = ((i + 1) / segs) * Math.PI * 2;
    const p = (r: number, t: number) => V(center.x + Math.cos(t) * r, y, center.z + Math.sin(t) * r);
    // counter-clockwise seen from above (+y): angle increases from +x toward +z, which is clockwise from above,
    // so walk the ring in the reverse order
    acc.quad(role, p(r1, a), p(r0, a), p(r0, b), p(r1, b));
  }
}

function rectXZ(acc: Acc, x0: number, z0: number, x1: number, z1: number, y: number, role: RoadRole): void {
  if (x1 - x0 < 1e-6 || z1 - z0 < 1e-6) return;
  acc.quad(role, V(x0, y, z0), V(x0, y, z1), V(x1, y, z1), V(x1, y, z0));
}

/** Axis-aligned box walls (+ optional bottom-less top); `skip` sides are not drawn (they butt onto a neighbour). */
function box(acc: Acc, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, role: RoadRole, skip: Array<'n' | 'e' | 's' | 'w'> = []): void {
  rectXZ(acc, x0, z0, x1, z1, y1, role);
  if (!skip.includes('s')) acc.quad(role, V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1));
  if (!skip.includes('n')) acc.quad(role, V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0));
  if (!skip.includes('e')) acc.quad(role, V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1));
  if (!skip.includes('w')) acc.quad(role, V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0));
}

// ---------------------------------------------------------------- the layer
export function createGreaterRoadsLayer(map: TownMap, opts: GreaterRoadsOptions = {}): GreaterRoadsLayer {
  const grid = greaterGrid(map);
  let palette: PaletteId = opts.palette ?? 'a';

  // tile scale: Kenney road tiles are 1 kit unit; the template bakes KENNEY_SCALE in, we want TILE
  const straight = kenneyTemplate('city-kit-roads/road-straight');
  const scale = straight ? TILE / Math.max(straight.size.x, straight.size.z) : TILE / KENNEY_SCALE['city-kit-roads'];
  const allKenney = grid.roads.every((t) => !t.model || !!kenneyTemplate(t.model));

  const roads = new Acc();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(scale, scale, scale), up = new THREE.Vector3(0, 1, 0);
  const classify = ({ uv, ny }: { uv: [number, number]; ny: number }) => classifyRoadTri(uv[0], uv[1], ny);
  if (allKenney) {
    for (const t of grid.roads) {
      if (!t.model) continue;
      const tpl = kenneyTemplate(t.model)!;
      m.compose(new THREE.Vector3(t.center.x, 0, t.center.z), q.setFromAxisAngle(up, t.rot), s);
      for (const part of tpl.parts) roads.geometry(part.geometry, m, classify);
    }
  } else {
    // fallback: sweep every street stretch; flat pads under junctions; rings for roundabouts
    for (const st of grid.streets) for (const p of st.paths) sweepRoad(roads, p.points);
    for (const j of grid.junctions) {
      if (j.kind === 'roundabout') continue;
      const h = TILE / 2;
      rectXZ(roads, j.center.x - h, j.center.z - h, j.center.x + h, j.center.z + h, KERB.roadTop, 'lane');
    }
    for (const r of grid.roundabouts) {
      disc(roads, r.center, ROUNDABOUT.islandR, ROUNDABOUT.outerR, KERB.roadTop, 'lane');
      disc(roads, r.center, ROUNDABOUT.outerR, ROUNDABOUT.outerR + 0.4, KERB.walkTop, 'walk');
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = { x: r.center.x + d[0] * ROUNDABOUT.outerR, z: r.center.z + d[1] * ROUNDABOUT.outerR };
        const b = { x: r.center.x + d[0] * ROUNDABOUT.armR, z: r.center.z + d[1] * ROUNDABOUT.armR };
        sweepRoad(roads, [a, b], { mark: false });
      }
    }
  }
  // procedural pieces (the east-exit S-bend): the street stretch that runs through a connector tile
  for (const t of grid.roads) {
    if (t.kind !== 'connector') continue;
    const k = t.cells;
    const inCell = (p: Vec2) => p.x >= grid.origin.x + k.c * TILE - 1e-6 && p.x <= grid.origin.x + (k.c + k.w) * TILE + 1e-6
      && p.z >= grid.origin.z + k.r * TILE - 1e-6 && p.z <= grid.origin.z + (k.r + k.h) * TILE + 1e-6;
    for (const st of grid.streets) for (const p of st.paths) {
      if (allKenney && p.points.every(inCell)) sweepRoad(roads, p.points);
    }
  }
  const roadsGeo = roads.build(palette);

  // roundabout islands: a low lawn mound in the Kenney island hole + five clipped shrubs (centre left free)
  const isl = new Acc();
  const dome = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const shrub = new THREE.IcosahedronGeometry(1, 1);
  const keepAll = () => 'island' as RoadRole;
  for (const r of grid.roundabouts) {
    const c = new THREE.Vector3(r.center.x, KERB.walkTop - 0.02, r.center.z);
    isl.geometry(dome, new THREE.Matrix4().compose(c, new THREE.Quaternion(), new THREE.Vector3(1.18, 0.32, 1.18)), keepAll);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const p = new THREE.Vector3(r.center.x + Math.cos(a) * 0.72, KERB.walkTop + 0.2, r.center.z + Math.sin(a) * 0.72);
      isl.geometry(shrub, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.24, 0.2, 0.24)), () => 'shrub');
    }
  }
  dome.dispose(); shrub.dispose();

  // causeways: a stone embankment under every road tile over the bay (top hidden under the tile)
  for (const t of grid.roads) {
    if (!t.bridge) continue;
    const ns = t.open.includes('n') || t.open.includes('s');
    const hw = TILE / 2 + 0.35, hl = TILE / 2, c = t.center, y0 = -1.1, y1 = -0.004;
    const x0 = c.x - (ns ? hw : hl), x1 = c.x + (ns ? hw : hl), z0 = c.z - (ns ? hl : hw), z1 = c.z + (ns ? hl : hw);
    box(isl, x0, y0, z0, x1, y1, z1, 'stone', ns ? ['e', 'w'] : ['n', 's']);
  }
  const islandsGeo = isl.build(palette);

  // ground: the land around the board (the grid cut by the shoreline; a hole under the board, tucked 0.6 u beneath
  // its edge so no seam shows)
  let groundGeo: THREE.BufferGeometry | null = null;
  if (opts.ground !== false) {
    const gr = new Acc(), b = grid.bounds, B = map.bounds, t = 0.6, y = -0.012;
    const contour = [new THREE.Vector2(b.minX, b.minZ), new THREE.Vector2(b.maxX, b.minZ), ...grid.shore.map((p) => new THREE.Vector2(p.x, p.z))];
    const hole = [
      new THREE.Vector2(B.minX + t, B.minZ + t), new THREE.Vector2(B.minX + t, B.maxZ - t),
      new THREE.Vector2(B.maxX - t, B.maxZ - t), new THREE.Vector2(B.maxX - t, B.minZ + t),
    ];
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(contour, [hole]);
    const pts = [...contour, ...hole];
    const k = gr.bucket('ground');
    const up = { x: 0, y: 1, z: 0 };
    for (const p of pts) gr.vert('ground', { x: p.x, y, z: p.y }, up);
    for (const [a, c2, d] of tris) {
      const A = pts[a]!, C = pts[c2]!, D = pts[d]!;
      // keep +y facing: (C − A) × (D − A) in x/z (z = vector2.y) must point up
      const cy = (D.x - A.x) * (C.y - A.y) - (C.x - A.x) * (D.y - A.y);
      if (cy >= 0) k.idx.push(a, c2, d); else k.idx.push(a, d, c2);
    }
    groundGeo = gr.build(palette);
  }

  const material = new KitMaterial({ roughness: 0.92 });
  const object = new THREE.Group();
  object.name = 'greater-roads';
  const roadsMesh = new THREE.Mesh(roadsGeo, material);
  roadsMesh.name = 'greater-roads:tiles';
  roadsMesh.receiveShadow = true;
  const islandsMesh = new THREE.Mesh(islandsGeo, material);
  islandsMesh.name = 'greater-roads:islands';
  islandsMesh.castShadow = true;
  islandsMesh.receiveShadow = true;
  object.add(roadsMesh, islandsMesh);
  let groundMesh: THREE.Mesh | null = null;
  if (groundGeo) {
    groundMesh = new THREE.Mesh(groundGeo, material);
    groundMesh.name = 'greater-roads:ground';
    groundMesh.receiveShadow = true;
    object.add(groundMesh);
  }
  const geos = [roadsGeo, islandsGeo, ...(groundGeo ? [groundGeo] : [])];

  return {
    name: 'greater-roads',
    object,
    grid,
    roads: roadsMesh,
    islands: islandsMesh,
    ground: groundMesh,
    kenney: allKenney,
    update() {},
    setPalette(p: PaletteId) {
      palette = p;
      for (const g of geos) recolor(g, p);
    },
    dispose() {
      for (const g of geos) g.dispose();
      material.dispose();
    },
  };
}
