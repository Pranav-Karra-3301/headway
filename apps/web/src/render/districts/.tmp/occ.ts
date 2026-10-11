// temp: per-instance occluder counts at the default camera (35.26° az 45)
import { TOWN } from '@headway/sim';
import { DISTRICTS } from '../index';
import { SCENERY } from '../../scenery';
import { worldLayout } from '../../world/layout';
import { measureView } from '../../camera/study/measure';
import { studySamples } from '../../camera/study/samples';
import { composeStudyTown, studyBoxes } from '../../camera/study/town';
const town = composeStudyTown(TOWN, DISTRICTS, SCENERY);
const samples = studySamples(TOWN, { railTunnel: worldLayout(TOWN).railTunnel });
const boxes = studyBoxes(town);
const r = measureView({ id: 'eiso-a45', elev: Math.atan(1 / Math.SQRT2) * 180 / Math.PI, az: 45 }, { map: TOWN, samples, boxes, viewport: { w: 1600, h: 1000 }, hud: { inspector: false, mode: 'watch' } });
const cnt = new Map<string, Record<string, number>>();
for (const h of r.hiddenPoints) {
  const k = h.box ? `${h.box.kind}@${h.box.cx.toFixed(1)},${h.box.cz.toFixed(1)}` : h.by;
  const o = cnt.get(k) ?? {}; o[h.cls] = (o[h.cls] ?? 0) + 1; cnt.set(k, o);
}
const rows = [...cnt.entries()].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
for (const [k, o] of rows.slice(0, 30)) console.log(k.padEnd(34), JSON.stringify(o));
console.log(Object.entries(r.hidden).map(([k, s]) => `${k} ${(s.frac * 100).toFixed(1)}% (${s.hidden}/${s.n})`).join(' · '));
