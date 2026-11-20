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
const W5_JS = ["me.js", "constellation.js", "history.js", "auth.js", "welcome.js", "boot-screens.js", "me-strings.js", "me-logic.js", "auth-logic.js", "history-lines.js"].map((f) => `public/js/app/${f}`);
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

test("nothing of the old design is left in W5's files", () => {
  const old = /marigold|saffron|#FFB020|#FF7A1A|\bwel-|wel-orb|chip-btn|lang-tile|finger-btn|me-stars|const-items|tl-item|keycap-leaf|aurora/i;
  for (const f of [...W5_JS, ...W5_CSS, "public/pay.html", "public/js/pay.js"]) assert.doesNotMatch(read(f), old, f);
});

test("every W5 stylesheet has a reduced-motion branch and uses the v3 tokens", () => {
  for (const f of W5_CSS) {
    const css = read(f);
    assert.match(css, /prefers-reduced-motion: reduce/, f);
    assert.match(css, /var\(--piano-|var\(--lime|var\(--btn-surface\)/, f);
  }
});

test("My Sahay has the four sections at #/me/<id>; Teach starts the call in place with the teach hint (D11)", () => {
  const me = read("public/js/app/me.js");
  assert.match(me, /ME_SECTIONS/);
  assert.match(me, /sahay:talk[\s\S]{0,80}talk\.teachHint/);
  assert.doesNotMatch(me, /location\.hash = "#\/talk"/, "no jump to another screen to teach");
  assert.match(me, /openShopSheet/, "shop details open W4B's sheet");
  assert.match(me, /telegramLinkCode/);
  assert.match(me, /me3\.notVerified/, "the account says the phone is not verified");
  assert.match(me, /decideRule/);
});

test("auth: sign-up and log-in routes, PIN lock from Retry-After, the phone-not-verified note, device voice only", () => {
  const auth = read("public/js/app/auth.js");
  assert.match(auth, /"\/api\/auth\/register"/);
  assert.match(auth, /"\/api\/auth\/login"/);
  assert.match(auth, /retry-after/i);
  assert.match(auth, /au\.notVerified/);
  assert.match(auth, /au\.locked/);
  assert.match(auth, /loginWithPasskey/);
  assert.match(auth, /autoAdvance: true/, "D13: the keypad moves on at 10 digits");
  assert.doesNotMatch(auth, /\/api\/speak/, "no session yet: the question is read by the device voice");
  assert.match(read("public/js/app/welcome.js"), /createAuth\(\{ mode: "legacy" \}\)/);
});

test("the simulated vendor label and the automated-assistant notice stay on these screens", () => {
  assert.match(read("public/js/app/history.js"), /pill-sim[\s\S]{0,80}t\("simulated"\)/);
  assert.match(read("public/js/app/auth.js"), /notice\.short/);
  assert.match(read("public/js/app/boot-screens.js"), /notice\.long/);
});
