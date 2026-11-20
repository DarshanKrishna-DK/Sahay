"use strict";

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const limits = require("../src/limits");

beforeEach(() => limits.reset());

test("allow: a fixed window per key, max requests, then false until the window ends", () => {
  for (let i = 0; i < 3; i++) assert.equal(limits.allow("k", 3, 1000, 0), true);
  assert.equal(limits.allow("k", 3, 1000, 10), false);
  assert.equal(limits.allow("other", 3, 1000, 10), true, "another key has its own window");
  assert.equal(limits.allow("k", 3, 1000, 1000), true, "a new window");
});

test("the window map is capped: a flood of fresh keys evicts the least recently used, never grows without bound", () => {
  assert.equal(limits.allow("busy", 2, 60_000, 0), true);
  assert.equal(limits.allow("busy", 2, 60_000, 0), true);
  for (let i = 0; i < limits.MAX_KEYS + 500; i++) {
    limits.allow(`flood:${i}`, 5, 60_000, 1);
    if (i % 1000 === 0) limits.allow("busy", 2, 60_000, 1); // still in use: kept at the recent end
  }
  assert.ok(limits.size() <= limits.MAX_KEYS, `size ${limits.size()}`);
  assert.equal(limits.allow("busy", 2, 60_000, 2), false, "a key in active use keeps its count");
});
