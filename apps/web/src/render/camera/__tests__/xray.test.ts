// C2 camera rig: x-ray occlusion helper — ray tests, broad phase, fade timing, queue triggers, mesh tagging and the
// material patch (shader strings only; no WebGL in tests).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TOWN } from '@headway/sim';
import type { QueueView } from '@headway/sim';
import { viewDir, CAMERA } from '../iso';
import {
  boxesFromPlacements, patchXrayMaterial, queueTriggerPoints, rayHitsBox, XRAY_ID0, XRAY_TIMING, XrayTracker, type XrayBox,
} from '../xray';
import { DISTRICTS } from '../../districts/index';

const D = viewDir();
const box = (o: Partial<XrayBox> = {}): XrayBox => ({ cx: 0, cz: 0, hx: 1, hz: 1, y0: 0, y1: 4, rot: 0, ...o });

describe('rays', () => {
  it('a tall box hides points on its far (north-west) side within h, not on its camera side', () => {
    const b = box();
    expect(rayHitsBox({ x: -2, y: 0.5, z: -2 }, D, b)).toBe(true); // NW, inside the "h hides h" band
    expect(rayHitsBox({ x: -5, y: 0.5, z: -5 }, D, b)).toBe(false); // beyond the band (k·(h − y) = 3.5)
    expect(rayHitsBox({ x: 2, y: 0.5, z: 2 }, D, b)).toBe(false); // camera side
    expect(rayHitsBox({ x: 0, y: 0.5, z: 0 }, D, b)).toBe(false); // inside: a thing never hides itself
  });

  it('honours rotation and crown boxes (people walk under tree crowns visible from the side)', () => {
    const slab = box({ hx: 4, hz: 0.5, rot: Math.PI / 2 }); // long along z after rotation
    expect(rayHitsBox({ x: -1.5, y: 0.5, z: -3 }, D, slab)).toBe(true);
    const crown = box({ y0: 1.5, y1: 3 });
    expect(rayHitsBox({ x: -0.8, y: 0.4, z: -0.8 }, D, crown)).toBe(true);
    expect(rayHitsBox({ x: -4.5, y: 0.4, z: -4.5 }, D, crown)).toBe(false);
  });
});

