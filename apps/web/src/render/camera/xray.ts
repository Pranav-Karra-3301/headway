// Owner: C2 (camera rig). X-ray occlusion (art bible §2.4): buildings, trees and terrain between the camera and
// something that matters (the selection, a queue with people, a moving vehicle, the hovered entity) dither away so
// gameplay never hides. Layout fixes occlusion first; this is the safety net.
//
//   const xray = new XrayTracker(boxesFromPlacements(items));     // one upright box per occluder
//   xray.attach(town.object, filter);                             // tags merged/instanced meshes + patches materials
//   per frame: xray.update(triggers, rig.viewDir, dtS, { camera, w, h, pxPerUnit });
//   triggers = [...queueTriggerPoints(map, snap.queues), { x, y, z, key: 'v:' + bus.id, r: 2 }, …]
//
// Two looks. **Window** (default when `view` is passed): an occluder dithers only inside a soft circle around each
// hidden trigger's screen position and only where it is in front of it, so a bus behind the stadium opens a small
// see-through window instead of ghosting the whole showpiece. **Object** (no `view`): the whole occluder dithers to
// ~30 % coverage, as the bible first described. Both ease in 120 ms, hold ≥ 600 ms after the last hit, out 300 ms.
//
// Per-box fades live in a small DataTexture (one texel per box) read in the vertex shader through a per-vertex
// `aXrayId` (merged geometry) or per-instance `aXrayIdI` (InstancedMesh). Texels 0 and 1 never fade (WebGL's default
// generic attribute values), so untagged meshes sharing a patched material stay solid. The shadow pass uses the
// depth material, so shadows do not change; ground, roads, vehicles and people are never attached.
import * as THREE from 'three';
import type { QueueView, TownMap } from '@headway/sim';
import { CATALOG_BY_KIND } from '../assets/catalog';
import type { PlacedAsset } from '../assets/types';
import type { V3 } from './iso';

/** An upright occluder box turned by `rot` about +y (three.js rotation.y); half extents in its local frame. */
export interface XrayBox { cx: number; cz: number; hx: number; hz: number; y0: number; y1: number; rot: number; kind?: string }

export const XRAY_TIMING = { fadeInS: 0.12, holdS: 0.6, fadeOutS: 0.3 } as const;
/** First texel id used for boxes (0 and 1 are reserved "never fade"). */
export const XRAY_ID0 = 2;
/** Dither keeps ~30 % of pixels at full x-ray (Bayer 4×4 threshold × 0.7). */
export const XRAY_STRENGTH = 0.7;
/** Max see-through windows uploaded per frame (strongest first). */
export const XRAY_MAX_WINDOWS = 24;

/** A protected point. `key` keeps its window alive while it fades out (vehicle id, queue slot); `r` = window radius (u). */
export interface XrayTrigger extends V3 { key?: string; r?: number }
/** What window mode needs to place windows on screen. */
export interface XrayView { camera: THREE.Camera; w: number; h: number; pxPerUnit: number }

/** Kinds too thin, low or sparse to hide a 0.8 u person, or that must stay visible (stops, signals). */
const NOT_OCCLUDERS = new Set([
  'st.lamp', 'st.bench', 'st.bin', 'st.bikeRack', 'st.hydrant', 'st.mailbox', 'st.trafficLight', 'st.fence', 'st.flag',
  'st.tableUmbrella', 'st.fountain', 'st.busShelter', 'lm.railSignal', 'lm.levelCrossing', 'res.parking', 'res.playground',
  'veg.flowerbed', 'veg.hedge', 'veg.bush',
]);

/** Upright catalog boxes for placed assets (footprint × height × scale; tall trees as crown boxes from 0.9 u). */
export function boxesFromPlacements(items: readonly PlacedAsset[]): XrayBox[] {
  const out: XrayBox[] = [];
  for (const it of items) {
    const c = CATALOG_BY_KIND.get(it.kind);
    if (!c || NOT_OCCLUDERS.has(it.kind) || it.kind.startsWith('kn.car') || it.kind.startsWith('kn.boat')) continue;
    const s = it.scale ?? 1;
    const len = typeof it.params?.length === 'number' ? it.params.length : null;
    const tree = c.family === 'vegetation';
    if (c.h * s < 1.2) continue;
    out.push({ cx: it.x, cz: it.z, hx: ((len ?? c.w) * s) / 2, hz: (c.d * s) / 2, y0: tree && c.h * s > 1.5 ? 0.9 * s : 0, y1: c.h * s, rot: it.rot ?? 0, kind: it.kind });
  }
  return out;
}

