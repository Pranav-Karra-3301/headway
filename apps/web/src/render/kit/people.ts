// Owner: T2.1. People (approved as on the kit sheet): capsule body + sphere head, ≈ 0.8 u tall, feet at y = 0.
// For the dynamic layer bake body and head separately (2 InstancedMeshes); the body is tint()-tagged so
// instanceColor sets the shirt colour (palette role `shirt`).
import * as THREE from 'three';
import { at, capsule, sphere, tint } from './prims';

export const PERSON = { height: 0.8, bodyR: 0.15, bodyLen: 0.24, bodyY: 0.27, headR: 0.12, headY: 0.68 } as const;

export function makePersonBody(shirtIdx = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(tint(at(capsule(PERSON.bodyR, PERSON.bodyLen, 'shirt', shirtIdx, 3, 10), 0, PERSON.bodyY, 0)));
  return g;
}

export function makePersonHead(): THREE.Group {
  const g = new THREE.Group();
  g.add(at(sphere(PERSON.headR, 'skin', 0, 12, 8), 0, PERSON.headY, 0));
  return g;
}

export function makePerson(shirtIdx = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = 'person';
  g.add(...makePersonBody(shirtIdx).children, ...makePersonHead().children);
  return g;
}
