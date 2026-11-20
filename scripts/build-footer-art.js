#!/usr/bin/env node
// Builds the landing footer's pixel picture (public/index.html, between the footer-art markers), in
// the v7 night palette: a night sky with stars, the moon and pastel clouds over a street; a wood and
// brick kirana counter with its owner, Sahay as the round lime character (as public/art/agent-*.png)
// talking from the middle, and a supplier with a delivery tempo. Hand-placed cells on a 300 x 48 grid
// (the street drawn 12 rows down, under the sky), compiled to one path per colour per layer (runs
// merged down identical rows) so the markup stays small. Run: node scripts/build-footer-art.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const W = 300, H = 48, OY = 12;
// Palette: the v7 night (card navy into the sky above the horizon), cream, the lime accent, the moon,
// warm wood and brick for the shop, and the art set's pastel clouds.
const COLORS = {
  N: "#112A60", // sky at the top: the footer card's own navy
  n: "#133D7E", // sky
  s: "#185091", // sky above the horizon
  B: "#163A73", // far buildings
  b: "#0F2753", // dark windows, road
  W: "#D9A520", // lit windows, lamp light (gold)
  Q: "#3B5F9E", // lamp posts, shutter
  q: "#1D3566", // shutter
  G: "#2B4C8A", // kerb line, lane marks
  D: "#061431", // shadows, tyres
  C: "#F3F1E2", // cream
  M: "#A7B6D6", // muted blue-grey
  K: "#061431", // ink
  L: "#A8E27C", // lime
  l: "#6FAF4A", // lime shade
  h: "#D4F3B4", // lime light
  O: "#E3EDA6", // moon
  E: "#9B6A3C", // wood
  e: "#6B4424", // dark wood
  R: "#A4503A", // brick
  r: "#7A3826", // dark brick
  I: "#3A2418", // shop inside
  Y: "#D9A520", // dal, turmeric, sacks
  F: "#E39B3A", // saffron kurta
  T: "#2481AA", // supplier shirt and cap
  V: "#C9D84A", // tempo (yellow-green)
  g: "#4E9A35", // neem leaves
  v: "#7CC24F", // neem light
  S: "#B07A55", // skin
  H: "#2A1E18", // hair
  P: "#F2C6DA", // cloud pink, cheeks
  c: "#BFB6EA", // cloud lavender
  U: "#8FB0E6", // cloud underside
};

function layer() { return Array.from({ length: H }, () => new Array(W).fill(null)); }
const layers = { base: layer(), bubble: layer(), frameA: layer(), frameB: layer(), waveA: layer(), waveB: layer(), orb: layer() };
let L = layers.base;
const use = (name) => { L = layers[name]; };
/** Street cells sit OY rows down, under the sky; skyPx() draws the sky itself. */
function skyPx(x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) L[y][x] = c; }
function px(x, y, c) { skyPx(x, y + OY, c); }
function rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); }
/** ASCII sprite: one string per row, "." is empty, any other letter is a palette key. */
function sprite(rows, x, y) { rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") px(x + i, y + j, ch); })); }

// ---- Night sky: three bands (dithered where they meet), stars, the moon, pastel clouds ----
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const band = y < 14 ? "N" : y < 28 ? "n" : "s";
    const edge = (y === 13 || y === 27) && (x + y) % 2 === 0;
    skyPx(x, y, edge ? (y === 13 ? "n" : "s") : band);
  }
}
for (const [x, y] of [[8, 3], [31, 9], [57, 2], [83, 7], [118, 3], [141, 9], [176, 2], [198, 10], [231, 4], [252, 14], [288, 6], [66, 15], [160, 16]]) skyPx(x, y, "C");
for (const [x, y] of [[22, 5], [104, 10], [214, 7], [281, 15]]) {
  skyPx(x, y, "C"); skyPx(x - 1, y, "M"); skyPx(x + 1, y, "M"); skyPx(x, y - 1, "M"); skyPx(x, y + 1, "M");
}
// the moon, lit on its upper left, two soft craters
for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 38) skyPx(262 + x, 9 + y, x + y > 5 ? "M" : "O");
skyPx(264, 7, "M"); skyPx(265, 7, "M"); skyPx(260, 11, "M");
/** A pastel pixel cloud: cream on top, pink to the right, lavender and blue underneath. */
function cloud(x0, y0, puffs) {
  for (const [cx, cy, r] of puffs) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + r) continue;
      const k = y > r * 0.35 ? "U" : y > 0 ? "c" : x > r * 0.4 ? "P" : "C";
      skyPx(x0 + cx + x, y0 + cy + y, k);
    }
  }
}
cloud(26, 6, [[0, 2, 3], [5, 0, 4], [10, 2, 3]]);
cloud(184, 4, [[0, 2, 2], [4, 0, 3], [8, 2, 2]]);
cloud(214, 17, [[0, 1, 2], [3, 0, 3], [7, 1, 2]]);

