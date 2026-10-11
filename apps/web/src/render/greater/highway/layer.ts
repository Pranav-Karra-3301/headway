// Owner: G1. The highway render layer: expressway, overpass + embankments, slip roads, North Rd link + junction
// tiles, guardrails / parapets / median barrier, gantries, lights, pillars, signals, the twin-bore tunnel portal in
// its hillside, and verge planting. Two merged KitMaterial meshes (surface: flat, receives shadows; structures:
// casts + receives) = 2 draw calls. Kenney models must be preloaded (`await preloadGreaterHighway()`); without them
// every prop falls back to simple primitives and the junction tiles to procedural pads.
import * as THREE from 'three';
import type { TownMap, Vec2 } from '@headway/sim';
import { kenneyTemplate, preloadKenney, type KenneyId, type KenneyPartInfo } from '../../assets/kenney/index';
import type { RenderLayer } from '../../layers';
import { KitMaterial } from '../../materials';
import type { PaletteId } from '../../types';
import { KERB } from '../roads/cells';
import { classifyRoadTri } from '../roads/tiles';
import { Acc, band, dashes, knKey, latMap, path3, recolorHighway, ribbon, soffit, wall, type ColorKey, type Path3 } from './mesh';
import { HW, hash01, highwayPlan, type HighwayPlan, type Prop } from './plan';

export interface GreaterHighwayOptions {
  palette?: PaletteId;
}

export interface GreaterHighwayLayer extends RenderLayer {
  readonly plan: HighwayPlan;
  /** Road surfaces, kerbs, markings, junction tiles (receive shadows). */
  readonly surface: THREE.Mesh;
  /** Deck, walls, barriers, portal, hill, props, trees (cast + receive). */
  readonly structures: THREE.Mesh;
  /** True when every Kenney model the layer uses was preloaded. */
  readonly kenney: boolean;
}

const R = (n: string) => `city-kit-roads/${n}` as KenneyId;
const N = (n: string) => `nature-kit/${n}` as KenneyId;
const PINES = [N('tree_pineDefaultA'), N('tree_pineRoundA'), N('tree_pineRoundE'), N('tree_pineTallC_detailed')];
const TREES = [N('tree_default'), N('tree_oak'), N('tree_detailed')];
const BUSHES = [N('tree_fat'), N('tree_default'), N('tree_fat')];
const ROCKS = [N('rock_largeA'), N('rock_largeD'), N('rock_smallTopB'), N('rock_largeC')];
const TILES = { cross: R('road-crossroad'), tee: R('road-intersection'), straight: R('road-straight') };
const PROPS = { light: R('light-curved-double'), gantry: R('sign-highway-detailed'), gantryWide: R('sign-highway-wide'), pillar: R('bridge-pillar-wide'), signal: R('traffic-light') };

/** Every Kenney model the highway layer may place (preload these). */
export const GREATER_HIGHWAY_MODELS: readonly KenneyId[] = [...Object.values(TILES), ...Object.values(PROPS), ...PINES, ...TREES, ...BUSHES, ...ROCKS];
export function preloadGreaterHighway(): Promise<void> {
  return preloadKenney([...GREATER_HIGHWAY_MODELS]);
}

/** Road-kit props at the road tiles' scale (one kit unit = one 4 u tile); K0 bakes 2.6 u per kit unit. */
const ROAD_KIT = 2.6;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
const mat4 = (x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rot), V(sx, sy, sz));

/** Insert every part of a loaded Kenney template; `remap` may replace a part's colour key. */
function kenneyInto(acc: Acc, id: KenneyId, m: THREE.Matrix4, remap?: (info: KenneyPartInfo) => ColorKey | null | undefined): boolean {
  const t = kenneyTemplate(id);
  if (!t) return false;
  for (const p of t.parts) acc.geometry(p.geometry, m, remap?.(p.info) ?? knKey(p.info.role, p.info.idx, p.info.shade));
  return true;
}

