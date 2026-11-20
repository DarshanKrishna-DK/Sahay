"use strict";

// Invoice pay page (src/sell/checkout.js, src/routes/sell.js), security review r2 #4:
// a payment whose browser confirmation never arrived is found and recorded when the page is opened
// again (reconcile, through the same amount and order checks as verify), and the public routes are
// limited per token so nobody can starve another customer's page or verify.

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  RAZORPAY_KEY_ID: FAKE.RAZORPAY_KEY_ID, // the routes below never reach Razorpay: unknown or unbound tokens only
  RAZORPAY_KEY_SECRET: FAKE.RAZORPAY_KEY_SECRET,
  TRUST_PROXY: "",
  TRUST_CF_CONNECTING_IP: "",
  TRUST_FORWARDED_FOR: "",
});

const crypto = require("node:crypto");
const http = require("node:http");
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const express = require("express");

const db = require("../src/db");
const repo = require("../src/db/repo");
const limits = require("../src/limits");
const gst = require("../src/sell/gst");
const settings = require("../src/sell/settings");
const customers = require("../src/sell/customers");
const invoices = require("../src/sell/invoices");
const itemTax = require("../src/sell/item-tax");
const gate = require("../src/sell/gate");
const checkout = require("../src/sell/checkout");
const payments = require("../src/orders/payments");
const { splitUtf8 } = require("../src/agora/agent");
const { createSellRouter } = require("../src/routes/sell");
const { RATE } = require("../src/routes/api");

beforeEach(() => limits.reset());
// KHATA turns invoice.paid into a receipt and moves the invoice to paid, as server.js starts it.
require("../src/sell/khata").start();

const refuses = (code) => (err) => err.code === code;
const validGstin = (first14) => first14 + gst.checksumChar(first14);
const AGENT = "AG-checkout";
const PUBLIC = "https://sahay.example.test";

let turn = 1;
function heard(texts, answer) {
  const items = texts.flatMap((text) => splitUtf8(text).map((content) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: turn++ })));
  items.push({ role: "user", content: answer, metadata: { source: "asr" }, turn_id: turn++ });
  return items;
}

/** An issued invoice (the owner's ✓ button) for 50 kg rice at 95, GST 5%. */
function issuedInvoice() {
  const biz = repo.newId("biz");
  repo.createBusiness(biz, { name: "Asha Stores", owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language: "en-IN" });
  settings.save(biz, { gst_scheme: "regular", gstin: validGstin("29AAPFU0939F1Z"), address: "12 MG Road, Bengaluru" });
  const text = itemTax.readback({ item: "basmati rice", hsn: "1006", gstRate: 5, unitWord: "kg" }, "en-IN");
  itemTax.recordSpoken(biz, { itemName: "basmati rice", unit: "kg", hsn: "1006", gstRate: 5, agentId: AGENT, text });
  const rice = itemTax.confirm(biz, { agentId: AGENT, history: heard([text], "yes") }).item;
  const { customer } = customers.save(biz, { name: "Ramesh Traders", phone: "9845012345" });
  const draft = invoices.draft(biz, { customerId: customer.id, lines: [{ itemId: rice.id, quantity: 50, rate: 95 }] });
  const { approval } = gate.requestInvoiceApproval(biz, draft.id);
  gate.confirmInvoice(biz, approval.id, { decision: "approve", via: "button" });
  return { biz, invoice: invoices.get(biz, draft.id) };
}

/**
 * A fake Razorpay test-mode API: orders are "created" until a test pays them; GET /orders/:id and
 * GET /orders/:id/payments report what was paid. `down` makes every call fail at the network.
 */
