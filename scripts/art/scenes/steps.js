"use strict";
// Four framed step scenes for "From need to order" (night sky, sparkle stars, grass strip, one voxel
// subject): Say it, Sahay finds sellers, Bargain, Your yes. Square, 180 native -> 360.
const { Vox, render } = require("../lib/voxel");
const { Canvas, hex, hash3 } = require("../lib/pix");
const S = require("../lib/sky");
const V = require("../lib/props");
const P = require("../lib/palette");

const N = 120;
const flat = (c) => ({ c, flat: true });

function frame(seed) {
  const cv = new Canvas(N, N);
  S.bands(cv, "#122F6B", "#3A78B8", 7);
  S.starField(cv, seed, 0.0012, 60);
  S.star(cv, 14 + (seed % 5) * 5, 14, 2); S.star(cv, 100 - (seed % 3) * 7, 26, 2);
  return cv;
}
/** A grass ground tile (with flowers) around the subject, bigger than the frame so it reads as ground. */
function ground(v, seed, R = 11) {
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) {
    if (v.has(x, y, -1)) continue;
    const h = hash3(x, y, 0, seed);
    v.set(x, y, -1, h < 0.12 ? P.grassHi : h < 0.55 ? P.grass : h < 0.9 ? P.grass2 : P.grass3);
    v.set(x, y, -2, P.dirt); v.set(x, y, -3, P.dirt2);
    if (h > 0.988 && !v.has(x, y, 0)) v.set(x, y, 0, ["#F4F1E6", "#F6C8D6", "#F2D16B"][Math.floor(h * 1000) % 3]);
  }
}
/** Render v and place it so the ground centre (0,0,0) lands at (N/2, N*0.7). Returns the offset for proj(). */
function stand(cv, r, cx = N / 2, cy = Math.round(N * 0.7)) {
  const [gx, gy] = r.proj(0, 0, 0); const ox = Math.round(cx - gx), oy = Math.round(cy - gy);
  cv.blit(r.cv, ox, oy); return [ox, oy];
}
function waves(cv, x, y, dir = 1, n = 3, color = P.lime) {
  for (let i = 1; i <= n; i++) {
    const r = 4 + i * 5;
    for (let a = -0.9; a <= 0.9; a += 0.04) cv.set(Math.round(x + dir * Math.cos(a) * r), Math.round(y + Math.sin(a) * r), [...hex(color).slice(0, 3), 255 - i * 40]);
  }
}
const RUPEE = ["XXXXXX", "...XX.", "XXXXXX", "..XX..", "XXX...", ".XX...", "..XX..", "...XX.", "....XX"];
function tag(cv, x, y, down = true) {
  // a cream price tag with a hole and string, rupee sign and a lime down-arrow
  const w = 28, h = 16;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const cut = i < 5 && (Math.abs(j - h / 2 + 0.5) > i + 3); if (!cut) cv.set(x + i, y + j, P.cream); }
  for (let i = 0; i < w; i++) { cv.set(x + i, y + h, P.paper2); }
  cv.set(x + 4, y + 7, P.ink); cv.set(x + 4, y + 8, P.ink);
  cv.line(x + 4, y + 7, x - 4, y - 6, P.steel);
  cv.sprite(RUPEE, x + 8, y + 3, { X: P.ink });
  if (down) cv.sprite(["..X..", "..X..", "..X..", "XXXXX", ".XXX.", "..X.."], x + 18, y + 4, { X: "#3F8C35" });
}
function bubble(cv, x, y, w, h, fill = P.cream) {
  cv.rect(x + 1, y, w - 2, h, fill); cv.rect(x, y + 1, w, h - 2, fill);
  cv.rect(x + 4, y + h, 3, 2, fill); cv.set(x + 3, y + h + 2, fill);
}

function miniShop(v, x, y, wall, sign, W = 6, D = 4) {
  v.box(x, y, 0, W, D, 6, wall);
  v.box(x + 1, y + D - 1, 1, W - 2, 1, 3, "#E8C78A"); v.box(x + 1, y + D - 1, 1, W - 2, 1, 1, P.wood);
  v.set(x + 1, y + D - 1, 2, P.dal); v.set(x + 3, y + D - 1, 2, P.red); v.set(x + 2, y + D - 1, 3, P.rice);
  for (let i = 0; i < W; i++) { v.set(x + i, y + D, 5, i % 2 ? P.awnCream : P.awnRed); if (i % 2 === 0) v.set(x + i, y + D + 1, 4, P.awnRed); }
  v.box(x, y + D, 6, W, 1, 2, flat(sign)); for (let i = 1; i < W - 1; i++) v.set(x + i, y + D, 7, flat(P.cream));
  v.box(x, y, 6, W, D, 1, P.plaster);
}
function pin(cv, x, y, color = P.lime) {
  cv.sprite(["..KKKKK..", ".KCCCCCK.", "KCCCWCCCK", "KCCWWWCCK", "KCCCWCCCK", ".KCCCCCK.", "..KCCCK..", "...KCK...", "....K...."], x - 4, y - 9, { K: P.deep, C: color, W: P.cream });
}

