"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sahay-payments-"));
process.env.DB_FILE = path.join(TMP, "sahay.db");

const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const approvals = require("../src/approvals");
const { splitUtf8 } = require("../src/agora/agent");
const { config } = require("../src/config");
const db = require("../src/db");
const orders = require("../src/orders");
const payments = require("../src/orders/payments");
const repo = require("../src/db/repo");

after(() => {
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const PUBLIC = "https://sahay.example.test";
const SECRET = "fake-secret-for-tests";
const refuses = (code) => (err) => err.code === code;
const auditTypes = (businessId) => repo.listAudit(businessId).map((row) => row.type);

function seedBusiness(name = "Asha Stores") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, owner_name: "Asha", city: "Bengaluru", state: "Karnataka", language: "en-IN" });
  return id;
}

/** An order on a voice approval made the only way there is (server-spoken read-back, then a yes). */
async function seedOrder(businessId, { source = "simulated", counterpart = "simulated" } = {}) {
  const need = repo.createRequirement(businessId, { item: "basmati rice", quantity: 50, unit: "kg", city: "Bengaluru" });
  const seller = repo.createVendor(businessId, { requirement_id: need.id, source, name: "Lakshmi Traders", city: "Bengaluru" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: seller.id, counterpart });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: seller.id, negotiation_id: negotiation.id,
    unit_price: 62, unit: "kg", lead_time_days: 3, freight: 150, landed_cost: 3250,
  });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.recordReadbackSpoken(businessId, approval.id, { agentId: "AG-pay", text: approval.readback });
  const history = [
    ...splitUtf8(approval.readback).map((content, i) => ({ role: "assistant", content, metadata: { source: "command" }, turn_id: 10 + i })),
    { role: "user", content: "yes", metadata: { source: "asr" }, turn_id: 20 },
  ];
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "voice", agentId: "AG-pay", history });
  return orders.createOrder(businessId, approval.id);
}

/**
 * A stand-in for api.razorpay.com on 127.0.0.1 that answers the two Orders API calls Sahay makes,
 * in the shapes the Razorpay docs give, and records every request.
 */
async function fakeRazorpay(t, { listed = [], status = 200 } = {}) {
  const calls = [];
  let made = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const call = { method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null, authorization: req.headers.authorization };
    calls.push(call);
    let answer;
    if (status !== 200) answer = [status, { error: { code: "BAD_REQUEST_ERROR", description: "Too many requests" } }];
    else if (req.method === "GET" && req.url.startsWith("/v1/orders?")) answer = [200, { entity: "collection", count: listed.length, items: listed }];
    else if (req.method === "POST" && req.url === "/v1/orders") {
      made += 1;
      answer = [200, { id: `order_Fake${String(made).padStart(10, "0")}`, entity: "order", amount: call.body.amount, amount_paid: 0, amount_due: call.body.amount, currency: call.body.currency, receipt: call.body.receipt, status: "created", attempts: 0, notes: call.body.notes, created_at: 1 }];
    } else answer = [404, { error: { description: "no such route" } }];
    res.writeHead(answer[0], { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer[1]));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const razorpay = { keyId: "rzp_test_fake001", keySecret: SECRET, base: `http://127.0.0.1:${server.address().port}/v1` };
  return { razorpay, calls, options: { razorpay, publicUrl: PUBLIC } };
}

function forbidNetwork(t) {
  return t.mock.method(globalThis, "fetch", () => {
    throw new Error("the network must not be called");
  });
}

const tokenOf = (url) => url.slice(`${PUBLIC}/pay/`.length);
const sign = (razorpayOrderId, paymentId, secret = SECRET) => crypto.createHmac("sha256", secret).update(`${razorpayOrderId}|${paymentId}`).digest("hex");

/* ------------------------------------------------------------ guards --- */