let ordersMade = 0;
async function fakeRazorpay(t) {
  const state = { calls: [], orders: new Map(), payments: new Map(), down: false };
  const server = http.createServer(async (req, res) => {
    if (state.down) return req.socket.destroy();
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    state.calls.push({ method: req.method, url: req.url, body });
    let answer;
    const paymentsOf = /^\/v1\/orders\/([^/?]+)\/payments$/.exec(req.url);
    const orderOf = /^\/v1\/orders\/([^/?]+)$/.exec(req.url);
    if (req.method === "GET" && req.url.startsWith("/v1/orders?")) answer = [200, { entity: "collection", count: 0, items: [] }];
    else if (req.method === "POST" && req.url === "/v1/orders") {
      ordersMade += 1;
      const order = { id: `order_Rec${String(ordersMade).padStart(10, "0")}`, entity: "order", amount: body.amount, amount_paid: 0, amount_due: body.amount, currency: "INR", receipt: body.receipt, status: "created" };
      state.orders.set(order.id, order);
      answer = [200, order];
    } else if (req.method === "GET" && paymentsOf) {
      const items = state.payments.get(decodeURIComponent(paymentsOf[1])) ?? [];
      answer = [200, { entity: "collection", count: items.length, items }];
    } else if (req.method === "GET" && orderOf) {
      const order = state.orders.get(decodeURIComponent(orderOf[1]));
      answer = order ? [200, order] : [404, { error: { description: "no order" } }];
    } else answer = [404, { error: { description: "no such route" } }];
    res.writeHead(answer[0], { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer[1]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  /** Razorpay captured `amount` on `orderId` (the customer paid; the browser never told Sahay). */
  state.pay = (orderId, paymentId, { amount, status = "captured", orderPaid = amount } = {}) => {
    const order = state.orders.get(orderId);
    const paid = amount ?? order.amount;
    state.payments.set(orderId, [...(state.payments.get(orderId) ?? []), { id: paymentId, entity: "payment", amount: paid, currency: "INR", status, order_id: orderId, captured: status === "captured" }]);
    if (status === "captured") Object.assign(order, { amount_paid: orderPaid ?? paid, amount_due: order.amount - (orderPaid ?? paid), status: (orderPaid ?? paid) >= order.amount ? "paid" : "attempted" });
  };
  state.razorpay = { keyId: "rzp_test_fake", keySecret: "fake-secret", base: `http://127.0.0.1:${server.address().port}/v1` };
  return state;
}

async function withPage(t) {
  const fake = await fakeRazorpay(t);
  const { biz, invoice } = issuedInvoice();
  const link = await checkout.ensureCheckout(biz, invoice.id, { razorpay: fake.razorpay, publicUrl: PUBLIC });
  return { biz, invoice, fake, token: link.url.split("/").pop(), orderId: link.razorpayOrderId, total: link.amountPaise };
}

const paidRows = (biz) => repo.listAudit(biz, { type: "invoice.paid" });

/* ------------------------------------------------------------ reconcile --- */

test("a payment Razorpay captured but the browser never confirmed is recorded when the page is opened again, once", async (t) => {
  const { biz, invoice, fake, token, orderId, total } = await withPage(t);
  fake.pay(orderId, "pay_Missed0000001");

  const page = await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.equal(page.paid, true, "the page now shows the bill as paid");
  assert.equal(page.amountPaise, 0);
  const rows = paidRows(biz);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].detail.razorpayPaymentId, rows[0].detail.razorpayOrderId, rows[0].detail.amountPaise, rows[0].detail.via, rows[0].detail.testMode],
    ["pay_Missed0000001", orderId, total, "reconcile", true],
  );
  assert.equal(invoices.get(biz, invoice.id).status, "paid");

  await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.equal(paidRows(biz).length, 1, "opening it again records nothing twice");
  const signature = crypto.createHmac("sha256", fake.razorpay.keySecret).update(`${orderId}|pay_Missed0000001`).digest("hex");
  const late = await checkout.verifyPayment(token, { razorpay_payment_id: "pay_Missed0000001", razorpay_order_id: orderId, razorpay_signature: signature }, { razorpay: fake.razorpay });
  assert.equal(late.already, true, "a late browser confirmation finds it already recorded");
});

test("reconcile records nothing for an unpaid order, an authorised-only payment, or a wrong amount (and reports the mismatch)", async (t) => {
  const { biz, invoice, fake, token, orderId, total } = await withPage(t);
  await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.equal(paidRows(biz).length, 0, "an order still 'created' is not paid");
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/payments")).length, 0, "payments are fetched only for a paid order");

  fake.pay(orderId, "pay_Authonly00001", { status: "authorized" });
  await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.equal(paidRows(biz).length, 0, "authorised but not captured is not money in");

  fake.pay(orderId, "pay_Short0000001", { amount: 100, orderPaid: total });
  const page = await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.equal(paidRows(biz).length, 0, "a captured payment for another amount is not recorded");
  assert.equal(page.paid, false);
  assert.ok(repo.listAudit(biz, { type: "error" }).some((r) => r.detail.code === "PAYMENT_AMOUNT_MISMATCH" && r.detail.invoiceId === invoice.id));
});

test("reconcile fails loudly when Razorpay cannot be reached: the page load is refused, nothing is invented", async (t) => {
  const { biz, fake, token } = await withPage(t);
  fake.down = true;
  await assert.rejects(checkout.checkoutForToken(token, { razorpay: fake.razorpay }), refuses("RAZORPAY_UNREACHABLE"));
  assert.equal(paidRows(biz).length, 0);
});

test("a payment on an older order of the same invoice (a customer on an old page) is reconciled at that order's amount", async (t) => {
  const { biz, invoice, fake, token, orderId: first, total } = await withPage(t);
  require("../src/sell/khata").recordReceipt(biz, { customerId: invoice.customerId, amount: 1000, mode: "cash", invoiceId: invoice.id });
  const page = await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  assert.notEqual(page.razorpayOrderId, first, "a new order for what is open");
  fake.pay(first, "pay_OldPage000001");
  await checkout.checkoutForToken(token, { razorpay: fake.razorpay });
  const rows = paidRows(biz);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].detail.razorpayOrderId, rows[0].detail.amountPaise], [first, total]);
});

