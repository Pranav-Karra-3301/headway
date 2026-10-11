# Headway art + camera bible
For the C1 camera study, the C2 camera rig, E1–E4 (world), D1–D5 (districts), A1–A6 (assets), T2.x (renderer) and the art-director agent. It turns the sources listed at the end, plus measurements on this repo (2026-10-11), into rules. If a screenshot that breaks a rule reads better, change the rule here in the same PR.

**Frame of reference.** Units are `u`: x east, z south, y up. Person 0.8, door 1.0, storey 1.1, road 2.4, bus 3.3 × 1.25 × 1.1. The board is 72 × 52 and the rail loop 60 × 44 (corner radius 6). The camera sits at the **south-east and looks north-west**. So the **camera side** of anything is its south and east, and its **far side** is north and west. Only south- and east-facing walls are ever seen. On screen, the board's NW corner is the top, SE the bottom, SW the left and NE the right.

## 0. Ten rules (if you read nothing else)
1. Use an orthographic camera with elevation **35.264°** (true iso) and azimuth **45°**. No free rotation.
2. Frame the **transit network**, not the world origin. Fit the rail loop, stops and platforms into the **HUD-safe rect** with 4 % padding.
3. Occlusion is a layout problem first. At true iso, a building of height h hides a band about **h deep on its north side and h deep on its west side**. Put tall buildings on the far side and low ones on the camera side, so heights rise toward the back like an amphitheatre.
4. Station buildings, canopies and tall trees never stand on the camera side of a platform, queue or stop.
5. X-ray (dither the occluder to ~30 % coverage) is the safety net, not the plan.
6. Gameplay owns saturation. Buses, the train, routes and stops are the most chromatic things on screen. Scenery roofs stay at OKLCH C ≤ 0.10, and no scenery uses a route, stop, bus or train hue at full strength.
7. Use one key light from the camera's left (azimuth = camera − 75°, elevation about 50°), so shadows point to screen 3 o'clock. Faces should read top 1 : south 0.80–0.88 : east 0.58–0.68.
8. Use one shape language: rounded primitives and a fixed bevel per object class. Never scale rounded geometry, and show nothing thinner than 2 px at the zoom where it appears.
9. Mountains go only at the back (N, W) and water only at the front (S, E). The board continues into terrain at the same height. The camera only ever sees the south and east cut faces of the diorama.
10. Post-processing is seasoning: AO and tilt-shift must never blur or darken a gameplay element.

## 1. Camera
### 1.1 Elevation
The pixel-art "2:1 at 26.565°" is the **on-screen angle of ground lines**. It comes from a camera **pitched 30°**: a square tile projects with height/width = sin θ = 0.5. True iso pitches the camera to atan(1/√2) = 35.264°, which gives 30° ground lines and equal 0.816 foreshortening on all three axes [PIK, RSG]. In the table below, k is the hide factor (§2.1), "hidden" is measured with x-ray off, and the board aspect is how wide the board projects relative to its height on screen.

| Pitch θ | Camera dir (x,y,z) | Ground lines | Depth squash sinθ | Height scale cosθ | Hide factor k = cotθ/√2 | Board aspect 1/sinθ | Hidden: queues / platforms / routes / rail* |
|---|---|---|---|---|---|---|---|
| 30° (2:1) | (1, 0.816, 1) | 26.57° | 0.50 | 0.87 | 1.22 | 2.00 | 22 / 33 / 42 / 11 % |
| 32.06° (repo today, `ISO_DIR` 70,62,70) | (70, 62, 70) | 27.96° | 0.53 | 0.85 | 1.13 | 1.88 | 22 / 29 / 39 / 10 % |
| **35.264° (true iso)** | **(1, 1, 1)** | 30° | 0.58 | 0.82 | **1.00** | 1.73 | 19 / 29 / 36 / 7 % |
| 40° | (1, 1.187, 1) | 32.74° | 0.64 | 0.77 | 0.84 | 1.56 | 9 / 92 / 27 / 4 % |
| 45° | (1, 1.414, 1) | 35.26° | 0.71 | 0.71 | 0.71 | 1.41 | 6 / 92 / 22 / 4 % |

\* This is a quick estimate on today's base `SCENERY` (pre-districts) using the §2.3 method. It counts the sample points whose ray to the camera hits a box: queue slots, platform slots, and route and rail samples every 1 u. Buildings are boxes (which overstates gables) and trees are crown boxes. Use it as a regression baseline, not as the finished town.

**Decision: 35.264°** (`ISO_DIR = (1, 1, 1).normalize()`). It hides no more than 30–32° on any metric (platforms tie at 29 %) and less on queues, routes and rail. It still sees under platform canopies; at 40° and above, roofs cover what's beneath them and platform occlusion jumps to 92 %. Walls stay readable (height scale 0.82), the board projects at ≈ 1.73 : 1 (a 16:9 safe rect), and k = 1 makes the authoring rule "h hides h" exact.
- 30° makes sprites about 11 % bigger at Overview, which is not worth +6 points of route occlusion.
- 40–45° gives the high, "busy battlefield" read (cf. [PREP] type A vs B) but looks like a map and wastes 16:9 width. Use it only if C1 still measures more than 5 % hidden route samples after the §2.2 layout rules **and** queue canopies get x-ray.
- Pitch is fixed. Zoom-linked pitch breaks the label anchors, the occlusion caches and the shadow fit for little gain.

Layout dominates the angle. Going from 32° to 35° moves hidden routes by 3 points. The fix is moving the buildings that hide routes (§2.2).

### 1.2 Azimuth
- Use 45°. Streets along x and z become the two screen diagonals, and both visible facades are equally foreshortened.
- At 35.26°, azimuths of 35° or 55° change route occlusion by less than 5 points but double platform occlusion (29 % → 58–63 %). Keep 45°.
- For any azimuth in (0°, 90°), the N and W mountains stay behind the town. This is what allows "peek" (§1.6).

