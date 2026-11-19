"use strict";

/**
 * Payment for an order: Razorpay Orders API + Standard Checkout, test mode only.
 *
 * Razorpay test accounts may create only 30 payment links in total ("test mode limit of 30
 * reached for payment_link"), so Sahay no longer uses payment links. Instead:
 *   1. createPaymentLink makes (once per order) a Razorpay order, POST /v1/orders with
 *      receipt = our order id, and a pay page of our own: PUBLIC_URL/pay/<token>, where the
 *      token is 128 random bits, bound to this business and order, valid for CHECKOUT_TTL_MS.
 *   2. The pay page (public/pay.html) opens Razorpay Checkout for that Razorpay order.
 *   3. Checkout's success handler posts razorpay_payment_id / razorpay_order_id /
 *      razorpay_signature; verifyCheckoutPayment checks the signature with the key secret,
 *      HMAC-SHA256(<our stored razorpay order id> + "|" + razorpay_payment_id), and only then
 *      moves the order to "paid".
 * Request shapes: docs.razorpay.com Standard Checkout integration steps and Orders API
 * (docs/build/agora-findings.md, Razorpay section).
 *
 * Names kept for the agent and the console: tool create_payment_link, event payment.link
 * {orderId, url}. The order columns payment_link_id / payment_link_url now hold the Razorpay
 * order id and the pay-page URL.
 */

const crypto = require("node:crypto");
const approvals = require("../approvals");
const { config, RAZORPAY_TEST_PREFIX } = require("../config");
const db = require("../db");
const events = require("../events");
const repo = require("../db/repo");
const { canTransition, INITIAL_STATUS: PAYABLE_STATUS } = require("./index");

const TIMEOUT_MS = 15_000;
const CHECKOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 16; // 128 bits
const TOKEN_TEXT = /^[A-Za-z0-9_-]{22}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const RAZORPAY_ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

/** orderId -> the request in flight, so two simultaneous calls share one Razorpay order. */
const inFlight = new Map();

/** Basic auth for Razorpay; refuses anything but a test key before any network call. */
function credentials(razorpay) {
  if (!razorpay?.keyId || !razorpay?.keySecret) {
    throw new PaymentError("RAZORPAY_NOT_CONFIGURED", "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.");
  }
  if (!razorpay.keyId.startsWith(RAZORPAY_TEST_PREFIX)) {
    throw new PaymentError("RAZORPAY_LIVE_KEY", "Sahay only takes payments with a Razorpay test key.");
  }
  return `Basic ${Buffer.from(`${razorpay.keyId}:${razorpay.keySecret}`).toString("base64")}`;
}

