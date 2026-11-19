"use strict";

/**
 * A purchase order's goods arrived: the order moves to "delivered" (through "in_transit" when it
 * was still confirmed or paid, the legal order steps of src/orders) and its line comes into
 * stock as a purchase move, once. The line is the requirement the order was placed for; its item
 * is found by name in any script (or created in the requirement's unit), and the quantity is
 * converted to the item's unit only when the two units have an exact relation.
 */

const db = require("../db");
const repo = require("../db/repo");
const orders = require("../orders");
const items = require("./items");
const stock = require("./index");
const { unitRatio } = require("../procurement/units");
const { StockError } = require("./errors");

const DELIVERABLE = ["confirmed", "paid", "in_transit", "delivered"];
const round3 = (n) => Math.round(n * 1000) / 1000;

const alreadyIn = (businessId, orderId) =>
  db.prepare("SELECT rowid AS seq, * FROM stock_moves WHERE business_id = ? AND reason = 'purchase' AND ref_id = ? ORDER BY rowid").all(businessId, orderId);

/**
 * Mark an order delivered and add its goods to stock.
 * Returns {order, item, move, on_hand, added, alreadyDelivered}. A second call for the same order
 * changes nothing and returns alreadyDelivered true.
 * @param {{sessionId?: string|null, actor?: string}} [options]
 */
function markDelivered(businessId, orderId, { sessionId = null, actor = "owner" } = {}) {
  return db.transaction(() => {
    const doc = repo.getOrderDocument(businessId, orderId);
    if (!doc) throw new StockError("ORDER_NOT_FOUND", "There is no such order for this business.", { status: 404 });
    const { order, requirement } = doc;
    if (!DELIVERABLE.includes(order.status)) {
      throw new StockError("ORDER_NOT_DELIVERABLE", `Order ${order.po_number} is ${order.status}; its goods cannot come into stock.`, { status: 409, details: { status: order.status } });
    }
    const previous = alreadyIn(businessId, order.id);
    if (previous.length) {
      const item = items.get(businessId, previous[0].item_id);
      return { order, item, move: previous[0], on_hand: stock.onHand(businessId, item.id), added: previous[0].qty, alreadyDelivered: true };
    }
    if (!requirement?.item || requirement.quantity == null || !requirement.unit) {
      throw new StockError("ORDER_LINE_INCOMPLETE", `Order ${order.po_number} has no item, quantity or unit to add to stock.`, { status: 409 });
    }

    const item = items.findByName(businessId, requirement.item) ?? items.upsert(businessId, { name: requirement.item, unit: requirement.unit }, { sessionId, actor: "system" });
    const ratio = unitRatio(requirement.unit, item.unit);
    if (ratio == null) {
      throw new StockError("UNIT_MISMATCH", `${item.name} is counted in ${item.unit} but the order is in ${requirement.unit}.`, { status: 409, details: { item, unit: item.unit, orderUnit: requirement.unit } });
    }
    const added = round3(requirement.quantity * ratio);

    for (const step of order.status === "confirmed" || order.status === "paid" ? ["in_transit", "delivered"] : order.status === "in_transit" ? ["delivered"] : []) {
      orders.advanceOrder(businessId, order.id, step, { sessionId, actor });
    }
    const moved = stock.move(businessId, { itemId: item.id, qty: added, reason: "purchase", refId: order.id }, { sessionId, actor, orderId: order.id });
    return { order: repo.getOrder(businessId, order.id), item: moved.item, move: moved.move, on_hand: moved.on_hand, added, alreadyDelivered: false };
  });
}

/** The order "mark delivered" means when none is named: the one confirmed, paid or in-transit order. */
function deliverableOrders(businessId) {
  return repo.listOrders(businessId).filter((o) => ["confirmed", "paid", "in_transit"].includes(o.status));
}

module.exports = { markDelivered, deliverableOrders };
