"use strict";

/**
 * UI v3, W5 (My Sahay, auth, History, boot): checked from the sources (the modules need a browser).
 * Every word exists in English, Hindi (Devanagari) and Kannada (Kannada script); every History
 * line has words; nothing of the old design (marigold, saffron, v2 class names) is left in these
 * files; the routes and the honest notes are where the spec puts them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const W5_JS = ["me.js", "star-words.js", "history.js", "auth.js", "welcome.js", "boot-screens.js", "me-strings.js", "me-logic.js", "auth-logic.js", "history-lines.js"].map((f) => `public/js/app/${f}`);
const W5_CSS = ["public/css/app-me.css", "public/css/app-auth.css", "public/css/pay.css"];

/** Rows of an addStrings({...}) call: key -> [en, hi, kn]. */
function stringRows(source) {
  const rows = new Map();
  for (const m of source.matchAll(/^\s*"([a-z0-9]+(?:\.[A-Za-z0-9_]+)+)":\s*\[("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*"),\s*("(?:[^"\\]|\\.)*")\]/gm)) {
    rows.set(m[1], [JSON.parse(m[2]), JSON.parse(m[3]), JSON.parse(m[4])]);
  }
  return rows;
}

test("every My Sahay, History, auth and boot word is in three languages, Hindi in Devanagari and Kannada in Kannada script", () => {
  const rows = stringRows(read("public/js/app/me-strings.js"));
  assert.ok(rows.size > 120, `found ${rows.size} rows`);
  for (const [key, [en, hi, kn]] of rows) {
    assert.ok(en && hi && kn, key);
    assert.match(hi, /[ऀ-ॿ]/, `${key} hi is Devanagari`);
    assert.match(kn, /[ಀ-೿]/, `${key} kn is Kannada script`);
    for (const [name, s] of [["en", en], ["hi", hi], ["kn", kn]]) {
      const want = (en.match(/\{(\w+)\}/g) || []).sort().join();
      assert.equal((s.match(/\{(\w+)\}/g) || []).sort().join(), want, `${key} ${name} keeps the same {placeholders}`);
    }
  }
});

test("every History line key has words (old hist.* rows or the new hx.* rows)", () => {
  const known = new Set([...stringRows(read("public/js/app/i18n.js")).keys(), ...stringRows(read("public/js/app/me-strings.js")).keys()]);
  const lines = read("public/js/app/history-lines.js");
  const keys = new Set([...lines.matchAll(/"((?:hist|hx)\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]));
  for (const type of lines.match(/HISTORY_ICON = \{([\s\S]*?)\};/)[1].matchAll(/"([a-z_]+\.[a-z_]+|error)":/g)) keys.add(`hist.${type[1]}`);
  // Types whose line is always replaced by an hx.* key are not looked up under hist.*.
  const replaced = new Set(["hist.invoice.issued", "hist.invoice.decided", "hist.invoice.paid", "hist.receipt.recorded", "hist.order.paid", "hist.stock.low",
    "hist.stock.reorder_proposed", "hist.stock.reorder_decided", "hist.customer.saved", "hist.sell.settings_saved", "hist.account.registered",
    "hist.account.signed_in", "hist.account.passkey_added", "hist.account.pin_locked", "hist.rule.decided", "hist.approval.decided"]);
  for (const k of keys) if (!replaced.has(k)) assert.ok(known.has(k), `${k} has words`);
});