async function razorpayCall(razorpay, authorization, method, resource, body) {
  let response;
  try {
    response = await fetch(`${razorpay.base}${resource}`, {
      method,
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new PaymentError("RAZORPAY_UNREACHABLE", `Razorpay could not be reached: ${err.message}`);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // A body that is not JSON is reported through the status below.
  }
  if (response.ok) return data;
  if (response.status === 429) throw new PaymentError("RAZORPAY_RATE_LIMITED", `Razorpay is limiting requests: ${data?.error?.description ?? "HTTP 429"}`);
  throw new PaymentError("RAZORPAY_REFUSED", `Razorpay refused the request: ${data?.error?.description ?? `HTTP ${response.status}`}`);
}

const hashToken = (token) => crypto.createHash("sha256").update(token, "utf8").digest("hex");
const paise = (rupees) => Math.round(rupees * 100);

function payableOrder(businessId, orderId) {
  const document = repo.getOrderDocument(businessId, orderId);
  if (!document) throw new PaymentError("ORDER_NOT_FOUND", "There is no such order for this business.");
  approvals.assertOrderApproved(businessId, document.order);
  return document;
}

/** The pay-page base URL; a link the payer cannot open is worse than none. */
function pageBase(publicUrl) {
  if (typeof publicUrl !== "string" || !/^https?:\/\/[^/]+/.test(publicUrl)) {
    throw new PaymentError("PUBLIC_URL_NOT_SET", "PUBLIC_URL is not set, so there is no address for the pay page.");
  }
  return publicUrl.replace(/\/+$/, "");
}

/**
 * Create (or return) the pay page of an order.
 * Resolves to `{ orderId, poNumber, razorpayOrderId, url, amount, currency, expiresAt, testMode, existing }`.
 * Throws a PaymentError (or the approval gate's ApprovalError) and records nothing when it fails.
 */
async function createPaymentLink(businessId, orderId, { razorpay = config.razorpay, publicUrl = config.publicUrl, now = Date.now } = {}) {
  const authorization = credentials(razorpay);
  const base = pageBase(publicUrl);
  const document = payableOrder(businessId, orderId);
  const { order } = document;

  if (order.status === "paid") throw new PaymentError("ORDER_ALREADY_PAID", `Order ${order.po_number} is already paid.`);
  if (order.status !== PAYABLE_STATUS) {
    throw new PaymentError("ORDER_NOT_PAYABLE", `A payment cannot be taken for an order that is ${order.status}.`);
  }
  const checkout = repo.getCheckoutForOrder(businessId, order.id);
  if (checkout && Date.parse(checkout.expires_at) > now() && order.payment_link_url?.startsWith(`${base}/pay/`)) {
    return result(order, checkout, order.payment_link_url, true);
  }
  // No await above this line: the check and the registration below cannot interleave with another call.
  if (inFlight.has(order.id)) return { ...(await inFlight.get(order.id)), existing: true };

  const request = openCheckout(businessId, document, checkout, { razorpay, authorization, base, now }).finally(() => inFlight.delete(order.id));
  inFlight.set(order.id, request);
  return request;
}

function result(order, checkout, url, existing) {
  return {
    orderId: order.id,
    poNumber: order.po_number,
    razorpayOrderId: checkout.razorpay_order_id,
    url,
    amount: order.amount,
    currency: order.currency,
    expiresAt: checkout.expires_at,
    testMode: true,
    existing,
  };
}

async function openCheckout(businessId, { order, requirement }, checkout, { razorpay, authorization, base, now }) {
  const razorpayOrderId = checkout?.razorpay_order_id ?? (await razorpayOrderFor(order, requirement, razorpay, authorization)).id;
  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const fields = { token_hash: hashToken(token), expires_at: new Date(now() + CHECKOUT_TTL_MS).toISOString() };
  const url = `${base}/pay/${token}`;

  const stored = db.transaction(() => {
    let row;
    if (checkout) {
      if (!repo.renewCheckoutToken(businessId, checkout.id, fields)) throw new PaymentError("ORDER_ALREADY_PAID", `Order ${order.po_number} is already paid.`);
      row = repo.getCheckoutForOrder(businessId, order.id);
    } else {
      row = repo.createCheckout(businessId, { order_id: order.id, razorpay_order_id: razorpayOrderId, ...fields });
    }
    repo.updateOrder(businessId, order.id, { payment_link_id: razorpayOrderId, payment_link_url: url });
    events.emit(businessId, "payment.link", {
      orderId: order.id,
      poNumber: order.po_number,
      url,
      razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      expiresAt: row.expires_at,
      testMode: true,
    });
    return row;
  });
  return result(order, stored, url, false);
}

/**
 * The Razorpay order for one of our orders. Razorpay does not deduplicate on `receipt`, so an
 * order made by an earlier call whose answer never reached us is looked up first
 * (GET /v1/orders?receipt=) and reused instead of making a second one.
 */
async function razorpayOrderFor(order, requirement, razorpay, authorization) {
  const amount = paise(order.amount);
  const listed = await razorpayCall(razorpay, authorization, "GET", `/orders?receipt=${encodeURIComponent(order.id)}&count=10`);
  const earlier = listed?.items?.find((o) => o.receipt === order.id && o.amount === amount && o.currency === order.currency);
  if (earlier?.id) return earlier;

  const made = await razorpayCall(razorpay, authorization, "POST", "/orders", {
    amount,
    currency: order.currency,
    receipt: order.id, // "ord_" + 20 hex: within Razorpay's 40-character limit
    notes: {
      po_number: order.po_number,
      item: `${requirement.quantity} ${requirement.unit} ${requirement.item}`.slice(0, 250),
      simulated_vendor: order.simulated ? "yes" : "no",
    },
  });
  if (!made?.id || !RAZORPAY_ORDER_ID.test(made.id) || made.amount !== amount) {
    throw new PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay answered without a usable order.");
  }
  return made;
}

/* ------------------------------------------------------- the pay page --- */

/** The checkout row a token opens, or a typed refusal. */
function checkoutOf(token, now) {
  const row = typeof token === "string" && TOKEN_TEXT.test(token) ? repo.system.findCheckoutByTokenHash(hashToken(token)) : null;
  if (!row) throw new PaymentError("PAY_LINK_INVALID", "This payment link is not valid.");
  const expired = Date.parse(row.expires_at) <= now();
  return { row, expired };
}

/**
 * What the public pay page shows and hands to Razorpay Checkout. Nothing secret: the key id
 * is public by design (it is in every Checkout page); the key secret never leaves the server.
 */
function checkoutForToken(token, { razorpay = config.razorpay, now = Date.now } = {}) {
  credentials(razorpay);
  const { row, expired } = checkoutOf(token, now);
  const document = payableOrder(row.business_id, row.order_id);
  const { order, vendor, requirement, business } = document;
  const paid = Boolean(row.paid_at) || order.status === "paid";
  if (expired && !paid) throw new PaymentError("PAY_LINK_EXPIRED", "This payment link has expired; ask Sahay for a new one.");
  const simulated = order.simulated === true;
  const vendorName = simulated ? `${vendor.name} (${repo.SIMULATED_LABEL})` : vendor.name;
  return {
    testMode: true,
    keyId: razorpay.keyId,
    razorpayOrderId: row.razorpay_order_id,
    amountPaise: paise(order.amount),
    amount: order.amount,
    currency: order.currency,
    poNumber: order.po_number,
    buyer: business.name,
    vendor: vendorName,
    simulated,
    ...(simulated ? { vendorLabel: repo.SIMULATED_LABEL } : {}),
    item: requirement.item,
    quantity: requirement.quantity,
    unit: requirement.unit,
    description: `${order.po_number}: ${requirement.quantity} ${requirement.unit} ${requirement.item}${simulated ? ` (${repo.SIMULATED_LABEL})` : ""}, Razorpay test mode`.slice(0, 255),
    orderStatus: order.status,
    paid,
    expiresAt: row.expires_at,
  };
}

function timingSafeHexEqual(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Checkout's success handler posted these. The signature is checked against the Razorpay order
 * id WE stored for this token (never the one the browser sends); only a match marks the order
 * paid, once. Resolves to `{ orderId, poNumber, status, already }`.
 */
function verifyCheckoutPayment(token, payment, { razorpay = config.razorpay, now = Date.now } = {}) {
  credentials(razorpay);
  const { row, expired } = checkoutOf(token, now);
  const paymentId = payment?.razorpay_payment_id;
  const signature = typeof payment?.razorpay_signature === "string" ? payment.razorpay_signature.toLowerCase() : null;
  if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId) || !signature || !SIGNATURE.test(signature)) {
    throw new PaymentError("PAYMENT_DETAILS_INVALID", "The payment confirmation is incomplete.");
  }
  if (payment.razorpay_order_id !== undefined && payment.razorpay_order_id !== row.razorpay_order_id) {
    throw new PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation is for another order.");
  }

  const expected = crypto.createHmac("sha256", razorpay.keySecret).update(`${row.razorpay_order_id}|${paymentId}`).digest("hex");
  if (!timingSafeHexEqual(signature, expected)) {
    events.emit(row.business_id, "error", { code: "PAYMENT_SIGNATURE_INVALID", scope: "payment.verify", orderId: row.order_id, message: "A payment confirmation with a wrong signature was refused." });
    throw new PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation could not be verified.");
  }

  return db.transaction(() => {
    const { order } = payableOrder(row.business_id, row.order_id);
    const current = repo.getCheckoutForOrder(row.business_id, row.order_id);
    if (current.paid_at) {
      if (current.razorpay_payment_id === paymentId) return { orderId: order.id, poNumber: order.po_number, status: order.status, already: true };
      throw new PaymentError("ORDER_ALREADY_PAID", `Order ${order.po_number} is already paid.`);
    }
    if (expired) throw new PaymentError("PAY_LINK_EXPIRED", "This payment link has expired; ask Sahay for a new one.");
    repo.markCheckoutPaid(row.business_id, current.id, { razorpay_payment_id: paymentId });

    const paid = { orderId: order.id, poNumber: order.po_number, razorpayOrderId: row.razorpay_order_id, razorpayPaymentId: paymentId, testMode: true };
    if (!canTransition(order.status, "paid") || !repo.transitionOrder(row.business_id, order.id, order.status, "paid")) {
      // Razorpay took a (test) payment for an order that can no longer be paid: recorded, said loudly.
      events.emit(row.business_id, "error", { code: "PAYMENT_FOR_UNPAYABLE_ORDER", scope: "payment.verify", ...paid, orderStatus: order.status, message: `A payment arrived for order ${order.po_number}, which is ${order.status}.` });
      return { orderId: order.id, poNumber: order.po_number, status: order.status, already: false };
    }
    events.emit(row.business_id, "order.status", { orderId: order.id, poNumber: order.po_number, from: order.status, to: "paid" });
    events.emit(row.business_id, "order.paid", { ...paid, amount: order.amount, currency: order.currency });
    return { orderId: order.id, poNumber: order.po_number, status: "paid", already: false };
  });
}

module.exports = { PaymentError, createPaymentLink, checkoutForToken, verifyCheckoutPayment, CHECKOUT_TTL_MS };
