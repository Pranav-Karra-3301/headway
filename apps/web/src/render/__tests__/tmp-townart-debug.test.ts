import { it } from 'vitest';
import { TOWN } from '@headway/sim';
it('dbg', () => {
  for (const r of TOWN.routes as any[]) console.log(r.id, JSON.stringify(r.stops ?? r.stopIds), JSON.stringify((r.path?.points ?? []).map((p: any) => [p.x, p.z])).slice(0, 600));
});
