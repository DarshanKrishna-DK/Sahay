"use strict";

// The stock ledger and deliveries (contract STK): stock.move / onHand / setCount, levels, and
// a purchase order's goods coming into stock once.
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const stock = require("../src/stock");
const items = require("../src/stock/items");
const delivery = require("../src/stock/delivery");
const agentRules = require("../src/agent/rules");

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

const audit = (businessId, type) => repo.listAudit(businessId, {}).filter((row) => row.type === type).map((row) => row.detail);

/** An order placed the way the approval gate places one (repo level), for `quantity` `unit` of `item`. */
function seedOrder(businessId, { item = "basmati rice", quantity = 50, unit = "kg", source = "indiamart", counterpart = "human" } = {}) {
  const requirement = repo.createRequirement(businessId, { item, quantity, unit, city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: requirement.id, source, name: "Lakshmi Traders", city: "Bengaluru" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, counterpart });
  const quote = repo.createQuote(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: 60, unit, landed_cost: 3000 });
  const approval = repo.createApproval(businessId, { quote_id: quote.id, readback: "read back", total_amount: 3000 });
  repo.decideApproval(businessId, approval.id, { status: "approved", decided_via: "button" });
  return repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
}

test("moves add up to on hand, in the item's unit; each emits stock.moved with the new on hand", () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "rice", unit: "kg" });
  assert.equal(stock.onHand(biz, rice.id), 0);
  stock.move(biz, { itemId: rice.id, qty: 100, reason: "opening" });
  const sold = stock.move(biz, { itemId: rice.id, qty: -12.5, reason: "sale", refId: "inv_1" });
  assert.equal(sold.on_hand, 87.5);
  assert.equal(sold.move.reason, "sale");
  assert.equal(sold.move.ref_id, "inv_1");
  assert.equal(stock.onHand(biz, rice.id), 87.5);
  const moved = audit(biz, "stock.moved");
  assert.deepEqual(moved.map((m) => m.on_hand), [100, 87.5]);
  assert.equal(moved[1].move.qty, -12.5);
  assert.equal(moved[1].item.id, rice.id);
  assert.deepEqual(stock.listMoves(biz).map((m) => m.qty), [-12.5, 100], "newest first");
});

test("a sale below zero is recorded, not refused; wrong signs, reasons and quantities are refused", () => {
  const biz = seedBusiness();
  const soap = items.upsert(biz, { name: "soap", unit: "piece" });
  assert.equal(stock.move(biz, { itemId: soap.id, qty: -3, reason: "sale" }).on_hand, -3);
  for (const bad of [
    { qty: -1, reason: "opening" },
    { qty: -1, reason: "purchase", refId: "ord_1" },
    { qty: 2, reason: "sale" },
    { qty: 0, reason: "adjust" },
    { qty: Number.NaN, reason: "adjust" },
    { qty: 1, reason: "gift" },
    { qty: 1, reason: "purchase" },
  ]) {
    assert.throws(() => stock.move(biz, { itemId: soap.id, ...bad }), { code: "INVALID_MOVE" }, JSON.stringify(bad));
  }
  assert.equal(stock.onHand(biz, soap.id), -3);
});

test("another business's item cannot be moved or read, and stock moves cannot be changed", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const rice = items.upsert(a, { name: "rice", unit: "kg" });
  assert.throws(() => stock.move(b, { itemId: rice.id, qty: 5, reason: "opening" }), { code: "ITEM_NOT_FOUND" });
  assert.throws(() => stock.onHand(b, rice.id), { code: "ITEM_NOT_FOUND" });
  const { move } = stock.move(a, { itemId: rice.id, qty: 5, reason: "opening" });
  assert.throws(() => db.prepare("UPDATE stock_moves SET qty = 500 WHERE id = ?").run(move.id), /cannot be changed/);
  assert.deepEqual(stock.listMoves(b), []);
});

test("setCount records the first count as opening and a later one as the difference", () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "rice", unit: "kg" });
  assert.equal(stock.setCount(biz, { itemId: rice.id, qty: 100 }).move.reason, "opening");
  assert.equal(stock.setCount(biz, { itemId: rice.id, qty: 100 }).move, null, "the same count changes nothing");
  const recount = stock.setCount(biz, { itemId: rice.id, qty: 80 });
  assert.equal(recount.move.reason, "adjust");
  assert.equal(recount.move.qty, -20);
  assert.equal(recount.on_hand, 80);
  assert.throws(() => stock.setCount(biz, { itemId: rice.id, qty: -1 }), { code: "INVALID_MOVE" });
});

