"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const repo = require("../src/db/repo");
const store = require("../src/db/suppliers");
const suppliers = require("../src/suppliers");
const telegram = require("../src/notify/telegram");
const events = require("../src/events");
const { isNativeScript } = require("../src/agora/script");

/** Fake the Telegram Bot API at the network boundary; records method + parsed body. No real network. */
function fakeTelegram(t, reply = () => ({ ok: true, result: { message_id: 7 } })) {
  const calls = [];
  telegram.setFetch(async (url, init) => {
    assert.ok(String(url).startsWith(`https://api.telegram.org/bot${FAKE.TELEGRAM_BOT_TOKEN}/`));
    const method = String(url).split("/").pop();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, body });
    const out = reply(method, body);
    return new Response(JSON.stringify(out), { status: out.ok ? 200 : 400 });
  });
  t.after(() => telegram.setFetch(null));
  return calls;
}

function seedBusiness(language = "hi-IN", name = "Asha Kirana") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, city: "Bengaluru", language });
  return id;
}

const startUpdate = (text, chatId = 777) => ({ update_id: 1, message: { message_id: 1, text, chat: { id: chatId, type: "private" } } });

async function linkedSupplier(t, businessId, fields = {}, chatId = 777) {
  const calls = fakeTelegram(t);
  const { supplier, invite } = await suppliers.addSupplier(businessId, { name: "Ramesh Traders", items: ["rice", "dal"], language: "hi-IN", ...fields });
  await telegram.handleUpdate(startUpdate(`/start ${invite.code}`, chatId));
  return { supplier: store.getSupplier(businessId, supplier.id), calls };
}

/* ------------------------------------------------------------ store --- */

test("suppliers are tenant-scoped: another business cannot read, list or remove them", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const s = store.createSupplier(a, { name: "  Ramesh\nTraders ", items: "rice, dal,  rice", language: "hi-IN" });
  assert.equal(s.name, "Ramesh Traders", "control characters and spacing are cleaned");
  assert.deepEqual(s.items, ["rice", "dal"], "items de-duplicated");
  assert.equal(s.linked, false);
  assert.equal(s.simulated, false);
  assert.equal(store.getSupplier(b, s.id), null);
  assert.deepEqual(store.listSuppliers(b), []);
  assert.equal(store.removeSupplier(b, s.id), false);
  assert.equal(store.listSuppliers(a).length, 1);
  assert.throws(() => store.createSupplier(a, { name: "X", items: [], language: "hi-IN" }), /items/);
  assert.throws(() => store.createSupplier(a, { name: "X", items: ["rice"], language: "fr-FR" }), /language/);
  assert.throws(() => store.createSupplier(a, { name: "X", items: ["rice"], language: "hi-IN", phone: "call me" }), /phone/);
  assert.throws(() => store.createSupplier("", { name: "X", items: ["rice"], language: "hi-IN" }), /business/);
});

test("a supplier start code is distinct from an owner code, one-time, and replaced by a newer one", () => {
  const businessId = seedBusiness();
  const s = store.createSupplier(businessId, { name: "Ramesh", items: ["rice"], language: "hi-IN" });
  const first = suppliers.createInvite(businessId, s.id);
  assert.match(first.code, /^sup_[A-Za-z0-9_-]{16}$/);
  assert.equal(first.deepLink, `https://t.me/sahaymitra_bot?start=${first.code}`);
  assert.equal(store.isSupplierCode(first.code), true);
  assert.equal(store.isSupplierCode(telegram.createLinkCode(businessId).code), false, "owner codes have no prefix");
  const second = suppliers.createInvite(businessId, s.id);
  assert.equal(store.system.redeemLinkCode(first.code), null, "an older code stops working");
  assert.deepEqual(store.system.redeemLinkCode(second.code), { businessId, supplierId: s.id });
  assert.equal(store.system.redeemLinkCode(second.code), null, "used once");
  const expired = suppliers.createInvite(businessId, s.id, { now: Date.now() - 8 * 24 * 60 * 60 * 1000 });
  assert.equal(store.system.redeemLinkCode(expired.code), null, "expired after 7 days");
});

/* --------------------------------------------------------- Telegram --- */

