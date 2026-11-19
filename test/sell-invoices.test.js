"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const { splitUtf8 } = require("../src/agora/agent");
const settings = require("../src/sell/settings");
const customers = require("../src/sell/customers");
const invoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const items = require("../src/stock/items");

const refuses = (code) => (err) => err.code === code;
const GSTIN_KA = "29AAPFU0939F1Z1"; // shape-valid; check character fixed below
const gst = require("../src/sell/gst");
const validGstin = (first14) => first14 + gst.checksumChar(first14);

function business(name = "Asha Stores", state = "Karnataka") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, owner_name: "Asha", city: "Bengaluru", state, language: "en-IN" });
  return id;
}

/** The owner confirms an item's HSN + GST rate the only way there is: server read-back, then a spoken yes. */
function confirmItem(businessId, { name, unit, hsn, gstRate, salePrice = null }) {
  const text = itemTax.readback({ item: name, hsn, gstRate, salePrice, unitWord: unit }, "en-IN");
  itemTax.recordSpoken(businessId, { itemName: name, unit, salePrice, hsn, gstRate, agentId: "AG-1", text });
  const history = [
    ...splitUtf8(text).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 10 + i })),
    { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: 30 },
  ];
  return itemTax.confirm(businessId, { agentId: "AG-1", history }).item;
}

function readyShop() {
  const biz = business();
  settings.save(biz, { gst_scheme: "regular", gstin: validGstin("29AAPFU0939F1Z") });
  const rice = confirmItem(biz, { name: "basmati rice", unit: "kg", hsn: "1006", gstRate: 5 });
  const { customer } = customers.save(biz, { name: "Ramesh Traders", phone: "+91 98450 12345" });
  return { biz, rice, customer };
}

test("settings default to an unregistered shop's plain bill (no GSTIN needed); a GST scheme without the shop's GSTIN is refused", () => {
  const biz = business();
  const s = settings.get(biz);
  assert.equal(s.gstScheme, "unregistered");
  assert.equal(s.kind, "bill");
  assert.equal(s.stateCode, "29"); // from the business's state
  assert.equal(settings.supplier(biz).gstin, null, "a first-time owner can bill at once");
  settings.save(biz, { gst_scheme: "regular" });
  assert.throws(() => settings.supplier(biz), refuses("GSTIN_REQUIRED"));
  assert.throws(() => settings.save(biz, { gstin: GSTIN_KA.replace(/.$/, "Q") }), refuses("GSTIN_INVALID"));
  assert.throws(() => settings.save(biz, { gstin: validGstin("27AAPFU0939F1Z"), state: "Karnataka" }), refuses("GSTIN_STATE_MISMATCH"));
  const saved = settings.save(biz, { gstin: validGstin("29AAPFU0939F1Z"), address: "12 MG Road, Bengaluru" });
  assert.equal(saved.stateCode, "29");
  assert.equal(settings.supplier(biz).gstin, validGstin("29AAPFU0939F1Z"));
  const unregistered = settings.save(biz, { gst_scheme: "unregistered" });
  assert.equal(unregistered.gstin, null);
  assert.equal(unregistered.kind, "bill");
});

test("customers: one per name, phone and GSTIN checked, lookup never guesses", () => {
  const biz = business();
  const { customer, created } = customers.save(biz, { name: "Ramesh Traders", phone: "098450-12345" });
  assert.equal(created, true);
  assert.equal(customer.phone, "9845012345");
  const again = customers.save(biz, { name: "ramesh  traders", gstin: validGstin("27AAPFU0939F1Z") });
  assert.equal(again.created, false);
  assert.equal(again.customer.id, customer.id);
  assert.equal(again.customer.state_code, "27");
  assert.equal(customers.findByName(biz, "Ramesh").id, customer.id);
  customers.save(biz, { name: "Ramesh Kirana" });
  assert.throws(() => customers.findByName(biz, "Ramesh"), refuses("AMBIGUOUS_CUSTOMER"));
  assert.equal(customers.findByName(biz, "Suresh"), null);
  assert.throws(() => customers.save(biz, { name: "X", phone: "12345" }), refuses("PHONE_INVALID"));
  assert.throws(() => customers.save(biz, { name: "  " }), refuses("INVALID"));
  assert.equal(customers.get(business("Other"), customer.id), null, "another business cannot read it");
  const types = repo.listAudit(biz).map((r) => r.type);
  assert.ok(types.includes("customer.saved"));
});

