"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  // No Razorpay keys: the pay link is reported as not made, and nothing reaches Razorpay.
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
});

const assert = require("node:assert/strict");
const { test } = require("node:test");

const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const repo = require("../src/db/repo");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const invoices = require("../src/sell/invoices");
const stock = require("../src/stock");
const items = require("../src/stock/items");

const validGstin = (first14) => first14 + gst.checksumChar(first14);

function shop(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language });
  settings.save(id, { gstin: validGstin("29AAPFU0939F1Z") });
  return id;
}

const ctxFor = (businessId, agentId = "AG-T") => ({ businessId, sessionId: repo.newId("ses"), agentId, actor: "agent", toolScope: "owner" });

/** A fake live call: /speak lines show up in /history as server lines; call.owner(words) is an ASR turn. */
function fakeCall(t) {
  const call = { spoken: [], items: [], turn: 0 };
  call.owner = (content, source = "asr") => call.items.push({ role: "user", content, metadata: { source }, turn_id: ++call.turn });
  agent.setFetch(async (url, init) => {
    let json;
    if (/\/speak$/.test(url)) {
      const body = JSON.parse(init.body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
      json = { agent_id: "AG" };
    } else if (/\/history$/.test(url)) json = { contents: call.items.slice() };
    else throw new Error(`unexpected Agora call ${url}`);
    return new Response(JSON.stringify(json), { status: 200 });
  });
  t.after(() => agent.setFetch(null));
  return call;
}

const refused = async (promise, code) => {
  await assert.rejects(promise, (err) => err.name === "ToolError" && err.code === code && typeof err.say === "string" && err.say.length > 0);
};

test("the sell tools are registered for the owner agent only", () => {
  const owner = registry.toolNames("owner");
  for (const name of ["add_customer", "set_item", "draft_invoice", "request_invoice_approval", "confirm_invoice"]) assert.ok(owner.includes(name), name);
  assert.ok(!registry.toolNames("negotiation").includes("draft_invoice"));
});

test("voice: item tax read back and confirmed, bill drafted from the owner's words, read out, spoken yes issues it", async (t) => {
  const biz = shop();
  const ctx = ctxFor(biz);
  const call = fakeCall(t);

  call.owner("बासमती चावल किलो में, एचएसएन एक शून्य शून्य छह यानी 1006, जीएसटी 5 प्रतिशत");
  const asked = await registry.callTool(ctx, "set_item", { item: "बासमती चावल", unit: "किलो", hsn: "1006", gst_rate: 5 });
  assert.equal(asked.saved, false);
  assert.equal(asked.readbackSpoken, true);
  assert.match(call.spoken.join(" "), /एचएसएन कोड 1 0 0 6, जीएसटी 5 प्रतिशत/);
  call.owner("हाँ");
  const kept = await registry.callTool(ctx, "set_item", { confirm: true });
  assert.equal(kept.saved, true);
  assert.equal(kept.item.hsn, "1006");

  call.owner("रमेश ट्रेडर्स को पचास किलो बासमती चावल, पचानवे रुपये किलो");
  const drafted = await registry.callTool(ctx, "draft_invoice", { customer: "रमेश ट्रेडर्स", lines: [{ item: "बासमती चावल", quantity: 50, unit: "किलो", rate: 95 }] });
  assert.equal(drafted.saved, true);
  assert.equal(drafted.invoice.totals.totalPaise, 498750);
  assert.match(drafted.say, /4987.50/);

  const put = await registry.callTool(ctx, "request_invoice_approval", {});
  assert.equal(put.readbackSpoken, true);
  assert.equal(put.say, "बिल बनाऊँ, हाँ या ना?");
  assert.match(call.spoken.join(" "), /कुल 4987.50 रुपये। क्या मैं यह बिल बना दूँ\?/);
  // asked again: not read out again
  const before = call.spoken.length;
  await registry.callTool(ctx, "request_invoice_approval", {});
  assert.equal(call.spoken.length, before);

  call.owner("हाँ, बना दो");
  const done = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.equal(done.status, "issued");
  assert.equal(done.number, `INV/${gst.financialYear()}/0001`);
  assert.equal(done.pdfUrl, `/api/invoices/${done.invoiceId}/pdf`);
  assert.equal(done.payUrl, null, "no Razorpay keys here: no pay link, and the owner is told");
  assert.deepEqual(done.problems.map((p) => p.step), ["pay"]);
  assert.match(done.say, /भुगतान लिंक नहीं बन पाया/);
  assert.equal(stock.onHand(biz, kept.item.id), -50);
});

test("no bill on a typed yes, an unclear reply, or off a call", async (t) => {
  const biz = shop("en-IN");
  const ctx = ctxFor(biz, "AG-N");
  const call = fakeCall(t);
  const rice = items.upsert(biz, { name: "toor dal", unit: "kg", sale_price: 120 });
  settings.save(biz, { gst_scheme: "composition" });
  call.owner("Lakshmi took 2 kg toor dal");
  const drafted = await registry.callTool(ctx, "draft_invoice", { customer: "Lakshmi", lines: [{ item: "toor dal", quantity: 2 }] });
  assert.equal(drafted.invoice.kind, "bill_of_supply");
  await registry.callTool(ctx, "request_invoice_approval", {});

  call.owner("yes", "message");
  await assert.rejects(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), (e) => ["TYPED_ANSWER", "NO_ANSWER_YET"].includes(e.code) && Boolean(e.say));
  call.owner("yes but only one kilo?");
  await refused(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), "NOT_AFFIRMATIVE");
  await refused(registry.callTool({ ...ctx, agentId: null }, "confirm_invoice", { decision: "approve" }), "NO_VOICE_EVIDENCE");
  assert.equal(invoices.get(biz, drafted.invoiceId).status, "pending");
  assert.equal(stock.onHand(biz, rice.id), 0);

  call.owner("no, cancel it");
  const no = await registry.callTool(ctx, "confirm_invoice", { decision: "reject" });
  assert.equal(no.status, "draft");
});

