// Owner: T2.1. The model kit. Every builder returns a THREE.Group of role-tagged parts (front = +z for buildings,
// +x = forward for vehicles, y = 0 ground). Bake to ONE geometry and draw with KitMaterial (../materials):
//   const b = bakeGeometry(makeBuilding('tall', { wall: 1, roof: 2, seed: 4 }), palette);  // or a whole group
//   scene.add(new THREE.Mesh(b.geometry, new KitMaterial()));                              // or InstancedMesh
//   recolorBaked(b, nextPalette); setBakedDetail(b, detail === 'toy');
// Instanced: tint()-tagged parts (car bodies, shirts, crowns) take InstancedMesh.instanceColor.
//
// API (signatures):
//   bakeGeometry(root, palette?, { resolve? }) → Baked { geometry, ranges, baseIndexCount }   (bake.ts)
//   recolorBaked(b, palette) · setBakedDetail(b, toy) · mergeBaked(list) → Baked · bakedOf(geometry)
//   makeBus(routeIdx = 0) · makeTrain() · makeTrainCar(front) · BUS · TRAIN (deckY)            (vehicles.ts)
//   makeCar(variant: number | CarVariant = 0, colorIdx = 0) · CAR_VARIANTS · CAR_SIZE           (cars.ts)
//   makePerson(shirt = 0) · makePersonBody(shirt = 0) · makePersonHead() · PERSON               (people.ts)
//   makeTree(variant: number | TreeVariant = 0, leaf = 0) · TREE_VARIANTS · TREE_SIZE
//   createForest(trees: TreePlacement[], { palette?, seed?, sway? }) → Forest                  (trees.ts)
//   makeBuilding(type: BuildingType, { wall?, roof?, seed? }) · BUILDING_TYPES · buildingSize(type)
//   windowUnit · doorUnit · onFace (facade helpers)                                              (buildings.ts)
//   makeClockTower({ hands? }) · CLOCK_TOWER.faces · clockFace(r, hands?) · clockHand(len, angle)
//   makeStadium() · STADIUM.masts                                                                (landmarks.ts)
//   makeStop(routes: number[]) · makeStation({ track?, hands? }) · STATION_CLOCK · makeTrack(len) · TRACK
//   makeRoad(len) · makeStreetLamp() · LAMP                                                      (transit.ts)
//   makeBoard(w, d) · makeLawn(w, d)                                                             (ground.ts)
//   prims: rbox/box/cyl/sphere/dome/cone/capsule/prism/ellipseRing/shaped(…, role, idx) · part · partOf
//          at · rotX/Y/Z · detail · tint · noShadow · group · prng · applyDetail                  (prims.ts)
export * from './prims';
export * from './bake';
export * from './vehicles';
export * from './cars';
export * from './people';
export * from './trees';
export * from './buildings';
export * from './landmarks';
export * from './transit';
export * from './ground';
