"use strict";

Object.assign(process.env, {
  DB_FILE: ":memory:",
  SESSION_SIGNING_SECRET: "test-secret-".padEnd(48, "x"),
  PUBLIC_URL: "https://sahay.test",
  AGORA_APP_ID: "0123456789abcdef0123456789abcdef",
  AGORA_APP_CERTIFICATE: "fedcba9876543210fedcba9876543210", // fake test value
  AGORA_CUSTOMER_ID: "test-customer",
  AGORA_CUSTOMER_SECRET: "test-customer-secret",
  MURF_API_KEY: "test-murf-key",
  TELEGRAM_BOT_TOKEN: "",
  SAHAY_ACCESS_CODE: "",
});

const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { createApp } = require("../server");
const db = require("../src/db");
const repo = require("../src/db/repo");
const events = require("../src/events");
const limits = require("../src/limits");
const customers = require("../src/sell/customers");
const khata = require("../src/sell/khata");
const { REMIND_PER_MINUTE } = require("../src/routes/khata");

beforeEach(() => limits.reset());

async function withApp(run) {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    events.closeStreams();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(base, method, path, { cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null };
}

async function signUp(base, details = { name: "Asha Kirana", city: "Bengaluru", language: "hi-IN" }) {
  const out = await call(base, "POST", "/api/session", { body: details });
  assert.equal(out.status, 200);
  return { cookie: out.res.headers.get("set-cookie").split(";")[0], businessId: out.json.business.id };
}

/* ------------------------------------------------- fixtures (this test) --- */

let seq = 0;
/**
 * An invoice issued the way SELL's gate leaves it: a draft, asked, approved, consumed and then
 * issued with a number, written straight to the tables because only its total and dates matter here.
 */
function issueInvoice(businessId, customerId, totalPaise, issuedAt = new Date().toISOString(), { payUrl = null } = {}) {
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
  const number = `INV/2026-27/${String(seq).padStart(4, "0")}`;
  db.prepare("UPDATE invoices SET status = 'issued', number = ?, fy = '2026-27', seq = ?, approval_id = ?, issued_at = ?, pay_url = ? WHERE id = ?").run(number, seq, approvalId, issuedAt, payUrl, id);
  return { id, number };
}


const receiptCount = (businessId) => db.prepare("SELECT COUNT(*) AS n FROM receipts WHERE business_id = ?").get(businessId).n;

test("the khata routes need the session cookie", async () => {
  await withApp(async (base) => {
    for (const [method, path] of [["POST", "/api/receipts"], ["POST", "/api/customers/cus_x/remind"]]) {
      const out = await call(base, method, path, { body: {} });
      assert.equal(out.status, 401, path);
    }
  });
});

test("POST /api/receipts records the owner's button press for their own customer and bill, and refuses anything else", async () => {
  await withApp(async (base) => {
    const { cookie, businessId } = await signUp(base);
    const other = await signUp(base, { name: "Other Shop", city: "Mysuru", language: "en-IN" });
    const ramesh = customers.save(businessId, { name: "रमेश" }).customer;
    const theirs = customers.save(other.businessId, { name: "Mohan" }).customer;
    const bill = issueInvoice(businessId, ramesh.id, 300000);
    const theirBill = issueInvoice(other.businessId, theirs.id, 100000);

    const ok = await call(base, "POST", "/api/receipts", { cookie, body: { customer_id: ramesh.id, amount: 1000, mode: "upi", invoice_id: bill.id, note: "आधा भुगतान" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.receipt.amount, 1000);
    assert.equal(ok.json.receipt.recorded_via, "button");
    assert.equal(ok.json.owed, 2000);
    assert.equal(db.prepare("SELECT status FROM invoices WHERE id = ?").get(bill.id).status, "part_paid");

    // A business id in the body is never read: the receipt is the cookie's business's.
    const sneaky = await call(base, "POST", "/api/receipts", { cookie, body: { customer_id: theirs.id, amount: 10, mode: "cash", business_id: other.businessId } });
    assert.equal(sneaky.status, 404);
    assert.equal(sneaky.json.code, "CUSTOMER_NOT_FOUND");
    assert.ok(sneaky.json.say, "a refusal carries a spoken line");
    const otherBill = await call(base, "POST", "/api/receipts", { cookie, body: { customer_id: ramesh.id, amount: 10, mode: "cash", invoice_id: theirBill.id } });
    assert.equal(otherBill.status, 404);
    assert.equal(otherBill.json.code, "INVOICE_NOT_FOUND");
    const tooMuch = await call(base, "POST", "/api/receipts", { cookie, body: { customer_id: ramesh.id, amount: 2000.5, mode: "cash", invoice_id: bill.id } });
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.json.code, "AMOUNT_EXCEEDS_INVOICE");
    const fake = await call(base, "POST", "/api/receipts", { cookie, body: { customer_id: ramesh.id, amount: 10, mode: "razorpay_test" } });
    assert.equal(fake.status, 400);
    assert.equal(fake.json.code, "INVALID_MODE");
    for (const body of [{ amount: 10, mode: "cash" }, { customer_id: ramesh.id, amount: 0, mode: "cash" }, { customer_id: ramesh.id, amount: "lots", mode: "cash" }, { customer_id: ramesh.id, amount: 10 }]) {
      const bad = await call(base, "POST", "/api/receipts", { cookie, body });
      assert.equal(bad.status, 400, JSON.stringify(body));
    }
    assert.equal(receiptCount(businessId), 1);
    assert.equal(receiptCount(other.businessId), 0);
  });
});

test("POST /api/customers/:id/remind returns the WhatsApp link for the cookie's own customer, and is rate limited", async () => {
  await withApp(async (base) => {
    const { cookie, businessId } = await signUp(base, { name: "Asha Stores", city: "Bengaluru", language: "en-IN" });
    const other = await signUp(base, { name: "Other Shop", city: "Mysuru", language: "en-IN" });
    const ramesh = customers.save(businessId, { name: "Ramesh", phone: "9845012345" }).customer;
    const paidUp = customers.save(businessId, { name: "Mohan" }).customer;
    const theirs = customers.save(other.businessId, { name: "Ravi" }).customer;
    issueInvoice(businessId, ramesh.id, 50000);
    issueInvoice(other.businessId, theirs.id, 50000);

    const out = await call(base, "POST", `/api/customers/${ramesh.id}/remind`, { cookie, body: { language: "hi-IN" } });
    assert.equal(out.status, 200);
    assert.match(out.json.text, /^नमस्ते Ramesh जी, Asha Stores की ओर से/);
    assert.equal(out.json.shareUrl, `https://wa.me/919845012345?text=${encodeURIComponent(out.json.text)}`);
    assert.deepEqual(out.json.telegram, { sent: false, reason: "not_configured" });
    assert.equal(out.json.amount, 500);

    const foreign = await call(base, "POST", `/api/customers/${theirs.id}/remind`, { cookie, body: {} });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.json.code, "CUSTOMER_NOT_FOUND");
    const nothing = await call(base, "POST", `/api/customers/${paidUp.id}/remind`, { cookie, body: {} });
    assert.equal(nothing.status, 409);
    assert.equal(nothing.json.code, "NOTHING_OWED");

    for (let i = 3; i < REMIND_PER_MINUTE; i++) assert.equal((await call(base, "POST", `/api/customers/${ramesh.id}/remind`, { cookie, body: {} })).status, 200);
    const limited = await call(base, "POST", `/api/customers/${ramesh.id}/remind`, { cookie, body: {} });
    assert.equal(limited.status, 429);
    assert.equal(limited.res.headers.get("retry-after"), "60");
  });
});

test("the app hears SELL's invoice.paid: a Razorpay test payment shows up as a receipt", async () => {
  await withApp(async (base) => {
    const { businessId } = await signUp(base);
    const ramesh = customers.save(businessId, { name: "रमेश" }).customer;
    const bill = issueInvoice(businessId, ramesh.id, 99900);
    events.emit(businessId, "invoice.paid", { invoiceId: bill.id, number: bill.number, customerId: ramesh.id, amountPaise: 99900, razorpayPaymentId: "pay_Route01", razorpayOrderId: "order_Route01", testMode: true });
    const [receipt] = khata.listReceipts(businessId);
    assert.equal(receipt.mode, "razorpay_test");
    assert.equal(receipt.amount, 999);
    assert.deepEqual(khata.summary(businessId).owed, []);
  });
});
