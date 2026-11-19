"use strict";

/**
 * Orders. An order exists only as the result of an approval: `createOrder`
 * checks the approval, uses it up and writes the order in one transaction, then
 * issues the purchase order PDF.
 */

const fs = require("node:fs");
const approvals = require("../approvals");
const db = require("../db");
const events = require("../events");
const repo = require("../db/repo");
const po = require("./po");

class OrderError extends Error {
  constructor(code, message, { orderId, cause } = {}) {
    super(message, { cause });
    this.name = "OrderError";
    this.code = code;
    if (orderId) this.orderId = orderId;
  }
}

/** An order is created already confirmed by the owner's approval. */
const INITIAL_STATUS = "confirmed";

/** Which moves are legal, so no caller can skip a step. */
const ALLOWED = {
  confirmed: ["paid", "in_transit", "cancelled"],
  paid: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: ["closed"],
  closed: [],
  cancelled: [],
};

function canTransition(from, to) {
  return (ALLOWED[from] ?? []).includes(to);
}

const yearInIndia = () => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date());

/**
 * Turn an approved deal into an order and its purchase order PDF.
 * Throws an ApprovalError unless this business has an approved, unused approval
 * with that id for a deal that has not changed. If the order is written but the
 * PDF cannot be produced, throws an OrderError carrying `orderId`; the order
 * stands and `issuePurchaseOrder` can be run again.
 */
async function createOrder(businessId, approvalId, { sessionId = null } = {}) {
  const order = db.transaction(() => {
    const { deal } = approvals.assertApproved(businessId, approvalId);
    const created = repo.createOrderFromApproval(businessId, approvalId, {
      status: INITIAL_STATUS,
      po_prefix: `SAHAY/${yearInIndia()}/`,
    });
    events.emit(
      businessId,
      "order.created",
      {
        orderId: created.id,
        poNumber: created.po_number,
        approvalId,
        quoteId: created.quote_id,
        vendor: deal.vendorName,
        simulated: Boolean(deal.simulated),
        amount: created.amount,
        currency: created.currency,
        status: created.status,
      },
      { sessionId, actor: "system" },
    );
    return created;
  });

  try {
    await issuePurchaseOrder(businessId, order.id);
  } catch (err) {
    events.emit(businessId, "error", { scope: "order.po", orderId: order.id, poNumber: order.po_number, message: err.message }, { sessionId });
    throw new OrderError("PO_NOT_ISSUED", `Order ${order.po_number} was created but its purchase order could not be produced: ${err.message}`, {
      orderId: order.id,
      cause: err,
    });
  }
  return repo.getOrder(businessId, order.id);
}

/**
 * Place the order for an approval the owner has just given (the Yes card's tick). Same gate as
 * createOrder. A purchase order PDF that could not be rendered does not undo the order: the
 * order is returned and the error event is already emitted; issuePurchaseOrder can run again.
 */
async function placeApproved(businessId, approvalId, { sessionId = null } = {}) {
  try {
    return await createOrder(businessId, approvalId, { sessionId });
  } catch (err) {
    if (err?.code === "PO_NOT_ISSUED" && err.orderId) return repo.getOrder(businessId, err.orderId);
    throw err;
  }
}

/** Make sure the order's PDF exists on disk and return its path. */
async function issuePurchaseOrder(businessId, orderId) {
  const document = repo.getOrderDocument(businessId, orderId);
  if (!document) throw new OrderError("ORDER_NOT_FOUND", "There is no such order for this business.");
  if (document.order.pdf_path && fs.existsSync(document.order.pdf_path)) return document.order.pdf_path;
  const pdfPath = await po.renderPO(document);
  repo.updateOrder(businessId, orderId, { pdf_path: pdfPath });
  return pdfPath;
}

/**
 * Move an order to its next status. "paid" is not accepted here: only a Razorpay
 * payment whose signature the server verified sets it (payments.verifyCheckoutPayment).
 */
function advanceOrder(businessId, orderId, to, { sessionId = null, actor = "system" } = {}) {
  const order = repo.getOrder(businessId, orderId);
  if (!order) throw new OrderError("ORDER_NOT_FOUND", "There is no such order for this business.");
  if (to === "paid") throw new OrderError("PAID_BY_PAYMENT_ONLY", "An order becomes paid only when Razorpay confirms the payment.");
  if (!canTransition(order.status, to)) {
    const allowed = (ALLOWED[order.status] ?? []).filter((status) => status !== "paid").join(", ") || "none";
    throw new OrderError("ILLEGAL_TRANSITION", `An order cannot move from "${order.status}" to "${to}". Allowed: ${allowed}.`);
  }
  return db.transaction(() => {
    if (!repo.transitionOrder(businessId, orderId, order.status, to)) {
      throw new OrderError("ILLEGAL_TRANSITION", "The order changed while it was being updated; try again.");
    }
    events.emit(businessId, "order.status", { orderId, poNumber: order.po_number, from: order.status, to }, { sessionId, actor });
    return repo.getOrder(businessId, orderId);
  });
}

module.exports = { OrderError, ALLOWED, INITIAL_STATUS, canTransition, createOrder, placeApproved, issuePurchaseOrder, advanceOrder };
