// Owner: G3. Procedural waterfront pieces (three.js): stone promenade ribbons, timber decks on piles (boardwalks,
// piers, fingers, lookouts), white rails, a pier pavilion, bollards and a telescope. Every mesh carries a palette /
// G3 role on its material (userData.role) so the layer can bake everything into one vertex-coloured geometry.
import * as THREE from 'three';
import type { Vec2 } from '@headway/sim';
import type { RoleColors } from '../../assets/types';
import { WF, type WfDeck, type WfPavilion, type WfRun } from './plan';

/** G3 palette roles: [palette a, b, c]. Wood + stone harmonised with the town's platforms, kerbs and benches. */
export const WF_ROLES: RoleColors = {
  wfPave: [['#E6E0D3', '#DED7C8'], ['#DCD2BF', '#D3C8B3'], ['#E2DED5', '#D9D4CA']],
  wfPaveEdge: ['#C9C0AE', '#BBAF98', '#C4BDB0'],
  wfDeck: [['#CFA274', '#C39468', '#D8AE80'], ['#B08A63', '#A27E59', '#BA956C'], ['#B08A68', '#A47F5E', '#BC9774']],
  wfBeam: ['#9C7553', '#7E604A', '#7A5D47'],
  wfPile: ['#8A6A50', '#6C5442', '#64503F'],
  wfRail: ['#FFF8EC', '#F5EFE3', '#FFFFFF'],
  wfStone: ['#CFC4AF', '#BDB09A', '#C9C3B6'],
  wfDark: ['#4A4F5C', '#3E3A36', '#3E4B5C'],
  wfBrass: ['#E2B65A', '#C99A45', '#D9A441'],
  wfRoof: ['#E58A6A', '#9C5440', '#56677E'],
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Role-tagged placeholder material (the bake reads userData.role / idx; the colour is only for unbaked previews). */
export function roleMat(role: string, idx = 0): THREE.MeshStandardMaterial {
  const key = `${role}#${idx}`;
  let m = matCache.get(key);
  if (!m) {
    const e = WF_ROLES[role]?.[0];
    const hex = Array.isArray(e) ? e[idx % e.length]! : (e ?? '#9AA0A6');
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85 });
    m.name = key;
    m.userData.role = role;
    m.userData.idx = idx;
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const box = (w: number, h: number, d: number) => cached(`b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 7) => cached(`c${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));

function mesh(geo: THREE.BufferGeometry, role: string, idx = 0, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, roleMat(role, idx));
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** Place a mesh at (x, y, z) with yaw so its local +z points along `f` (local +x = right of f... i.e. (f.z, −f.x)). */
function put(o: THREE.Object3D, x: number, y: number, z: number, f?: Vec2): THREE.Object3D {
  o.position.set(x, y, z);
  if (f) o.rotation.y = Math.atan2(f.x, f.z);
  return o;
}

const add = (p: Vec2, d: Vec2, s: number): Vec2 => ({ x: p.x + d.x * s, z: p.z + d.z * s });
const right = (d: Vec2): Vec2 => ({ x: -d.z, z: d.x });

// ---------------------------------------------------------------- promenade ribbon
/** Stone promenade: a slightly raised paved band with darker edge borders and kerb faces, along a polyline. */
export function buildPromenade(run: WfRun): THREE.Group {
  const g = new THREE.Group();
  const hw = run.width / 2, border = 0.22, top = WF.paveTop;
  const P = run.pts;
  const side = (o: number) => P.map((p, i) => add(p, run.sea[i]!, o));
  // bands across the width (sea side = +): [from, to, role]
  const bands: Array<[number, number, string]> = [[-hw, -hw + border, 'wfPaveEdge'], [-hw + border, hw - border, 'wfPave'], [hw - border, hw, 'wfPaveEdge']];
  const SLAB = 5; // samples per paving slab band (alternating shades in the centre)
  for (const [o0, o1, role] of bands) {
    const A = side(o0), B = side(o1);
    const pos: number[] = [];
    for (let i = 0; i < P.length; i++) pos.push(A[i]!.x, top, A[i]!.z, B[i]!.x, top, B[i]!.z);
    const slabs = role === 'wfPave' ? 2 : 1;
    for (let v = 0; v < slabs; v++) {
      const idx: number[] = [];
      for (let i = 0; i + 1 < P.length; i++) {
        if (slabs > 1 && Math.floor(i / SLAB) % 2 !== v) continue;
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      if (idx.length) g.add(mesh(ribbon(pos, idx), role, v, false));
    }
  }
  // kerb faces (outer edges), from the paving down to just below the ground
  for (const o of [-hw, hw]) {
    const E = side(o);
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < P.length; i++) pos.push(E[i]!.x, top, E[i]!.z, E[i]!.x, -0.05, E[i]!.z);
    for (let i = 0; i + 1 < P.length; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (o > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    g.add(mesh(ribbon(pos, idx), 'wfPaveEdge', 0, false));
  }
  // end caps
  for (const i of [0, P.length - 1]) {
    const a = add(P[i]!, run.sea[i]!, -hw), b = add(P[i]!, run.sea[i]!, hw);
    const pos = [a.x, top, a.z, b.x, top, b.z, a.x, -0.05, a.z, b.x, -0.05, b.z];
    g.add(mesh(ribbon(pos, i === 0 ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3]), 'wfPaveEdge', 0, false));
  }
  return g;
}

/** Low stone sea wall along the promenade's sea edge (gaps where jetties leave). */
export function buildSeaWall(run: WfRun): THREE.Group {
  const g = new THREE.Group();
  const hw = run.width / 2, h = 0.24, w = 0.26, gaps = run.gaps ?? [];
  const P = run.pts;
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = add(P[i]!, run.sea[i]!, hw - w / 2), b = add(P[i + 1]!, run.sea[i + 1]!, hw - w / 2);
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const mid = acc + L / 2;
    acc += L;
    if (L < 1e-3 || gaps.some(([s0, s1]) => mid > s0 && mid < s1)) continue;
    const f = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    g.add(put(mesh(box(w, h, L + 0.06), 'wfStone', 0, true), (a.x + b.x) / 2, WF.paveTop + h / 2, (a.z + b.z) / 2, f));
  }
  return g;
}

function ribbon(pos: number[], idx: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // flat-ish: recompute per-vertex normals, then make every face read upward-or-outward consistently
  const ni = geo.toNonIndexed();
  ni.computeVertexNormals();
  return ni;
}

// ---------------------------------------------------------------- timber decks
const PLANK = 0.3, GAP = 0.035;

/** Planks across a deck strip, stringers, piles down into the water. Frame: centre c, along dir, width w. */
export function buildDeck(d: WfDeck): THREE.Group {
  const g = new THREE.Group();
  const top = d.top, th = WF.deckThick;
  const n = Math.max(1, Math.round(d.len / PLANK));
  const step = d.len / n;
  const start = add(d.c, d.dir, -d.len / 2);
  const plank = box(d.w, th, step - GAP);
  for (let i = 0; i < n; i++) {
    const p = add(start, d.dir, (i + 0.5) * step);
    g.add(put(mesh(plank, 'wfDeck', i % 3 === 1 ? 1 : i % 5 === 3 ? 2 : 0, false), p.x, top - th / 2, p.z, d.dir));
  }
  // stringers under the planks
  const sd = right(d.dir);
  const beam = box(0.14, 0.16, d.len);
  for (const s of [-1, 1]) {
    const p = add(d.c, sd, s * (d.w / 2 - 0.12));
    g.add(put(mesh(beam, 'wfBeam', 0, false), p.x, top - th - 0.08, p.z, d.dir));
  }
  // piles: pairs every ~1.7 u (skip on short fingers' inner end)
  const pn = Math.max(1, Math.round(d.len / 1.7));
  const pileH = top - th - WF.pileBottom;
  const pile = cyl(0.085, 0.095, pileH);
  for (let i = 0; i <= pn; i++) {
    const at = -d.len / 2 + (i / pn) * d.len;
    for (const s of [-1, 1]) {
      const p = add(add(d.c, d.dir, at * 0.96), sd, s * (d.w / 2 - 0.05));
      g.add(put(mesh(pile, 'wfPile', 0, false), p.x, WF.pileBottom + pileH / 2, p.z));
    }
  }
  // rails
  const from = d.railFrom ?? 0;
  for (const side of d.rails) {
    if (side === 'l' || side === 'r') {
      const s = side === 'r' ? 1 : -1;
      const a = add(add(start, d.dir, from), sd, s * (d.w / 2 - 0.05));
      const b = add(add(start, d.dir, d.len), sd, s * (d.w / 2 - 0.05));
      railLine(g, a, b, top);
    } else {
      const at = side === 's' ? 0.05 : d.len - 0.05;
      const m = add(start, d.dir, at);
      railLine(g, add(m, sd, -d.w / 2 + 0.05), add(m, sd, d.w / 2 - 0.05), top);
    }
  }
  return g;
}

/** White post-and-rail fence from a to b standing on `y`. */
export function railLine(g: THREE.Group, a: Vec2, b: Vec2, y: number, h = 0.52): void {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.2) return;
  const f = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  const n = Math.max(1, Math.round(L / 1.15));
  const post = box(0.075, h, 0.075);
  for (let i = 0; i <= n; i++) {
    const p = add(a, f, (i / n) * L);
    g.add(put(mesh(post, 'wfRail', 0, true), p.x, y + h / 2, p.z, f));
  }
  const m = add(a, f, L / 2);
  g.add(put(mesh(box(0.07, 0.07, L + 0.04), 'wfRail', 0, true), m.x, y + h - 0.02, m.z, f));
  g.add(put(mesh(box(0.045, 0.045, L), 'wfRail', 0, false), m.x, y + h * 0.5, m.z, f));
}

