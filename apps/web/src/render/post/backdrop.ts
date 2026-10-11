// Owner: T2.1. Backdrop: vertical gradient sky (scene.background) that blends day → dusk, and a soft blurred
// drop shadow under the board slab so the town reads as a toy diorama floating over the page.
import * as THREE from 'three';
import type { Bounds } from '../camera';
import { PALETTES } from '../palettes';
import type { PaletteId } from '../types';

export interface Backdrop {
  readonly sky: THREE.CanvasTexture;
  readonly shadow: THREE.Mesh;
  setPalette(p: PaletteId): void;
  setDusk(t: number): void;
  /** Resize the drop shadow to a board (bounds of the slab top). */
  fit(bounds: Bounds): void;
  /** Current mid background colour (for UI / fade targets). */
  color(target?: THREE.Color): THREE.Color;
  dispose(): void;
}

const DUSK_STOPS = ['#1f2547', '#3b3f6e', '#7a5f86', '#d99a86'];

export function createBackdrop(scene: THREE.Scene, opts: { palette?: PaletteId; dusk?: number; bounds?: Bounds } = {}): Backdrop {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const sky = new THREE.CanvasTexture(canvas);
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.magFilter = THREE.LinearFilter;
  sky.minFilter = THREE.LinearFilter;
  sky.generateMipmaps = false;
  scene.background = sky;

  // Drop shadow: rounded rect blurred into an alpha texture.
  const sc = document.createElement('canvas');
  sc.width = 512;
  sc.height = 384;
  const sctx = sc.getContext('2d')!;
  const sm = 70;
  sctx.fillStyle = '#000';
  sctx.filter = 'blur(26px)';
  sctx.beginPath();
  sctx.roundRect(sm, sm, sc.width - sm * 2, sc.height - sm * 2, 40);
  sctx.fill();
  const shadowTex = new THREE.CanvasTexture(sc);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1b2430, alphaMap: shadowTex, transparent: true, opacity: 0.32, depthWrite: false });
  shadowTex.colorSpace = THREE.NoColorSpace;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  shadow.name = 'boardDropShadow';
  scene.add(shadow);

  let palette: PaletteId = opts.palette ?? 'a';
  let dusk = opts.dusk ?? 0;
  const a = new THREE.Color(), b = new THREE.Color(), out = new THREE.Color();

  const stops = (): string[] => {
    const P = PALETTES[palette];
    const base = new THREE.Color(P.bg);
    const top = base.clone().offsetHSL(0, -0.04, 0.07);
    const bottom = base.clone().offsetHSL(0.01, 0.02, -0.05);
    const day = [top, base.clone().offsetHSL(0, 0, 0.03), base, bottom];
    const duskBase = new THREE.Color(P.duskBg);
    const duskCols = DUSK_STOPS.map((h, i) => new THREE.Color(h).lerp(duskBase, i === 1 ? 0.5 : 0.2));
    return day.map((c, i) => '#' + a.copy(c).lerp(duskCols[i]!, dusk).getHexString());
  };

  const draw = () => {
    const s = stops();
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    s.forEach((c, i) => g.addColorStop(i / (s.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sky.needsUpdate = true;
    shadowMat.opacity = 0.3 + 0.15 * dusk;
  };

  const fit = (bd: Bounds) => {
    const w = bd.maxX - bd.minX, d = bd.maxZ - bd.minZ;
    // The blurred rect covers (1 - 2·sm/size) of the plane; size it so the dark core sits under the slab.
    shadow.scale.set((w + 3) / (1 - (2 * sm) / sc.width), (d + 3) / (1 - (2 * sm) / sc.height), 1);
    shadow.position.set((bd.minX + bd.maxX) / 2 + 0.9, -1.75, (bd.minZ + bd.maxZ) / 2 + 0.6);
  };
  fit(opts.bounds ?? { minX: -20, maxX: 20, minZ: -15, maxZ: 15 });
  draw();

  return {
    sky, shadow, fit,
    setPalette: (p) => { palette = p; draw(); },
    setDusk: (t) => { const n = Math.max(0, Math.min(1, t)); if (Math.abs(n - dusk) > 1e-3 || n === 0 || n === 1) { dusk = n; draw(); } },
    color: (target = out) => target.set(PALETTES[palette].bg).lerp(b.set(PALETTES[palette].duskBg), dusk),
    dispose: () => {
      sky.dispose(); shadowTex.dispose(); shadowMat.dispose(); shadow.geometry.dispose();
      scene.remove(shadow);
      if (scene.background === sky) scene.background = null;
    },
  };
}