test("addSupplier sends the start link to the owner's linked chat, never the supplier's chat id to anyone", async (t) => {
  const calls = fakeTelegram(t);
  const businessId = seedBusiness("en-IN");
  repo.setTelegramLink(businessId, "111");
  const out = await suppliers.addSupplier(businessId, { name: "Ramesh Traders", items: ["rice"], language: "hi-IN" });
  assert.equal(out.sentToOwner, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "111");
  assert.ok(calls[0].body.text.includes(out.invite.deepLink));
  assert.equal("telegram_chat_id" in out.supplier, false, "the app view has no chat id");
});

test("/start sup_<code> links the chat to the supplier and answers in their language, disclosure first", async (t) => {
  const businessId = seedBusiness("en-IN");
  repo.setTelegramLink(businessId, "777"); // the owner demos as their own supplier: one chat, both roles
  const seen = [];
  const off = events.subscribe(businessId, (e) => seen.push(e.type));
  t.after(off);
  const { supplier, calls } = await linkedSupplier(t, businessId, { language: "kn-IN" });
  assert.equal(supplier.telegram_chat_id, "777");
  assert.equal(supplier.linked, true);
  assert.equal(repo.getTelegramLink(businessId).chat_id, "777", "the owner link is untouched");
  const reply = calls.find((c) => c.method === "sendMessage" && /ಸಹಾಯ್/.test(c.body.text));
  assert.ok(reply, "a Kannada reply");
  assert.match(reply.body.text, /^ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, Asha Kirana ಪರವಾಗಿ ಮಾತನಾಡುವ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ\./, "first sentence: automated assistant for the shop");
  assert.ok(seen.includes("supplier.linked"));

  // A used or unknown supplier code links nothing and says so.
  const again = await telegram.handleUpdate(startUpdate("/start sup_AAAAAAAAAAAAAAAA", 999));
  assert.deepEqual(again, { handled: true, linked: false, supplier: true });
  assert.match(calls.at(-1).body.text, /automated assistant/);
});

test("sendToChat puts the join link on a button and in the text", async (t) => {
  const calls = fakeTelegram(t);
  await telegram.sendToChat("42", "hello\nhttps://sahay.test/vendor/abc", { button: { text: "Tap to talk now", url: "https://sahay.test/vendor/abc" } });
  assert.deepEqual(calls[0].body.reply_markup, { inline_keyboard: [[{ text: "Tap to talk now", url: "https://sahay.test/vendor/abc" }]] });
  assert.deepEqual(calls[0].body.link_preview_options, { is_disabled: true });
});

/* -------------------------------------------------------- shortlist --- */

test("a linked supplier who sells the need joins its shortlist first, as a real human vendor; unlinked ones are named", async (t) => {
  const businessId = seedBusiness("hi-IN");
  const { supplier } = await linkedSupplier(t, businessId, { items: ["चावल"] });
  store.createSupplier(businessId, { name: "Sunil Dal Mill", items: ["basmati rice"], language: "en-IN" }); // never linked
  store.createSupplier(businessId, { name: "Oil Depot", items: ["mustard oil"], language: "hi-IN" });
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", max_price: 70 });
  const listed = repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders", listed_price: 60, listed_unit: "kg", score: 0.9 });

  const out = suppliers.addToShortlist(businessId, need);
  assert.equal(out.added.length, 1);
  assert.deepEqual(out.unlinked, ["Sunil Dal Mill"]);
  const vendor = out.added[0];
  assert.equal(vendor.kind, "human");
  assert.equal(vendor.simulated, false);
  assert.equal(vendor.listed_price, null, "no made-up price");
  assert.equal(suppliers.supplierForVendor(businessId, vendor.id).id, supplier.id);
  assert.equal(suppliers.addToShortlist(businessId, need).added.length, 0, "idempotent");

  const ranked = suppliers.ownFirst(businessId, need.id, [listed, vendor]);
  assert.deepEqual(ranked.map((v) => v.id), [vendor.id, listed.id]);
  assert.equal(suppliers.supplierForVendor(businessId, listed.id), null);
});

test("sells: item words in either direction and across Hindi and English", () => {
  const s = (items) => ({ items });
  assert.equal(suppliers.sells(s(["rice"]), "basmati rice"), true);
  assert.equal(suppliers.sells(s(["basmati rice"]), "rice"), true);
  assert.equal(suppliers.sells(s(["चावल"]), "rice"), true);
  assert.equal(suppliers.sells(s(["dal"]), "basmati rice"), false);
});

/* ------------------------------------------------------- invitation --- */

