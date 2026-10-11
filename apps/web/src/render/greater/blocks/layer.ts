// Owner: G2. The outer-neighbourhood render layer: ./plan's items through the asset registry (Kenney houses, shops,
// works, props, K1 trees) with the clay KitContext, baked like the town (kit/bake → vertex-coloured KitMaterial):
//   ground   lots: gardens, lawns, meadows, parking + paint, works yards, crop rows, paths      1 mesh (no shadow)
//   statics  buildings, cars, props, street lights, traffic lights, signs, poles              1 mesh
//   trees    one InstancedMesh per tree kind × variant (swaying KitMaterial)                  ≤ 15
//   wires    power lines strung between the poles (LineSegments)                              1
//   glow     dusk halos round the street-light heads + soft pools under them (fx/glow)        2
// Highlight: scenery fades 60 % toward the background while a route is highlighted (ctx.highlightedRoute).
//   await preloadGreaterBlocks();                       // Kenney models (falls back to kit builders if missing)
//   const layer = createGreaterBlocksLayer(TOWN, { palette: 'a' });  scene.add(layer.object);
import * as THREE from 'three';
import type { TownMap } from '@headway/sim';
import { createRegistry, type AssetRegistry } from '../../assets/index';
import { kenneyIdsFor, kenneyModel, kenneyReady, preloadKenney, type KenneyId } from '../../assets/kenney/index';
import { bakeGeometry, recolorBaked, type Baked, type RoleResolver } from '../../kit/bake';
import type { FrameContext, RenderLayer } from '../../layers';
import { createHalos, createPools, type GlowItem } from '../../fx/glow';
import { KitMaterial, shared } from '../../materials';
import { PALETTES, type Palette } from '../../palettes';
import { createClayKit, createClayKitShared, disposeClayKitShared, placementSeed, roleResolver } from '../../town/kitContext';
import type { PaletteId } from '../../types';
import { planGreaterBlocks, TREE_VARIANTS, type BlockItem, type BlocksPlan, type LotKind } from './plan';

export interface GreaterBlocksOptions { palette?: PaletteId }

export interface GreaterBlocksStats { items: number; trees: number; lots: number; poles: number; meshes: number; placeholders: number }

export interface GreaterBlocksLayer extends RenderLayer {
  readonly plan: BlocksPlan;
  readonly stats: GreaterBlocksStats;
  /** Fade scenery toward the background (0..1), e.g. 0.6 while a route is highlighted. Eased in update(). */
  setFade(v: number): void;
  /** Eases the fade (ctx.highlightedRoute, when given, drives it: 0.6 while a route is highlighted). */
  update(ctx?: Partial<FrameContext>): void;
}

// ---------------------------------------------------------------- lot surfaces (custom roles, palettes a / b / c)
const LOT_ROLES: Record<string, [string, string, string]> = {
  gbGarden0: ['#9DD2A9', '#C6D2A2', '#B8CA95'],
  gbGarden1: ['#A3D5AC', '#CCD6A8', '#BECF9C'],
  gbGarden2: ['#97CDA3', '#C0CC9C', '#B2C48F'],
  gbLawn: ['#8BC898', '#B5C695', '#A6C187'],
  gbMeadow: ['#B0D9AE', '#D9D6B2', '#D2D3AE'],
  gbDrive: ['#D9D2C4', '#C9BFAE', '#D2CDC2'],
  gbPaving: ['#E4DCCC', '#D6CCB8', '#DCD6CA'],
  gbPath: ['#E8DDC5', '#DCCDB0', '#E2D9C4'],
  gbParking: ['#6A6E7E', '#686A70', '#64686F'],
  gbLine: ['#F4F1EA', '#EDE6D6', '#F4F2EE'],
  gbYard: ['#CFCBC2', '#C4BCAE', '#C9C6BE'],
  gbSoil: ['#C7A684', '#B49473', '#B8987A'],
  gbCropA: ['#C4D98C', '#D7C98A', '#E0BF72'],
  gbCropB: ['#A2CC84', '#BDBE84', '#C9A35B'],
};
const LOT_STYLE: Record<LotKind, { role: (idx: number) => string; top: number }> = {
  meadow: { role: () => 'gbMeadow', top: 0.004 },
  garden: { role: (i) => `gbGarden${i % 3}`, top: 0.008 },
  lawn: { role: () => 'gbLawn', top: 0.008 },
  yard: { role: () => 'gbYard', top: 0.012 },
  soil: { role: () => 'gbSoil', top: 0.012 },
  parking: { role: () => 'gbParking', top: 0.014 },
  drive: { role: () => 'gbDrive', top: 0.016 },
  paving: { role: () => 'gbPaving', top: 0.018 },
  path: { role: () => 'gbPath', top: 0.02 },
  line: { role: () => 'gbLine', top: 0.024 },
  cropA: { role: () => 'gbCropA', top: 0.07 },
  cropB: { role: () => 'gbCropB', top: 0.07 },
};
const paletteIdx = (P: Palette): 0 | 1 | 2 => (P.name === PALETTES.b.name ? 1 : P.name === PALETTES.c.name ? 2 : 0);