// ---------------------------------------------------------------- the layer
export function createGreaterHighwayLayer(map: TownMap, opts: GreaterHighwayOptions = {}): GreaterHighwayLayer {
  const plan = highwayPlan(map);
  const g = plan.grid, T = g.tile;
  let palette: PaletteId = opts.palette ?? 'a';
  const kenney = GREATER_HIGHWAY_MODELS.every((id) => !!kenneyTemplate(id));
  const S = new Acc(), X = new Acc();
  const { xn, zc, xPortal, xw, xe } = plan;
  const D0 = HW.divergeStart, D1 = HW.divergeEnd, M0 = HW.mergeStart, M1 = HW.mergeEnd;
  const top = HW.roadTop;

  // ---- expressway centreline (+x), dense on the ramps
  const breaks = [xn - D0, xn - D1, xn + M0, xn + M1, xn + D1, xn + D0, xn - M1, xn - M0, plan.deck[0], plan.deck[1], plan.elevated[0], plan.elevated[1], xPortal, xPortal + 0.8];
  const xsAlong = (a: number, b: number): number[] => {
    const set = new Set<number>([a, b]);
    for (let x = Math.ceil(a); x < b; x += x >= plan.elevated[0] - 1 && x <= plan.elevated[1] + 1 ? 1 : 4) set.add(x);
    for (const x of breaks) if (x > a && x < b) set.add(x);
    return [...set].sort((p, q) => p - q);
  };
  const hwPath = (a: number, b: number): Path3 => path3(xsAlong(a, b).map((x) => ({ x, z: zc })), (p) => plan.heightAt(p.x));
  const full = hwPath(xw, xe);
  const open = hwPath(xPortal + 0.8, xe); // outside the tunnel

  // spans of a side (+ south / − north) where the outer kerb + barrier are interrupted by a slip road
  const gaps: Record<1 | -1, Array<[number, number]>> = {
    1: [[xn - D0, xn - D1], [xn + M0, xn + M1]],
    [-1]: [[xn + D1, xn + D0], [xn - M1, xn - M0]],
  };
  const spansWithout = (a: number, b: number, cut: Array<[number, number]>): Array<[number, number]> => {
    let out: Array<[number, number]> = [[a, b]];
    for (const [c0, c1] of cut) {
      const next: Array<[number, number]> = [];
      for (const [s0, s1] of out) {
        if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
        if (c0 > s0) next.push([s0, c0]);
        if (c1 < s1) next.push([c1, s1]);
      }
      out = next;
    }
    return out.filter(([s0, s1]) => s1 - s0 > 0.05);
  };

  // ---- carriageway surfaces + markings (surface mesh)
  ribbon(S, 'lane', full, -HW.edge, HW.edge, top);
  for (const sd of [1, -1] as const) {
    const lo = (a: number, b: number) => (sd > 0 ? [a, b] : [-b, -a]) as [number, number];
    // inner edge line (by the median), lane divider (dashed), outer gutter + edge line (dashed across slip roads)
    ribbon(S, 'mark', full, ...lo(0.52, 0.6), top + 0.002);
    dashes(S, 'mark', full, ...lo(1.96, 2.04), 1.2, 1.3, top + 0.002);
    for (const [a, b] of spansWithout(xw, xe, gaps[sd])) {
      const p = hwPath(a, b);
      ribbon(S, 'gutter', p, ...lo(3.42, HW.edge), top + 0.001);
      ribbon(S, 'mark', p, ...lo(3.26, 3.34), top + 0.002);
    }
    for (const [a, b] of gaps[sd]) dashes(S, 'mark', hwPath(a, b), ...lo(3.26, 3.34), 0.5, 0.5, top + 0.002, 0.25);
  }

  // ---- outer kerbs (surface), guardrails at grade / parapets on the elevated span (structures)
  const [e0, e1] = plan.elevated;
  for (const sd of [1, -1] as const) {
    const l0 = sd > 0 ? HW.edge : -HW.outer, l1 = sd > 0 ? HW.outer : -HW.edge;
    for (const [a, b] of spansWithout(xPortal + 0.8, xe, gaps[sd])) {
      const p = hwPath(a, b);
      band(S, 'walk', p, l0, l1, top, KERB.walkTop - top, 'curb');
      // guardrail where the road is at grade, parapet where it is raised
      for (const [s0, s1] of spansWithout(a, b, [[e0 + 1.5, e1 - 1.5]])) {
        const q = hwPath(s0, s1);
        const r0 = sd > 0 ? 3.74 : -3.84, r1 = sd > 0 ? 3.84 : -3.74;
        band(X, 'rail', q, r0, r1, KERB.walkTop + 0.17, 0.11, 'rail');
        for (let x = s0 + 0.4; x < s1 - 0.2; x += 1.6) X.box('post', x, plan.heightAt(x) + KERB.walkTop + 0.14, zc + sd * 3.79, 0.07, 0.28, 0.07);
      }
      const ea = Math.max(a, e0 + 1.5), eb = Math.min(b, e1 - 1.5);
      if (eb > ea) band(X, 'concrete', hwPath(ea, eb), sd > 0 ? 3.66 : -HW.outer, sd > 0 ? HW.outer : -3.66, KERB.walkTop, 0.36, 'concreteDark');
    }
  }
  // median jersey barrier
  band(X, 'concrete', open, -0.15, 0.15, top, 0.3, 'concreteDark');

  // ---- embankments (retaining walls + pilasters), deck (fascia + soffit), abutments, pier caps
  const [d0, d1] = plan.deck;
  for (const [a, b] of [[e0, d0], [d1, e1]] as Array<[number, number]>) {
    const p = hwPath(a, b);
    wall(X, 'stone', p, HW.outer, () => -0.02, (_i, y) => y + KERB.walkTop, true);
    wall(X, 'stone', p, -HW.outer, () => -0.02, (_i, y) => y + KERB.walkTop, false);
    for (let x = a + 1.5; x < b - 0.5; x += 2.4) {
      const h = plan.heightAt(x);
      if (h < 0.5) continue;
      for (const sd of [1, -1]) X.box('coping', x, h / 2 - 0.02, zc + sd * (HW.outer + 0.04), 0.28, h, 0.08);
    }
  }
  const deckP = hwPath(d0, d1);
  wall(X, 'concrete', deckP, HW.outer, (_i, y) => y - HW.deckT, (_i, y) => y + KERB.walkTop, true);
  wall(X, 'concrete', deckP, -HW.outer, (_i, y) => y - HW.deckT, (_i, y) => y + KERB.walkTop, false);
  soffit(X, 'deckUnder', deckP, -HW.outer, HW.outer, -HW.deckT);
  // abutment faces toward the link road (the embankment ends), with a light coping band under the deck
  const H = HW.H;
  X.quad('stone', V(d0, -0.02, zc + HW.outer), V(d0, -0.02, zc - HW.outer), V(d0, H, zc - HW.outer), V(d0, H, zc + HW.outer));
  X.quad('stone', V(d1, -0.02, zc - HW.outer), V(d1, -0.02, zc + HW.outer), V(d1, H, zc + HW.outer), V(d1, H, zc - HW.outer));
  X.box('coping', d0 + 0.12, H - HW.deckT - 0.1, zc, 0.26, 0.2, 2 * HW.outer + 0.1);
  X.box('coping', d1 - 0.12, H - HW.deckT - 0.1, zc, 0.26, 0.2, 2 * HW.outer + 0.1);
  for (const sx of [-1, 1]) X.box('concreteDark', xn + sx * 3.4, H - HW.deckT - 0.12, zc, 0.6, 0.24, 2 * HW.outer - 0.3);

  // ---- slip roads (surface): one-lane ramps (white edge lines, kerbs) widening to the Kenney junction arms,
  // drawn just under the expressway where they overlap it
  for (const s of plan.slips) {
    const p = path3(s.path, 0);
    const lo = top - 0.004;
    const half = s.half, neg = latMap(half, (v) => -v);
    ribbon(S, 'lane', p, neg, half, lo);
    ribbon(S, 'mark', p, latMap(half, (v) => -v + 0.14), latMap(half, (v) => -v + 0.22), lo + 0.0015);
    ribbon(S, 'mark', p, latMap(half, (v) => v - 0.22), latMap(half, (v) => v - 0.14), lo + 0.0015);
    const kerb = (range: [number, number], inner: boolean) => {
      const q = path3(s.path.slice(range[0], range[1] + 1), 0);
      const hh = half.slice(range[0], range[1] + 1);
      const sgn = inner ? s.hwSide : -s.hwSide;
      const edge = latMap(hh, (v) => sgn * v), outer = latMap(hh, (v) => sgn * (v + KERB.walk - KERB.carriage));
      band(S, 'walk', q, sgn > 0 ? edge : outer, sgn > 0 ? outer : edge, lo, KERB.walkTop - lo, 'curb');
    };
    kerb(s.innerKerb, true);
    kerb(s.outerKerb, false);
  }

  // ---- North Rd link + the two junctions: Kenney tiles (or procedural pads)
  const straight = kenneyTemplate(TILES.straight);
  const tileScale = straight ? T / Math.max(straight.size.x, straight.size.z) : 1;
  const roadKey = (tri: { u: number; v: number; ny: number }) => classifyRoadTri(tri.u, tri.v, tri.ny) as ColorKey | null;
  const tileAt = (id: KenneyId, x: number, z: number, rot: number) => {
    const t = kenneyTemplate(id);
    if (!t) return false;
    for (const part of t.parts) S.geometry(part.geometry, mat4(x, 0, z, rot, tileScale), roadKey);
    return true;
  };
  const linkCells = [] as Vec2[];
  for (let z = plan.zN + T; z < plan.zS - 0.5 * T; z += T) linkCells.push({ x: xn, z });
  let tiles = true;
  for (const j of plan.junctions) tiles = tileAt(j.arms.length === 4 ? TILES.cross : TILES.tee, j.center.x, j.center.z, 0) && tiles;
  for (const c of linkCells) tiles = tileAt(TILES.straight, c.x, c.z, Math.PI / 2) && tiles;
  if (!tiles) {
    // fallback: junction pads + the link swept with the street cross-section
    for (const j of plan.junctions) {
      const h = T / 2, c = j.center;
      S.quad('lane', V(c.x - h, top, c.z - h), V(c.x - h, top, c.z + h), V(c.x + h, top, c.z + h), V(c.x + h, top, c.z - h));
    }
    const lp = path3(plan.link, 0);
    ribbon(S, 'lane', lp, -KERB.carriage, KERB.carriage, top);
    ribbon(S, 'mark', lp, -0.04, 0.04, top + 0.0015);
    band(S, 'walk', lp, KERB.carriage, KERB.walk, top, KERB.walkTop - top, 'curb');
    band(S, 'walk', lp, -KERB.walk, -KERB.carriage, top, KERB.walkTop - top, 'curb');
  }

  // ---- props
  for (const p of plan.props) placeProp(X, p, plan);

  // ---- tunnel portal, bores, wing walls, hillside
  buildPortal(X, plan);
  buildHill(X, plan);

  const surfaceGeo = S.build(palette);
  const structGeo = X.build(palette);
  const material = new KitMaterial({ roughness: 0.9 });
  const object = new THREE.Group();
  object.name = 'greater-highway';
  const surface = new THREE.Mesh(surfaceGeo, material);
  surface.name = 'greater-highway:surface';
  surface.receiveShadow = true;
  const structures = new THREE.Mesh(structGeo, material);
  structures.name = 'greater-highway:structures';
  structures.castShadow = true;
  structures.receiveShadow = true;
  object.add(surface, structures);

  return {
    name: 'greater-highway',
    object,
    plan,
    surface,
    structures,
    kenney,
    update() {},
    setPalette(p: PaletteId) {
      palette = p;
      recolorHighway(surfaceGeo, p);
      recolorHighway(structGeo, p);
    },
    dispose() {
      surfaceGeo.dispose();
      structGeo.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------- props
const pick = <T>(arr: readonly T[], v: number): T => arr[((v % arr.length) + arr.length) % arr.length]!;

function placeProp(X: Acc, p: Prop, plan: HighwayPlan): void {
  const sRoad = 4 / ROAD_KIT;
  switch (p.kind) {
    case 'light': {
      const y = p.y + HW.roadTop + 0.3;
      if (!kenneyInto(X, PROPS.light, mat4(p.x, y, p.z, p.rot, 1.2), (i) => (i.role === 'knWhite' ? 'lampGlass' : null))) {
        X.box('post', p.x, y + 1.0, p.z, 0.09, 2.0, 0.09);
        X.box('post', p.x, y + 2.0, p.z, 0.07, 0.06, 1.3);
        for (const s of [-1, 1]) X.box('lampGlass', p.x, y + 1.95, p.z + s * 0.62, 0.16, 0.06, 0.24);
      }
      return;
    }
    case 'gantry':
    case 'gantryWide': {
      const id = p.kind === 'gantry' ? PROPS.gantry : PROPS.gantryWide;
      const ok = kenneyInto(X, id, mat4(p.x, 0, p.z, p.rot, sRoad), (i) => (i.role === 'knGrey' ? 'signPanel' : i.role === 'knWhite' ? 'signText' : null));
      if (!ok) {
        for (const s of [-1, 1]) X.box('post', p.x, 1.4, p.z + s * 1.95, 0.1, 2.8, 0.1);
        X.box('post', p.x, 2.7, p.z, 0.08, 0.08, 3.9);
        X.box('signPanel', p.x - 0.12, 2.25, p.z - 0.2, 0.08, 0.8, 2.6, 0);
        X.box('signText', p.x - 0.17, 2.35, p.z - 0.2, 0.02, 0.1, 1.6);
        X.box('signText', p.x - 0.17, 2.1, p.z - 0.4, 0.02, 0.1, 1.1);
      }
      return;
    }
    case 'pillar': {
      const h = p.h ?? 1.5;
      const t = kenneyTemplate(PROPS.pillar);
      if (t) kenneyInto(X, PROPS.pillar, mat4(p.x, 0, p.z, p.rot, sRoad, (h / t.size.y), sRoad));
      else X.box('concreteDark', p.x, h / 2, p.z, 0.55, h, 0.55);
      return;
    }
    case 'signal': {
      if (!kenneyInto(X, PROPS.signal, mat4(p.x, 0, p.z, p.rot, 1.15))) {
        X.box('post', p.x, 0.75, p.z, 0.07, 1.5, 0.07);
        X.box('iron', p.x, 1.35, p.z, 0.16, 0.38, 0.14);
      }
      return;
    }
    case 'pine':
    case 'tree':
    case 'bush':
    case 'rock': {
      const list = p.kind === 'pine' ? PINES : p.kind === 'tree' ? TREES : p.kind === 'bush' ? BUSHES : ROCKS;
      const id = pick(list, p.v);
      const y = p.kind === 'rock' || p.kind === 'pine' ? groundAt(plan, p.x, p.z) - 0.05 : groundAt(plan, p.x, p.z);
      const s = p.kind === 'rock' ? p.s * 0.75 : p.kind === 'bush' ? (id.endsWith('tree_fat') ? p.s * 0.45 : p.s * 0.38) : p.s;
      const remap = (i: KenneyPartInfo): ColorKey | null => (i.role === 'knDirt' || i.role === 'knDirtDark' || i.role === 'knWhite' ? 'rock' : i.role === 'knGrass' ? 'hillMeadow' : null);
      if (kenneyInto(X, id, mat4(p.x, y, p.z, p.rot, s), remap)) return;
      fallbackPlant(X, p, y);
      return;
    }
  }
}

const CONE = new THREE.ConeGeometry(0.75, 2.2, 7);
const BALL = new THREE.IcosahedronGeometry(0.8, 0);
function fallbackPlant(X: Acc, p: Prop, y: number): void {
  const s = p.s;
  if (p.kind === 'pine') {
    X.box('trunk', p.x, y + 0.3 * s, p.z, 0.16 * s, 0.6 * s, 0.16 * s);
    X.geometry(CONE, mat4(p.x, y + 1.6 * s, p.z, p.rot, s), 'pine');
  } else if (p.kind === 'tree') {
    X.box('trunk', p.x, y + 0.5 * s, p.z, 0.16 * s, 1.0 * s, 0.16 * s);
    X.geometry(BALL, mat4(p.x, y + 1.6 * s, p.z, p.rot, s, s * 0.9, s), 'leaf');
  } else if (p.kind === 'bush') {
    X.geometry(BALL, mat4(p.x, y + 0.25 * s, p.z, p.rot, 0.45 * s, 0.35 * s, 0.45 * s), 'leaf');
  } else {
    X.geometry(BALL, mat4(p.x, y + 0.2, p.z, p.rot, 0.7 * s, 0.5 * s, 0.6 * s), 'rock');
  }
}

// ---------------------------------------------------------------- tunnel portal (twin bores) + hillside
/** Portal facade dims (lateral = z offset from the highway centreline). */
const PORTAL = { half: 5.6, top: 4.7, depth: 0.8, R: 1.68, spring: 1.35, ring: 0.42, wing: 7 } as const;

/** Local (lat, y, depth) → world: depth toward +x from the portal face, lat toward +z. */
function portalMatrix(plan: HighwayPlan, depth0 = 0): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    0, 0, 1, plan.xPortal + depth0,
    0, 1, 0, 0,
    1, 0, 0, plan.zc,
    0, 0, 0, 1,
  );
}

function buildPortal(X: Acc, plan: HighwayPlan): void {
  const { half, top, depth, R, spring, ring } = PORTAL;
  const xp = plan.xPortal, zc = plan.zc;
  const centres = [-2, 2];
  // facade: rounded-top slab with two arched openings
  const s = new THREE.Shape();
  const rc = 0.45;
  s.moveTo(-half, 0);
  s.lineTo(-half, top - rc);
  s.quadraticCurveTo(-half, top, -half + rc, top);
  s.lineTo(half - rc, top);
  s.quadraticCurveTo(half, top, half, top - rc);
  s.lineTo(half, 0);
  s.lineTo(-half, 0);
  for (const c of centres) {
    const h = new THREE.Path();
    h.moveTo(c + R, 0);
    h.lineTo(c + R, spring);
    h.absarc(c, spring, R, 0, Math.PI, false);
    h.lineTo(c - R, 0);
    h.lineTo(c + R, 0);
    s.holes.push(h);
  }
  const facade = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 14 });
  X.geometry(facade, portalMatrix(plan), (t) => (t.ny < -0.5 ? null : 'portal'));
  facade.dispose();
  // voussoirs (alternating stones proud of the facade) + keystones
  const segs = 9;
  for (const c of centres) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI, a1 = ((i + 1) / segs) * Math.PI;
      const v = new THREE.Shape();
      v.moveTo(c + Math.cos(a0) * R, spring + Math.sin(a0) * R);
      v.absarc(c, spring, R + ring, a0, a1, false);
      v.lineTo(c + Math.cos(a1) * R, spring + Math.sin(a1) * R);
      v.absarc(c, spring, R, a1, a0, true);
      const geo = new THREE.ExtrudeGeometry(v, { depth: 0.12, bevelEnabled: false, curveSegments: 3 });
      X.geometry(geo, portalMatrix(plan, depth - 0.02), i === (segs - 1) / 2 ? 'portalCornice' : i % 2 ? 'portalRing' : 'portal');
      geo.dispose();
    }
    // jamb plinths
    for (const sx of [-1, 1]) X.box('portalRing', xp + depth + 0.05, spring / 2, zc + c + sx * (R + ring / 2), 0.14, spring, ring);
  }
  // cornice, plinth course, name plaque, lanterns
  X.box('portalCornice', xp + depth / 2 + 0.06, top - 0.12, zc, depth + 0.28, 0.3, 2 * half + 0.3);
  X.box('portalCornice', xp + depth / 2 + 0.05, 0.22, zc, depth + 0.2, 0.44, 2 * half + 0.2);
  X.box('portalCornice', xp + depth + 0.06, top - 0.78, zc, 0.12, 0.46, 2.1);
  X.box('iron', xp + depth + 0.13, top - 0.78, zc, 0.04, 0.22, 1.6);
  for (const sz of [-1, 1]) {
    const lz = zc + sz * (half - 0.75);
    X.box('iron', xp + depth + 0.12, 2.55, lz, 0.22, 0.12, 0.22);
    X.box('lampGlass', xp + depth + 0.12, 2.3, lz, 0.18, 0.32, 0.18);
    X.box('iron', xp + depth + 0.12, 2.1, lz, 0.14, 0.1, 0.14);
    X.box('iron', xp + depth + 0.06, 2.3, lz, 0.1, 0.06, 0.06);
  }
  // dark bores: side walls, vault, back wall (cars vanish behind it)
  const back = xp - 2.4;
  for (const c of centres) {
    const z0 = zc + c - R, z1 = zc + c + R, yv = spring + R;
    X.quad('mouth', V(back, 0, z0), V(xp + 0.01, 0, z0), V(xp + 0.01, yv, z0), V(back, yv, z0));
    X.quad('mouth', V(xp + 0.01, 0, z1), V(back, 0, z1), V(back, yv, z1), V(xp + 0.01, yv, z1));
    X.quad('mouth', V(back, yv, z0), V(xp + 0.01, yv, z0), V(xp + 0.01, yv, z1), V(back, yv, z1));
    X.quad('mouth', V(back, -0.01, z1), V(back, -0.01, z0), V(back, yv, z0), V(back, yv, z1));
  }
  // wing walls retaining the hillside either side of the approach (inner face + coping), stepping down eastward
  const wingTop = (x: number) => Math.max(0.35, top - 0.3 - ((x - xp - depth) / PORTAL.wing) * (top - 0.6));
  for (const sz of [-1, 1]) {
    const zl = zc + sz * half;
    const xs = [xp + depth, xp + depth + PORTAL.wing * 0.5, xp + depth + PORTAL.wing];
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i]!, b = xs[i + 1]!;
      if (sz < 0) X.quad('portal', V(a, -0.02, zl), V(b, -0.02, zl), V(b, wingTop(b), zl), V(a, wingTop(a), zl));
      else X.quad('portal', V(b, -0.02, zl), V(a, -0.02, zl), V(a, wingTop(a), zl), V(b, wingTop(b), zl));
      // coping: a sloped cap 0.5 wide
      const zo = zl + sz * 0.5;
      X.quad('portalCornice', V(a, wingTop(a) + 0.08, sz < 0 ? zo : zl), V(a, wingTop(a) + 0.08, sz < 0 ? zl : zo), V(b, wingTop(b) + 0.08, sz < 0 ? zl : zo), V(b, wingTop(b) + 0.08, sz < 0 ? zo : zl));
      if (sz < 0) X.quad('portalCornice', V(a, wingTop(a), zl), V(b, wingTop(b), zl), V(b, wingTop(b) + 0.08, zl), V(a, wingTop(a) + 0.08, zl));
      else X.quad('portalCornice', V(b, wingTop(b), zl), V(a, wingTop(a), zl), V(a, wingTop(a) + 0.08, zl), V(b, wingTop(b) + 0.08, zl));
    }
    X.box('portalCornice', xp + depth + PORTAL.wing + 0.15, 0.25, zl + sz * 0.25, 0.4, 0.6, 0.6);
  }
}

