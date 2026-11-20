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

test("v5: every new My Sahay and auth word is in three languages, Hindi in Devanagari and Kannada in Kannada script", () => {
  for (const f of ["public/js/app/me.js", "public/js/app/auth.js"]) {
    const rows = stringRows(read(f));
    assert.ok(rows.size > 5, `${f}: ${rows.size} rows`);
    for (const [key, [en, hi, kn]] of rows) {
      assert.ok(en && hi && kn, key);
      assert.match(hi, /[ऀ-ॿ]|^GST$/, `${key} hi is Devanagari`);
      assert.match(kn, /[ಀ-೿]|^GST$/, `${key} kn is Kannada script`);
      assert.doesNotMatch(en, /^[A-Z][A-Z ]{3,}$/, `${key}: sentence case, never all caps`);
    }
  }
});

test("v5 log in (screens.md 09): phone, PIN keypad with autoAdvance and the error slot, Log in, passkey, the footer; the words never follow the shop's language", () => {
  const auth = read("public/js/app/auth.js");
  assert.match(auth, /"\/api\/auth\/login"/);
  assert.match(auth, /"\/api\/auth\/register"/);
  assert.match(auth, /retry-after/i, "PIN lock minutes from Retry-After");
  assert.match(auth, /createKeypad\(\{ length, mask: true, label, onDone, autoAdvance: true \}\)/);
  assert.match(auth, /pad\.setError\(fieldError\)/, "errors sit between the dots and the keys");
  assert.match(auth, /au5\.passkey/);
  assert.match(auth, /au5\.footer/, "automated assistant + test mode");
  assert.match(auth, /au\.notVerified/, "sign-up says the phone is not verified");
  assert.doesNotMatch(auth, /setLang\(/, "log in never switches the words to the shop's language");
  assert.doesNotMatch(auth, /Get code|OTP|otp/, "Sahay sends no SMS codes: no invented code step");
  assert.match(read("public/js/app/screens.js"), /export const AUTH = createAuth;/);
});

test("v5 My Sahay (screens.md 08): Talk to Sahay opens a sheet first; the ask-before-order toggle is on and locked; no invented spending limit or voice sample", () => {
  const me = read("public/js/app/me.js");
  assert.match(me, /pageHead\(\{ title: t\("me\.title"\), sentence: t\("me5\.pageSentence"\), action: \{ word: t\("me5\.talk"\), icon: "mic", onClick: openTalk \} \}\)/);
  const openTalk = me.slice(me.indexOf("function openTalk"), me.indexOf("function renderHead"));
  assert.match(openTalk, /openSheet\(/);
  assert.match(openTalk, /const start = \(\) => \{[\s\S]*sahay:talk/, "the call starts only from Start talking");
  assert.match(me, /box\.disabled = true/, "Ask me before every order cannot be switched off");
  assert.doesNotMatch(me.replace(/^\s*\/\/.*$/gm, ""), /spending|Play sample|voice sample/i);
  assert.match(me, /me5\.rememberLabel/);
  assert.match(me, /createHistoryPanel/);
  assert.match(read("public/js/app/screens.js"), /me: createMe,/);
});