/* ---------------------------------------------------- route rate limits --- */

async function withApp(t) {
  const app = express();
  app.use(createSellRouter());
  app.use((err, _req, res, _next) => res.status(500).json({ code: "INTERNAL", message: err.message }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null), retryAfter: res.headers.get("retry-after") };
  };
}

/** Give an issued invoice a pay token directly (no Razorpay): enough for the routes' limits. */
function boundToken() {
  const { biz, invoice } = issuedInvoice();
  const token = "inv_" + crypto.randomBytes(16).toString("base64url");
  db.prepare("UPDATE invoices SET pay_token_hash = ?, pay_expires_at = ? WHERE business_id = ? AND id = ?").run(
    payments.hashToken(token), new Date(Date.now() + 3600_000).toISOString(), biz, invoice.id,
  );
  return token;
}

test("verify is limited per token: flooding one link never starves another link's verify", async (t) => {
  const call = await withApp(t);
  const attacked = boundToken();
  const other = boundToken();
  const max = RATE.payVerify.perToken.max;
  for (let i = 0; i < max; i++) assert.equal((await call("POST", `/api/pay/${attacked}/verify`, {})).status, 400, `verify ${i + 1}`);
  const over = await call("POST", `/api/pay/${attacked}/verify`, {});
  assert.equal(over.status, 429);
  assert.equal(over.json.code, "RATE_LIMITED");
  assert.ok(Number(over.retryAfter) > 0);
  assert.equal((await call("POST", `/api/pay/${other}/verify`, {})).status, 400, "another customer's verify is answered");
});

test("unknown pay tokens fill the caller's bad-token bucket, but a real link's page and verify are still answered", async (t) => {
  const call = await withApp(t);
  const real = boundToken();
  const cap = RATE.badPayToken.untrusted;
  for (let i = 0; i < cap.max; i++) limits.allow("pay:bad-token:untrusted", cap.max, cap.windowMs);
  const unknown = await call("GET", `/api/pay/inv_${"Z".repeat(22)}`);
  assert.equal(unknown.status, 429, "past the bucket an unknown token is refused with 429");
  assert.equal((await call("POST", `/api/pay/inv_${"Y".repeat(22)}/verify`, {})).status, 429);
  assert.equal((await call("POST", `/api/pay/${real}/verify`, {})).status, 400, "a real link is not starved");
});

test("the page is limited per token too", async (t) => {
  const call = await withApp(t);
  const token = `inv_${"Q".repeat(22)}`;
  const { max, windowMs } = RATE.payPage.perToken;
  for (let i = 0; i < max; i++) limits.allow(`invoice-pay:payPage:token:${crypto.createHash("sha256").update(token).digest("base64url").slice(0, 22)}`, max, windowMs);
  assert.equal((await call("GET", `/api/pay/${token}`)).status, 429);
});
