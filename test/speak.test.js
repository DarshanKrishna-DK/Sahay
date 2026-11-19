"use strict";

const { FAKE } = require("./_env");

// Speak-it (plan Task B3): every card can be read aloud from a server-built sentence.
Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  MURF_REGION: "global",
  MURF_VOICE_HI: "hi-IN-khyati",
  MURF_VOICE_EN: "en-IN-isha",
  MURF_VOICE_KN: "kn-IN-harshitha",
  SAHAY_ACCESS_CODE: "",
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, beforeEach } = require("node:test");
const express = require("express");

const { createApiRouter, errorHandler, voice } = require("../src/routes/api");
const repo = require("../src/db/repo");
const events = require("../src/events");
const limits = require("../src/limits");
const approvals = require("../src/approvals");
const agent = require("../src/agora/agent");
const rules = require("../src/agent/rules");
const profile = require("../src/agent/profile");
const speak = require("../src/agent/speak");
const { scriptProblems } = require("../src/agora/script");

beforeEach(() => {
  limits.reset();
  fs.rmSync(speak.cacheDir(), { recursive: true, force: true });
});

const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb]);

/** Fake Murf at the network boundary; `fail` answers 500. */
function fakeMurf(t, { fail = false } = {}) {
  const calls = [];
  speak.setFetch(async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    if (fail) return new Response("upstream broke", { status: 500 });
    return new Response(MP3, { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  });
  t.after(() => speak.setFetch(null));
  return calls;
}

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

/** A requirement, a simulated vendor's quote, an approval (approved by button) and its order. */
function seedOrder(businessId) {
  const need = repo.createRequirement(businessId, { item: "चावल", quantity: 50, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "simulated", name: "BS Foods" });
  const neg = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
  const quote = repo.createQuote(businessId, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 62, unit: "kg", freight: 0, landed_cost: 3100 });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  const order = repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
  return { need, approval, order };
}

const NATIVE = { latin: [], foreign: false };

/* ------------------------------------------------------------ sentences --- */

test("every key kind gives a server-built sentence in the business's current reply language", () => {
  const biz = seedBusiness("hi-IN");
  const { need, approval, order } = seedOrder(biz);
  const rule = rules.propose(biz, { kind: "max_price", params: { item: "चावल", unit: "kg", price: 80 }, source: "owner_said" });
  rules.decide(biz, rule.id, "keep", { via: "button" });
  const [memory] = require("../src/agent/memories").refresh(biz);

  const allow = ["BS Foods", order.po_number];
  for (const key of ["now", `rule:${rule.id}`, `memory:${memory.id}`, `approval:${approval.id}`, `order:${order.id}`, `need:${need.id}`]) {
    const { text, language } = speak.sentenceFor(biz, key);
    assert.equal(language, "hi-IN", key);
    assert.ok(text.length > 5, key);
    assert.deepEqual(scriptProblems(text, "hi-IN", { allow }), NATIVE, `${key}: ${text}`);
  }
  assert.equal(speak.sentenceFor(biz, `rule:${rule.id}`).text, rule.sentence["hi-IN"]);
  assert.match(speak.sentenceFor(biz, `approval:${approval.id}`).text, /कुल 3100 रुपये/);
  assert.match(speak.sentenceFor(biz, `approval:${approval.id}`).text, /सिम्युलेटेड/, "a simulated vendor is said to be one");
  assert.match(speak.sentenceFor(biz, `need:${need.id}`).text, /50 किलो चावल/);

  // An owner's reply_language rule moves every sentence to that language.
  const kn = rules.propose(biz, { kind: "reply_language", params: { language: "kn-IN" }, source: "owner_said" });
  rules.decide(biz, kn.id, "keep", { via: "button" });
  const out = speak.sentenceFor(biz, `order:${order.id}`);
  assert.equal(out.language, "kn-IN");
  assert.deepEqual(scriptProblems(out.text, "kn-IN", { allow }), NATIVE, out.text);
  assert.equal(speak.sentenceFor(biz, `rule:${rule.id}`).text, rule.sentence["kn-IN"]);
});

