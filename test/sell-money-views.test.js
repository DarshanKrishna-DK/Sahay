"use strict";

/**
 * Sell and Money views (UI v5): checked from the sources (the modules need a browser).
 * Every owner string has English, Hindi in Devanagari and Kannada in Kannada script; no native
 * <select>; no emoji; the read-aloud keys used are ones the server knows; the money rules stay in
 * sell-facts.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const FILES = ["sell.js", "money.js", "money-pad.js", "shop-settings.js", "sell-rows.js"].map((f) => `public/js/app/${f}`);

test("every Sell / Money string is in English, Devanagari and Kannada script", () => {
  let n = 0;
  for (const file of FILES) {
    const src = read(file);
    for (const [, key, en, hi, kn] of src.matchAll(/"((?:sl5|mn5|mp5|shop)\.[A-Za-z_.]+)": \[\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",?\s*\]/g)) {
      n++;
      assert.ok(en && !/[ऀ-ॿಀ-೿]/.test(en), `${file} ${key} en`);
      if (en === hi && hi === kn) continue; // a Latin acronym the same in every language (GST, UPI)
      assert.match(hi, /[ऀ-ॿ]/, `${file} ${key} hi is Devanagari`);
      assert.match(kn, /[ಀ-೿]/, `${file} ${key} kn is Kannada`);
    }
  }
  assert.ok(n >= 120, `found ${n} strings`);
});

test("no native select, no emoji, no inline style colours", () => {
  for (const file of FILES) {
    const src = read(file);
    assert.doesNotMatch(src, /h\("select"/, `${file} uses a native select`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${file} has an emoji`);
  }
  for (const css of ["public/css/sell.css", "public/css/money.css"]) {
    const src = read(css);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${css} uses a raw hex colour (tokens only)`);
    assert.doesNotMatch(src, /backdrop-filter|text-transform:\s*uppercase|gradient\(/, `${css} has blur, caps or a gradient`);
  }
});

test("read-aloud keys on Sell and Money are server keys", () => {
  const { SERVER_KEY } = { SERVER_KEY: /^(?:(?:now|customers|khata)|(?:rule|memory|approval|order|need|invoice|item|owed):[A-Za-z0-9_]{1,64})$/ };
  for (const file of FILES) {
    for (const m of read(file).matchAll(/speakKey: [^`"]*[`"]([a-z]+):\$\{/g)) {
      assert.ok(SERVER_KEY.test(`${m[1]}:x1`), `${file}: ${m[1]} is not a server read-aloud key`);
    }
  }
});

test("Sell and Money are wired in screens.js; the pay pad records receipts and the bill path is by voice", () => {
  const screens = read("public/js/app/screens.js");
  assert.match(screens, /sell: createSell/);
  assert.match(screens, /money: createMoney/);
  const pad = read("public/js/app/money-pad.js");
  assert.match(pad, /recordReceipt\(\{ customerId, amount: amt, mode \}\)/);
  assert.match(pad, /notifyPaid\(/);
  assert.match(pad, /agentRequest\("POST", "\/api\/customers", \{ name, phone: digits \}\)/);
  const sell = read("public/js/app/sell.js");
  assert.match(sell, /"sahay:talk", \{ detail: \{ mode: "voice", hint: "sell.hint" \} \}/);
  const shop = read("public/js/app/shop-settings.js");
  assert.match(shop, /saveShopSettings\(settingsBody\(f\)\)/);
  assert.match(shop, /err\.say \|\|/, "a refusal shows the server's say");
});
