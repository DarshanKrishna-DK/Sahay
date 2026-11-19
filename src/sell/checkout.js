"use strict";

/**
 * Pay page of an issued invoice: Razorpay Orders API + Standard Checkout, test mode only, through
 * the same Razorpay client and guards as purchase orders (src/orders/payments.js: credentials()
 * refuses a live key before any network call). The shop is the merchant: the pay page names the
 * shop as the one being paid and the customer as the payer; nothing here is a simulated vendor.
 *
 *   ensureCheckout(businessId, invoiceId) -> a Razorpay order for what is still open on the
 *     invoice, and PUBLIC_URL/pay/<token> where token = "inv_" + 128 random bits (only its SHA-256
 *     is stored, on the invoice). Only an issued invoice (consumed approval: gate.assertIssued)
 *     gets one.
 *   checkoutForToken(token) -> what the public pay page shows.
 *   verifyPayment(token, {razorpay_payment_id, razorpay_order_id, razorpay_signature}) -> checks
 *     HMAC-SHA256(<stored razorpay order id>|payment id) with the key secret, reads the Razorpay
 *     order for the amount actually paid, and emits invoice.paid once per payment id. KHATA turns
 *     that event into a receipt and moves the invoice to part_paid / paid.
 */

const crypto = require("node:crypto");
const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const payments = require("../orders/payments");
const { config } = require("../config");
const gate = require("./gate");
const invoices = require("./invoices");
const { SellError } = require("./errors");

const TTL_MS = payments.CHECKOUT_TTL_MS;
const TOKEN_PREFIX = "inv_";
const TOKEN_TEXT = /^inv_[A-Za-z0-9_-]{22}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const RAZORPAY_ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

const isInvoiceToken = (token) => typeof token === "string" && TOKEN_TEXT.test(token);

/** What is still open on the invoice, in paise (KHATA's receipts); the total when nothing is paid. */
function openPaise(businessId, invoice) {
  const khata = require("./view").khata();
  if (typeof khata?.invoiceOpenPaise === "function") return khata.invoiceOpenPaise(businessId, invoice);
  if (invoice.status === "issued") return invoice.totals.totalPaise;
  throw new SellError("BALANCE_UNKNOWN", "Part of this invoice is paid and the balance cannot be worked out here.", { status: 409 });
}

/** orderKey -> request in flight, so two simultaneous calls share one Razorpay order. */
const inFlight = new Map();

/**
 * Create (or return) the pay page of an issued invoice. Resolves to
 * { invoiceId, number, url, amountPaise, razorpayOrderId, expiresAt, testMode, existing }.
 */
