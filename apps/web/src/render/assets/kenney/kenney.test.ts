// Owner: K0. Kenney pipeline: scale table measured against manifest.json, remap tables complete for every kit
// material/swatch in all three palettes, template splitting (synthetic glTF-like meshes), shared clay materials,
// palette following, recolouring, declare/preload bookkeeping, and bakeGeometry compatibility.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { bakeGeometry } from '../../kit/bake';
import { PALETTES } from '../../palettes';
import {
  BUILDING_UP_ROLE, chroma, hexToRgb, isPaletteRole, kenneyColor, KENNEY_ROLES, lightness, modelRoleMap, NATURE_REMAP, quantizeShade, shadeHex, SWATCH_ROLE, swatchRole,
} from './colors';
import {
  _setKenneyTemplate, declareKenney, KENNEY_BOATS, KENNEY_CARS, KENNEY_KITS, KENNEY_SCALE, KENNEY_SERVICE, kenneyIdsFor, kenneyMaterial,
  kenneyModel, kenneyPalette, kenneyReady, kenneyUseKit, preloadKenney, recolorKenney, setKenneyPalette, type KenneyId, type KenneyKit,
} from './index';
import manifestJson from './manifest.json';
import { buildTemplate, type ColormapPixels } from './template';

interface Entry { name: string; size: [number, number, number]; tris: number; materials: string[] }
const MANIFEST = manifestJson as unknown as Record<KenneyKit, Entry[]>;
const entry = (id: KenneyId): Entry => {
  const [kit, name] = id.split('/') as [KenneyKit, string];
  const e = MANIFEST[kit]?.find((x) => x.name === name);
  if (!e) throw new Error(`not in manifest: ${id}`);
  return e;
};
const scaled = (id: KenneyId) => entry(id).size.map((s) => s * KENNEY_SCALE[id.split('/')[0] as KenneyKit]) as [number, number, number];
const HEX = /^#[0-9a-f]{6}$/i;

