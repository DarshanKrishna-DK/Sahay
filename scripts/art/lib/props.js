"use strict";
// Voxel props shared by every Sahay scene. Axes: x runs to the screen's lower right, y to the lower
// left, z up. Fronts face +y (the lit left face) unless a prop is added with {swap:true}.
const { Vox } = require("./voxel");
const { rng, hash3, mix } = require("./pix");
const P = require("./palette");

const pick = (h, arr) => arr[Math.min(arr.length - 1, Math.floor(h * arr.length))];

/** Floating island: grass top at z=0, dirt lip, then a jagged stone cone hanging below with vines. */
function island(v, cx, cy, R, depth, seed, o = {}) {
  const r = rng(seed); const ph = [r() * 6, r() * 6, r() * 6];
  const rad = (a) => R * (1 + 0.07 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 5 + ph[1]) + 0.03 * Math.sin(a * 9 + ph[2]));
  const flowers = o.flowers ?? 0.008, ry = o.ry ?? 1;
  for (let x = Math.floor(cx - R * 1.3); x <= cx + R * 1.3; x++) for (let y = Math.floor(cy - R * 1.3 * ry); y <= cy + R * 1.3 * ry; y++) {
    const dx = x - cx, dy = (y - cy) / ry, d = Math.hypot(dx, dy), rr = rad(Math.atan2(dy, dx));
    if (d > rr) continue;
    const t = d / rr, h = hash3(x, y, 0, seed), h2 = hash3(x, y, 1, seed);
    const gc = h < 0.12 ? P.grassHi : h < 0.5 ? P.grass : h < 0.85 ? P.grass2 : P.grass3;
    v.set(x, y, 0, gc);
    v.set(x, y, -1, t > 0.82 || h2 < 0.3 ? P.grass2 : P.dirt);
    v.set(x, y, -2, h2 < 0.5 ? P.dirt : P.dirt2);
    v.set(x, y, -3, P.dirt2);
    const spike = hash3(x, y, 6, seed) < 0.12 ? 2 + Math.floor(hash3(x, y, 7, seed) * 4) : 0;
    const dd = Math.round(3 + spike + depth * Math.pow(1 - t, o.taper ?? 0.6) * (0.75 + 0.5 * hash3(x >> 1, y >> 1, 2, seed)));
    for (let z = -4; z >= -dd; z--) {
      const q = -z / (depth + 3), hz = hash3(x, y, z, seed);
      const sc = q < 0.25 ? (hz < 0.5 ? P.dirt2 : P.stone) : q < 0.5 ? (hz < 0.2 ? P.dirt2 : P.stone) : q < 0.75 ? (hz < 0.5 ? P.stone2 : P.stone) : hz < 0.5 ? P.stone3 : P.stone2;
      v.set(x, y, z, sc);
    }
    if (t > 0.8 && h2 > 0.72) { const len = 1 + Math.floor(hash3(x, y, 3, seed) * (o.vines ?? 6)); for (let z = -1; z >= -len; z--) v.set(x, y, z, hash3(x, y, z, 9) < 0.5 ? P.grass2 : P.grass3); }
    if (t < 0.92 && h > 0.985 - flowers) v.set(x, y, 1, pick(hash3(x, y, 4, seed), ["#F4F1E6", "#F6C8D6", "#F2D16B", "#C9C2F0"]));
  }
  return v;
}

/** Small bush. */
function bush(v, x, y, z, s = 2, c = P.leaf2) { for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) for (let k = 0; k < s; k++) if (i + j + k < s + 1) v.set(x + i, y + j, z + k, k === s - 1 ? P.leaf3 : c); }