const QUEUE_Y = { stop: 0.4, platform: 0.95 } as const;

/**
 * Trigger points for every queue with ≥ 1 waiting: the first min(count, 8) slots along `queueDir`
 * (stop.p + queueDir·(0.25 + 0.5i)), at person mid-height.
 */
export function queueTriggerPoints(map: TownMap, queues: readonly QueueView[], maxSlots = 8): XrayTrigger[] {
  const out: XrayTrigger[] = [];
  for (const q of queues) {
    if (q.count < 1) continue;
    const place = q.at.kind === 'stop' ? map.stops.find((s) => s.id === q.at.id) : map.rail.stations.find((s) => s.id === q.at.id);
    if (!place) continue;
    const p = 'platform' in place ? place.platform : place.p;
    const y = QUEUE_Y[q.at.kind];
    for (let i = 0; i < Math.min(q.count, maxSlots); i++) {
      out.push({ x: p.x + place.queueDir.x * (0.25 + 0.5 * i), y, z: p.z + place.queueDir.z * (0.25 + 0.5 * i), key: `q:${q.at.id}:${i}`, r: 1.1 });
    }
  }
  return out;
}

/** Point in the box's local frame (inverse of rotation.y). */
function local(b: XrayBox, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.cx, dz = z - b.cz;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function boxContains(b: XrayBox, p: V3, margin = 0.05): boolean {
  if (p.y < b.y0 - margin || p.y > b.y1 + margin) return false;
  const q = local(b, p.x, p.z);
  return Math.abs(q.x) <= b.hx + margin && Math.abs(q.z) <= b.hz + margin;
}

/** True when the ray p + t·d (t > 0) enters the box (slab test in the box frame). Boxes containing p are skipped. */
export function rayHitsBox(p: V3, d: V3, b: XrayBox): boolean {
  if (boxContains(b, p)) return false;
  const o = local(b, p.x, p.z);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c;
  let t0 = 0, t1 = Infinity;
  const slab = (o0: number, dd: number, lo: number, hi: number): boolean => {
    if (Math.abs(dd) < 1e-12) return o0 >= lo && o0 <= hi;
    let a = (lo - o0) / dd, z = (hi - o0) / dd;
    if (a > z) { const t = a; a = z; z = t; }
    if (a > t0) t0 = a;
    if (z < t1) t1 = z;
    return t0 <= t1;
  };
  return slab(o.x, dx, -b.hx, b.hx) && slab(p.y, d.y, b.y0, b.y1) && slab(o.z, dz, -b.hz, b.hz);
}

/** Plan AABB of a box's footprint. */
function footprintAabb(b: XrayBox): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const c = Math.abs(Math.cos(b.rot)), s = Math.abs(Math.sin(b.rot));
  const ex = b.hx * c + b.hz * s, ez = b.hx * s + b.hz * c;
  return { minX: b.cx - ex, maxX: b.cx + ex, minZ: b.cz - ez, maxZ: b.cz + ez };
}

/** Uniform plan grid of box indices for broad-phase lookups. */
class Grid {
  private readonly cells = new Map<number, number[]>();
  constructor(readonly cell: number) {}
  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096); }
  add(idx: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    for (let i = Math.floor(r.minX / this.cell); i <= Math.floor(r.maxX / this.cell); i++)
      for (let j = Math.floor(r.minZ / this.cell); j <= Math.floor(r.maxZ / this.cell); j++) {
        const k = this.key(i, j);
        let a = this.cells.get(k);
        if (!a) { a = []; this.cells.set(k, a); }
        a.push(idx);
      }
  }
  at(x: number, z: number): readonly number[] { return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? []; }
  clear(): void { this.cells.clear(); }
}