### 1.3 Building the camera (three r186)
```ts
import * as THREE from 'three';
export const ISO = { elevationDeg: 35.264, azimuthDeg: 45, distance: 400, near: 1, far: 1000, viewH: 40 } as const;

/** Unit vector target → camera; azimuth from +z toward +x (45° = south-east). Equals (1,1,1)/√3 at the defaults. */
export function isoDir(el = ISO.elevationDeg, az = ISO.azimuthDeg): THREE.Vector3 {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), THREE.MathUtils.degToRad(az));
}
export function createIsoCamera(): THREE.OrthographicCamera {
  const h = ISO.viewH / 2, cam = new THREE.OrthographicCamera(-h, h, h, -h, ISO.near, ISO.far);
  cam.position.copy(isoDir()).multiplyScalar(ISO.distance);
  cam.lookAt(0, 0, 0);
  return cam;
}
/** Resize: only the aspect changes the box; `zoom` stays the single scale control (OrbitControls dolly = zoom). */
export function resizeIso(cam: THREE.OrthographicCamera, cssW: number, cssH: number): void {
  const a = cssW / Math.max(1, cssH), h = ISO.viewH / 2;
  Object.assign(cam, { left: -h * a, right: h * a, top: h, bottom: -h });
  cam.updateProjectionMatrix();
}
/** Move the look-at point (on y = 0) without changing the angle. */
export function lookAtGround(cam: THREE.OrthographicCamera, target: THREE.Vector3): void {
  cam.position.copy(target).addScaledVector(isoDir(), ISO.distance);
  cam.lookAt(target);
}
```

- Ortho depth is linear: near 1 and far 1000 give about 6e−5 u of depth resolution. Z-fighting only comes from coplanar decals, so lift them ≥ 0.01 u or use `polygonOffset`.
- Keep the camera outside the diorama's bounding sphere. The extent is about 136 × 116 u with ridges to 22 u, a radius of about 95 u, so a distance of 400 is safe.
- Picking raycasts only the gameplay layers (vehicles, stops, people). Scenery never blocks a click, x-rayed or not.

### 1.4 Framing: fit the network into the HUD-safe rect
```ts
export interface Rect { x0: number; y0: number; x1: number; y1: number } // CSS px, canvas-relative
/** Zoom + ground target that put `points` inside `safe` (pad = margin fraction); content centre → safe-rect centre. */
export function fitToSafeArea(cam: THREE.OrthographicCamera, cssW: number, cssH: number,
                              points: THREE.Vector3[], safe: Rect, pad = 0.04) {
  cam.updateMatrixWorld();
  const R = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);          // screen right
  const U = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);          // screen up
  const F = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate(); // into the screen
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const x = p.dot(R), y = p.dot(U);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const k = Math.min(((safe.x1 - safe.x0) * (1 - 2 * pad)) / (x1 - x0),
                     ((safe.y1 - safe.y0) * (1 - 2 * pad)) / (y1 - y0));        // CSS px per world unit
  const zoom = (k * (cam.top - cam.bottom)) / cssH;
  const u = (x0 + x1) / 2 - ((safe.x0 + safe.x1) / 2 - cssW / 2) / k;            // view-plane point that must
  const v = (y0 + y1) / 2 + ((safe.y0 + safe.y1) / 2 - cssH / 2) / k;            // sit at the canvas centre
  const target = R.multiplyScalar(u).addScaledVector(U, v);
  target.addScaledVector(F, -target.y / F.y);                                     // slide along the view ray to y = 0
  return { zoom, target, pxPerUnit: k };
}
// const f = fitToSafeArea(cam, w, h, overviewPoints, safeRect()); cam.zoom = f.zoom; cam.updateProjectionMatrix();
// lookAtGround(cam, f.target); controls.target.copy(f.target); controls.minZoom = 0.8 * f.zoom; controls.maxZoom = 4 * f.zoom;
```

**Overview points.** Sample the rail loop every 2 u, at y 0 and y 2.6. Add the 8 `TOWN.stops` (y 0 and 2.2) and the 3 platforms. Don't use AABB corners: the loop's rounded corners would waste about 7 %.

**Safe rect** (CSS px). Recompute it with a ResizeObserver on the canvas and on HUD panel changes:
- `y0` = `--hw-top` (80 px, or 142 px when the top bar wraps at ≤ 1420 px; it already includes the gap) + **36 px** of room for the queue markers above the top-most stops. Read the live value.
- `y1` = dock or bottom-card top − 14 px in Play, otherwise canvas height − 14 px. The SE rail corner sits bottom-centre, right under the Play dock.
- `x1` = inspector left − 14 px while the inspector is open (it is a 332 px panel).
- Corner panels, such as the 236 px legend at bottom-left, are **test-only exclusions**. The iso diamond leaves the screen corners to terrain and water, so don't shrink the rect for them. After fitting, if any stop or platform projects inside a corner panel, zoom out 3 % and refit, up to 5 times.

Example at 1440 × 900: the safe rect is (14, 116)–(1426, 886), which gives **≈ 17 px/u**. At that scale a bus is about 46 px long, a person about 11 px tall and a road about 29 px wide. With the inspector open it drops to 14.3 px/u. At 1440 px width, Central Station lands at about x = 1080 px, right at the inspector's left edge, so:
- If the user is still at Overview (no manual pan or zoom since the last preset), opening or closing the inspector spring-refits to the new rect.
- Otherwise, use ensure-visible: pan the minimum needed so the selection is ≥ 48 px inside the rect. Never refit on every click. An off-screen selection gets an edge pointer.

**Pan clamp.** At ≥ 0.85× Overview, unproject the safe rect's corners and keep them inside `worldLayout().extent` shrunk by 2 u: the bottom corners at y = 0 (water side) and the top corners at y = 14 (the ridges cover the screen above their base). Then no void shows. Below 0.85×, clamp the target to the board and let the designed cut edge show (§6.1).

