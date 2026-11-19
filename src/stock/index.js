"use strict";

/**
 * The stock ledger (contract STK). Append-only moves; on hand is their sum, in the item's unit.
 * Every function takes businessId first.
 *
 *   move(businessId, {itemId, qty, reason, refId})  qty signed: + in, - out
 *     reason opening | purchase (a delivered purchase order, refId = order id, once per item)
 *            | sale (an issued invoice, refId = invoice id) | adjust (a recount)
 *   onHand(businessId, itemId)
 *
 * Every move emits stock.moved {move, on_hand, item}; the low-stock watcher (./reorder) listens.
 * Selling below zero is recorded, not refused: the shop already handed the goods over, and a
 * refusal would only hide it. Such an item reads as low.
 */

const db = require("../db");
const repo = require("../db/repo");
const events = require("../events");
const items = require("./items");
const { unitRatio } = require("../procurement/units");
const { StockError } = require("./errors");

const REASONS = ["opening", "purchase", "sale", "adjust"];
const QTY_MAX = 10_000_000;
const REF_MAX = 64;
const RECENT_MOVES = 50;

const round3 = (n) => Math.round(n * 1000) / 1000;

function requireItem(businessId, itemId) {
  const item = items.get(businessId, itemId);
  if (!item) throw new StockError("ITEM_NOT_FOUND", "There is no such item for this business.", { status: 404 });
  return item;
}

function sumOf(businessId, itemId) {
  return round3(db.prepare("SELECT COALESCE(SUM(qty), 0) AS total FROM stock_moves WHERE business_id = ? AND item_id = ?").get(businessId, itemId).total);
}

/** Stock on hand of one item, in its unit. Throws ITEM_NOT_FOUND for an item not of this business. */
function onHand(businessId, itemId) {
  requireItem(businessId, itemId);
  return sumOf(businessId, itemId);
}

function checkMove({ qty, reason, refId }) {
  if (!REASONS.includes(reason)) throw new StockError("INVALID_MOVE", `reason must be one of: ${REASONS.join(", ")}.`);
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty === 0 || Math.abs(qty) > QTY_MAX) {
    throw new StockError("INVALID_MOVE", `qty must be a number other than zero, at most ${QTY_MAX}.`);
  }
  if ((reason === "opening" || reason === "purchase") && qty < 0) throw new StockError("INVALID_MOVE", `A ${reason} move adds stock: qty must be above zero.`);
  if (reason === "sale" && qty > 0) throw new StockError("INVALID_MOVE", "A sale takes stock out: qty must be below zero.");
  if (refId != null && (typeof refId !== "string" || !refId.trim() || refId.length > REF_MAX)) {
    throw new StockError("INVALID_MOVE", `refId is an id of at most ${REF_MAX} characters.`);
  }
  if (reason === "purchase" && refId == null) throw new StockError("INVALID_MOVE", "A purchase move names its order (refId).");
}

/**
 * Record one move. Returns {move, on_hand, item}. A purchase order already moved into stock for
 * this item throws ALREADY_RECORDED (409) and records nothing.
 * @param {{itemId: string, qty: number, reason: string, refId?: string|null}} fields
 * @param {{sessionId?: string|null, actor?: string, orderId?: string}} [options]
 *   orderId is added to the event (so a simulated vendor's order is labelled as such)
 */
function move(businessId, { itemId, qty, reason, refId = null } = {}, { sessionId = null, actor = "system", orderId } = {}) {
  checkMove({ qty, reason, refId });
  return db.transaction(() => {
    const item = requireItem(businessId, itemId);
    const id = repo.newId("stm");
    try {
      db.prepare("INSERT INTO stock_moves (id, business_id, item_id, qty, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        id,
        businessId,
        item.id,
        round3(qty),
        reason,
        refId,
        new Date().toISOString(),
      );
    } catch (err) {
      if (/UNIQUE constraint failed/.test(err.message)) {
        throw new StockError("ALREADY_RECORDED", "This order is already in stock.", { status: 409, cause: err });
      }
      throw err;
    }
    const row = db.prepare("SELECT rowid AS seq, * FROM stock_moves WHERE id = ?").get(id);
    const moved = toMove(row);
    const on_hand = sumOf(businessId, item.id);
    events.emit(businessId, "stock.moved", { move: moved, on_hand, item, ...(orderId ? { orderId } : {}) }, { sessionId, actor });
    return { move: moved, on_hand, item };
  });
}

