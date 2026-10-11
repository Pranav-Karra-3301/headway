// Owner: E1. Terrain layer: Nittany Ridge around the north + west of the board (layered ridges, pine forests,
// rocky summits and headlands where it meets Nittany Lake), stone tunnel portals with lanterns where roads leave
// the board on the mountain sides, and the rail tunnel: the whole off-board run of the line through the ridge is
// underground, with skew portals on the board edge (facing the town and camera) so the train visibly enters and
// leaves. (An on-board `layout.railTunnel` span instead becomes a loaf-shaped spur hill, cut open at road crossings.)
// Draw calls: ≤ 5 — mountains (terrain + road portals, one mesh), rail tunnel (rail portals + any on-board spur and
// its trees, one mesh with its own KitMaterial so the composer can x-ray-fade it: `material.fade.value`), pines,
// broadleaf and rocks (InstancedMeshes; trees sway). Everything is vertex-coloured KitMaterial; palettes repaint in
// place. Terrain beyond the board casts no realtime shadow (bible §3.6); the instanced trees do.
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import { recolorBaked, type Baked, bakeGeometry } from '../../kit/bake';
import type { FrameContext, RenderLayer } from '../../layers';
import { KitMaterial } from '../../materials';
import { colorOf, DEFAULT_PALETTE, PALETTES } from '../../palettes';
import type { PaletteId } from '../../types';
import type { WorldLayout } from '../layout';
import { resolveTerrainRole, terrainRamp } from './colors';
import { createTerrainField, type TerrainField } from './field';
import { bakeFlora, makeBoulder, makeBroadleaf, makePine, scatterFlora, type Inst } from './flora';
import { meshTerrain, type TerrainPart } from './mesh';
import { paintTerrain } from './paint';
import { makePortal } from './portals';

export { createTerrainField } from './field';
export type { TerrainField, PortalSite, TunnelSpan } from './field';

/** Terrain part + baked extras (portals, static trees) in one indexed geometry, repainted in place. */
class Piece {
  readonly geometry = new THREE.BufferGeometry();
  private readonly col: THREE.BufferAttribute;
  private readonly glow: THREE.BufferAttribute;

  constructor(readonly part: TerrainPart, readonly extras: Baked | null) {
    const n = part.count, m = extras ? extras.geometry.getAttribute('position').count : 0;
    const pos = new Float32Array((n + m) * 3), nor = new Float32Array((n + m) * 3), tint = new Float32Array(n + m);
    pos.set(part.positions);
    nor.set(part.normals);
    const xi = extras?.geometry.index;
    const index = new Uint32Array(part.index.length + (xi ? xi.count : 0));
    index.set(part.index);
    if (extras && xi) {
      pos.set(extras.geometry.getAttribute('position').array as Float32Array, n * 3);
      nor.set(extras.geometry.getAttribute('normal').array as Float32Array, n * 3);
      for (let i = 0; i < xi.count; i++) index[part.index.length + i] = xi.getX(i) + n;
    }
    this.col = new THREE.BufferAttribute(new Float32Array((n + m) * 3), 3);
    this.glow = new THREE.BufferAttribute(new Float32Array((n + m) * 3), 3);
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', this.col);
    g.setAttribute('aGlow', this.glow);
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }

  paint(p: PaletteId): void {
    const col = this.col.array as Float32Array, glow = this.glow.array as Float32Array;
    paintTerrain(this.part.info, this.part.count, col, terrainRamp(p), p === 'c');
    if (this.extras) {
      recolorBaked(this.extras, p);
      col.set(this.extras.geometry.getAttribute('color').array as Float32Array, this.part.count * 3);
      glow.set(this.extras.geometry.getAttribute('aGlow').array as Float32Array, this.part.count * 3);
    }
    this.col.needsUpdate = true;
    this.glow.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.extras?.geometry.dispose();
  }
}

interface FloraSet { mesh: THREE.InstancedMesh; baked: Baked; list: Inst[]; color(i: Inst, p: PaletteId, out: THREE.Color): void }