### 1.5 Zoom presets and motion
Presets are **world boxes**, not zoom numbers, so they survive any viewport or HUD state. The zoom column is the zoom relative to Overview.

| Preset | Box x / z (u) | ≈ zoom vs Overview |
|---|---|---|
| Overview (default) | network points above | 1.0 (≈ 17 px/u at 1440 × 900) |
| Stadium | −26…−4 / 2…24 | 2.0 |
| Downtown hub | −4…14 / −10…8 | 2.4 |
| Campus | −22…0 / −22…0 | 1.8–2.0 |
| Central Station | 16…32 / −10…12 | 2.3 |
| Focus (double-click, F) | entity ± 6 u | max(current, 2.5) |

- The zoom range is 0.8×–4× Overview, recomputed on resize. The wheel steps ×1.1 per notch, with zoom-to-cursor on.
- Transitions are 0.5–0.8 s critically damped springs, with zoom interpolated in log space. Any user input cancels them.
- To follow a vehicle, use a dead zone: pan only when it leaves the inner 60 % of the safe rect.
- The title card may use a 0.45× "beauty shot" (§6.6), with a slow ±10° azimuth drift.

### 1.6 Rotation
- Don't ship free orbit or 90° Q/E steps. Any camera outside the south-east quadrant puts the mountains in front of the town, changes which faces need dressing (§4.3) and voids every occlusion rule.
- For a "look behind", use **peek**: holding Q or E swings the azimuth to 25° or 65° and springs back on release. Keep the sun world-fixed.
- If 90° steps are ever built: cut away the near-side terrain, rotate the key light with the camera so the camera-relative light stays constant ([PREP]: never flip, keep the light direction), and dress the newly visible facades.

## 2. Occlusion and readability
### 2.1 The hide rule
- At azimuth 45°, take a point P at height y and a box with footprint F and top h. **P is hidden if, for some t ∈ [0, k·(h − y)], sliding P toward the camera by (+t, +t) in (x, z) lands inside F.** k = cotθ/√2, which is 1.00 at 35.26°.
- At true iso, the clearance a camera-side (S or E) object needs from its street-facing wall to the thing that must stay visible is k·(h − 0.5). The 0.5 is roughly the mid-height of a bus or person.

| Occluder height h | Clearance | On the camera side of a street, stop or platform? |
|---|---|---|
| ≤ 1.0: bushes, benches, kiosks, fences | ≤ 0.5 u | yes, anywhere |
| 2.2–2.8: shops, cafés, houses, townhouses, trees | 1.7–2.3 u | yes, if the wall is ≥ 2.3 u from the near lane or queue |
| 3.4–3.8: 3 storeys, halls, library, union | 2.9–3.3 u | only ≥ 3.5 u back |
| 4.6–7.0: dorm, midrise, chapel, water tower, `res.tower` | 4.1–6.5 u | no: far side (N or W) of streets, or mid-block behind lawns and parking |
| 8.3: clock tower | 7.8 u | far side, with lawn on its N and W |

### 2.2 Placement rules
1. **Amphitheatre.** Heights rise from SE (screen bottom) to NW (screen top), and the mountains continue the rise. The front third of the board (x + z > 20) is ≤ 3 storeys. Anything goes in the back third (x + z < −20).
2. **Tall side.** On E–W streets the tall side is the north side; on N–S streets it is the west side.
3. **Stations.** The building and canopy posts go on the platform's far side. Central (building west of the track) and Stadium (building north of it) are right. **University is wrong.** Its building stands south of the track, on the camera side, and hid 7 of 8 platform queue slots in the estimate. Put the halt outside the loop (north of the track, against the foothills), or replace it with an open shelter ≤ 1.2 u tall.
4. **Roofs over queues.** A person (mid-height y: 0.4 on paving, 0.95 on a platform) under a roof whose underside is at H is visible only within k·(H − y) of the roof's S or E edge. That is about 1.5 u for the 2.4 u platform canopy at 35°, and 1.0 u at 45°. Keep queue lines inside that band, or x-ray the canopy while people stand under it. Awnings over sidewalk queues follow the same rule.
5. **Trees.** Tall crowns go only on the far side of queues and route streets. Camera-side planting is bushes, hedges ≤ 0.8 u and flowerbeds.
6. **Stops.** Keep a 2 u clear radius (plan) and a 3 u quiet radius (§5.2).
7. **Terrain.** Never put terrain on the board. Mountains stand behind everything by construction, so they may be as tall as the composition wants.

### 2.3 Measuring it (C1 study, district tests)
```ts
/** Share of sample points whose ray toward the camera hits an occluder box (x-ray off). */
export function hiddenFraction(samples: THREE.Vector3[], occluders: THREE.Box3[], dir = isoDir()): number {
  const ray = new THREE.Ray();
  let hidden = 0;
  for (const p of samples) { ray.set(p, dir); if (occluders.some((b) => ray.intersectsBox(b))) hidden++; }
  return samples.length ? hidden / samples.length : 0;
}
```

- **Samples:** queue slots `stop.p + queueDir·(0.25 + 0.5i)`, i < 8, at y 0.4; platform slots the same along `station.queueDir`, at y 0.95; route paths every 1 u at y 0.55; the rail loop every 1 u at y 0.7, excluding the tunnel span.
- **Boxes:** one per building (catalog footprint × height including the roof), each tree as a crown box (y 0.9 to h), and the station building and canopy as separate boxes.
- **Targets with x-ray off:** queues ≤ 2 %, platforms 0 %, routes ≤ 8 %, rail ≤ 10 %. Today it is 19 / 29 / 36 / 7 %. The top offenders are 6 u `tall` buildings on the camera side of routes (64 route hits), townhouses (15), the University station building, and the Central building and canopy over its bus stop's queue (6 of 8 slots hidden). Capping `tall` at 2 storeys alone takes routes from 36 % to 29 %, so setbacks have to do the rest.
- Each district test should assert these targets alongside `validatePlacements`.

