"use strict";

Object.assign(process.env, { DB_FILE: ":memory:", PUBLIC_URL: "https://sahay.test", TELEGRAM_BOT_TOKEN: "" });

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const approvals = require("../src/approvals");
const registry = require("../src/tools/registry");
const customers = require("../src/sell/customers");
const khata = require("../src/sell/khata");
const items = require("../src/stock/items");
const stock = require("../src/stock");
const facts = require("../src/tools/facts");
const { isNativeScript } = require("../src/agora/script");

const LANGS = ["hi-IN", "kn-IN", "en-IN"];

function seedBusiness(language = "en-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", city: "Bengaluru", language });
  return id;
}

const ctxOf = (businessId) => ({ businessId, sessionId: null, agentId: null, actor: "agent", toolScope: "owner" });
const ask = (businessId, topic, language = "en-IN") => registry.callTool(ctxOf(businessId), "get_business_facts", { ...(topic ? { topic } : {}), reply_language: language });

let seq = 0;
/** An issued bill, written straight to the tables (only its total and dates matter here). */
function issueInvoice(businessId, customerId, totalPaise, issuedAt = new Date().toISOString()) {
  const id = repo.newId("inv");
  const at = new Date().toISOString();
  db.prepare(
    `INSERT INTO invoices (id, business_id, customer_id, kind, status, supplier_state, place_of_supply, intra_state,
       taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at)
     VALUES (?, ?, ?, 'bill', 'draft', '29', '29', 1, ?, 0, 0, 0, ?, ?)`,
  ).run(id, businessId, customerId, totalPaise, totalPaise, at);
  db.prepare("UPDATE invoices SET status = 'pending' WHERE id = ?").run(id);
  const approvalId = repo.newId("iap");
  db.prepare("INSERT INTO invoice_approvals (id, business_id, invoice_id, status, readback, total_paise, requested_at) VALUES (?, ?, ?, 'pending', 'test', ?, ?)").run(approvalId, businessId, id, totalPaise, at);
  db.prepare("UPDATE invoice_approvals SET status = 'approved', decided_via = 'button', decided_at = ? WHERE id = ?").run(at, approvalId);
  db.prepare("UPDATE invoice_approvals SET status = 'consumed' WHERE id = ?").run(approvalId);
  seq += 1;
  db.prepare("UPDATE invoices SET status = 'issued', number = ?, fy = '2026-27', seq = ?, approval_id = ?, issued_at = ? WHERE id = ?").run(`INV/F/${seq}`, seq, approvalId, issuedAt, id);
  return id;
}

/** One approved, ordered deal (button approval, like the Yes card). */
function seedOrder(businessId, { item = "basmati rice", quantity = 50, unit = "kg", price = 62, vendorName = "Lakshmi Traders", source = "indiamart" } = {}) {
  const need = repo.createRequirement(businessId, { item, quantity, unit, city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source, name: vendorName });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: source === "simulated" ? "simulated" : "human" });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: price, unit, freight: 0, lead_time_days: 2, landed_cost: price * quantity,
  });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  return repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
}

test("get_business_facts is an owner tool, read only, and the owner scope stays within Agora's 32-tool cap", () => {
  const names = registry.toolNames(registry.SCOPES.owner);
  assert.ok(names.includes("get_business_facts"));
  assert.ok(names.length <= 32, `${names.length} owner tools; Agora refuses an agent start above 32`);
  assert.ok(!registry.toolNames(registry.SCOPES.negotiation).includes("get_business_facts"));
  const tool = registry.TOOLS.find((t) => t.name === "get_business_facts");
  assert.deepEqual(tool.inputSchema.properties.topic.enum, facts.TOPICS);
  assert.deepEqual(tool.inputSchema.required, []);
});

test("an empty shop: every topic says so honestly, in each language's own script, with no invented figure", async () => {
  const businessId = seedBusiness();
  for (const language of LANGS) {
    for (const topic of facts.TOPICS) {
      const out = await ask(businessId, topic, language);
      assert.equal(typeof out.say, "string");
      assert.ok(out.say.trim(), `${topic} ${language} has a say`);
      if (language !== "en-IN") assert.ok(isNativeScript(out.say.replace(/Asha Stores|GST/g, ""), language), `${topic} ${language}: ${out.say}`);
    }
  }
  assert.equal((await ask(businessId, "sales_today")).say, "No bills yet today.");
  assert.equal((await ask(businessId, "payments")).say, "No payments have been recorded yet.");
  assert.equal((await ask(businessId, "suppliers")).say, "No purchases from any vendor yet.");
  assert.equal((await ask(businessId, "purchases")).say, "No purchase is in progress right now.");
  assert.equal((await ask(businessId, "low_stock")).say, "No stock is recorded yet.");
  const overview = await ask(businessId);
  assert.equal(overview.topic, "overview");
  assert.equal(overview.billsToday, 0);
  assert.equal(overview.owedTotal, 0);
  assert.match(overview.say, /no bills/);
});