export interface XrayOptions { fadeInS?: number; holdS?: number; fadeOutS?: number; cell?: number }

/**
 * Tracks which occluder boxes hide the protected points from the camera and eases a fade per box
 * (in 120 ms, hold ≥ 600 ms after the last hit, out 300 ms). `fades[i]` is box i's x-ray amount 0..1.
 */
export class XrayTracker {
  readonly boxes: XrayBox[];
  readonly fades: Float32Array;
  readonly texture: THREE.DataTexture;
  /** Shared uniform for patched materials (the per-box fade texture). */
  readonly uniform: { value: THREE.DataTexture };
  /** Window uniforms shared by every patched material: NDC x, y, z + radius (CSS px); strength; count (−1 = object mode). */
  readonly windows = {
    uXrayWin: { value: Array.from({ length: XRAY_MAX_WINDOWS }, () => new THREE.Vector4()) },
    uXrayWinS: { value: new Array<number>(XRAY_MAX_WINDOWS).fill(0) },
    uXrayWinN: { value: -1 },
    uXrayHalf: { value: new THREE.Vector2(1, 1) },
  };
  enabled = true;
  private readonly wins = new Map<string, { p: XrayTrigger; lastHit: number; s: number; seen: number }>();
  private readonly ndc = new THREE.Vector3();
  private readonly lastHit: Float32Array;
  private readonly footGrid: Grid;
  private shadowGrid: Grid;
  private gridDir = { x: NaN, y: NaN, z: NaN };
  private clock = 0;
  private readonly t: Required<Omit<XrayOptions, 'cell'>>;
  private readonly data: Uint8Array;
  private readonly width: number;

