import { it } from 'vitest';
import { DISTRICTS } from '../districts';
const inPoly = (p: any, poly: any[]) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) ins = !ins; } return ins; };
const area = (poly: any[]) => { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].z - poly[i].z); return Math.abs(s) / 2; };
it('dbg', () => {
  const all = DISTRICTS.flatMap(d => d.items);
  for (const d of DISTRICTS) for (const a of d.areas) {
    const c = a.polygon.reduce((s, p) => ({ x: s.x + p.x / a.polygon.length, z: s.z + p.z / a.polygon.length }), { x: 0, z: 0 });
    const n = all.filter(i => inPoly(i, a.polygon)).length;
    const A = area(a.polygon);
    if (A > 6 && n / A < 0.08) console.log(d.id, a.kind, 'c', c.x.toFixed(1), c.z.toFixed(1), 'area', A.toFixed(0), 'items', n);
  }
});