/** A timber boardwalk along a run: planks across the path following the curve, stringers, piles; a rail on the sea side. */
export function buildBoardwalk(run: WfRun): THREE.Group {
  const g = new THREE.Group();
  const top = WF.walkTop, th = WF.deckThick, hw = run.width / 2;
  const n = Math.max(2, Math.round(run.length / PLANK));
  const step = run.length / n;
  // walk the run by arc length
  const P = run.pts;
  const seg: Array<{ a: Vec2; b: Vec2; L: number; s0: number; i: number }> = [];
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const L = Math.hypot(P[i + 1]!.x - P[i]!.x, P[i + 1]!.z - P[i]!.z);
    seg.push({ a: P[i]!, b: P[i + 1]!, L, s0: acc, i });
    acc += L;
  }
  const at = (s: number) => {
    const k = seg.find((q) => q.s0 + q.L >= s) ?? seg[seg.length - 1]!;
    const t = k.L > 0 ? Math.min(1, Math.max(0, (s - k.s0) / k.L)) : 0;
    const sa = run.sea[k.i]!, sb = run.sea[k.i + 1]!;
    const sx = sa.x + (sb.x - sa.x) * t, sz = sa.z + (sb.z - sa.z) * t, sl = Math.hypot(sx, sz) || 1;
    return { p: { x: k.a.x + (k.b.x - k.a.x) * t, z: k.a.z + (k.b.z - k.a.z) * t }, sea: { x: sx / sl, z: sz / sl } };
  };
  const plank = box(run.width, th, step - GAP);
  for (let i = 0; i < n; i++) {
    const { p, sea } = at((i + 0.5) * step);
    const along = { x: -sea.z, z: sea.x };
    g.add(put(mesh(plank, 'wfDeck', i % 3 === 1 ? 1 : i % 5 === 3 ? 2 : 0, false), p.x, top - th / 2, p.z, along));
  }
  // stringers + piles + sea rail, per ~1.6 u stretch
  const m = Math.max(1, Math.round(run.length / 1.6));
  const pileH = top - th - WF.pileBottom;
  const pile = cyl(0.085, 0.095, pileH);
  let prevRail: Vec2 | null = null;
  const railPts: Vec2[] = [];
  for (let i = 0; i <= m; i++) {
    const s = (i / m) * run.length;
    const { p, sea } = at(Math.min(run.length - 0.05, Math.max(0.05, s)));
    for (const o of [-hw + 0.06, hw - 0.06]) {
      const q = add(p, sea, o);
      g.add(put(mesh(pile, 'wfPile', 0, false), q.x, WF.pileBottom + pileH / 2, q.z));
    }
    railPts.push(add(p, sea, hw - 0.05));
    if (i > 0) {
      const { p: p0, sea: s0 } = at(Math.max(0.05, ((i - 1) / m) * run.length));
      for (const o of [-hw + 0.14, hw - 0.14]) {
        const a = add(p0, s0, o), b = add(p, sea, o);
        const L = Math.hypot(b.x - a.x, b.z - a.z), f = { x: (b.x - a.x) / (L || 1), z: (b.z - a.z) / (L || 1) };
        const c = add(a, f, L / 2);
        g.add(put(mesh(box(0.14, 0.16, L + 0.05), 'wfBeam', 0, false), c.x, top - th - 0.08, c.z, f));
      }
    }
    prevRail = railPts[railPts.length - 1]!;
  }
  void prevRail;
  // the sea-side rail: posts at the pile stations, rails between them
  const h = 0.52;
  const post = box(0.075, h, 0.075);
  const gaps = run.gaps ?? [];
  const railS = (i: number) => (i / m) * run.length;
  const gapAt = (s: number) => gaps.some(([s0, s1]) => s > s0 && s < s1);
  for (let i = 0; i < railPts.length; i++) {
    const p = railPts[i]!;
    if (gapAt(railS(i))) continue;
    g.add(put(mesh(post, 'wfRail', 0, true), p.x, top + h / 2, p.z));
    if (i > 0 && !gapAt(railS(i - 1)) && !gapAt((railS(i - 1) + railS(i)) / 2)) {
      const a = railPts[i - 1]!, L = Math.hypot(p.x - a.x, p.z - a.z), f = { x: (p.x - a.x) / (L || 1), z: (p.z - a.z) / (L || 1) };
      const c = add(a, f, L / 2);
      g.add(put(mesh(box(0.07, 0.07, L + 0.04), 'wfRail', 0, true), c.x, top + h - 0.02, c.z, f));
      g.add(put(mesh(box(0.045, 0.045, L), 'wfRail', 0, false), c.x, top + h * 0.5, c.z, f));
    }
  }
  return g;
}

