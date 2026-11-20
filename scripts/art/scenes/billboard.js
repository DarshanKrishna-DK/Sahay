"use strict";
// Languages section: an empty pixel billboard on posts with two lamps (text goes on top in HTML), and a
// horizontally tileable night skyline strip (hills, neem and coconut trees, small houses with lit windows).
const { Canvas, hex, mix, hash3 } = require("../lib/pix");
const S = require("../lib/sky");
const P = require("../lib/palette");

function billboard(o = {}) {
  const W = o.w || 210, H = o.h || 150, top = 22, bottom = 108, L = 8, R = W - 8;
  const cv = new Canvas(W, H);
  // posts and a catwalk
  for (const px of [Math.round(W * 0.26), Math.round(W * 0.7)]) {
    cv.rect(px, bottom, 6, H - bottom, "#16264C"); cv.rect(px, bottom, 1, H - bottom, "#2B4C8A"); cv.rect(px + 5, bottom, 1, H - bottom, "#0B1730");
    for (let y = bottom + 8; y < H - 2; y += 6) cv.rect(px + 1, y, 4, 1, "#22386A");
  }
  cv.rect(L - 2, bottom, R - L + 4, 3, "#22386A"); cv.rect(L - 2, bottom + 3, R - L + 4, 1, "#0B1730");
  for (let x = L; x < R; x += 6) cv.rect(x, bottom - 4, 1, 4, "#2B4C8A");
  // board: frame, panel with faint texture, dashed inner line
  cv.rect(L, top, R - L, bottom - top - 4, "#2B5DA0");
  cv.rect(L + 3, top + 3, R - L - 6, bottom - top - 10, "#1C4A8C");
  for (let y = top + 3; y < bottom - 7; y++) for (let x = L + 3; x < R - 3; x++) if (hash3(x, y, 0, 7) < 0.05) cv.set(x, y, "#21528F");
  for (let x = L + 7; x < R - 7; x += 3) { cv.set(x, top + 7, "#4F7FC0"); cv.set(x, bottom - 12, "#4F7FC0"); }
  for (let y = top + 7; y < bottom - 11; y += 3) { cv.set(L + 7, y, "#4F7FC0"); cv.set(R - 8, y, "#4F7FC0"); }
  cv.rect(L, bottom - 4, R - L, 1, "#163B70");
  cv.rect(R, top + 2, 2, bottom - top - 4, "#061431");
  // lamps with a warm pool of light on the board
  for (const lx of o.lamps || [Math.round(W * 0.3), Math.round(W * 0.7)]) {
    cv.rect(lx, top - 12, 1, 12, "#3A4C72"); cv.rect(lx - 4, top - 13, 9, 1, "#3A4C72");
    cv.rect(lx - 3, top - 16, 7, 3, "#2A2F3F"); cv.rect(lx - 2, top - 13, 5, 1, P.lamp);
    for (let k = 5; k >= 1; k--) cv.ellipse(lx + 0.5, top + 2, 6 + k * 6, 4 + k * 5, [...hex(P.lamp).slice(0, 3), 10 + (5 - k) * 6]);
    S.glow(cv, lx + 0.5, top - 12, 8, P.lamp, 0.5, 3);
  }
  return cv;
}

/** Periodic noise over width W (integer frequencies so it tiles). */
const pnoise = (x, W, seed, fs) => fs.reduce((s, [f, a], i) => s + a * Math.sin((2 * Math.PI * f * x) / W + seed * (i + 1) * 1.7), 0);

function skyline() {
  const W = 480, H = 90, cv = new Canvas(W, H), groundY = 80;
  // far hills with a mist line
  for (let x = 0; x < W; x++) {
    const h = 44 + pnoise(x, W, 1, [[2, 7], [5, 3], [11, 1.5]]);
    for (let y = Math.round(h); y < groundY; y++) cv.set(x, y, y < h + 2 ? "#24508F" : "#1A3F7A");
  }
  for (let x = 0; x < W; x++) { const h = 56 + pnoise(x, W, 3, [[3, 5], [7, 2]]); for (let y = Math.round(h); y < groundY; y++) cv.set(x, y, "#153569"); }
  // tree line: round canopies and coconut palms
  const trees = [];
  for (let x = 0; x < W; x += 7 + Math.floor(hash3(x, 0, 0, 5) * 9)) trees.push(x);
  for (const tx of trees) {
    const kind = hash3(tx, 1, 0, 5), r = 6 + Math.floor(kind * 6);
    if (kind > 0.86) { // palm
      const top = groundY - 26 - Math.floor(kind * 6);
      for (let y = top; y < groundY; y++) cv.set(tx + Math.round((groundY - y) * 0.08), y, "#0D2650");
      const cx = tx + Math.round((groundY - top) * 0.08);
      for (const [dx, dy] of [[-7, 3], [-5, 1], [5, 1], [7, 3], [-3, -2], [3, -2]]) cv.line(cx, top, cx + dx, top + dy, "#0D2650");
      continue;
    }
    const cy = groundY - 8 - r;
    for (let y = cy - r; y <= groundY; y++) for (let x = tx - r - 2; x <= tx + r + 2; x++) {
      const inside = ((x - tx) / (r + 1)) ** 2 + ((y - cy) / r) ** 2 <= 1 || (y > cy && Math.abs(x - tx) <= 1);
      if (!inside) continue;
      const lit = y < cy - r * 0.55 && hash3(x, y, 2, 5) < 0.5;
      cv.set(((x % W) + W) % W, y, lit ? "#1D4A80" : "#0F2C5E");
    }
  }
  // small houses with lit windows and roof tanks
  for (let x = 12; x < W - 30; x += 46 + Math.floor(hash3(x, 3, 0, 5) * 40)) {
    const w = 16 + Math.floor(hash3(x, 4, 0, 5) * 14), h = 12 + Math.floor(hash3(x, 5, 0, 5) * 12), y0 = groundY - h;
    cv.rect(x, y0, w, h, "#132E5E"); cv.rect(x - 1, y0 - 1, w + 2, 1, "#1D3F75");
    if (hash3(x, 6, 0, 5) < 0.6) cv.rect(x + 3, y0 - 5, 4, 4, "#0B1A38");
    for (let wy = y0 + 3; wy < groundY - 4; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) {
      const on = hash3(wx, wy, 7, 5) < 0.45; cv.rect(wx, wy, 2, 3, on ? P.window : "#0E2246");
      if (on) cv.set(wx, wy + 3, [255, 206, 107, 90]);
    }
  }
  // ground band
  cv.rect(0, groundY, W, H - groundY, "#0A1C3E"); cv.rect(0, groundY, W, 1, "#14305E");
  return cv;
}

function assets() {
  let b = null; const bb = () => (b ||= billboard());
  return [
    ["billboard.png", bb, 2, "Languages: empty billboard (text in HTML on the panel)"],
    ["billboard-small.png", () => billboard({ w: 150, h: 120, lamps: [75] }), 2, "Languages: smaller billboard, one lamp"],
    ["skyline-night.png", skyline, 2, "Languages: night skyline strip, repeat-x"],
  ];
}
module.exports = { assets, billboard, skyline };
