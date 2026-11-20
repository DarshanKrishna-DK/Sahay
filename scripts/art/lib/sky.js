"use strict";
// 2D pixel pieces for the night sky: moon with a stepped halo, pastel pixel clouds, a tileable cloud band,
// sparkle stars, stepped lamp glows, banded night gradients and grass strips.
const { Canvas, hex, mix, rng, hash3 } = require("./pix");
const P = require("./palette");

/** Stepped soft halo (alpha rings), the only glow the style allows. */
function glow(cv, cx, cy, r, color, strength = 0.22, steps = 4) {
  const c = hex(color);
  for (let s = steps; s >= 1; s--) {
    const rr = (r * s) / steps;
    cv.disc(cx, cy, rr, [c[0], c[1], c[2], Math.round(255 * strength * (1 - (s - 1) / steps) * 0.55)]);
  }
}

/** Moon of radius r with craters and a lit rim, inside a canvas big enough for its halo. */
function moon(r, o = {}) {
  const halo = o.halo ?? Math.round(r * 0.55);
  const size = Math.ceil((r + halo) * 2 + 4), cv = new Canvas(size, size), c = size / 2;
  if (halo) {
    const mc = hex(P.moon);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) - r;
      if (d < 0 || d > halo) continue;
      const a = Math.pow(1 - d / halo, 2.2) * (o.haloA ?? 110);
      cv.set(x, y, [mc[0], mc[1], mc[2], Math.round(a / 6) * 6]);
    }
  }
  const R = rng(o.seed || 5);
  const craters = Array.from({ length: o.craters ?? 7 }, () => [c + (R() - 0.5) * r * 1.2, c + (R() - 0.5) * r * 1.2, r * (0.08 + R() * 0.12)]);
  for (let y = Math.floor(c - r); y <= c + r; y++) for (let x = Math.floor(c - r); x <= c + r; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > r) continue;
    let col = P.moon;
    const lit = (-dx - dy) / (r * 1.414);
    if (d > r - Math.max(2, r * 0.06) && lit > 0.1) col = P.moonHi;
    else if (lit < -0.55 && d > r * 0.72) col = (x + y) % 2 ? P.moonLo : P.moon;
    for (const [kx, ky, kr] of craters) {
      const e = Math.hypot(x + 0.5 - kx, y + 0.5 - ky);
      if (e < kr && Math.hypot(kx - c, ky - c) + kr < r * 0.95) col = e > kr - 1.5 && x + 0.5 - kx + (y + 0.5 - ky) < 0 ? mix(P.moon, P.moonLo, 0.8) : mix(P.moon, P.moonLo, 0.35);
    }
    cv.set(x, y, col);
  }
  return cv;
}

/** Shade one cloud pixel from a pseudo-normal (lit from upper left); light dither only on band edges. */
function cloudShade(nx, ny, x, y, under) {
  const l = -nx * 0.35 - ny * 0.9 - under;
  const bands = [[0.6, P.cloudHi], [0.3, "#FCE6DC"], [0.02, P.cloudPink], [-0.28, P.cloudLav], [-0.55, P.cloudBlue], [-9, P.cloudShade]];
  for (let i = 0; i < bands.length; i++) {
    const [t, col] = bands[i];
    if (l > t) return i > 0 && l - t < 0.035 && (x % 2 === 0) && (y % 2 === 0) ? bands[i - 1][1] : col;
  }
  return P.cloudShade;
}

/** Puffy pixel cloud: w wide, about h tall above a flat base. */
function cloud(w, h, seed, o = {}) {
  const R = rng(seed);
  const n = o.bumps || Math.max(3, Math.round(w / (h * 0.8)));
  const bumps = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1), mid = 1 - Math.abs(t - 0.5) * 2;
    const r = h * (0.28 + 0.4 * mid + R() * 0.16);
    bumps.push([w * (0.1 + 0.8 * t) + (R() - 0.5) * 3, 0, r]);
  }
  const base = Math.ceil(Math.max(...bumps.map((b) => b[2] * 1.45))) + 1;
  for (const b of bumps) b[1] = base - b[2] * 0.55;
  const cv = new Canvas(w + 2, base + 2);
  for (let y = 0; y <= base; y++) for (let x = -2; x < w + 2; x++) {
    let best = null, depth = -1;
    for (const b of bumps) { const d = b[2] - Math.hypot(x + 0.5 - b[0], y + 0.5 - b[1]); if (d > depth) { depth = d; best = b; } }
    if (depth < 0 || !best) continue;
    const nx = (x + 0.5 - best[0]) / best[2], ny = (y + 0.5 - best[1]) / best[2];
    cv.set(x + 1, y + 1, cloudShade(nx, ny, x, y, y > base - 2 ? 0.5 : 0));
  }
  return cv.trim();
}

