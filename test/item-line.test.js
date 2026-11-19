"use strict";

/**
 * public/js/app/item-line.js: a status line names the item only when the item is written in the
 * line's own script, so one sentence never mixes Hindi and Kannada (E2E 2026-11-19 at 390 px:
 * a Hindi "{item} के 10 विक्रेता मिले" with a Kannada item). Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/item-line.js"))}`);

test("an item in the line's script is named; one in another script gets the line without it", async () => {
  const { itemLine } = await load();
  assert.deepEqual(itemLine("now.found", { n: 10, item: "बासमती चावल" }, "hi"), { key: "now.found", vars: { n: 10, item: "बासमती चावल" } });
  assert.deepEqual(itemLine("now.found", { n: 10, item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ" }, "hi"), { key: "now.foundAny", vars: { n: 10 } });
  assert.deepEqual(itemLine("now.found", { n: 10, item: "बासमती चावल" }, "kn"), { key: "now.foundAny", vars: { n: 10 } });
  assert.deepEqual(itemLine("now.searching", { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ" }, "kn"), { key: "now.searching", vars: { item: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ" } });
  assert.deepEqual(itemLine("now.heard", { item: "Basmati rice" }, "en"), { key: "now.heard", vars: { item: "Basmati rice" } });
  assert.equal(itemLine("now.heard", { item: "Basmati rice" }, "hi").key, "now.heardAny", "Latin letters in a Hindi line are for names, not items");
  assert.equal(itemLine("now.heard", { item: "बासमती ಅಕ್ಕಿ" }, "hi").key, "now.heardAny", "a name that itself mixes scripts is left out");
  assert.equal(itemLine("now.searching", { item: "" }, "hi").key, "now.searchingAny");
  assert.equal(itemLine("now.searching", {}, "en").key, "now.searchingAny");
  assert.equal(itemLine("now.found", { n: 2, item: "200" }, "kn").key, "now.found", "digits fit every script");
});

test("every item line has an item-free twin in all three languages, and the Talk and Buy lines go through itemLine", () => {
  const i18n = read("public/js/app/i18n.js");
  for (const key of ["now.heard", "now.searching", "now.found"]) {
    const twin = new RegExp(`"${key.replace(".", "\\.")}Any": \\[("[^"]+",? ?){3}\\]`);
    assert.match(i18n, twin, `${key}Any`);
    assert.doesNotMatch(i18n.match(twin)[0], /\{item\}/);
  }
  const activity = read("public/js/app/activity.js");
  assert.doesNotMatch(activity, /key: "now\.(heard|searching|found)"/, "nowLine names no item directly");
  assert.match(activity, /itemLine\(/);
  assert.doesNotMatch(read("public/js/app/river.js"), /t\("now\.searching", \{ item/, "the Buy sheet's line goes through itemLine too");
});