test("'now' says what Sahay is doing: a deal waiting first, then work running, else free", () => {
  const biz = seedBusiness("en-IN");
  assert.match(speak.sentenceFor(biz, "now").text, /free/);
  const need = repo.createRequirement(biz, { item: "rice", quantity: 5, unit: "kg" });
  const job = repo.createJob(biz, { kind: "sourcing", requirement_id: need.id });
  repo.transitionJob(biz, job.id, "queued", "running");
  assert.match(speak.sentenceFor(biz, "now").text, /looking for vendors/);
  const vendor = repo.createVendor(biz, { requirement_id: need.id, source: "indiamart", name: "BS Foods" });
  const neg = repo.createNegotiation(biz, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "human" });
  const quote = repo.createQuote(biz, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 60, unit: "kg", freight: 0, landed_cost: 300 });
  approvals.requestApproval(biz, quote.id);
  assert.match(speak.sentenceFor(biz, "now").text, /waiting for your yes/);
});

test("an unknown key, a malformed key or another business's id is not found", () => {
  const mine = seedBusiness();
  const theirs = seedBusiness();
  const { order } = seedOrder(theirs);
  const rule = rules.propose(theirs, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  for (const key of ["", "later", "rule:", `rule:${rule.id}`, `order:${order.id}`, "memory:mem_x", "need:req_x", "approval:apr_x", "text:hello there", 42, null]) {
    assert.throws(() => speak.sentenceFor(mine, key), (err) => err.code === "SPEAK_KEY_NOT_FOUND", String(key));
  }
});

/* --------------------------------------------------------------- audio --- */

test("with no live call the sentence is Murf audio, cached by hash and served from the cache the second time", async (t) => {
  const calls = fakeMurf(t);
  const biz = seedBusiness("hi-IN");
  profile.update(biz, { voice_speed: "slow" });
  const first = await speak.speak(biz, "now");
  assert.equal(first.kind, "audio");
  assert.deepEqual(first.audio, MP3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://global.api.murf.ai/v1/speech/stream");
  assert.equal(calls[0].headers["api-key"], FAKE.MURF_API_KEY);
  assert.deepEqual(
    { ...calls[0].body, text: undefined },
    { text: undefined, voiceId: "hi-IN-khyati", model: "falcon-2.1", locale: "hi-IN", format: "MP3", sampleRate: 24000, channelType: "MONO", rate: -20 },
  );
  assert.equal(calls[0].body.text, speak.sentenceFor(biz, "now").text);
  const cached = fs.readdirSync(speak.cacheDir());
  assert.equal(cached.length, 1);
  assert.match(cached[0], /^[0-9a-f]{64}\.mp3$/);

  const second = await speak.speak(biz, "now");
  assert.deepEqual(second.audio, MP3);
  assert.equal(calls.length, 1, "served from the cache without calling Murf");
});

test("a Murf failure is an error, never silence, and nothing is cached", async (t) => {
  fakeMurf(t, { fail: true });
  const biz = seedBusiness("en-IN");
  await assert.rejects(speak.speak(biz, "now"), (err) => err.code === "MURF_FAILED");
  assert.equal(fs.existsSync(speak.cacheDir()) ? fs.readdirSync(speak.cacheDir()).length : 0, 0);
});

test("in a live call the agent says it instead, and nothing is fetched from Murf", async (t) => {
  const murf = fakeMurf(t);
  const spoken = [];
  agent.setFetch(async (url, init) => {
    spoken.push({ url, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  const biz = seedBusiness("en-IN");
  const out = await speak.speak(biz, "now", { agentId: "AGL" });
  assert.deepEqual(out, { kind: "spoken" });
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].url, /agents\/AGL\/speak$/);
  assert.equal(spoken[0].body.text, speak.sentenceFor(biz, "now").text);
  assert.equal(spoken[0].body.priority, "APPEND");
  assert.equal(murf.length, 0);
});

/* -------------------------------------------------------------- the route --- */

async function withApp(run) {
  const app = express();
  app.use(createApiRouter());
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function signUp(base) {
  const res = await fetch(`${base}/api/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Asha Kirana", city: "Bengaluru", language: "hi-IN" }) });
  return { cookie: res.headers.get("set-cookie").split(";")[0], business: (await res.json()).business };
}

const post = (base, cookie, body) =>
  fetch(`${base}/api/speak`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/speak: audio/mpeg without a call, {spoken:true} in one, 404 for a foreign key, 429 on the 31st in ten minutes", async (t) => {
  fakeMurf(t);
  agent.setFetch(async () => new Response("{}", { status: 200 }));
  t.after(() => agent.setFetch(null));
  await withApp(async (base) => {
    const noCookie = await fetch(`${base}/api/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noCookie.status, 401);

    const me = await signUp(base);
    const audio = await post(base, me.cookie, { key: "now" });
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), MP3);

    const other = seedBusiness();
    const rule = rules.propose(other, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
    const foreign = await post(base, me.cookie, { key: `rule:${rule.id}` });
    assert.equal(foreign.status, 404);
    assert.equal((await post(base, me.cookie, { text: "say anything" })).status, 400, "free text is never accepted");

    voice.set(me.business.id, { sessionId: null, channel: "own-x", agentId: "AGL" });
    t.after(() => voice.delete(me.business.id));
    const live = await post(base, me.cookie, { key: "now" });
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { spoken: true });

    for (let i = 0; i < 27; i++) assert.equal((await post(base, me.cookie, { key: "now" })).status, 200, `call ${i + 4}`);
    const limited = await post(base, me.cookie, { key: "now" });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
  });
});