function toMove(row) {
  if (!row) return null;
  const { business_id: _b, ...move } = row;
  return { ...move };
}

/**
 * Set the counted stock of an item: the first count is its opening stock, a later one records
 * the difference as an adjustment. Returns {move (null when nothing changed), on_hand, item}.
 */
function setCount(businessId, { itemId, qty }, options = {}) {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0 || qty > QTY_MAX) throw new StockError("INVALID_MOVE", "The count must be a number of zero or more.");
  return db.transaction(() => {
    const item = requireItem(businessId, itemId);
    const hasMoves = Boolean(db.prepare("SELECT 1 FROM stock_moves WHERE business_id = ? AND item_id = ? LIMIT 1").get(businessId, item.id));
    const current = sumOf(businessId, item.id);
    const delta = round3(qty - current);
    if (delta === 0) return { move: null, on_hand: current, item };
    return move(businessId, { itemId: item.id, qty: delta, reason: hasMoves || delta < 0 ? "adjust" : "opening" }, options);
  });
}

/** The latest moves of the business, newest first. */
function listMoves(businessId, { itemId, limit = RECENT_MOVES } = {}) {
  if (typeof businessId !== "string" || !businessId) throw new StockError("BUSINESS_REQUIRED", "A business id is required.");
  const where = ["business_id = ?"];
  const params = [businessId];
  if (itemId) {
    where.push("item_id = ?");
    params.push(itemId);
  }
  params.push(Math.max(1, Math.min(500, Number(limit) || RECENT_MOVES)));
  return db.prepare(`SELECT rowid AS seq, * FROM stock_moves WHERE ${where.join(" AND ")} ORDER BY rowid DESC LIMIT ?`).all(...params).map(toMove);
}

/* ------------------------------------------------------- reorder level --- */

/**
 * The reorder level in force for an item, in the item's unit: the owner's active reorder_level
 * rule for it (kept with a spoken yes or the tick) wins over the item's own reorder_level.
 * A rule in a unit with no exact relation to the item's unit (bags vs kg) does not apply.
 * @returns {{level: number|null, source: "rule"|"item"|null, ruleId: string|null}}
 */
function levelFor(businessId, item) {
  const rules = require("../agent/rules").active(businessId).filter((r) => r.kind === "reorder_level");
  for (const rule of rules.reverse()) {
    const matches = items.matchByName(businessId, rule.params.item);
    if (matches.length !== 1 || matches[0].id !== item.id) continue;
    const ratio = unitRatio(rule.params.unit, item.unit);
    if (ratio == null) continue;
    return { level: round3(rule.params.level * ratio), source: "rule", ruleId: rule.id };
  }
  return item.reorder_level == null ? { level: null, source: null, ruleId: null } : { level: item.reorder_level, source: "item", ruleId: null };
}

/** One item with its stock: {...item, on_hand, level, level_source, low}. */
function withStock(businessId, item) {
  const on_hand = sumOf(businessId, item.id);
  const { level, source } = levelFor(businessId, item);
  return { ...item, on_hand, level, level_source: source, low: level != null && on_hand <= level };
}

/** GET /api/stock: every item with its stock, and the latest moves. */
function summary(businessId) {
  return { items: items.list(businessId).map((item) => withStock(businessId, item)), moves: listMoves(businessId) };
}

module.exports = { move, onHand, setCount, listMoves, levelFor, withStock, summary, items, REASONS };