// ---------------------------------------------------------------- small pieces
/** Open hexagonal pavilion on a pier head: white posts, a soft terracotta roof, a finial. */
export function buildPavilion(p: WfPavilion): THREE.Group {
  const g = new THREE.Group();
  const r = p.r, posts = 6, h = 1.35;
  const floor = mesh(cyl(r + 0.08, r + 0.12, 0.1, posts * 2), 'wfStone', 0, false);
  floor.position.set(0, 0.05, 0);
  g.add(floor);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2 + Math.PI / posts;
    g.add(put(mesh(box(0.11, h, 0.11), 'wfRail'), Math.cos(a) * (r - 0.1), 0.1 + h / 2, Math.sin(a) * (r - 0.1)));
  }
  // low rail between posts (open on the shore side)
  for (let i = 0; i < posts; i++) {
    if (i === 1) continue;
    const a0 = (i / posts) * Math.PI * 2 + Math.PI / posts, a1 = ((i + 1) / posts) * Math.PI * 2 + Math.PI / posts;
    const A = { x: Math.cos(a0) * (r - 0.1), z: Math.sin(a0) * (r - 0.1) }, B = { x: Math.cos(a1) * (r - 0.1), z: Math.sin(a1) * (r - 0.1) };
    const L = Math.hypot(B.x - A.x, B.z - A.z), f = { x: (B.x - A.x) / L, z: (B.z - A.z) / L };
    g.add(put(mesh(box(0.06, 0.06, L), 'wfRail', 0, false), (A.x + B.x) / 2, 0.55, (A.z + B.z) / 2, f));
  }
  const eave = mesh(cyl(r + 0.32, r + 0.32, 0.08, posts), 'wfRail');
  eave.position.y = 0.1 + h + 0.04;
  eave.rotation.y = Math.PI / posts;
  g.add(eave);
  const roof = mesh(cached(`roof${r}`, () => new THREE.ConeGeometry(r + 0.38, 0.95, posts)), 'wfRoof');
  roof.position.y = 0.1 + h + 0.08 + 0.475;
  roof.rotation.y = Math.PI / posts;
  g.add(roof);
  const fin = mesh(cached('fin', () => new THREE.SphereGeometry(0.1, 10, 7)), 'wfBrass');
  fin.position.y = 0.1 + h + 0.08 + 0.95 + 0.04;
  g.add(fin);
  g.position.set(p.c.x, p.y, p.c.z);
  return g;
}

export function buildBollard(): THREE.Group {
  const g = new THREE.Group();
  const b = mesh(cyl(0.075, 0.09, 0.22, 10), 'wfDark');
  b.position.y = 0.11;
  const cap = mesh(cyl(0.11, 0.11, 0.05, 10), 'wfDark');
  cap.position.y = 0.23;
  g.add(b, cap);
  return g;
}

/** Coin-op telescope on a post, looking along +z. */
export function buildTelescope(): THREE.Group {
  const g = new THREE.Group();
  const post = mesh(cyl(0.05, 0.07, 0.75, 10), 'wfDark');
  post.position.y = 0.375;
  const base = mesh(cyl(0.16, 0.18, 0.06, 10), 'wfDark');
  base.position.y = 0.03;
  const tube = mesh(cyl(0.07, 0.1, 0.5, 10), 'wfBrass');
  tube.rotation.x = Math.PI / 2 - 0.25;
  tube.position.set(0, 0.85, 0.06);
  const head = mesh(box(0.2, 0.18, 0.16), 'wfDark');
  head.position.y = 0.78;
  g.add(post, base, tube, head);
  return g;
}
