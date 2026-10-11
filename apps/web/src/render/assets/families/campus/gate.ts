// Owner: A2. cp.gate: campus arch gate. Two brick piers with limestone bands and caps, iron lanterns that glow at
// dusk, a limestone arch with a keystone crest. 4 × 1 footprint, about 3.0 tall. The path runs
// along z through the 2.4 u opening.
import * as THREE from 'three';
import type { AssetParams, KitContext } from '../../types';
import { archRing, at, box, mats, pyramid } from './parts';
import { pick } from './pick';

const PX = 1.6, PW = 0.76, PH = 1.95;

export function buildGate(k: KitContext, p: AssetParams): THREE.Group {
  const x = mats(k, pick(p.brick, 3, k), 0, 0);
  const iron = k.mat('cpIron'), lamp = k.mat('lamp'), crest = k.mat('cpBanner', pick(p.banner, 3, k));
  const g = new THREE.Group();

  for (const s of [-1, 1]) {
    const px = s * PX;
    g.add(at(box(k, PW + 0.12, 0.3, PW + 0.12, x.stone), px, 0.15, 0));
    g.add(at(k.rbox(PW, PH - 0.3, PW, 0.05, x.brick), px, 0.3 + (PH - 0.3) / 2, 0));
    g.add(k.detail(at(box(k, PW + 0.05, 0.08, PW + 0.05, x.stone), px, 1.15, 0)));
    g.add(at(box(k, PW + 0.16, 0.12, PW + 0.16, x.stone), px, PH + 0.06, 0));
    g.add(at(box(k, PW - 0.16, 0.12, PW - 0.16, x.stone), px, PH + 0.18, 0));
    // Lantern: iron base, glowing body, iron cap and knob.
    g.add(at(box(k, 0.2, 0.08, 0.2, iron), px, PH + 0.28, 0));
    g.add(at(box(k, 0.22, 0.3, 0.22, lamp), px, PH + 0.47, 0));
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) g.add(k.detail(at(box(k, 0.03, 0.3, 0.03, iron), px + cx * 0.115, PH + 0.47, cz * 0.115)));
    g.add(at(pyramid(k, 0.32, 0.32, 0.16, iron), px, PH + 0.62, 0));
    g.add(k.detail(at(k.sphere(0.035, iron, 6), px, PH + 0.8, 0)));
    // Stone plaque on the outer face.
    g.add(k.detail(at(box(k, 0.04, 0.32, 0.4, x.stone), px + s * (PW / 2 + 0.02), 0.78, 0)));
  }

  // Arch springing from the piers' inner faces, keystone + crest, iron bar with lamp below.
  const spring = 1.62, rOut = 1.42, rIn = 1.16;
  g.add(at(archRing(k, rOut, rIn, 0.46, x.stone, 12), 0, spring, 0));
  g.add(at(box(k, 0.26, 0.32, 0.52, x.stone), 0, spring + rIn + 0.12, 0));
  // Upright shield crest on the apex: gold backing, coloured faces both sides, gold ball on top.
  const my = spring + rOut + 0.18;
  g.add(at(box(k, 0.46, 0.44, 0.1, x.gold), 0, my, 0));
  g.add(at(k.cone(0.23, 0.16, x.gold, 4).rotateZ(Math.PI).rotateY(Math.PI / 4), 0, my - 0.3, 0));
  for (const s of [-1, 1]) g.add(at(box(k, 0.34, 0.34, 0.02, crest), 0, my + 0.01, s * 0.055));
  g.add(k.detail(at(k.sphere(0.06, x.gold, 6), 0, my + 0.28, 0)));
  // Hanging name plaque under the apex (a shape, no text).
  const py = spring + rIn - 0.36;
  g.add(k.detail(at(box(k, 0.86, 0.26, 0.05, iron), 0, py, 0)));
  g.add(k.detail(at(box(k, 0.7, 0.04, 0.06, x.gold), 0, py + 0.02, 0)));
  for (const s of [-1, 1]) g.add(k.detail(at(box(k, 0.02, 0.24, 0.02, iron), s * 0.3, py + 0.25, 0)));
  return g;
}
