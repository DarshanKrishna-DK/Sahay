"use strict";

/**
 * Shop details / GST sheet (public/js/app/shop-settings.js + shop-facts.js).
 * shop-facts.js has no DOM and no imports, so it is loaded here as the browser loads it; the body
 * it builds is posted to the real POST /api/sell/settings router. The sheet and the screens that
 * open it need a browser, so they are checked from their sources.
 */

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

const auth = require("../src/auth");
const limits = require("../src/limits");
const repo = require("../src/db/repo");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const { createSellRouter } = require("../src/routes/sell");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const facts = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/shop-facts.js"))}`);
const validGstin = (first14) => first14 + gst.checksumChar(first14);

test.beforeEach(() => limits.reset());

function business({ state = "Karnataka", city = "Bengaluru" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", owner_name: "Asha", city, state, language: "hi-IN" });
  return id;
}

const cookieFor = (businessId) =>
  `${auth.COOKIE_NAME}=${auth.signSession({ businessId, sessionId: repo.newId("web"), scope: "browser", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

async function withApp(t) {
  const app = express();
  app.use(createSellRouter());
  app.use((err, _req, res, _next) => res.status(500).json({ code: "INTERNAL", message: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (businessId, body) => {
    const res = await fetch(`${base}/api/sell/settings`, {
      method: "POST",
      headers: { Cookie: cookieFor(businessId), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
}

/* ------------------------------------------------------- shop-facts.js -- */

test("the browser's state list is src/sell/gst.js STATES, code for code and name for name", async () => {
  const f = await facts();
  assert.deepEqual(f.STATES, gst.STATES);
  for (const [code] of gst.STATES) assert.equal(f.stateLabel(code, "en"), gst.stateName(code));
});

test("state names are shown in the owner's script where the list has one, else English", async () => {
  const f = await facts();
  assert.equal(f.stateLabel("29", "kn"), "ಕರ್ನಾಟಕ");
  assert.equal(f.stateLabel("29", "hi"), "कर्नाटक");
  assert.equal(f.stateLabel("10", "kn"), "Bihar", "no Kannada name for Bihar: English");
  assert.equal(f.stateIsNative("10", "kn"), false);
  assert.equal(f.stateIsNative("10", "hi"), true);
  assert.equal(f.stateLabel("99", "en"), null);
  const hi = f.statesFor("hi");
  assert.equal(hi.length, gst.STATES.length);
  assert.ok(hi.every((s) => /[ऀ-ॿ]/.test(s.label)), "every state has a Devanagari name");
  const kn = f.statesFor("kn");
  assert.ok(kn.some((s) => s.label === "ಕರ್ನಾಟಕ" && s.native));
  assert.ok(kn.some((s) => s.label === "Bihar" && !s.native));
});

test("GSTIN shape check: cleaned to capitals, 15 characters, a known state code; the check character is the server's", async () => {
  const f = await facts();
  const good = validGstin("29AAPFU0939F1Z");
  assert.equal(f.cleanGstin(` ${good.slice(0, 5).toLowerCase()} ${good.slice(5)}-x`), `${good}`.slice(0, 15));
  assert.equal(f.gstinProblem(good), "ok");
  assert.equal(f.gstinProblem(good.toLowerCase()), "ok");
  assert.equal(f.gstinProblem(""), "empty");
  assert.equal(f.gstinProblem(good.slice(0, 14)), "short");
  assert.equal(f.gstinProblem(`99${good.slice(2)}`), "shape", "99 is no state");
  assert.equal(f.gstinProblem(`29AAPFU0939F1X${good[14]}`), "shape", "the 14th character is always Z");
  const wrongCheck = good.slice(0, 14) + (good[14] === "Q" ? "R" : "Q");
  assert.equal(f.gstinProblem(wrongCheck), "ok", "the shape is right; the server refuses the check character");
  assert.throws(() => gst.parseGstin(wrongCheck), { code: "GSTIN_INVALID" });
  assert.equal(f.stateOfGstin(good), "29");
});

test("form problems: a GST scheme needs a GSTIN of the right shape; every scheme needs a state, which a GSTIN gives", async () => {
  const f = await facts();
  const good = validGstin("29AAPFU0939F1Z");
  assert.deepEqual(f.formProblems({ scheme: "unregistered", gstin: "", state: "" }), { state: "empty" });
  assert.deepEqual(f.formProblems({ scheme: "unregistered", gstin: "", state: "29" }), {});
  assert.deepEqual(f.formProblems({ scheme: "regular", gstin: "", state: "29" }), { gstin: "empty" });
  assert.deepEqual(f.formProblems({ scheme: "composition", gstin: good.slice(0, 10), state: "" }), { gstin: "short", state: "empty" });
  assert.deepEqual(f.formProblems({ scheme: "regular", gstin: good, state: "" }), {}, "the GSTIN gives the state");
});

test("missingFact says what supplier() refuses a bill for (GSTIN_REQUIRED, STATE_REQUIRED), from GET /api/sell settings", async () => {
  const f = await facts();
  const cases = [
    { biz: business(), fields: {} },
    { biz: business(), fields: { gst_scheme: "regular" } },
    { biz: business(), fields: { gst_scheme: "composition", gstin: validGstin("29AAPFU0939F1Z") } },
    { biz: business({ state: "", city: "Nowhere Town" }), fields: {} },
    { biz: business({ state: "", city: "Nowhere Town" }), fields: { gst_scheme: "regular" } },
  ];
  const seen = new Set();
  for (const { biz, fields } of cases) {
    if (Object.keys(fields).length) settings.save(biz, fields);
    let refused = null;
    try { settings.supplier(biz); } catch (err) { refused = err.code; }
    assert.equal(f.missingFact(f.normSettings(settings.get(biz))), refused, JSON.stringify(fields));
    seen.add(refused);
  }
  assert.deepEqual([...seen].sort(), [null, "GSTIN_REQUIRED", "STATE_REQUIRED"].sort());
  assert.deepEqual(f.SHOP_CODES, ["GSTIN_REQUIRED", "STATE_REQUIRED"]);
});

test("the sheet's body is what POST /api/sell/settings accepts; a bad check character comes back with a spoken say", async (t) => {
  const f = await facts();
  const post = await withApp(t);
  const biz = business({ state: "", city: "Nowhere Town" });
  const good = validGstin("29AAPFU0939F1Z");

  // Registered: the picker said Maharashtra, but the GSTIN is Karnataka's; the GSTIN's state is sent.
  const body = f.settingsBody({ scheme: "regular", gstin: good.toLowerCase(), state: "27", address: "  12 Market Road  " });
  assert.deepEqual(body, { gst_scheme: "regular", gstin: good, state: "29", address: "12 Market Road" });
  const saved = await post(biz, body);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.settings.gstScheme, "regular");
  assert.equal(saved.json.settings.gstin, good);
  assert.equal(saved.json.settings.stateCode, "29");
  assert.equal(saved.json.settings.address, "12 Market Road");
  assert.equal(f.missingFact(f.normSettings(saved.json.settings)), null);

  // Back to no GST: no GSTIN is sent and the server clears it; the address can be cleared too.
  const plain = f.settingsBody({ scheme: "unregistered", gstin: good, state: "29", address: "" });
  assert.equal("gstin" in plain, false);
  const back = await post(biz, plain);
  assert.equal(back.status, 200);
  assert.equal(back.json.settings.gstScheme, "unregistered");
  assert.equal(back.json.settings.gstin, null);
  assert.equal(back.json.settings.address, null);
  assert.equal(back.json.settings.stateCode, "29");

  // Right shape, wrong check character: refused by the server with its own words for the owner.
  const wrong = good.slice(0, 14) + (good[14] === "Q" ? "R" : "Q");
  const refused = await post(biz, f.settingsBody({ scheme: "composition", gstin: wrong, state: "", address: "" }));
  assert.equal(refused.status, 400);
  assert.equal(refused.json.code, "GSTIN_INVALID");
  assert.match(refused.json.say, /[ऀ-ॿ]/, "a Hindi shop gets its say in Devanagari");
});

/* ------------------------------------------------- the sheet and screens -- */

test("the sheet: three scheme tiles as a radio group, GSTIN capped at 15, Save never disabled, the server's say shown", () => {
  const src = read("public/js/app/shop-settings.js");
  assert.match(src, /SCHEMES\.map\(\(scheme\) => h\("button", \{\s*class: "choice gs-tile", type: "button", role: "radio"/);
  assert.match(src, /role: "radiogroup"/);
  assert.match(src, /maxlength: "15"/);
  assert.match(src, /autocapitalize: "characters"/);
  assert.match(src, /saveShopSettings\(settingsBody\(f\)\)/);
  assert.match(src, /err\.say \|\|/, "a refusal shows the server's say");
  assert.match(src, /readButton\("shop-details", sentence/, "the sheet has a read-aloud button");
  const save = /const save = h\("button", \{([^}]*)\}/.exec(src);
  assert.ok(save, "the Save button");
  assert.doesNotMatch(save[1], /disabled/, "Save is never a dead button");
  // GSTIN shown only for registered / composition.
  assert.match(src, /gstinBox\.hidden = !gst;/);
  const store = read("public/js/app/store-sell.js");
  assert.match(store, /agentRequest\("POST", "\/api\/sell\/settings", body\)/);
  assert.match(store, /sell\.settings = normSettings\(r\.settings\);/);
});

test("every shop string is in English, Devanagari and Kannada script; no emoji", () => {
  const src = read("public/js/app/shop-settings.js");
  const rows = [...src.matchAll(/"(shop\.[A-Za-z_.]+)": \[\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",?\s*\]/g)];
  assert.ok(rows.length >= 30, `found ${rows.length} strings`);
  for (const [, key, en, hi, kn] of rows) {
    assert.ok(en && !/[ऀ-ॿಀ-೿]/.test(en), `${key} en`);
    assert.match(hi, /[ऀ-ॿ]/, `${key} hi is Devanagari`);
    assert.match(kn, /[ಀ-೿]/, `${key} kn is Kannada`);
  }
  for (const file of ["shop-settings.js", "shop-facts.js"]) {
    assert.doesNotMatch(read(`public/js/app/${file}`), /\p{Extended_Pictographic}/u, `${file} has no emoji`);
  }
});

test("My Sahay shows the shop details; Sell shows the needs card and opens the sheet on GSTIN_REQUIRED / STATE_REQUIRED", () => {
  const me = read("public/js/app/me.js");
  // UI v3: My Sahay > Shop draws its own summary card from sell.settings and opens this sheet.
  assert.match(me, /import \{ openShopSheet \} from "\.\/shop-settings\.js";/);
  assert.match(me, /openShopSheet\(\{ opener: btn \}\)/);
  assert.match(me, /section === "shop" && \(all \|\| parts\.has\("sell"\)/);
  const sell = read("public/js/app/sell.js");
  assert.match(sell, /SHOP_CODES\.includes\(err\.code\)/, "a bill refused for shop details is not shown as 'already decided'");
  assert.match(sell, /u\.fix \? shopNeedCard\(u\.fix, u\.error\)/);
  assert.match(sell, /need \? shopNeedCard\(need\) : null, screenState\(\{ kind: "empty"/, "the empty state carries the card");
  const kit = read("public/js/app/shop-settings.js");
  assert.match(kit, /export function shopNeedCard\(code, say = null\)/);
  assert.match(kit, /say \|\| st\(`shop\.need\.\$\{code\}`\)/);
  const css = read("public/css/app.css");
  assert.match(css, /"head stars" "profile stars" "shop stars" "actions stars"/);
  assert.match(css, /"head" "stars" "profile" "shop" "actions"/);
});
