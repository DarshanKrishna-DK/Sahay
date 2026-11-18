"use strict";

/**
 * Razorpay payment links, test mode only.
 *
 * A link is raised only for an order of this business that rests on a used
 * approval and is still waiting for payment. The Razorpay `reference_id` is the
 * order id, which Razorpay keeps unique, so an order can never have two links:
 * a repeated call returns the link already made.
 */

const { setTimeout: sleep } = require("node:timers/promises");
const approvals = require("../approvals");
const { config, RAZORPAY_TEST_PREFIX } = require("../config");
const events = require("../events");
const repo = require("../db/repo");
const { canTransition, INITIAL_STATUS: PAYABLE_STATUS } = require("./index");

const TIMEOUT_MS = 15_000;
const LOOKUP_ATTEMPTS = 5;
const LOOKUP_WAIT_MS = 700;
const UNUSABLE_LINK_STATUSES = ["cancelled", "expired"];

class PaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

/** orderId -> the request in flight, so two simultaneous calls share one link. */
const inFlight = new Map();

function credentials(razorpay) {
  if (!razorpay.keyId || !razorpay.keySecret) {
    throw new PaymentError("RAZORPAY_NOT_CONFIGURED", "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set.");
  }
  if (!razorpay.keyId.startsWith(RAZORPAY_TEST_PREFIX)) {
    throw new PaymentError("RAZORPAY_LIVE_KEY", "Sahay only creates payment links with a Razorpay test key.");
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
  return { ok: response.ok, status: response.status, data };
}

function refusal({ status, data }) {
  if (status === 429) return new PaymentError("RAZORPAY_RATE_LIMITED", "Razorpay is limiting requests right now; try again in a moment.");
  return new PaymentError("RAZORPAY_REFUSED", `Razorpay refused the request: ${data?.error?.description ?? `HTTP ${status}`}`);
}

/**
 * The link Razorpay already holds for an order. Its list was measured trailing a
 * new link by up to about a second, so it is asked more than once before giving up.
 */
async function findLinkByReference(razorpay, authorization, orderId) {
  for (let attempt = 1; ; attempt += 1) {
    const listed = await razorpayCall(razorpay, authorization, "GET", `/payment_links?reference_id=${encodeURIComponent(orderId)}`);
    if (!listed.ok) throw refusal(listed);
    const link = listed.data?.payment_links?.find((candidate) => candidate.reference_id === orderId);
    if (link && UNUSABLE_LINK_STATUSES.includes(link.status)) {
      throw new PaymentError("RAZORPAY_LINK_UNUSABLE", `The payment link Razorpay holds for this order is ${link.status}.`);
    }
    if (link) return link;
    if (attempt === LOOKUP_ATTEMPTS) {
      throw new PaymentError(
        "RAZORPAY_LINK_NOT_LISTED",
        "Razorpay says a payment link already exists for this order but is not listing it yet; try again in a moment.",
      );
    }
    await sleep(LOOKUP_WAIT_MS);
  }
}

function payableOrder(businessId, orderId) {
  const document = repo.getOrderDocument(businessId, orderId);
  if (!document) throw new PaymentError("ORDER_NOT_FOUND", "There is no such order for this business.");
  approvals.assertOrderApproved(businessId, document.order);
  return document;
}

/**
 * Create (or return) the payment link for an order.
 * Resolves to `{ orderId, paymentLinkId, url, amount, currency, existing }`.
 */
async function createPaymentLink(businessId, orderId, { razorpay = config.razorpay } = {}) {
  const authorization = credentials(razorpay);
  const document = payableOrder(businessId, orderId);
  const { order } = document;

  if (order.payment_link_url) {
    return { orderId: order.id, paymentLinkId: order.payment_link_id, url: order.payment_link_url, amount: order.amount, currency: order.currency, existing: true };
  }
  if (order.status !== PAYABLE_STATUS) {
    throw new PaymentError("ORDER_NOT_PAYABLE", `A payment link cannot be raised for an order that is ${order.status}.`);
  }
  // No await above this line: the check and the registration below cannot interleave with another call.
  if (inFlight.has(order.id)) return { ...(await inFlight.get(order.id)), existing: true };

  const request = raiseLink(businessId, document, razorpay, authorization).finally(() => inFlight.delete(order.id));
  inFlight.set(order.id, request);
  return request;
}

async function raiseLink(businessId, { order, requirement }, razorpay, authorization) {
  const label = order.simulated ? `[${repo.SIMULATED_LABEL}] ` : "";
  const created = await razorpayCall(razorpay, authorization, "POST", "/payment_links", {
    amount: Math.round(order.amount * 100), // paise
    currency: order.currency,
    description: `${label}${order.po_number} - ${requirement.quantity} ${requirement.unit} ${requirement.item}`.slice(0, 2048),
    reference_id: order.id,
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { po_number: order.po_number, simulated_vendor: order.simulated ? "yes" : "no" },
  });

  let link = created.data;
  if (!created.ok) {
    // Razorpay answers 400 naming the reference_id when this order already has a link
    // (an earlier call whose answer never reached us). That link is the one to use.
    const alreadyRaised = created.status === 400 && /reference/i.test(created.data?.error?.description ?? "");
    if (!alreadyRaised) throw refusal(created);
    link = await findLinkByReference(razorpay, authorization, order.id);
  }
  if (!link?.id || !link.short_url) throw new PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay answered without a payment link.");

  repo.updateOrder(businessId, order.id, { payment_link_id: link.id, payment_link_url: link.short_url });
  events.emit(businessId, "payment.link", {
    orderId: order.id,
    poNumber: order.po_number,
    paymentLinkId: link.id,
    url: link.short_url,
    amount: order.amount,
    currency: order.currency,
    testMode: true,
  });
  return { orderId: order.id, paymentLinkId: link.id, url: link.short_url, amount: order.amount, currency: order.currency, existing: false };
}

/**
 * Ask Razorpay whether the order's link has been paid; this is the only way an
 * order becomes "paid". Resolves to `{ orderId, linkStatus, orderStatus }`.
 */
async function refreshPaymentStatus(businessId, orderId, { razorpay = config.razorpay } = {}) {
  const authorization = credentials(razorpay);
  const { order } = payableOrder(businessId, orderId);
  if (!order.payment_link_id) throw new PaymentError("NO_PAYMENT_LINK", "This order has no payment link yet.");

  const fetched = await razorpayCall(razorpay, authorization, "GET", `/payment_links/${encodeURIComponent(order.payment_link_id)}`);
  if (!fetched.ok) throw refusal(fetched);
  const linkStatus = fetched.data?.status;
  if (typeof linkStatus !== "string") throw new PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay answered without a link status.");

  let orderStatus = order.status;
  if (linkStatus === "paid" && canTransition(order.status, "paid") && repo.transitionOrder(businessId, order.id, order.status, "paid")) {
    orderStatus = "paid";
    events.emit(businessId, "order.status", { orderId: order.id, poNumber: order.po_number, from: order.status, to: "paid", paymentLinkId: order.payment_link_id });
  }
  return { orderId: order.id, linkStatus, orderStatus };
}

module.exports = { PaymentError, createPaymentLink, refreshPaymentStatus };