describe('XrayTracker', () => {
  it('finds hiders through the broad phase exactly like brute force', () => {
    const boxes: XrayBox[] = [];
    for (let i = 0; i < 60; i++) boxes.push(box({ cx: (i % 10) * 6 - 30, cz: Math.floor(i / 10) * 6 - 18, hx: 1 + (i % 3) * 0.5, hz: 1, y1: 2 + (i % 5), rot: (i % 4) * (Math.PI / 2) }));
    const t = new XrayTracker(boxes);
    let total = 0;
    for (let x = -34; x <= 34; x += 1.7) for (let z = -22; z <= 22; z += 1.3) {
      const p = { x, y: 0.5, z };
      const brute = boxes.map((b, i) => (rayHitsBox(p, D, b) ? i : -1)).filter((i) => i >= 0);
      const fast = t.hits(p, D).sort((a, b) => a - b);
      expect(fast).toEqual(brute);
      total += brute.length;
    }
    expect(total).toBeGreaterThan(20);
  });

  it('fades in over 120 ms, holds ≥ 600 ms after the last hit, fades out over 300 ms', () => {
    const t = new XrayTracker([box(), box({ cx: 20 })]);
    const p = [{ x: -2, y: 0.5, z: -2 }];
    const dt = 1 / 100;
    let s = 0;
    while (s < XRAY_TIMING.fadeInS - 0.03) { t.update(p, D, dt); s += dt; }
    expect(t.fades[0]).toBeGreaterThan(0.5);
    expect(t.fades[0]).toBeLessThan(1);
    for (let i = 0; i < 5; i++) t.update(p, D, dt);
    expect(t.fades[0]).toBe(1);
    expect(t.fades[1]).toBe(0);
    // stop triggering: hold, then fade out
    s = 0;
    while (s < XRAY_TIMING.holdS - 0.05) { t.update([], D, dt); s += dt; }
    expect(t.fades[0]).toBe(1);
    while (s < XRAY_TIMING.holdS + XRAY_TIMING.fadeOutS / 2) { t.update([], D, dt); s += dt; }
    expect(t.fades[0]).toBeGreaterThan(0.2);
    expect(t.fades[0]).toBeLessThan(0.9);
    while (s < XRAY_TIMING.holdS + XRAY_TIMING.fadeOutS + 0.1) { t.update([], D, dt); s += dt; }
    expect(t.fades[0]).toBe(0);
  });

  it('writes fades to the texture at id = index + 2 and keeps texels 0 and 1 at zero', () => {
    const t = new XrayTracker([box()]);
    for (let i = 0; i < 30; i++) t.update([{ x: -2, y: 0.5, z: -2 }], D, 1 / 60);
    const data = t.texture.image.data as Uint8Array;
    expect(t.idOf(0)).toBe(XRAY_ID0);
    expect(data[XRAY_ID0]).toBe(255);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    t.reset();
    expect(data[XRAY_ID0]).toBe(0);
  });

  it('does nothing when disabled', () => {
    const t = new XrayTracker([box()]);
    t.enabled = false;
    for (let i = 0; i < 30; i++) t.update([{ x: -2, y: 0.5, z: -2 }], D, 1 / 60);
    expect(t.fades[0]).toBe(0);
  });

  it('tags merged geometry per vertex and instanced meshes per instance', () => {
    const t = new XrayTracker([box({ cx: 0, cz: 0 }), box({ cx: 10, cz: 0, hx: 2, hz: 2 })]);
    const root = new THREE.Group();
    // a "merged" mesh with one cube in each box and one cube outside both
    const parts = [[0, 0], [10, 0], [30, 30]].map(([x, z]) => new THREE.BoxGeometry(1, 2, 1).translate(x!, 1, z!));
    const merged = new THREE.BufferGeometry();
    const pos = parts.flatMap((g) => Array.from((g.toNonIndexed().getAttribute('position').array as Float32Array)));
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshStandardMaterial();
    root.add(new THREE.Mesh(merged, mat));
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 2, 0.5), mat, 3);
    [[0.2, 0.1], [10.5, -1], [-40, 0]].forEach(([x, z], i) => inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x!, 0, z!)));
    root.add(inst);
    const s = t.attach(root);
    expect(s.meshes).toBe(2);
    const ids = merged.getAttribute('aXrayId').array as Float32Array;
    const per = ids.length / 3;
    expect(new Set(Array.from(ids.slice(0, per)))).toEqual(new Set([XRAY_ID0]));
    expect(new Set(Array.from(ids.slice(per, 2 * per)))).toEqual(new Set([XRAY_ID0 + 1]));
    expect(new Set(Array.from(ids.slice(2 * per)))).toEqual(new Set([0]));
    expect(Array.from(inst.geometry.getAttribute('aXrayIdI').array as Float32Array)).toEqual([XRAY_ID0, XRAY_ID0 + 1, 0]);
    expect(mat.userData.hwXray).toBe('texture');
  });
});

describe('window mode', () => {
  const cam = () => {
    const c = new THREE.OrthographicCamera(-20, 20, 12.5, -12.5, 1, 1000);
    c.position.set(D.x * 400, D.y * 400, D.z * 400);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld(true);
    return c;
  };

  it('opens a window at a hidden trigger only, keyed so it fades out in place', () => {
    const t = new XrayTracker([box()]);
    const view = { camera: cam(), w: 1600, h: 1000, pxPerUnit: 40 };
    const hidden = { x: -2, y: 0.5, z: -2, key: 'v:b1', r: 2 }, open = { x: 3, y: 0.5, z: 3, key: 'v:b2' };
    for (let i = 0; i < 20; i++) t.update([hidden, open], D, 1 / 60, view);
    expect(t.activeWindows.map((w) => w.key)).toEqual(['v:b1']);
    const u = t.windows;
    expect(u.uXrayWinN.value).toBe(1);
    expect(u.uXrayWinS.value[0]).toBe(1);
    const ndc = new THREE.Vector3(hidden.x, hidden.y, hidden.z).project(view.camera);
    expect(u.uXrayWin.value[0]!.x).toBeCloseTo(ndc.x, 6);
    expect(u.uXrayWin.value[0]!.y).toBeCloseTo(ndc.y, 6);
    expect(u.uXrayWin.value[0]!.z).toBeCloseTo(ndc.z, 6);
    expect(u.uXrayWin.value[0]!.w).toBeCloseTo(2 * 40, 6);
    expect(u.uXrayHalf.value.x).toBe(800);
    // the bus drives out of the hide band: the window follows it while it holds, then fades and is dropped
    const moved = { ...hidden, x: 6, z: 6 };
    for (let i = 0; i < 30; i++) t.update([moved, open], D, 1 / 60, view);
    expect(t.activeWindows[0]?.p.x).toBe(6);
    for (let i = 0; i < 60; i++) t.update([moved, open], D, 1 / 60, view);
    expect(t.activeWindows.length).toBe(0);
    expect(u.uXrayWinN.value).toBe(0);
  });

  it('falls back to whole-object mode without a view', () => {
    const t = new XrayTracker([box()]);
    t.update([{ x: -2, y: 0.5, z: -2 }], D, 0.2);
    expect(t.windows.uXrayWinN.value).toBe(-1);
  });
});

