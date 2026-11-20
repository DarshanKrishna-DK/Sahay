"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  TELEGRAM_BOT_TOKEN: FAKE.TELEGRAM_BOT_TOKEN,
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const registry = require("../src/tools/registry");
const repo = require("../src/db/repo");
const store = require("../src/db/suppliers");
const telegram = require("../src/notify/telegram");
const { PHRASES } = require("../src/tools/suppliers");
const { scriptProblems } = require("../src/agora/script");

function fakeTelegram(t) {
  const calls = [];
  telegram.setFetch(async (url, init) => {
    calls.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), { status: 200 });
  });
  t.after(() => telegram.setFetch(null));
  return calls;
}

function ownerCtx(language = "hi-IN") {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Kirana", city: "Bengaluru", language });
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, status: "active" });
  return { businessId, sessionId: session.id, agentId: null, actor: "agent", toolScope: "owner" };
}

test("add_supplier adds a real supplier, sends the start link to the owner's Telegram, and never speaks the link", async (t) => {
  const calls = fakeTelegram(t);
  const ctx = ownerCtx("hi-IN");
  repo.setTelegramLink(ctx.businessId, "111");
  const out = await registry.callTool(ctx, "add_supplier", { name: "Ramesh Traders", items: ["चावल", "दाल"], reply_language: "hi-IN" });
  assert.equal(out.supplier.name, "Ramesh Traders");
  assert.equal(out.supplier.language, "hi-IN", "defaults to the business language");
  assert.equal(out.sentToOwner, true);
  assert.equal(calls[0].body.chat_id, "111");
  assert.ok(calls[0].body.text.includes(out.deepLink));
  assert.equal(out.say, "Ramesh Traders को आपके सप्लायर के रूप में जोड़ दिया। उनका टेलीग्राम लिंक आपके टेलीग्राम पर भेज दिया है, उन्हें आगे भेज दीजिए; वे उसे खोलेंगे तो मैं उनसे बात कर सकूँगी।");
  assert.doesNotMatch(out.say, /https?:|t\.me/);

  // The same name again: no duplicate, a fresh link.
  const again = await registry.callTool(ctx, "add_supplier", { name: "ramesh  traders", items: ["rice"], reply_language: "en-IN" });
  assert.equal(again.already, true);
  assert.notEqual(again.deepLink, out.deepLink);
  assert.equal(store.listSuppliers(ctx.businessId).length, 1);
  assert.equal(again.say, "Ramesh Traders is already your supplier; I've sent a new Telegram link to your Telegram.");
});

test("add_supplier without a linked owner chat says the link is on the screen; bad input is refused with a spoken line", async (t) => {
  fakeTelegram(t);
  const ctx = ownerCtx("en-IN");
  const out = await registry.callTool(ctx, "add_supplier", { name: "Sunil", items: ["oil"], language: "kn-IN", reply_language: "en-IN" });
  assert.equal(out.sentToOwner, false);
  assert.equal(out.supplier.language, "kn-IN");
  assert.match(out.say, /on the screen/);
  await assert.rejects(registry.callTool(ctx, "add_supplier", { name: "X", items: ["  "], reply_language: "en-IN" }), (err) => err.code === "INVALID_SUPPLIER" && err.say.length > 0);
  await assert.rejects(registry.callTool(ctx, "add_supplier", { items: ["rice"] }), (err) => err.code === "INVALID_ARGUMENTS");
});

test("list_suppliers names each supplier and whether Sahay can reach them; another business sees none", async (t) => {
  fakeTelegram(t);
  const ctx = ownerCtx("en-IN");
  const empty = await registry.callTool(ctx, "list_suppliers", { reply_language: "en-IN" });
  assert.deepEqual(empty.suppliers, []);
  assert.match(empty.say, /no suppliers of your own yet/);
  const a = store.createSupplier(ctx.businessId, { name: "Ramesh", items: ["rice"], language: "hi-IN" });
  store.setTelegramChat(ctx.businessId, a.id, "777");
  store.createSupplier(ctx.businessId, { name: "Sunil", items: ["oil"], language: "en-IN" });
  const out = await registry.callTool(ctx, "list_suppliers", { reply_language: "en-IN" });
  assert.equal(out.say, "You have 2 suppliers: Ramesh, linked on Telegram; Sunil, not linked on Telegram yet.");
  assert.equal(JSON.stringify(out).includes("777"), false, "no chat id in a tool result");
  const other = ownerCtx("en-IN");
  assert.deepEqual((await registry.callTool(other, "list_suppliers", {})).suppliers, []);
});

test("every supplier say line is in the native script of its language", () => {
  const groups = [PHRASES, { shortlist_own: registry.PHRASES.shortlist_own, negotiation_started_supplier: registry.PHRASES.negotiation_started_supplier, supplier_not_linked: registry.PHRASES.supplier_not_linked, supplier_unreachable: registry.PHRASES.supplier_unreachable }];
  for (const table of groups) {
    for (const [key, byLang] of Object.entries(table)) {
      for (const lang of ["hi-IN", "kn-IN"]) {
        const line = byLang[lang]({ name: "", vendor: "", count: 2, list: "", sent: true, linked: true });
        assert.deepEqual(scriptProblems(line, lang), { latin: [], foreign: false }, `${key} ${lang}: ${line}`);
      }
    }
  }
});