/* ------------------------------------------- Sell, Stock and Money cards --- */

const gstLib = require("../src/sell/gst");
const sellSettings = require("../src/sell/settings");
const sellCustomers = require("../src/sell/customers");
const sellInvoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const gate = require("../src/sell/gate");
const khata = require("../src/sell/khata");
const stockLedger = require("../src/stock");
const stockItems = require("../src/stock/items");

/** A GST-registered shop with basmati rice (HSN + GST confirmed), Ramesh Traders and a drafted 50 kg bill. */
function seedSale(language = "hi-IN") {
  const biz = repo.newId("biz");
  repo.createBusiness(biz, { name: "Asha Kirana", city: "Bengaluru", state: "Karnataka", language });
  sellSettings.save(biz, { gst_scheme: "regular", gstin: "29AAPFU0939F1Z" + gstLib.checksumChar("29AAPFU0939F1Z") });
  const text = itemTax.readback({ item: "basmati rice", hsn: "1006", gstRate: 5, unitWord: "kg" }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: "basmati rice", unit: "kg", hsn: "1006", gstRate: 5, agentId: "AG-s", text });
  const history = [{ role: "assistant", content: text, metadata: { source: "command" }, turn_id: 1 }, { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: 2 }];
  const rice = itemTax.confirm(biz, { agentId: "AG-s", history }).item;
  const { customer } = sellCustomers.save(biz, { name: "Ramesh Traders", phone: "9845012345" });
  const invoice = sellInvoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 50, rate: 90 }] });
  return { biz, rice, customer, invoice };
}

