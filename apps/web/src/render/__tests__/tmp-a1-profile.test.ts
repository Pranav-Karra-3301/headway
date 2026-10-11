import * as THREE from 'three';
import { it } from 'vitest';
import { createBasicKit } from '../assets/basicKit';
import * as downtown from '../assets/families/downtown';
import { AssetRegistry } from '../assets/registry';

it('profile', () => {
  const r = new AssetRegistry(); downtown.register(r);
  for (const kind of ['dt.shopRow', 'dt.midrise']) {
    for (const params of [{}, { variant: 1 }, { variant: 2 }, { variant: 5 }]) {
      const o = r.get(kind)!.build(createBasicKit(downtown.ROLES), params);
      const byRole: Record<string, number> = {};
      let total = 0;
      o.traverse((c) => {
        const m = c as THREE.Mesh; if (!m.isMesh) return;
        const g = m.geometry; const t = (g.index ? g.index.count : g.attributes.position!.count) / 3;
        const key = (m.userData.part?.role ?? '?') + ':' + g.type.replace('Geometry', '');
        byRole[key] = (byRole[key] ?? 0) + t; total += t;
      });
      console.log(kind, JSON.stringify(params), total, Object.entries(byRole).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(' '));
    }
  }
});