test("a live or missing Razorpay key is refused before any network call", async (t) => {
  const network = forbidNetwork(t);
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const base = { keyId: "rzp_test_fake001", keySecret: SECRET, base: "https://api.razorpay.com/v1" };

  for (const keyId of ["rzp_live_fake001", "rzp_test", "live_rzp_test_x"]) {
    await assert.rejects(payments.createPaymentLink(businessId, order.id, { razorpay: { ...base, keyId }, publicUrl: PUBLIC }), refuses("RAZORPAY_LIVE_KEY"), keyId);
    assert.throws(() => payments.checkoutForToken("A".repeat(22), { razorpay: { ...base, keyId } }), refuses("RAZORPAY_LIVE_KEY"));
    assert.throws(() => payments.verifyCheckoutPayment("A".repeat(22), {}, { razorpay: { ...base, keyId } }), refuses("RAZORPAY_LIVE_KEY"));
  }
  await assert.rejects(payments.createPaymentLink(businessId, order.id, { razorpay: { ...base, keySecret: null }, publicUrl: PUBLIC }), refuses("RAZORPAY_NOT_CONFIGURED"));
  await assert.rejects(payments.createPaymentLink(businessId, order.id, { razorpay: base, publicUrl: null }), refuses("PUBLIC_URL_NOT_SET"));

  assert.equal(network.mock.callCount(), 0);
  assert.equal(repo.getOrder(businessId, order.id).payment_link_url, null);
  assert.ok(!auditTypes(businessId).includes("payment.link"));
});

test("a pay page is refused for an order that is not this business's, not approved or not payable", async (t) => {
  const network = forbidNetwork(t);
  const businessId = seedBusiness();
  const other = seedBusiness("Other");
  const order = await seedOrder(businessId);
  const options = { razorpay: { keyId: "rzp_test_fake001", keySecret: SECRET, base: "https://api.razorpay.com/v1" }, publicUrl: PUBLIC };

  await assert.rejects(payments.createPaymentLink(other, order.id, options), refuses("ORDER_NOT_FOUND"));
  await assert.rejects(payments.createPaymentLink(businessId, "ord_missing", options), refuses("ORDER_NOT_FOUND"));
  orders.advanceOrder(businessId, order.id, "cancelled");
  await assert.rejects(payments.createPaymentLink(businessId, order.id, options), refuses("ORDER_NOT_PAYABLE"));

  assert.equal(network.mock.callCount(), 0);
  assert.equal(repo.getCheckoutForOrder(businessId, order.id), null);
});

test("when Razorpay cannot be reached or limits requests the error is surfaced and nothing is recorded", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  const unreachable = { razorpay: { keyId: "rzp_test_fake001", keySecret: SECRET, base: `http://127.0.0.1:${port}/v1` }, publicUrl: PUBLIC };
  await assert.rejects(payments.createPaymentLink(businessId, order.id, unreachable), refuses("RAZORPAY_UNREACHABLE"));

  const limited = await fakeRazorpay(t, { status: 429 });
  await assert.rejects(payments.createPaymentLink(businessId, order.id, limited.options), refuses("RAZORPAY_RATE_LIMITED"));

  assert.equal(repo.getOrder(businessId, order.id).payment_link_url, null);
  assert.equal(repo.getCheckoutForOrder(businessId, order.id), null);
  assert.ok(!auditTypes(businessId).includes("payment.link"));
});

/* ---------------------------------------------------- the pay page --- */

test("one Razorpay order and one pay page per order, however often or simultaneously it is asked for", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const { calls, options } = await fakeRazorpay(t);

  const [first, second] = await Promise.all([payments.createPaymentLink(businessId, order.id, options), payments.createPaymentLink(businessId, order.id, options)]);
  assert.match(first.url, /^https:\/\/sahay\.example\.test\/pay\/[A-Za-z0-9_-]{22}$/, "PUBLIC_URL/pay/<128-bit token>");
  assert.match(first.razorpayOrderId, /^order_/);
  assert.equal(first.existing, false);
  assert.equal(first.testMode, true);
  assert.deepEqual({ ...second, existing: false }, first);

  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual({ amount: posts[0].body.amount, currency: posts[0].body.currency, receipt: posts[0].body.receipt }, { amount: 325000, currency: "INR", receipt: order.id });
  assert.equal(posts[0].body.notes.simulated_vendor, "yes");
  assert.match(calls[0].url, new RegExp(`^/v1/orders\\?receipt=${order.id}`), "an earlier Razorpay order for this receipt is looked for first");
  assert.ok(calls.every((c) => c.authorization === `Basic ${Buffer.from(`rzp_test_fake001:${SECRET}`).toString("base64")}`));

  const stored = repo.getOrder(businessId, order.id);
  assert.equal(stored.payment_link_id, first.razorpayOrderId);
  assert.equal(stored.payment_link_url, first.url);
  const checkout = repo.getCheckoutForOrder(businessId, order.id);
  assert.notEqual(checkout.token_hash, tokenOf(first.url), "only the token's hash is stored");
  assert.ok(Date.parse(checkout.expires_at) - Date.now() > 6 * 24 * 3600 * 1000);

  const linkEvents = repo.listAudit(businessId, { type: "payment.link" });
  assert.equal(linkEvents.length, 1);
  assert.equal(linkEvents[0].detail.orderId, order.id);
  assert.equal(linkEvents[0].detail.url, first.url);
  assert.equal(linkEvents[0].detail.testMode, true);
  assert.equal(linkEvents[0].detail.vendorLabel, "simulated vendor");

  const network = forbidNetwork(t);
  const again = await payments.createPaymentLink(businessId, order.id, options);
  assert.equal(again.url, first.url);
  assert.equal(again.existing, true);
  assert.equal(network.mock.callCount(), 0);
});