  constructor(boxes: readonly XrayBox[], opts: XrayOptions = {}) {
    this.boxes = [...boxes];
    const n = this.boxes.length;
    this.fades = new Float32Array(n);
    this.lastHit = new Float32Array(n).fill(-1e9);
    this.t = { fadeInS: opts.fadeInS ?? XRAY_TIMING.fadeInS, holdS: opts.holdS ?? XRAY_TIMING.holdS, fadeOutS: opts.fadeOutS ?? XRAY_TIMING.fadeOutS };
    const cell = opts.cell ?? 4;
    this.footGrid = new Grid(cell);
    this.shadowGrid = new Grid(cell);
    this.boxes.forEach((b, i) => this.footGrid.add(i, footprintAabb(b)));
    this.width = 256;
    const h = Math.max(1, Math.ceil((n + XRAY_ID0) / this.width));
    this.data = new Uint8Array(this.width * h);
    this.texture = new THREE.DataTexture(this.data, this.width, h, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniform = { value: this.texture };
  }

  /** Shader id of box i (texel index). */
  idOf(i: number): number { return i + XRAY_ID0; }

  /** Broad phase: plan cells covered by each box's "hide band" (footprint swept away from the camera by the reach). */
  private ensureShadowGrid(d: V3): void {
    if (Math.abs(d.x - this.gridDir.x) < 1e-4 && Math.abs(d.y - this.gridDir.y) < 1e-4 && Math.abs(d.z - this.gridDir.z) < 1e-4) return;
    this.gridDir = { x: d.x, y: d.y, z: d.z };
    this.shadowGrid.clear();
    const dy = Math.max(1e-3, d.y);
    this.boxes.forEach((b, i) => {
      const f = footprintAabb(b), reach = b.y1 / dy;
      const sx = -d.x * reach, sz = -d.z * reach;
      this.shadowGrid.add(i, { minX: Math.min(f.minX, f.minX + sx), maxX: Math.max(f.maxX, f.maxX + sx), minZ: Math.min(f.minZ, f.minZ + sz), maxZ: Math.max(f.maxZ, f.maxZ + sz) });
    });
  }

  /** Indices of every box hiding `p` from a camera in direction `d` (target → camera, unit). */
  hits(p: V3, d: V3): number[] {
    this.ensureShadowGrid(d);
    const out: number[] = [];
    for (const i of this.shadowGrid.at(p.x, p.z)) if (rayHitsBox(p, d, this.boxes[i]!)) out.push(i);
    return out;
  }

  /** Box index whose footprint contains plan point (x, z) (smallest wins), and whose top is above y; -1 if none. */
  boxAt(x: number, z: number, y = 0, margin = 0.25): number {
    let best = -1, area = Infinity;
    for (const i of this.footGrid.at(x, z)) {
      const b = this.boxes[i]!;
      if (y > b.y1 * 1.35 + 0.6) continue;
      const q = local(b, x, z), m = margin + 0.08 * Math.max(b.hx, b.hz);
      if (Math.abs(q.x) > b.hx + m || Math.abs(q.z) > b.hz + m) continue;
      const a = b.hx * b.hz;
      if (a < area) { area = a; best = i; }
    }
    return best;
  }

  /**
   * Test the protected points, ease every fade, upload the texture. With `view`, also place see-through windows
   * (window mode); without it every x-rayed occluder dithers whole (object mode). Returns how many boxes are x-rayed.
   */
  update(points: readonly XrayTrigger[], dir: V3, dtS: number, view?: XrayView): number {
    const dt = Math.min(Math.max(dtS, 0), 0.25);
    this.clock += dt;
    const up = dt / Math.max(1e-3, this.t.fadeInS), down = dt / Math.max(1e-3, this.t.fadeOutS);
    points.forEach((p, idx) => {
      const hit = this.enabled ? this.hits(p, dir) : [];
      for (const i of hit) this.lastHit[i] = this.clock;
      if (!view) return;
      const key = p.key ?? `#${idx}`;
      const w = this.wins.get(key);
      if (hit.length) { if (w) { w.p = p; w.lastHit = this.clock; w.seen = this.clock; } else this.wins.set(key, { p, lastHit: this.clock, s: 0, seen: this.clock }); }
      else if (w) { w.p = p; w.seen = this.clock; }
    });
    let active = 0, changed = false;
    for (let i = 0; i < this.fades.length; i++) {
      const want = this.enabled && this.clock - this.lastHit[i]! <= this.t.holdS ? 1 : 0;
      const f = this.fades[i]!;
      const nf = want > f ? Math.min(1, f + up) : want < f ? Math.max(0, f - down) : f;
      if (nf !== f) {
        this.fades[i] = nf;
        const byte = Math.round(nf * 255);
        if (this.data[i + XRAY_ID0] !== byte) { this.data[i + XRAY_ID0] = byte; changed = true; }
      }
      if (nf > 0) active++;
    }
    if (changed) this.texture.needsUpdate = true;
    this.updateWindows(view, up, down);
    return active;
  }

  /** Active windows (for debugging / tests): world point, strength. */
  get activeWindows(): Array<{ key: string; p: XrayTrigger; s: number }> {
    return [...this.wins.entries()].filter(([, w]) => w.s > 0).map(([key, w]) => ({ key, p: w.p, s: w.s }));
  }

  private updateWindows(view: XrayView | undefined, up: number, down: number): void {
    const u = this.windows;
    if (!view) { u.uXrayWinN.value = -1; return; }
    for (const [key, w] of this.wins) {
      const want = this.enabled && this.clock - w.lastHit <= this.t.holdS ? 1 : 0;
      w.s = want > w.s ? Math.min(1, w.s + up) : want < w.s ? Math.max(0, w.s - down) : w.s;
      // forget windows that faded out, or whose trigger vanished (bus left the map) and has faded
      if (w.s <= 0 && want === 0) this.wins.delete(key);
      else if (this.clock - w.seen > this.t.holdS + this.t.fadeOutS) this.wins.delete(key);
    }
    const list = [...this.wins.values()].filter((w) => w.s > 0).sort((a, b) => b.s - a.s).slice(0, XRAY_MAX_WINDOWS);
    view.camera.updateMatrixWorld();
    list.forEach((w, i) => {
      this.ndc.set(w.p.x, w.p.y, w.p.z).project(view.camera);
      const rPx = Math.max(26, (w.p.r ?? 1.4) * view.pxPerUnit);
      u.uXrayWin.value[i]!.set(this.ndc.x, this.ndc.y, this.ndc.z, rPx);
      u.uXrayWinS.value[i] = w.s;
    });
    u.uXrayWinN.value = list.length;
    u.uXrayHalf.value.set(view.w / 2, view.h / 2);
  }

  /** Clear every fade at once (e.g. palette switch, scene rebuild). */
  reset(): void {
    this.fades.fill(0); this.lastHit.fill(-1e9); this.data.fill(0); this.texture.needsUpdate = true;
    this.wins.clear(); this.windows.uXrayWinN.value = -1;
  }

  /**
   * Tag every mesh under `root` that passes `filter` with box ids (per vertex for merged geometry, per instance for InstancedMesh) and patch
   * its materials. Meshes or vertices outside every box get id 0 (never fade). Call once after the scene is built.
   */
  attach(root: THREE.Object3D, filter: (mesh: THREE.Mesh) => boolean = xrayDefaultFilter): { meshes: number; vertices: number; instances: number } {
    const stats = { meshes: 0, vertices: 0, instances: 0 };
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3(), m = new THREE.Matrix4();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
      if (mesh.userData.noXray || !filter(mesh)) return;
      let geo = mesh.geometry;
      if (geo.userData.xrayOwner && geo.userData.xrayOwner !== mesh.uuid) { geo = geo.clone(); mesh.geometry = geo; }
      geo.userData.xrayOwner = mesh.uuid;
      const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
      let tagged = 0;
      if (inst) {
        const ids = new Float32Array(inst.count);
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          v.setFromMatrixPosition(m).applyMatrix4(inst.matrixWorld);
          const b = this.boxAt(v.x, v.z, 0);
          ids[i] = b >= 0 ? this.idOf(b) : 0;
          if (b >= 0) tagged++;
        }
        geo.setAttribute('aXrayIdI', new THREE.InstancedBufferAttribute(ids, 1));
        stats.instances += tagged;
      } else {
        const pos = geo.getAttribute('position');
        const ids = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          const b = this.boxAt(v.x, v.z, v.y);
          ids[i] = b >= 0 ? this.idOf(b) : 0;
          if (b >= 0) tagged++;
        }
        geo.setAttribute('aXrayId', new THREE.BufferAttribute(ids, 1));
        stats.vertices += tagged;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) patchXrayMaterial(mat, this.uniform, this.windows);
      stats.meshes++;
    });
    return stats;
  }

  dispose(): void { this.texture.dispose(); }
}