test("sales today, payments and the overview come from this shop's records only", async () => {
  const businessId = seedBusiness();
  const other = seedBusiness();
  const ramesh = customers.save(businessId, { name: "Ramesh" }).customer;
  const stranger = customers.save(other, { name: "Someone" }).customer;
  issueInvoice(businessId, ramesh.id, 250000);
  issueInvoice(businessId, ramesh.id, 50000);
  issueInvoice(businessId, ramesh.id, 99900, "2020-01-01T06:00:00.000Z"); // an old bill: not today
  issueInvoice(other, stranger.id, 777700);
  khata.recordReceipt(businessId, { customerId: ramesh.id, amount: 1000, mode: "cash" });

  const sales = await ask(businessId, "sales_today");
  assert.equal(sales.bills.length, 2);
  assert.equal(sales.total, 3000);
  assert.equal(sales.say, "2 bills today, 3 thousand rupees in all.");
  const hi = await ask(businessId, "sales_today", "hi-IN");
  assert.equal(hi.say, "आज 2 बिल बने, कुल 3 हज़ार रुपये।");

  const paid = await ask(businessId, "payments");
  assert.equal(paid.todayCount, 1);
  assert.equal(paid.say, "1 payment came in today, 1 thousand rupees in all. The last one was 1 thousand rupees from Ramesh in cash.");

  const overview = await ask(businessId);
  assert.equal(overview.billsToday, 2);
  assert.equal(overview.owedTotal, 3999 - 1000 + 0); // 2500 + 500 + 999 billed, 1000 received
  assert.equal(overview.owedCustomers, 1);
  assert.match(overview.say, /^Today: 2 bills for 3 thousand rupees; 2 thousand 999 rupees from 1 customer owed to you; nothing is low; no orders open\.$/);

  // The khata topic is who_owes_me's own answer.
  const fromFacts = await ask(businessId, "khata");
  const fromTool = await registry.callTool(ctxOf(businessId), "who_owes_me", { reply_language: "en-IN" });
  assert.equal(fromFacts.say, fromTool.say);
  assert.equal(fromFacts.topic, "khata");
});

test("low stock names the low items with what is left; with no level set it says it cannot tell", async () => {
  const businessId = seedBusiness();
  const rice = items.upsert(businessId, { name: "rice", unit: "kg" });
  stock.setCount(businessId, { itemId: rice.id, qty: 4 });
  assert.match((await ask(businessId, "low_stock")).say, /No reorder level is set/);
  const dal = items.upsert(businessId, { name: "dal", unit: "kg", reorder_level: 10 });
  stock.setCount(businessId, { itemId: dal.id, qty: 3 });
  const out = await ask(businessId, "low_stock");
  assert.equal(out.items.length, 1);
  assert.equal(out.say, "1 item is low: dal 3 kilograms.");
});

test("suppliers are the vendors the shop bought from, newest first, a simulated vendor labelled as one; purchases say where the current need stands", async () => {
  const businessId = seedBusiness();
  seedOrder(businessId, { vendorName: "Lakshmi Traders", price: 62 });
  seedOrder(businessId, { vendorName: "BS Foods", source: "simulated", item: "sugar", price: 41 });
  const out = await ask(businessId, "suppliers");
  assert.equal(out.suppliers.length, 2);
  assert.equal(out.suppliers[0].vendor, "BS Foods");
  assert.equal(out.suppliers[0].simulated, true);
  assert.equal(out.say, "Past purchases were from BS Foods (simulated vendor), sugar at 41 rupees a kilogram, Lakshmi Traders, basmati rice at 62 rupees a kilogram.");
  const hi = await ask(businessId, "suppliers", "hi-IN");
  assert.match(hi.say, /सिम्युलेटेड विक्रेता/);

  assert.equal((await ask(businessId, "purchases")).say, "No purchase is in progress right now.", "ordered needs are not in progress");
  const need = repo.createRequirement(businessId, { item: "atta", quantity: 20, unit: "kg", city: "Bengaluru" });
  repo.createVendor(businessId, { requirement_id: need.id, source: "indiamart", name: "Anand Mills" });
  const now = await ask(businessId, "purchases");
  assert.equal(now.say, "Current purchase: 20 kilograms atta; 1 vendor found, not negotiated yet.");
  assert.equal((await ask(businessId)).openOrders, 2);
});

test("settings say the bargaining style, speed, GST and that every order waits for the owner's yes", async () => {
  const businessId = seedBusiness();
  const out = await ask(businessId, "settings");
  assert.equal(out.askBeforeOrder, true);
  assert.match(out.say, /I always ask for your yes before any order\./);
  assert.match(out.say, /bills are plain, without GST/);
});

test("dayInIndia counts the day in IST, not UTC", () => {
  assert.equal(facts.dayInIndia("2026-11-20T19:00:00.000Z"), "2026-11-21");
  assert.equal(facts.dayInIndia("2026-11-20T18:00:00.000Z"), "2026-11-20");
  assert.equal(facts.dayInIndia("not a date"), null);
});
