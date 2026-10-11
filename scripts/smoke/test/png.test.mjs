import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePng, rgbaAt } from '../png.mjs';
import { encodePng, makeImage } from './helpers.mjs';

const pattern = (w, h, channels) => {
  const data = Buffer.alloc(w * h * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + ((i / channels) | 0) * 11 + 5) & 255;
  return { width: w, height: h, channels, data };
};

test('decodes RGBA with every filter type', () => {
  const img = pattern(9, 6, 4);
  for (const filter of [0, 1, 2, 3, 4]) {
    const out = decodePng(encodePng(img, { filter }));
    assert.equal(out.width, 9);
    assert.equal(out.height, 6);
    assert.equal(out.channels, 4);
    assert.deepEqual(Buffer.from(out.data), img.data, `filter ${filter}`);
  }
});

test('decodes RGB, grey and grey+alpha, mixed filters per row, split IDAT', () => {
  for (const channels of [3, 1, 2]) {
    const img = pattern(13, 11, channels);
    const out = decodePng(encodePng(img, { filter: (y) => y % 5, splitIdat: 4 }));
    assert.equal(out.channels, channels);
    assert.deepEqual(Buffer.from(out.data), img.data, `channels ${channels}`);
  }
});

test('rgbaAt expands every channel layout to RGBA', () => {
  const rgba = makeImage(2, 1, (x) => (x === 0 ? [10, 20, 30, 40] : [50, 60, 70, 80]));
  assert.deepEqual(rgbaAt(rgba, 1, 0), [50, 60, 70, 80]);
  const rgb = { width: 1, height: 1, channels: 3, data: Buffer.from([1, 2, 3]) };
  assert.deepEqual(rgbaAt(rgb, 0, 0), [1, 2, 3, 255]);
  const grey = { width: 1, height: 1, channels: 1, data: Buffer.from([9]) };
  assert.deepEqual(rgbaAt(grey, 0, 0), [9, 9, 9, 255]);
  const greyA = { width: 1, height: 1, channels: 2, data: Buffer.from([9, 0]) };
  assert.deepEqual(rgbaAt(greyA, 0, 0), [9, 9, 9, 0]);
});

test('rejects non-PNG input and unsupported formats', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  const img = pattern(4, 4, 4);
  assert.throws(() => decodePng(encodePng(img, { bitDepth: 16 })), /unsupported/);
  assert.throws(() => decodePng(encodePng(img, { interlace: 1 })), /unsupported/);
});
