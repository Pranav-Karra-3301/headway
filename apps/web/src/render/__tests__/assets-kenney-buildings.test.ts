// Owner: K3 Kenney buildings + props. Runs the REAL Kenney models (GLB geometry + kit colormaps, decoded here without
// a DOM) through K0's template pipeline, then checks every kn.house/shop/works/prop kind and the res.house /
// res.townhouses overrides: catalog ↔ specs, footprint (+10 %) / height (±25 %) per model, re-centred, triangle
// budgets, every role resolvable in both kits and all palettes, roofs vs. shrubs split, dark shopfronts recoloured,
// deterministic per-placement variety, bake compatibility, preload declarations and toy fallbacks before loading.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { CATALOG, CATALOG_BY_KIND } from '../assets/catalog';
import {
  BUILDING_SPECS, KENNEY_FAMILY, LOOKS, register, RES_HOUSE_IDS, RES_TOWNHOUSE_IDS, ROLES, variant,
} from '../assets/families/kenney-buildings';
import { register as registerResidential } from '../assets/families/residential';
import { _setKenneyTemplate, KENNEY_SCALE, kenneyIdsFor, kenneyReady, type KenneyId, type KenneyKit } from '../assets/kenney';
import { BUILDING_UP_ROLE, modelRoleMap } from '../assets/kenney/colors';
import { buildTemplate, type ColormapPixels } from '../assets/kenney/template';
import { AssetRegistry } from '../assets/registry';
import type { AssetParams, KitContext } from '../assets/types';
import { bakeGeometry } from '../kit/bake';
import { PALETTES } from '../palettes';
import { anyRoleColor, roleResolver } from '../town/kitContext';

/** Node built-ins without @types/node (the web tsconfig has DOM types only; vitest runs in Node). */
interface NodeFs { readFileSync(p: URL): Uint8Array }
interface NodeZlib { inflateSync(b: Uint8Array): Uint8Array }
const nodeModule = <T>(name: string): T => (globalThis as unknown as { process: { getBuiltinModule(n: string): T } }).process.getBuiltinModule(name);
const fs = nodeModule<NodeFs>('node:fs');
const zlib = nodeModule<NodeZlib>('node:zlib');
const MODELS = new URL('../../../public/models/kenney/', import.meta.url);
const readModelFile = (rel: string): Uint8Array => fs.readFileSync(new URL(rel, MODELS));
const SEEDS = Array.from({ length: 24 }, (_, i) => i * 7919 + 13);
const ALL_IDS = [...new Set([...BUILDING_SPECS.flatMap((s) => s.ids), ...RES_HOUSE_IDS, ...RES_TOWNHOUSE_IDS])];
const K3_KIND = /^kn\.(house|shop|works|prop)\./;

// ---------------------------------------------------------------- fixtures: GLB + PNG without a DOM
/** GLB with images/textures removed (geometry + UVs kept), so GLTFLoader never needs an image decoder. */
function glbWithoutImages(buf: Uint8Array): ArrayBuffer {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture;
  }
  const text = JSON.stringify(json);
  const js = new TextEncoder().encode(text + ' '.repeat((4 - (new TextEncoder().encode(text).length % 4)) % 4));
  const rest = buf.subarray(20 + jsonLen);
  const out = new Uint8Array(20 + js.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(buf.subarray(0, 8), 0);
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, js.length, true);
  ov.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(js, 20);
  out.set(rest, 20 + js.length);
  return out.buffer;
}

