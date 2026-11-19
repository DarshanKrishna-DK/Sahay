"use strict";

const { FAKE } = require("./_env");

Object.assign(process.env, {
  DB_FILE: ":memory:",
  PUBLIC_URL: "https://sahay.test",
  RAZORPAY_KEY_ID: FAKE.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: FAKE.RAZORPAY_KEY_SECRET,
  SAHAY_ACCESS_CODE: "",
});

const crypto = require("node:crypto");
const http = require("node:http");
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { createApp, PAY_CSP } = require("../server");
const approvals = require("../src/approvals");
const events = require("../src/events");
const limits = require("../src/limits");
const orders = require("../src/orders");
const payments = require("../src/orders/payments");
const repo = require("../src/db/repo");
const negotiation = require("../src/negotiation/session");

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

async function call(base, method, path, { body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { res, status: res.status, json: type.includes("json") ? await res.json() : null, text: type.includes("html") ? await res.text() : null };
}

/** An order approved by button, and its pay page made against a stand-in for Razorpay's Orders API. */
async function seedPayPage(t) {
  const businessId = repo.newId("biz");
  repo.createBusiness(businessId, { name: "Asha Stores", city: "Bengaluru", language: "en-IN" });
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source: "simulated", name: "Lakshmi Traders" });
  const negotiationRow = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "simulated" });
  const quote = repo.createQuote(businessId, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: negotiationRow.id, unit_price: 62, unit: "kg", freight: 150, landed_cost: 3250 });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  const order = await orders.createOrder(businessId, approval.id);

  const fake = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.method === "GET") return res.end(JSON.stringify({ entity: "collection", count: 0, items: [] }));
      const b = JSON.parse(raw);
      res.end(JSON.stringify({ id: "order_RoutesPay0001", entity: "order", amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }));
    });
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => fake.close(resolve)));
  const razorpay = { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, base: `http://127.0.0.1:${fake.address().port}/v1` };
  const link = await payments.createPaymentLink(businessId, order.id, { razorpay });
  return { businessId, order, link, token: link.url.split("/pay/")[1] };
}

const sign = (orderId, paymentId) => crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");

test("the pay page is public, static, not cached, and runs under its own Razorpay-only CSP", async () => {
  await withApp(async (base) => {
    const page = await call(base, "GET", "/pay/AAAAAAAAAAAAAAAAAAAAAA");
    assert.equal(page.status, 200);
    assert.match(page.text, /Razorpay TEST MODE: no real money moves/);
    assert.match(page.text, /<script src="https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js"><\/script>/);
    assert.doesNotMatch(page.text, /<script>(?!<)/, "no inline script");
    assert.equal(page.res.headers.get("content-security-policy"), PAY_CSP);
    assert.equal(page.res.headers.get("cache-control"), "no-store");
    assert.equal(page.res.headers.get("cross-origin-opener-policy"), "same-origin-allow-popups");
    assert.match(PAY_CSP, /script-src 'self' https:\/\/checkout\.razorpay\.com(;|$)/);
    assert.doesNotMatch(PAY_CSP, /unsafe-eval|script-src[^;]*unsafe-inline/);

    const consolePage = await call(base, "GET", "/");
    assert.notEqual(consolePage.res.headers.get("content-security-policy"), PAY_CSP, "the console keeps its own CSP");
    assert.equal(consolePage.res.headers.get("cross-origin-opener-policy"), "same-origin");
  });
});

test("GET /api/pay/:token: an unknown or malformed token is 404 PAY_LINK_INVALID; a real one returns the checkout data and no secret", async (t) => {
  const { order, link, token } = await seedPayPage(t);
  await withApp(async (base) => {
    for (const bad of ["AAAAAAAAAAAAAAAAAAAAAA", "x", `${token}A`]) {
      const out = await call(base, "GET", `/api/pay/${bad}`);
      assert.equal(out.status, 404);
      assert.equal(out.json.code, "PAY_LINK_INVALID");
      assert.ok(out.json.say);
    }
    const out = await call(base, "GET", `/api/pay/${token}`);
    assert.equal(out.status, 200);
    assert.equal(out.json.razorpayOrderId, link.razorpayOrderId);
    assert.equal(out.json.keyId, FAKE.RAZORPAY_KEY_ID);
    assert.equal(out.json.poNumber, order.po_number);
    assert.equal(out.json.vendor, "Lakshmi Traders (simulated vendor)");
    assert.equal(out.json.testMode, true);
    assert.ok(!JSON.stringify(out.json).includes(process.env.RAZORPAY_KEY_SECRET));
    assert.equal(out.res.headers.get("cache-control"), "no-store");
  });
});

test("POST /api/pay/:token/verify: a wrong signature is 400 and changes nothing; Razorpay's signature marks the order paid", async (t) => {
  const { businessId, order, link, token } = await seedPayPage(t);
  await withApp(async (base) => {
    const paymentId = "pay_RoutesPayment01";
    const forged = await call(base, "POST", `/api/pay/${token}/verify`, {
      body: { razorpay_payment_id: paymentId, razorpay_order_id: link.razorpayOrderId, razorpay_signature: "0".repeat(64) },
    });
    assert.equal(forged.status, 400);
    assert.equal(forged.json.code, "PAYMENT_SIGNATURE_INVALID");
    assert.equal(repo.getOrder(businessId, order.id).status, "confirmed");

    const good = await call(base, "POST", `/api/pay/${token}/verify`, {
      body: { razorpay_payment_id: paymentId, razorpay_order_id: link.razorpayOrderId, razorpay_signature: sign(link.razorpayOrderId, paymentId) },
    });
    assert.equal(good.status, 200);
    assert.deepEqual(good.json, { status: "paid", poNumber: order.po_number, already: false });
    assert.equal(repo.getOrder(businessId, order.id).status, "paid");
    assert.equal(repo.listAudit(businessId, { type: "order.paid" }).length, 1);

    const page = await call(base, "GET", `/api/pay/${token}`);
    assert.equal(page.json.paid, true);
  });
});

test("the pay API is rate limited per client IP", async (t) => {
  const { token } = await seedPayPage(t);
  await withApp(async (base) => {
    for (let i = 0; i < 60; i++) assert.equal((await call(base, "GET", `/api/pay/${token}`)).status, 200);
    const limited = await call(base, "GET", `/api/pay/${token}`);
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, "RATE_LIMITED");
  });
});

test("vendor join token: the renew key the page kept is passed through from its header, and only then", async (t) => {
  const seen = [];
  t.mock.method(negotiation, "humanJoinInfo", (code, options) => {
    seen.push({ code, options });
    return null;
  });
  await withApp(async (base) => {
    assert.equal((await call(base, "GET", "/api/vendor/abc123/token")).status, 404);
    assert.equal((await call(base, "GET", "/api/vendor/abc123/token", { headers: { "X-Sahay-Renew-Key": "kept-key" } })).status, 404);
  });
  assert.deepEqual(seen, [{ code: "abc123", options: {} }, { code: "abc123", options: { renewKey: "kept-key" } }]);
});
