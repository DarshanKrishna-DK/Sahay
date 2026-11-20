"use strict";
// FAQ: a hand-drawn-looking pixel guide map on paper: river, roads, trees, little shops, a dotted route
// from your shop (lime star) to three seller pins, and a compass.
const { Canvas, hash3, rng } = require("../lib/pix");
const P = require("../lib/palette");

function guideMap() {
  const N = 128, cv = new Canvas(N, N), R = rng(77);
  // paper with a ragged, darker edge and a fold
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const e = Math.min(x, y, N - 1 - x, N - 1 - y), rag = hash3(x, y, 0, 3) < 0.5 ? 1 : 0;
    if (e < 2 + rag && (e === 0 || hash3(x, y, 1, 3) < 0.55)) continue;
    let c = e < 6 ? "#E2D2A6" : hash3(x >> 2, y >> 2, 2, 3) < 0.2 ? "#EFE2BE" : "#F4EACB";
    if (x === 64 || x === 65) c = "#E6D8B0";
    cv.set(x, y, c);
  }
  // river
  for (let y = 0; y < N; y++) { const cx = 22 + Math.round(8 * Math.sin(y / 14)); for (let w = -3; w <= 3; w++) cv.set(cx + w, y, Math.abs(w) === 3 ? "#5E95C9" : (y + w) % 7 === 0 ? "#B9D8F0" : "#7FB4E0"); }
  // roads
  const road = (x0, y0, x1, y1) => { for (let k = -1; k <= 1; k++) cv.line(x0, y0 + k, x1, y1 + k, k ? "#D9BF88" : "#E9D4A2"); };
  road(4, 70, 124, 62); road(70, 4, 78, 124); road(30, 100, 124, 100);
  for (let x = 16; x < 30; x++) { cv.set(x, 68, P.woodDark); cv.set(x, 72, P.woodDark); } // bridge rails
  // trees
  for (let i = 0; i < 46; i++) {
    const x = 6 + Math.floor(R() * 116), y = 6 + Math.floor(R() * 116);
    if (Math.abs(x - (22 + 8 * Math.sin(y / 14))) < 6 || Math.abs(y - (70 - (x - 4) / 15)) < 4 || Math.abs(x - 74) < 4 || Math.abs(y - 100) < 3) continue;
    cv.rect(x, y, 3, 2, "#4E9F45"); cv.rect(x + 1, y - 1, 1, 1, "#68B54E"); cv.set(x + 1, y + 2, P.trunk);
  }
  // little shops
  const shop = (x, y, wall) => { cv.rect(x, y + 2, 7, 5, wall); cv.rect(x - 1, y, 9, 2, P.awnRed); for (let i = 0; i < 9; i += 2) cv.set(x - 1 + i, y + 1, P.awnCream); cv.rect(x + 2, y + 4, 3, 3, "#5A3A2A"); };
  const home = [40, 82], sellers = [[96, 22, P.pinkWall], [104, 80, P.teal], [56, 108, P.ochre]];
  shop(home[0], home[1], P.kurta2);
  for (const [x, y, w] of sellers) shop(x, y, w);
  // dotted routes
  const route = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i += 3) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); cv.rect(x, y, 2, 2, P.red); } };
  for (const [x, y] of sellers) route(home[0] + 8, home[1] + 2, x - 1, y + 9);
  // pins over sellers, a star on home
  const pin = (x, y) => cv.sprite([".KKK.", "KLLLK", "KLWLK", "KLLLK", ".KLK.", "..K.."], x, y, { K: P.ink, L: P.lime, W: P.cream });
  for (const [x, y] of sellers) pin(x + 1, y - 8);
  cv.sprite(["...K...", "..KYK..", "KKYYYKK", ".KYYYK.", ".KYKYK.", "KK...KK"], home[0], home[1] - 9, { K: P.ink, Y: P.gold });
  // compass
  const cx = 112, cy = 112;
  cv.disc(cx, cy, 8, "#EADBB8"); cv.line(cx, cy - 7, cx, cy + 7, P.ink); cv.line(cx - 7, cy, cx + 7, cy, P.ink);
  cv.rect(cx - 1, cy - 7, 3, 4, P.red); cv.sprite(["K..K", "KK.K", "K.KK", "K..K"], cx - 2, cy - 15, { K: P.ink });
  return cv;
}
function assets() { return [["guidemap.png", guideMap, 2, "FAQ: pixel guide map"]]; }
module.exports = { assets };