function sayIt() {
  const cv = frame(51), v = new Vox();
  v.add(V.person({ shirt: P.kurta, moustache: true, collar: P.cream, phone: true }), 0, 0, 0);
  V.sack(v, -6, -4, 0, P.rice, P.rice, 3, 3, 4); V.sack(v, -6, 0, 0, P.dal, P.dal, 3, 3, 3, P.red);
  ground(v, 51);
  const r = render(v); const [ox, oy] = stand(cv, r, 54, 86);
  const [px, py] = r.proj(3, 1, 7);
  waves(cv, ox + px + 3, oy + py - 1, 1, 3);
  bubble(cv, ox + px + 8, oy + py - 34, 38, 16);
  [3, 7, 11, 6, 9, 4, 8, 5].forEach((hgt, i) => cv.rect(ox + px + 12 + i * 4, oy + py - 26 - Math.floor(hgt / 2), 2, hgt, P.blue));
  return cv;
}
function findsSellers() {
  const cv = frame(52), v = new Vox();
  const shops = [[-7, -9, P.teal, P.blue], [-12, -2, P.ochre, "#1F5E3A"], [3, -6, P.pinkWall, "#7A2E4F"]];
  for (const [x, y, w, sg] of shops) miniShop(v, x, y, w, sg);
  for (let x = -12; x <= 12; x++) for (const y of [4, 5]) v.set(x, y, -1, (x + y) % 3 ? "#C9A36B" : "#B48D58");
  ground(v, 52, 13);
  const r = render(v); const [ox, oy] = stand(cv, r, 60, 88);
  for (const [x, y] of shops) { const [px, py] = r.proj(x + 3, y + 2, 10); pin(cv, ox + px, oy + py); }
  return cv;
}
function bargain() {
  const cv = frame(53), v = new Vox();
  v.add(V.person({ shirt: P.kurta, moustache: true, collar: P.cream }), -5, 1, 0, { swap: true });
  v.add(V.person({ shirt: "#2E8B6E", pants: "#3B4A6B", armOut: "R" }), 1, -5, 0);
  V.sack(v, 2, 3, 0, P.rice, P.rice, 3, 3, 4); V.sack(v, 5, 4, 0, P.dal, P.dal, 3, 3, 3, P.red);
  ground(v, 53);
  const r = render(v); const [ox, oy] = stand(cv, r, 60, 84);
  const [px, py] = r.proj(0, 0, 13);
  tag(cv, ox + px - 12, oy + py - 18);
  return cv;
}
function yourYes() {
  const cv = frame(54), v = new Vox();
  // order paper standing on the grass
  for (let x = 0; x < 9; x++) for (let z = 0; z < 13; z++) {
    let c = P.white;
    if (z >= 3 && z <= 10 && x >= 1 && x <= 7 && z % 2) c = x >= 6 ? P.ink : "#9FB0CF";
    if (z === 11 && x >= 1 && x <= 4) c = P.blue;
    v.set(x - 7, 0, z, flat(c));
  }
  v.box(-7, -1, 0, 9, 1, 13, P.paper2);
  // a big lime check, extruded
  const check = [[0, 4], [1, 3], [2, 2], [3, 1], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6], [9, 7], [10, 8]];
  for (const [i, k] of check) for (const dk of [0, 1, 2]) { v.set(-1 + i, 3, 5 + k + dk, flat(P.lime)); v.set(-1 + i, 2, 5 + k + dk, flat("#7FBF5A")); }
  ground(v, 54);
  const r = render(v); stand(cv, r, 60, 86);
  S.star(cv, 98, 40, 2, P.lime); S.star(cv, 22, 44, 1, P.cream);
  return cv;
}

function assets() {
  const list = [["say-it", sayIt], ["finds-sellers", findsSellers], ["bargain", bargain], ["your-yes", yourYes]];
  return list.map(([n, f], i) => [`step-${i + 1}-${n}.png`, f, 3, `From need to order, frame ${i + 1}`]);
}
module.exports = { assets, frame, stand, waves, pin, tag, bubble, miniShop };
