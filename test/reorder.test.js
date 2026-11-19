"use strict";

// The low-stock watcher and reorder proposals (contract STK): stock.low and stock.reorder_proposed
// at or below the level, the server's own question in a live call, and a yes that only saves a
// need (never an order).
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");

const repo = require("../src/db/repo");
const stock = require("../src/stock");
const items = require("../src/stock/items");
const reorder = require("../src/stock/reorder");
const agentRules = require("../src/agent/rules");
const { scriptProblems } = require("../src/agora/script");

const flush = () => new Promise((resolve) => setImmediate(resolve));

let spoken;
let liveCall;
let held;
let stop;
before(() => {
  stop = reorder.start();
  reorder.configure({
    speak: async (agentId, text) => spoken.push({ agentId, text }),
    live: (businessId) => (liveCall && liveCall.businessId === businessId ? liveCall : null),
    held: () => held,
    hold: () => {},
    askDelayMs: 0,
  });
});
after(() => stop());
beforeEach(() => {
  spoken = [];
  liveCall = null;
  held = false;
});

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

const audit = (businessId, type) => repo.listAudit(businessId, {}).filter((row) => row.type === type).map((row) => row.detail);

function keepRule(businessId, kind, params) {
  const rule = agentRules.propose(businessId, { kind, params, source: "owner_said" });
  return agentRules.decide(businessId, rule.id, "keep", { via: "button" });
}

/** A call's /history: the server's line, then the owner's words. */
function history(serverText, ownerWords) {
  return [
    { role: "assistant", content: serverText, metadata: { source: "command" }, turn_id: 1 },
    { role: "user", content: ownerWords, metadata: { source: "asr" }, turn_id: 2 },
  ];
}

test("selling down to the level emits stock.low and one reorder proposal with the usual quantity; more sales do not repeat it", async () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "चावल", unit: "kg", reorder_level: 50 });
  keepRule(biz, "usual_quantity", { item: "चावल", quantity: 200, unit: "kg" });
  stock.move(biz, { itemId: rice.id, qty: 120, reason: "opening" });
  assert.equal(audit(biz, "stock.low").length, 0);
  stock.move(biz, { itemId: rice.id, qty: -70, reason: "sale", refId: "inv_1" });
  await flush();
  const [low] = audit(biz, "stock.low");
  assert.equal(low.item.id, rice.id);
  assert.equal(low.on_hand, 50);
  assert.equal(low.level, 50);
  const [proposed] = audit(biz, "stock.reorder_proposed");
  assert.equal(proposed.item.id, rice.id);
  assert.equal(proposed.quantity, 200);
  assert.equal(proposed.unit, "kg");
  assert.equal(proposed.quantityFrom, "usual_quantity");
  assert.equal(proposed.question["hi-IN"], "चावल कम है, 50 किलो बचा है। 200 किलो और मँगाऊँ?");
  assert.equal(proposed.question["kn-IN"], "ಅಕ್ಕಿ ಕಡಿಮೆ ಇದೆ, 50 ಕೆಜಿ ಉಳಿದಿದೆ. ಇನ್ನೂ 200 ಕೆಜಿ ತರಿಸಲೇ?");
  assert.equal(proposed.question["en-IN"], "चावल is running low, 50 kilograms left. Shall I buy 200 kilograms more?");
  for (const lang of ["hi-IN", "kn-IN"]) {
    const p = scriptProblems(proposed.question[lang], lang);
    assert.deepEqual([p.latin, p.foreign], [[], false], lang);
  }
  stock.move(biz, { itemId: rice.id, qty: -10, reason: "sale", refId: "inv_2" });
  await flush();
  assert.equal(audit(biz, "stock.reorder_proposed").length, 1, "one open proposal per item");
  assert.equal(reorder.listOpen(biz).length, 1);
  assert.equal(repo.listRequirements(biz).length, 0, "nothing is bought or even searched on its own");
});

