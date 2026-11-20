"use strict";

/**
 * Pay page of an issued invoice: Razorpay Orders API + Standard Checkout, test mode only, through
 * the same Razorpay client and guards as purchase orders (src/orders/payments.js: credentials()
 * refuses a live key before any network call). The shop is the merchant: the pay page names the
 * shop as the one being paid and the customer as the payer; nothing here is a simulated vendor.
 *
 *   ensureCheckout(businessId, invoiceId) -> the pay page PUBLIC_URL/pay/<token>, where token =
 *     "inv_" + 128 random bits, bound to a Razorpay order for what is still open on the invoice.
 *     The token is LOOKED UP only by its SHA-256 (invoices.pay_token_hash), but the full URL is also
 *     kept (invoices.pay_url and the invoice.pay_link audit row) so the owner's screen and Telegram
 *     can show the link again: whoever can read this business's data can open its pay pages. That
 *     is intended (the owner hands the link out); a pay page shows the bill and lets it be paid,
 *     nothing else. Only an issued invoice (consumed approval: gate.assertIssued) gets one.
 *   checkoutForToken(token) -> what the public pay page shows. First it reconciles: a payment
 *     Razorpay captured on one of the invoice's orders that Sahay never recorded (the browser
 *     closed before its verify call) is recorded now, through the same amount and order checks as
 *     verify. Then the amount is what is open NOW: when money came in since the bound order was
 *     made (a cash receipt, a part payment), a new test-mode order is made for the open amount and
 *     bound to the same link before Checkout opens.
 *   verifyPayment(token, {razorpay_payment_id, razorpay_order_id, razorpay_signature}) -> checks
 *     HMAC-SHA256(<order id>|payment id) with the key secret for an order made for this invoice
 *     (never one the browser invents), checks Razorpay was paid exactly that order's amount, and
 *     emits invoice.paid once per payment id. KHATA turns that event into a receipt and moves the
 *     invoice to part_paid / paid.
 *
 * Every order made for an invoice is a row of invoice_pay_orders (seq 1, 2, ...; Razorpay receipt
 * "<invoice id>-<seq>"), so a customer still on an older page can pay it and is recorded at that
 * order's own amount.
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

/* ------------------------------------------------------ pay orders --- */

/** Orders of one invoice the pay page re-checks with Razorpay on every load (newest first). */
const RECONCILE_ORDERS = 5;

/** The invoice_pay_orders row of `razorpayOrderId` for this invoice, or null. */
function payOrder(businessId, invoiceId, razorpayOrderId) {
  if (!razorpayOrderId) return null;
  return db
    .prepare("SELECT seq, razorpay_order_id, amount_paise FROM invoice_pay_orders WHERE business_id = ? AND invoice_id = ? AND razorpay_order_id = ?")
    .get(businessId, invoiceId, razorpayOrderId) ?? null;
}

const nextSeq = (businessId, invoiceId) =>
  db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM invoice_pay_orders WHERE business_id = ? AND invoice_id = ?").get(businessId, invoiceId).n;

/**
 * Work on one invoice's pay page at a time (in this process), so two page loads or a page load and
 * the owner's "send the link" never make two orders for the same attempt.
 */
