#!/usr/bin/env node
// Builds the landing footer's pixel picture (public/index.html, between the footer-art markers):
// a kirana counter with its owner, Sahay as a small speaker orb talking between them, and a supplier
// with a delivery tempo. Hand-placed cells on a 300 x 36 grid, compiled to one path per colour per
// layer (runs merged across rows) so the markup stays small. Run: node scripts/build-footer-art.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const W = 300, H = 36;
// Palette: the site's warm black, cream and creamy pink, plus three muted accents (ochre, sage, skin).
const COLORS = {
  C: "#F8ECE8", // cream
  P: "#F2CFC6", // creamy pink
  E: "#C99A8F", // pink edge
  M: "#8E7D7A", // muted
  G: "#3A3033", // mid dark
  D: "#2A2427", // surface
  B: "#1F191B", // far buildings
  W: "#3E2F31", // dim windows
  K: "#2A1A1C", // ink on cream
  Y: "#C9A25E", // ochre (dal, turmeric)
  V: "#8FA58A", // sage (tempo, cap)
  S: "#A9745E", // skin
};

function layer() { return Array.from({ length: H }, () => new Array(W).fill(null)); }
const layers = { base: layer(), bubble: layer(), frameA: layer(), frameB: layer(), waveA: layer(), waveB: layer(), orb: layer() };
let L = layers.base;
const use = (name) => { L = layers[name]; };
function px(x, y, c) { if (x >= 0 && x < W && y >= 0 && y < H) L[y][x] = c; }
function rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); }
/** ASCII sprite: one string per row, "." is empty, any other letter is a palette key. */
function sprite(rows, x, y) { rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== ".") px(x + i, y + j, ch); })); }

// ---- Far street: low buildings with dim windows (outside the middle, so the characters read) ----
const buildings = [[0, 22, 9], [23, 16, 15], [70, 18, 12], [214, 20, 11], [258, 18, 7], [277, 23, 13]];
for (const [x, w, top] of buildings) {
  rect(x, top, w, 32 - top, "B");
  for (let j = top + 2, r = 0; j < 29; j += 4, r++) {
    for (let i = x + 2, c = 0; i < x + w - 2; i += 4, c++) if ((r + c + x) % 3 !== 0) rect(i, j, 2, 2, "W");
  }
}

// ---- Ground: kerb line, road, lane dashes ----
rect(0, 32, W, 1, "G");
rect(0, 33, W, 3, "D");
for (let x = 4; x < W; x += 16) rect(x, 34, 6, 1, "G");

// ---- Left of the shop: a lamp post, a closed shutter next door, crates ----
rect(13, 9, 1, 23, "G"); rect(13, 9, 5, 1, "G"); rect(16, 10, 3, 2, "Y");
rect(40, 13, 26, 19, "D");
for (let y = 15; y < 31; y += 2) rect(42, y, 22, 1, "G");
rect(40, 11, 26, 2, "M");
rect(70, 25, 9, 7, "E"); rect(70, 27, 9, 1, "G"); rect(70, 29, 9, 1, "G");
rect(80, 27, 8, 5, "E"); rect(80, 29, 8, 1, "G");
rect(72, 21, 6, 4, "C"); rect(74, 20, 2, 1, "M"); // a rice sack on the crates

// ---- The kirana shop (x 88..136) ----
rect(92, 9, 41, 13, "D");                      // inside wall
rect(90, 9, 2, 23, "E"); rect(133, 9, 2, 23, "E"); // posts
// shelves and what is on them
rect(93, 13, 39, 1, "E"); rect(93, 18, 39, 1, "E");
const jars = ["Y", "C", "V", "P", "Y", "C", "V", "Y", "P", "C"];
jars.forEach((c, i) => { const x = 94 + i * 4; rect(x, 10, 3, 3, c); px(x + 1, 10, "M"); });
const sacks = ["C", "Y", "C", "Y", "C", "Y", "C"];
sacks.forEach((c, i) => { const x = 94 + i * 5 + (i > 2 ? 4 : 0); if (x > 128) return; rect(x, 15, 4, 3, c); rect(x + 1, 14, 2, 1, c); px(x + 1, 14, "M"); });
// awning: cream and pink stripes with a scalloped edge
for (let x = 88; x < 137; x++) {
  const c = Math.floor((x - 88) / 4) % 2 ? "C" : "P";
  rect(x, 4, 1, 4, c);
  if ((x - 88) % 4 === 1 || (x - 88) % 4 === 2) px(x, 8, c);
}
rect(88, 3, 49, 1, "E");
// the owner behind the counter: hair, face with a moustache, cream kurta
sprite([
  "...GGGGGG...",
  "..GGGGGGGG..",
  "..GSSSSSSG..",
  "..SSKSSKSS..",
  "..SSSSSSSS..",
  "..SSGGGGSS..",
  "...SSSSSS...",
  ".....SS.....",
  "..CCCCCCCC..",
  ".CCCCCCCCCC.",
  "SCCCCCCCCCCS",
], 104, 11);
// counter
rect(91, 22, 43, 2, "E");
rect(92, 24, 41, 8, "G");
rect(92, 26, 41, 1, "P");
for (let x = 96; x < 132; x += 9) rect(x, 28, 5, 2, "D");
// a sweets jar and a hand balance on the counter
rect(95, 17, 5, 5, "W"); rect(95, 16, 5, 1, "P"); px(96, 19, "Y"); px(98, 20, "Y"); px(97, 18, "P");
rect(118, 15, 13, 1, "C");             // beam
rect(124, 15, 1, 7, "M");              // post
rect(121, 21, 7, 1, "M");              // base
px(119, 16, "M"); px(119, 17, "M"); rect(117, 18, 5, 1, "C"); // left pan
px(129, 16, "M"); px(129, 17, "M"); rect(127, 18, 5, 1, "C"); // right pan
rect(118, 17, 3, 1, "Y");              // dal on the left pan

