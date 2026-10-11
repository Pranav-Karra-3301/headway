// Owner: G4. Greater-town traffic (visual only). Usage (composer / G5):
//   await preloadGreaterTraffic();                       // Kenney sedan / SUV / delivery truck (falls back to kit cars)
//   const traffic = createGreaterTrafficLayer(TOWN, { lanes: highwayLanes, palette });   // lanes: G1's, optional
//   scene.add(traffic.object); traffic.update(ctx) each frame (or traffic.tick(dtS) in previews).
export { createGreaterTrafficLayer, preloadGreaterTraffic, GREATER_TRAFFIC_MODELS, type GreaterTrafficLayer, type GreaterTrafficLayerOptions } from './layer';
export { createGreaterTrafficModel, DEFAULT_CARS, MAX_CARS, MIN_GAP, SPEED_SCALE, type GreaterCar, type GreaterTrafficModel, type GreaterTrafficModelOptions, type TrafficEnv, type VehicleSpec } from './model';
export { buildTrafficGraph, signalGreen, APPROACH, type LevelCrossing, type Signal, type TLane, type TrafficGraph, type TrafficGraphOptions } from './graph';
