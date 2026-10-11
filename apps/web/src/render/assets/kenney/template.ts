// Owner: K0. Turn a loaded Kenney glTF scene into a "template": a few flat-coloured parts (one geometry per role +
// shade), node transforms and the kit scale baked in, ground at y = 0 as authored. Pure three.js (no DOM), so it is
// unit-tested with synthetic meshes. Every part geometry is indexed with position + normal + uv, like the kit
// primitives, so composers can merge/instance Kenney parts together with kit parts.
//  - nature kit: one part per named material (`NATURE_REMAP`).
//  - colormap kits: each triangle belongs to the Kenney colour block under its UV centroid (`SWATCH_ROLE`); the
//    part colour is the role colour shifted by the block's mean lightness offset (`shade`). Kenney's in-texture
//    gradients become flat colours: our clay shader supplies the soft shading instead.
import * as THREE from 'three';
import { lightness, NATURE_REMAP, PAINT_ROLES, quantizeShade, rgbToHex, swatchRole, type Rgb } from './colors';

/** RGBA pixels of a kit's colormap.png (row 0 = top = uv.v 0, as glTF). */
export interface ColormapPixels { width: number; height: number; data: ArrayLike<number> }

export interface KenneyPartInfo {
  /** Nature-kit material name, or the flat hex of the Kenney colormap block. */
  source: string;
  /** Palette role (T2 PALETTES) or a `kn*` role (KENNEY_ROLES). */
  role: string;
  idx: number;
  /** OKLab lightness offset applied to the role colour. */
  shade: number;
  /** The paint of a car/boat: its largest saturated part. Recolour it for variety (or set userData.tint). */
  paint: boolean;
  side: THREE.Side;
  /** Set by recolorKenney when a part was given a literal colour instead of a role. */
  hex?: string;
}
export interface KenneyPart { geometry: THREE.BufferGeometry; info: KenneyPartInfo; tris: number }
export interface KenneyTemplate { id: string; parts: KenneyPart[]; box: THREE.Box3; size: THREE.Vector3; tris: number }

interface Acc {
  source: string; role: string; idx: number; side: THREE.Side; shade: number;
  pos: number[]; nor: number[]; uv: number[]; index: number[];
  lin: [number, number, number]; samples: number; flat: string | null;
}

const v3 = new THREE.Vector3();
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const wrap01 = (t: number) => (t >= 0 && t < 1 ? t : t >= 1 && t < 1.001 ? 0.9999 : t < 0 && t > -0.001 ? 0 : t - Math.floor(t));

function pixel(cm: ColormapPixels, u: number, v: number): Rgb {
  const x = Math.min(cm.width - 1, Math.floor(wrap01(u) * cm.width));
  const y = Math.min(cm.height - 1, Math.floor(wrap01(v) * cm.height));
  const o = (y * cm.width + x) * 4;
  return [cm.data[o]! / 255, cm.data[o + 1]! / 255, cm.data[o + 2]! / 255];
}

/** Kenney colormaps are 8 × 4 blocks; each block = a flat half (left) + a vertical gradient half (right). */
function block(cm: ColormapPixels, u: number, v: number): { key: string; flat: string } {
  const bw = cm.width / 8, bh = cm.height / 4;
  const bx = Math.min(7, Math.floor(wrap01(u) * 8)), by = Math.min(3, Math.floor(wrap01(v) * 4));
  const flat = pixel(cm, (bx * bw + bw / 4) / cm.width, (by * bh + bh / 2) / cm.height);
  return { key: `${bx},${by}`, flat: rgbToHex(flat) };
}

/**
 * Build a template from a glTF scene. `scale` (KENNEY_SCALE of the kit × any extra) is baked into the geometry.
 * `colormap` = the kit's colormap pixels (null for the nature kit). `paint` marks a vehicle's paint part.
 */