test("a Razorpay order made by an earlier call that never answered is reused, not made twice", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const earlier = { id: "order_Earlier000001", entity: "order", amount: 325000, currency: "INR", receipt: order.id, status: "created" };
  const { calls, options } = await fakeRazorpay(t, { listed: [{ ...earlier, id: "order_OtherAmount01", amount: 1 }, earlier] });
  const made = await payments.createPaymentLink(businessId, order.id, options);
  assert.equal(made.razorpayOrderId, earlier.id);
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("the pay page shows the order, labels a simulated vendor and test mode, and never the key secret", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const { razorpay, options } = await fakeRazorpay(t);
  const { url, razorpayOrderId } = await payments.createPaymentLink(businessId, order.id, options);

  const page = payments.checkoutForToken(tokenOf(url), { razorpay });
  assert.equal(page.keyId, "rzp_test_fake001");
  assert.equal(page.razorpayOrderId, razorpayOrderId);
  assert.equal(page.amountPaise, 325000);
  assert.equal(page.poNumber, order.po_number);
  assert.equal(page.testMode, true);
  assert.equal(page.simulated, true);
  assert.equal(page.vendor, "Lakshmi Traders (simulated vendor)");
  assert.match(page.description, /simulated vendor/);
  assert.match(page.description, /^[A-Za-z0-9]/, "Checkout wants the description to start with a letter or digit");
  assert.equal(page.paid, false);
  assert.ok(!JSON.stringify(page).includes(SECRET));

  for (const bad of ["", "short", `${tokenOf(url).slice(0, 21)}x`, `${tokenOf(url)}x`, null]) {
    assert.throws(() => payments.checkoutForToken(bad, { razorpay }), refuses("PAY_LINK_INVALID"), String(bad));
  }
});

test("an expired pay page is refused; asking again gives a new token for the same Razorpay order", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const { razorpay, calls, options } = await fakeRazorpay(t);
  const first = await payments.createPaymentLink(businessId, order.id, options);
  const later = () => Date.now() + payments.CHECKOUT_TTL_MS + 1000;

  assert.throws(() => payments.checkoutForToken(tokenOf(first.url), { razorpay, now: later }), refuses("PAY_LINK_EXPIRED"));
  const renewed = await payments.createPaymentLink(businessId, order.id, { ...options, now: later });
  assert.notEqual(renewed.url, first.url);
  assert.equal(renewed.razorpayOrderId, first.razorpayOrderId);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1, "no second Razorpay order");
  assert.throws(() => payments.checkoutForToken(tokenOf(first.url), { razorpay }), refuses("PAY_LINK_INVALID"), "the old token stops working");
  assert.equal(payments.checkoutForToken(tokenOf(renewed.url), { razorpay, now: later }).razorpayOrderId, first.razorpayOrderId);
});

/* ------------------------------------------------------ verification --- */

