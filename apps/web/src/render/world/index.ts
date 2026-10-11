// Owner: E4. The world around the town, composed as one RenderLayer: base (E3), terrain (E1), water (E2), sky (E3),
// plus the integration glue that makes board ↔ world one place:
//   world:seam — a flat strip, the board's own colour, over the slab's rounded rim (makeBoard, r 0.5) wherever terrain
//                meets the board, so the foothills run straight out of the town with no groove or outline (art bible
//                §6.2). The beach sides keep the water layer's sand lip.
//   highlight  — when a route is highlighted the world fades with the static town (ground 0.3 like the board, trees
//                0.6, lake 0.3) so no seam appears and only gameplay pops (§2.5).
//   shadow     — while mounted, the Stage's floating-board drop shadow is retired (the sky paints one under the base).
// A part that fails to build or update is skipped (warned once) instead of taking the whole world down.
// Draw calls: base 1 + terrain ≤ 5 + water 3 + sky 2 + seam 1 ≤ 15.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import type { FrameContext, RenderLayer } from '../layers';
import { KitMaterial, shared } from '../materials';
import { DEFAULT_PALETTE, PALETTES } from '../palettes';
import type { LightMode, PaletteId } from '../types';
import { createBaseLayer } from './base/index';
import { worldLayout } from './layout';
import { createSkyLayer } from './sky/index';
import { createTerrainField, createTerrainLayer } from './terrain/index';
import { createWaterLayer, WATER_COLORS, type WaterLayer } from './water/index';

/** Seam strip across the board rim: from `inside` u in from the edge to `outside` u beyond it, at height `y`. */
export const SEAM = { inside: 0.62, outside: 0.06, y: 0.004, step: 0.25, probe: 0.35 } as const;
/** Highlight fade amounts (match the static town's ground / trees) and easing rate (1/s). */
const FADE = { ground: 0.3, trees: 0.6, water: 0.3, rate: 7 } as const;

export type BoardSide = 'north' | 'south' | 'east' | 'west';
/** A covered run along one board side: `from`..`to` is x (north/south) or z (east/west). */
export interface BoardSeam { side: BoardSide; from: number; to: number }

/** Runs of each board side with terrain right beyond it (`land` probed SEAM.probe u outside the edge). */
export function boardSeams(b: TownMap['bounds'], land: (x: number, z: number) => boolean): BoardSeam[] {
  const out: BoardSeam[] = [];
  const sides: Array<[BoardSide, number, number, (t: number) => [number, number]]> = [
    ['north', b.minX, b.maxX, (t) => [t, b.minZ - SEAM.probe]],
    ['south', b.minX, b.maxX, (t) => [t, b.maxZ + SEAM.probe]],
    ['west', b.minZ, b.maxZ, (t) => [b.minX - SEAM.probe, t]],
    ['east', b.minZ, b.maxZ, (t) => [b.maxX + SEAM.probe, t]],
  ];
  for (const [side, lo, hi, probe] of sides) {
    const n = Math.ceil((hi - lo) / SEAM.step);
    let start: number | null = null, last = lo;
    for (let i = 0; i <= n; i++) {
      const t = Math.min(hi, lo + i * SEAM.step);
      const [x, z] = probe(t);
      if (land(x, z)) { if (start === null) start = t; last = t; }
      else if (start !== null) { out.push({ side, from: Math.max(lo, start - SEAM.step / 2), to: Math.min(hi, last + SEAM.step / 2) }); start = null; }
    }
    if (start !== null) out.push({ side, from: Math.max(lo, start - SEAM.step / 2), to: hi });
  }
  return out;
}

/** One flat, upward-facing, kit-attributed geometry for all seam runs (colour filled by `paintSeam`). */
function seamGeometry(b: TownMap['bounds'], seams: BoardSeam[]): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    const k = pos.length / 3;
    pos.push(x0, SEAM.y, z0, x0, SEAM.y, z1, x1, SEAM.y, z1, x1, SEAM.y, z0);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3); // counter-clockwise from above (+y normal)
  };
  const { inside: i, outside: o } = SEAM;
  for (const s of seams) {
    if (s.side === 'north') quad(s.from, b.minZ - o, s.to, b.minZ + i);
    else if (s.side === 'south') quad(s.from, b.maxZ - i, s.to, b.maxZ + o);
    else if (s.side === 'west') quad(b.minX - o, s.from, b.minX + i, s.to);
    else quad(b.maxX - i, s.from, b.maxX + o, s.to);
  }
  const n = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function paintSeam(g: THREE.BufferGeometry, p: PaletteId): void {
  const c = new THREE.Color(PALETTES[p].board);
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  col.needsUpdate = true;
}