/** Minimal PNG decoder (8-bit, non-interlaced, colour types 2 / 3 / 6) → RGBA. */
function decodePng(buf: Uint8Array): ColormapPixels {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 8, w = 0, h = 0, ct = 0;
  let plte: Uint8Array | undefined, trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = dv.getUint32(off), type = String.fromCharCode(...buf.subarray(off + 4, off + 8)), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(off + 8); h = dv.getUint32(off + 12); ct = data[9]!; expect(data[8]).toBe(8); expect(data[12]).toBe(0); }
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((o, d) => { joined.set(d, o); return o + d.length; }, 0);
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(joined);
  const stride = w * bpp, rows = new Uint8Array(stride * h), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[dst + x - bpp]! : 0, b = y > 0 ? rows[dst - stride + x]! : 0, c = x >= bpp && y > 0 ? rows[dst - stride + x - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      rows[dst + x] = (raw[src + x]! + pred) & 255;
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (ct === 3) { const p = rows[i]!; out.set([plte![p * 3]!, plte![p * 3 + 1]!, plte![p * 3 + 2]!, trns && p < trns.length ? trns[p]! : 255], i * 4); }
    else if (ct === 2) out.set([rows[i * 3]!, rows[i * 3 + 1]!, rows[i * 3 + 2]!, 255], i * 4);
    else out.set(rows.subarray(i * 4, i * 4 + 4), i * 4);
  }
  return { width: w, height: h, data: out };
}

const colormaps = new Map<KenneyKit, ColormapPixels>();
async function loadReal(id: KenneyId): Promise<void> {
  const kit = id.slice(0, id.indexOf('/')) as KenneyKit;
  let cm = colormaps.get(kit);
  if (!cm) { cm = decodePng(readModelFile(`${kit}/Textures/colormap.png`)); colormaps.set(kit, cm); }
  const gltf = await new GLTFLoader().parseAsync(glbWithoutImages(readModelFile(`${id}.glb`)), '');
  const building = kit === 'city-kit-suburban' || kit === 'city-kit-commercial' || kit === 'city-kit-industrial';
  // same options as K0's loader (kenney/index.ts loadOne)
  _setKenneyTemplate(id, buildTemplate(id, gltf.scene, KENNEY_SCALE[kit], cm, {
    splitUp: building, upRole: building ? BUILDING_UP_ROLE : undefined, roleMap: modelRoleMap(id),
  }));
}

// ---------------------------------------------------------------- helpers
function registry(withResidential = true): AssetRegistry {
  const r = new AssetRegistry();
  if (withResidential) registerResidential(r);
  register(r);
  return r;
}
function trackingKit(seed: number) {
  const base = createBasicKit(ROLES, 0, seed);
  const roles = new Set<string>();
  const k: KitContext = { ...base, mat(role, idx) { roles.add(role); return base.mat(role, idx); } };
  return { k, roles };
}
const build = (r: AssetRegistry, kind: string, params: AssetParams = {}, seed = 1) => {
  const { k, roles } = trackingKit(seed);
  const obj = r.build(k, { kind, x: 0, z: 0, params });
  obj.updateMatrixWorld(true);
  return { obj, roles };
};
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o, true);
function tris(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; });
  return n;
}
/** Role/idx of every mesh (built with taggingKit, whose materials carry their role like the composer's clay kit). */
function meshRoles(o: THREE.Object3D): Array<{ mesh: THREE.Mesh; role: string; idx: number }> {
  const out: Array<{ mesh: THREE.Mesh; role: string; idx: number }> = [];
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) out.push({ mesh: m, role: String((m.material as THREE.Material).userData.role), idx: Number((m.material as THREE.Material).userData.idx ?? 0) });
  });
  return out;
}
/** A kit whose materials remember their role (like the composer's clay kit). */
function taggingKit(seed: number): KitContext {
  const base = createBasicKit(ROLES, 0, seed);
  return { ...base, mat(role, idx = 0) { const m = base.mat(role, idx).clone(); m.userData.role = role; m.userData.idx = idx; return m; } };
}
const isK3 = (kind: string) => K3_KIND.test(kind);