test("draft: intra-state CGST + SGST from the confirmed item tax, rate as said", () => {
  const { biz, rice, customer } = readyShop();
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 50, unit: "kilo", rate: 95 }] });
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.kind, "tax_invoice");
  assert.equal(invoice.number, null);
  assert.equal(invoice.intraState, true);
  assert.deepEqual(
    { taxable: invoice.totals.taxablePaise, cgst: invoice.totals.cgstPaise, sgst: invoice.totals.sgstPaise, igst: invoice.totals.igstPaise, total: invoice.totals.totalPaise },
    { taxable: 475000, cgst: 11875, sgst: 11875, igst: 0, total: 498750 },
  );
  assert.equal(invoice.lines[0].hsn, "1006");
  assert.equal(invoice.lines[0].gstRate, 5);
  assert.ok(repo.listAudit(biz).some((r) => r.type === "invoice.drafted"));
  assert.equal(invoices.get(business("Other"), invoice.id), null);
});

test("draft: a customer in another state pays IGST; replacing a draft's lines keeps its id", () => {
  const { biz, rice } = readyShop();
  const { customer } = customers.save(biz, { name: "Pune Foods", gstin: validGstin("27AAPFU0939F1Z") });
  const first = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 10, rate: 100 }] });
  assert.equal(first.intraState, false);
  assert.equal(first.totals.igstPaise, 5000);
  const second = invoices.draft(biz, { invoiceId: first.id, customerId: customer.id, lines: [{ itemId: rice.id, quantity: 20, rate: 100 }] });
  assert.equal(second.id, first.id);
  assert.equal(second.lines.length, 1);
  assert.equal(second.totals.totalPaise, 210000);
});

test("draft refuses a guessed tax, a missing price, a wrong unit and another business's customer", () => {
  const { biz, rice, customer } = readyShop();
  const sugar = items.upsert(biz, { name: "sugar", unit: "kg", hsn: "1701", gst_rate: 5 }); // tax written without the owner's yes
  assert.throws(() => invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: sugar.id, quantity: 1, rate: 40 }] }), refuses("TAX_NOT_CONFIRMED"));
  assert.throws(() => invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 1 }] }), refuses("RATE_REQUIRED"));
  assert.throws(() => invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 1, unit: "litre", rate: 9 }] }), refuses("UNIT_MISMATCH"));
  assert.throws(() => invoices.draft(biz, { customerId: customer.id, lines: [] }), refuses("NO_LINES"));
  const other = business("Other");
  assert.throws(() => invoices.draft(other, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 1, rate: 9 }] }), refuses("CUSTOMER_NOT_FOUND"));
  // a confirmed rate that the item no longer carries is not used either
  db.prepare("UPDATE items SET gst_rate = 18 WHERE id = ?").run(rice.id);
  assert.throws(() => invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 1, rate: 9 }] }), refuses("TAX_NOT_CONFIRMED"));
});

test("composition dealer: bill of supply without tax, and no inter-state bill", () => {
  const biz = business();
  settings.save(biz, { gst_scheme: "composition", gstin: validGstin("29AAPFU0939F1Z") });
  const dal = items.upsert(biz, { name: "toor dal", unit: "kg", sale_price: 120 });
  const { customer } = customers.save(biz, { name: "Lakshmi" });
  const bill = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: dal.id, quantity: 2 }] });
  assert.equal(bill.kind, "bill_of_supply");
  assert.equal(bill.totals.taxPaise, 0);
  assert.equal(bill.totals.totalPaise, 24000);
  const { customer: far } = customers.save(biz, { name: "Far Away", state: "Maharashtra" });
  assert.throws(() => invoices.draft(biz, { customerId: far.id, lines: [{ itemId: dal.id, quantity: 2 }] }), refuses("COMPOSITION_INTERSTATE"));
});

test("item tax: confirmed only by a spoken yes after the server's read-back; a typed yes or a no does not count", () => {
  const biz = business();
  const text = itemTax.readback({ item: "atta", hsn: "1101", gstRate: 5, unitWord: "kg" }, "en-IN");
  assert.equal(text, "atta: HSN code 1 1 0 1, GST 5 percent. Is that right?");
  itemTax.recordSpoken(biz, { itemName: "atta", unit: "kg", hsn: "1101", gstRate: 5, agentId: "AG-2", text });
  const read = splitUtf8(text).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 5 + i }));
  assert.throws(() => itemTax.confirm(biz, { agentId: "AG-2", history: [...read, { role: "user", content: "yes", metadata: { source: "message" }, turn_id: 9 }] }), (e) => ["TYPED_ANSWER", "NO_ANSWER_YET"].includes(e.code));
  assert.throws(() => itemTax.confirm(biz, { agentId: "AG-2", history: [...read, { role: "user", content: "no", metadata: { source: "asr" }, turn_id: 9 }] }), refuses("NOT_AFFIRMATIVE"));
  assert.throws(() => itemTax.confirm(biz, { agentId: "AG-other", history: [...read, { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: 9 }] }), refuses("READBACK_NOT_SPOKEN"));
  const { item } = itemTax.confirm(biz, { agentId: "AG-2", history: [...read, { role: "user", content: "haan", metadata: { source: "asr" }, turn_id: 9 }] });
  assert.equal(item.hsn, "1101");
  assert.deepEqual(itemTax.confirmedTax(biz, item), { hsn: "1101", gstRate: 5 });
  assert.throws(() => itemTax.validate({ hsn: "1101", gst_rate: 12 }), refuses("GST_RATE_INVALID"));
  assert.throws(() => itemTax.validate({ hsn: "11", gst_rate: 5 }), refuses("HSN_INVALID"));
});

