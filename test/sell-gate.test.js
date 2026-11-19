"use strict";

process.env.DB_FILE = ":memory:";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const approvals = require("../src/approvals");
const { splitUtf8 } = require("../src/agora/agent");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const customers = require("../src/sell/customers");
const invoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const gate = require("../src/sell/gate");
const checkout = require("../src/sell/checkout");
const invoicePdf = require("../src/sell/invoice-pdf");
const stock = require("../src/stock");

const refuses = (code) => (err) => err.code === code;
const validGstin = (first14) => first14 + gst.checksumChar(first14);
const AGENT = "AG-sell";

function business({ language = "en-IN" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Stores", owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language });
  settings.save(id, { gst_scheme: "regular", gstin: validGstin("29AAPFU0939F1Z"), address: "12 MG Road, Bengaluru" });
  return id;
}

let turn = 1;
/** /history items for server lines (each /speak piece) followed by the owner's words. */
function heard(texts, answer, { source = "asr" } = {}) {
  const items = texts.flatMap((text) => splitUtf8(text).map((content) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: turn++ })));
  if (answer != null) items.push({ role: "user", content: answer, metadata: { source }, turn_id: turn++ });
  return items;
}

function confirmItem(biz, { name, unit = "kg", hsn, gstRate }) {
  const text = itemTax.readback({ item: name, hsn, gstRate, unitWord: unit }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: name, unit, hsn, gstRate, agentId: AGENT, text });
  return itemTax.confirm(biz, { agentId: AGENT, history: heard([text], "yes") }).item;
}

function shop(options) {
  const biz = business(options);
  const rice = confirmItem(biz, { name: "basmati rice", hsn: "1006", gstRate: 5 });
  const { customer } = customers.save(biz, { name: "Ramesh Traders", phone: "9845012345" });
  const invoice = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 50, rate: 95 }] });
  return { biz, rice, customer, invoice };
}

/** Request, have the server "speak" it, and return what the owner heard. */
function putToOwner(biz, invoiceId, language = "en-IN") {
  const { approval, invoice } = gate.requestInvoiceApproval(biz, invoiceId);
  const text = gate.buildReadback(biz, invoice, language);
  gate.recordInvoiceReadbackSpoken(biz, approval.id, { agentId: AGENT, text });
  return { approval, text };
}

test("read-back: exact figures from the stored invoice, in the language's own script", () => {
  const { biz, invoice } = shop();
  assert.equal(
    gate.buildReadback(biz, invoice, "en-IN"),
    "Tax invoice for Ramesh Traders: 50 kg basmati rice at 95 rupees per kg, 4750 rupees. GST 5 percent, 237.50 rupees. Total 4987.50 rupees. Shall I make this bill?",
  );
  const hi = gate.buildReadback(biz, invoice, "hi-IN");
  assert.match(hi, /कुल 4987.50 रुपये। क्या मैं यह बिल बना दूँ\?$/);
  assert.match(hi, /बासमती/); // the item said in Devanagari, not romanised
  assert.match(gate.buildReadback(biz, invoice, "kn-IN"), /ಒಟ್ಟು 4987.50 ರೂಪಾಯಿ\. ಈ ಬಿಲ್ ಮಾಡಲೇ\?$/);
});

test("spoken yes after the server's read-back issues the invoice: number, snapshots, stock out, events", () => {
  const { biz, rice, invoice } = shop();
  const { approval, text } = putToOwner(biz, invoice.id);
  assert.equal(invoices.get(biz, invoice.id).status, "pending");
  const { invoice: issued, approval: used } = gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "voice", agentId: AGENT, history: heard([text], "हाँ, बना दो") });
  assert.equal(used.status, "consumed");
  assert.equal(used.evidence_utterance, "हाँ, बना दो");
  assert.equal(issued.status, "issued");
  assert.equal(issued.number, `INV/${gst.financialYear()}/0001`);
  assert.equal(issued.supplier.gstin, validGstin("29AAPFU0939F1Z"));
  assert.equal(issued.recipient.name, "Ramesh Traders");
  assert.equal(stock.onHand(biz, rice.id), -50);
  const types = repo.listAudit(biz).map((r) => r.type);
  for (const type of ["invoice.requested", "invoice.spoken", "invoice.decided", "stock.moved"]) assert.ok(types.includes(type), type);

  // the next invoice of the year takes the next number
  const next = invoices.draft(biz, { customerId: issued.customerId, lines: [{ itemId: rice.id, quantity: 1, rate: 95 }] });
  const second = putToOwner(biz, next.id);
  const done = gate.confirmInvoice(biz, second.approval.id, { decision: "approve", via: "button" }).invoice;
  assert.equal(done.number, `INV/${gst.financialYear()}/0002`);
});