export function createWorldLayer(map: TownMap): RenderLayer {
  const layout = worldLayout(map);
  const object = new THREE.Group();
  object.name = 'world';
  let palette: PaletteId = DEFAULT_PALETTE;

  // ---- parts (each optional: a broken part is skipped, not fatal)
  const parts: RenderLayer[] = [];
  const failed = new Set<RenderLayer>();
  let water: WaterLayer | null = null;
  const tryPart = <L extends RenderLayer>(name: string, make: () => L): L | null => {
    try {
      const l = make();
      parts.push(l);
      object.add(l.object);
      return l;
    } catch (e) {
      console.warn(`[headway] world ${name} unavailable:`, e);
      return null;
    }
  };
  tryPart('base', () => createBaseLayer(map, layout));
  tryPart('terrain', () => createTerrainLayer(map, layout));
  water = tryPart('water', () => createWaterLayer(map, layout));
  tryPart('sky', () => createSkyLayer(map, layout));

  // ---- seam over the board rim, wherever terrain meets the board
  let land: (x: number, z: number) => boolean = () => false;
  try {
    const field = createTerrainField(map, layout);
    land = (x, z) => field.region(x, z) === 0 && field.height(x, z) > -0.25;
  } catch (e) {
    console.warn('[headway] world seam: no terrain field', e);
  }
  const seamGeo = seamGeometry(map.bounds, boardSeams(map.bounds, land));
  const seamMat = new KitMaterial({ roughness: 0.9 });
  const seam = new THREE.Mesh(seamGeo, seamMat);
  seam.name = 'world:seam';
  seam.receiveShadow = true;
  seam.castShadow = false;
  seam.raycast = () => {};
  object.add(seam);
  paintSeam(seamGeo, palette);

  // ---- highlight fade: every kit material in the world (ground-like 0.3, swaying trees 0.6) + the lake colours
  const fades: Array<{ m: KitMaterial; amt: number }> = [];
  const seen = new Set<THREE.Material>();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m instanceof KitMaterial) || seen.has(m)) continue;
      seen.add(m);
      fades.push({ m, amt: m.sway ? FADE.trees : FADE.ground });
    }
  });
  let fade = 0;
  const lake = water?.uniforms as unknown as Partial<Record<'uShallow' | 'uMid' | 'uDeep', { value: THREE.Color }>> | undefined;
  const fadeLake = (f: number) => {
    if (!lake?.uShallow || !lake.uMid || !lake.uDeep) return;
    const C = WATER_COLORS[palette];
    const to = shared.uFadeColor.value;
    lake.uShallow.value.set(C.shallow).lerp(to, f);
    lake.uMid.value.set(C.mid).lerp(to, f);
    lake.uDeep.value.set(C.deep).lerp(to, f);
  };

  // ---- retire the Stage's floating-board drop shadow while the world is mounted
  let dropShadow: THREE.Object3D | null = null, shadowTries = 0, frame = 0;
  const retireDropShadow = () => {
    if (dropShadow || shadowTries >= 6 || !object.parent || frame++ % 30 !== 0) return;
    shadowTries++;
    let root: THREE.Object3D = object;
    while (root.parent) root = root.parent;
    const s = root.getObjectByName('boardDropShadow');
    if (s) { s.visible = false; dropShadow = s; }
  };

  const each = (fn: (p: RenderLayer) => void) => {
    for (const p of parts) {
      if (failed.has(p)) continue;
      try { fn(p); } catch (e) { failed.add(p); console.warn(`[headway] world ${p.name} failed; skipping it:`, e); }
    }
  };

  return {
    name: 'world',
    object,
    update(ctx: FrameContext) {
      each((p) => p.update(ctx));
      retireDropShadow();
      const goal = ctx.highlightedRoute ? 1 : 0;
      if (fade !== goal) {
        fade += (goal - fade) * (1 - Math.exp(-Math.max(0, ctx.dtS) * FADE.rate));
        if (Math.abs(goal - fade) < 1e-3) fade = goal;
        for (const { m, amt } of fades) m.fade.value = amt * fade;
        fadeLake(FADE.water * fade);
      }
    },
    setPalette(p: PaletteId) {
      palette = p;
      each((l) => l.setPalette?.(p));
      paintSeam(seamGeo, p);
      if (fade > 0) fadeLake(FADE.water * fade);
    },
    setLight: (l: LightMode) => each((p) => p.setLight?.(l)),
    dispose() {
      for (const p of parts) { try { p.dispose(); } catch { /* already gone */ } }
      seamGeo.dispose();
      seamMat.dispose();
      if (dropShadow) dropShadow.visible = true;
      dropShadow = null;
    },
  };
}
export { worldLayout } from './layout';
export type { WorldLayout, WorldExit, Side } from './layout';