// ---- Far street: low night buildings, some windows lit (outside the middle, so the characters read) ----
const buildings = [[0, 22, 9], [23, 16, 15], [70, 18, 12], [214, 20, 11], [258, 18, 7], [277, 23, 13]];
for (const [x, w, top] of buildings) {
  rect(x, top, w, 32 - top, "B");
  for (let j = top + 2, r = 0; j < 29; j += 4, r++) {
    for (let i = x + 2, c = 0; i < x + w - 2; i += 4, c++) if ((r + c + x) % 3 !== 0) rect(i, j, 2, 2, (r + 2 * c + x) % 4 === 0 ? "W" : "b");
  }
}

// ---- Ground: kerb line, road, lane dashes ----
rect(0, 32, W, 1, "G");
rect(0, 33, W, 3, "b");
for (let x = 4; x < W; x += 16) rect(x, 34, 6, 1, "G");

// ---- Left of the shop: a lamp post, a closed shutter next door, crates ----
rect(13, 9, 1, 23, "Q"); rect(13, 9, 5, 1, "Q"); rect(16, 10, 3, 2, "W");
rect(40, 13, 26, 19, "q");
for (let y = 15; y < 31; y += 2) rect(42, y, 22, 1, "Q");
rect(40, 11, 26, 2, "R");
rect(70, 25, 9, 7, "E"); rect(70, 27, 9, 1, "e"); rect(70, 29, 9, 1, "e");
rect(80, 27, 8, 5, "E"); rect(80, 29, 8, 1, "e");
rect(72, 21, 6, 4, "C"); rect(74, 20, 2, 1, "M"); // a rice sack on the crates

// ---- The kirana shop (x 88..136): brick front, wood posts and shelves ----
rect(88, 9, 49, 23, "R");
for (let y = 10, row = 0; y < 32; y += 3, row++) for (let x = 88 + (row % 2 ? 2 : 0); x < 137; x += 5) px(x, y, "r");
rect(92, 9, 41, 13, "I");                      // inside
rect(90, 9, 2, 23, "E"); rect(133, 9, 2, 23, "E"); // posts
// shelves and what is on them
rect(93, 13, 39, 1, "E"); rect(93, 18, 39, 1, "E");
const jars = ["Y", "C", "L", "F", "Y", "C", "L", "Y", "F", "C"];
jars.forEach((c, i) => { const x = 94 + i * 4; rect(x, 10, 3, 3, c); px(x + 1, 10, "M"); });
const sacks = ["C", "Y", "C", "Y", "C", "Y", "C"];
sacks.forEach((c, i) => { const x = 94 + i * 5 + (i > 2 ? 4 : 0); if (x > 128) return; rect(x, 15, 4, 3, c); rect(x + 1, 14, 2, 1, c); px(x + 1, 14, "M"); });
// awning: cream and lime stripes with a scalloped edge
for (let x = 88; x < 137; x++) {
  const c = Math.floor((x - 88) / 4) % 2 ? "C" : "L";
  rect(x, 4, 1, 4, c);
  if ((x - 88) % 4 === 1 || (x - 88) % 4 === 2) px(x, 8, c);
}
rect(88, 3, 49, 1, "e");
// the owner behind the counter: hair, face with a moustache and tilak, saffron kurta
sprite([
  "...HHHHHH...",
  "..HHHHHHHH..",
  "..HSSFSSSH..",
  "..SSKSSKSS..",
  "..SSSSSSSS..",
  "..SSHHHHSS..",
  "...SSSSSS...",
  ".....SS.....",
  "..FFFFFFFF..",
  ".FFFFCFFFFF.",
  "SFFFFCFFFFFS",
], 104, 11);
// counter: wood top, wood panels, one lime stripe
rect(91, 22, 43, 2, "e");
rect(92, 24, 41, 8, "E");
rect(92, 26, 41, 1, "L");
for (let x = 96; x < 132; x += 9) rect(x, 28, 5, 2, "e");
// a sweets jar and a hand balance on the counter
rect(95, 17, 5, 5, "b"); rect(95, 16, 5, 1, "M"); px(96, 19, "Y"); px(98, 20, "Y"); px(97, 18, "F");
rect(118, 15, 13, 1, "C");             // beam
rect(124, 15, 1, 7, "M");              // post
rect(121, 21, 7, 1, "M");              // base
px(119, 16, "M"); px(119, 17, "M"); rect(117, 18, 5, 1, "C"); // left pan
px(129, 16, "M"); px(129, 17, "M"); rect(127, 18, 5, 1, "C"); // right pan
rect(118, 17, 3, 1, "Y");              // dal on the left pan