### 2.4 X-ray
- **Triggers:** the selected entity, every stop or platform with ≥ 1 waiting, moving vehicles, and the hovered entity. Test a ray from each protected point toward the camera every frame. At ≤ 300 points × ~150 boxes this is trivial.
- **What fades:** buildings, landmarks, trees, terrain and canopies. **Never** the ground, roads, rails, vehicles, people or stops.
- **Look:** a screen-space ordered dither down to ~30 % coverage (Bayer 4 × 4), not alpha blending. That means no sorting artefacts and depth stays valid. Shadows don't change, because the shadow pass uses the depth material.
- **Timing:** fade in over 120 ms, hold ≥ 600 ms after the last hit, fade out over 300 ms. If more than about 3 buildings are x-rayed at once in the default view, the layout is wrong: fix §2.2, not the x-ray.
- **Fade source:** instanced meshes use an `aXray` InstancedBufferAttribute. Merged static geometry uses a per-vertex `aObjId` plus a `DataTexture` of fades (one texel per object) read in the vertex shader.
- **Optional, for the selected vehicle:** draw its silhouette through walls with a second draw (`depthFunc = THREE.GreaterDepth`, flat route colour, 50 %).

```ts
const prev = material.onBeforeCompile;                     // chain after the clay tweak
material.onBeforeCompile = (shader, renderer) => {
  prev.call(material, shader, renderer);
  shader.uniforms.uXray = xray;                            // { value: 0..1 } eased per object (or a varying from aXray)
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', /* glsl */ `
uniform float uXray;
float hwBayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float hwBayer4(vec2 a) { return hwBayer2(0.5 * a) * 0.25 + hwBayer2(a); }
void main() {
  if (uXray > 0.001 && hwBayer4(gl_FragCoord.xy) < uXray * 0.7) discard;   // uXray = 1 keeps ~30 % of pixels`);
};
```

### 2.5 Contrast hierarchy (the most important art rule)
| Tier | What | Chroma (OKLCH C) | Value rule |
|---|---|---|---|
| 1 Interaction | selection ring or outline, hover, HTML markers | ink and paper, outside the scene palette | maximum contrast |
| 2 Gameplay | bus #2E5BDA (0.20), train #D7443E (0.19), routes, stop #F6C945 (0.15), people | ≥ 0.15 target. R1 teal (0.11) can't go much louder in sRGB, so keep scenery teal quiet instead. | vehicles ΔL ≥ 0.35 vs road; people ΔL ≥ 0.2 vs paving |
| 3 Landmarks | stadium seats, clock-tower roof, station trim | ≤ 0.14 | — |
| 4 Scenery | roofs and awnings ≤ 0.10, trees ≤ 0.11, cars ≤ 0.10, ground and lawn ≤ 0.09, walls ≤ 0.04, roads ≤ 0.03 | — | roads vs ground ΔL ≥ 0.08 (today 0.94 vs 0.84) |

- **Reserved hues.** These belong to gameplay: R1 183°, R2 75°, R3 294°, stop 89°, bus 265° and train 27°. Scenery within ±15° of one of them must have C ≤ 0.6 × that colour's C, or differ from it in L by ≥ 0.15.
- **Palette A conflicts found today**, with suggested fixes (check them on the fixed screenshot, §3.4):

| Role (L / C / H) | Clashes with | Suggest |
|---|---|---|
| roof/awning teal #3FA796 (0.66 / 0.099 / 180) | R1 route #1FA99A (0.66 / 0.112 / 183) | sage #7CB29D (0.72 / 0.065 / 168) |
| roof/awning mustard #F2C14E (0.83 / 0.141 / 85) | stop #F6C945 and R2 #F0A830 | butter #E5D090 (0.86 / 0.085 / 92) |
| roof coral #E9785A (0.70 / 0.147 / 36), car[0] #D9665B (0.147 / 27) | train red, as loud as gameplay | terracotta #D77C60 (0.68 / 0.121 / 38); car ≤ 0.10 |
| station canopy #D7443E (= train) | the train vanishes under its own canopy at every stop | warm grey or sage canopy, or maroon at C ≤ 0.11 |
| leaves #4FAF6E, #66BF7A (C 0.13) | louder than the R1 route | #6CB17B, #5A9E6E (C ≈ 0.10) |
| shirts #F2CC8F, #81B29A (L 0.86 / 0.72) | vanish on cream paving (L 0.90–0.94) | #4075AA #B65C4E #685C81 #519160 #A97E2C (L 0.50–0.62) |

- **Highlight mode** (spec): the selected route stays at full strength, while other routes and the scenery lerp 60 % toward `bg`.
- **Squint test:** blur the screenshot 8 px and desaturate it. Vehicles, route ribbons, stops and queues must still be what you see first.
- **Dusk** (the stadium exit runs 21:30–22:00, so dusk is a primary look). From darkest to brightest: sky and mountains < scenery (≤ 45 % of windows lit) < roads < gameplay. Gameplay at dusk means headlights, bus displays, lamp pools under every stop, and route ribbons with a 0.2–0.3 emissive lift.

## 3. Low-poly look
### 3.1 Shape and silhouette
- **Silhouette first** [LP]. Each asset must be recognisable as a solid black shape 64 px tall from the game camera, and distinct from its siblings: stadium = bowl + 4 masts; Central = long canopy + clock house; clock tower = shaft + pyramid; chapel = spire; houses = gables; shops = flat roofs + false fronts and awnings; towers = slab + balconies.
- From iso, roofs are the biggest surfaces, so silhouette and colour live on the roof.
- Use rounded primitives only. The bevel radius is a world constant per class: buildings 0.08–0.14, vehicles 0.06–0.10, props 0.02–0.05, terrain terraces 0.25–0.4.
- **Never scale rounded geometry.** Rebuild it at size; the kit caches geometry by size. ([LP]: "if you halve the size, halve the subdivision", and don't scale duplicates.) Trees may vary ±15 %.
- Use smooth, rounded shading everywhere, terrain included. Never mix `flatShading` facets in ([LP]: mixed smoothing breaks cohesion).

### 3.2 Detail density
- **Minimum feature:** ≥ 2 px at the lowest zoom where it is shown. That is 0.12 u at Overview and 0.06 u at 2×. Thinner parts (0.05 u frames, sills, fence rails) are `detail()`-tagged and appear only from 1.5× or in 'toy' detail, or they get thickened.
- **Even density:** neighbours differ by at most 2× in visible parts per u² of facade. Big walls get rhythm (a window every 0.9–1.5 u), not noise.
- **Budgets** (plan): building ≤ 3k triangles, landmark ≤ 8k, instanced prop ≤ 600. Cylinder segments follow size: 8 below r 0.1, 12–16 from r 0.5, 24 from r 2.
- Spend detail on the S and E faces and on roofs. N and W faces get plain window rhythm only ([BLD]: don't build what is never seen).

### 3.3 Materials
- Use one clay material for everything: vertex colours, roughness ≈ 0.8, metalness 0, wrap 0.22, camera rim 0.14 and ground darkening 0.8. No image textures and no normal maps. "Texture" means soft gradients: water depth, sky and ground AO.
- The look is matte painted wood, not plastic, with at most a faint sheen on bevels (roughness ≥ 0.65). Glass is a light slate (#4A6380, per the coordinator note), not a navy hole.
- **Palette fidelity:** a lit top face renders within ΔL ±0.04 (OKLab) of its palette hex, so the palette file is the truth. Keep `NeutralToneMapping` at exposure 1.0; ACES shifts yellows and teals.

### 3.4 Palette, saturation, value
- The scene runs on three value bands: light (roads, walls, paving; L ≥ 0.88), mid (ground 0.78–0.86; roofs and trees 0.60–0.86) and dark accents (bus, windows, ink; L ≤ 0.55).
- Equal saturation everywhere means no focal point [LP]. Keep lawns below C 0.09 to avoid "neon grass".
- Warm light, cool shadows [LP]: the sun is #fff0d9, and the grade's split tone pushes shadows toward blue-violet.
- Test palettes on one fixed screenshot. Mini Motorways' colour sheet shows the same map in 12 palettes [MM]. Its takeaways for us: one flat mid-value land colour, paths with strong value contrast, and small saturated gameplay blocks with one consistent shadow direction.

### 3.5 Lighting
- **Key** (the sun, the only shadow caster): azimuth = camera azimuth − 75° (±15°), elevation 48–55° by day. Today's (−14, 34, 22) is elevation 52.5°, 77.5° left of the camera: keep it. Shadows then point to screen 3 o'clock (slightly up), away from the faces you look at, and are about 0.75 × height long.
- Never light from behind the scene (S and E faces go dark), and never straight from the camera (no shadows, flat).
- **Dusk:** elevation 18–22°, azimuth camera − 100° to − 110°, sun #ffb07a, `shadow.intensity` 0.6–0.7. Readability at dusk comes from the emissives (§2.5).
- **Fill:** a hemisphere light with a warm-white sky and the board colour as ground, standing in for [LP]'s skydome fill plus bounce. If the east face measures below 0.55 × the top, add a non-shadowing directional from camera azimuth + 70°, elevation 25°, at ≈ 0.25 × the key.
- **Targets** (sample a cream wall in a screenshot): top 1.0 : south face 0.80–0.88 : east face 0.58–0.68. Mint ground in shadow should be 0.62–0.72 × lit ground.
- Asset preview pages use the game camera and these exact lights ([PREP]: one shared render template; keep key, fill and shadow constant).

### 3.6 Shadows
- Use `renderer.shadowMap.type = THREE.PCFShadowMap`, which is the soft one since r182. `PCFSoftShadowMap` is deprecated, and `world/dev.ts` still uses it. Don't use VSM (light bleeding).
- One shadow light: `mapSize` 4096 (high) or 2048 (low), `radius` 2–3, `bias` −0.0002 to −0.0005 (the docs: "very tiny adjustments, order 0.0001"), `normalBias` 0.02–0.04.
- Fit the shadow camera to the board + 4 u in light space; `lights.ts#fit` already does this. Keep near and far within ±2 u of the content so the bias stays small in world units. Debug with `new THREE.CameraHelper(sun.shadow.camera)`.
- A bigger frustum means blockier shadows [3JS-SH]. So terrain beyond the board does not cast realtime shadows (`castShadow = false`, with form baked into vertex colours). If you ever refit per view, translate the frustum in whole texels or shadows crawl while panning.
- **Contact shadows:** every vehicle and person gets a blob shadow, as in [3JS-SH] "fake shadows": an instanced radial-gradient quad at y 0.01, `depthWrite: false`, opacity 0.25–0.35, about 1.1 × the footprint. People (up to 1,500) need no sun shadows.

