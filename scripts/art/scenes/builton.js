"use strict";
// "Built on": three floating islands. Voice (a lattice radio tower), Ears (a studio microphone that
// listens), Speech (market horn loudspeakers). Roles only; no third-party logos.
const { Vox, render } = require("../lib/voxel");
const { Canvas, hex } = require("../lib/pix");
const S = require("../lib/sky");
const V = require("../lib/props");
const P = require("../lib/palette");

const W = 200, H = 220;
function arcs(cv, x, y, dir, n, color, inward = false) {
  for (let i = 1; i <= n; i++) {
    const r = 5 + i * 6, a0 = inward ? 0.7 : 0.9;
    for (let a = -a0; a <= a0; a += 0.03) cv.set(Math.round(x + dir * Math.cos(a) * r), Math.round(y + Math.sin(a) * r), [...hex(color).slice(0, 3), inward ? 120 + i * 40 : 255 - i * 45]);
  }
}
function place(v, seedCloud) {
  const r = render(v); const cv = new Canvas(W, H);
  const ox = Math.round(W / 2 - r.cv.w / 2), oy = H - r.cv.h - 8;
  cv.blit(r.cv, ox, oy);
  return { cv, at: (x, y, z) => { const [px, py] = r.proj(x, y, z); return [ox + px, oy + py]; } };
}

function voice() {
  const v = new Vox(); V.island(v, 0, 0, 10, 13, 61, { vines: 4 });
  // lattice tower, red and white bands, tapering
  const top = 28;
  for (let z = 1; z <= top; z++) {
    const half = z < 7 ? 2 : z < 17 ? 1 : 0;
    const c = Math.floor((z - 1) / 4) % 2 ? P.white : P.red;
    for (const [dx, dy] of [[-half, -half], [half, -half], [-half, half], [half, half]]) v.set(dx, dy, z, c);
    if (half === 2 && z % 3 === 0) for (const i of [-1, 1]) { v.set(i, -2, z + (i > 0 ? 1 : 0), P.steel2); v.set(i, 2, z + (i > 0 ? 0 : 1), P.steel2); v.set(-2, i, z + (i > 0 ? 1 : 0), P.steel2); v.set(2, i, z + (i > 0 ? 0 : 1), P.steel2); }
  }
  v.set(0, 0, top + 1, { c: P.red, glow: true });
  v.box(1, 0, 21, 1, 2, 2, P.steel); v.box(0, 1, 15, 2, 1, 2, P.steel); v.box(-1, -1, 25, 1, 1, 1, P.steel2);
  // equipment hut and a neem
  v.box(3, 3, 1, 4, 4, 4, P.plaster); v.box(3, 3, 5, 4, 4, 1, P.steel2); v.set(5, 7, 2, P.woodDark); v.set(5, 7, 3, P.woodDark); v.set(4, 7, 4, { c: P.lime, glow: true });
  V.tree(v, -6, 4, 1, { seed: 3, s: 0.55, trunk: 3, neem: true });
  const p = place(v);
  const [tx, ty] = p.at(0, 0, top - 1);
  arcs(p.cv, tx + 6, ty, 1, 3, P.lime); arcs(p.cv, tx - 6, ty, -1, 3, P.lime);
  return p.cv;
}

function ears() {
  const v = new Vox(); V.island(v, 0, 0, 10, 13, 62, { vines: 4 });
  // microphone on a stand
  v.box(-2, -2, 1, 5, 5, 1, P.tank); v.box(0, 0, 2, 1, 1, 8, P.steel2);
  v.box(-1, -1, 10, 3, 3, 1, P.steel2);
  for (let z = 11; z <= 19; z++) for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
    const corner = Math.abs(x) === 2 && Math.abs(y) === 2; if (corner) continue;
    const rim = z === 11 || z === 19; if (rim && (Math.abs(x) === 2 || Math.abs(y) === 2)) continue;
    const band = z === 14;
    v.set(x, y, z, band ? P.lime : (x + y + z) % 2 ? "#4B566E" : P.steel);
  }
  V.bush(v, 4, 4, 1, 3); V.bush(v, -7, 2, 1, 2); V.bush(v, 3, -6, 1, 2, P.leaf);
  for (const [x, y] of [[6, -2], [-3, 7]]) v.set(x, y, 1, "#F6C8D6");
  const p = place(v);
  const [mx, my] = p.at(0, 0, 15);
  arcs(p.cv, mx - 2, my, 1, 3, P.cream, true); arcs(p.cv, mx + 2, my, -1, 3, P.cream, true);
  return p.cv;
}

function horn(v, x, y, z, axis) {
  const L = 9;
  for (let j = 0; j < L; j++) {
    const r = 0.5 + Math.pow(j / (L - 1), 1.6) * 3.2;
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
      const d = Math.hypot(a, b); if (d > r) continue;
      const last = j === L - 1, inner = d < r - 1;
      if (last && inner) { if (axis === "y") v.set(x + a, y + j, z + b, "#1E2638"); else v.set(x + j, y + a, z + b, "#1E2638"); continue; }
      if (!last && inner && j > 2) continue;
      const c = last ? "#DDE4EE" : j < 2 ? P.steel2 : P.steel;
      if (axis === "y") v.set(x + a, y + j, z + b, c); else v.set(x + j, y + a, z + b, c);
    }
  }
}
function speech() {
  const v = new Vox(); V.island(v, 0, 0, 10, 13, 63, { vines: 4 });
  v.box(0, 0, 1, 1, 1, 19, P.wood); v.box(-1, -1, 1, 3, 3, 1, P.woodDark);
  v.box(-1, 0, 16, 3, 1, 1, P.woodDark); v.box(0, -1, 16, 1, 3, 1, P.woodDark);
  horn(v, 0, 1, 17, "y"); horn(v, 1, 0, 12, "x");
  v.set(0, 0, 20, { c: P.lamp, glow: true });
  // a tea stall bench and a tulsi pot at its foot
  v.box(4, 3, 1, 4, 2, 2, P.wood2); v.box(4, 3, 3, 4, 2, 1, P.awnRed);
  v.box(-6, 2, 1, 2, 2, 2, P.terracotta); v.set(-6, 2, 3, P.leaf3); v.set(-5, 3, 3, P.leaf2); v.set(-6, 3, 4, P.leaf3);
  V.bush(v, -3, -7, 1, 2);
  const p = place(v);
  const [ax, ay] = p.at(0, 10, 17); arcs(p.cv, ax - 4, ay + 2, -1, 3, P.lime);
  const [bx, by] = p.at(10, 0, 12); arcs(p.cv, bx + 4, by + 2, 1, 3, P.lime);
  return p.cv;
}

function assets() {
  return [["voice", voice], ["ears", ears], ["speech", speech]].map(([n, f]) => [`builton-${n}.png`, () => f().trim(1), 2, `Built on: ${n} island`]);
}
module.exports = { assets };