// ---- The supplier, phone at the ear, facing the shop ----
sprite([
  "....TTTTT..",
  "..TTTTTTTT.",
  "...HSSSSH..",
  ".KKSKSSKS..",
  ".KSSSSSSS..",
  "..TSSSSSS..",
  "..T.SSSS...",
  "..TTTTTTT..",
  "..TTTTTTTT.",
  "..TTTTTTTTS",
  "..TTTTTTTT.",
  "..TTTTTTTT.",
  "...TTTTTT..",
  "...MMMMMM..",
  "...MM..MM..",
  "...MM..MM..",
  "...MM..MM..",
  "...MM..MM..",
  "..DDD..DDD.",
], 165, 13);

// ---- The delivery tempo (three-wheeler, cab towards the shop) with sacks of rice and dal ----
const WHEEL = [".DDDD.", "DDMMDD", "DMbbMD", "DDMMDD", ".DDDD."];
rect(180, 12, 10, 1, "V"); rect(179, 13, 12, 1, "V");
rect(178, 14, 13, 6, "V"); rect(179, 14, 10, 5, "b");
px(180, 15, "M"); px(181, 15, "M"); px(180, 16, "M");
rect(177, 20, 14, 7, "V"); rect(177, 23, 14, 1, "l");
rect(178, 21, 2, 2, "W"); rect(176, 26, 4, 1, "M");
const bedSack = (x, y, c) => { rect(x, y + 1, 7, 4, c); rect(x + 1, y, 5, 1, c); px(x + 3, y, "M"); rect(x + 1, y + 2, 5, 1, c === "C" ? "M" : "E"); };
bedSack(195, 15, "Y"); bedSack(202, 15, "C");
bedSack(192, 19, "C"); bedSack(199, 19, "Y"); bedSack(206, 19, "C");
rect(191, 18, 1, 6, "V"); rect(213, 18, 1, 6, "V");
rect(191, 23, 23, 2, "V"); rect(191, 25, 23, 1, "l");
rect(184, 26, 26, 1, "D");
sprite(WHEEL, 178, 27); sprite(WHEEL, 203, 27);

// ---- Right of the tempo: a neem tree and a lamp post ----
rect(235, 18, 3, 14, "e");
rect(229, 8, 15, 10, "g"); rect(227, 10, 19, 6, "g"); rect(231, 6, 11, 2, "g");
for (const [x, y] of [[230, 10], [236, 8], [240, 12], [233, 14], [238, 15], [243, 11]]) rect(x, y, 2, 1, "v");
rect(268, 9, 1, 23, "Q"); rect(264, 9, 5, 1, "Q"); rect(263, 10, 3, 2, "W");

