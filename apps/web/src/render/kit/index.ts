// Owner: T2.1. The model kit: role-tagged builders + bake. Typical use:
//   const baked = bakeGeometry(makeBuilding('tall', { wall: 1, roof: 2, seed: 4 }), palette);
//   const mesh = new THREE.Mesh(baked.geometry, new KitMaterial());           // or InstancedMesh
//   recolorBaked(baked, nextPalette); setBakedDetail(baked, detail === 'toy');
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