describe('KENNEY_SCALE (measured from the manifest)', () => {
  it('covers every kit in the manifest', () => {
    expect([...KENNEY_KITS].sort()).toEqual(Object.keys(MANIFEST).sort());
    for (const k of KENNEY_KITS) expect(KENNEY_SCALE[k]).toBeGreaterThan(0);
  });
  it('broadleaf trees land at 2.0–3.4 u tall, median within 2.2–3.2 u', () => {
    const trees = MANIFEST['nature-kit'].filter((e) => /^tree_(default|oak|detailed|fat|plateau|simple|small|tall|thin|cone|blocks)$/.test(e.name));
    expect(trees.length).toBeGreaterThanOrEqual(10);
    const hs = trees.map((e) => e.size[1] * KENNEY_SCALE['nature-kit']).sort((a, b) => a - b);
    for (const h of hs) { expect(h).toBeGreaterThan(2.0); expect(h).toBeLessThan(3.4); }
    const med = hs[Math.floor(hs.length / 2)]!;
    expect(med).toBeGreaterThan(2.2); expect(med).toBeLessThan(3.2);
  });
  it('bushes stay under knee-to-hip height, fences ≈ our 0.6 u fence', () => {
    expect(scaled('nature-kit/plant_bushDetailed')[1]).toBeGreaterThan(0.5);
    expect(scaled('nature-kit/plant_bushDetailed')[1]).toBeLessThan(0.9);
    expect(scaled('nature-kit/fence_simple')[1]).toBeCloseTo(0.67, 1);
  });
  it('cars ≈ 1.7 u long (kit hatchback 1.72), every everyday car 1.5–2.2 u, narrower than the bus', () => {
    expect(scaled('car-kit/sedan')[2]).toBeGreaterThan(1.55);
    expect(scaled('car-kit/sedan')[2]).toBeLessThan(1.85);
    for (const id of KENNEY_CARS) {
      const [w, h, l] = scaled(id);
      expect(l).toBeGreaterThan(1.5); expect(l).toBeLessThan(2.2);
      expect(w).toBeLessThan(1.25); // bus width
      expect(h).toBeLessThan(1.7);
    }
  });
  it('marina boats 1.3–3.6 u long; train carriages match our 1.36 u train width', () => {
    for (const id of KENNEY_BOATS) { const l = scaled(id)[2]; expect(l).toBeGreaterThan(1.3); expect(l).toBeLessThan(3.6); }
    expect(scaled('train-kit/train-carriage-box')[0]).toBeCloseTo(1.36, 1);
  });
  it('city kits: houses 1.8–3.4 u tall, street light ≈ 1.6 u, road tile ≈ our 2.4 u road + kerbs', () => {
    for (const e of MANIFEST['city-kit-suburban'].filter((x) => x.name.startsWith('building-type-'))) {
      const h = e.size[1] * KENNEY_SCALE['city-kit-suburban'];
      expect(h).toBeGreaterThan(1.8); expect(h).toBeLessThan(3.4);
    }
    expect(scaled('city-kit-roads/light-square')[1]).toBeGreaterThan(1.4);
    expect(scaled('city-kit-roads/road-straight')[0]).toBeGreaterThan(2.3);
    expect(scaled('city-kit-roads/road-straight')[0]).toBeLessThan(3.0);
    expect(KENNEY_SCALE['city-kit-commercial']).toBe(KENNEY_SCALE['city-kit-suburban']);
  });
  it('survival props at toy scale (barrel ≈ 0.43 u, fence ≈ 0.65 u)', () => {
    expect(scaled('survival-kit/barrel')[1]).toBeGreaterThan(0.35);
    expect(scaled('survival-kit/barrel')[1]).toBeLessThan(0.55);
    expect(scaled('survival-kit/fence')[1]).toBeCloseTo(0.65, 1);
  });
  it('KENNEY_CARS / KENNEY_SERVICE / KENNEY_BOATS name real models and do not overlap', () => {
    for (const id of [...KENNEY_CARS, ...KENNEY_SERVICE, ...KENNEY_BOATS]) expect(() => entry(id)).not.toThrow();
    expect(new Set([...KENNEY_CARS, ...KENNEY_SERVICE]).size).toBe(KENNEY_CARS.length + KENNEY_SERVICE.length);
    expect(KENNEY_CARS.every((id) => id.startsWith('car-kit/'))).toBe(true);
    expect(KENNEY_BOATS.every((id) => id.startsWith('watercraft-pack/'))).toBe(true);
  });
});

describe('remap tables', () => {
  it('every nature-kit material in the manifest has a role', () => {
    const mats = new Set(MANIFEST['nature-kit'].flatMap((e) => e.materials));
    for (const m of mats) expect(NATURE_REMAP[m], m).toBeDefined();
  });
  it('tree materials follow the T2 palette roles (autumn in palette c)', () => {
    expect(NATURE_REMAP.leafsGreen).toEqual({ role: 'leaf', idx: 0 });
    expect(NATURE_REMAP.leafsDark).toEqual({ role: 'pine', idx: 0 });
    expect(NATURE_REMAP.woodBark).toEqual({ role: 'trunk', idx: 0 });
    expect(kenneyColor('leaf', 0, 'a')).toBe(PALETTES.a.leaf[0]);
    expect(kenneyColor('leaf', 0, 'c')).toBe(PALETTES.c.leaf[0]);
    expect(kenneyColor('trunk', 0, 'b')).toBe(PALETTES.b.trunk);
  });
  it('every role used resolves to a real colour in all three palettes', () => {
    const roles = new Set([...Object.values(NATURE_REMAP).map((r) => r.role), ...Object.values(SWATCH_ROLE)]);
    for (const role of roles) {
      expect(isPaletteRole(role) || role in KENNEY_ROLES, role).toBe(true);
      for (const p of ['a', 'b', 'c'] as const) {
        const c = kenneyColor(role, 0, p);
        expect(c, `${role}/${p}`).toMatch(HEX);
        expect(c).not.toBe('#9aa0a6');
      }
    }
    for (const [role, v] of Object.entries(KENNEY_ROLES)) {
      expect(role.startsWith('kn'), role).toBe(true);
      expect(v).toHaveLength(3);
      for (const c of v.flat()) expect(c, role).toMatch(HEX);
    }
  });
  it('Kenney colours are tamed: the toy palette is softer than the raw kit', () => {
    // raw Kenney leafsGreen is a saturated teal; ours is the palette leaf green
    expect(chroma(kenneyColor('leaf', 0, 'a'))).toBeLessThan(chroma('#29c9ab') + 0.02);
    // raw Kenney orange/red swatches → our coral/red, no more saturated than the raw ones
    for (const raw of ['#ff7e44', '#cf534f', '#ffc044', '#6794d9', '#61cb8b']) expect(chroma(kenneyColor(swatchRole(raw), 0, 'a'))).toBeLessThanOrEqual(chroma(raw) + 0.01);
  });
  it('swatchRole: exact blocks, nearest fallback for unknown colours', () => {
    expect(swatchRole('#61CB8B')).toBe('knGreen');
    expect(swatchRole('#d0e8ff')).toBe('knSky');
    expect(swatchRole('#fefefe')).toBe('knWhite');
    expect(swatchRole('#36363a')).toBe('knDark');
    expect(swatchRole('#ff7b48')).toBe('knOrange');
  });
  it('shade: quantized, bounded, and shadeHex moves lightness that way', () => {
    expect(quantizeShade(0)).toBe(0);
    expect(quantizeShade(-1)).toBe(-0.15);
    expect(quantizeShade(1)).toBe(0.1);
    expect(Math.abs((quantizeShade(-0.1) * 100) % 3)).toBeLessThan(1e-6);
    expect(lightness(shadeHex('#4FAF6E', -0.09))).toBeCloseTo(lightness('#4FAF6E') - 0.09, 2);
    expect(shadeHex('#4FAF6E', 0)).toBe('#4faf6e');
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
  });
});

