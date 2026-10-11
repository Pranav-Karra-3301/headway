// Asset preview: /assets-dev.html?family=downtown (default: all). Every catalog kind in a grid; placeholders are pink.
// ?family=kenney → the Kenney sampler (K0, ./kenney/dev.ts): our bus + people next to Kenney models, then every kn.* kind.
import * as THREE from 'three';
import { createBasicKit } from './basicKit';
import { CATALOG } from './catalog';
import { createRegistry } from './index';
import { devScene } from './devScene';
import { kenneyIdsFor, preloadKenney } from './kenney';

const family = new URLSearchParams(location.search).get('family');
if (family === 'kenney') await import('./kenney/dev');
else await grid();

async function grid(): Promise<void> {
  const entries = CATALOG.filter((c) => !family || c.family === family);
  const registry = createRegistry();
  await preloadKenney(kenneyIdsFor(entries.map((e) => e.kind))); // Kenney-backed builders need their models first
  const kit = createBasicKit(registry.roles);
  const cols = Math.ceil(Math.sqrt(entries.length));
  const cell = Math.max(8, ...entries.map((e) => Math.max(e.w, e.d) + 3));
  const span = cols * cell;
  const { scene, camera, loop } = devScene(span * 0.95);
  const board = new THREE.Mesh(new THREE.BoxGeometry(span + 4, 0.6, span + 4), new THREE.MeshStandardMaterial({ color: '#A8D8B9', roughness: 0.9 }));
  board.position.y = -0.3; board.receiveShadow = true; scene.add(board);
  const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
  entries.forEach((e, i) => {
    const x = (i % cols) * cell - span / 2 + cell / 2, z = Math.floor(i / cols) * cell - span / 2 + cell / 2;
    scene.add(registry.build(kit, { kind: e.kind, x, z }));
    const el = document.createElement('div'); el.className = 'l'; el.textContent = e.kind + (registry.get(e.kind) ? '' : ' (todo)');
    document.getElementById('labels')!.append(el); labels.push({ el, p: new THREE.Vector3(x, 0, z + Math.max(e.d, 1) / 2 + 0.8) });
  });
  const v = new THREE.Vector3();
  loop(() => { for (const { el, p } of labels) { v.copy(p).project(camera); el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v.y) / 2) * innerHeight}px`; } });
  (window as unknown as { __assetsReady: boolean }).__assetsReady = true;
}