test("a payment is accepted only with Razorpay's signature over OUR stored order id; then the order is paid once", async (t) => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const { razorpay, options } = await fakeRazorpay(t);
  const { url, razorpayOrderId } = await payments.createPaymentLink(businessId, order.id, options);
  const token = tokenOf(url);
  const paymentId = "pay_TestPayment0001";

  // Wrong secret, the other order's signature, a forged order id, garbage: all refused, order untouched.
  const forged = [
    [{ razorpay_payment_id: paymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: sign(razorpayOrderId, paymentId, "wrong-secret") }, "PAYMENT_SIGNATURE_INVALID"],
    [{ razorpay_payment_id: paymentId, razorpay_order_id: "order_Attacker00001", razorpay_signature: sign("order_Attacker00001", paymentId) }, "PAYMENT_SIGNATURE_INVALID"],
    [{ razorpay_payment_id: paymentId, razorpay_signature: sign("order_Attacker00001", paymentId) }, "PAYMENT_SIGNATURE_INVALID"],
    [{ razorpay_payment_id: "pay_x", razorpay_signature: "zz" }, "PAYMENT_DETAILS_INVALID"],
    [{}, "PAYMENT_DETAILS_INVALID"],
  ];
  for (const [body, code] of forged) assert.throws(() => payments.verifyCheckoutPayment(token, body, { razorpay }), refuses(code), JSON.stringify(body));
  assert.throws(() => payments.verifyCheckoutPayment("B".repeat(22), { razorpay_payment_id: paymentId, razorpay_signature: sign(razorpayOrderId, paymentId) }, { razorpay }), refuses("PAY_LINK_INVALID"));
  assert.equal(repo.getOrder(businessId, order.id).status, "confirmed");
  assert.ok(!auditTypes(businessId).includes("order.paid"));
  assert.ok(repo.listAudit(businessId, { type: "error" }).some((row) => row.detail.code === "PAYMENT_SIGNATURE_INVALID"));

  const good = { razorpay_payment_id: paymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: sign(razorpayOrderId, paymentId) };
  assert.deepEqual(payments.verifyCheckoutPayment(token, good, { razorpay }), { orderId: order.id, poNumber: order.po_number, status: "paid", already: false });
  assert.equal(repo.getOrder(businessId, order.id).status, "paid");
  const paid = repo.listAudit(businessId, { type: "order.paid" });
  assert.equal(paid.length, 1);
  assert.equal(paid[0].detail.razorpayPaymentId, paymentId);
  assert.equal(paid[0].detail.testMode, true);
  assert.equal(paid[0].detail.vendorLabel, "simulated vendor");
  assert.equal(repo.getCheckoutForOrder(businessId, order.id).razorpay_payment_id, paymentId);

  // The same confirmation again (a retried POST) is a no-op; another payment id is refused.
  assert.equal(payments.verifyCheckoutPayment(token, good, { razorpay }).already, true);
  const otherId = "pay_TestPayment0002";
  assert.throws(() => payments.verifyCheckoutPayment(token, { razorpay_payment_id: otherId, razorpay_signature: sign(razorpayOrderId, otherId) }, { razorpay }), refuses("ORDER_ALREADY_PAID"));
  assert.equal(repo.listAudit(businessId, { type: "order.paid" }).length, 1);
  assert.equal(payments.checkoutForToken(token, { razorpay }).paid, true);

  await assert.rejects(payments.createPaymentLink(businessId, order.id, options), refuses("ORDER_ALREADY_PAID"));
});

test("a checkout row cannot be pointed at another business's order (DB trigger)", async () => {
  const a = seedBusiness("A");
  const b = seedBusiness("B");
  const orderOfA = await seedOrder(a);
  assert.throws(() => repo.createCheckout(b, { order_id: orderOfA.id, razorpay_order_id: "order_X00000001", token_hash: "h", expires_at: new Date().toISOString() }), refuses("NOT_FOUND"));
});

/* ---------------------------------------------- live, opt-in only --- */

const LIVE_SKIP = process.env.RAZORPAY_LIVE_TEST !== "1"
  ? "live Razorpay call is opt-in (RAZORPAY_LIVE_TEST=1)"
  : config.razorpay.keyId && config.razorpay.keySecret ? false : "no Razorpay test key configured";

test("live: Razorpay test mode creates the order for a pay page", { skip: LIVE_SKIP }, async () => {
  const businessId = seedBusiness();
  const order = await seedOrder(businessId);
  const made = await payments.createPaymentLink(businessId, order.id, { publicUrl: PUBLIC });
  assert.match(made.razorpayOrderId, /^order_/);
  assert.equal(payments.checkoutForToken(tokenOf(made.url)).razorpayOrderId, made.razorpayOrderId);
});
