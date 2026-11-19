"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const variety = require("../src/agora/variety");

test("pick walks the variants of a line in turn, never the same twice in a row, and keeps the figures the caller gives", () => {
  variety.reset();
  const lines = [(v) => `खोज पूरी हुई, ${v.count} विक्रेता मिले।`, (v) => `बढ़िया, ${v.count} विक्रेता मिल गए।`, (v) => `लीजिए, ${v.count} विक्रेता हैं।`];
  const out = [];
  for (let i = 0; i < 6; i++) out.push(variety.pick(lines, { scope: "biz_a", key: "sourcing_done", vars: { count: 10 } }));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i], out[i - 1]);
  assert.equal(new Set(out).size, 3, "every variant is used");
  for (const line of out) assert.match(line, /\b10 विक्रेता/);
});

test("variantIndex predicts the next pick; scopes and keys are independent; one variant is always itself", () => {
  variety.reset();
  const lines = ["a", "b", "c", "d"];
  const expected = lines[variety.variantIndex(4, "neg_1", "ask")];
  assert.equal(variety.pick(lines, { scope: "neg_1", key: "ask" }), expected);
  const otherKey = lines[variety.variantIndex(4, "neg_1", "final")];
  assert.equal(variety.pick(lines, { scope: "neg_1", key: "final" }), otherKey);
  assert.equal(variety.pick(["only"], { scope: "neg_1", key: "x" }), "only");
  assert.equal(variety.pick("plain", { scope: "s", key: "k" }), "plain");
  assert.throws(() => variety.pick([], { scope: "s", key: "k" }));
});

test("different scopes start at different variants, so two negotiations do not sound the same", () => {
  variety.reset();
  const starts = new Set();
  for (let i = 0; i < 20; i++) starts.add(variety.variantIndex(4, `neg_${i}`, "ask"));
  assert.ok(starts.size > 1);
});

test("fromStart begins a scope at the first (canonical) wording, then walks on", () => {
  variety.reset();
  const lines = ["first", "second", "third"];
  assert.deepEqual([0, 1, 2, 3].map(() => variety.pick(lines, { scope: "biz_x", key: "k", fromStart: true })), ["first", "second", "third", "first"]);
});
