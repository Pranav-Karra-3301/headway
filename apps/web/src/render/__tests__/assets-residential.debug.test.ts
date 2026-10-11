import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import { register } from '../assets/families/residential';
import { AssetRegistry } from '../assets/registry';
it('debug', () => {
  const r = new AssetRegistry(); register(r);
  const k = createBasicKit(r.roles, 0, 3);
  const o = r.get('res.parking')!.build(k, { cars: 3 }); o.updateMatrixWorld(true);
  const rows: string[] = [];
  o.traverse((c) => { if (c.name === 'car') { const b = new THREE.Box3().setFromObject(c, true); rows.push(`rotY ${c.rotation.y.toFixed(2)} x[${b.min.x.toFixed(2)},${b.max.x.toFixed(2)}] z[${b.min.z.toFixed(2)},${b.max.z.toFixed(2)}]`); } });
  writeFileSync('/tmp/hw-a3/debug.txt', rows.join('\n'));
});