/** Raw Kenney models used directly (not through a registry kind). */
const RAW_PREFIX = 'kenney:';
const SWAY_KINDS = new Set(Object.keys(TREE_VARIANTS));

let registry: AssetRegistry | null = null;
function getRegistry(): AssetRegistry {
  return (registry ??= createRegistry());
}

/** Every Kenney model the layer needs for a map. */
export function greaterBlocksModels(map: TownMap): KenneyId[] {
  const plan = planGreaterBlocks(map);
  getRegistry(); // families declare their Kenney models at registration
  const kinds = new Set<string>(), raw = new Set<KenneyId>();
  for (const it of plan.items) {
    if (it.kind.startsWith(RAW_PREFIX)) raw.add(it.kind.slice(RAW_PREFIX.length) as KenneyId);
    else kinds.add(it.kind);
  }
  return [...kenneyIdsFor(kinds), ...raw];
}

/** Load the Kenney models (never rejects; anything missing falls back to the kit builders). */
export function preloadGreaterBlocks(map: TownMap): Promise<void> {
  return preloadKenney(greaterBlocksModels(map));
}

export function createGreaterBlocksLayer(map: TownMap, opts: GreaterBlocksOptions = {}): GreaterBlocksLayer {
  let palette: PaletteId = opts.palette ?? 'a';
  const plan = planGreaterBlocks(map);
  const reg = getRegistry();
  const famResolve = roleResolver(reg.roles);
  const resolve: RoleResolver = (role, idx, P) => LOT_ROLES[role]?.[paletteIdx(P)] ?? famResolve(role, idx, P);
  const kitShared = createClayKitShared(reg.roles, palette);
  const object = new THREE.Group();
  object.name = 'greater-blocks';
  const bakes: Baked[] = [];
  const stats: GreaterBlocksStats = { items: 0, trees: 0, lots: plan.lots.length, poles: 0, meshes: 0, placeholders: 0 };

  const groundMat = new KitMaterial({ roughness: 0.95 });
  const sceneryMat = new KitMaterial();
  const treeMat = new KitMaterial({ sway: true });
  const mats = [groundMat, sceneryMat, treeMat];

  const addMesh = (b: Baked, mat: THREE.Material, name: string, cast: boolean): THREE.Mesh => {
    bakes.push(b);
    const m = new THREE.Mesh(b.geometry, mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    object.add(m);
    stats.meshes++;
    return m;
  };

  // ---------------------------------------------------------------- ground lots
  const lotGroup = new THREE.Group();
  const lotMats = new Map<string, THREE.MeshStandardMaterial>();
  const lotMat = (role: string) => {
    let m = lotMats.get(role);
    if (!m) { m = new THREE.MeshStandardMaterial(); m.name = `${role}#0`; m.userData.role = role; m.userData.idx = 0; lotMats.set(role, m); }
    return m;
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  for (const l of plan.lots) {
    const st = LOT_STYLE[l.kind];
    const bottom = -0.02;
    const m = new THREE.Mesh(unitBox, lotMat(st.role(l.idx ?? 0)));
    m.scale.set(l.rect.maxX - l.rect.minX, st.top - bottom, l.rect.maxZ - l.rect.minZ);
    m.position.set((l.rect.minX + l.rect.maxX) / 2, bottom, (l.rect.minZ + l.rect.maxZ) / 2);
    lotGroup.add(m);
  }
  if (lotGroup.children.length) addMesh(bakeGeometry(lotGroup, palette, { resolve }), groundMat, 'greater-blocks:ground', false);
  unitBox.dispose();
  for (const m of lotMats.values()) m.dispose();

  // ---------------------------------------------------------------- items
  const build = (it: BlockItem): THREE.Object3D => {
    if (it.kind.startsWith(RAW_PREFIX)) {
      const id = it.kind.slice(RAW_PREFIX.length) as KenneyId;
      const o = kenneyReady(id) ? kenneyModel(id) : new THREE.Group();
      if (!kenneyReady(id)) o.userData.placeholder = true;
      o.position.set(it.x, it.y ?? 0, it.z);
      o.rotation.y = it.rot;
      return o;
    }
    const k = createClayKit(kitShared, placementSeed(it.kind, it.x, it.z));
    let o: THREE.Object3D;
    try {
      o = reg.build(k, { kind: it.kind, x: it.x, z: it.z, rot: it.rot, ...(it.scale ? { scale: it.scale } : {}), ...(it.params ? { params: it.params } : {}) });
    } catch (e) {
      console.warn(`[greater-blocks] ${it.kind} failed to build`, e);
      o = new THREE.Group();
      o.userData.placeholder = true;
    }
    if (it.y) o.position.y = it.y;
    return o;
  };

  // poles: turn each so its cross-arm stands across the line (measured from the model), then string wires
  const poleArm = measurePole(build);
  const poleRot = new Map<number, number>();
  for (const line of plan.lines) {
    for (let i = 0; i < line.length; i++) {
      const a = plan.items[line[Math.max(0, i - 1)]!]!, b = plan.items[line[Math.min(line.length - 1, i + 1)]!]!;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      poleRot.set(line[i]!, poleArm.axis === 'x' ? yaw : yaw + Math.PI / 2);
    }
  }

  const statics = new THREE.Group();
  const protos = new Map<string, { baked: Baked; matrices: THREE.Matrix4[] }>();
  plan.items.forEach((raw, i) => {
    const it = poleRot.has(i) ? { ...raw, rot: poleRot.get(i)! } : raw;
    stats.items++;
    if (it.role === 'pole') stats.poles++;
    if (SWAY_KINDS.has(it.kind)) {
      const variant = Number(it.params?.variant ?? 0);
      const key = `${it.kind}#${variant}`;
      let proto = protos.get(key);
      const o = build(proto ? { ...it, x: 0, z: 0 } : it);
      if (!proto) {
        proto = { baked: bakeGeometry(o, palette, { resolve }), matrices: [] };
        protos.set(key, proto);
      }
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(it.x, 0, it.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot),
        new THREE.Vector3().setScalar(it.scale ?? 1),
      );
      proto.matrices.push(m);
      stats.trees++;
      return;
    }
    const o = build(it);
    if (o.userData.placeholder) stats.placeholders++;
    statics.add(o);
  });
  if (statics.children.length) addMesh(bakeGeometry(statics, palette, { resolve }), sceneryMat, 'greater-blocks:statics', true);

  for (const [key, proto] of protos) {
    bakes.push(proto.baked);
    const mesh = new THREE.InstancedMesh(proto.baked.geometry, treeMat, proto.matrices.length);
    mesh.name = `greater-blocks:trees:${key}`;
    proto.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    object.add(mesh);
    stats.meshes++;
  }

  // ---------------------------------------------------------------- wires
  const wirePos: number[] = [];
  for (const line of plan.lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const A = plan.items[line[i]!]!, B = plan.items[line[i + 1]!]!;
      const ends = (it: BlockItem, rot: number) => {
        const c = Math.cos(rot), s = Math.sin(rot);
        // local (±arm, h, 0) or (0, h, ±arm) turned by rot about +y: x' = x c + z s, z' = −x s + z c
        const lx = poleArm.axis === 'x' ? poleArm.half : 0, lz = poleArm.axis === 'z' ? poleArm.half : 0;
        return [
          new THREE.Vector3(it.x + lx * c + lz * s, poleArm.h, it.z - lx * s + lz * c),
          new THREE.Vector3(it.x - lx * c - lz * s, poleArm.h, it.z + lx * s - lz * c),
        ];
      };
      const [a0, a1] = ends(A, poleRot.get(line[i]!) ?? A.rot), [b0, b1] = ends(B, poleRot.get(line[i + 1]!) ?? B.rot);
      const straight = a0!.distanceTo(b0!) + a1!.distanceTo(b1!) <= a0!.distanceTo(b1!) + a1!.distanceTo(b0!);
      const pairs: Array<[THREE.Vector3, THREE.Vector3]> = straight ? [[a0!, b0!], [a1!, b1!]] : [[a0!, b1!], [a1!, b0!]];
      for (const [p, q] of pairs) {
        const L = p.distanceTo(q), sag = Math.min(0.45, 0.025 * L);
        const N = 8;
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          const y0 = -4 * sag * t0 * (1 - t0), y1 = -4 * sag * t1 * (1 - t1);
          wirePos.push(p.x + (q.x - p.x) * t0, p.y + (q.y - p.y) * t0 + y0, p.z + (q.z - p.z) * t0);
          wirePos.push(p.x + (q.x - p.x) * t1, p.y + (q.y - p.y) * t1 + y1, p.z + (q.z - p.z) * t1);
        }
      }
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePos, 3));
  const wireMat = new THREE.LineBasicMaterial({ color: '#4B4A52', transparent: true, opacity: 0.55, depthWrite: false });
  const wires = new THREE.LineSegments(wireGeo, wireMat);
  wires.name = 'greater-blocks:wires';
  wires.matrixAutoUpdate = false;
  if (wirePos.length) { object.add(wires); stats.meshes++; }

  // ---------------------------------------------------------------- dusk glow (street lights)
  const lamp = measureLamp(build);
  const heads = plan.items.filter((it) => it.kind === 'kn.prop.streetLight').map((it) => ({
    x: it.x + Math.sin(it.rot) * lamp.reach, y: lamp.h, z: it.z + Math.cos(it.rot) * lamp.reach,
  }));
  const lampColor = () => PALETTES[palette].lamp;
  const halos = createHalos(heads.map((p): GlowItem => ({ p, size: 0.8, color: lampColor(), strength: 1.1 })));
  const pools = createPools(heads.map((p): GlowItem => ({ p: { x: p.x, y: 0.06, z: p.z }, size: 1.6, color: lampColor(), strength: 0.3 })));
  const glows = [halos, pools];
  for (const gl of glows) { gl.mesh.visible = false; object.add(gl.mesh); stats.meshes++; }

  disposeClayKitShared(kitShared);

  // ---------------------------------------------------------------- fade / palette
  let fade = 0, goal = 0;
  return {
    name: 'greater-blocks',
    object,
    plan,
    stats,
    setFade(v) { goal = Math.max(0, Math.min(1, v)); },
    update(ctx?: Partial<FrameContext>) {
      if (ctx && 'highlightedRoute' in ctx) goal = ctx.highlightedRoute ? 0.6 : 0;
      const dt = Math.max(0, ctx?.dtS ?? 1 / 60);
      fade += (goal - fade) * (1 - Math.exp(-dt * 7));
      groundMat.fade.value = fade * 0.5;
      sceneryMat.fade.value = fade;
      treeMat.fade.value = fade;
      wireMat.opacity = 0.55 * (1 - fade * 0.6);
      const intensity = shared.uDusk.value * (1 - 0.45 * fade);
      for (const gl of glows) {
        gl.material.uniforms.uI!.value = intensity;
        gl.mesh.visible = intensity > 0.004 && gl.mesh.count > 0;
      }
    },
    setPalette(p) {
      if (p === palette) return;
      palette = p;
      for (const b of bakes) recolorBaked(b, p);
      for (const gl of glows) gl.recolor(() => lampColor());
    },
    dispose() {
      for (const b of bakes) b.geometry.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      for (const gl of glows) gl.dispose();
      for (const m of mats) m.dispose();
      object.clear();
    },
  };
}

/** Street-light head: height and reach of the arm along +z (from the built model at rot 0). */
function measureLamp(build: (it: BlockItem) => THREE.Object3D): { h: number; reach: number } {
  const o = build({ kind: 'kn.prop.streetLight', x: 0, z: 0, rot: 0, role: 'street', block: '' });
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return { h: 1.7, reach: 0.45 };
  return { h: box.max.y - 0.08, reach: Math.max(0, box.max.z - 0.12) };
}

/** Pole cross-arm: which local axis it spans, its half length and the wire height (from the built model). */
function measurePole(build: (it: BlockItem) => THREE.Object3D): { axis: 'x' | 'z'; half: number; h: number } {
  const o = build({ kind: 'kn.prop.powerPole', x: 0, z: 0, rot: 0, role: 'pole', block: '' });
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return { axis: 'x', half: 0.9, h: 2.1 };
  const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
  const axis = sx >= sz ? 'x' : 'z';
  return { axis, half: (Math.max(sx, sz) / 2) * 0.86, h: box.max.y * 0.93 };
}
