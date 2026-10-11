import { test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { TOWN, pointAt } from '@headway/sim';
import { worldLayout } from '../../layout';
test('p', () => {
  const L = worldLayout(TOWN);
  const rt = L.railTunnel!;
  const out = { rt, a: pointAt(TOWN.rail.loop, rt.fromDist), b: pointAt(TOWN.rail.loop, rt.toDist), len: TOWN.rail.loop.length, st: TOWN.rail.stations.map(s => [s.id, s.dist]), p0: TOWN.rail.loop.points[0], bounds: TOWN.bounds, extent: L.extent, exits: L.exits };
  writeFileSync('/tmp/e1/p.json', JSON.stringify(out, null, 1));
});