// ---------------------------------------------------------------- before any model is loaded
describe('K3 before models load', () => {
  it('nothing is loaded yet; every kind still builds: res.* fall back to A3, kn.* to a toy stand-in inside the footprint', () => {
    for (const id of ALL_IDS) expect(kenneyReady(id), id).toBe(false);
    const r = registry();
    const a3 = new AssetRegistry();
    registerResidential(a3);
    for (const kind of ['res.house', 'res.townhouses']) {
      const { obj } = build(r, kind, { wall: 1 }, 5);
      const ref = a3.build(createBasicKit(ROLES, 0, 5), { kind, x: 0, z: 0, params: { wall: 1 } });
      expect(tris(obj), kind).toBe(tris(ref));
    }
    for (const s of BUILDING_SPECS) {
      const { obj } = build(r, s.kind);
      const sz = box(obj).getSize(new THREE.Vector3());
      expect(sz.x, s.kind).toBeLessThanOrEqual(s.w * 1.1);
      expect(sz.z, s.kind).toBeLessThanOrEqual(s.d * 1.1 + 0.1);
      expect(sz.y, s.kind).toBeLessThanOrEqual(s.h * 1.25);
    }
  });
});

describe('K3 catalog + specs', () => {
  it('every spec has a catalog entry (same footprint/height, family kenney) and every K3 catalog kind has a spec', () => {
    for (const s of BUILDING_SPECS) {
      const c = CATALOG_BY_KIND.get(s.kind);
      expect(c, s.kind).toBeDefined();
      expect([c!.w, c!.d, c!.h], s.kind).toEqual([s.w, s.d, s.h]);
      expect(c!.family).toBe(KENNEY_FAMILY);
    }
    expect(CATALOG.filter((c) => isK3(c.kind)).map((c) => c.kind).sort()).toEqual(BUILDING_SPECS.map((s) => s.kind).sort());
    expect(new Set(BUILDING_SPECS.map((s) => s.kind)).size).toBe(BUILDING_SPECS.length);
  });

  it('registers every kn.* kind with its catalog footprint; overrides keep the res.* lots; props are instanced', () => {
    const r = registry();
    for (const s of BUILDING_SPECS) {
      const def = r.get(s.kind)!;
      expect(def.footprint).toEqual({ w: s.w, d: s.d });
      expect(def.height).toBe(s.h);
      expect(!!def.instanced, s.kind).toBe(!!s.prop);
    }
    for (const kind of ['res.house', 'res.townhouses']) {
      const c = CATALOG_BY_KIND.get(kind)!;
      expect(r.get(kind)!.footprint).toEqual({ w: c.w, d: c.d });
      expect(r.get(kind)!.family).toBe('residential');
    }
  });

  it('declares every model for preloading (kenneyIdsFor)', () => {
    registry();
    const want = new Set(kenneyIdsFor([...BUILDING_SPECS.map((s) => s.kind), 'res.house', 'res.townhouses']));
    for (const id of ALL_IDS) expect(want.has(id), id).toBe(true);
  });

  it('shops stay low-rise (≤ 3 storeys ≈ 3.5 u)', () => {
    for (const s of BUILDING_SPECS.filter((x) => x.kind.startsWith('kn.shop.'))) expect(s.h).toBeLessThanOrEqual(3.5);
  });
});