/** Horizontally tileable cloud band in two layers (a lavender back row, a bright front row). The bottom
 * `solid` rows fill with `floor` (e.g. the paper colour) and dissolve upward into the clouds. */
function cloudBand(w, h, seed, o = {}) {
  const R = rng(seed), cv = new Canvas(w, h), solid = o.solid ?? 0, floor = o.floor;
  const base = h - solid;
  const row = (minR, maxR, lift, step) => { const out = []; let x = R() * 10; while (x < w) { const r = minR + R() * (maxR - minR); out.push([x, base - r * lift + 2, r]); x += r * step; } return out; };
  const layers = [{ bumps: row(h * 0.22, h * 0.42, 0.75, 1.1), back: 0.28 }, { bumps: row(h * 0.12, h * 0.26, 0.45, 1.25), back: 0 }];
  for (const L of layers) for (let y = 0; y < base; y++) for (let x = 0; x < w; x++) {
    let best = null, depth = -1;
    for (const b of L.bumps) for (const off of [-w, 0, w]) { const d = b[2] - Math.hypot(x + 0.5 - b[0] - off, y + 0.5 - b[1]); if (d > depth) { depth = d; best = [b[0] + off, b[1], b[2]]; } }
    if (depth < 0 || !best) continue;
    const nx = (x + 0.5 - best[0]) / best[2], ny = (y + 0.5 - best[1]) / best[2];
    cv.set(x, y, cloudShade(nx, ny, x, y, L.back + (y > base - 4 ? 0.2 : 0)));
  }
  if (floor) {
    cv.rect(0, base, w, solid, floor);
    for (let y = base - 8; y < base; y++) for (let x = 0; x < w; x++) { const k = base - y; if ((x + y * 3) % 4 === 0 ? k < 7 : k < 3 && (x + y) % 2 === 0) cv.set(x, y, floor); }
  }
  return cv;
}

/** Sparkle star (+ shape) or dot. */
function star(cv, x, y, size, color = P.cream) {
  cv.set(x, y, color);
  for (let i = 1; i <= size; i++) { const a = i === size ? [...hex(color).slice(0, 3), 150] : color; cv.set(x + i, y, a); cv.set(x - i, y, a); cv.set(x, y + i, a); cv.set(x, y - i, a); }
}
function starField(cv, seed, density = 0.0016, h = cv.h) {
  const R = rng(seed);
  const n = Math.round(cv.w * h * density);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(R() * cv.w), y = Math.floor(R() * h), q = R();
    if (q < 0.08) star(cv, x, y, 2); else if (q < 0.22) star(cv, x, y, 1, "#DDE6FF"); else cv.set(x, y, [243, 241, 226, 120 + Math.floor(R() * 120)]);
  }
}

/** Vertical banded gradient (pixel steps with checker dither at each step). */
function bands(cv, top, bottom, n = 8, y0 = 0, y1 = cv.h) {
  const H = y1 - y0;
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / H, b = Math.floor(t * n), f = t * n - b;
    for (let x = 0; x < cv.w; x++) {
      const k = f > 0.82 && (x + y) % 2 ? b + 1 : b;
      cv.set(x, y, mix(top, bottom, Math.min(1, k / (n - 1))));
    }
  }
}

/** Grass strip along the bottom: bumpy lime top, dark under-band, tiny flowers. */
function grass(cv, y, seed, o = {}) {
  const R = rng(seed);
  for (let x = 0; x < cv.w; x++) {
    const bump = hash3(x >> 1, 0, 0, seed) < 0.35 ? 1 : 0, tuft = hash3(x, 1, 0, seed) < 0.1 ? 2 : 0;
    for (let yy = y - bump - tuft; yy < cv.h; yy++) {
      const d = yy - (y - bump - tuft);
      let c = d === 0 ? P.grassHi : d < 3 ? P.grass : d < 5 ? P.grass2 : d < 7 ? P.grass3 : (x + yy) % 3 ? "#2C5E2A" : "#3F8C35";
      if (d === 1 && hash3(x, yy, 2, seed) < 0.3) c = P.grassHi;
      cv.set(x, yy, c);
    }
  }
  const n = o.flowers ?? Math.round(cv.w / 28);
  for (let i = 0; i < n; i++) {
    const x = 2 + Math.floor(R() * (cv.w - 4)), c = ["#F4F1E6", "#F6C8D6", "#F2D16B"][i % 3];
    cv.set(x, y - 2, c); cv.set(x - 1, y - 1, c); cv.set(x + 1, y - 1, c); cv.set(x, y - 1, "#F2D16B"); cv.set(x, y, P.grass3);
  }
}

module.exports = { glow, moon, cloud, cloudBand, star, starField, bands, grass };