/** Never x-ray the ground, roads, rail, platforms or stops (by mesh name), nor anything with userData.noXray. */
export function xrayDefaultFilter(mesh: THREE.Mesh): boolean {
  return !/^(ground|stop|road|rail|board|platform|water|sky|base|seam)/i.test(mesh.name) && !mesh.userData.noXray;
}

/** GLSL: 4×4 ordered dither in [0, 1). */
export const XRAY_BAYER_GLSL = /* glsl */ `
float hwBayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float hwBayer4(vec2 a) { return hwBayer2(0.5 * a) * 0.25 + hwBayer2(a); }
`;

const VERT_PARS = /* glsl */ `
uniform sampler2D uXrayTex;
attribute float aXrayId;
#ifdef USE_INSTANCING
attribute float aXrayIdI;
#endif
varying float vXray;
varying vec3 vXrayNdc;
`;
const VERT_MAIN = /* glsl */ `
{
#ifdef USE_INSTANCING
  float hwXid = max(aXrayId, aXrayIdI);
#else
  float hwXid = aXrayId;
#endif
  int hwI = int(hwXid + 0.5);
  ivec2 hwTs = textureSize(uXrayTex, 0);
  vXray = hwI < ${XRAY_ID0} ? 0.0 : texelFetch(uXrayTex, ivec2(hwI % hwTs.x, hwI / hwTs.x), 0).r;
}
`;
const VERT_NDC = /* glsl */ `
vXrayNdc = gl_Position.xyz / gl_Position.w;
`;
const FRAG_PARS = /* glsl */ `
varying float vXray;
varying vec3 vXrayNdc;
uniform vec4 uXrayWin[${XRAY_MAX_WINDOWS}];
uniform float uXrayWinS[${XRAY_MAX_WINDOWS}];
uniform int uXrayWinN;
uniform vec2 uXrayHalf;
${XRAY_BAYER_GLSL}
float hwXrayAmount() {
  if (vXray < 0.004) return 0.0;
  if (uXrayWinN < 0) return vXray;
  float a = 0.0;
  for (int i = 0; i < ${XRAY_MAX_WINDOWS}; i++) {
    if (i >= uXrayWinN) break;
    vec4 w = uXrayWin[i];
    if (vXrayNdc.z >= w.z) continue;                       // behind the protected thing: stays solid
    float d = length((vXrayNdc.xy - w.xy) * uXrayHalf);    // CSS px
    a = max(a, (1.0 - smoothstep(w.w * 0.45, w.w, d)) * uXrayWinS[i]);
  }
  return a * vXray;
}
`;
const FRAG_MAIN = /* glsl */ `
{ float hwXa = hwXrayAmount(); if (hwXa > 0.004 && hwBayer4(gl_FragCoord.xy) < hwXa * ${XRAY_STRENGTH.toFixed(3)}) discard; }
`;
const UNIFORM_FRAG_PARS = /* glsl */ `
uniform float uXray;
${XRAY_BAYER_GLSL}
`;
const UNIFORM_FRAG_MAIN = /* glsl */ `
if (uXray > 0.004 && hwBayer4(gl_FragCoord.xy) < uXray * ${XRAY_STRENGTH.toFixed(3)}) discard;
`;