// ---------- synthetic glTF-like inputs ----------
/** A 2-triangle quad at height y0..y1 in the xz plane facing +z, with given uvs. */
function quad(x0: number, x1: number, y0: number, y1: number, uv: [number, number]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv, ...uv, ...uv, ...uv], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
const named = (name: string, side: THREE.Side = THREE.FrontSide) => Object.assign(new THREE.MeshStandardMaterial({ side }), { name });

/** 64×32 colormap: 8×4 blocks of 8×8 px; block (bx, by) flat half = `flat[by][bx]`, gradient half 20 % darker. */
function colormap(flat: Record<string, string>): ColormapPixels {
  const w = 64, h = 32, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bx = Math.floor(x / 8), by = Math.floor(y / 8), grad = x % 8 >= 4;
    const hex = flat[`${bx},${by}`] ?? '#000000';
    const [r, g, b] = hexToRgb(hex).map((c) => c * 255 * (grad ? 0.8 : 1));
    const o = (y * w + x) * 4; data[o] = r!; data[o + 1] = g!; data[o + 2] = b!; data[o + 3] = 255;
  }
  return { width: w, height: h, data };
}
/** uv at the centre of the gradient half of block (bx, by). */
const gradUv = (bx: number, by: number): [number, number] => [(bx * 8 + 6) / 64, (by * 8 + 4) / 32];