/** Hill height above the band ground at (x, z) (0 outside the hill, and in the approach cutting). West of the
 *  portal the hill spills south onto mountain land beyond the grid; east of it it stays inside the band. */
export function hillHeight(plan: HighwayPlan, x: number, z: number): number {
  const hb = plan.hill;
  if (x < hb.minX || x > hb.maxX || z < hb.minZ || z > hb.maxZ) return 0;
  const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const dz = z - plan.zc, ux = x - plan.xPortal;
  if (ux > 0 && z > hb.bandMaxZ) return 0;
  // the south flank eases out over mountain land west of the portal and tightens to the band edge at the portal
  const southEnd = (hb.maxZ - plan.zc) + ((hb.bandMaxZ - plan.zc) - (hb.maxZ - plan.zc)) * sm((ux + 9) / 9);
  const across = dz >= 0 ? 1 - sm((dz - 5.0) / Math.max(0.5, southEnd - 5.0)) : 1 - sm((-dz - 6.5) / 6.5);
  if (across <= 0) return 0;
  const crest = 4.95;
  let along: number;
  if (ux <= 0) along = crest + 1.8 * sm(-ux / 5) - 2.6 * sm((-ux - 9) / 7);
  else {
    if (Math.abs(dz) < PORTAL.half) return 0;
    along = crest * (1 - sm(ux / (PORTAL.wing + 0.5)));
  }
  const bump = 0.32 * Math.sin(x * 0.9 + z * 0.4) * Math.cos(z * 0.7 - x * 0.3) + 0.2 * Math.sin(x * 1.7 - z * 1.3);
  return Math.max(0, along * across + bump * across * Math.min(1, along / 2));
}

