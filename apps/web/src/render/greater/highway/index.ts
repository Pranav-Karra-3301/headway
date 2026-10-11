// Owner: G1. Greater-town highway: the Mt Nittany Expressway across G0's northern band, its diamond interchange
// with North Gate Circle's north arm (overpass on embankments + pillars, slip roads, two signalised junctions),
// a twin-bore tunnel portal in a hillside at the west edge, and the lanes / world exits for visual traffic.
//
//   import { createGreaterHighwayLayer, preloadGreaterHighway, greaterLanes, laneHeightAt } from '../highway';
//   await preloadGreaterHighway();                       // Kenney road-kit props, junction tiles, pines, rocks
//   scene.add(createGreaterHighwayLayer(TOWN, { palette }).object);   // 2 draw calls
//   const { lanes, ports, byId } = greaterLanes(TOWN);  // G0 lanes + highway lanes, linked; ports for spawning
//   y = laneHeightAt(lane, d)                            // the through lanes climb onto the overpass (lane.y)
//
// Traffic (G4): spawn / despawn ONLY at `ports` of kind 'edge' (G0) and 'highway' (here: 'highway-w' inside the
// west tunnel, 'highway-e' at the east grid edge; `inLanes` / `outLanes` list both lanes of a carriageway). G0's
// band-edge 'highway' port is internal now (greaterLanes drops it). Highway lanes: kind 'highway' (9 u/s) and
// 'ramp' (5 u/s); junction lanes at the two slip-road junctions. Cars follow lane.y on the overpass.
// Preview: /greater-highway-dev.html?view=60&tx=-10&tz=-44 (flags in ./preview.ts).
export { createGreaterHighwayLayer, preloadGreaterHighway, GREATER_HIGHWAY_MODELS, hillHeight, type GreaterHighwayLayer, type GreaterHighwayOptions } from './layer';
export { highwayPlan, laneHeightAt, HW, HIGHWAY_NAME, LINK_NAME, type HighwayPlan, type HighwayLane, type HighwayPort, type SlipRoad, type Prop } from './plan';
export { greaterLanes, type GreaterNetwork } from './network';
export { highwayColors, type HwRole } from './colors';
