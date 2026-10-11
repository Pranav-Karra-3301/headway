// The shared asset catalog: names, footprints (x by z, u) and heights. Districts place these kinds;
// families implement them. A kind not yet implemented renders as a placeholder box of this size.
import type { FamilyId } from './types';

export interface CatalogEntry { kind: string; family: FamilyId; w: number; d: number; h: number; note: string }
const e = (kind: string, family: FamilyId, w: number, d: number, h: number, note: string): CatalogEntry => ({ kind, family, w, d, h, note });

export const CATALOG: CatalogEntry[] = [
  // downtown (A1) — red-brick college-town main street
  e('dt.shop', 'downtown', 3, 3, 2.6, '1–2 storey shop, awning, display window'),
  e('dt.shopRow', 'downtown', 7, 3, 3.0, 'row of 3 storefronts, varied heights/colours/awnings'),
  e('dt.corner', 'downtown', 4, 4, 3.6, '3-storey corner building, chamfered corner entrance'),
  e('dt.cafe', 'downtown', 3, 3, 2.4, 'cafe, striped awning, 2 outdoor tables'),
  e('dt.midrise', 'downtown', 4, 4, 4.8, '4-storey mixed use, shop ground floor'),
  e('dt.theater', 'downtown', 5, 4, 3.6, 'theater with marquee + vertical sign (shapes, no text)'),
  e('dt.bank', 'downtown', 4, 4, 3.4, 'stone bank with columns'),
  e('dt.garage', 'downtown', 6, 5, 3.4, '3-deck parking garage with tiny parked cars'),
  // campus (A2) — Georgian brick + limestone, white trim
  e('cp.hall', 'campus', 7, 3.5, 3.8, 'classroom hall, pitched roof, portico (variants via params)'),
  e('cp.library', 'campus', 7, 5, 4.6, 'library: columns + small dome'),
  e('cp.chapel', 'campus', 3, 5, 5.5, 'chapel with spire'),
  e('cp.science', 'campus', 6, 4, 3.6, 'modern science building, glass band'),
  e('cp.dorm', 'campus', 6, 3.5, 4.6, '4-storey brick dorm, flat roof'),
  e('cp.union', 'campus', 6, 5, 3.4, 'student union, wide steps, flag'),
  e('cp.gate', 'campus', 4, 1, 3.0, 'campus arch gate with two piers'),
  // residential (A3)
  e('res.tower', 'residential', 3.5, 3.5, 7.0, '5–7 storey apartment tower with balconies'),
  e('res.garden', 'residential', 6, 3.5, 3.6, '3-storey garden apartments, balconies'),
  e('res.townhouses', 'residential', 6, 2.5, 2.8, 'row of 3 townhouses, varied roofs'),
  e('res.house', 'residential', 2.5, 2.5, 2.4, 'gabled house, chimney, porch'),
  e('res.playground', 'residential', 4, 3, 1.2, 'playground: slide, swings, sandbox'),
  e('res.parking', 'residential', 6, 4, 0.6, 'surface parking lot with lines + a few parked cars'),
  // landmarks + transport (A4)
  e('lm.stadium', 'landmarks', 11, 8.5, 3.0, 'stadium: tiered stands, scoreboard, 4 light towers, gates, banners'),
  e('lm.clockTower', 'landmarks', 2.3, 2.3, 8.3, 'campus clock tower (hands animated by FX)'),
  e('lm.stationCentral', 'landmarks', 9, 4.5, 3.4, 'central station building + canopy, faces the platform'),
  e('lm.stationHalt', 'landmarks', 6, 2.6, 2.6, 'small halt shelter for University/Stadium stations'),
  e('lm.waterTower', 'landmarks', 2.5, 2.5, 6.5, 'water tower with town colours'),
  e('lm.levelCrossing', 'landmarks', 3, 3, 1.6, 'level crossing gates + warning lights'),
  e('lm.railSignal', 'landmarks', 0.5, 0.5, 1.8, 'rail signal post'),
  // vegetation (A5) — instanced, crowns sway
  e('veg.oak', 'vegetation', 1.8, 1.8, 2.6, 'round broadleaf'),
  e('veg.maple', 'vegetation', 1.8, 1.8, 2.5, 'maple, autumn tint in palette c'),
  e('veg.pine', 'vegetation', 1.4, 1.4, 3.0, 'layered cone pine'),
  e('veg.birch', 'vegetation', 1.2, 1.2, 2.6, 'slim birch, white trunk'),
  e('veg.poplar', 'vegetation', 1.0, 1.0, 3.2, 'columnar poplar'),
  e('veg.cherry', 'vegetation', 1.6, 1.6, 2.2, 'blossom tree (pink in palette a)'),
  e('veg.bush', 'vegetation', 1.0, 1.0, 0.7, 'low rounded bush cluster'),
  e('veg.hedge', 'vegetation', 3, 0.8, 0.8, 'clipped hedge, params.length scales x'),
  e('veg.flowerbed', 'vegetation', 2, 1, 0.4, 'bed with tiny flowers'),
  e('veg.planter', 'vegetation', 1, 1, 0.9, 'street planter with shrub'),
  // street furniture (A6) — instanced
  e('st.lamp', 'street', 0.4, 0.4, 2.2, 'street lamp (glows at dusk via FX)'),
  e('st.bench', 'street', 1.2, 0.5, 0.5, 'park bench'),
  e('st.bin', 'street', 0.4, 0.4, 0.6, 'litter bin'),
  e('st.bikeRack', 'street', 1.5, 0.5, 0.5, 'bike rack with 2 bikes'),
  e('st.hydrant', 'street', 0.3, 0.3, 0.45, 'fire hydrant'),
  e('st.mailbox', 'street', 0.4, 0.4, 0.8, 'mailbox'),
  e('st.trafficLight', 'street', 0.4, 0.4, 2.4, 'traffic light'),
  e('st.fence', 'street', 3, 0.2, 0.6, 'picket/rail fence, params.length scales x'),
  e('st.tableUmbrella', 'street', 1.2, 1.2, 1.4, 'outdoor table with umbrella'),
  e('st.flag', 'street', 0.3, 0.3, 2.8, 'flagpole with flag (flag sways)'),
  e('st.kiosk', 'street', 1.2, 1.2, 1.6, 'news/coffee kiosk'),
  e('st.fountain', 'street', 2.5, 2.5, 1.2, 'plaza fountain'),
];

export const CATALOG_BY_KIND = new Map(CATALOG.map((c) => [c.kind, c] as const));
