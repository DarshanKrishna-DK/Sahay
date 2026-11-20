"use strict";
// Minimal PNG encoder (RGBA or indexed with tRNS when the image has <= 256 colours).
// Pixel art compresses best as an indexed PNG; per-row filters are picked by the min-sum heuristic.
const zlib = require("node:zlib");

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

function filterRows(raw, w, h, bpp) {
  const stride = w * bpp, out = Buffer.alloc((stride + 1) * h), cand = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride), prev = y ? raw.subarray((y - 1) * stride, y * stride) : null;
    let best = null, bestSum = Infinity, bestType = 0;
    for (let t = 0; t < 5; t++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
        let v = row[i];
        if (t === 1) v -= a; else if (t === 2) v -= b; else if (t === 3) v -= (a + b) >> 1; else if (t === 4) v -= paeth(a, b, c);
        v &= 0xff; cand[i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; bestType = t; best = Buffer.from(cand); }
    }
    out[y * (stride + 1)] = bestType; best.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

/** rgba: Uint8ClampedArray/Buffer of w*h*4. Returns a PNG Buffer. */
function encodePNG(w, h, rgba) {
  const map = new Map(); const idx = new Uint8Array(w * h); let indexed = true;
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    const key = a === 0 ? 0 : ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | a) >>> 0;
    let k = map.get(key);
    if (k === undefined) { if (map.size >= 256) { indexed = false; break; } k = map.size; map.set(key, k); }
    idx[i] = k;
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [sig];
  if (indexed) {
    ihdr[9] = 3; parts.push(chunk("IHDR", ihdr));
    const pal = Buffer.alloc(map.size * 3), trns = Buffer.alloc(map.size); let anyT = false;
    for (const [key, k] of map) { pal[k * 3] = key >>> 24; pal[k * 3 + 1] = (key >>> 16) & 255; pal[k * 3 + 2] = (key >>> 8) & 255; trns[k] = key & 255; if ((key & 255) !== 255) anyT = true; }
    parts.push(chunk("PLTE", pal)); if (anyT) parts.push(chunk("tRNS", trns));
    parts.push(chunk("IDAT", zlib.deflateSync(filterRows(Buffer.from(idx), w, h, 1), { level: 9, memLevel: 9 })));
  } else {
    ihdr[9] = 6; parts.push(chunk("IHDR", ihdr));
    parts.push(chunk("IDAT", zlib.deflateSync(filterRows(Buffer.from(rgba.buffer, rgba.byteOffset, w * h * 4), w, h, 4), { level: 9, memLevel: 9 })));
  }
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
module.exports = { encodePNG };