export function buildTemplate(id: string, root: THREE.Object3D, scale: number, colormap: ColormapPixels | null, opts: { paint?: boolean } = {}): KenneyTemplate {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const accs = new Map<string, Acc>();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const P = g.getAttribute('position');
    if (!P) return;
    let N = g.getAttribute('normal');
    if (!N) { const c = g.clone(); c.computeVertexNormals(); N = c.getAttribute('normal'); }
    const UV = g.getAttribute('uv');
    const M = new THREE.Matrix4().multiplyMatrices(S, new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    const flip = M.determinant() < 0;
    const I = g.index;
    const count = I ? I.count : P.count;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    const remap = new Map<Acc, Map<number, number>>();

    const vert = (acc: Acc, i: number): number => {
      let m = remap.get(acc);
      if (!m) { m = new Map(); remap.set(acc, m); }
      let n = m.get(i);
      if (n === undefined) {
        n = acc.pos.length / 3;
        m.set(i, n);
        v3.fromBufferAttribute(P, i).applyMatrix4(M); acc.pos.push(v3.x, v3.y, v3.z);
        v3.fromBufferAttribute(N, i).applyMatrix3(NM).normalize(); acc.nor.push(v3.x, v3.y, v3.z);
        if (UV) acc.uv.push(UV.getX(i), UV.getY(i)); else acc.uv.push(0, 0);
      }
      return n;
    };

    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.Material | undefined;
      const side = mat?.side ?? THREE.FrontSide;
      const end = Math.min(count, grp.start + grp.count);
      for (let t = grp.start; t + 2 < end; t += 3) {
        const a = I ? I.getX(t) : t, b = I ? I.getX(t + 1) : t + 1, c = I ? I.getX(t + 2) : t + 2;
        let key: string, source: string, flat: string | null = null;
        if (colormap && UV) {
          const bl = block(colormap, (UV.getX(a) + UV.getX(b) + UV.getX(c)) / 3, (UV.getY(a) + UV.getY(b) + UV.getY(c)) / 3);
          key = `cm:${bl.key}|${side}`; source = bl.flat; flat = bl.flat;
        } else {
          source = mat?.name || '_defaultMat';
          key = `mat:${source}|${side}`;
        }
        let acc = accs.get(key);
        if (!acc) {
          acc = { source, role: '', idx: 0, side, shade: 0, pos: [], nor: [], uv: [], index: [], lin: [0, 0, 0], samples: 0, flat };
          accs.set(key, acc);
        }
        const tri = flip ? [a, c, b] : [a, b, c];
        for (const i of tri) acc.index.push(vert(acc, i));
        if (colormap && UV) {
          for (const i of tri) {
            const p = pixel(colormap, UV.getX(i), UV.getY(i));
            acc.lin[0] += lin(p[0]); acc.lin[1] += lin(p[1]); acc.lin[2] += lin(p[2]); acc.samples++;
          }
        }
      }
    }
  });

  // roles + shades
  for (const acc of accs.values()) {
    if (acc.flat !== null) {
      const mean = rgbToHex([srgb(acc.lin[0] / acc.samples), srgb(acc.lin[1] / acc.samples), srgb(acc.lin[2] / acc.samples)]);
      const black = acc.flat === '#000000';
      acc.role = swatchRole(black ? mean : acc.flat);
      acc.shade = black ? 0 : quantizeShade(lightness(mean) - lightness(acc.flat));
    } else {
      const ref = NATURE_REMAP[acc.source] ?? { role: 'knStone', idx: 0 };
      acc.role = ref.role; acc.idx = ref.idx;
    }
  }

  // merge blocks that ended up with the same look (role, idx, shade, side)
  const merged = new Map<string, Acc>();
  for (const acc of accs.values()) {
    const k = `${acc.role}#${acc.idx}|${acc.shade}|${acc.side}`;
    const m = merged.get(k);
    if (!m) { merged.set(k, acc); continue; }
    const off = m.pos.length / 3;
    for (const x of acc.pos) m.pos.push(x);
    for (const x of acc.nor) m.nor.push(x);
    for (const x of acc.uv) m.uv.push(x);
    for (const i of acc.index) m.index.push(i + off);
    if (acc.index.length > 0 && m.source !== acc.source && !m.source.includes(acc.source)) m.source += `+${acc.source}`;
  }

  const parts: KenneyPart[] = [];
  const box = new THREE.Box3();
  let tris = 0;
  for (const acc of merged.values()) {
    if (!acc.index.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
    const nv = acc.pos.length / 3;
    geometry.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(acc.index) : new Uint16Array(acc.index), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.name = `kenney:${id}:${acc.role}`;
    box.union(geometry.boundingBox!);
    const n = acc.index.length / 3;
    tris += n;
    parts.push({ geometry, tris: n, info: { source: acc.source, role: acc.role, idx: acc.idx, shade: acc.shade, paint: false, side: acc.side } });
  }
  if (opts.paint) {
    let best: KenneyPart | null = null;
    for (const p of parts) if (PAINT_ROLES.has(p.info.role) && (!best || p.tris > best.tris)) best = p;
    if (best && best.tris >= tris * 0.04) best.info.paint = true;
  }
  return { id, parts, box, size: box.getSize(new THREE.Vector3()), tris };
}

/** Hex of the colormap texel under a uv (exported for tests/tools). */
export function colormapHex(cm: ColormapPixels, u: number, v: number): string { return rgbToHex(pixel(cm, u, v)); }
