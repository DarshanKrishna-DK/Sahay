"use strict";
// Seven voxel sprites for the "What Sahay does" cards: Buy, Sell, Stock, Khata, Money, Rules, Suppliers.
const { Vox, render } = require("../lib/voxel");
const { Canvas } = require("../lib/pix");
const V = require("../lib/props");
const P = require("../lib/palette");

const flat = (c) => ({ c, flat: true });

function buy() {
  const v = new Vox();
  V.sack(v, 0, 0, 0, P.rice, P.rice, 5, 5, 7);
  V.sack(v, 0, 6, 0, P.dal, P.dal, 4, 4, 5, P.red);
  V.platformScale(v, 6, 1, 0);
  V.sack(v, 6, 1, 2, P.wheat, P.wheat, 4, 4, 3, P.woodDark);
  v.set(4, 6, 0, P.dal); v.set(5, 7, 0, P.dal); v.set(4, 8, 0, P.dal);
  return v;
}

function sell() {
  const v = new Vox();
  // a printed bill standing up, zigzag foot, ink lines and a total
  for (let x = 0; x < 7; x++) for (let z = 0; z < 11; z++) {
    if (z === 0 && x % 2) continue;
    let c = P.white;
    if (z >= 3 && z <= 8 && x >= 1 && x <= 5 && z % 2 === 0) c = x === 5 ? P.ink : "#9FB0CF";
    if (z === 9 && x >= 2 && x <= 4) c = P.ink;
    if (z === 2 && x >= 3 && x <= 5) c = P.blue;
    v.set(x, 4, z, flat(c));
  }
  v.box(0, 3, 0, 7, 1, 11, P.paper2);
  // a chat bubble with three dots, no brand
  const bx = 6, bz = 9;
  for (let x = 0; x < 8; x++) for (let z = 0; z < 6; z++) {
    if ((x === 0 || x === 7) && (z === 0 || z === 5)) continue;
    v.set(bx + x, 1, bz + z, flat(P.lime));
    v.set(bx + x, 0, bz + z, flat("#7FBF5A"));
  }
  v.set(bx + 1, 1, bz - 1, flat(P.lime)); v.set(bx, 1, bz - 2, flat(P.lime));
  for (const x of [2, 4, 6]) v.set(bx + x - 0.5, 2, bz + 2, flat(P.night));
  // a rupee coin
  v.box(9, 6, 0, 3, 3, 1, P.gold); v.set(10, 7, 1, "#F2C94C");
  return v;
}

function stock() {
  const v = new Vox(); const W = 11, D = 3, H = 12;
  v.box(0, 0, 0, 1, D, H, P.wood); v.box(W - 1, 0, 0, 1, D, H, P.wood); v.box(0, 0, 0, W, 1, H, P.woodDark);
  for (const z of [0, 4, 8, 12]) v.box(0, 0, z, W, D, 1, P.wood2);
  const jar = (x, z, fill, lid) => { v.box(x, 1, z, 2, 2, 2, fill); v.box(x, 1, z + 2, 2, 2, 1, lid); };
  jar(1, 1, P.dal, P.red); jar(4, 1, P.rice, P.blue); jar(7, 1, "#C2552F", P.lime);
  jar(1, 5, "#7FC8C0", P.gold); v.box(4, 1, 5, 1, 2, 3, P.red); v.box(5, 1, 5, 1, 2, 3, P.tempo); v.box(6, 1, 5, 1, 2, 2, P.kurta2); jar(7, 5, P.wheat, P.red);
  for (let x = 1; x < W - 1; x++) v.box(x, 1, 9, 1, 2, 1 + (x % 3 === 0 ? 2 : 1), [P.mango, P.pinkWall, P.tempo2, P.rice][x % 4]);
  return v;
}

