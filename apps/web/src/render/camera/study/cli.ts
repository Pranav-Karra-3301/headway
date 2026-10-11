// Owner: C1 (camera study). Headless version of /camera-study.html's table (no WebGL needed):
//   pnpm --filter @headway/web exec tsx src/render/camera/study/cli.ts [--w 1600 --h 1000] [--inspector] [--play] [--no-world] [--detail eiso-a45] [--sweep]
// (--no-world skips building the world layer for the terrain/water height field)
import { TOWN } from '@headway/sim';
import { DISTRICTS } from '../../districts/index';
import { SCENERY } from '../../scenery';
import { worldLayout } from '../../world/layout';
import { createWorldLayer } from '../../world/index';
import { buildHeightField, heightFieldHit } from './heightfield';
import { measureView, rankViews } from './measure';
import { occluderTable, placeTable, studyTable } from './report';
import { studySamples } from './samples';
import { composeStudyTown, studyBoxes } from './town';
import { sweepTable, sweepViews } from './sweep';
import { CURRENT_RIG_VIEW, STUDY_VIEWS } from './views';

const argv = (globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? [];
const arg = (k: string, d: number) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const viewport = { w: arg('w', 1600), h: arg('h', 1000) };
const hud = { inspector: argv.includes('--inspector'), mode: argv.includes('--play') ? ('play' as const) : ('watch' as const) };

const town = composeStudyTown(TOWN, DISTRICTS, SCENERY);
const layout = worldLayout(TOWN);
const samples = studySamples(TOWN, { railTunnel: layout.railTunnel });
const boxes = studyBoxes(town);
const hf = argv.includes('--no-world') ? null : buildHeightField(createWorldLayer(TOWN).object, layout.extent);
const extra = hf ? { extraHit: (p: Parameters<typeof heightFieldHit>[1], d: Parameters<typeof heightFieldHit>[2]) => { const h = heightFieldHit(hf, p, d); return h ? `world:${h}` : null; } } : {};
const ranked = rankViews([...STUDY_VIEWS, CURRENT_RIG_VIEW].map((v) => measureView(v, { map: TOWN, samples, boxes, viewport, hud, ...extra })));
console.log(`town: ${town.sources.districtItems} district items (${town.sources.populatedDistricts.join(', ') || 'none'}), ${town.sources.baseItems} base items, ${boxes.length} occluder boxes, ${hf ? hf.names.length + ' world meshes in the height field' : 'no world'}, ${samples.length} samples; viewport ${viewport.w}×${viewport.h}\n`);
console.log(studyTable(ranked));
const di = argv.indexOf('--detail');
const detail = (di >= 0 ? ranked.find((r) => r.view.id === argv[di + 1]) : null) ?? ranked[0]!;
console.log(`\nStill hidden at ${detail.view.label}:\n`);
console.log(placeTable(detail));
console.log(`\nTop occluders at ${detail.view.label}:\n`);
console.log(occluderTable(detail));

// --sweep: a finer grid around the candidates (how sensitive each metric is to a few degrees of camera)
if (argv.includes('--sweep')) {
  console.log('\nSweep — hidden % stop-queue/stop/route/rail · px/u:\n');
  console.log(sweepTable(sweepViews({ map: TOWN, samples, boxes, viewport, hud, ...extra })));
}