function instanced(name: string, baked: Baked, list: Inst[], material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(baked.geometry, material, Math.max(1, list.length));
  mesh.name = name;
  mesh.count = list.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot);
    mesh.setMatrixAt(i, m4.compose(p.set(it.x, it.y, it.z), q, s.set(it.s, it.s * it.sy, it.s)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createTerrainLayer(map: TownMap, layout: WorldLayout): RenderLayer {
  const field: TerrainField = createTerrainField(map, layout);
  const { band, spur } = meshTerrain(field);
  const flora = scatterFlora(field);
  let palette: PaletteId = DEFAULT_PALETTE;

  // ---- extras baked into the two terrain meshes
  const roadPortals = new THREE.Group();
  for (const s of field.portals) if (s.kind === 'road') roadPortals.add(makePortal(s));
  const spurExtras = new THREE.Group();
  for (const s of field.portals) if (s.kind === 'rail') spurExtras.add(makePortal(s));
  const pine = makePine(), leafy = makeBroadleaf();
  for (const t of flora.spurTrees) {
    const o = (t.pine ? pine : leafy).clone();
    o.position.set(t.x, t.y, t.z);
    o.rotation.y = t.rot;
    o.scale.set(t.s, t.s * t.sy, t.s);
    spurExtras.add(o);
  }
  const bake = (g: THREE.Group) => (g.children.length ? bakeGeometry(g, palette, { resolve: resolveTerrainRole }) : null);
  const mountains = new Piece(band, bake(roadPortals));
  const rail = new Piece(spur, bake(spurExtras));

  const groundMat = new KitMaterial({ roughness: 0.94 });
  const spurMat = new KitMaterial({ roughness: 0.94 });
  const treeMat = new KitMaterial({ sway: true, roughness: 0.88 });

  const object = new THREE.Group();
  object.name = 'terrain';
  const mMesh = new THREE.Mesh(mountains.geometry, groundMat);
  mMesh.name = 'terrain:mountains';
  const sMesh = new THREE.Mesh(rail.geometry, spurMat);
  sMesh.name = 'terrain:railTunnel';
  sMesh.userData.occluder = 'railTunnel';
  for (const m of [mMesh, sMesh]) { m.castShadow = true; m.receiveShadow = true; object.add(m); }

  // ---- instanced flora
  const tmp = new THREE.Color(), haze = new THREE.Color();
  const jitter = (c: THREE.Color, it: Inst, amt: number) => c.offsetHSL((it.tone - 0.5) * 0.035 * amt, ((it.tone * 7.31) % 1 - 0.5) * 0.12 * amt, ((it.tone * 13.7) % 1 - 0.5) * 0.09 * amt);
  const sets: FloraSet[] = [];
  const addSet = (name: string, root: THREE.Object3D, tint: number, list: Inst[], mat: THREE.Material, color: FloraSet['color']) => {
    if (!list.length) return;
    const baked = bakeFlora(root, palette, tint);
    const mesh = instanced(name, baked, list, mat);
    sets.push({ mesh, baked, list, color });
    object.add(mesh);
  };
  addSet('terrain:pines', makePine(), 0.72, flora.conifers, treeMat, (it, p, out) => {
    const P = PALETTES[p];
    jitter(out.set(colorOf(P, 'pine', Math.floor(it.tone * 2))), it, 1);
  });
  addSet('terrain:broadleaf', makeBroadleaf(), 0.8, flora.broadleaf, treeMat, (it, p, out) => {
    const P = PALETTES[p];
    jitter(out.set(colorOf(P, 'leaf', Math.floor(it.tone * 4))), it, 1);
  });
  addSet('terrain:rocks', makeBoulder(), 1, flora.rocks, groundMat, (it, p, out) => {
    jitter(out.set(resolveTerrainRole('trRock', Math.floor(it.tone * 3), PALETTES[p]) ?? '#c8c0b0'), it, 0.6);
  });

  const setPalette = (p: PaletteId) => {
    palette = p;
    mountains.paint(p);
    rail.paint(p);
    haze.copy(terrainRamp(p).haze);
    for (const s of sets) {
      recolorBaked(s.baked, p);
      s.list.forEach((it, i) => {
        s.color(it, p, tmp);
        tmp.lerp(haze, it.haze);
        s.mesh.setColorAt(i, tmp);
      });
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  };
  setPalette(palette);

  return {
    name: 'terrain',
    object,
    update(_ctx: FrameContext) { /* static: sway + dusk glow ride the shared KitMaterial uniforms */ },
    setPalette,
    dispose() {
      mountains.dispose();
      rail.dispose();
      for (const s of sets) { s.baked.geometry.dispose(); s.mesh.dispose(); }
      groundMat.dispose();
      spurMat.dispose();
      treeMat.dispose();
    },
  };
}
