"use strict";

// Sahay suggests rules from what the owner does, and refreshes its memories (plan Task B4).
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

const repo = require("../src/db/repo");
const events = require("../src/events");
const approvals = require("../src/approvals");
const rules = require("../src/agent/rules");
const memories = require("../src/agent/memories");
const learn = require("../src/agent/learn");
const agentIndex = require("../src/agent");
const { scriptProblems } = require("../src/agora/script");

let stop;
before(() => {
  stop = agentIndex.start();
});
after(() => stop());

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

/** A need saved the way save_requirement saves one: the row, then requirement.saved. */
function saveNeed(businessId, { item = "चावल", maxPrice = 90, unit = "kg" } = {}) {
  const need = repo.createRequirement(businessId, { item, quantity: 100, unit, city: "Bengaluru", max_price: maxPrice });
  events.emit(businessId, "requirement.saved", need, { actor: "agent" });
  return need;
}

const suggested = (businessId) => rules.list(businessId, { status: "suggested" });

test("the same max price on three needs for the same item gives one learned max_price suggestion with a why", () => {
  const biz = seedBusiness("hi-IN");
  const seen = [];
  const unsubscribe = events.subscribe(biz, (e) => seen.push(e));
  saveNeed(biz, { item: "चावल" });
  saveNeed(biz, { item: "rice" }); // the same item in another script
  assert.equal(suggested(biz).length, 0, "two needs are not yet a habit");
  saveNeed(biz, { item: "चावल" });
  saveNeed(biz, { item: "चावल" }); // a fourth does not suggest it again
  unsubscribe();

  const [rule] = suggested(biz);
  assert.equal(suggested(biz).length, 1);
  assert.equal(rule.source, "learned");
  assert.equal(rule.kind, "max_price");
  assert.deepEqual(rule.params, { item: "चावल", unit: "kg", price: 90 });
  for (const language of ["hi-IN", "kn-IN", "en-IN"]) {
    assert.ok(rule.why[language].includes("90") && rule.why[language].includes("3"), rule.why[language]);
    assert.deepEqual(scriptProblems(rule.why[language], language, { allow: ["चावल"] }).latin, [], rule.why[language]);
  }
  assert.equal(seen.filter((e) => e.type === "rule.suggested").length, 1);
  assert.equal(seen.find((e) => e.type === "rule.suggested").actor, "system");
});

test("different prices or different items do not add up to a suggestion; an active rule is not suggested again", () => {
  const biz = seedBusiness("en-IN");
  saveNeed(biz, { item: "rice", maxPrice: 90 });
  saveNeed(biz, { item: "rice", maxPrice: 85 });
  saveNeed(biz, { item: "sugar", maxPrice: 90 });
  assert.equal(suggested(biz).length, 0);

  const kept = rules.propose(biz, { kind: "max_price", params: { item: "dal", unit: "kg", price: 120 }, source: "owner_said" });
  rules.decide(biz, kept.id, "keep", { via: "button" });
  for (let i = 0; i < 3; i++) saveNeed(biz, { item: "dal", maxPrice: 120 });
  assert.equal(suggested(biz).length, 0, "the owner already has that rule");
});

test("a learned suggestion the owner forgot is not suggested again for 7 days", () => {
  const biz = seedBusiness("en-IN");
  for (let i = 0; i < 3; i++) saveNeed(biz, { item: "rice", maxPrice: 90 });
  const [first] = suggested(biz);
  rules.decide(biz, first.id, "forget", { via: "button" });

  saveNeed(biz, { item: "rice", maxPrice: 90 });
  assert.equal(suggested(biz).length, 0, "forgotten today");

  const eightDaysOn = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const need = saveNeedQuietly(biz, { item: "rice", maxPrice: 90 });
  learn.onEvent({ businessId: biz, type: "requirement.saved", data: need }, { now: eightDaysOn });
  assert.equal(suggested(biz).length, 1, "after a week it may be suggested once more");
});

function saveNeedQuietly(businessId, { item, maxPrice }) {
  return repo.createRequirement(businessId, { item, quantity: 100, unit: "kg", city: "Bengaluru", max_price: maxPrice });
}

test("order.created refreshes the memories and emits memory.updated", () => {
  const biz = seedBusiness("en-IN");
  const need = repo.createRequirement(biz, { item: "rice", quantity: 50, unit: "kg", city: "Bengaluru" });
  const vendor = repo.createVendor(biz, { requirement_id: need.id, source: "indiamart", name: "Lakshmi Traders" });
  const neg = repo.createNegotiation(biz, { requirement_id: need.id, vendor_id: vendor.id, counterpart: "human" });
  const quote = repo.createQuote(biz, { requirement_id: need.id, vendor_id: vendor.id, negotiation_id: neg.id, unit_price: 62, unit: "kg", freight: 0, landed_cost: 3100 });
  const { approval } = approvals.requestApproval(biz, quote.id);
  approvals.confirmApproval(biz, approval.id, { decision: "approve", via: "button" });
  const order = repo.createOrderFromApproval(biz, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });

  const seen = [];
  const unsubscribe = events.subscribe(biz, (e) => seen.push(e));
  events.emit(biz, "order.created", { orderId: order.id, po_number: order.po_number, amount: order.amount }, { actor: "system" });
  unsubscribe();
  const updated = seen.filter((e) => e.type === "memory.updated");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].data.memory.kind, "last_price");
  assert.equal(updated[0].data.memory.data.price, 62);
  assert.deepEqual(memories.list(biz).map((m) => m.kind), ["last_price"]);
});

test("start() is idempotent and its stop ends the subscription", () => {
  const again = agentIndex.start();
  assert.equal(typeof again, "function");
  const biz = seedBusiness("en-IN");
  // One subscription only: three needs give exactly one suggestion event.
  const seen = [];
  const unsubscribe = events.subscribe(biz, (e) => seen.push(e));
  for (let i = 0; i < 3; i++) saveNeed(biz, { item: "salt", maxPrice: 20 });
  unsubscribe();
  assert.equal(seen.filter((e) => e.type === "rule.suggested").length, 1);
});
