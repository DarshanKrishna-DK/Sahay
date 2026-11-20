"use strict";

/**
 * public/js/app/me-logic.js: My Sahay's four sections and routes (D4), the bargaining dial keys,
 * the constellation order (suggested rules first, switched-off rules gone) and star positions,
 * and the Telegram deep link check (only https://t.me/ ever opens).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// The module is a browser ES module with no imports; node loads its source as a data: URL (the
// package is CommonJS, so a file: import would parse it as a script).
const load = () => import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "me-logic.js")).toString("base64")}`);

test("sections Teach, Voice, Shop, History with #/me/<id> routes; the old #/history link lands on History", async () => {
  const M = await load();
  assert.deepEqual(M.ME_SECTIONS.map((s) => s.id), ["teach", "voice", "shop", "history"]);
  assert.equal(M.sectionFromHash("#/me/shop"), "shop");
  assert.equal(M.sectionFromHash("#/me/nope"), null);
  assert.equal(M.sectionFromHash("#/me"), null);
  assert.equal(M.sectionFromHash("#/history"), "history");
  assert.equal(M.sectionHash("voice"), "#/me/voice");
  assert.equal(M.sectionHash("bad"), "#/me/teach");
});

test("the bargaining dial moves one stop per arrow key and stops at the ends", async () => {
  const M = await load();
  assert.equal(M.dialKey("ArrowRight", 1), 2);
  assert.equal(M.dialKey("ArrowRight", 2), null);
  assert.equal(M.dialKey("ArrowLeft", 0), null);
  assert.equal(M.dialKey("Home", 2), 0);
  assert.equal(M.dialKey("End", 0), 2);
  assert.equal(M.dialKey("a", 1), null);
});

test("suggested rules lead the constellation, switched-off rules are not stars, memories follow", async () => {
  const M = await load();
  const items = M.starItems(
    [{ id: 1, status: "active" }, { id: 2, status: "off" }, { id: 3, status: "suggested" }],
    [{ id: 9 }],
  );
  assert.deepEqual(items.map((i) => `${i.type}:${i.data.id}`), ["rule:3", "rule:1", "memory:9"]);
});

test("star positions stay inside the sky on two orbits", async () => {
  const M = await load();
  const p = M.starPositions(20);
  assert.equal(p.length, 16);
  assert.equal(p.filter((s) => s.ring === 0).length, 6);
  for (const s of p) { assert.ok(s.x >= 5 && s.x <= 95, `x ${s.x}`); assert.ok(s.y >= 5 && s.y <= 95, `y ${s.y}`); }
  assert.deepEqual(M.starPositions(1), [{ x: 50, y: 23, ring: 0 }]);
});

test("a sentence comes in the owner's language, else English", async () => {
  const M = await load();
  assert.equal(M.sentenceOf({ sentence: { "hi-IN": "हिंदी", "en-IN": "en" } }, "hi-IN"), "हिंदी");
  assert.equal(M.sentenceOf({ sentence: { "en-IN": "en" } }, "kn-IN"), "en");
  assert.equal(M.sentenceOf({ sentence: "plain" }, "kn-IN"), "plain");
  assert.equal(M.sentenceOf({}, "en-IN"), "");
});

test("only a https://t.me/ deep link from the server is opened", async () => {
  const M = await load();
  assert.equal(M.telegramLink({ deepLink: "https://t.me/SahayBot?start=abc" }), "https://t.me/SahayBot?start=abc");
  assert.equal(M.telegramLink({ deepLink: "http://t.me/x" }), null);
  assert.equal(M.telegramLink({ deepLink: "https://t.me.evil.com/x" }), null);
  assert.equal(M.telegramLink({ deepLink: "javascript:alert(1)" }), null);
  assert.equal(M.telegramLink({}), null);
});