/** A chibi person facing +y. Origin = left foot. */
function person(o = {}) {
  const v = new Vox();
  const shirt = o.shirt || P.kurta, pants = o.pants || P.dhoti, skin = o.skin || P.skin, hair = o.hair || P.hair;
  v.box(0, 0, 0, 1, 2, 2, pants); v.box(2, 0, 0, 1, 2, 2, pants);
  if (o.sari) v.box(0, 0, 0, 3, 2, 2, pants);
  v.set(0, 1, 0, "#3A2A22"); v.set(2, 1, 0, "#3A2A22");
  v.box(0, 0, 2, 3, 2, 3, shirt);
  if (o.collar) v.set(1, 1, 4, o.collar);
  v.box(-1, 0, 3, 1, 2, 2, shirt); v.set(-1, 1, 2, skin);
  if (o.armUp === "R") { v.box(3, 1, 4, 1, 1, 2, shirt); v.set(3, 1, 6, skin); }
  else if (o.armOut === "R") { v.box(3, 0, 3, 1, 2, 2, shirt); v.set(3, 2, 4, skin); v.set(3, 1, 4, shirt); }
  else { v.box(3, 0, 3, 1, 2, 2, shirt); v.set(3, 1, 2, skin); }
  v.box(0, -1, 5, 3, 3, 3, skin);
  v.box(0, -1, 8, 3, 3, 1, hair); v.box(0, -1, 5, 3, 1, 3, hair); v.set(0, 0, 7, hair); v.set(2, 0, 7, hair);
  if (o.long) { v.box(0, -1, 3, 3, 1, 2, hair); v.set(0, 0, 5, hair); v.set(2, 0, 5, hair); }
  v.set(0, 1, 6, { c: skin, dot: "#1A1418" }); v.set(2, 1, 6, { c: skin, dot: "#1A1418" });
  if (o.moustache) v.set(1, 1, 5, { c: skin, dot: "#2A1D1A", dotShape: "dash" });
  if (o.bindi) v.set(1, 1, 7, P.red);
  if (o.cap) { v.box(0, -1, 9, 3, 3, 1, o.cap); v.box(0, 2, 8, 3, 1, 1, o.cap); }
  if (o.phone) { v.set(3, 1, 6, skin); v.set(3, 1, 7, P.tank); v.set(3, 0, 7, P.tank); }
  if (o.dupatta) { v.box(-1, 0, 4, 1, 2, 1, o.dupatta); v.box(0, 1, 4, 3, 1, 1, o.dupatta); }
  return v;
}

/** Sack with a striped band, a folded rim and a mound of grain on top. Origin = back-left-bottom. */
function sack(v, x, y, z, c = P.rice, fill = P.rice, w = 3, d = 3, h = 3, stripe = P.riceStripe) {
  const rim = mix(c, "#5A4030", 0.18);
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) for (let k = 0; k < h; k++) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === d - 1, corner = (i === 0 || i === w - 1) && (j === 0 || j === d - 1);
    if (corner && (k === h - 1 || k === 0) && w > 2) continue;
    let col = c;
    if (stripe && h > 3 && k === Math.floor(h / 2) && edge) col = stripe;
    if (k === h - 1 && edge) col = rim;
    if (k === h - 1 && !edge) col = fill;
    v.set(x + i, y + j, z + k, col);
  }
  const fillHi = mix(fill, "#FFFFFF", 0.2);
  if (w >= 3 && d >= 3) for (let i = 1; i < w - 1; i++) for (let j = 1; j < d - 1; j++) if (w < 5 || (i > 1 && j > 1 && i < w - 2 && j < d - 2) || (i + j) % 2 === 0) v.set(x + i, y + j, z + h, fillHi);
}

