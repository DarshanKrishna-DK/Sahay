"use strict";

/**
 * public/js/app/shell-geometry.js: the v3 shell's size classes (spec 6.1), routes and aliases
 * (spec 1.1), the curved sidebar's bow, the phone dock's outline and the hex-dot lattice.
 * Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/shell-geometry.js"))}`);

test("size classes follow the spec's tested sizes", async () => {
  const { sizeClass } = await load();
  const cases = [
    [360, 780, "phone"], [390, 844, "phone"], [412, 915, "phone"], [430, 932, "phone"], [360, 640, "phone"],
    [844, 390, "phoneLand"], [932, 430, "phoneLand"], [568, 320, "phoneLand"],
    [768, 1024, "tablet"], [600, 900, "tablet"],
    [1024, 768, "laptop"], [1280, 800, "laptop"], [1280, 720, "laptop"], [1440, 900, "laptop"],
    [1920, 1080, "wide"], [1600, 900, "wide"],
  ];
  for (const [w, h, want] of cases) assert.equal(sizeClass(w, h), want, `${w}x${h}`);
});

test("routes: six destinations, My Sahay sections, waiting, auth; every old link still lands", async () => {
  const { parseRoute } = await load();
  const at = (h) => parseRoute(h);
  assert.deepEqual(at(""), { id: "sahay", sub: null, canonical: "#/sahay" });
  assert.equal(at("#/").id, "sahay");
  assert.equal(at("#/talk").id, "sahay");
  assert.equal(at("#/work").id, "buy");
  assert.equal(at("#/orders").id, "buy");
  for (const id of ["buy", "sell", "stock", "money", "me", "waiting", "signup", "login"]) assert.equal(at(`#/${id}`).id, id);
  assert.deepEqual(at("#/history"), { id: "me", sub: "history", canonical: "#/me/history" });
  for (const sub of ["teach", "voice", "shop", "history"]) assert.equal(at(`#/me/${sub}`).sub, sub);
  assert.equal(at("#/me/nonsense").sub, null);
  assert.equal(at("#/nowhere").id, "sahay", "unknown routes fall back to Sahay home");
  assert.equal(at("#/BUY?x=1").id, "buy");
});

test("the sidebar bows right: zero at the ends, the full bulge at mid height, middle item furthest right", async () => {
  const { arcOffset, arcItems, arcSamples } = await load();
  assert.equal(arcOffset(0, 800, 36), 0);
  assert.equal(arcOffset(800, 800, 36), 0);
  assert.equal(arcOffset(400, 800, 36), 36);
  const items = arcItems(104, 800, 36, [260, 340, 420, 500, 580]);
  const xs = items.map((p) => p.x);
  const mid = xs.indexOf(Math.max(...xs));
  assert.equal(mid, 2, "the middle item is furthest right");
  assert.ok(xs[0] < xs[1] && xs[3] > xs[4], "x rises then falls");
  for (const p of items) assert.ok(p.x > 0 && p.x < 104);
  const path = arcSamples(104, 800, 36, 260, 580);
  assert.equal(path[0].y, 260);
  assert.equal(path[path.length - 1].y, 580);
  assert.ok(path.length >= 40, "dense enough to look like a curve");
});

test("the dock outline: arcing top, a notch under the orb, inside its box, deepest at the centre", async () => {
  const { dockOutline, polygonCss, svgPath } = await load();
  const w = 366, h = 68;
  const pts = dockOutline(w, h, { orb: 64, gap: 6, orbCy: 14 });
  assert.ok(pts.length > 60);
  for (const [x, y] of pts) {
    assert.ok(x >= -0.01 && x <= w + 0.01, `x ${x}`);
    assert.ok(y >= -0.01 && y <= h + 0.01, `y ${y}`);
  }
  const topAt = (x0) => {
    const near = pts.filter(([x, y]) => Math.abs(x - x0) < 2 && y < h / 2 + 30);
    return Math.min(...near.map(([, y]) => y));
  };
  const centre = topAt(w / 2);
  assert.ok(centre > 40, `the notch cradles the orb (depth ${centre})`);
  assert.ok(topAt(w * 0.3) < 8, "beside the notch the top edge is high");
  assert.ok(topAt(40) > topAt(w * 0.3), "the top edge arcs upward towards the middle");
  assert.match(polygonCss(pts), /^polygon\(\d/);
  assert.match(svgPath(pts), /^M[\d.]+ [\d.]+L.*Z$/);
});

test("the hex lattice is a true hex grid with faded edges", async () => {
  const { hexLattice } = await load();
  const pitch = 22;
  const pts = hexLattice(800, 600, pitch);
  assert.ok(pts.length > 500);
  const rows = [...new Set(pts.map((p) => p.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
  const dy = rows[4] - rows[3];
  assert.ok(Math.abs(dy - (pitch * Math.sqrt(3)) / 2) < 1e-3, "rows are pitch * sqrt(3) / 2 apart");
  const firstX = (y) => Math.min(...pts.filter((p) => Math.abs(p.y - y) < 1e-3).map((p) => p.x));
  const shift = Math.abs(firstX(rows[2]) - firstX(rows[3])) % pitch;
  assert.ok(Math.abs(shift - pitch / 2) < 1e-3, "every other row is shifted half a pitch");
  const centre = pts.reduce((b, p) => (Math.hypot(p.x - 400, p.y - 300) < Math.hypot(b.x - 400, b.y - 300) ? p : b));
  assert.equal(centre.a, 1, "full strength inside");
  const edge = pts.reduce((b, p) => (p.a < b.a ? p : b));
  assert.ok(edge.a < 0.2, "faded at the edge");
});

test("badge text: nothing for zero, 1-9, then 9+", async () => {
  const { badgeText } = await load();
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(-1), "");
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(9), "9");
  assert.equal(badgeText(12), "9+");
});
