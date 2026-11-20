// The "What Sahay does" carousel (public/js/landing/carousel.js): only its pure half runs here.
// public/ is browser ESM inside a CommonJS package, so the file is loaded from its text as a data: module.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(__dirname, "..", "public", "js", "landing", "carousel.js"), "utf8"))}`);
const cards = [0, 320, 640, 960].map((left) => ({ left, width: 300 }));

test("carousel: a segment is full once its card is in view, empty before, partial at the edge", async () => {
  const { segmentFill } = await load();
  assert.deepEqual(segmentFill(800, cards), [1, 1, 160 / 300, 0]);
  assert.deepEqual(segmentFill(1260, cards), [1, 1, 1, 1]);
  assert.deepEqual(segmentFill(0, cards), [0, 0, 0, 0]);
  assert.deepEqual(segmentFill(500, [{ left: 0, width: 0 }]), [0], "a card with no width counts as unseen");
});

test("carousel: an arrow moves one card and never past either end", async () => {
  const { nextScroll } = await load();
  assert.equal(nextScroll(0, 320, 1, 1000), 320);
  assert.equal(nextScroll(900, 320, 1, 1000), 1000);
  assert.equal(nextScroll(100, 320, -1, 1000), 0);
});
