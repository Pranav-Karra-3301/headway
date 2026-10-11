// Owner: C1 (camera study). Headless table (no WebGL, no world layer — the page adds the world height field):
//   pnpm --filter @headway/web exec tsx src/render/camera/study/cli.ts [--w 1600 --h 1000] [--inspector] [--play]
import { TOWN } from '@headway/sim';
import { DISTRICTS } from '../../districts/index';
import { SCENERY } from '../../scenery';
import { worldLayout } from '../../world/layout';
import { measureView, rankViews } from './measure';
import { placeTable, studyTable } from './report';
import { studySamples } from './samples';
import { composeStudyTown, studyBoxes } from './town';
import { CURRENT_RIG_VIEW, STUDY_VIEWS } from './views';

const argv = (globalThis as unknown as { process?: { argv: string[] } }).process?.argv ?? [];
const arg = (k: string, d: number) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const viewport = { w: arg('w', 1600), h: arg('h', 1000) };
const hud = { inspector: argv.includes('--inspector'), mode: argv.includes('--play') ? ('play' as const) : ('watch' as const) };

const town = composeStudyTown(TOWN, DISTRICTS, SCENERY);
const samples = studySamples(TOWN, { railTunnel: worldLayout(TOWN).railTunnel });
const boxes = studyBoxes(town);
const ranked = rankViews([...STUDY_VIEWS, CURRENT_RIG_VIEW].map((v) => measureView(v, { map: TOWN, samples, boxes, viewport, hud })));
console.log(`town: ${town.sources.districtItems} district items (${town.sources.populatedDistricts.join(', ') || 'none'}), ${town.sources.baseItems} base items, ${boxes.length} occluder boxes, ${samples.length} samples; viewport ${viewport.w}×${viewport.h}\n`);
console.log(studyTable(ranked));
console.log(`\nStill hidden at ${ranked[0]!.view.label}:\n`);
console.log(placeTable(ranked[0]!));