test("no invoice without the owner's spoken yes to that read-back", () => {
  const { biz, invoice } = shop();
  const { approval, text } = putToOwner(biz, invoice.id);
  const voice = (history, agentId = AGENT) => () => gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "voice", agentId, history });
  assert.throws(voice(heard([text], "yes", { source: "message" })), (e) => ["TYPED_ANSWER", "NO_ANSWER_YET"].includes(e.code), "a typed yes never counts");
  assert.throws(voice(heard([text], null)), refuses("NO_ANSWER_YET"));
  assert.throws(voice(heard([text], "yes, but make it 90 rupees?")), refuses("NOT_AFFIRMATIVE"));
  assert.throws(voice(heard(["Something else entirely."], "yes")), refuses("READBACK_NOT_HEARD"));
  assert.throws(voice(heard([text], "yes"), "AG-other"), refuses("READBACK_NOT_SPOKEN"));
  assert.throws(() => gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "voice", agentId: AGENT }), refuses("EVIDENCE_REQUIRED"));
  // an item's tax read out after the invoice: the yes belongs to the item, not to the bill
  const itemText = itemTax.readback({ item: "sugar", hsn: "1701", gstRate: 5, unitWord: "kg" }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: "sugar", unit: "kg", hsn: "1701", gstRate: 5, agentId: AGENT, text: itemText });
  assert.throws(voice(heard([text, itemText], "yes")), refuses("READBACK_SUPERSEDED"));
  assert.equal(invoices.get(biz, invoice.id).status, "pending");
  assert.equal(invoices.get(biz, invoice.id).number, null);
  assert.equal(gate.approvalRow(biz, approval.id).status, "pending");
  assert.throws(() => gate.assertIssued(biz, invoice.id), refuses("INVOICE_NOT_ISSUED"));
});

test("a no sends the invoice back to draft; another business cannot decide it", () => {
  const { biz, invoice } = shop();
  const { approval, text } = putToOwner(biz, invoice.id);
  const other = business();
  assert.throws(() => gate.confirmInvoice(other, approval.id, { decision: "approve", via: "button" }), refuses("APPROVAL_NOT_FOUND"));
  assert.throws(() => gate.confirmInvoice(biz, approval.id, { decision: "reject", via: "voice", agentId: AGENT, history: heard([text], "yes") }), refuses("NOT_NEGATIVE"));
  const { approval: rejected, invoice: back } = gate.confirmInvoice(biz, approval.id, { decision: "reject", via: "voice", agentId: AGENT, history: heard([text], "nahin") });
  assert.equal(rejected.status, "rejected");
  assert.equal(back.status, "draft");
  assert.throws(() => gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "button" }), refuses("ALREADY_DECIDED"));
});

test("an invoice that changed after it was read out is not issued; one invoice waits at a time", () => {
  const { biz, rice, customer, invoice } = shop();
  const { approval } = putToOwner(biz, invoice.id);
  // the item's tax changes under the pending invoice
  db.prepare("UPDATE items SET gst_rate = 18 WHERE id = ?").run(rice.id);
  assert.throws(() => gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "button" }), refuses("APPROVAL_STALE"));
  db.prepare("UPDATE items SET gst_rate = 5 WHERE id = ?").run(rice.id);
  // a second invoice put to the owner withdraws the first one's approval
  const other = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 2, rate: 95 }] });
  putToOwner(biz, other.id);
  assert.equal(gate.approvalRow(biz, approval.id).status, "rejected");
  assert.equal(invoices.get(biz, invoice.id).status, "draft");
});

test("refused while a purchase deal waits for the owner's answer", () => {
  const { biz, invoice } = shop();
  const need = repo.createRequirement(biz, { item: "basmati rice", quantity: 10, unit: "kg", city: "Bengaluru" });
  const seller = repo.createVendor(biz, { requirement_id: need.id, source: "simulated", name: "Lakshmi Traders", city: "Bengaluru" });
  const negotiation = repo.createNegotiation(biz, { requirement_id: need.id, vendor_id: seller.id, counterpart: "simulated" });
  const quote = repo.createQuote(biz, { requirement_id: need.id, vendor_id: seller.id, negotiation_id: negotiation.id, unit_price: 80, unit: "kg", freight: 0, landed_cost: 800 });
  approvals.requestApproval(biz, quote.id);
  assert.throws(() => gate.requestInvoiceApproval(biz, invoice.id), refuses("PURCHASE_APPROVAL_PENDING"));
  assert.equal(invoices.get(biz, invoice.id).status, "draft");
});

/* ------------------------------------------------- PDF and pay page --- */