### 3.7 Post (today: GTAO → tilt-shift → bloom → grade → output → SMAA)
| Pass | Do | Don't |
|---|---|---|
| GTAO | world radius 0.6–1.0 u, blend 0.6–0.75, CSS-pixel resolution | dark halos > 0.5 u around buildings at Overview; AO on water or sky |
| Tilt-shift | focus on the safe-rect centre, or the selection; band half-height ≥ 0.3 and blur ≤ 1.5 px at Overview, ≤ 2.5 px at ≥ 2×; off below 0.95× | blurring any stop, queue, selection or the train; strong miniature blur in Play |
| Bloom | dusk only, threshold ≥ 0.8, strength ≤ 0.8, emissive roles only | blooming cream walls or roads by day |
| Grade | saturation 1.06–1.12, warmth 0.03–0.06, cool shadows and warm highlights, vignette ≤ 0.25 centred on the safe rect, grain ≤ 0.02 | crushed blacks; a vignette that darkens edge stops |
| AA | SMAA at DPR ≤ 2 | FXAA (smears 1–2 px details) |
| Haze | aerial perspective by distance beyond the board edge (§6.5) | camera-depth fog, which hazes the north half of the town |
| Outline | selection only (ring decal or inverted hull) | global ink outlines |

## 4. Isometric buildings
### 4.1 Scale sheet (match exactly)
| Thing | Size (u) |
|---|---|
| person | 0.8 tall |
| door | 0.6 × 1.0 (public 0.7–0.9 × 1.2) |
| storey | 1.1 (shop ground floor 1.35, upper 1.05, frieze 0.25) |
| window | 0.45–0.62 w × 0.50–0.60 h (hall arched 0.5 × 0.9); frame and sill 0.05 |
| roof | overhang 0.12–0.20; gable pitch 35–45° (rise ≈ 0.8–1.0 per 1.1 half-depth) |
| bus / train car | 3.3 × 1.25 × 1.1 / car spacing 4.6 |
| road / sidewalk / lamp | 2.4 / 0.8–1.2 / 2.2 |
| trees / bush | 2.2–3.2 / 0.7 |

