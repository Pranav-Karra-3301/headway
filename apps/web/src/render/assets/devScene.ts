// Shared bits for the asset/district preview pages: renderer, iso camera, lights.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function devScene(viewSize: number, center = new THREE.Vector3()) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#DDEFE5');
  const a = innerWidth / innerHeight;
  const camera = new THREE.OrthographicCamera((-viewSize * a) / 2, (viewSize * a) / 2, viewSize / 2, -viewSize / 2, 0.1, 800);
  camera.position.copy(center).add(new THREE.Vector3(80, 70, 80));
  camera.lookAt(center);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableRotate = false; controls.screenSpacePanning = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4b0, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.position.copy(center).add(new THREE.Vector3(-14, 34, 22));
  sun.target.position.copy(center);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const loop = (onFrame?: () => void) => renderer.setAnimationLoop(() => { controls.update(); onFrame?.(); renderer.render(scene, camera); });
  return { renderer, scene, camera, controls, loop };
}
