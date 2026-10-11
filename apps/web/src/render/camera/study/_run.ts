import { TOWN } from '@headway/sim';
import { SCENERY } from '../../scenery';
import { DISTRICTS } from '../../districts/index';
import { worldLayout } from '../../world/layout';
import { composeStudyTown, studyBoxes } from './town';
import { studySamples } from './samples';
import { measureView, rankViews } from './measure';
import { STUDY_VIEWS, CURRENT_RIG_VIEW } from './views';
import { studyTable, placeTable } from './report';
const town = composeStudyTown(TOWN, DISTRICTS, SCENERY);
const layout = worldLayout(TOWN);
const samples = studySamples(TOWN, { railTunnel: layout.railTunnel });
const boxes = studyBoxes(town);
console.log('sources', town.sources, 'boxes', boxes.length, 'samples', samples.length, 'tunnel', layout.railTunnel);
const rs = [...STUDY_VIEWS, CURRENT_RIG_VIEW].map((v) => measureView(v, { map: TOWN, samples, boxes, viewport: { w: 1600, h: 1000 } }));
console.log(studyTable(rs));
console.log(studyTable(rankViews(rs)));
for (const r of rs.filter((r) => r.view.az === 45)) { console.log(r.view.label); console.log(placeTable(r)); console.log(JSON.stringify(r.fit.rect), r.fit.scale.toFixed(2), JSON.stringify(r.screen)); }