test("figures the owner did not say are not saved; tax is never guessed", async (t) => {
  const biz = shop("en-IN");
  const ctx = ctxFor(biz, "AG-E");
  const call = fakeCall(t);
  items.upsert(biz, { name: "sugar", unit: "kg" });

  call.owner("Ramesh took sugar");
  const unheard = await registry.callTool(ctx, "draft_invoice", { customer: "Ramesh", lines: [{ item: "sugar", quantity: 5, rate: 44 }] });
  assert.equal(unheard.saved, false);
  assert.deepEqual(unheard.missing.sort(), ["quantity", "rate"]);
  assert.equal(invoices.list(biz).length, 0);

  call.owner("Ramesh took 5 kg sugar at 44 rupees");
  await refused(registry.callTool(ctx, "draft_invoice", { customer: "Ramesh", lines: [{ item: "sugar", quantity: 5, rate: 44 }] }), "TAX_NOT_CONFIRMED");
  call.owner("Ramesh took 5 kg jaggery at 44 rupees");
  await refused(registry.callTool(ctx, "draft_invoice", { customer: "Ramesh", lines: [{ item: "jaggery", quantity: 5, rate: 44 }] }), "ITEM_UNKNOWN");

  call.owner("sugar HSN 1701");
  await refused(registry.callTool(ctx, "set_item", { item: "sugar", hsn: "1701" }), "TAX_INCOMPLETE");
  const guessed = await registry.callTool(ctx, "set_item", { item: "sugar", hsn: "1701", gst_rate: 5 });
  assert.equal(guessed.saved, false);
  assert.ok(guessed.missing.includes("gst_rate"), "a rate the owner never said is refused");
  call.owner("sugar HSN 1701, GST 12 percent");
  await refused(registry.callTool(ctx, "set_item", { item: "sugar", hsn: "1701", gst_rate: 12 }), "GST_RATE_INVALID");
  await refused(registry.callTool({ ...ctx, agentId: null }, "set_item", { item: "sugar", hsn: "1701", gst_rate: 5, owner_words: "sugar HSN 1701 GST 5" }), "NO_VOICE_EVIDENCE");
  assert.equal(items.findByName(biz, "sugar").hsn, null);

  call.owner("add Ramesh, phone 98450 12345");
  const added = await registry.callTool(ctx, "add_customer", { name: "Ramesh", phone: "9845012345" });
  assert.equal(added.customer.phone, "9845012345");
  const wrongPhone = await registry.callTool(ctx, "add_customer", { name: "Ramesh", phone: "9845099999" });
  assert.equal(wrongPhone.saved, false);
});