/** Indian kirana shop: open front (+y), striped awning, Devanagari-like sign, shelves, counter, roof tank. */
function shop(v, x0, y0, z0, o = {}) {
  const w = o.w || 14, d = o.d || 9, H = 12;
  const wall = o.wall || P.teal, skirt = o.skirt || P.terracotta, sign = o.sign || P.blue;
  const yF = y0 + d - 1;
  v.box(x0 - 1, y0 - 1, z0, w + 2, d + 3, 1, (x, y) => (hash3(x, y, 5) < 0.5 ? "#A3A19A" : "#93938F"));
  v.box(x0 + 1, yF + 3, z0, w - 2, 1, 1, "#85868A");
  const wc = (x, y, z) => (z <= z0 + 2 ? skirt : wall);
  v.box(x0, y0, z0 + 1, w, 1, H, wc);
  v.box(x0, y0, z0 + 1, 1, d, H, wc);
  v.box(x0 + w - 1, y0, z0 + 1, 1, d, H, wc);
  v.box(x0, yF, z0 + 9, w, 1, 4, wall);
  v.box(x0 + w - 1, y0 + 2, z0 + 5, 1, 3, 3, (x, y, z) => ((y + z) % 2 ? { c: P.window, glow: true } : P.woodDark));
  v.box(x0 + 1, y0 + 1, z0 + 1, w - 2, d - 2, 1, "#6B5442");
  v.box(x0 + 1, y0 + 1, z0 + 2, w - 2, 1, 9, "#E8C78A");
  const goods = [P.red, P.dal, P.rice, "#7FC8C0", P.tempo2, P.kurta2, P.mango, "#E58FA5", P.wheat];
  for (let x = x0 + 1; x < x0 + w - 1; x++) for (const zz of [z0 + 5, z0 + 8]) {
    const h = hash3(x, zz, 1, 3); if (h < 0.12) continue;
    v.set(x, y0 + 2, zz, pick(h, goods)); if (h > 0.45) v.set(x, y0 + 2, zz + 1, pick(hash3(x, zz, 2, 3), goods));
  }
  v.box(x0 + 1, y0 + 2, z0 + 4, w - 2, 1, 1, P.wood2); v.box(x0 + 1, y0 + 2, z0 + 7, w - 2, 1, 1, P.wood2);
  v.set(x0 + (w >> 1), y0 + 4, z0 + 10, { c: P.lamp, glow: true });
  // counter: blue front panel, lighter top, gap at the right end
  v.box(x0 + 1, yF, z0 + 1, w - 4, 1, 3, (x, y, z) => (z === z0 + 1 ? P.woodDark : P.kurta2));
  v.box(x0 + 1, yF - 1, z0 + 1, w - 4, 1, 3, P.wood);
  v.box(x0 + 1, yF - 1, z0 + 4, w - 4, 2, 1, P.wood2);
  for (const [i, c] of [[1, P.mango], [3, P.red], [5, "#7FC8C0"]]) { v.set(x0 + i, yF, z0 + 5, c); v.set(x0 + i, yF, z0 + 6, P.steel); }
  const sx = x0 + w - 7;
  v.set(sx + 1, yF - 1, z0 + 5, P.steel2); v.set(sx + 1, yF - 1, z0 + 6, P.steel2); v.box(sx - 1, yF - 1, z0 + 7, 5, 1, 1, P.steel);
  v.set(sx - 1, yF, z0 + 5, P.steel); v.set(sx + 3, yF, z0 + 5, P.steel); v.set(sx - 1, yF, z0 + 6, P.dal);
  // sign board: cream shirorekha with hanging strokes
  v.box(x0 + 1, yF + 1, z0 + 9, w - 2, 1, 4, { c: sign, flat: true });
  for (let x = x0 + 2; x < x0 + w - 2; x++) v.set(x, yF + 1, z0 + 11, { c: P.cream, flat: true });
  for (let x = x0 + 2; x < x0 + w - 2; x++) { const h = hash3(x, 0, 0, 11); if (h < 0.55) v.set(x, yF + 1, z0 + 10, { c: P.cream, flat: true }); if (h < 0.2) v.set(x, yF + 1, z0 + 12, { c: P.lime, flat: true }); }
  // striped awning
  for (let x = x0; x < x0 + w; x++) {
    const c = Math.floor((x - x0) / 2) % 2 ? P.awnCream : P.awnRed;
    v.set(x, yF + 2, z0 + 8, c); v.set(x, yF + 3, z0 + 7, c);
    if ((x - x0) % 2 === 0) v.set(x, yF + 3, z0 + 6, c);
  }
  // sachet strips hanging in front
  for (const [i, c1, c2] of [[2, P.red, P.dal], [5, P.kurta2, P.mango], [w - 4, "#E58FA5", P.tempo2]]) for (let z = z0 + 5; z <= z0 + 7; z++) v.set(x0 + i, yF + 2, z, z % 2 ? c1 : c2);
  // roof, parapet, black water tank, small dish
  v.box(x0, y0, z0 + 13, w, d, 1, P.plaster);
  for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + d; y++) if (x === x0 || y === y0 || x === x0 + w - 1 || y === yF) v.set(x, y, z0 + 14, P.plaster2);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) { if ((x === 0 || x === 2) && (y === 0 || y === 2)) continue; v.box(x0 + 2 + x, y0 + 1 + y, z0 + 14, 1, 1, 3, P.tank); }
  v.set(x0 + 3, y0 + 2, z0 + 17, "#3A3B45");
  v.set(x0 + w - 3, y0 + 2, z0 + 15, P.steel2); v.box(x0 + w - 4, y0 + 2, z0 + 16, 2, 1, 2, P.steel);
  return { w, d, yF };
}

