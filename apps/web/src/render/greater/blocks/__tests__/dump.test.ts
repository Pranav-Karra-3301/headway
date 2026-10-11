import { it } from 'vitest';
import { TOWN } from '@headway/sim';
import { greaterGrid } from '../../grid';
import { planGreaterBlocks } from '../plan';
it.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.G2_DUMP)('dump', () => {
  const g = greaterGrid(TOWN), p = planGreaterBlocks(TOWN);
  for (const b of g.blocks) {
    const its = p.items.filter((i) => i.block === b.id);
    const by = new Map<string, number>();
    for (const i of its) by.set(i.kind.split('.').slice(0, 2).join('.'), (by.get(i.kind.split('.').slice(0, 2).join('.')) ?? 0) + 1);
    console.log(b.id, `${b.cells.w}x${b.cells.h}`, b.zone, b.density, p.styles[b.id], [...by].map(([k, n]) => `${k}:${n}`).join(' '));
  }
  console.log('street', p.items.filter((i) => i.role === 'street').length, 'lines', p.lines.map((l) => l.length).join(','), 'items', p.items.length, 'lots', p.lots.length);
});