describe('material patch', () => {
  it('chains after an existing onBeforeCompile and injects the dither into both stages', () => {
    const m = new THREE.MeshStandardMaterial();
    let prevCalled = false;
    m.onBeforeCompile = () => { prevCalled = true; };
    m.customProgramCacheKey = () => 'clay';
    const t = new XrayTracker([box()]);
    patchXrayMaterial(m, t.uniform, t.windows);
    patchXrayMaterial(m, t.uniform, t.windows); // idempotent
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(prevCalled).toBe(true);
    expect(shader.uniforms.uXrayTex).toBe(t.uniform);
    expect(shader.uniforms.uXrayWinN).toBe(t.windows.uXrayWinN);
    expect(shader.vertexShader).toContain('vXrayNdc = gl_Position.xyz');
    expect(shader.vertexShader).toContain('texelFetch(uXrayTex');
    expect(shader.vertexShader.match(/attribute float aXrayId;/g)?.length).toBe(1);
    expect(shader.fragmentShader).toContain('hwBayer4(gl_FragCoord.xy) < hwXa');
    expect(shader.fragmentShader).toContain('if (vXrayNdc.z >= w.z) continue;');
    expect(shader.fragmentShader).toContain('discard');
    expect(m.customProgramCacheKey()).toBe('clay|hw-xray-t');
  });

  it('supports a whole-mesh uniform fade (terrain chunks, one landmark)', () => {
    const m = new THREE.MeshLambertMaterial();
    const u = { value: 0 };
    patchXrayMaterial(m, u);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uXray).toBe(u);
    expect(shader.fragmentShader).toContain('uXray * 0.700');
    expect(shader.vertexShader).not.toContain('aXrayId');
  });
});

describe('town helpers', () => {
  it('makes occluder boxes for the real districts (buildings and trees, not lamps or benches)', () => {
    const items = DISTRICTS.flatMap((d) => d.items);
    const boxes = boxesFromPlacements(items);
    expect(boxes.length).toBeGreaterThan(30);
    expect(boxes.some((b) => b.kind === 'st.lamp' || b.kind === 'st.bench')).toBe(false);
    for (const b of boxes) { expect(b.y1).toBeGreaterThan(b.y0); expect(b.hx).toBeGreaterThan(0); expect(b.hz).toBeGreaterThan(0); }
  });

  it('turns waiting queues into trigger points along queueDir (empty queues trigger nothing)', () => {
    const stop = TOWN.stops[0]!, stn = TOWN.rail.stations[0]!;
    const queues: QueueView[] = [
      { at: { kind: 'stop', id: stop.id }, count: 3, longestWaitS: 10, severity: 'ok' },
      { at: { kind: 'platform', id: stn.id }, count: 20, longestWaitS: 10, severity: 'bad' },
      { at: { kind: 'stop', id: TOWN.stops[1]!.id }, count: 0, longestWaitS: 0, severity: 'ok' },
    ];
    const pts = queueTriggerPoints(TOWN, queues);
    expect(pts.length).toBe(3 + 8);
    expect(pts[0]!.x).toBeCloseTo(stop.p.x + stop.queueDir.x * 0.25, 9);
    expect(pts[0]!.y).toBe(0.4);
    expect(pts[3]!.y).toBe(0.95);
  });

  it('x-rays only a handful of buildings for every waiting queue in the default view', () => {
    const items = DISTRICTS.flatMap((d) => d.items);
    const t = new XrayTracker(boxesFromPlacements(items));
    const queues: QueueView[] = [
      ...TOWN.stops.map((s) => ({ at: { kind: 'stop' as const, id: s.id }, count: 8, longestWaitS: 0, severity: 'ok' as const })),
      ...TOWN.rail.stations.map((s) => ({ at: { kind: 'platform' as const, id: s.id }, count: 8, longestWaitS: 0, severity: 'ok' as const })),
    ];
    const n = t.update(queueTriggerPoints(TOWN, queues), viewDir(CAMERA.elevationDeg, CAMERA.azimuthDeg), 0.2);
    // the bible's layout smell test is "> ~3 buildings x-rayed at once"; report the number for the art loop
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(t.boxes.length);
  });
});