test("stock back above the level closes the proposal; falling again proposes again; a declined one is not repeated", async () => {
  const biz = seedBusiness();
  const sugar = items.upsert(biz, { name: "sugar", unit: "kg", reorder_level: 10 });
  stock.move(biz, { itemId: sugar.id, qty: 8, reason: "opening" });
  await flush();
  const first = reorder.listOpen(biz)[0];
  assert.ok(first, "an opening count already at the level is proposed");
  assert.equal(first.quantity, null, "no usual quantity and no earlier need: the owner is asked how much");
  stock.move(biz, { itemId: sugar.id, qty: 30, reason: "adjust" });
  await flush();
  assert.equal(reorder.listOpen(biz).length, 0);
  assert.deepEqual(audit(biz, "stock.reorder_decided").map((d) => d.status), ["closed"]);
  stock.move(biz, { itemId: sugar.id, qty: -30, reason: "sale" });
  await flush();
  const second = reorder.listOpen(biz)[0];
  assert.notEqual(second.id, first.id);
  reorder.decide(biz, second.id, "no", { via: "button" });
  stock.move(biz, { itemId: sugar.id, qty: -1, reason: "sale" });
  await flush();
  assert.equal(reorder.listOpen(biz).length, 0, "declined: not asked again until it has been back above the level");
});

test("an item never counted is not low; keeping a reorder_level rule checks the item at once", async () => {
  const biz = seedBusiness();
  const dal = items.upsert(biz, { name: "दाल", unit: "kg" });
  keepRule(biz, "reorder_level", { item: "dal", level: 5, unit: "kg" });
  await flush();
  assert.equal(reorder.listOpen(biz).length, 0, "no count yet");
  stock.move(biz, { itemId: dal.id, qty: 20, reason: "opening" });
  stock.move(biz, { itemId: dal.id, qty: -16, reason: "sale" });
  await flush();
  assert.equal(reorder.listOpen(biz).length, 1);
  assert.equal(stock.summary(biz).items[0].low, true);
});

test("in a live call the server asks itself, once, in the call's language; never while a deal waits for approval", async () => {
  const biz = seedBusiness();
  liveCall = { businessId: biz, agentId: "AG1", sessionId: null, language: "hi-IN" };
  const rice = items.upsert(biz, { name: "rice", unit: "kg", reorder_level: 50 });
  stock.move(biz, { itemId: rice.id, qty: 40, reason: "opening" });
  await flush();
  await flush();
  assert.deepEqual(spoken, [{ agentId: "AG1", text: "चावल कम है, 40 किलो बचा है। और मँगाऊँ?" }]);
  assert.equal(audit(biz, "stock.reorder_spoken").length, 1);
  assert.equal(await reorder.askPending(biz), null, "asked once per call");

  held = true;
  const salt = items.upsert(biz, { name: "salt", unit: "kg", reorder_level: 5 });
  stock.move(biz, { itemId: salt.id, qty: 2, reason: "opening" });
  await flush();
  assert.equal(spoken.length, 1, "held while a read-back waits for an answer");
  held = false;
  assert.equal(await reorder.askPending(biz), "नमक कम है, 2 किलो बचा है। और मँगाऊँ?");
});