/** Delivery tempo (three-wheeler): cab at +x, profile on the +y side. */
function tempo(o = {}) {
  const v = new Vox(); const body = o.body || P.tempo, bed = o.bed || P.tempo2;
  v.box(0, 0, 2, 11, 7, 1, "#3A3540");
  v.box(0, 0, 3, 11, 1, 2, bed); v.box(0, 6, 3, 11, 1, 2, bed); v.box(0, 0, 3, 1, 7, 2, bed);
  for (let x = 1; x < 11; x += 3) v.set(x, 6, 4, P.tempo);
  v.box(11, 1, 2, 4, 5, 3, body);
  v.box(15, 2, 2, 2, 3, 3, body); v.set(17, 3, 3, { c: P.lamp, glow: true }); v.set(16, 3, 5, body);
  v.box(15, 1, 5, 1, 5, 3, (x, y, z) => (y === 1 || y === 5 || z === 7 ? body : P.glass));
  v.box(11, 1, 5, 1, 1, 3, P.canopy); v.box(11, 5, 5, 1, 1, 3, P.canopy);
  v.box(10, 0, 8, 7, 7, 1, body); v.box(11, 1, 9, 5, 5, 1, o.roof || P.canopy);
  v.box(12, 2, 5, 2, 3, 1, "#5A3A2A");
  const wheel = (x, y) => { v.box(x, y, 0, 3, 1, 3, P.tyre); v.set(x + 1, y, 1, P.hub); };
  wheel(2, 7); wheel(2, -1); wheel(14, 3);
  if (o.load !== false) {
    sack(v, 1, 1, 3, P.rice, P.rice, 3, 2, 3); sack(v, 4, 1, 3, P.dal, P.dal, 3, 2, 3, P.red);
    sack(v, 1, 3, 3, P.dal, P.dal, 3, 3, 3, P.red); sack(v, 4, 3, 3, P.rice, P.rice, 3, 3, 3);
    sack(v, 7, 2, 3, P.wheat, P.wheat, 3, 3, 3, P.woodDark); sack(v, 2, 2, 6, P.rice, P.rice, 3, 3, 2);
  }
  return v;
}

