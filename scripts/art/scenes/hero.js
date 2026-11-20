"use strict";
// Hero: a kirana shop on a floating island under a big moon. Shopkeeper at the counter, a supplier with
// a phone beside his loaded delivery tempo, a mango tree, a street lamp, sacks, pastel pixel clouds.
const { Vox, render } = require("../lib/voxel");
const { Canvas } = require("../lib/pix");
const S = require("../lib/sky");
const V = require("../lib/props");
const P = require("../lib/palette");

function islandScene() {
  const v = new Vox();
  V.island(v, 0, 0, 22, 34, 11, { ry: 0.95, vines: 9 });
  // a beaten-earth lane from the shop to the tempo
  for (let x = -6; x <= 16; x++) for (let y = 0; y <= 3; y++) if (v.has(x, y, 0) && (x + y) % 7) v.set(x, y, 0, (x * 3 + y) % 5 ? "#C9A36B" : "#B48D58");
  const s = V.shop(v, -10, -14, 0, { w: 15, d: 9 });
  const z0 = 0, yF = s.yF;
  // the shopkeeper on the porch, phone in hand, talking to Sahay
  v.add(V.person({ shirt: P.kurta, moustache: true, collar: P.cream, phone: true }), -2, yF + 4, z0 + 1);
  // sacks on the porch
  V.sack(v, -9, yF + 3, 1, P.rice, P.rice, 3, 3, 3); V.sack(v, -6, yF + 3, 1, P.dal, P.dal, 3, 3, 3, P.red);
  V.sack(v, -9, yF + 3, 4, P.wheat, P.wheat, 3, 3, 2, P.woodDark);
  V.sack(v, 3, yF + 3, 1, P.rice, P.rice, 3, 3, 3);
  // crates of produce
  v.box(-13, yF + 6, 1, 3, 2, 2, P.wood); v.box(-13, yF + 6, 3, 3, 2, 1, (x, y) => ((x + y) % 2 ? P.mango : "#E8C24A"));
  // mango tree on the left
  V.tree(v, -14, 7, 1, { seed: 4, s: 1.1, trunk: 6 });
  // tempo arriving with sacks, and its driver-supplier on the phone
  v.add(V.tempo(), -1, 5, 1);
  v.add(V.person({ shirt: "#2E8B6E", pants: "#3B4A6B", armOut: "R", collar: P.cream }), 13, 13, 1);
  // street lamp at the porch corner
  const lampAt = V.lamp(v, 7, -5, 1, 10);
  // bushes and a small tulsi pot
  V.bush(v, -18, -5, 1, 3); V.bush(v, 13, -11, 1, 2); V.bush(v, -6, 16, 1, 2, P.leaf);
  v.box(-14, -9, 1, 2, 2, 2, P.terracotta); v.set(-14, -9, 3, P.leaf3); v.set(-13, -8, 3, P.leaf2); v.set(-14, -8, 4, P.leaf3);
  return { v, lampAt };
}

function smallIsle(seed, R, depth, extra) {
  const v = new Vox(); V.island(v, 0, 0, R, depth, seed, { flowers: 0.06, vines: 3 });
  if (extra) extra(v);
  return render(v).cv;
}

function build() {
  const W = 600, H = 470, cv = new Canvas(W, H);
  const moon = S.moon(122, { halo: 70, seed: 3 });
  cv.blit(moon, Math.round(W / 2 - moon.w / 2 + 6), Math.round(168 - moon.h / 2));
  // far islets
  const isle1 = smallIsle(21, 5, 7, (v) => V.tree(v, 0, 0, 1, { seed: 9, s: 0.55, trunk: 3, neem: true }));
  const isle2 = smallIsle(22, 3, 5);
  const isle3 = smallIsle(23, 4, 6, (v) => { v.box(-1, -1, 1, 3, 3, 3, P.plaster); v.box(-1, -1, 4, 3, 3, 1, P.terracotta); v.set(0, 1, 2, { c: P.window, glow: true }); });
  cv.blit(isle1, 40, 70); cv.blit(isle2, 520, 120); cv.blit(isle3, 470, 30);
  // back clouds
  const cl = (w, h, seed) => S.cloud(w, h, seed).scale(2);
  cv.blit(cl(40, 14, 4), 10, 210); cv.blit(cl(30, 11, 8), 490, 190);
  const { v, lampAt } = islandScene();
  const r = render(v);
  const ix = Math.round(W / 2 - r.cv.w / 2), iy = 96;
  cv.blit(r.cv, ix, iy);
  const [lx, ly] = r.proj(...lampAt);
  S.glow(cv, ix + lx, iy + ly, 22, P.lamp, 0.35);
  // front clouds drifting across the island's underside
  cv.blit(cl(58, 18, 12), 60, 340); cv.blit(cl(46, 15, 17), 380, 360); cv.blit(cl(26, 9, 19), 250, 420);
  const b = cv.bounds();
  return cv.crop(0, b.y - 2, W, b.h + 4);
}
module.exports = { build, islandScene };