- **Scale men** [BLD]. Every preview page shows a 0.8 u person and a bus next to the asset. Landmarks such as the stadium may break overall size but never door or window size. "A human door on one house, a goblin door on the next" is the failure.

### 4.2 Grid and footprints
- Snap footprints and positions to a 0.25 u grid. Rotate only in 90° steps, with fronts facing streets.
- Sizes come from the catalog steps (2.5, 3, 3.5, 4, 5, 6, 7 u). Heights are n storeys × 1.1 plus the roof. Stay within the catalog footprint ±10 % and height ±25 % (the plan's tests).
- Leave ≥ 0.4 u between buildings so contact AO and shadows separate them. Break a long row's roofline at least every 7 u ("never three equal heights", as `downtown/shops.ts` already does).

### 4.3 Dress the faces the camera sees
- Visible: the south wall (screen-left face, lit), the east wall (screen-right face, shade) and the roof. North and west walls are never seen.
- A building fronting a street to its N or W shows the camera its back. Give its S and E faces a secondary front: windows, a side door, a balcony, a sign, planters. No blank camera-facing wall wider than 2 u.
- Put the strongest accents (awnings, doors, signs) on south faces. East faces carry window rhythm.

### 4.4 Roofs
- One roof type per building, from five: gable 35–45° (houses, townhouses), hip (corners, halls), flat with parapet or false front (shops, apartments), dome or cupola (library, union), spire or pyramid (clock tower, chapel). Stations get a long shed canopy.
- Pitches under 25° read as flat. Pitches over 50° look stretched and hide more.
- Ridges run parallel to the street. Roof colour carries district identity, split 60/30/10 within a district: campus sage-slate, downtown terracotta, apartments butter and slate, outskirts mixed.
- At most 2 rooftop items (units, chimneys) per roof, each ≥ 0.2 u.

### 4.5 Consistency across a set
- Keep the same bevel, window, door, trim and colour roles across a set. Variety comes from massing, roof type, colour index and 2–3 parametric options. Reuse window and door units [BLD].
- Vary by rotation and parameters, never by mirroring ([PREP]: don't flip; it breaks lighting and handedness).

### 4.6 Sample-asset-first workflow
1. Block out **one** sample per family at kit scale, next to the scale figures, using the game camera and lights on the assets-dev page.
2. Screenshot it at Overview (≈ 17 px/u) and at 2.5×. Score §7 items 11–15 and get approval.
3. Build the family from shared parts, then screenshot the whole family together to compare detail density side by side.
4. Place it in its district and run the §2.3 occlusion test before you publish.

## 5. Town composition
### 5.1 Where things land on screen (35.26°, 45°, Overview)
Positions are normalised to the content frame: x runs from −1 (left) to +1 (right), y from −1 (bottom) to +1 (top).

| Element | World x, z | Screen x, y | Role |
|---|---|---|---|
| Clock tower (Old Main) | −10.5, −9 | −0.03, +0.33 (top at +0.66) | vertical accent, top centre |
| University Station | −12, −20 | +0.17, +0.58 | top |
| Stadium | −13.9, 7.3 | −0.44, +0.08 | **primary dominant**, left third |
| Stadium Gate / Stadium Station | −11.5, 13.5 / −19, 20 | −0.51, −0.09 / −0.81, −0.08 | left |
| Downtown hub stop | 6.5, 1.2 | +0.11, −0.20 | centre; Main St × Atherton St cross at ≈ (−0.04, 0) |
| Central Station | 28.3, −2 | +0.62, −0.56 | **counterpoint**, lower right |
| Apartments N / S stops | 21.5, 5 / 10.6 | +0.34, −0.57 / +0.22, −0.68 | bottom |
| Board corners NW / NE / SE / SW | — | (−0.21, 1.16) / (1.28, −0.25) / (0.21, −1.26) / (−1.28, 0.14) | off-frame, so the screen corners show world |

### 5.2 Rules
1. **Dominants** [COMP]: the stadium (largest mass, the stadium-exit story), Central Station (counterpoint, the busiest transfer) and the clock tower (thin vertical at top centre). Each has a unique silhouette and ≥ 2 u of calm around it; a dominant "can't merge with the rest".
2. **One loud thing per screen third.** At most one tier-3 accent per third. "Keep the player's interest on one thing at a time."
3. **Leading lines.** Main St and Atherton St form an X through the frame centre at the Downtown hub: keep both continuous (nothing bridges them, no tree breaks the line, one curb colour). The rail loop is the frame and routes are the coloured lines. Every exit resolves into a portal or a bridge, never a dead end at the board edge.
4. **Balance.** The stadium's mass on the left balances Central plus the apartments on the right and bottom right. The busy campus cluster at the top is balanced by the light, low-contrast water band at the bottom: heavy vs light visual weight [COMP].
5. **Quiet zones.** Within 3 u of each stop and platform, keep plain paving, at most one bench and one lamp, nothing over 0.8 u on the camera side, and no chroma above C 0.06 except the stop itself ([COMP]: bland spaces give visual rest).
6. **Scale variety in three steps:** landmarks (footprint ≥ 50 u² or height ≥ 6 u), buildings (6–25 u², 2–5 u tall), props (≤ 1 u², ≤ 2.5 u tall). No more than three equal buildings in a row; uniform sizes read as "flat and chaotic".
7. **Staffage.** Walking crowds are leading lines too, so keep them on district `paths`, aimed at stops and gates.
8. **District identity.** Each district gets one roof hue family plus one ground material: a lawn quad for campus, paving downtown, gardens and parking for the apartments, a plaza at the stadium.
9. **Don't over-compose.** Streets and blocks stay a grid; compose only the dominants and the edges ([COMP]: let nature compose; don't fake it).

## 6. Environment framing
### 6.1 What the camera sees of the world
- At gameplay zooms (≥ 0.8× Overview) the board's corners fall outside the frame, so the four screen corners show world beyond the board: west mountains top left, north mountains top right, south water bottom left, east water bottom right. The NE and SW headlands sit just off the right and left edges. The default frame is a place, not a floating slab.
- The diorama's outer cut edge may only appear below about 0.85× (bottom corners, as a "slice of a world" reveal) and in the 0.45× title-card beauty shot. The pan clamp in §1.4 enforces this.

### 6.2 The board-to-world seam
- Keep the ground at the same height (y 0) across the board edge: no slab step and no visible board outline. When the world layer is on, retire the board drop shadow (`backdrop.ts`) and put one under the diorama base instead.
- Use a 2–4 u transition band: lawn to meadow and forest floor on the N and W edges, and lawn to sand (#ECDCBD) to shore on the S and E edges.
- The outskirts (D5) carry the town past the edge: tree belts, fields and a few houses at about 50 % density, thinning toward the terrain.

### 6.3 Mountains (N and W, always behind)
- Heights rise away from the board: foothills 3–8 u at the edge, ridges 14–22 u at the back. The rearmost ridge is the world's top silhouette, and no flat terrain shows behind it.
- **Toy treatment:** stacked contour terraces, like a laser-cut wooden topo model: 1.0–1.5 u steps, rounded edges (r 0.3), 3–6 steps per ridge. Lit terrace tops and shaded risers give clean value bands. The alternative is smooth rounded hills. Never use noisy faceted triangles.
- **Colour:** slopes darker and quieter than the board (L 0.55–0.68, C ≤ 0.09; pines around #3E8562), with warm-grey rock (C ≤ 0.03) and no snow. Instanced pines grow in clusters of 3–9, dense in valleys and sparse on ridgelines so the skyline stays clean.
- **Tunnel portals** face S or E, toward the camera: a stone arch with an interior gradient to #2D3242 (never black), 2 lamps, and the road or rail continuing 1–2 u inside.

### 6.4 Water (S and E, always in front)
- Flat plane just below the beach, in three bands by distance to shore: shallow #AEE4DF, mid #82CCD5, deep #54ADC1. Deep water stays at L ≥ 0.66 with hue ≤ 220°, so cobalt buses on bridges keep ΔL ≥ 0.15. Chroma C ≤ 0.10.
- **Shore:** a 0.2–0.4 u white foam line with a slow 4–6 s pulse. Waves move ≤ 0.05 u, sparkles are sparse by day, and at dusk only warm lamp streaks appear (bridges, marina). No town reflections, no refraction, no transparency.
- **Bridges and causeways** are chunky, rounded and cream or wood, with the deck ≤ 0.6 u above the water and lamps at both ends. Marina boats bob ≤ 0.1 u.

### 6.5 Sky, distant ridges, aerial perspective
- An ortho camera has **no size falloff**. Distance comes only from overlap, value and saturation fade, less detail and a higher screen position, so author distant ridges smaller and flatter rather than just moving them back.
- Put 2–3 distant ridge layers behind the mountains as flat silhouettes, with no trees on the farthest. Colour = mix(base #5C947C, haze #DDEFE5, t) with t = 0.35 / 0.55 / 0.75, giving #89B3A0, #A2C5B5 and #BCD8CA. Contrast inside a layer stays ≤ 0.04 L.
- **Sky:** the lightest haze band sits just above the ridge line, slightly deeper toward the top. Day runs mint to cream; dusk runs indigo #2F3A5E to peach #D99A86 at the horizon. Anchor the haze to the ridges with a world-space backdrop card behind the far ridge, sized for 0.45× zoom, and set `scene.background` to the card's top colour so panning never shows a seam.
- **Dusk:** the ridges lerp toward the dusk sky and get a thin peach rim on the far tops. 2–4 flat low-poly clouds drift slowly and cast no shadow on the board.
- Aerial perspective is a function of distance **beyond the board edge**, never of camera depth.

### 6.6 Diorama base and cut edges
- Only the **S and E outer faces** are ever visible: water cross-sections plus the soil under the beach and headlands. The N and W faces hide behind the mountains, so skip detail there.
- The visible cut is 4–6 u deep below y 0, in 3–5 strata: under the lake, water #80C5CD, #53A6B9, #3285A2 with a lighter 0.3 u surface band; under land, soil #AE8A6D, #94725B, #766558.
- Cut faces are 15–25 % darker than the tops and flat, with a rounded top edge (r 0.3). One soft contact shadow sits under the base, offset to screen right like the key light.

### 6.7 Exits and the rail tunnel
- Every road leaving the board ends in a portal (N, W) or a bridge (S, E), at `worldLayout().exits`.
- The rail tunnel is on the west half, ≥ 15 u from stations, with a portal at each end. The train should visibly enter and leave it at Overview.

## 7. Art-director checklist
Score each item 2 (pass), 1 (minor) or 0 (fail). Ship when every ★ item scores ≥ 1 and the total is ≥ 50 of 60.

Shots (palette A, tilt-shift on and off): Watch at Overview, day and dusk; the Stadium preset at dusk after 21:40; 4× on Downtown; Play with the inspector open.

1. ★ The camera is ortho at 35.26° / 45°: a straight E–W road is a 30° line on screen (±1°).
2. ★ Overview fits all 8 stops, the 3 platforms and the rail loop in the safe rect. Nothing sits under the top bar, dock, inspector or legend, and there is ≥ 36 px above the top-most stop.
3. ★ Nothing that matters is hidden: every waiting queue, platform, the selection and every moving vehicle is visible (x-ray on).
4. Layout without x-ray: hidden samples are ≤ 2 % for queues, 0 % for platforms and ≤ 8 % for routes (§2.3).
5. X-ray: ≤ 3 buildings faded at once in the default view; the dither reads as ~30 %; nothing flickers as buses pass.
6. ★ Squint and grayscale test: vehicles, route ribbons, stops and queues are read first.
7. ★ The most saturated pixels on screen belong to gameplay. No scenery role breaks its §2.5 ceiling or the reserved-hue rule.
8. People are ≥ 10 px tall at Overview, differ from their paving by ΔL ≥ 0.2, and each has a contact blob.
9. Face ratios on a cream wall are top 1 : S 0.80–0.88 : E 0.58–0.68, and shadowed ground is 0.62–0.72 × lit.
10. Shadows all point the same way (screen 2–4 o'clock), with soft edges, no acne, no peter-panning and no crawl when panning.
11. Each landmark is recognisable as a black silhouette. The stadium, Central and the clock tower are distinct at Overview.
12. Doors are 1.0, storeys 1.1 and people 0.8 everywhere: no goblin doors and no giant windows.
13. Everything is rounded with consistent bevels per class, with no faceted or flat-shaded meshes mixed in.
14. Nothing is under 2 px at the zoom shown; detail density is even across neighbours, with no noisy patches.
15. South and east walls are dressed, with no blank camera-facing wall over 2 u.
16. Lit tops are within ΔL 0.04 of their hex, and nothing looks washed out at Overview.
17. The stadium, Central and the clock tower are all visible at Overview, each with ≥ 2 u of quiet, and the Downtown hub is within ±0.25 of the frame centre.
18. The front (SE) third is ≤ 3 storeys, and towers sit only on the far side of streets.
19. The 3 u around each stop is calm: no clutter, nothing tall on the camera side, no competing chroma.
20. Main St and Atherton St read as unbroken lines, and every exit resolves into a portal or a bridge.
21. ★ No void shows inside the safe rect at ≥ 0.85× Overview, and there is no slab edge or seam at the board-to-world boundary.
22. Mountains are only at the back, with a clean ridgeline and 2–3 aerial layers fading toward the sky.
23. Water is flat toy bands plus foam at C ≤ 0.10, and buses on bridges contrast with it (ΔL ≥ 0.15).
24. In the beauty shot, the S and E cut faces show strata, are darker than the tops, have a rounded edge and sit on a soft shadow.
25. ★ Tilt-shift never blurs a stop, queue or the selection and stays ≤ 1.5 px at Overview; AO leaves no halos; bloom only touches dusk emissives.
26. ★ At dusk, gameplay is the brightest layer (headlights, displays, lamp pools at stops), and ≤ 45 % of windows are lit.
27. In highlight mode the selected route pops, and the other routes and the scenery sit at 60 % toward `bg`.
28. Queue markers and labels overlap neither each other nor HUD panels at Overview, and an off-screen selection shows an edge pointer.
29. At 0.8× and 4× nothing breaks: no void, shadows stay crisp enough, and details appear from 1.5×.
30. The scene holds 60 fps at Overview on the demo laptop, with ≤ 10 draw calls for people and vehicles.

## Sources
| Tag | Source | Status | Used for |
|---|---|---|---|
| CAM | gamedeveloper.com: How to position the camera for isometric assets | loaded | camera to the SE; X = m·cos45°, Y = m·tan A, Z = m·sin45°; X = Y = Z gives true iso |
| LP | gamedeveloper.com: How to make low poly look good | loaded | silhouette; density ∝ size; no mixed smoothing; low saturation; 3-layer light; warm and cool; haze and DOF |
| BLD | gamedeveloper.com: How to design isometric buildings | loaded | grid footprints; scale men; matched doors and windows; build only what's seen; reuse |
| COMP | gamedeveloper.com: Composition in level design | loaded | dominants, lines, layers, balance, contrast, scale variety, rest areas |
| PREP | gamedeveloper.com: How to prepare isometric assets | loaded | camera-height types; ortho; constant key, fill and shadow; don't flip renders |
| 3JS-CAM | threejs.org manual: Cameras | loaded | ortho frustum, `zoom`, resize |
| 3JS-SH | threejs.org manual: Shadows | loaded | shadow-camera fit, mapSize, CameraHelper, blob shadows, one shadow light |
| MM | blakemwood.com: Mini Motorways | loaded, captions only; the concept images were viewed directly | 12-palette test sheet; value-contrast roads; the pseudo-3D iso concept was dropped for a flat read |
| RSG | retrostylegames.com: What is an isometric game | loaded, thin | 45° / 35.264° definition |
| INN | innovecsgames.com: Mastering isometric perspective | loaded, thin | 30° lines, depth sorting (generic) |
| PIK | pikuma.com: Isometric projection in games | loaded | 2:1 dimetric (116.57° / 126.87°) vs true iso; tile math |

Also used: the three.js `LightShadow` docs (bias, normalBias, radius), the r182 note that `PCFSoftShadowMap` is deprecated, and repo measurements (OKLCH of palette A, occlusion estimate, screen positions) from throwaway scripts that are not committed. Re-run them with §2.3.