test("the level in force: the owner's kept reorder_level rule (converted to the item's unit) wins over the item's own", () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "चावल", unit: "kg", reorder_level: 10 });
  assert.deepEqual(stock.levelFor(biz, rice), { level: 10, source: "item", ruleId: null });
  const rule = agentRules.propose(biz, { kind: "reorder_level", params: { item: "rice", level: 0.5, unit: "quintal" }, source: "owner_said" });
  assert.equal(stock.levelFor(biz, rice).source, "item", "a suggested rule is not in force");
  agentRules.decide(biz, rule.id, "keep", { via: "button" });
  assert.deepEqual(stock.levelFor(biz, rice), { level: 50, source: "rule", ruleId: rule.id });
  stock.move(biz, { itemId: rice.id, qty: 40, reason: "opening" });
  const [row] = stock.summary(biz).items;
  assert.equal(row.on_hand, 40);
  assert.equal(row.level, 50);
  assert.equal(row.level_source, "rule");
  assert.equal(row.low, true);
  // A rule in bags says nothing about kilograms.
  const bags = agentRules.propose(biz, { kind: "reorder_level", params: { item: "चावल", level: 2, unit: "bag" }, source: "owner_said" });
  agentRules.decide(biz, bags.id, "keep", { via: "button" });
  assert.equal(stock.levelFor(biz, rice).source, "item");
});

test("the reorder_level rule reads back in all three languages, in each one's script", () => {
  const rule = agentRules.buildRule("reorder_level", { item: "चावल", level: 50, unit: "किलो" });
  assert.equal(rule.params.unit, "kg");
  assert.equal(rule.sentence["hi-IN"], "जब चावल 50 किलो या उससे कम बचेगा, मैं आपसे पूछूँगी कि और मँगाऊँ या नहीं।");
  assert.match(rule.sentence["kn-IN"], /50 ಕೆಜಿ ಅಥವಾ ಅದಕ್ಕಿಂತ ಕಡಿಮೆ/);
  assert.equal(rule.sentence["en-IN"], "When चावल is down to 50 kilograms or less, I will ask you whether to buy more.");
  assert.equal(agentRules.buildRule("reorder_level", { item: "rice", level: 5, unit: "kg" }).scope_key, rule.scope_key, "rice and चावल are one scope");
  assert.throws(() => agentRules.buildRule("reorder_level", { item: "rice", level: 0, unit: "kg" }), { code: "INVALID_RULE" });
});

test("a delivered order comes into stock once, the order moves to delivered through in_transit", () => {
  const biz = seedBusiness();
  const order = seedOrder(biz, { item: "basmati rice", quantity: 50, unit: "kg" });
  const rice = items.upsert(biz, { name: "बासमती चावल", unit: "kg" });
  stock.move(biz, { itemId: rice.id, qty: 10, reason: "opening" });
  const first = delivery.markDelivered(biz, order.id);
  assert.equal(first.alreadyDelivered, false);
  assert.equal(first.item.id, rice.id, "the order's item is found across scripts");
  assert.equal(first.added, 50);
  assert.equal(first.on_hand, 60);
  assert.equal(first.order.status, "delivered");
  assert.deepEqual(audit(biz, "order.status").map((s) => s.to), ["in_transit", "delivered"]);
  const again = delivery.markDelivered(biz, order.id);
  assert.equal(again.alreadyDelivered, true);
  assert.equal(stock.onHand(biz, rice.id), 60, "not counted twice");
  assert.throws(() => stock.move(biz, { itemId: rice.id, qty: 50, reason: "purchase", refId: order.id }), { code: "ALREADY_RECORDED" });
});

test("delivery creates the item when it is new, converts units with an exact relation and refuses others", () => {
  const biz = seedBusiness();
  const sugarOrder = seedOrder(biz, { item: "sugar", quantity: 2, unit: "quintal" });
  const r = delivery.markDelivered(biz, sugarOrder.id);
  assert.equal(r.item.name, "sugar");
  assert.equal(r.item.unit, "quintal");
  assert.equal(r.on_hand, 2);

  const oil = items.upsert(biz, { name: "oil", unit: "litre" });
  const oilOrder = seedOrder(biz, { item: "oil", quantity: 3, unit: "box" });
  assert.throws(() => delivery.markDelivered(biz, oilOrder.id), { code: "UNIT_MISMATCH" });
  assert.equal(repo.getOrder(biz, oilOrder.id).status, "confirmed", "nothing changed");
  assert.equal(stock.onHand(biz, oil.id), 0);

  const atta = items.upsert(biz, { name: "atta", unit: "kg" });
  const attaOrder = seedOrder(biz, { item: "atta", quantity: 0.5, unit: "tonne" });
  assert.equal(delivery.markDelivered(biz, attaOrder.id).added, 500);
  assert.equal(stock.onHand(biz, atta.id), 500);
});

test("a cancelled order or another business's order is refused; a simulated vendor's delivery is labelled", () => {
  const biz = seedBusiness();
  const other = seedBusiness();
  const order = seedOrder(biz);
  assert.throws(() => delivery.markDelivered(other, order.id), { code: "ORDER_NOT_FOUND" });
  require("../src/orders").advanceOrder(biz, order.id, "cancelled");
  assert.throws(() => delivery.markDelivered(biz, order.id), { code: "ORDER_NOT_DELIVERABLE" });

  const sim = seedOrder(biz, { item: "salt", quantity: 20, unit: "kg", source: "simulated", counterpart: "simulated" });
  delivery.markDelivered(biz, sim.id);
  const moved = audit(biz, "stock.moved").at(-1);
  assert.equal(moved.orderId, sim.id);
  assert.equal(moved.simulated, true);
  assert.equal(moved.vendorLabel, "simulated vendor");
  assert.deepEqual(delivery.deliverableOrders(biz), []);
});