function khata() {
  const v = new Vox(); const W = 12, D = 9;
  // red cloth-bound bahi-khata: covers, cream page block, gold tie
  v.box(0, 0, 0, W, D, 1, P.red);
  v.box(1, 0, 1, W - 1, D - 1, 3, (x, y, z) => (y === D - 2 || x === W - 1 ? (z % 2 ? P.paper2 : P.paper) : P.paper));
  v.box(0, 0, 4, W, D, 1, P.red);
  v.box(0, 0, 0, 1, D, 5, "#9E3428");
  for (let x = 0; x < W; x++) v.set(x, 4, 5, P.gold);
  for (let y = 0; y < D; y++) v.set(5, y, 5, P.gold);
  v.set(5, 4, 6, P.gold); v.set(6, 5, 6, P.gold); v.set(4, 6, 5, P.gold); v.set(3, 7, 5, P.gold);
  // a swastika-free plain label patch and a pen on top
  v.box(7, 1, 5, 4, 2, 1, P.cream);
  v.box(2, 1, 6, 9, 1, 1, P.ink); v.set(1, 1, 6, P.steel); v.set(11, 1, 6, P.gold);
  return v;
}

function money() {
  const v = new Vox();
  // steel cash box with the lid open and notes inside
  v.box(0, 0, 0, 9, 7, 4, P.steel2);
  v.box(1, 1, 3, 7, 5, 1, "#3C4660");
  v.box(1, 1, 3, 3, 5, 1, "#6DBE8C"); v.box(4, 1, 3, 2, 5, 1, "#E6A0C4"); v.box(6, 1, 3, 2, 5, 1, "#B9A2E6");
  v.box(0, -1, 4, 9, 1, 6, P.steel); v.set(4, -1, 7, P.gold);
  v.box(3, 6, 1, 3, 1, 1, P.tank); v.set(4, 7, 2, P.gold);
  // stacks of coins
  const stack = (x, y, h) => { for (let z = 0; z < h; z++) v.box(x, y, z, 2, 2, 1, z % 2 ? P.gold : "#F2C94C"); };
  stack(10, 3, 5); stack(10, 6, 3); stack(7, 9, 2); v.box(12, 7, 0, 2, 2, 1, P.gold);
  return v;
}

function rules() {
  const v = new Vox(); const W = 12, D = 10;
  // an open notebook lying flat, blue cover, lined pages, spiral down the middle
  v.box(0, 0, 0, W, D, 1, P.kurta2);
  v.box(0, 1, 1, W, D - 2, 1, (x, y) => (x === 5 || x === 6 ? P.paper2 : y % 2 === 0 && x > 0 && x < W - 1 ? "#B9C5DC" : P.paper));
  for (let y = 1; y < D - 1; y += 2) { v.set(5, y, 2, P.steel); v.set(6, y, 2, P.steel); }
  v.set(2, 2, 1, P.red); v.set(3, 2, 1, P.red); v.set(8, 6, 1, P.lime); v.set(9, 6, 1, P.lime);
  // pencil lying across the right page
  v.box(4, 7, 2, 7, 1, 1, P.ochre); v.set(11, 7, 2, P.pinkWall); v.set(3, 7, 2, P.plaster); v.set(2, 7, 2, "#2A1D1A");
  // a tick on the left page
  v.set(1, 5, 2, flat(P.lime)); v.set(2, 6, 2, flat(P.lime)); v.set(3, 5, 2, flat(P.lime)); v.set(4, 4, 2, flat(P.lime));
  return v;
}

function suppliers() { return V.tempo(); }

const ITEMS = { buy, sell, stock, khata, money, rules, suppliers };
function sprite(name) { const cv = render(ITEMS[name]()).cv.trim(); return cv.place(100, 80, "bottom", 1); }

function assets() {
  const out = [];
  for (const name of Object.keys(ITEMS)) {
    let c = null; const mk = () => (c ||= sprite(name));
    out.push([`feature-${name}.png`, mk, 2, `What Sahay does card: ${name} (200x160)`]);
    out.push([`feature-${name}@2x.png`, mk, 4, `What Sahay does card: ${name} (2x)`]);
  }
  return out;
}
module.exports = { assets, ITEMS };
