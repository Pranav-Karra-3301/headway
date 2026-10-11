// Minimal PNG decoder for Chrome screenshots: 8-bit grey / grey+alpha / RGB / RGBA, non-interlaced. Dependency-free.
import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** @returns {{ width: number, height: number, channels: number, data: Uint8Array }} unfiltered rows, no padding. */
export function decodePng(buf) {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error('decodePng: not a PNG');
  let width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = 0;
  const idat = [];
  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
  }
  const channels = CHANNELS[colorType];
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`decodePng: unsupported format (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('decodePng: truncated image data');
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[up + x] : 0;
      let v = raw[src + x];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const c = y > 0 && x >= channels ? out[up + x - channels] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`decodePng: bad filter type ${ft} on row ${y}`);
      }
      out[row + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

/** Pixel at (x, y) as [r, g, b, a] whatever the channel layout. */
export function rgbaAt(img, x, y) {
  const { channels: n, data } = img;
  const i = (y * img.width + x) * n;
  if (n === 4) return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  if (n === 3) return [data[i], data[i + 1], data[i + 2], 255];
  if (n === 2) return [data[i], data[i], data[i], data[i + 1]];
  return [data[i], data[i], data[i], 255];
}
