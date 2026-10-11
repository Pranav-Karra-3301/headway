import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeImage } from '../analyze.mjs';
import { makeImage, mulberry32 } from './helpers.mjs';

const W = 800, H = 500;
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const sky = (y) => [clamp(205 + (y / H) * 40), clamp(225 + (y / H) * 14), clamp(245 - (y / H) * 25)];

/** Draw axis-aligned rects (x, y, w, h, colour) over a background function. */
const scene = (bg, rects) => makeImage(W, H, (x, y) => {
  for (let i = rects.length - 1; i >= 0; i--) {
    const [rx, ry, rw, rh, c] = rects[i];
    if (x >= rx && x < rx + rw && y >= ry && y < ry + rh) return c;
  }
  return bg(x, y);
});

test('a uniform image is blank (uniform)', () => {
  const r = analyzeImage(makeImage(W, H, () => [240, 230, 210]));
  assert.equal(r.blank, true);
  assert.equal(r.why, 'uniform');
  assert.ok(r.dominantFrac > 0.99);
});

test('a fully transparent image is blank (transparent)', () => {
  const r = analyzeImage(makeImage(W, H, (x) => [x % 255, 0, 0, 0]));
  assert.equal(r.blank, true);
  assert.equal(r.why, 'transparent');
});

test('a smooth sky gradient with vignette and grain is blank (no structure)', () => {
  const rnd = mulberry32(7);
  const r = analyzeImage(makeImage(W, H, (x, y) => {
    const v = 1 - 0.25 * (((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2);
    return sky(y).map((c) => clamp(c * v + (rnd() - 0.5) * 8));
  }));
  assert.equal(r.blank, true);
  assert.equal(r.why, 'no-structure');
  assert.ok(r.edgeFrac < 0.001, `edgeFrac ${r.edgeFrac}`);
});

test('a single tiny dot on a uniform background is still blank', () => {
  const r = analyzeImage(scene(() => [30, 30, 30], [[400, 250, 6, 6, [255, 255, 255]]]));
  assert.equal(r.blank, true);
});

test('a busy town-like scene is not blank', () => {
  const rnd = mulberry32(42);
  const rects = Array.from({ length: 160 }, () => [
    Math.floor(rnd() * W), Math.floor(rnd() * H), 10 + Math.floor(rnd() * 60), 8 + Math.floor(rnd() * 40),
    [Math.floor(rnd() * 255), Math.floor(rnd() * 255), Math.floor(rnd() * 255)],
  ]);
  const r = analyzeImage(scene((x, y) => sky(y), rects));
  assert.equal(r.blank, false);
  assert.equal(r.why, null);
  assert.ok(r.edgeFrac > 0.01, `edgeFrac ${r.edgeFrac}`);
  assert.ok(r.distinct > 20);
});

test('a sparse scene (a dozen small vehicles on a gradient) is not blank', () => {
  const rects = Array.from({ length: 12 }, (_, i) => [60 + i * 60, 200 + (i % 3) * 50, 40, 22, [200, 60 + i * 10, 40]]);
  const r = analyzeImage(scene((x, y) => sky(y), rects));
  assert.equal(r.blank, false, JSON.stringify(r));
});

test('a soft low-contrast pastel scene is not blank', () => {
  // Wooden-toy style: pastel blocks that differ by ~30-40 levels, no hard black outlines.
  const rects = [];
  for (let gx = 0; gx < 16; gx++) {
    for (let gy = 0; gy < 8; gy++) {
      const tone = (gx * 7 + gy * 3) % 4;
      rects.push([gx * 50 + 5, gy * 60 + 5, 38, 44, [196 + tone * 12, 178 + tone * 10, 150 + tone * 8]]);
    }
  }
  const r = analyzeImage(scene(() => [170, 196, 160], rects));
  assert.equal(r.blank, false, JSON.stringify(r));
});

test('reports bounded metrics and honours a custom step', () => {
  const r = analyzeImage(makeImage(100, 60, (x, y) => [(x * 3) & 255, (y * 5) & 255, 90]), { step: 2 });
  assert.equal(r.width, 100);
  assert.equal(r.height, 60);
  assert.equal(r.samples, 50 * 30);
  for (const k of ['dominantFrac', 'edgeFrac', 'transparentFrac']) assert.ok(r[k] >= 0 && r[k] <= 1, k);
  assert.ok(r.lumaStd >= 0);
  assert.match(r.dominant, /^#[0-9a-f]{6}$/);
});
