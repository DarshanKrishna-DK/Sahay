"use strict";
// Shop guide: a pixel bust of the shopkeeper (32 x 32 native) on a night-sky tile with a pixel border.
const { Canvas } = require("../lib/pix");
const S = require("../lib/sky");
const P = require("../lib/palette");

function bust() {
  const c = new Canvas(32, 32);
  const skin = P.skin, shade = P.skin2, light = "#CF916A", hair = P.hair;
  // kurta shoulders with a cream collar placket
  for (let y = 23; y < 32; y++) for (let x = 3; x < 29; x++) {
    const top = y - 23, inset = Math.max(0, 4 - top);
    if (x < 3 + inset || x > 28 - inset) continue;
    c.set(x, y, x > 21 ? "#C17F22" : P.kurta);
  }
  for (let y = 23; y < 32; y++) { c.set(15, y, P.cream); c.set(16, y, P.cream); }
  c.set(14, 23, P.cream); c.set(17, 23, P.cream); c.set(13, 22, P.cream); c.set(18, 22, P.cream);
  c.set(15, 26, "#8E6A2E"); c.set(15, 29, "#8E6A2E");
  // neck
  c.rect(13, 20, 6, 3, shade);
  // ears
  c.rect(8, 13, 2, 3, skin); c.rect(22, 13, 2, 3, shade);
  // face
  c.ellipse(16, 13.5, 6.6, 8, skin);
  for (let y = 6; y < 22; y++) for (let x = 19; x < 23; x++) { const p = c.get(x, y); if (p[3] && (p[0] === 181)) if ((x - 19) * 2 + (y > 15 ? 1 : 0) > 3) c.set(x, y, shade); }
  c.rect(11, 11, 4, 1, light); c.rect(12, 16, 2, 1, light);
  // hair: cap of hair with a side parting and sideburns
  c.ellipse(16, 8.4, 7.2, 4.1, hair);
  c.rect(9, 8, 1, 5, hair); c.rect(23, 8, 1, 4, hair);
  c.rect(10, 10, 3, 1, hair); c.rect(19, 10, 4, 1, hair);
  c.line(12, 5, 15, 4, "#3B3340"); c.line(16, 5, 20, 5, "#3B3340");
  // brows, eyes, nose, moustache, smile, tilak
  c.rect(11, 12, 3, 1, "#2A1D1A"); c.rect(18, 12, 3, 1, "#2A1D1A");
  c.rect(11, 14, 3, 1, P.cream); c.rect(18, 14, 3, 1, P.cream); c.set(12, 14, "#1A1418"); c.set(19, 14, "#1A1418");
  c.set(16, 15, shade); c.set(16, 16, shade); c.set(15, 17, shade);
  c.rect(13, 18, 6, 1, "#2A1D1A"); c.set(12, 19, "#2A1D1A"); c.set(19, 19, "#2A1D1A");
  c.rect(14, 20, 4, 1, "#7A3B2E");
  c.rect(16, 9, 1, 2, P.red);
  // a pencil behind the ear
  c.line(22, 11, 25, 8, P.ochre); c.set(25, 8, "#2A1D1A");
  return c.outline("#2A1D1A");
}

function build() {
  const n = 48, c = new Canvas(n, n);
  S.bands(c, "#133D7E", "#2481AA", 6);
  const m = S.moon(7, { halo: 4, craters: 2 }); c.blit(m, n - m.w + 2, -3);
  S.star(c, 6, 7, 1); S.star(c, 40, 22, 1); c.set(12, 3, P.cream); c.set(30, 6, P.cream); c.set(4, 20, "#DDE6FF");
  const b = bust();
  c.blit(b.scale(1), Math.floor((n - b.w) / 2), n - b.h + 1);
  // pixel border: cream outer, navy inner
  for (let i = 0; i < n; i++) { c.set(i, 0, P.paper2); c.set(i, n - 1, P.paper2); c.set(0, i, P.paper2); c.set(n - 1, i, P.paper2); }
  return c;
}
module.exports = { build };
