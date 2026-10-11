// Owner: G1. Dev-only gallery of the Kenney city-kit-roads pieces the highway uses (?gallery=1 on greater-highway-dev).
import * as THREE from 'three';
import { Stage } from '../../post/stage';
import { kenneyModel, kenneyTemplate, preloadKenney, type KenneyId } from '../../assets/kenney/index';

export const GALLERY = [
  'road-straight-barrier', 'road-side-exit-barrier', 'road-side-entry-barrier', 'road-side-exit', 'road-side',
  'road-slant-barrier', 'road-slant-high-barrier', 'road-slant', 'road-slant-high', 'road-slant-flat',
  'road-slant-flat-high', 'road-bridge', 'road-slant-curve-barrier', 'road-split-barrier', 'road-straight-barrier-end',
  'tile-high', 'tile-slant', 'tile-slantHigh', 'bridge-pillar', 'bridge-pillar-wide',
  'sign-highway', 'sign-highway-wide', 'sign-highway-detailed', 'light-curved-double', 'light-square-double',
  'road-end-barrier', 'road-straight-barrier-half', 'road-bend-barrier', 'road-curve-barrier', 'road-straight',
];

export async function gallery(canvas: HTMLCanvasElement, msg: HTMLElement): Promise<void> {
  const q = new URLSearchParams(location.search);
  const names = q.get('only') ? q.get('only')!.split(',') : GALLERY;
  const ids = names.map((n) => (n.includes('/') ? n : `city-kit-roads/${n}`) as KenneyId);
  await preloadKenney(ids);
  const stage = new Stage(canvas, {
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, palette: 'a', light: 'day', post: false, preserveDrawingBuffer: true, autoQuality: false,
    camera: { view: Number(q.get('view') ?? 46), target: { x: 0, z: 0 }, interactive: false },
  });
  const cols = Number(q.get('cols') ?? 5), step = 7.5;
  const lines: string[] = [];
  ids.forEach((id, i) => {
    const t = kenneyTemplate(id);
    if (!t) { lines.push(`${i}:${id}:missing`); return; }
    const o = kenneyModel(id);
    const s = 4 / 2.6; // KENNEY_SCALE 2.6 → tile 4 u
    o.scale.setScalar(s);
    o.rotation.y = Number(q.get('rot') ?? 0);
    const c = i % cols, r = Math.floor(i / cols);
    o.position.set((c - (cols - 1) / 2) * step, 0, (r - (Math.ceil(ids.length / cols) - 1) / 2) * step);
    stage.scene.add(o);
    const roles = t.parts.map((p) => `${p.info.role}${p.info.shade ? '@' + p.info.shade.toFixed(2) : ''}:${p.tris}`).join(',');
    if (q.get('axes') === '1') {
      const ax = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: '#ff0000' }));
      ax.position.set(o.position.x + 2.6, 0.1, o.position.z);
      const az = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.2), new THREE.MeshBasicMaterial({ color: '#0000ff' }));
      az.position.set(o.position.x, 0.1, o.position.z + 2.6);
      stage.scene.add(ax, az);
    }
    lines.push(`${i}:${id.split('/')[1]} [${roles}] ${(t.size.x * s).toFixed(2)}×${(t.size.y * s).toFixed(2)}×${(t.size.z * s).toFixed(2)} box y ${(t.box.min.y * s).toFixed(2)}..${(t.box.max.y * s).toFixed(2)} x ${(t.box.min.x * s).toFixed(2)}..${(t.box.max.x * s).toFixed(2)} z ${(t.box.min.z * s).toFixed(2)}..${(t.box.max.z * s).toFixed(2)}`);
  });
  msg.textContent = lines.join(' | ');
  (window as unknown as { __gallery: string[] }).__gallery = lines;
  stage.render(0.016);
  stage.renderer.setAnimationLoop(() => stage.render(0.016));
}
