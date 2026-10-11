import { it } from 'vitest';
import { TOWN } from '@headway/sim';
import { planWaterfront } from '../plan';
it('probe', () => {
  const p = planWaterfront(TOWN);
  const out: string[] = [];
  const f = (v: { x: number; z: number }) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`;
  for (const r of p.runs) out.push(`run ${r.id} ${r.kind} L=${r.length.toFixed(1)} ${f(r.pts[0]!)} → ${f(r.pts[r.pts.length - 1]!)}`);
  for (const d of p.decks) out.push(`deck ${d.id} ${d.kind} c=${f(d.c)} dir=${f(d.dir)} len=${d.len.toFixed(1)} w=${d.w}`);
  for (const v of p.pavilions) out.push(`pav ${v.id} ${f(v.c)}`);
  const counts = new Map<string, number>();
  for (const i of p.items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  out.push('items ' + [...counts].map(([k, n]) => `${k}:${n}`).join(' '));
  out.push('harbour ' + JSON.stringify(p.harbour));
  console.log(out.join('\n'));
});