test("a spoken yes to the server's question saves a need with the proposed quantity; a yes to nothing is refused", async () => {
  const biz = seedBusiness();
  const session = repo.createSession(biz, { kind: "owner", channel: "ch" });
  liveCall = { businessId: biz, agentId: "AG2", sessionId: session.id, language: "hi-IN" };
  repo.createRequirement(biz, { item: "बासमती चावल", quantity: 150, unit: "kg", city: "Bengaluru" });
  const rice = items.upsert(biz, { name: "basmati rice", unit: "kg", reorder_level: 25 });
  stock.move(biz, { itemId: rice.id, qty: 20, reason: "opening" });
  await flush();
  await flush();
  const proposal = reorder.listOpen(biz)[0];
  assert.equal(proposal.quantity, 150, "the last quantity needed for this item");
  const question = spoken[0].text;

  assert.throws(
    () => reorder.decide(biz, proposal.id, "yes", { via: "voice", agentId: "AG2", history: history("something else", "हाँ") }),
    { code: "READBACK_NOT_HEARD" },
  );
  assert.throws(() => reorder.decide(biz, proposal.id, "yes", { via: "voice", agentId: "AG2", history: history(question, "शायद") }), { code: "NOT_AFFIRMATIVE" });
  assert.throws(() => reorder.decide(biz, proposal.id, "yes", { via: "voice", agentId: "OTHER", history: history(question, "हाँ") }), { code: "READBACK_NOT_SPOKEN" });
  assert.throws(() => reorder.decide(biz, proposal.id, "yes", { via: "voice", agentId: "AG2" }), { code: "EVIDENCE_REQUIRED" });

  const decided = reorder.decide(biz, proposal.id, "yes", { via: "voice", agentId: "AG2", history: history(question, "हाँ जी"), sessionId: session.id });
  assert.equal(decided.status, "accepted");
  assert.equal(decided.requirement.item, "basmati rice");
  assert.equal(decided.requirement.quantity, 150);
  assert.equal(decided.requirement.unit, "kg");
  assert.equal(decided.requirement.city, "Bengaluru");
  assert.equal(decided.requirement.session_id, session.id);
  assert.equal(repo.listOrders(biz).length, 0, "a yes never orders");
  assert.equal(repo.listApprovals(biz).length, 0);
  const [d] = audit(biz, "stock.reorder_decided");
  assert.deepEqual([d.status, d.via, d.evidenceUtterance, d.requirementId], ["accepted", "voice", "हाँ जी", decided.requirement.id]);
  assert.throws(() => reorder.decide(biz, proposal.id, "no", { via: "button" }), { code: "PROPOSAL_DECIDED" });
});

test("a spoken no declines; a yes cannot pass as a no; proposals of another business cannot be decided", async () => {
  const biz = seedBusiness();
  const other = seedBusiness();
  liveCall = { businessId: biz, agentId: "AG3", sessionId: null, language: "en-IN" };
  const oil = items.upsert(biz, { name: "oil", unit: "litre", reorder_level: 10 });
  stock.move(biz, { itemId: oil.id, qty: 4, reason: "opening" });
  await flush();
  await flush();
  const proposal = reorder.listOpen(biz)[0];
  assert.equal(spoken[0].text, "oil is running low, 4 litres left. Shall I buy more?");
  assert.throws(() => reorder.decide(other, proposal.id, "no", { via: "button" }), { code: "NO_PROPOSAL" });
  assert.throws(() => reorder.decide(biz, proposal.id, "no", { via: "voice", agentId: "AG3", history: history(spoken[0].text, "yes") }), { code: "NOT_NEGATIVE" });
  assert.throws(() => reorder.decide(biz, proposal.id, "maybe", { via: "button" }), { code: "INVALID_DECISION" });
  assert.equal(reorder.decide(biz, proposal.id, "no", { via: "voice", agentId: "AG3", history: history(spoken[0].text, "no, not now") }).status, "declined");
  assert.equal(repo.listRequirements(biz).length, 0);
});

test("proposalFor picks the one asked in this call, names several open ones, and finds one by item name", async () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "rice", unit: "kg", reorder_level: 10 });
  const salt = items.upsert(biz, { name: "salt", unit: "kg", reorder_level: 10 });
  stock.move(biz, { itemId: rice.id, qty: 1, reason: "opening" });
  stock.move(biz, { itemId: salt.id, qty: 1, reason: "opening" });
  await flush();
  assert.throws(() => reorder.proposalFor(biz, {}), (err) => err.code === "AMBIGUOUS_ITEM" && err.details.choices.length === 2);
  assert.equal(reorder.proposalFor(biz, { item: "नमक" }).item_id, salt.id);
  liveCall = { businessId: biz, agentId: "AG4", sessionId: null, language: "hi-IN" };
  await reorder.speakQuestion(biz, reorder.proposalFor(biz, { item: "rice" }), liveCall);
  assert.equal(reorder.proposalFor(biz, { agentId: "AG4" }).item_id, rice.id);
  assert.equal(reorder.askedIn(biz, reorder.proposalFor(biz, { item: "rice" }).id, "AG4"), true);
  assert.throws(() => reorder.proposalFor(seedBusiness(), {}), { code: "NO_PROPOSAL" });
});
