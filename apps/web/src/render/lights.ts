// Owner: T2.1. Lighting rig: hemisphere sky light + one warm shadow-casting sun, fitted to the board.
// `setDusk(t)` blends day → dusk (low orange sun, long shadows, cool dim sky); emissive glows are driven by
// `shared.uDusk` (materials.ts), floodlights / lamp pools by the FX layer.
import * as THREE from 'three';
import type { Bounds } from './camera';
import { PALETTES } from './palettes';
import type { PaletteId } from './types';

interface Preset { sky: string; ground: string | null; hemi: number; sun: string; sunI: number; dir: THREE.Vector3; shadow: number }

const DAY: Preset = { sky: '#ffffff', ground: null, hemi: 1.45, sun: '#fff0d9', sunI: 2.15, dir: new THREE.Vector3(-14, 34, 22).normalize(), shadow: 0.82 };
const DUSK: Preset = { sky: '#7f9fe6', ground: '#3d3b5c', hemi: 0.74, sun: '#ffb07a', sunI: 1.15, dir: new THREE.Vector3(-30, 12, 14).normalize(), shadow: 0.7 };

export interface LightRig {
  readonly group: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** 0 = day … 1 = dusk. */
  setDusk(t: number): void;
  setPalette(p: PaletteId): void;
  /** Fit the sun's shadow frustum to the board (bounds in xz, heights -1.5 … maxHeight). */
  fit(bounds: Bounds, maxHeight?: number): void;
  setShadowMapSize(n: number): void;
  dispose(): void;
}

export function createLights(opts: { bounds?: Bounds; palette?: PaletteId; dusk?: number; shadowMapSize?: number } = {}): LightRig {
  const group = new THREE.Group();
  group.name = 'lights';
  const hemi = new THREE.HemisphereLight(DAY.sky, PALETTES.a.board, DAY.hemi);
  const sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMapSize ?? 4096, opts.shadowMapSize ?? 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.2;
  group.add(hemi, sun, sun.target);

  let bounds: Bounds = opts.bounds ?? { minX: -20, maxX: 20, minZ: -15, maxZ: 15 };
  let maxH = 10;
  let palette: PaletteId = opts.palette ?? 'a';
  let dusk = opts.dusk ?? 0;
  const dir = new THREE.Vector3();
  const ca = new THREE.Color(), cb = new THREE.Color();
  const m = new THREE.Matrix4(), v = new THREE.Vector3(), box = new THREE.Box3();

  const fit = (b: Bounds, mh = maxH) => {
    bounds = b; maxH = mh;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + mh;
    sun.target.position.set(cx, 0, cz);
    sun.position.set(cx, 0, cz).addScaledVector(dir, r + 20);
    sun.updateMatrixWorld(true);
    sun.target.updateMatrixWorld(true);
    m.lookAt(sun.position, sun.target.position, THREE.Object3D.DEFAULT_UP);
    m.setPosition(sun.position);
    m.invert();
    box.makeEmpty();
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) for (const y of [-1.6, mh]) box.expandByPoint(v.set(x, y, z).applyMatrix4(m));
    const cam = sun.shadow.camera;
    const pad = 0.5;
    cam.left = box.min.x - pad; cam.right = box.max.x + pad;
    cam.bottom = box.min.y - pad; cam.top = box.max.y + pad;
    cam.near = Math.max(0.1, -box.max.z - 5); cam.far = -box.min.z + 5;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  };

  const apply = () => {
    const t = dusk;
    dir.copy(DAY.dir).lerp(DUSK.dir, t).normalize();
    hemi.color.copy(ca.set(DAY.sky)).lerp(cb.set(DUSK.sky), t);
    hemi.groundColor.copy(ca.set(PALETTES[palette].board)).lerp(cb.set(DUSK.ground!), t);
    hemi.intensity = DAY.hemi + (DUSK.hemi - DAY.hemi) * t;
    sun.color.copy(ca.set(DAY.sun)).lerp(cb.set(DUSK.sun), t);
    sun.intensity = DAY.sunI + (DUSK.sunI - DAY.sunI) * t;
    sun.shadow.intensity = DAY.shadow + (DUSK.shadow - DAY.shadow) * t;
    fit(bounds, maxH);
  };
  apply();

  return {
    group, sun, hemi,
    setDusk: (t) => { const n = Math.max(0, Math.min(1, t)); if (Math.abs(n - dusk) > 1e-4) { dusk = n; apply(); } },
    setPalette: (p) => { palette = p; apply(); },
    fit: (b, mh) => fit(b, mh ?? maxH),
    setShadowMapSize: (n) => {
      if (sun.shadow.mapSize.x === n) return;
      sun.shadow.mapSize.set(n, n);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.needsUpdate = true;
    },
    dispose: () => { sun.shadow.map?.dispose(); sun.dispose(); hemi.dispose(); },
  };
}