// ---- The supplier, phone at the ear, facing the shop ----
sprite([
  "....VVVVV..",
  "..VVVVVVVV.",
  "...GSSSSG..",
  ".DDSKSSKS..",
  ".DSSSSSSS..",
  "..YSSSSSS..",
  "..Y.SSSS...",
  "..YYYYYYY..",
  "..YYYYYYYY.",
  "..YYYYYYYYS",
  "..YYYYYYYY.",
  "..YYYYYYYY.",
  "...YYYYYY..",
  "...MMMMMM..",
  "...MM..MM..",
  "...MM..MM..",
  "...MM..MM..",
  "...MM..MM..",
  "..GGG..GGG.",
], 165, 13);

// ---- The delivery tempo (three-wheeler, cab towards the shop) with sacks of rice and dal ----
const WHEEL = [".GGGG.", "GGMMGG", "GMDDMG", "GGMMGG", ".GGGG."];
rect(180, 12, 10, 1, "V"); rect(179, 13, 12, 1, "V");
rect(178, 14, 13, 6, "V"); rect(179, 14, 10, 5, "B");
px(180, 15, "M"); px(181, 15, "M"); px(180, 16, "M");
rect(177, 20, 14, 7, "V"); rect(177, 23, 14, 1, "E");
rect(178, 21, 2, 2, "C"); rect(176, 26, 4, 1, "M");
const bedSack = (x, y, c) => { rect(x, y + 1, 7, 4, c); rect(x + 1, y, 5, 1, c); px(x + 3, y, "M"); rect(x + 1, y + 2, 5, 1, c === "C" ? "P" : "E"); };
bedSack(195, 15, "Y"); bedSack(202, 15, "C");
bedSack(192, 19, "C"); bedSack(199, 19, "Y"); bedSack(206, 19, "C");
rect(191, 18, 1, 6, "V"); rect(213, 18, 1, 6, "V");
rect(191, 23, 23, 2, "V"); rect(191, 25, 23, 1, "G");
rect(184, 26, 26, 1, "G");
sprite(WHEEL, 178, 27); sprite(WHEEL, 203, 27);

// ---- Right of the tempo: a neem tree and a lamp post ----
rect(235, 18, 3, 14, "E");
rect(229, 8, 15, 10, "V"); rect(227, 10, 19, 6, "V"); rect(231, 6, 11, 2, "V");
for (const [x, y] of [[230, 10], [236, 8], [240, 12], [233, 14], [238, 15], [243, 11]]) rect(x, y, 2, 1, "G");
rect(268, 9, 1, 23, "G"); rect(264, 9, 5, 1, "G"); rect(263, 10, 3, 2, "Y");

// ---- Sahay: a small speaker orb that floats between them, its words in a bubble ----
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
sprite(["..P", ".P.", ".P.", ".P.", ".P.", "..P"], 139, 16);
sprite(["P..", ".P.", ".P.", ".P.", ".P.", "P.."], 158, 16);
use("waveB"); // outer sound arcs
sprite(["..P", ".P.", "P..", "P..", "P..", "P..", ".P.", "..P"], 135, 15);
sprite(["P..", ".P.", "..P", "..P", "..P", "..P", ".P.", "P.."], 161, 15);
use("orb");
sprite([
  "....PPPPP....",
  "..PPPPPPPPP..",
  ".PPCCPPPPPPP.",
  ".PCCPPPPPPPP.",
  "PPCPPPPPPPPPP",
  "PPPPEPEPEPPPP",
  "PPPEPEPEPEPPP",
  "PPPPEPEPEPPPE",
  "PPPPPPPPPPPPE",
  ".PPPPPPPPPPE.",
  ".PPPPPPPPPEE.",
  "..PEPPPPPEE..",
  "....EEEEE....",
], 144, 14);

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
  `<svg class="foot-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" role="img" aria-label="Pixel picture: a shop owner at the counter, Sahay in the middle as a small speaker, and a supplier with a delivery tempo" data-i18n-attr="aria-label:footArt">`,
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