/** Ground height for props (hill or band ground). */
function groundAt(plan: HighwayPlan, x: number, z: number): number {
  return hillHeight(plan, x, z);
}

function buildHill(X: Acc, plan: HighwayPlan): void {
  const hb = plan.hill, xp = plan.xPortal, zc = plan.zc;
  const step = 0.85;
  const patch = (x0: number, x1: number, z0: number, z1: number) => {
    const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
    const P: THREE.Vector3[][] = [];
    for (let i = 0; i <= nx; i++) {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= nz; j++) {
        const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
        row.push(V(x, hillHeight(plan, x, z) - 0.03, z));
      }
      P.push(row);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = P[i]![j]!, b = P[i]![j + 1]!, c = P[i + 1]![j + 1]!, d = P[i + 1]![j]!;
      // two triangles, each coloured by its slope + height (low-poly facets)
      for (const [p, q, r] of [[a, b, c], [a, c, d]] as Array<[THREE.Vector3, THREE.Vector3, THREE.Vector3]>) {
        const hy = (p.y + q.y + r.y) / 3;
        const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p)).normalize();
        const jitter = hash01(Math.round(p.x * 7), Math.round(p.z * 7));
        const key: ColorKey = n.y < 0.42 ? 'hillRock' : hy > 3.4 + jitter * 0.9 ? 'hillForest' : hy > 1.2 + jitter ? 'hillMeadow' : 'hillGrass';
        X.tri(key, p, q, r);
      }
    }
  };
  patch(hb.minX, xp, hb.minZ, hb.maxZ);
  patch(xp, hb.maxX, hb.minZ, zc - PORTAL.half);
  patch(xp, hb.maxX, zc + PORTAL.half, hb.bandMaxZ);
}