/** Vegetable hand cart (thela) with piles of produce; long side along x, wheels on the +y side. */
function cart(v, x, y, z) {
  v.box(x, y, z + 3, 9, 5, 1, P.wood2); v.box(x, y, z + 4, 9, 1, 1, P.wood); v.box(x, y + 4, z + 4, 9, 1, 1, P.wood);
  v.box(x - 3, y + 1, z + 3, 3, 1, 1, P.wood); v.box(x - 3, y + 3, z + 3, 3, 1, 1, P.wood);
  for (const yy of [y - 1, y + 5]) { v.box(x + 3, yy, z, 3, 1, 3, P.tyre); v.set(x + 4, yy, z + 1, P.hub); }
  v.box(x + 1, y + 1, z, 1, 1, 3, P.woodDark); v.box(x + 7, y + 3, z, 1, 1, 3, P.woodDark);
  const piles = [["#D8452F", "#E25B4A"], ["#4E9F45", "#6CBB45"], [P.mango, "#F5C04A"], ["#8A3E7A", "#A3508F"]];
  piles.forEach(([a, b], i) => { const px = x + 1 + (i % 2) * 4, py = y + 1 + Math.floor(i / 2) * 2; v.box(px, py, z + 4, 3, 2, 1, (X, Y) => ((X + Y) % 2 ? a : b)); v.set(px + 1, py, z + 5, b); });
}

/** Mango (default) or neem tree. Origin = trunk base. */
function tree(v, x, y, z, o = {}) {
  const seed = o.seed || 1, s = o.s || 1, th = Math.round((o.trunk || 6) * s);
  const leaves = o.neem ? ["#4E9F45", "#68B54E", "#8BCB5C"] : [P.leaf, P.leaf2, P.leaf3];
  v.box(x, y, z, 2, 2, th, P.trunk);
  v.set(x - 1, y, z, P.trunk); v.set(x + 2, y + 1, z, P.trunk);
  for (let k = 0; k < 3; k++) { v.set(x - 1 - k, y, z + th - 2 + k, P.trunk); v.set(x + 2 + k, y + 1, z + th - 1 + k, P.trunk); }
  const R = 5 * s, cz = z + th + 3 * s;
  const blobs = [[0, 0, 0, R], [-3 * s, 0, -1 * s, R * 0.7], [3 * s, 1, -1 * s, R * 0.7], [0, -3 * s, -1, R * 0.65], [0, 3 * s, 0, R * 0.65], [0, 0, 3 * s, R * 0.6]];
  const rr = Math.ceil(R + 4 * s);
  for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) for (let k = -rr; k <= rr; k++) {
    let inside = false;
    for (const [bx, by, bz, br] of blobs) if ((i - bx) ** 2 + (j - by) ** 2 + ((k - bz) * 1.15) ** 2 <= br * br) { inside = true; break; }
    if (!inside) continue;
    const h = hash3(x + i, y + j, cz + k, seed);
    if (h < 0.06) continue;
    const up = k / R;
    let c = up > 0.45 ? (h < 0.6 ? leaves[2] : leaves[1]) : up > -0.1 ? (h < 0.35 ? leaves[2] : h < 0.8 ? leaves[1] : leaves[0]) : h < 0.6 ? leaves[0] : leaves[1];
    if (!o.neem && up < 0.3 && h > 0.965) c = P.mango;
    if (o.blossom && h > 0.93) c = o.blossom;
    v.set(x + i, y + j, cz + k, c);
  }
}

/** Street lamp; returns the lamp voxel position. */
function lamp(v, x, y, z, h = 9) {
  v.box(x, y, z, 1, 1, h, P.steel2); v.set(x, y, z, P.tank);
  v.set(x, y + 1, z + h - 1, P.steel2); v.set(x, y + 2, z + h - 1, P.steel2);
  v.set(x, y + 2, z + h - 2, { c: P.lamp, glow: true });
  return [x, y + 2, z + h - 2];
}

/** Platform weighing scale with a lit display. */
function platformScale(v, x, y, z) {
  v.box(x, y, z, 5, 5, 1, P.steel2); v.box(x, y, z + 1, 5, 5, 1, P.steel);
  v.box(x + 2, y, z + 2, 1, 1, 5, P.steel2);
  v.box(x + 1, y, z + 7, 3, 1, 2, P.tank);
  for (let i = 1; i <= 3; i++) v.set(x + i, y + 1, z + 8, { c: P.lime, glow: true });
}

module.exports = { island, bush, person, sack, shop, tempo, tree, lamp, platformScale, cart, pick };