test("invoice:<id> reads a bill waiting for a yes exactly as the server's read-back, and an issued bill with its number, total and what is still due", () => {
  const { biz, customer, invoice } = seedSale("hi-IN");
  const waiting = speak.sentenceFor(biz, `invoice:${invoice.id}`);
  assert.equal(waiting.language, "hi-IN");
  assert.equal(waiting.text, gate.buildReadback(biz, sellInvoices.get(biz, invoice.id), "hi-IN"));
  assert.deepEqual(scriptProblems(waiting.text, "hi-IN", { allow: ["Ramesh Traders"] }), NATIVE, waiting.text);

  const { approval } = gate.requestInvoiceApproval(biz, invoice.id);
  const issued = gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "button" }).invoice;
  const unpaid = speak.sentenceFor(biz, `invoice:${invoice.id}`).text;
  assert.equal(unpaid, `Ramesh Traders का बिल ${issued.number}। कुल 4 हज़ार 725 रुपये। अभी भुगतान नहीं हुआ।`);
  assert.deepEqual(scriptProblems(unpaid, "hi-IN", { allow: ["Ramesh Traders", issued.number] }), NATIVE, unpaid);

  khata.recordReceipt(biz, { customerId: customer.id, amount: 2000, mode: "cash", invoiceId: invoice.id });
  assert.match(speak.sentenceFor(biz, `invoice:${invoice.id}`).text, /2 हज़ार 725 रुपये बाकी है।$/);
  khata.recordReceipt(biz, { customerId: customer.id, amount: 2725, mode: "upi", invoiceId: invoice.id });
  assert.match(speak.sentenceFor(biz, `invoice:${invoice.id}`).text, /भुगतान हो गया।$/);

  // The owner's reply language moves it, in that script.
  const kn = rules.propose(biz, { kind: "reply_language", params: { language: "kn-IN" }, source: "owner_said" });
  rules.decide(biz, kn.id, "keep", { via: "button" });
  const out = speak.sentenceFor(biz, `invoice:${invoice.id}`);
  assert.equal(out.language, "kn-IN");
  assert.equal(out.text, `Ramesh Traders ಅವರ ಬಿಲ್ ${issued.number}. ಒಟ್ಟು 4 ಸಾವಿರ 725 ರೂಪಾಯಿ. ಪಾವತಿ ಆಗಿದೆ.`);
});

test("item:<id> says what is left (and when it is low) like get_stock; owed:<customerId> says who owes how much like who_owes_me", () => {
  const { biz, rice, customer, invoice } = seedSale("en-IN");
  assert.equal(speak.sentenceFor(biz, `item:${rice.id}`).text, "The stock of basmati rice has not been counted yet.");
  stockLedger.setCount(biz, { itemId: rice.id, qty: 120, unit: "kg" });
  assert.equal(speak.sentenceFor(biz, `item:${rice.id}`).text, "120 kilograms of basmati rice left.");

  assert.equal(speak.sentenceFor(biz, `owed:${customer.id}`).text, "Ramesh Traders owes nothing.");
  const { approval } = gate.requestInvoiceApproval(biz, invoice.id);
  gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "button" });
  assert.equal(speak.sentenceFor(biz, `owed:${customer.id}`).text, "Ramesh Traders owes 4 thousand 725 rupees.");
  assert.equal(speak.sentenceFor(biz, `item:${rice.id}`).text, "70 kilograms of basmati rice left.", "the sale took 50 kg out");

  const hi = rules.propose(biz, { kind: "reply_language", params: { language: "hi-IN" }, source: "owner_said" });
  rules.decide(biz, hi.id, "keep", { via: "button" });
  const owed = speak.sentenceFor(biz, `owed:${customer.id}`);
  assert.equal(owed.text, "Ramesh Traders के 4 हज़ार 725 रुपये बाकी हैं।");
  const item = speak.sentenceFor(biz, `item:${rice.id}`).text;
  assert.deepEqual(scriptProblems(item, "hi-IN"), NATIVE, item);
  assert.match(item, /बासमती/);
});

test("invoice, item and owed keys of another business are not found", () => {
  const mine = seedBusiness("en-IN");
  const { rice, customer, invoice } = seedSale("en-IN");
  for (const key of [`invoice:${invoice.id}`, `item:${rice.id}`, `owed:${customer.id}`, "invoice:inv_x", "item:itm_x", "owed:cus_x"]) {
    assert.throws(() => speak.sentenceFor(mine, key), (err) => err.code === "SPEAK_KEY_NOT_FOUND", key);
  }
});

test("POST /api/speak reads a bill aloud with Murf, under the same rate limit", async (t) => {
  const calls = fakeMurf(t);
  await withApp(async (base) => {
    const me = await signUp(base);
    const { customer } = sellCustomers.save(me.business.id, { name: "Ramesh Traders" });
    const res = await post(base, me.cookie, { key: `owed:${customer.id}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/mpeg");
    assert.match(calls.at(-1).body.text, /Ramesh Traders/);
  });
});
