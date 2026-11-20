"use strict";
// Pixel canvas, colour helpers, a seeded random source and a tiny 3x5 font (contact-sheet labels only).
const { encodePNG } = require("./png");

function hex(c) {
  if (Array.isArray(c)) return c;
  const s = c.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), s.length > 6 ? parseInt(s.slice(6, 8), 16) : 255];
}
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
function mix(a, b, t) { a = hex(a); b = hex(b); return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)).concat([a[3] ?? 255]); }
function mul(a, f) { a = hex(a); return [clamp(Math.round(a[0] * f)), clamp(Math.round(a[1] * f)), clamp(Math.round(a[2] * f)), a[3] ?? 255]; }

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(x, y, z, s = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0]; const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  set(x, y, c) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    c = hex(c); const a = c[3] ?? 255; const i = (y * this.w + x) * 4;
    if (a >= 255) { this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; return; }
    if (a <= 0) return;
    const da = this.d[i + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) this.d[i + k] = Math.round((c[k] * sa + this.d[i + k] * da * (1 - sa)) / oa);
    this.d[i + 3] = Math.round(oa * 255);
  }
  clear(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d[(y * this.w + x) * 4 + 3] = 0; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  disc(cx, cy, r, c) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c); }
  ellipse(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y, c); }
  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  /** ASCII sprite: rows of chars, "." empty, others looked up in pal. */
  sprite(rows, x, y, pal) { rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== "." && ch !== " " && pal[ch]) this.set(x + i, y + j, pal[ch]); })); }
  blit(src, dx, dy, alpha = 1) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4; const a = src.d[i + 3]; if (!a) continue;
      this.set(dx + x, dy + y, [src.d[i], src.d[i + 1], src.d[i + 2], Math.round(a * alpha)]);
    }
  }
  flipX() { const o = new Canvas(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const i = (y * this.w + x) * 4, j = (y * this.w + (this.w - 1 - x)) * 4; for (let k = 0; k < 4; k++) o.d[j + k] = this.d[i + k]; } return o; }
  scale(k) {
    const o = new Canvas(this.w * k, this.h * k);
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) { const i = (((y / k) | 0) * this.w + ((x / k) | 0)) * 4, j = (y * o.w + x) * 4; for (let q = 0; q < 4; q++) o.d[j + q] = this.d[i + q]; }
    return o;
  }
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.d[(y * this.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  crop(x, y, w, h) { const o = new Canvas(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = this.get(x + i, y + j); if (c[3]) { const k = (j * w + i) * 4; o.d[k] = c[0]; o.d[k + 1] = c[1]; o.d[k + 2] = c[2]; o.d[k + 3] = c[3]; } } return o; }
  trim(pad = 0) { const b = this.bounds(); return b ? this.crop(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2) : this; }
  /** Fit inside w x h (no scaling), centred horizontally, aligned to the bottom (or centre). */
  place(w, h, align = "bottom", pad = 0) { const o = new Canvas(w, h); const t = this.trim(); o.blit(t, Math.floor((w - t.w) / 2), align === "bottom" ? h - t.h - pad : Math.floor((h - t.h) / 2)); return o; }
  /** 1px outline around opaque pixels, drawn outside them. */
  outline(c) {
    const o = new Canvas(this.w + 2, this.h + 2); o.blit(this, 1, 1); const src = o.d.slice();
    const op = (x, y) => x >= 0 && y >= 0 && x < o.w && y < o.h && src[(y * o.w + x) * 4 + 3] > 40;
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) if (!op(x, y) && (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1))) o.set(x, y, c);
    return o;
  }
  png() { return encodePNG(this.w, this.h, this.d); }
}

// 3x5 font for labels on the contact sheet.
const FONT = {
  A: "111101111101101", B: "110101110101110", C: "111100100100111", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "111100101101111", H: "101101111101101", I: "111010010010111", J: "001001001101111", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "111101101101101", O: "111101101101111", P: "111101111100100", Q: "111101101111001", R: "111101110101101",
  S: "111100111001111", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101111010010", Z: "111001010100111", 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
  4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001001001001", 8: "111101111101111", 9: "111101111001111",
  "-": "000000111000000", ".": "000000000000010", "x": "000101010101000", "_": "000000000000111", "/": "001001010100100",
};
function text(cv, s, x, y, c, k = 1) {
  for (const ch of String(s).toUpperCase()) {
    const g = FONT[ch] || FONT[ch.toLowerCase()];
    if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === "1") cv.rect(x + i * k, y + j * k, k, k, c);
    x += 4 * k;
  }
}
module.exports = { Canvas, hex, mix, mul, clamp, rng, hash3, text };
