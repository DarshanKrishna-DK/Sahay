"use strict";
// Market-street model: a diorama slab with four kirana shops, a road with lane marks, lamps, a vegetable
// cart, a parked tempo, neem and mango trees and shoppers. For the "about" section.
const { Vox, render } = require("../lib/voxel");
const { hash3 } = require("../lib/pix");
const S = require("../lib/sky");
const V = require("../lib/props");
const P = require("../lib/palette");

function build() {
  const v = new Vox(), X = 52, Y = 44;
  // slab: earth sides, grass behind the shops, pavement, road, grass verge in front
  v.box(0, 0, -4, X, Y, 3, (x, y, z) => (z === -2 ? P.dirt : z === -3 ? P.dirt2 : P.stone2));
  v.box(0, 0, -1, X, Y, 1, (x, y) => {
    const h = hash3(x, y, 0, 3);
    if (y < 6 || y > 34) return h < 0.15 ? P.grassHi : h < 0.6 ? P.grass : P.grass2;
    if (y >= 23 && y <= 30) return y === 26 && x % 6 < 3 ? P.cream : h < 0.5 ? "#3E4558" : "#454C61";
    if (y === 22 || y === 31) return "#B9B7AE";
    return h < 0.5 ? "#A9A79E" : "#9D9B93";
  });
  const walls = [[P.teal, P.blue], [P.pinkWall, "#7A2E4F"], [P.ochre, "#1F5E3A"], ["#8FC7E8", P.red]];
  walls.forEach(([wall, sign], i) => V.shop(v, 2 + i * 12, 6, -1, { w: 11, d: 8, wall, sign }));
  // lamps on the pavement edge
  for (const x of [12, 24, 36, 48]) V.lamp(v, x, 20, 0, 9);
  // front verge: trees, cart, tempo on the road, shoppers
  V.tree(v, 5, 38, 0, { seed: 7, s: 0.9, trunk: 5, neem: true });
  V.tree(v, 44, 38, 0, { seed: 12, s: 0.95, trunk: 5 });
  V.cart(v, 16, 32, 0);
  v.add(V.tempo(), 26, 24, 0);
  v.add(V.person({ shirt: "#C0457A", pants: "#C0457A", sari: true, long: true, bindi: true, dupatta: P.ochre }), 13, 18, 0);
  v.add(V.person({ shirt: P.kurta2, moustache: true }), 30, 18, 0);
  v.add(V.person({ shirt: "#2E8B6E", pants: "#3B4A6B" }), 22, 34, 0);
  v.add(V.person({ shirt: P.white, pants: P.dhoti, moustache: true }), 9, 16, 0);
  for (const [x, c] of [[40, P.rice], [42, P.dal]]) V.sack(v, x, 16, 0, c, c, 2, 2, 3, c === P.rice ? P.riceStripe : P.red);
  V.bush(v, 30, 37, 0, 3); V.bush(v, 36, 40, 0, 2); V.bush(v, 1, 1, 0, 2);
  const r = render(v);
  return r.cv.trim(1);
}
module.exports = { build };