describe('buildTemplate', () => {
  it('nature kit: one part per material role, scale + node transforms baked, indexed pos/normal/uv', () => {
    const root = new THREE.Group();
    const crown = new THREE.Mesh(quad(-0.5, 0.5, 0.5, 1.2, [0, 0]), named('leafsGreen'));
    const trunk = new THREE.Mesh(quad(-0.1, 0.1, 0, 0.5, [0, 0]), named('woodBark'));
    const node = new THREE.Group(); node.position.y = -0.05; node.add(crown, trunk); root.add(node);
    const t = buildTemplate('nature-kit/test', root, 2, null);
    expect(t.parts.map((p) => p.info.role).sort()).toEqual(['leaf', 'trunk']);
    expect(t.tris).toBe(4);
    expect(t.size.y).toBeCloseTo(2.4, 5);
    expect(t.box.min.y).toBeCloseTo(-0.1, 5);
    for (const p of t.parts) {
      expect(p.geometry.index).not.toBeNull();
      expect(Object.keys(p.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
      expect(p.info.shade).toBe(0);
      expect(p.info.paint).toBe(false);
    }
  });
  it('colormap kits: triangles split by Kenney colour block, mean shade kept, blocks with the same look merged', () => {
    const cm = colormap({ '0,1': '#61cb8b', '1,1': '#ffffff', '2,1': '#fde4c7', '3,1': '#ffffff' });
    const root = new THREE.Group();
    const g = new THREE.BufferGeometry();
    const roof = quad(-1, 1, 1, 2, gradUv(0, 1)), wallA = quad(-1, 1, 0, 1, gradUv(1, 1)), wallB = quad(1, 2, 0, 1, gradUv(3, 1));
    const merged = [roof, wallA, wallB];
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    merged.forEach((q, k) => {
      pos.push(...(q.getAttribute('position').array as Float32Array)); nor.push(...(q.getAttribute('normal').array as Float32Array));
      uv.push(...(q.getAttribute('uv').array as Float32Array)); idx.push(...Array.from(q.index!.array).map((i) => i + k * 4));
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    root.add(new THREE.Mesh(g, named('colormap', THREE.DoubleSide)));
    const t = buildTemplate('city-kit-suburban/test', root, 1, cm);
    const roles = t.parts.map((p) => p.info.role).sort();
    expect(roles).toEqual(['knGreen', 'knWhite']); // the two white blocks merged into one part
    const white = t.parts.find((p) => p.info.role === 'knWhite')!;
    expect(white.tris).toBe(4);
    expect(white.info.side).toBe(THREE.DoubleSide);
    expect(white.info.shade).toBeLessThan(0); // sampled from the darker gradient half
    expect(white.info.source).toContain('#ffffff');
  });
  it('building kits: up-facing faces split off (info.up) and dark flat roofs take the warm roof role', () => {
    const cm = colormap({ '2,2': '#4f5260', '1,1': '#ffffff' });
    const roof = new THREE.BufferGeometry();
    const uvR = gradUv(2, 2);
    roof.setAttribute('position', new THREE.Float32BufferAttribute([-1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1], 3));
    roof.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    roof.setAttribute('uv', new THREE.Float32BufferAttribute([...uvR, ...uvR, ...uvR, ...uvR], 2));
    roof.setIndex([0, 1, 2, 0, 2, 3]);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(roof, named('colormap')), new THREE.Mesh(quad(-1, 1, 0, 1, gradUv(2, 2)), named('colormap')), new THREE.Mesh(quad(-1, 1, 0, 1, gradUv(1, 1)), named('colormap')));
    const t = buildTemplate('city-kit-commercial/test', root, 1, cm, { splitUp: true, upRole: BUILDING_UP_ROLE });
    const byRole = Object.fromEntries(t.parts.map((p) => [p.info.role, p.info]));
    expect(Object.keys(byRole).sort()).toEqual(['knRoofFlat', 'knSlate', 'knWhite']);
    expect(byRole.knRoofFlat!.up).toBe(true);
    expect(byRole.knSlate!.up).toBeUndefined();
    // without splitUp, the same faces stay one dark part
    expect(buildTemplate('car-kit/test', root, 1, cm).parts.map((p) => p.info.role).sort()).toEqual(['knSlate', 'knWhite']);
  });
  it('modelRoleMap: suburban houses take our palette roof colour (not planters/trees); roleMap applies after upRole', () => {
    expect(modelRoleMap('city-kit-suburban/building-type-a')).toEqual({ knGreen: 'roof' });
    expect(modelRoleMap('city-kit-suburban/building-type-u')?.knGreen).toBe('roof');
    for (const id of ['city-kit-suburban/planter', 'city-kit-suburban/tree-large', 'city-kit-commercial/building-a', 'car-kit/sedan', 'nature-kit/tree_oak']) {
      expect(modelRoleMap(id)).toBeUndefined();
    }
    expect(isPaletteRole('roof')).toBe(true);
    const cm = colormap({ '3,0': '#61cb8b', '1,1': '#ffffff' });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(quad(-1, 1, 0, 1, gradUv(3, 0)), named('colormap')), new THREE.Mesh(quad(-1, 1, 0, 1, gradUv(1, 1)), named('colormap')));
    const t = buildTemplate('city-kit-suburban/building-type-test', root, 1, cm, { splitUp: true, upRole: BUILDING_UP_ROLE, roleMap: { knGreen: 'roof' } });
    expect(t.parts.map((p) => p.info.role).sort()).toEqual(['knWhite', 'roof']);
    expect(t.parts.find((p) => p.info.role === 'roof')!.info.source).toBe('#61cb8b');
  });
  it('mirrored nodes keep outward winding; paint = the largest saturated part of a vehicle', () => {
    const cm = colormap({ '4,1': '#cf534f', '6,1': '#38383d', '7,1': '#d0e8ff' });
    const body = new THREE.Mesh(quad(-1, 1, 0.2, 1, gradUv(4, 1)), named('colormap'));
    const tyre = new THREE.Mesh(quad(-1, -0.6, 0, 0.4, gradUv(6, 1)), named('colormap'));
    const glass = new THREE.Mesh(quad(-0.3, 0.3, 0.6, 0.9, gradUv(7, 1)), named('colormap'));
    tyre.scale.x = -1;
    const root = new THREE.Group(); root.add(body, tyre, glass);
    const t = buildTemplate('car-kit/test', root, 0.5, cm, { paint: true });
    const paint = t.parts.filter((p) => p.info.paint);
    expect(paint).toHaveLength(1);
    expect(paint[0]!.info.role).toBe('knRed');
    const tyrePart = t.parts.find((p) => p.info.role === 'knDark')!;
    const P = tyrePart.geometry.getAttribute('position'), I = tyrePart.geometry.index!;
    const a = new THREE.Vector3().fromBufferAttribute(P, I.getX(0)), b = new THREE.Vector3().fromBufferAttribute(P, I.getX(1)), c = new THREE.Vector3().fromBufferAttribute(P, I.getX(2));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    expect(n.z).toBeGreaterThan(0); // still faces +z after the mirror
    expect(t.size.x).toBeCloseTo(1, 5); // scale 0.5 baked
  });
});

describe('models, materials and palettes', () => {
  const cm = colormap({ '4,1': '#cf534f', '6,1': '#38383d' });
  const car = new THREE.Group();
  car.add(new THREE.Mesh(quad(-1, 1, 0.2, 1, gradUv(4, 1)), named('colormap')), new THREE.Mesh(quad(-1, -0.6, 0, 0.4, gradUv(6, 1)), named('colormap')));
  _setKenneyTemplate('car-kit/test-car', buildTemplate('car-kit/test-car', car, 1, cm, { paint: true }));
  const tree = new THREE.Group();
  tree.add(new THREE.Mesh(quad(-0.5, 0.5, 0.5, 1.2, [0, 0]), named('leafsGreen')), new THREE.Mesh(quad(-0.1, 0.1, 0, 0.5, [0, 0]), named('woodBark')));
  _setKenneyTemplate('nature-kit/test-tree', buildTemplate('nature-kit/test-tree', tree, 1, null));

  it('kenneyModel: throws when not loaded; clones share geometry and clay materials', () => {
    expect(kenneyReady('nature-kit/never-loaded')).toBe(false);
    expect(() => kenneyModel('nature-kit/never-loaded')).toThrow(/not loaded/);
    expect(kenneyReady('nature-kit/test-tree')).toBe(true);
    const a = kenneyModel('nature-kit/test-tree'), b = kenneyModel('nature-kit/test-tree', { scale: 1.2 });
    const ma = a.children as THREE.Mesh[], mb = b.children as THREE.Mesh[];
    expect(ma).toHaveLength(2);
    expect(ma[0]!.geometry).toBe(mb[0]!.geometry);
    expect(ma[0]!.material).toBe(mb[0]!.material);
    expect(b.scale.x).toBeCloseTo(1.2);
    const m = ma[0]!.material as THREE.MeshStandardMaterial;
    expect(m.metalness).toBe(0);
    expect(m.customProgramCacheKey()).toMatch(/^hw-clay/);
    expect(ma.every((x) => x.castShadow && x.receiveShadow)).toBe(true);
  });
  it('palette roles are tagged for bakeGeometry; kn roles bake their own colour; recolorBaked follows palettes', () => {
    const leafMat = kenneyMaterial('leaf', 0);
    expect(leafMat.userData.role).toBe('leaf');
    expect(kenneyMaterial('knRed', 0).userData.role).toBeUndefined();
    const baked = bakeGeometry(kenneyModel('nature-kit/test-tree', { palette: 'c' }), 'c');
    expect(baked.ranges.map((r) => r.role).sort()).toEqual(['leaf', 'trunk']);
    const carBaked = bakeGeometry(kenneyModel('car-kit/test-car', { palette: 'a' }), 'a');
    expect(carBaked.ranges.every((r) => r.role === '' && r.fixed && r.fixed !== '#9aa0a6')).toBe(true);
  });
  it('setKenneyPalette recolours live materials in place; pinned palettes stay', () => {
    setKenneyPalette('a');
    const live = (kenneyModel('nature-kit/test-tree').children as THREE.Mesh[]).find((x) => x.userData.kenney.role === 'leaf')!.material as THREE.MeshStandardMaterial;
    const pinned = (kenneyModel('nature-kit/test-tree', { palette: 'a' }).children as THREE.Mesh[]).find((x) => x.userData.kenney.role === 'leaf')!.material as THREE.MeshStandardMaterial;
    expect(live).not.toBe(pinned);
    const before = live.color.getHexString();
    setKenneyPalette('c');
    expect(kenneyPalette()).toBe('c');
    expect(live.color.getHexString()).not.toBe(before);
    expect(`#${live.color.getHexString()}`).toBe(new THREE.Color(PALETTES.c.leaf[0]).getHexString().replace(/^/, '#'));
    expect(pinned.color.getHexString()).toBe(before);
    setKenneyPalette('a');
  });
  it('recolorKenney: role variants, literal colours, paint; kenneyUseKit swaps to kit materials', () => {
    const t = kenneyModel('nature-kit/test-tree');
    recolorKenney(t, (p) => (p.role === 'leaf' ? { role: 'leaf', idx: 2 } : null));
    const leaf = (t.children as THREE.Mesh[]).find((x) => x.userData.kenney.role === 'leaf')!;
    expect(leaf.userData.kenney.idx).toBe(2);
    expect((leaf.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(PALETTES.a.leaf[2]).getHexString());
    const c = kenneyModel('car-kit/test-car');
    recolorKenney(c, (p) => (p.paint ? { role: 'car', idx: 1 } : null));
    const paint = (c.children as THREE.Mesh[]).find((x) => x.userData.kenney.paint)!;
    const shade = paint.userData.kenney.shade as number;
    expect(shade).toBeLessThan(0); // the paint keeps Kenney's (darker gradient) shade …
    expect((paint.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(shadeHex(PALETTES.a.car[1], shade)).getHexString());
    recolorKenney(c, (p) => (p.paint ? { role: 'car', idx: 1, shade: 0 } : null)); // … unless overridden
    expect((paint.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(new THREE.Color(PALETTES.a.car[1]).getHexString());
    recolorKenney(c, (p) => (p.paint ? '#123456' : null));
    expect((paint.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456');
    // template info is never mutated by recolouring
    expect((kenneyModel('car-kit/test-car').children as THREE.Mesh[]).find((x) => x.userData.kenney.paint)!.userData.kenney.role).toBe('knRed');
    const seen: string[] = [];
    kenneyUseKit(kenneyModel('nature-kit/test-tree'), { mat: (role, idx) => { seen.push(`${role}#${idx}`); return new THREE.MeshStandardMaterial(); } });
    expect(seen.sort()).toEqual(['leaf#0', 'trunk#0']);
  });
  it('declareKenney / kenneyIdsFor de-duplicate; preloadKenney never rejects', async () => {
    declareKenney('kn.test.a', ['nature-kit/tree_oak', 'nature-kit/tree_fat']);
    declareKenney('kn.test.b', ['nature-kit/tree_oak']);
    expect(kenneyIdsFor(['kn.test.a', 'kn.test.b', 'veg.unknown']).sort()).toEqual(['nature-kit/tree_fat', 'nature-kit/tree_oak']);
    await expect(preloadKenney(['nope-kit/x' as KenneyId])).resolves.toBeUndefined();
    expect(kenneyReady('nope-kit/x' as KenneyId)).toBe(false);
  });
});