const locks = new Map();
async function oneAtATime(key, fn) {
  const before = locks.get(key) ?? Promise.resolve();
  const run = before.then(fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** A Razorpay order for `amountPaise`, recorded as the invoice's next attempt. Not yet bound. */
async function newPayOrder(businessId, invoice, amountPaise, { razorpay, authorization }) {
  const seq = nextSeq(businessId, invoice.id);
  const order = await razorpayOrderFor(invoice, { amountPaise, receipt: `${invoice.id}-${seq}`, razorpay, authorization });
  db.prepare("INSERT INTO invoice_pay_orders (business_id, invoice_id, seq, razorpay_order_id, amount_paise, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    businessId, invoice.id, seq, order.id, amountPaise, new Date().toISOString(),
  );
  return order;
}

/** Razorpay does not deduplicate on receipt: an order an earlier, interrupted call made is looked up first and reused. */
async function razorpayOrderFor(invoice, { amountPaise, receipt, razorpay, authorization }) {
  const listed = await payments.razorpayCall(razorpay, authorization, "GET", `/orders?receipt=${encodeURIComponent(receipt)}&count=10`);
  const earlier = listed?.items?.find((o) => o.receipt === receipt && o.amount === amountPaise && o.currency === "INR" && o.status !== "paid");
  if (earlier?.id && RAZORPAY_ORDER_ID.test(earlier.id)) return earlier;
  const made = await payments.razorpayCall(razorpay, authorization, "POST", "/orders", {
    amount: amountPaise,
    currency: "INR",
    receipt, // "<invoice id>-<seq>": within Razorpay's 40 characters
    notes: { invoice_number: invoice.number, kind: "sale invoice" },
  });
  if (!made?.id || !RAZORPAY_ORDER_ID.test(made.id) || made.amount !== amountPaise) {
    throw new payments.PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay answered without a usable order.");
  }
  return made;
}

/** Point the invoice's pay page at `orderId` (and, with `link`, at a new token and expiry). */
function bind(businessId, invoice, orderId, amountPaise, link = null) {
  return db.transaction(() => {
    const changed = link
      ? db
          .prepare("UPDATE invoices SET razorpay_order_id = ?, pay_token_hash = ?, pay_url = ?, pay_expires_at = ? WHERE business_id = ? AND id = ? AND status IN ('issued', 'part_paid')")
          .run(orderId, link.tokenHash, link.url, link.expiresAt, businessId, invoice.id).changes
      : db.prepare("UPDATE invoices SET razorpay_order_id = ? WHERE business_id = ? AND id = ? AND status IN ('issued', 'part_paid')").run(orderId, businessId, invoice.id).changes;
    if (changed !== 1) throw new SellError("INVOICE_NOT_PAYABLE", "This invoice can no longer be paid.", { status: 409 });
    const stored = invoices.get(businessId, invoice.id);
    events.emit(
      businessId,
      "invoice.pay_link",
      { invoiceId: invoice.id, number: invoice.number, url: stored.payUrl, amountPaise, razorpayOrderId: orderId, expiresAt: stored.payExpiresAt, testMode: true },
      { actor: "system" },
    );
    return stored;
  });
}

/** The invoice's open amount, refusing one that cannot be paid any more. */
function payableAmount(businessId, invoice) {
  if (invoice.status === "paid") throw new SellError("INVOICE_ALREADY_PAID", `Invoice ${invoice.number} is already paid.`, { status: 409 });
  if (invoice.status === "cancelled") throw new SellError("INVOICE_NOT_PAYABLE", `Invoice ${invoice.number} is cancelled.`, { status: 409 });
  const amountPaise = openPaise(businessId, invoice);
  if (!(amountPaise > 0)) throw new SellError("INVOICE_ALREADY_PAID", `Nothing is open on invoice ${invoice.number}.`, { status: 409 });
  return amountPaise;
}

/* ---------------------------------------------------- the owner's side --- */

/**
 * Create (or return) the pay page of an issued invoice. Resolves to
 * { invoiceId, number, url, amountPaise, razorpayOrderId, expiresAt, testMode, existing }.
 * A live link keeps its URL; when what is open changed, it is bound to a new order for that amount.
 */
async function ensureCheckout(businessId, invoiceId, { razorpay = config.razorpay, publicUrl = config.publicUrl, now = Date.now } = {}) {
  const authorization = payments.credentials(razorpay);
  const base = payments.pageBase(publicUrl);
  gate.assertIssued(businessId, invoiceId);
  return oneAtATime(`${businessId}:${invoiceId}`, async () => {
    const invoice = gate.assertIssued(businessId, invoiceId);
    const amountPaise = payableAmount(businessId, invoice);
    const live = invoice.razorpayOrderId && invoice.payUrl?.startsWith(`${base}/pay/`) && Date.parse(invoice.payExpiresAt ?? "") > now();
    if (live) {
      if (payOrder(businessId, invoice.id, invoice.razorpayOrderId)?.amount_paise === amountPaise) return result(invoice, amountPaise, true);
      const order = await newPayOrder(businessId, invoice, amountPaise, { razorpay, authorization });
      return result(bind(businessId, invoice, order.id, amountPaise), amountPaise, true);
    }
    const order = await newPayOrder(businessId, invoice, amountPaise, { razorpay, authorization });
    const token = TOKEN_PREFIX + crypto.randomBytes(16).toString("base64url");
    const link = { tokenHash: payments.hashToken(token), url: `${base}/pay/${token}`, expiresAt: new Date(now() + TTL_MS).toISOString() };
    return result(bind(businessId, invoice, order.id, amountPaise, link), amountPaise, false);
  });
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

/* -------------------------------------------------------- the pay page --- */

function rowForToken(token) {
  const row = isInvoiceToken(token) ? db.prepare("SELECT business_id, id, pay_expires_at, razorpay_order_id FROM invoices WHERE pay_token_hash = ?").get(payments.hashToken(token)) : null;
  if (!row) throw new payments.PaymentError("PAY_LINK_INVALID", "This payment link is not valid.");
  return row;
}

/**
 * What the public pay page shows: the shop is paid, the customer pays, for what is open now (the
 * Razorpay order Checkout opens is for exactly that amount). Nothing secret.
 */
async function checkoutForToken(token, { razorpay = config.razorpay, now = Date.now } = {}) {
  const authorization = payments.credentials(razorpay);
  const found = rowForToken(token);
  return oneAtATime(`${found.business_id}:${found.id}`, async () => {
    const row = rowForToken(token);
    let invoice = gate.assertIssued(row.business_id, row.id);
    if (invoice.status !== "paid" && (await reconcile(row, invoice, { razorpay, authorization }))) invoice = gate.assertIssued(row.business_id, row.id);
    const paid = invoice.status === "paid";
    if (Date.parse(row.pay_expires_at) <= now() && !paid) throw new payments.PaymentError("PAY_LINK_EXPIRED", "This payment link has expired; ask the shop for a new one.");
    const amountPaise = paid ? 0 : openPaise(row.business_id, invoice);
    if (amountPaise > 0 && payOrder(row.business_id, invoice.id, invoice.razorpayOrderId)?.amount_paise !== amountPaise) {
      const order = await newPayOrder(row.business_id, invoice, amountPaise, { razorpay, authorization });
      invoice = bind(row.business_id, invoice, order.id, amountPaise);
    }
    const business = repo.getBusiness(row.business_id);
    const lines = invoice.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ");
    return {
      kind: "invoice",
      testMode: true,
      keyId: razorpay.keyId,
      razorpayOrderId: invoice.razorpayOrderId,
      amountPaise,
      amount: amountPaise / 100,
      currency: "INR",
      invoiceNumber: invoice.number,
      language: ["hi-IN", "kn-IN", "en-IN"].includes(business.language) ? business.language : "en-IN", // the shop's wording on the page
      poNumber: invoice.number, // field name the pay page already reads
      merchant: business.name,
      vendor: business.name,
      buyer: invoice.recipient?.name ?? null,
      simulated: false, // a customer paying the shop's own bill: there is no vendor, simulated or real
      item: lines,
      quantity: "",
      unit: "",
      description: `${invoice.number} from ${business.name}, Razorpay test mode`.slice(0, 255),
      invoiceStatus: invoice.status,
      orderStatus: invoice.status,
      paid,
      expiresAt: row.pay_expires_at,
    };
  });
}

const paidAlready = (businessId, paymentId) =>
  repo.listAudit(businessId, { type: "invoice.paid", limit: 1000 }).some((row) => row.detail?.razorpayPaymentId === paymentId);

/**
 * Checkout's success handler posted these. The order must be one made for this invoice (the one
 * bound now when the browser names none); the signature is checked against it; Razorpay must show
 * exactly that order's amount paid. Emits invoice.paid once per payment.
 * Resolves to { invoiceId, number, status, already }.
 */
async function verifyPayment(token, payment, { razorpay = config.razorpay } = {}) {
  const authorization = payments.credentials(razorpay);
  const row = rowForToken(token);
  const paymentId = payment?.razorpay_payment_id;
  const signature = typeof payment?.razorpay_signature === "string" ? payment.razorpay_signature.toLowerCase() : null;
  if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId) || !signature || !SIGNATURE.test(signature)) {
    throw new payments.PaymentError("PAYMENT_DETAILS_INVALID", "The payment confirmation is incomplete.");
  }
  const orderId = payment.razorpay_order_id === undefined ? row.razorpay_order_id : payment.razorpay_order_id;
  const made = typeof orderId === "string" ? payOrder(row.business_id, row.id, orderId) : null;
  if (!made && orderId !== row.razorpay_order_id) {
    throw new payments.PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation is for another order.");
  }
  const expected = crypto.createHmac("sha256", razorpay.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  if (!payments.timingSafeHexEqual(signature, expected)) {
    events.emit(row.business_id, "error", { code: "PAYMENT_SIGNATURE_INVALID", scope: "invoice.pay", invoiceId: row.id, message: "A payment confirmation with a wrong signature was refused." });
    throw new payments.PaymentError("PAYMENT_SIGNATURE_INVALID", "The payment confirmation could not be verified.");
  }
  const invoice = gate.assertIssued(row.business_id, row.id);
  if (paidAlready(row.business_id, paymentId)) return { invoiceId: invoice.id, number: invoice.number, status: invoices.get(row.business_id, row.id).status, already: true };

  const order = await payments.razorpayCall(razorpay, authorization, "GET", `/orders/${encodeURIComponent(orderId)}`);
  if (!(Number.isInteger(order?.amount_paid) && order.amount_paid > 0) || order.id !== orderId) {
    throw new payments.PaymentError("RAZORPAY_BAD_RESPONSE", "Razorpay does not show this order as paid.");
  }
  return recordPaid(row, invoice, { orderId, paymentId, made, order, via: "verify" });
}

/**
 * The one way an invoice payment is recorded (verify and reconcile). Razorpay's order must be for
 * exactly the amount this invoice's order was made for and show exactly that paid (an order made
 * before invoice_pay_orders existed has no recorded amount: it must at least be paid in full);
 * with `paymentAmount` (reconcile) the captured payment must be that amount too. Emits invoice.paid
 * once per payment id; a mismatch is reported as an error event and throws PAYMENT_AMOUNT_MISMATCH.
 */
function recordPaid(row, invoice, { orderId, paymentId, made, order, via, paymentAmount }) {
  const amountPaise = order.amount_paid;
  const due = made?.amount_paise ?? order.amount;
  if (order.amount !== due || amountPaise !== due || (paymentAmount !== undefined && paymentAmount !== due)) {
    events.emit(row.business_id, "error", {
      code: "PAYMENT_AMOUNT_MISMATCH", scope: "invoice.pay", via, invoiceId: row.id, razorpayOrderId: orderId, razorpayPaymentId: paymentId,
      message: `Razorpay shows ${paymentAmount ?? amountPaise} paise paid on an order made for ${due}; nothing was recorded.`,
    });
    throw new payments.PaymentError("PAYMENT_AMOUNT_MISMATCH", "The amount paid is not the amount of this bill's payment order.");
  }
  const status = () => invoices.get(row.business_id, row.id).status;
  return db.transaction(() => {
    if (paidAlready(row.business_id, paymentId)) return { invoiceId: invoice.id, number: invoice.number, status: status(), already: true };
    events.emit(
      row.business_id,
      "invoice.paid",
      { invoiceId: invoice.id, number: invoice.number, customerId: invoice.customerId, amountPaise, razorpayPaymentId: paymentId, razorpayOrderId: orderId, testMode: true, via },
      { actor: "system" },
    );
    return { invoiceId: invoice.id, number: invoice.number, status: status(), already: false };
  });
}

const mismatchReported = (businessId, paymentId) =>
  repo.listAudit(businessId, { type: "error", limit: 1000 }).some((r) => r.detail?.code === "PAYMENT_AMOUNT_MISMATCH" && r.detail?.razorpayPaymentId === paymentId);

/**
 * Record payments Razorpay captured on this invoice's orders that Sahay never heard about (the
 * customer's browser closed before /verify). Checks the newest RECONCILE_ORDERS orders and the bound
 * one; fetches an order's payments (GET /orders/:id/payments) only when Razorpay shows that order
 * paid; records each captured payment through recordPaid. A wrong amount is reported once and
 * skipped, so the page still opens for what is open. A Razorpay failure throws: no page from a
 * guess. Returns true when something was recorded.
 */
async function reconcile(row, invoice, { razorpay, authorization }) {
  const orders = db
    .prepare("SELECT razorpay_order_id, amount_paise FROM invoice_pay_orders WHERE business_id = ? AND invoice_id = ? ORDER BY seq DESC LIMIT ?")
    .all(row.business_id, row.id, RECONCILE_ORDERS)
    .map((made) => ({ orderId: made.razorpay_order_id, made }));
  if (row.razorpay_order_id && !orders.some((o) => o.orderId === row.razorpay_order_id)) {
    orders.push({ orderId: row.razorpay_order_id, made: payOrder(row.business_id, row.id, row.razorpay_order_id) });
  }
  let recorded = false;
  for (const { orderId, made } of orders) {
    if (!RAZORPAY_ORDER_ID.test(orderId ?? "")) continue;
    const order = await payments.razorpayCall(razorpay, authorization, "GET", `/orders/${encodeURIComponent(orderId)}`);
    if (order?.id !== orderId || !(Number.isInteger(order.amount_paid) && order.amount_paid > 0)) continue;
    const listed = await payments.razorpayCall(razorpay, authorization, "GET", `/orders/${encodeURIComponent(orderId)}/payments`);
    const captured = (Array.isArray(listed?.items) ? listed.items : []).filter(
      (p) => p?.status === "captured" && p.order_id === orderId && p.currency === "INR" && typeof p.id === "string" && PAYMENT_ID.test(p.id) && Number.isInteger(p.amount),
    );
    for (const payment of captured) {
      if (paidAlready(row.business_id, payment.id) || mismatchReported(row.business_id, payment.id)) continue;
      try {
        if (!recordPaid(row, invoice, { orderId, paymentId: payment.id, made, order, via: "reconcile", paymentAmount: payment.amount }).already) recorded = true;
      } catch (err) {
        if (err?.code !== "PAYMENT_AMOUNT_MISMATCH") throw err;
      }
    }
  }
  return recorded;
}

module.exports = { ensureCheckout, checkoutForToken, verifyPayment, isInvoiceToken, TOKEN_TEXT };