test("database: an invoice cannot be issued, renumbered or have its lines changed behind the gate", () => {
  const { biz, rice, customer } = readyShop();
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 5, rate: 95 }] });
  assert.throws(() => db.prepare("UPDATE invoices SET status = 'issued' WHERE id = ?").run(invoice.id), /illegal invoice status change|consumed approval/);
  db.prepare("UPDATE invoices SET status = 'pending' WHERE id = ?").run(invoice.id);
  assert.throws(
    () => db.prepare("UPDATE invoices SET status = 'issued', number = 'INV/2026-27/0001', fy = '2026-27', seq = 1, issued_at = 'x' WHERE id = ?").run(invoice.id),
    /consumed approval/,
  );
  assert.throws(() => db.prepare("UPDATE invoice_lines SET qty = 1 WHERE invoice_id = ?").run(invoice.id), /fixed/);
  assert.throws(() => db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoice.id), /fixed/);
  assert.throws(() => db.prepare("UPDATE invoices SET total_paise = 1 WHERE id = ?").run(invoice.id), /fixed/);
  assert.throws(
    () => db.prepare("INSERT INTO invoice_approvals (id, business_id, invoice_id, status, readback, total_paise, requested_at) VALUES ('x', ?, ?, 'approved', 'r', ?, 'now')").run(biz, invoice.id, invoice.totals.totalPaise),
    /starts pending/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO invoices (id, business_id, customer_id, status, kind, supplier_state, place_of_supply, intra_state, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, created_at) VALUES ('inv_x', ?, ?, 'issued', 'bill', '29', '29', 1, 1, 0, 0, 0, 1, 'now')").run(biz, customer.id),
    /unnumbered draft/,
  );
});

test("setPaymentStatus moves only an issued invoice", () => {
  const { biz, rice, customer } = readyShop();
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 5, rate: 95 }] });
  assert.throws(() => invoices.setPaymentStatus(biz, invoice.id, "paid"), refuses("INVOICE_NOT_PAYABLE"));
  assert.throws(() => invoices.setPaymentStatus(biz, invoice.id, "issued"), refuses("INVALID"));
});

test("a GSTIN given on its own makes the shop GST-registered (regular); unregistered drops it again", () => {
  const biz = business();
  const saved = settings.save(biz, { gstin: validGstin("29AAPFU0939F1Z") });
  assert.equal(saved.gstScheme, "regular");
  assert.equal(saved.kind, "tax_invoice");
  assert.equal(saved.gstin, validGstin("29AAPFU0939F1Z"));
  const composition = settings.save(biz, { gst_scheme: "composition" });
  assert.equal(composition.gstin, validGstin("29AAPFU0939F1Z"), "a scheme change keeps the GSTIN");
  assert.equal(settings.save(biz, { gst_scheme: "unregistered" }).gstin, null);
});

test("a new shop with only a city (signup asks no state) gets its state from a known city, so its first plain bill can be drafted", () => {
  const biz = repo.newId("biz");
  repo.createBusiness(biz, { name: "Ganesh Stores", city: "Bengaluru", language: "hi-IN" });
  const s = settings.get(biz);
  assert.equal(s.stateCode, "29");
  assert.equal(s.stateName, "Karnataka");
  const rice = items.upsert(biz, { name: "basmati rice", unit: "kg", sale_price: 90 });
  const { customer } = customers.save(biz, { name: "Ramesh Traders" });
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: (rice.item ?? rice).id, quantity: 50, rate: 90 }] });
  assert.equal(invoice.kind, "bill");
  assert.equal(invoice.totals.totalPaise, 450000);
  assert.equal(invoice.totals.taxPaise, 0);

  for (const [city, code] of [["Mumbai", "27"], ["मुंबई", "27"], ["Mysore", "29"], ["Chennai", "33"], ["New Delhi", "07"], ["Hyderabad", "36"]]) {
    const other = repo.newId("biz");
    repo.createBusiness(other, { name: "Shop", city, language: "en-IN" });
    assert.equal(settings.get(other).stateCode, code, city);
  }
  const unknown = repo.newId("biz");
  repo.createBusiness(unknown, { name: "Shop", city: "Someplace", language: "en-IN" });
  assert.equal(settings.get(unknown).stateCode, null, "an unknown city is never guessed");
  assert.throws(() => settings.supplier(unknown), refuses("STATE_REQUIRED"));
});
