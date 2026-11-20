#!/usr/bin/env node
"use strict";
// Builds every picture in public/art from code (own work, no downloaded art). Pixel art is drawn at a
// native size and scaled up by whole numbers, so edges stay crisp. Also writes a contact sheet.
// Run: node scripts/art/build.js [--sheet <png path>] [--only <name,name>]
const fs = require("node:fs");
const path = require("node:path");
const { Canvas, text } = require("./lib/pix");
const S = require("./lib/sky");
const P = require("./lib/palette");

const OUT = path.join(__dirname, "..", "..", "public", "art");
const args = process.argv.slice(2);
const argv = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = argv("--only") ? argv("--only").split(",") : null;

/** Each entry: [file, () => Canvas (native), scale, where it goes]. */
function assets() {
  const list = [];
  const add = (file, make, scale, note) => list.push({ file, make, scale, note });
  const hero = require("./scenes/hero");
  let heroCv = null; const heroNative = () => (heroCv ||= hero.build());
  add("hero-scene-1200.png", heroNative, 2, "Hero, left side (desktop)");
  add("hero-scene-600.png", heroNative, 1, "Hero, phones (or 2x-scaled by CSS)");
  const sky = require("./scenes/skyset");
  add("moon.png", sky.moon, 2, "Big moon with soft halo (hero, night sections)");
  sky.clouds().forEach((c, i) => add(`cloud-${i + 1}.png`, () => c, 4, "Pixel cloud sprite"));
  add("cloud-band.png", sky.band, 4, "Section divider: night above, paper (#F3F1E2) below; repeat-x");
  add("cloud-band-plain.png", sky.bandPlain, 4, "Transparent cloud band; repeat-x");
  const portrait = require("./scenes/portrait");
  let pc = null; const pn = () => (pc ||= portrait.build());
  add("shop-guide-96.png", pn, 2, "SHOP GUIDE portrait (1x)");
  add("shop-guide-192.png", pn, 4, "SHOP GUIDE portrait (2x)");
  add("market-model.png", require("./scenes/market").build, 2, "About section voxel model");
  for (const extra of ["features", "steps", "builton", "billboard", "guidemap", "agent"]) {
    const f = path.join(__dirname, "scenes", extra + ".js");
    if (fs.existsSync(f)) for (const a of require(f).assets()) add(...a);
  }
  return list;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const a of assets()) {
    if (only && !only.some((o) => a.file.startsWith(o))) continue;
    const t = Date.now();
    const cv = a.make();
    const big = a.scale > 1 ? cv.scale(a.scale) : cv;
    const buf = big.png();
    fs.writeFileSync(path.join(OUT, a.file), buf);
    done.push({ ...a, cv, big, kb: Math.round(buf.length / 102.4) / 10 });
    console.log(`${a.file.padEnd(28)} ${String(big.w + "x" + big.h).padEnd(10)} ${String(Math.round(buf.length / 1024) + " KB").padEnd(8)} ${Date.now() - t} ms`);
  }
  const sheet = argv("--sheet");
  if (sheet) { fs.mkdirSync(path.dirname(sheet), { recursive: true }); fs.writeFileSync(sheet, contactSheet(done).png()); console.log("sheet ->", sheet); }
}

/** Contact sheet: every asset at its shipped size (capped), on a night or paper tile, labelled. */
function contactSheet(done) {
  const W = 1600, pad = 16, tiles = [];
  for (const d of done) {
    let img = d.big; let k = 1;
    while (img.w / k > 620 || img.h / k > 480) k++;
    if (k > 1) img = d.cv.scale(Math.max(1, Math.floor(d.scale / k)) || 1);
    tiles.push({ d, img });
  }
  // row packing
  let x = pad, y = pad, rowH = 0; const placed = [];
  for (const t of tiles) {
    const w = t.img.w + 12, h = t.img.h + 30;
    if (x + w > W - pad) { x = pad; y += rowH + pad; rowH = 0; }
    placed.push({ ...t, x, y, w, h }); x += w + pad; rowH = Math.max(rowH, h);
  }
  const cv = new Canvas(W, y + rowH + pad);
  cv.rect(0, 0, cv.w, cv.h, "#081634");
  for (const p of placed) {
    const paper = /market|guidemap/.test(p.d.file);
    const tile = new Canvas(p.w, p.h - 18);
    if (paper && !/step-/.test(p.d.file)) tile.rect(0, 0, tile.w, tile.h, P.paper); else S.bands(tile, P.night, P.blue, 8);
    cv.blit(tile, p.x, p.y);
    cv.blit(p.img, p.x + 6, p.y + 6);
    text(cv, `${p.d.file.replace(".png", "")} ${p.d.big.w}x${p.d.big.h} ${Math.round(p.d.kb)}KB`, p.x, p.y + p.h - 12, P.cream, 2);
  }
  return cv;
}
main();