test("the invitation opens with the disclosure, says shop, quantity and item in the supplier's script, and carries the link", async (t) => {
  const businessId = seedBusiness("en-IN", "Asha Kirana");
  for (const [language, disclosure, script] of [
    ["hi-IN", /^नमस्ते, मैं सहाय हूँ, Asha Kirana की ओर से बात करने वाली एक स्वचालित सहायक।/, "hi-IN"],
    ["kn-IN", /^ನಮಸ್ಕಾರ, ನಾನು ಸಹಾಯ್, Asha Kirana ಪರವಾಗಿ ಮಾತನಾಡುವ ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ\./, "kn-IN"],
    ["en-IN", /^Hello, this is Sahay, an automated assistant for Asha Kirana\./, "en-IN"],
  ]) {
    const { supplier, calls } = await linkedSupplier(t, businessId, { name: `Ramesh ${language}`, language }, 500 + language.length);
    const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", max_price: 70 });
    calls.length = 0;
    await suppliers.sendInvite({ businessId, supplier, requirement: need, joinUrl: "https://sahay.test/vendor/CODE" });
    const sent = calls[0].body;
    assert.match(sent.text, disclosure);
    assert.ok(sent.text.endsWith("\nhttps://sahay.test/vendor/CODE"));
    assert.ok(sent.text.includes("50"));
    assert.ok(sent.text.includes("15"), "the link's 15 minutes");
    assert.equal(sent.reply_markup.inline_keyboard[0][0].url, "https://sahay.test/vendor/CODE");
    const body = sent.text.split("\n")[0].replace(/Asha Kirana/g, "").replace(/Sahay/g, "");
    assert.ok(isNativeScript(body, script), `${language} text in its own script: ${body}`);
  }
});

test("an unlinked supplier is not invited: an error, never a silent skip", async () => {
  const businessId = seedBusiness();
  const s = store.createSupplier(businessId, { name: "Ramesh", items: ["rice"], language: "hi-IN" });
  const need = repo.createRequirement(businessId, { item: "rice", quantity: 5, unit: "kg" });
  await assert.rejects(suppliers.sendInvite({ businessId, supplier: s, requirement: need, joinUrl: "https://sahay.test/vendor/x" }), (err) => err.code === "SUPPLIER_NOT_LINKED");
});

/* ---------------------------------------------- after the order / no-show --- */

test("confirmOrder sends nothing for an order that is not with an own supplier", async (t) => {
  const calls = fakeTelegram(t);
  const businessId = seedBusiness();
  assert.deepEqual(await suppliers.confirmOrder(businessId, "ord_missing"), { sent: false, reason: "not_a_supplier_order" });
  assert.equal(calls.length, 0);
});

test("a supplier who never joined: the owner is told on Telegram that nothing was agreed and a simulated vendor is the option", async (t) => {
  const businessId = seedBusiness("en-IN");
  const { supplier, calls } = await linkedSupplier(t, businessId);
  repo.setTelegramLink(businessId, "111");
  const need = repo.createRequirement(businessId, { item: "rice", quantity: 5, unit: "kg", max_price: 50 });
  const [vendor] = suppliers.addToShortlist(businessId, need).added;
  repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "human" });
  const job = repo.createJob(businessId, { kind: "negotiation", requirement_id: need.id });
  calls.length = 0;
  await suppliers.onEvent({ businessId, type: "job.failed", data: { jobId: job.id, kind: "negotiation", code: "VENDOR_DID_NOT_JOIN" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "111");
  assert.match(calls[0].body.text, new RegExp(`^${supplier.name} did not open the link within 15 minutes, so nothing was agreed\\. If you like, I can negotiate with a simulated vendor instead\\.$`));
  // Other failures are not this message.
  await suppliers.onEvent({ businessId, type: "job.failed", data: { jobId: job.id, kind: "negotiation", code: "OTHER" } });
  assert.equal(calls.length, 1);
});

test("removing a supplier keeps its vendor row (quotes point at it) but it is no longer the owner's supplier", async (t) => {
  const businessId = seedBusiness();
  const { supplier } = await linkedSupplier(t, businessId);
  const need = repo.createRequirement(businessId, { item: "rice", quantity: 5, unit: "kg" });
  const [vendor] = suppliers.addToShortlist(businessId, need).added;
  assert.equal(suppliers.removeSupplier(businessId, supplier.id), true);
  assert.ok(repo.getVendor(businessId, vendor.id));
  assert.equal(suppliers.supplierForVendor(businessId, vendor.id), null);
  assert.equal(suppliers.removeSupplier(businessId, supplier.id), false);
});