function injectAfter(src: string, anchor: string, code: string): string {
  return src.includes(anchor) ? src.replace(anchor, `${anchor}\n${code}`) : src;
}

/**
 * Chain the x-ray dither onto a material's existing onBeforeCompile (clay tweak etc.). `src` is either the tracker's
 * texture uniform (per-object fades via aXrayId / aXrayIdI, plus the tracker's `windows` uniforms) or a plain
 * `{ value: 0..1 }` uniform that fades the whole mesh (terrain chunks, a single landmark). Idempotent per material.
 */
export function patchXrayMaterial<M extends THREE.Material>(mat: M, src: { value: THREE.DataTexture } | { value: number }, windows?: XrayTracker['windows']): M {
  if (mat.userData.hwXray) return mat;
  const byTexture = src.value instanceof THREE.Texture;
  mat.userData.hwXray = byTexture ? 'texture' : 'uniform';
  const win = windows ?? {
    uXrayWin: { value: Array.from({ length: XRAY_MAX_WINDOWS }, () => new THREE.Vector4()) },
    uXrayWinS: { value: new Array<number>(XRAY_MAX_WINDOWS).fill(0) },
    uXrayWinN: { value: -1 },
    uXrayHalf: { value: new THREE.Vector2(1, 1) },
  };
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (this: M, shader, renderer) {
    prev.call(this, shader, renderer);
    if (byTexture) {
      Object.assign(shader.uniforms, win, { uXrayTex: src });
      shader.vertexShader = injectAfter(shader.vertexShader, '#include <common>', VERT_PARS);
      shader.vertexShader = injectAfter(shader.vertexShader, '#include <begin_vertex>', VERT_MAIN);
      shader.vertexShader = injectAfter(shader.vertexShader, '#include <project_vertex>', VERT_NDC);
      shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <common>', FRAG_PARS);
      shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <clipping_planes_fragment>', FRAG_MAIN);
    } else {
      shader.uniforms.uXray = src as { value: number };
      shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <common>', UNIFORM_FRAG_PARS);
      shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <clipping_planes_fragment>', UNIFORM_FRAG_MAIN);
    }
  };
  mat.customProgramCacheKey = function (this: M) { return `${prevKey.call(this)}|hw-xray-${byTexture ? 't' : 'u'}`; };
  mat.needsUpdate = true;
  return mat;
}
