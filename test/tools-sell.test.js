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
  assert.match(done.outcome, /भुगतान लिंक नहीं बन पाया/);
  // E2E full run bug 1: the server says the issued bill itself; the model only hands back.
  assert.equal(call.spoken.at(-1), done.outcome);
  assert.equal(done.say, "और कुछ बताइए?");
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
  // Security review r2 #3: the typed reply came first, so no later spoken words answer this read-back.
  call.owner("yes but only one kilo?");
  await refused(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), "TYPED_ANSWER");
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

/* ------------------------------------------- E2E full run (voice fixes) --- */

function callCtx(businessId, agentId = "AG-E") {
  const session = repo.createSession(businessId, { kind: "owner", channel: `own-${Math.random().toString(16).slice(2, 10)}`, agent_id: agentId, status: "active" });
  return { businessId, sessionId: session.id, agentId, actor: "agent", toolScope: "owner" };
}

function plainShop() {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Annapurna Kirana", city: "Bengaluru", language: "hi-IN" });
  items.upsert(id, { name: "बासमती चावल", unit: "kg", sale_price: 90 });
  return id;
}

test("E2E full run bug 5b: a spoken yes to 'shall I read it out?' after draft_invoice reads the bill out; it issues nothing", async (t) => {
  const biz = plainShop();
  const ctx = callCtx(biz);
  const call = fakeCall(t);
  call.owner("रमेश ट्रेडर्स को 60 किलो बासमती चावल 90 रुपये किलो");
  const drafted = await registry.callTool(ctx, "draft_invoice", { customer: "रमेश ट्रेडर्स", lines: [{ item: "बासमती चावल", quantity: 60, unit: "किलो", rate: 90 }] });
  assert.match(drafted.say, /पढ़कर सुनाऊँ\?$/);
  call.owner("हाँ");
  // The model sends this yes to confirm_invoice (as in the E2E run, where it got NO_PENDING_INVOICE twice).
  const out = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.equal(out.status, "asked");
  assert.equal(out.readbackSpoken, true);
  assert.equal(out.say, "बिल बनाऊँ, हाँ या ना?");
  assert.match(call.spoken.at(-1), /रमेश ट्रेडर्स का बिल: 60 किलो बासमती चावल, 90 रुपये प्रति किलो, 5400 रुपये। कुल 5400 रुपये। क्या मैं यह बिल बना दूँ\?/);
  assert.equal(invoices.get(biz, drafted.invoiceId).status, "pending", "read out, not issued: the earlier yes was to reading it");
  // The owner's yes to the read-back now issues it.
  call.owner("हाँ, बना दो");
  const done = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.equal(done.status, "issued");
  // With nothing drafted or waiting, the refusal stands.
  await refused(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), "NO_PENDING_INVOICE");
});

test("E2E full run bug 5d: a sale never leaves a purchase need behind, whichever tool the model calls first", async (t) => {
  const biz = plainShop();
  const call = fakeCall(t);
  const words = "रमेश ट्रेडर्स को 190 किलो बासमती चावल 90 रुपये किलो";

  // save_requirement first (the two calls of the E2E run, in this order): draft_invoice dismisses it.
  const first = callCtx(biz);
  call.owner(words);
  const need = await registry.callTool(first, "save_requirement", { item: "बासमती चावल", quantity: 190, unit: "किलो", owner_words: words });
  assert.equal(need.saved, true);
  const drafted = await registry.callTool(first, "draft_invoice", { customer: "रमेश ट्रेडर्स", lines: [{ item: "बासमती चावल", quantity: 190, unit: "किलो", rate: 90 }] });
  assert.deepEqual(drafted.purchaseNeedsDismissed, [need.requirementId]);
  assert.equal(repo.getRequirement(biz, need.requirementId).status, "dismissed");

  // draft_invoice first: save_requirement in the same turn saves nothing.
  const second = callCtx(biz);
  await registry.callTool(second, "draft_invoice", { customer: "रमेश ट्रेडर्स", lines: [{ item: "बासमती चावल", quantity: 190, unit: "किलो", rate: 90 }] });
  const refusedNeed = await registry.callTool(second, "save_requirement", { item: "बासमती चावल", quantity: 190, unit: "किलो", owner_words: words });
  assert.equal(refusedNeed.saved, false);
  assert.equal(refusedNeed.sale, true);
  assert.equal(refusedNeed.say, "");
  assert.match(refusedNeed.hint, /never|nothing was saved as a purchase/i);
  assert.equal(repo.listRequirements(biz).filter((r) => r.status !== "dismissed").length, 0);
});

test("E2E full run bug 5a: 'add a customer' saves the name alone; the phone is optional", async (t) => {
  const biz = plainShop();
  const ctx = callCtx(biz);
  const call = fakeCall(t);
  call.owner("नया ग्राहक जोड़िए, रमेश ट्रेडर्स, बेंगलुरु।");
  const out = await registry.callTool(ctx, "add_customer", { name: "रमेश ट्रेडर्स", owner_words: "नया ग्राहक जोड़िए, रमेश ट्रेडर्स, बेंगलुरु।" });
  assert.equal(out.saved, true);
  assert.equal(out.customer.phone, null);
  assert.equal(out.say, "रमेश ट्रेडर्स ग्राहक के रूप में जोड़ लिया।");
});

test("security review r2 #3: a yes after a maybe gets the bill read out again; the next yes issues it", async (t) => {
  const biz = shop("en-IN");
  const ctx = ctxFor(biz, "AG-R");
  const call = fakeCall(t);
  items.upsert(biz, { name: "toor dal", unit: "kg", sale_price: 120 });
  settings.save(biz, { gst_scheme: "composition" });
  call.owner("Lakshmi took 2 kg toor dal");
  const drafted = await registry.callTool(ctx, "draft_invoice", { customer: "Lakshmi", lines: [{ item: "toor dal", quantity: 2 }] });
  await registry.callTool(ctx, "request_invoice_approval", {});
  const readback = call.spoken.at(-1);

  call.owner("maybe");
  await refused(registry.callTool(ctx, "confirm_invoice", { decision: "approve" }), "NOT_AFFIRMATIVE");
  call.owner("yes");
  const again = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.deepEqual([again.status, again.readAgain, again.refused, again.say], ["asked", true, "NOT_AFFIRMATIVE", "Shall I make the bill, yes or no?"]);
  assert.equal(call.spoken.at(-1), readback, "the same bill, read out again by the server");
  assert.equal(invoices.get(biz, drafted.invoiceId).status, "pending");

  call.owner("yes");
  const done = await registry.callTool(ctx, "confirm_invoice", { decision: "approve" });
  assert.equal(done.status, "issued");
});