async function fakeRazorpay(t) {
  const calls = [];
  const orders = new Map();
  let made = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, url: req.url, body });
    let answer;
    if (req.method === "GET" && req.url.startsWith("/v1/orders?")) answer = [200, { entity: "collection", count: 0, items: [] }];
    else if (req.method === "POST" && req.url === "/v1/orders") {
      made += 1;
      const order = { id: `order_Inv${String(made).padStart(10, "0")}`, entity: "order", amount: body.amount, amount_paid: 0, currency: body.currency, receipt: body.receipt, status: "created" };
      orders.set(order.id, order);
      answer = [200, order];
    } else if (req.method === "GET" && req.url.startsWith("/v1/orders/")) {
      const order = orders.get(decodeURIComponent(req.url.slice("/v1/orders/".length)));
      answer = order ? [200, { ...order, amount_paid: order.amount, status: "paid" }] : [404, { error: { description: "no order" } }];
    } else answer = [404, { error: { description: "no such route" } }];
    res.writeHead(answer[0], { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer[1]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return { calls, razorpay: { keyId: "rzp_test_fake", keySecret: "fake-secret", base: `http://127.0.0.1:${server.address().port}/v1` } };
}

const PUBLIC = "https://sahay.example.test";

test("issued invoice: PDF with Indic names, pay page bound to the invoice, verified payment -> invoice.paid once", async (t) => {
  const biz = business();
  const rice = confirmItem(biz, { name: "ಅಕ್ಕಿ", hsn: "1006", gstRate: 5 });
  const { customer } = customers.save(biz, { name: "रमेश ट्रेडर्स", phone: "9845012345", gstin: validGstin("27AAPFU0939F1Z") });
  const draft = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 10, rate: 60 }] });
  assert.equal(draft.intraState, false);
  const { approval, text } = putToOwner(biz, draft.id);
  gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "voice", agentId: AGENT, history: heard([text], "ಹೌದು") });

  const { razorpay, calls } = await fakeRazorpay(t);
  const { invoice, problems } = await gate.finishIssue(biz, draft.id, { checkoutOptions: { razorpay, publicUrl: PUBLIC } });
  assert.deepEqual(problems, []);
  assert.equal(invoice.pdfUrl, `/api/invoices/${draft.id}/pdf`);
  const pdf = fs.readFileSync(invoices.get(biz, draft.id).pdfPath);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.match(invoice.payUrl, /^https:\/\/sahay\.example\.test\/pay\/inv_[A-Za-z0-9_-]{22}$/);
  const post = calls.find((c) => c.method === "POST");
  assert.equal(post.body.amount, invoice.totals.totalPaise);
  assert.ok(repo.listAudit(biz).some((r) => r.type === "invoice.issued"));

  const model = invoicePdf.invoiceModel(invoices.get(biz, draft.id), gate.approvalRow(biz, approval.id));
  assert.equal(model.title, "TAX INVOICE");
  assert.ok(model.facts.some((f) => f.startsWith("Place of supply: Maharashtra (code 27)")));
  assert.deepEqual(model.taxColumns, ["igst"]);

  const token = invoice.payUrl.split("/").pop();
  const page = checkout.checkoutForToken(token, { razorpay });
  assert.equal(page.kind, "invoice");
  assert.equal(page.merchant, "Asha Stores");
  assert.equal(page.buyer, "रमेश ट्रेडर्स");
  assert.equal(page.simulated, false);
  assert.equal(page.amountPaise, invoice.totals.totalPaise);
  assert.equal(page.invoiceNumber, invoice.number);
  assert.equal(page.language, "en-IN", "the pay page speaks the shop's language");

  // asking again returns the same page
  assert.equal((await checkout.ensureCheckout(biz, draft.id, { razorpay, publicUrl: PUBLIC })).existing, true);

  const paymentId = "pay_Test0000000001";
  const bad = { razorpay_payment_id: paymentId, razorpay_order_id: page.razorpayOrderId, razorpay_signature: "0".repeat(64) };
  await assert.rejects(checkout.verifyPayment(token, bad, { razorpay }), refuses("PAYMENT_SIGNATURE_INVALID"));
  const signature = crypto.createHmac("sha256", razorpay.keySecret).update(`${page.razorpayOrderId}|${paymentId}`).digest("hex");
  const good = { razorpay_payment_id: paymentId, razorpay_order_id: page.razorpayOrderId, razorpay_signature: signature };
  assert.equal((await checkout.verifyPayment(token, good, { razorpay })).already, false);
  assert.equal((await checkout.verifyPayment(token, good, { razorpay })).already, true);
  const paid = repo.listAudit(biz, { type: "invoice.paid" });
  assert.equal(paid.length, 1);
  assert.equal(paid[0].detail.amountPaise, invoice.totals.totalPaise);
  assert.equal(paid[0].detail.testMode, true);

  assert.throws(() => checkout.checkoutForToken("inv_" + "A".repeat(22), { razorpay }), refuses("PAY_LINK_INVALID"));
  assert.throws(() => checkout.checkoutForToken(token, { razorpay: { ...razorpay, keyId: "rzp_live_x" } }), refuses("RAZORPAY_LIVE_KEY"));
});

test("no PDF and no pay page for an invoice that was not issued", async () => {
  const { biz, invoice } = shop();
  await assert.rejects(invoicePdf.writeInvoicePdf(biz, invoice.id), refuses("INVOICE_NOT_ISSUED"));
  await assert.rejects(checkout.ensureCheckout(biz, invoice.id, { razorpay: { keyId: "rzp_test_x", keySecret: "s", base: "http://127.0.0.1:9/v1" }, publicUrl: PUBLIC }), refuses("INVOICE_NOT_ISSUED"));
  await assert.rejects(checkout.ensureCheckout(biz, invoice.id, { razorpay: { keyId: "rzp_live_x", keySecret: "s", base: "x" }, publicUrl: PUBLIC }), refuses("RAZORPAY_LIVE_KEY"));
});
