const PDFDocument = require("pdfkit");
const db = require("./db");
const { config } = require("./config");

/**
 * Orders and payment.
 *
 * B2B marketplaces in India have no public ordering API - they are a discovery
 * surface. A real order happens the way it always has: a purchase order goes to
 * the vendor, and money moves separately. Sahay does exactly that, and tracks
 * the result, rather than pretending it can press "buy" on IndiaMART.
 */

const FLOW = ["draft", "sent", "confirmed", "paid", "in_transit", "delivered", "closed"];

/** Which transitions are legal, so a UI or the bot cannot skip a step. */
const ALLOWED = {
  draft: ["sent", "cancelled"],
  sent: ["confirmed", "cancelled"],
  confirmed: ["paid", "in_transit", "cancelled"],
  paid: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: ["closed"],
  closed: [],
  cancelled: [],
};

function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}

/**
 * Create a purchase order from a negotiated quote.
 * The quote must already exist - an order can never be raised against a price
 * nobody quoted.
 */
function createFromQuote(business, quoteId, { expectedDelivery, notes } = {}) {
  const quote = db.getQuote(business.id, quoteId);
  if (!quote) throw new Error(`No quote ${quoteId} for this business.`);
  const rfq = db.getRFQ(business.id, quote.rfq_id);
  if (!rfq) throw new Error("The requirement behind this quote no longer exists.");

  const quantity = rfq.quantity;
  const amount = quote.landed_cost ?? (quantity && quote.rate ? quote.rate * quantity : null);
  if (amount == null) throw new Error("Cannot raise a purchase order without a quantity and a rate.");

  const poNumber = db.nextPONumber(business.id);
  const orderId = db.createOrder({
    business_id: business.id, rfq_id: rfq.id, quote_id: quote.id, vendor_id: quote.vendor_id,
    po_number: poNumber, material: rfq.material, quantity, unit: rfq.unit || quote.unit,
    rate: quote.rate, amount,
    expected_delivery: expectedDelivery
      ?? (quote.lead_time_days ? addDays(quote.lead_time_days) : null),
    notes: notes ?? quote.caveat ?? null,
  });

  db.setRFQStatus(business.id, rfq.id, "ordered");
  db.audit(business.id, "order_created", { orderId, poNumber, vendor: quote.vendor_name, amount });
  return db.getOrder(business.id, orderId);
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ PO --- */

const INK = "#14140f";
const MUTED = "#6b6558";
const ACCENT = "#b4531f";

/** Render the purchase order as a PDF Buffer. */
function renderPO(business, order) {
  return new Promise((resolve, reject) => {
    const quote = order.quote_id ? db.getQuote(business.id, order.quote_id) : null;
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Purchase Order ${order.po_number}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fillColor(ACCENT).fontSize(9).text("PURCHASE ORDER", { characterSpacing: 3 });
    doc.fillColor(INK).fontSize(21).text(order.po_number);
    doc.fillColor(MUTED).fontSize(9.5).text(`Raised ${new Date(order.created_at + "Z").toLocaleDateString("en-IN")}`);
    doc.moveDown(1.2);

    const half = (doc.page.width - 100) / 2;
    const top = doc.y;
    doc.fillColor(MUTED).fontSize(8.5).text("BUYER", 50, top);
    doc.fillColor(INK).fontSize(11).text(business.name, 50, doc.y);
    doc.fillColor(MUTED).fontSize(9)
      .text([business.category, business.city, business.state].filter(Boolean).join(", "), { width: half - 12 });

    doc.fillColor(MUTED).fontSize(8.5).text("SUPPLIER", 50 + half, top);
    doc.fillColor(INK).fontSize(11).text(order.vendor_name || "-", 50 + half, top + 12);
    doc.fillColor(MUTED).fontSize(9)
      .text([order.vendor_location, order.vendor_phone].filter(Boolean).join("\n") || "-",
        50 + half, doc.y, { width: half - 12 });

    doc.moveDown(2);
    let y = Math.max(doc.y, top + 78);
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#ddd6c6").lineWidth(1).stroke();
    y += 12;

    doc.fillColor(MUTED).fontSize(8.5);
    doc.text("DESCRIPTION", 50, y);
    doc.text("QTY", 320, y, { width: 60, align: "right" });
    doc.text("RATE", 385, y, { width: 70, align: "right" });
    doc.text("AMOUNT", 460, y, { width: 85, align: "right" });
    y += 16;

    doc.fillColor(INK).fontSize(11);
    doc.text(order.material || "-", 50, y, { width: 260 });
    doc.text(`${fmtNum(order.quantity)} ${order.unit || ""}`.trim(), 320, y, { width: 60, align: "right" });
    doc.text(`${RUPEE}${fmtNum(order.rate)}`, 385, y, { width: 70, align: "right" });
    doc.text(`${RUPEE}${fmtNum(order.amount)}`, 460, y, { width: 85, align: "right" });
    y = doc.y + 14;

    doc.moveTo(320, y).lineTo(doc.page.width - 50, y).strokeColor("#ddd6c6").stroke();
    y += 10;
    doc.fillColor(INK).fontSize(13).text("Total", 320, y, { width: 135, align: "right" });
    doc.text(`${RUPEE}${fmtNum(order.amount)}`, 460, y, { width: 85, align: "right" });

    doc.moveDown(3);
    doc.fillColor(MUTED).fontSize(8.5).text("AGREED TERMS", 50);
    doc.fillColor(INK).fontSize(10);
    const terms = [
      quote?.payment_terms && `Payment: ${quote.payment_terms}`,
      quote?.delivery_terms && `Delivery: ${quote.delivery_terms}`,
      (quote?.lead_time_text || quote?.lead_time_days) && `Lead time: ${quote.lead_time_text || `${quote.lead_time_days} days`}`,
      order.expected_delivery && `Expected delivery: ${order.expected_delivery}`,
      quote?.moq && `Vendor MOQ: ${quote.moq}`,
      order.notes && `Notes: ${order.notes}`,
    ].filter(Boolean);
    if (terms.length) for (const t of terms) doc.text(`• ${t}`, { width: doc.page.width - 100 });
    else doc.fillColor(MUTED).text("As per the recorded negotiation.");

    doc.moveDown(2);
    doc.fillColor(MUTED).fontSize(8)
      .text(
        "These terms were captured during a recorded negotiation conducted by Sahay's assistant on behalf of the buyer, " +
        "and confirmed by the buyer before this order was raised. Please acknowledge receipt to confirm.",
        { width: doc.page.width - 100 },
      );

    doc.end();
  });
}

// PDFKit's built-in Helvetica has no rupee glyph; it would print as a stray
// superscript. Indian invoices conventionally use "Rs." anyway.
const RUPEE = "Rs. ";

const fmtNum = (n) =>
  n == null ? "-" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/* -------------------------------------------------------------- payment --- */

/**
 * Raise a Razorpay payment link for an order.
 * Real API, real link - in test mode until production keys are supplied.
 * Sahay never moves money itself; it asks, and a human authorises.
 */
async function createPaymentLink(business, order) {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new Error("Razorpay keys are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).");
  }
  const auth = "Basic " + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");

  const resp = await fetch(`${config.razorpay.base}/payment_links`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      // Razorpay takes the smallest currency unit.
      amount: Math.round(Number(order.amount) * 100),
      currency: "INR",
      description: `${order.po_number} · ${order.quantity ?? ""} ${order.unit || ""} ${order.material || ""}`.trim().slice(0, 200),
      reference_id: order.po_number.replace(/\//g, "-"),
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { po_number: order.po_number, vendor: order.vendor_name || "", business: business.name },
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Razorpay: ${data?.error?.description || resp.status}`);
  }

  const paymentId = db.addPayment({
    business_id: business.id, order_id: order.id, provider: "razorpay",
    provider_ref: data.id, short_url: data.short_url, amount: order.amount, status: "created",
  });
  db.audit(business.id, "payment_link_created", { order: order.po_number, ref: data.id, amount: order.amount });
  return { paymentId, url: data.short_url, ref: data.id, amount: order.amount };
}

/** Ask Razorpay whether a link has actually been paid. */
async function refreshPaymentStatus(business, order) {
  const payment = db.getPaymentForOrder(order.id);
  if (!payment?.provider_ref) return null;
  const auth = "Basic " + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  const resp = await fetch(`${config.razorpay.base}/payment_links/${payment.provider_ref}`, { headers: { Authorization: auth } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return payment;

  if (data.status && data.status !== payment.status) {
    db.setPaymentStatus(payment.id, data.status);
    if (data.status === "paid" && canTransition(order.status, "paid")) {
      db.setOrderStatus(business.id, order.id, "paid", `Payment received via Razorpay (${payment.provider_ref})`);
    }
  }
  return db.getPaymentForOrder(order.id);
}

function advance(business, orderId, to, note) {
  const order = db.getOrder(business.id, orderId);
  if (!order) throw new Error(`No order ${orderId}.`);
  if (!canTransition(order.status, to)) {
    throw new Error(`Cannot move an order from "${order.status}" to "${to}". Allowed: ${(ALLOWED[order.status] || []).join(", ") || "none"}.`);
  }
  db.setOrderStatus(business.id, orderId, to, note);
  db.audit(business.id, "order_status_changed", { orderId, from: order.status, to });
  return db.getOrder(business.id, orderId);
}

module.exports = {
  FLOW, ALLOWED, canTransition, createFromQuote, renderPO,
  createPaymentLink, refreshPaymentStatus, advance,
};