// ---- Sahay: the round lime character (as public/art/agent-*.png) talking from the middle ----
use("base"); rect(145, 31, 11, 1, "D"); // its shadow on the kerb
use("bubble");
sprite([
  "..CCCCCCCCCCCCCCCCC..",
  ".CCCCCCCCCCCCCCCCCCC.",
  "CCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCC",
  "CCCCCCCCCCCCCCCCCCCCC",
  ".CCCCCCCCCCCCCCCCCCC.",
  "..CCCCCCCCCCCCCCCCC..",
  ".........CCC.........",
  "..........C..........",
], 140, 0);
use("frameA"); // the price comes down: rupee and a down arrow
sprite([
  "KKKKK.....K..",
  "...KK.....K..",
  "KKKKK.....K..",
  "..KK....KKKKK",
  "KK.......KKK.",
  ".KK.......K..",
  "..KK.........",
], 144, 2);
use("frameB"); // and the owner's yes: a check
sprite([
  "........KK",
  ".......KK.",
  "KK....KK..",
  ".KK..KK...",
  "..KKKK....",
  "...KK.....",
], 145, 2);
use("waveA"); // inner sound arcs, both sides
sprite(["..L", ".L.", ".L.", ".L.", ".L.", "..L"], 139, 16);
sprite(["L..", ".L.", ".L.", ".L.", ".L.", "L.."], 158, 16);
use("waveB"); // outer sound arcs
sprite(["..L", ".L.", "L..", "L..", "L..", "L..", ".L.", "..L"], 135, 15);
sprite(["L..", ".L.", "..L", "..L", "..L", "..L", ".L.", "L.."], 161, 15);
use("orb"); // a two-leaf sprout, a lit top-left, eyes, pink cheeks, an open mouth, a shaded rim
sprite([
  "....gv.vg....",
  "......l......",
  "....LLLLL....",
  "..LhhLLLLLL..",
  ".LhhLLLLLLLl.",
  ".LhLLLLLLLLl.",
  "LLLLKLLLKLLLl",
  "LLLLKLLLKLLLl",
  "LPPLLLLLLPPLl",
  "LLLLLLKKLLLll",
  ".LLLLLKKLLLl.",
  ".lLLLLLLLLll.",
  "..llLLLLLll..",
  "....lllll....",
], 144, 13);

// ---- Compile: per layer, per colour, horizontal runs merged down identical rows ----
function compile(grid) {
  const out = [];
  for (const [key, hex] of Object.entries(COLORS)) {
    const runs = [];
    for (let y = 0; y < H; y++) {
      let x = 0;
      while (x < W) {
        if (grid[y][x] !== key) { x++; continue; }
        const start = x;
        while (x < W && grid[y][x] === key) x++;
        runs.push({ x: start, y, w: x - start, h: 1 });
      }
    }
    const open = new Map(); const rects = [];
    for (const r of runs) {
      const k = `${r.x},${r.w}`; const prev = open.get(k);
      if (prev && prev.y + prev.h === r.y) prev.h++;
      else { const n = { ...r }; open.set(k, n); rects.push(n); }
    }
    if (rects.length) out.push(`<path fill="${hex}" d="${rects.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`).join("")}"/>`);
  }
  return out.join("");
}

const svg = [
  `<svg class="foot-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" role="img" aria-label="Pixel picture at night: a shop owner at the counter, Sahay in the middle as a small round helper, and a supplier with a delivery tempo" data-i18n-attr="aria-label:footArt">`,
  `<g>${compile(layers.base)}</g>`,
  `<g class="px-bubble">${compile(layers.bubble)}<g class="px-frame-a">${compile(layers.frameA)}</g><g class="px-frame-b">${compile(layers.frameB)}</g></g>`,
  `<g class="px-wave-a">${compile(layers.waveA)}</g>`,
  `<g class="px-wave-b">${compile(layers.waveB)}</g>`,
  `<g class="px-orb">${compile(layers.orb)}</g>`,
  `</svg>`,
].join("\n");

const file = path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(file, "utf8");
const START = "<!-- footer-art:start (scripts/build-footer-art.js) -->", END = "<!-- footer-art:end -->";
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < a) { console.error("footer-art markers not found in public/index.html"); process.exit(1); }
fs.writeFileSync(file, html.slice(0, a + START.length) + "\n" + svg + "\n" + html.slice(b));
console.log(`footer art: ${svg.length} bytes`);
