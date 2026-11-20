"use strict";
// Sahay, the app's pixel agent: a small round lime helper with a two-leaf sprout. Six states, each a
// separate image plus one horizontal sprite sheet: idle, listening, thinking, speaking, waiting, trouble.
const { Canvas, hex } = require("../lib/pix");
const P = require("../lib/palette");

const N = 48;
const TONES = {
  ok: { hi: "#E6F9C8", base: P.lime, mid: "#86CC66", lo: "#5AA653", deep: "#3B7F4D" },
  trouble: { hi: "#FCD9C4", base: "#F2A07A", mid: "#E07F5C", lo: "#C25E45", deep: "#8E3F35" },
};
const INK = P.deep, CREAM = P.cream;

function body(cv, t, cx, cy, r) {
  // shadow on the floor
  cv.ellipse(cx, 44.5, 11, 2.2, [6, 20, 49, 90]);
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy); if (d > r) continue;
    const l = (-dx * 0.55 - dy * 0.8) / r + (1 - d / r) * 0.35;
    let c = l > 0.62 ? t.hi : l > 0.15 ? t.base : l > -0.3 ? t.mid : l > -0.62 ? t.lo : t.deep;
    if (d > r - 1.5 && dx > 0 && dy > 0) c = t.deep;
    cv.set(x, y, c);
  }
  // specular pixel cluster and rim
  cv.rect(Math.round(cx - r * 0.5), Math.round(cy - r * 0.62), 3, 2, "#FFFFF0"); cv.set(Math.round(cx - r * 0.62), Math.round(cy - r * 0.35), "#FFFFF0");
}
function sprout(cv, cx, top, perk = 0) {
  cv.rect(cx, top - 4 + perk, 1, 4 - perk, "#3B7F4D");
  cv.sprite(["..GG", ".GGL", "GGL."], cx - 4, top - 7 + perk, { G: "#4E9F45", L: "#8BCB5C" });
  cv.sprite(["GG..", "LGG.", ".LGG"], cx + 1, top - 8 + perk, { G: "#4E9F45", L: "#8BCB5C" });
}
function eyes(cv, cx, cy, mode) {
  const L = cx - 6, R = cx + 4;
  if (mode === "closed") { cv.rect(L, cy + 1, 3, 1, INK); cv.rect(R, cy + 1, 3, 1, INK); return; }
  if (mode === "half") { cv.rect(L, cy, 3, 2, INK); cv.rect(R, cy, 3, 2, INK); cv.rect(L, cy - 1, 3, 1, "#5AA653"); cv.rect(R, cy - 1, 3, 1, "#5AA653"); return; }
  const h = mode === "wide" ? 5 : 4;
  cv.rect(L, cy - (h - 4), 3, h, INK); cv.rect(R, cy - (h - 4), 3, h, INK);
  const sx = mode === "up" ? 1 : 0, sy = mode === "up" ? -(h - 4) : -(h - 4);
  cv.set(L + sx + (mode === "up" ? 1 : 0), cy + sy, CREAM); cv.set(R + sx + (mode === "up" ? 1 : 0), cy + sy, CREAM);
  if (mode === "worried") { cv.line(L - 1, cy - 3, L + 2, cy - 2, INK); cv.line(R + 3, cy - 3, R, cy - 2, INK); }
}
function cheeks(cv, cx, cy) { cv.rect(cx - 9, cy + 4, 2, 1, "#F2A0A8"); cv.rect(cx + 8, cy + 4, 2, 1, "#F2A0A8"); }
function mouth(cv, cx, cy, mode) {
  const y = cy + 6;
  if (mode === "smile") { cv.set(cx - 2, y, INK); cv.rect(cx - 1, y + 1, 3, 1, INK); cv.set(cx + 2, y, INK); }
  else if (mode === "flat") cv.rect(cx - 1, y + 1, 3, 1, INK);
  else if (mode === "open") { cv.rect(cx - 2, y, 5, 3, INK); cv.rect(cx - 1, y + 3, 3, 1, INK); cv.rect(cx - 1, y + 2, 3, 1, "#E8707E"); }
  else if (mode === "o") { cv.rect(cx - 1, y, 3, 3, INK); cv.set(cx, y + 1, "#2A3A6A"); }
  else if (mode === "wobble") { cv.set(cx - 3, y + 1, INK); cv.set(cx - 2, y, INK); cv.set(cx - 1, y + 1, INK); cv.set(cx, y, INK); cv.set(cx + 1, y + 1, INK); cv.set(cx + 2, y, INK); }
}
function arcs(cv, x, y, dir, color, n = 3, inward = false) {
  for (let i = 0; i < n; i++) {
    const r = 3 + i * 3, a0 = 0.85;
    for (let a = -a0; a <= a0; a += 0.08) cv.set(Math.round(x + dir * Math.cos(a) * r), Math.round(y + Math.sin(a) * r), [...hex(color).slice(0, 3), inward ? 120 + i * 60 : 255 - i * 70]);
  }
}

function frame(state) {
  const cv = new Canvas(N, N), cx = 23.5, cy = 25, r = 14;
  const t = state === "trouble" ? TONES.trouble : TONES.ok;
  const lift = state === "listening" ? -1 : state === "waiting" ? 1 : 0;
  body(cv, t, cx, cy + lift, r);
  sprout(cv, 24, Math.round(cy + lift - r + 1), state === "listening" ? -1 : state === "waiting" ? 1 : 0);
  const ex = 24, ey = Math.round(cy + lift - 2);
  const E = { idle: "open", listening: "wide", thinking: "up", speaking: "open", waiting: "half", trouble: "worried" }[state];
  eyes(cv, ex, ey, E);
  cheeks(cv, ex, ey);
  mouth(cv, ex, ey, { idle: "smile", listening: "o", thinking: "flat", speaking: "open", waiting: "flat", trouble: "wobble" }[state]);
  if (state === "listening") { arcs(cv, 4, ey + 2, 1, CREAM, 2, true); arcs(cv, 44, ey + 2, -1, CREAM, 2, true); }
  if (state === "speaking") arcs(cv, 39, ey + 4, 1, P.lime, 3);
  if (state === "thinking") { cv.rect(36, 8, 2, 2, CREAM); cv.rect(40, 5, 2, 2, CREAM); cv.rect(44, 2, 2, 2, CREAM); }
  if (state === "waiting") cv.sprite(["KKKKK", "KYYYK", ".KYK.", "..K..", ".KYK.", "KYYYK", "KKKKK"], 40, 10, { K: INK, Y: P.gold });
  if (state === "trouble") { cv.rect(39, 4, 5, 9, INK); cv.rect(40, 5, 3, 7, "#E5533D"); cv.rect(41, 6, 1, 3, CREAM); cv.rect(41, 10, 1, 1, CREAM); }
  return cv;
}
const STATES = ["idle", "listening", "thinking", "speaking", "waiting", "trouble"];
function sheet() { const cv = new Canvas(N * STATES.length, N); STATES.forEach((s, i) => cv.blit(frame(s), i * N, 0)); return cv; }
function assets() {
  return [
    ...STATES.map((s) => [`agent-${s}.png`, () => frame(s), 4, `App Home agent sprite: ${s} (192px)`]),
    ["agent-sheet.png", sheet, 4, "All six agent states in one row (192px cells): idle, listening, thinking, speaking, waiting, trouble"],
  ];
}
module.exports = { assets, frame, STATES };
