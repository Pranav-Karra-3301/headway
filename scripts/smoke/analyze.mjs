// Blank-canvas detection on a decoded screenshot. A canvas is "blank" when it is transparent, one flat colour, or has
// no structure at all (a smooth gradient, vignette or film grain alone has no hard edges; a drawn town has many).
import { rgbaAt } from './png.mjs';

export const BLANK_THRESHOLDS = {
  transparentFrac: 0.985, // >= this share of samples with alpha < 8
  dominantFrac: 0.985, // >= this share of samples in one 5-bit-per-channel colour bucket
  edgeFrac: 0.001, // < this share of neighbouring sample pairs differing by >= edgeDelta in some channel
  edgeDelta: 24,
};

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Sample a grid (default step: min(w, h) / 250 px) and measure colour spread and edges.
 * @returns {{ width: number, height: number, step: number, samples: number, distinct: number, dominant: string,
 *   dominantFrac: number, edgeFrac: number, transparentFrac: number, lumaStd: number, meanRgb: string,
 *   blank: boolean, why: 'transparent' | 'uniform' | 'no-structure' | null }}
 */
export function analyzeImage(img, { step } = {}) {
  const { width: w, height: h } = img;
  const s = Math.max(1, step ?? Math.floor(Math.min(w, h) / 250));
  const T = BLANK_THRESHOLDS;
  const buckets = new Map();
  let samples = 0, transparent = 0, pairs = 0, edges = 0;
  let lSum = 0, lSq = 0, rSum = 0, gSum = 0, bSum = 0;
  const cols = Math.ceil(w / s);
  let prevRow = null;
  for (let y = 0; y < h; y += s) {
    const row = new Array(cols);
    for (let x = 0, cx = 0; x < w; x += s, cx++) {
      const p = rgbaAt(img, x, y);
      row[cx] = p;
      samples++;
      if (p[3] < 8) transparent++;
      const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
      const bucket = buckets.get(key);
      if (bucket) bucket.n++;
      else buckets.set(key, { n: 1, rgb: p });
      const l = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      lSum += l; lSq += l * l; rSum += p[0]; gSum += p[1]; bSum += p[2];
      if (cx > 0) { pairs++; if (isEdge(row[cx - 1], p, T.edgeDelta)) edges++; }
      if (prevRow) { pairs++; if (isEdge(prevRow[cx], p, T.edgeDelta)) edges++; }
    }
    prevRow = row;
  }
  let top = { n: 0, rgb: [0, 0, 0, 0] };
  for (const b of buckets.values()) if (b.n > top.n) top = b;
  const mean = lSum / samples;
  const r = {
    width: w,
    height: h,
    step: s,
    samples,
    distinct: buckets.size,
    dominant: hex(top.rgb[0], top.rgb[1], top.rgb[2]),
    dominantFrac: top.n / samples,
    edgeFrac: pairs ? edges / pairs : 0,
    transparentFrac: transparent / samples,
    lumaStd: Math.sqrt(Math.max(0, lSq / samples - mean * mean)),
    meanRgb: hex(Math.round(rSum / samples), Math.round(gSum / samples), Math.round(bSum / samples)),
    blank: false,
    why: null,
  };
  if (r.transparentFrac >= T.transparentFrac) r.why = 'transparent';
  else if (r.dominantFrac >= T.dominantFrac) r.why = 'uniform';
  else if (r.edgeFrac < T.edgeFrac) r.why = 'no-structure';
  r.blank = r.why !== null;
  return r;
}

function isEdge(a, b, delta) {
  return Math.abs(a[0] - b[0]) >= delta || Math.abs(a[1] - b[1]) >= delta || Math.abs(a[2] - b[2]) >= delta;
}

/** One-line human summary, e.g. "1600x1000 edges 4.21% top #e8dcc4 31%". */
export function describeCanvas(m) {
  const pct = (v) => (v * 100).toFixed(v < 0.1 ? 2 : 1) + '%';
  return `${m.width}x${m.height} edges ${pct(m.edgeFrac)} top ${m.dominant} ${pct(m.dominantFrac)}` + (m.blank ? ` [${m.why}]` : '');
}