async function ensureCheckout(businessId, invoiceId, { razorpay = config.razorpay, publicUrl = config.publicUrl, now = Date.now } = {}) {
  const authorization = payments.credentials(razorpay);
  const base = payments.pageBase(publicUrl);
  const invoice = gate.assertIssued(businessId, invoiceId);
  if (invoice.status === "paid") throw new SellError("INVOICE_ALREADY_PAID", `Invoice ${invoice.number} is already paid.`, { status: 409 });
  if (invoice.status === "cancelled") throw new SellError("INVOICE_NOT_PAYABLE", `Invoice ${invoice.number} is cancelled.`, { status: 409 });
  const amountPaise = openPaise(businessId, invoice);
  if (!(amountPaise > 0)) throw new SellError("INVOICE_ALREADY_PAID", `Nothing is open on invoice ${invoice.number}.`, { status: 409 });

  const receipt = `${invoice.id}-${amountPaise}`; // within Razorpay's 40 characters
  // An invoice with nothing paid yet keeps its pay page until it expires; after a part payment a
  // new Razorpay order is made for what is still open (an order made for this amount is reused).
  const current = invoices.get(businessId, invoiceId);
  const live = current.razorpayOrderId && current.payUrl?.startsWith(`${base}/pay/`) && Date.parse(current.payExpiresAt ?? "") > now();
  if (live && current.status === "issued") return result(current, amountPaise, true);
  const key = `${businessId}:${receipt}`;
  if (inFlight.has(key)) return { ...(await inFlight.get(key)), existing: true };
  const request = open(businessId, invoice, { amountPaise, receipt, razorpay, authorization, base, now }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

function result(invoice, amountPaise, existing) {
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    url: invoice.payUrl,
    amountPaise,
    razorpayOrderId: invoice.razorpayOrderId,
    expiresAt: invoice.payExpiresAt,
    testMode: true,
    existing,
  };
}

async function open(businessId, invoice, { amountPaise, receipt, razorpay, authorization, base, now }) {
  const order = await razorpayOrderFor(invoice, { amountPaise, receipt, razorpay, authorization });
  const token = TOKEN_PREFIX + crypto.randomBytes(16).toString("base64url");
  const url = `${base}/pay/${token}`;
  const expiresAt = new Date(now() + TTL_MS).toISOString();
  return db.transaction(() => {
    const changed = db
      .prepare("UPDATE invoices SET razorpay_order_id = ?, pay_token_hash = ?, pay_url = ?, pay_expires_at = ? WHERE business_id = ? AND id = ? AND status IN ('issued', 'part_paid')")
      .run(order.id, payments.hashToken(token), url, expiresAt, businessId, invoice.id).changes;
    if (changed !== 1) throw new SellError("INVOICE_NOT_PAYABLE", "This invoice can no longer be paid.", { status: 409 });
    const stored = invoices.get(businessId, invoice.id);
    events.emit(businessId, "invoice.pay_link", { invoiceId: invoice.id, number: invoice.number, url, amountPaise, razorpayOrderId: order.id, expiresAt, testMode: true }, { actor: "system" });
    return result(stored, amountPaise, false);
  });
}

/** Razorpay does not deduplicate on receipt: an order an earlier call made is looked up first and reused. */
async function razorpayOrderFor(invoice, { amountPaise, receipt, razorpay, authorization }) {
  const listed = await payments.razorpayCall(razorpay, authorization, "GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=10`);
  const earlier = listed?.items?.find((o) => o.receipt === receipt && o.amount === amountPaise && o.currency === "INR" && o.status !== "paid");
  if (earlier?.id) return earlier;
  const made = await payments.razorpayCall(razorpay, authorization, "POST", "/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes: { invoice_number: invoice.number, kind: "sale invoice" },
  });
  if (!made?.id || !RAZORPAY_ORDER_ID.test(made.id) || made.amount !== amountPaise) {
    throw new payments.PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay answered without a usable order.");
  }
  return made;
}

/* -------------------------------------------------------- the pay page --- */

function rowForToken(token) {
  const row = isInvoiceToken(token) ? db.prepare("SELECT business_id, id, pay_expires_at, razorpay_order_id FROM invoices WHERE pay_token_hash = ?").get(payments.hashToken(token)) : null;
  if (!row) throw new payments.PaymentError("PAY_LINK_INVALID", "This payment link is not valid.");
  return row;
}

/** What the public pay page shows: the shop is paid, the customer pays. Nothing secret. */
function checkoutForToken(token, { razorpay = config.razorpay, now = Date.now } = {}) {
  payments.credentials(razorpay);
  const row = rowForToken(token);
  const invoice = gate.assertIssued(row.business_id, row.id);
  const paid = invoice.status === "paid";
  if (Date.parse(row.pay_expires_at) <= now() && !paid) throw new payments.PaymentError("PAY_LINK_EXPIRED", "This payment link has expired; ask the shop for a new one.");
  const business = repo.getBusiness(row.business_id);
  const amountPaise = paid ? 0 : openPaise(row.business_id, invoice);
  const lines = invoice.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ");
  return {
    kind: "invoice",
    testMode: true,
    keyId: razorpay.keyId,
    razorpayOrderId: row.razorpay_order_id,
    amountPaise,
    amount: amountPaise / 100,
    currency: "INR",
    invoiceNumber: invoice.number,
    language: ["hi-IN", "kn-IN", "en-IN"].includes(business.language) ? business.language : "en-IN", // the shop's wording on the page
    poNumber: invoice.number, // field name the pay page already reads
    merchant: business.name,
    vendor: business.name,
    buyer: invoice.recipient?.name ?? null,
    simulated: false,
    item: lines,
    quantity: "",
    unit: "",
    description: `${invoice.number} from ${business.name}, Razorpay test mode`.slice(0, 255),
    invoiceStatus: invoice.status,
    orderStatus: invoice.status,
    paid,
    expiresAt: row.pay_expires_at,
  };
}

const paidAlready = (businessId, paymentId) =>
  repo.listAudit(businessId, { type: "invoice.paid", limit: 1000 }).some((row) => row.detail?.razorpayPaymentId === paymentId);

/**
 * Checkout's success handler posted these. The signature is checked against the Razorpay order id
 * stored for this token (never the one the browser sends); the amount is what Razorpay says was
 * paid on that order. Emits invoice.paid once per payment. Resolves to { invoiceId, number, status, already }.
 */
async function verifyPayment(token, payment, { razorpay = config.razorpay } = {}) {
  const authorization = payments.credentials(razorpay);
  const row = rowForToken(token);
  const paymentId = payment?.razorpay_payment_id;
  const signature = typeof payment?.razorpay_signature === "string" ? payment.razorpay_signature.toLowerCase() : null;
  if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId) || !signature || !SIGNATURE.test(signature)) {
    throw new payments.PaymentError("PAYMENT_DETAILS_INVALID", "The payment confirmation is incomplete.");
  }
  if (payment.razorpay_order_id !== undefined && payment.razorpay_order_id !== row.razorpay_order_id) {
    throw new payments.PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation is for another order.");
  }
  const expected = crypto.createHmac("sha256", razorpay.keySecret).update(`${row.razorpay_order_id}|${paymentId}`).digest("hex");
  if (!payments.timingSafeHexEqual(signature, expected)) {
    events.emit(row.business_id, "error", { code: "PAYMENT_SIGNATURE_INVALID", scope: "invoice.pay", invoiceId: row.id, message: "A payment confirmation with a wrong signature was refused." });
    throw new payments.PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation could not be verified.");
  }
  const invoice = gate.assertIssued(row.business_id, row.id);
  if (paidAlready(row.business_id, paymentId)) return { invoiceId: invoice.id, number: invoice.number, status: invoices.get(row.business_id, row.id).status, already: true };

  const order = await payments.razorpayCall(razorpay, authorization, "GET", `/orders/${encodeURIComponent(row.razorpay_order_id)}`);
  const amountPaise = Number.isInteger(order?.amount_paid) && order.amount_paid > 0 ? order.amount_paid : null;
  if (!amountPaise || order.id !== row.razorpay_order_id) throw new payments.PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay does not show this order as paid.");

  return db.transaction(() => {
    if (paidAlready(row.business_id, paymentId)) return { invoiceId: invoice.id, number: invoice.number, status: invoices.get(row.business_id, row.id).status, already: true };
    events.emit(
      row.business_id,
      "invoice.paid",
      { invoiceId: invoice.id, number: invoice.number, customerId: invoice.customerId, amountPaise, razorpayPaymentId: paymentId, razorpayOrderId: row.razorpay_order_id, testMode: true },
      { actor: "system" },
    );
    return { invoiceId: invoice.id, number: invoice.number, status: invoices.get(row.business_id, row.id).status, already: false };
  });
}

module.exports = { ensureCheckout, checkoutForToken, verifyPayment, isInvoiceToken, TOKEN_TEXT };