// ---------------------------------------------------------------- with the real Kenney models
describe('K3 with the real Kenney models', () => {
  beforeAll(async () => {
    for (const id of ALL_IDS) await loadReal(id);
  }, 60_000);

  it('every model of every kind fits: re-centred, footprint +10 %, height ±25 % (≤ +25 % for mixed kinds)', () => {
    const r = registry();
    for (const s of BUILDING_SPECS) {
      s.ids.forEach((id, model) => {
        const { obj } = build(r, s.kind, { model });
        const b = box(obj), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
        const tag = `${s.kind} ${id}`;
        expect(sz.x, `${tag} w`).toBeLessThanOrEqual(s.w * 1.1);
        expect(sz.z, `${tag} d`).toBeLessThanOrEqual(s.d * 1.1);
        expect(sz.y, `${tag} h`).toBeLessThanOrEqual(s.h * 1.25);
        if (s.ids.length === 1) expect(sz.y, `${tag} h`).toBeGreaterThanOrEqual(s.h * 0.75);
        expect(Math.abs(c.x), `${tag} centred x`).toBeLessThan(0.06);
        expect(Math.abs(c.z), `${tag} centred z`).toBeLessThan(0.06);
        expect(b.min.y, `${tag} on the ground`).toBeGreaterThan(-0.05);
      });
    }
  });

  it('is a Kenney model once loaded (not the stand-in), inside the triangle budgets (buildings 3,000, props 600)', () => {
    const r = registry();
    for (const s of BUILDING_SPECS) {
      for (let model = 0; model < s.ids.length; model++) {
        const { obj } = build(r, s.kind, { model });
        let named = false;
        obj.traverse((o) => { if (o.name.startsWith('kenney:')) named = true; });
        expect(named, s.kind).toBe(true);
        expect(tris(obj), `${s.kind} #${model}`).toBeLessThanOrEqual(s.prop ? 600 : 3000);
      }
    }
  });

  it('res.house: a narrow Kenney house on the 2.5 u lot; res.townhouses: two houses on the 6 u lot', () => {
    const r = registry();
    for (const kind of ['res.house', 'res.townhouses']) {
      const c = CATALOG_BY_KIND.get(kind)!;
      for (const seed of SEEDS.slice(0, 8)) {
        const { obj } = build(r, kind, {}, seed);
        const sz = box(obj).getSize(new THREE.Vector3());
        let n = 0;
        obj.traverse((o) => { if (o.name.startsWith('kenney:')) n++; });
        expect(n, kind).toBe(kind === 'res.house' ? 1 : 2);
        expect(sz.x, kind).toBeLessThanOrEqual(c.w * 1.1);
        expect(sz.z, kind).toBeLessThanOrEqual(c.d * 1.1);
        expect(sz.y, kind).toBeLessThanOrEqual(c.h * 1.25);
        expect(sz.y, kind).toBeGreaterThanOrEqual(c.h * 0.75);
      }
    }
  });

  it('every role resolves: basic kit and composer (palettes a/b/c), never the grey fallback', () => {
    const r = registry();
    const used = new Set<string>();
    for (const s of BUILDING_SPECS) for (const seed of SEEDS.slice(0, 6)) for (const role of build(r, s.kind, {}, seed).roles) used.add(role);
    for (const kind of ['res.house', 'res.townhouses']) for (const role of build(r, kind).roles) used.add(role);
    const basic = createBasicKit(r.roles, 0, 1);
    for (const role of used) {
      expect((basic.mat(role) as THREE.MeshStandardMaterial).color.getHexString(), `basic ${role}`).not.toBe('9aa0a6');
      for (const p of ['a', 'b', 'c'] as const) expect(anyRoleColor(role, 0, p, r.roles).toUpperCase(), `${p} ${role}`).not.toBe('#9AA0A6');
    }
    // family-only roles are namespaced (kn* / knb*), palette roles are real palette roles
    for (const role of used) expect(role.startsWith('kn') || role in PALETTES.a, role).toBe(true);
  });

  it('house roofs take roof colours, the shrubs at their feet stay green (split by height); windows can glow', () => {
    const r = registry();
    for (const s of BUILDING_SPECS.filter((x) => x.kind.startsWith('kn.house.'))) {
      s.ids.forEach((_, model) => {
        const obj = r.build(taggingKit(3), { kind: s.kind, x: 0, z: 0, params: { model, lit: true } });
        obj.updateMatrixWorld(true);
        const parts = meshRoles(obj);
        const roofs = parts.filter((p) => p.role === 'knbRoof');
        if (!s.kind.endsWith('.modern')) expect(roofs.length, `${s.kind} #${model} has a roof`).toBeGreaterThan(0);
        for (const p of roofs) expect(box(p.mesh).max.y, `${s.kind} roof height`).toBeGreaterThan(0.9);
        for (const p of parts.filter((x) => x.role === 'knbHedge')) {
          expect(box(p.mesh).max.y, `${s.kind} shrub`).toBeLessThan(0.7);
          expect(p.mesh.userData.detail).toBe(true);
        }
        expect(parts.some((p) => p.role === 'window' && p.idx === 1), `${s.kind} lit windows`).toBe(true);
        expect(parts.some((p) => p.role === 'roof' || p.role === 'knGreen'), `${s.kind} no raw Kenney green`).toBe(false);
        for (const p of parts.filter((x) => x.role === 'knbDoor')) expect(box(p.mesh).getSize(new THREE.Vector3()).y, `${s.kind} door`).toBeLessThan(2);
      });
    }
  });

  it("shops: Kenney's dark ground floors become painted shopfronts, white walls a facade colour", () => {
    const r = registry();
    for (const s of BUILDING_SPECS.filter((x) => x.kind.startsWith('kn.shop.'))) {
      s.ids.forEach((_, model) => {
        const parts = meshRoles(r.build(taggingKit(9), { kind: s.kind, x: 0, z: 0, params: { model } }));
        expect(parts.some((p) => p.role === 'knSlate' || p.role === 'knDark'), `${s.kind} #${model}`).toBe(false);
        expect(parts.some((p) => p.role === 'knbFacade'), `${s.kind} #${model}`).toBe(true);
      });
    }
  });

  it('per-placement variety is deterministic and varied; params pin colours and models', () => {
    const r = registry();
    const sig = (kind: string, seed: number, params: AssetParams = {}) => {
      const obj = r.build(taggingKit(seed), { kind, x: 0, z: 0, params });
      const ps = meshRoles(obj).map((p) => `${p.role}#${p.idx}`).sort().join(',');
      let id = '';
      obj.traverse((o) => { if (o.userData.kenneyId) id += `${o.userData.kenneyId as string};`; });
      return `${id}|${ps}`;
    };
    for (const kind of ['kn.house.random', 'kn.shop.random', 'res.house']) {
      const sigs = SEEDS.map((s) => sig(kind, s));
      expect(SEEDS.map((s) => sig(kind, s))).toEqual(sigs); // same seed → same building
      expect(new Set(sigs).size, kind).toBeGreaterThanOrEqual(10);
      expect(new Set(sigs.map((x) => x.split('|')[0])).size, `${kind} models`).toBeGreaterThanOrEqual(3);
    }
    expect(sig('kn.house.random', 1, { model: 2, wall: 1, roof: 3, door: 0, lit: false })).toBe(sig('kn.house.random', 99, { model: 2, wall: 1, roof: 3, door: 0, lit: false }));
    const k = createBasicKit(ROLES, 0, 4);
    expect(variant(k, { roof: 7 }, 'house').roof).toBe(2);
  });

  it('bakes through bakeGeometry like kit parts: every range resolves to a role colour (no grey)', () => {
    const r = registry();
    const resolveRole = roleResolver(r.roles);
    for (const kind of ['kn.house.family', 'kn.shop.small', 'kn.works.factory', 'kn.prop.parasol', 'res.townhouses']) {
      const obj = r.build(taggingKit(2), { kind, x: 0, z: 0 });
      for (const p of ['a', 'c'] as const) {
        const baked = bakeGeometry(obj, p, { resolve: resolveRole });
        expect(baked.ranges.length, kind).toBeGreaterThan(2);
        for (const rg of baked.ranges) {
          expect(rg.role, kind).not.toBe('');
          expect(rg.fixed, `${kind} ${rg.role}`).toBeUndefined();
        }
      }
    }
  });

  it('looks map every Kenney part role that occurs in these models (nothing keeps a raw dark/grey Kenney swatch on buildings)', () => {
    const r = registry();
    for (const s of BUILDING_SPECS.filter((x) => !x.prop && x.look !== 'prop')) {
      s.ids.forEach((_, model) => {
        const parts = meshRoles(r.build(taggingKit(1), { kind: s.kind, x: 0, z: 0, params: { model } }));
        for (const p of parts) expect(['knSlate', 'knDark', 'knGreyLight', 'knWhite'], `${s.kind} #${model} ${p.role}`).not.toContain(p.role);
      });
    }
    expect(Object.keys(LOOKS).sort()).toEqual(['house', 'lamp', 'parasol', 'prop', 'shop', 'works']);
  });
});
