"use strict";

// The stock tools through the registry (contract STK): evidence-checked counts, spoken stock,
// delivered orders, the reorder_level rule (readback then yes) and the answer to "buy more?".
Object.assign(process.env, {
  DB_FILE: ":memory:",
});

const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");

/** The server's outcome line is followed, in the same /speak piece, by its hand-back question; the model says nothing. */
const outcomeSpoken = (line, out) => Object.values(require("../src/agora/outcome").HAND_BACK).some((hand) => line === `${out.outcome} ${hand}`);
const repo = require("../src/db/repo");
const registry = require("../src/tools/registry");
const agent = require("../src/agora/agent");
const jobs = require("../src/jobs");
const stock = require("../src/stock");
const items = require("../src/stock/items");
const reorder = require("../src/stock/reorder");
const agentRules = require("../src/agent/rules");
const { scriptProblems } = require("../src/agora/script");

let stop;
before(() => {
  stop = reorder.start();
});
after(() => stop());

const flush = () => new Promise((resolve) => setImmediate(resolve));
const realFetch = globalThis.fetch;

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

const ownerCtx = (businessId, extra = {}) => ({ businessId, sessionId: null, agentId: null, actor: "agent", toolScope: "owner", ...extra });

async function toolError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    assert.equal(typeof err.say, "string");
    return true;
  });
}

/** A fake live call at the Agora REST boundary (same shape as test/registry.test.js). */
function fakeCall(t) {
  const call = { spoken: [], items: [], turn: 0 };
  call.owner = (content) => call.items.push({ role: "user", content, metadata: { source: "asr" }, turn_id: ++call.turn });
  agent.setFetch(async (url, init) => {
    if (/\/speak$/.test(url)) {
      const body = JSON.parse(init.body);
      call.spoken.push(body.text);
      call.items.push({ role: "assistant", content: body.text, metadata: { source: "command" }, turn_id: ++call.turn });
      return new Response(JSON.stringify({ agent_id: "AG" }), { status: 200 });
    }
    if (/\/history$/.test(url)) return new Response(JSON.stringify({ contents: call.items.slice() }), { status: 200 });
    throw new Error(`unexpected Agora call ${url}`);
  });
  t.after(() => agent.setFetch(null));
  return call;
}

/** An order placed the way the approval gate places one (repo level). */
function seedOrder(businessId, { item = "चावल", quantity = 100, unit = "kg" } = {}) {
  const requirement = repo.createRequirement(businessId, { item, quantity, unit, city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: requirement.id, source: "simulated", name: "Lakshmi Traders", city: "Bengaluru" });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, counterpart: "simulated" });
  const quote = repo.createQuote(businessId, { requirement_id: requirement.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: 60, unit, landed_cost: 6000 });
  const approval = repo.createApproval(businessId, { quote_id: quote.id, readback: "read back", total_amount: 6000 });
  repo.decideApproval(businessId, approval.id, { status: "approved", decided_via: "button" });
  return repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
}

test("set_opening_stock saves what the owner said, in native script, and refuses what the owner did not say", async () => {
  const biz = seedBusiness("hi-IN");
  const ctx = ownerCtx(biz);
  const saved = await registry.callTool(ctx, "set_opening_stock", { item: "बासमती चावल", quantity: 100, unit: "किलो", owner_words: "मेरे पास सौ किलो बासमती चावल है" });
  assert.equal(saved.saved, true);
  assert.equal(saved.on_hand, 100);
  assert.equal(saved.say, "ठीक है, बासमती चावल का स्टॉक 100 किलो लिख लिया।");
  assert.equal(saved.move.reason, "opening");

  const unheard = await registry.callTool(ctx, "set_opening_stock", { item: "चीनी", quantity: 40, unit: "kg", owner_words: "मेरे पास पांच" });
  assert.equal(unheard.saved, false);
  assert.ok(unheard.missing.includes("item"));
  assert.equal(items.findByName(biz, "चीनी"), null, "nothing saved");

  await toolError(registry.callTool(ctx, "set_opening_stock", { item: "चीनी", quantity: 40, owner_words: "चीनी चालीस है" }), "UNIT_NEEDED");
  await toolError(registry.callTool(ctx, "set_opening_stock", { item: "चीनी", quantity: 40, unit: "मुट्ठी", owner_words: "चीनी चालीस मुट्ठी" }), "UNKNOWN_UNIT");
  // A recount in another exact unit is converted to the item's unit.
  const recount = await registry.callTool(ctx, "set_opening_stock", { item: "basmati rice", quantity: 0.5, unit: "quintal", owner_words: "basmati rice 0.5 quintal", reply_language: "en-IN" });
  assert.equal(recount.on_hand, 50);
  assert.equal(recount.move.reason, "adjust");
  assert.equal(recount.say, "Noted: 50 kilograms of बासमती चावल in stock.", "an English line keeps the name the owner gave");
});

test("get_stock speaks one item or the summary with the low items, in the owner's script", async () => {
  const biz = seedBusiness("kn-IN");
  const ctx = ownerCtx(biz);
  assert.equal((await registry.callTool(ctx, "get_stock", {})).say, "ಸ್ಟಾಕ್‌ನಲ್ಲಿ ಇನ್ನೂ ಯಾವ ಸಾಮಾನೂ ದಾಖಲಾಗಿಲ್ಲ. ಯಾವ ಸಾಮಾನು ಎಷ್ಟು ಇದೆ ಎಂದು ಹೇಳಿ.");
  const rice = items.upsert(biz, { name: "rice", unit: "kg", reorder_level: 50 });
  const salt = items.upsert(biz, { name: "salt", unit: "kg" });
  stock.move(biz, { itemId: rice.id, qty: 30, reason: "opening" });
  stock.move(biz, { itemId: salt.id, qty: 80, reason: "opening" });
  const one = await registry.callTool(ctx, "get_stock", { item: "ಅಕ್ಕಿ" });
  assert.equal(one.say, "ಅಕ್ಕಿ 30 ಕೆಜಿ ಉಳಿದಿದೆ, ಇದು 50 ಕೆಜಿ ಮಿತಿಗಿಂತ ಕಡಿಮೆ.");
  assert.equal(one.stock.low, true);
  const all = await registry.callTool(ctx, "get_stock", {});
  assert.equal(all.say, "ಸ್ಟಾಕ್‌ನಲ್ಲಿ 2 ಸಾಮಾನುಗಳಿವೆ; ಕಡಿಮೆ ಇರುವುದು: ಅಕ್ಕಿ.");
  await flush();
  assert.equal(all.reorderPending.length, 1);
  const p = scriptProblems(all.say, "kn-IN");
  assert.deepEqual([p.latin, p.foreign], [[], false]);
  const hi = await registry.callTool(ctx, "get_stock", { item: "cement", reply_language: "hi-IN" });
  assert.equal(hi.item, null);
});

test("mark_order_delivered adds the order to stock once and labels a simulated vendor", async () => {
  const biz = seedBusiness("hi-IN");
  const ctx = ownerCtx(biz);
  await toolError(registry.callTool(ctx, "mark_order_delivered", {}), "NO_OPEN_ORDER");
  const order = seedOrder(biz);
  const out = await registry.callTool(ctx, "mark_order_delivered", {});
  assert.equal(out.orderId, order.id);
  assert.equal(out.status, "delivered");
  assert.equal(out.added, 100);
  assert.equal(out.say, `ऑर्डर ${order.po_number} (सिम्युलेटेड विक्रेता) का माल आ गया, 100 किलो चावल स्टॉक में जुड़ गया। अब 100 किलो है।`);
  const again = await registry.callTool(ctx, "mark_order_delivered", { orderId: order.id });
  assert.equal(again.alreadyDelivered, true);
  assert.equal(stock.onHand(biz, out.itemId), 100);
  await toolError(registry.callTool(ownerCtx(seedBusiness()), "mark_order_delivered", { orderId: order.id }), "ORDER_NOT_FOUND");
});

test("set_reorder_level: the server reads the rule out, the owner's spoken yes keeps it with confirm_rule", async (t) => {
  const biz = seedBusiness("hi-IN");
  const call = fakeCall(t);
  const ctx = ownerCtx(biz, { agentId: "AGS" });
  items.upsert(biz, { name: "चावल", unit: "kg" });
  const asked = await registry.callTool(ctx, "set_reorder_level", { item: "चावल", level: 50 });
  assert.equal(asked.readbackSpoken, true);
  assert.equal(asked.next, "confirm_rule");
  assert.equal(asked.say, "");
  // E2E full run bug 4a: the server's read-back is itself the question, so the yes answers it.
  assert.deepEqual(call.spoken, ["जब चावल 50 किलो या उससे कम बचेगा, मैं आपसे पूछूँगी कि और मँगाऊँ या नहीं। क्या यह नियम रखूँ?"]);
  assert.equal(agentRules.get(biz, asked.ruleId).status, "suggested");
  call.owner("हाँ");
  // The model calls set_reorder_level again for the owner's yes: the rule is not replaced, nothing
  // is spoken again, and the model is told to keep it with confirm_rule.
  const again = await registry.callTool(ctx, "set_reorder_level", { item: "चावल", level: 50 });
  assert.equal(again.ruleId, asked.ruleId);
  assert.equal(again.alreadyAsked, true);
  assert.equal(again.ownerReply, "affirmative");
  assert.match(again.hint, /Call confirm_rule with decision keep now/);
  assert.equal(call.spoken.length, 1);
  assert.deepEqual(agentRules.list(biz).map((r) => r.status), ["suggested"], "no rule.decided 'replaced'");
  const kept = await registry.callTool(ctx, "confirm_rule", { decision: "keep" });
  assert.equal(kept.status, "active");
  assert.equal(kept.outcome, "ठीक है, यह नियम याद रखूँगी।");
  assert.ok(outcomeSpoken(call.spoken.at(-1), kept), "the server says the rule is kept");
  assert.equal(stock.levelFor(biz, items.findByName(biz, "rice")).level, 50);

  const typed = await registry.callTool(ownerCtx(biz), "set_reorder_level", { item: "salt", level: 5, unit: "kg", reply_language: "en-IN" });
  assert.equal(typed.readbackSpoken, false);
  assert.match(typed.say, /tap the tick/);
  await toolError(registry.callTool(ownerCtx(biz), "set_reorder_level", { item: "cement", level: 5 }), "UNIT_NEEDED");
});

test("confirm_reorder asks first when the call has not heard the question, then a spoken yes saves the need and starts the search", async (t) => {
  const biz = seedBusiness("hi-IN");
  const session = repo.createSession(biz, { kind: "owner", channel: "ch" });
  const call = fakeCall(t);
  globalThis.fetch = async () => new Response("not found", { status: 404 }); // IndiaMART: no listings in this test
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const ctx = ownerCtx(biz, { agentId: "AGR", sessionId: session.id });
  await toolError(registry.callTool(ctx, "confirm_reorder", { decision: "yes" }), "NO_PROPOSAL");

  const rice = items.upsert(biz, { name: "चावल", unit: "kg", reorder_level: 50 });
  agentRules.decide(biz, agentRules.propose(biz, { kind: "usual_quantity", params: { item: "चावल", quantity: 200, unit: "kg" }, source: "owner_said" }).id, "keep", { via: "button" });
  stock.move(biz, { itemId: rice.id, qty: 50, reason: "opening" });
  await flush();

  call.owner("हाँ");
  const asked = await registry.callTool(ctx, "confirm_reorder", { decision: "yes" });
  assert.equal(asked.status, "asked", "a yes before the question was asked is not taken");
  assert.equal(asked.say, "हाँ या ना में बताइए।");
  assert.deepEqual(call.spoken, ["चावल कम है, 50 किलो बचा है। 200 किलो और मँगाऊँ?"]);

  call.owner("हाँ");
  const yes = await registry.callTool(ctx, "confirm_reorder", { decision: "yes" });
  assert.equal(yes.status, "accepted");
  assert.equal(yes.requirement.quantity, 200);
  assert.equal(yes.sourcingStarted, true);
  assert.match(yes.jobId, /^job_/);
  assert.equal(yes.outcome, "ठीक है, 200 किलो चावल के लिए विक्रेताओं की खोज शुरू कर दी है। ऑर्डर आपकी हाँ के बिना नहीं होगा।");
  assert.ok(outcomeSpoken(call.spoken.at(-1), yes), "the server says the search started");
  assert.equal(yes.say, "");
  await jobs.whenSettled(yes.jobId);
  assert.equal(repo.listOrders(biz).length, 0, "never an order");
  await toolError(registry.callTool(ctx, "confirm_reorder", { decision: "yes" }), "NO_PROPOSAL");
});

test("confirm_reorder outside a call asks for the button; an unclear answer is refused with a spoken line", async (t) => {
  const biz = seedBusiness("en-IN");
  await toolError(registry.callTool(ownerCtx(biz), "confirm_reorder", { decision: "yes" }), "NO_VOICE_EVIDENCE");
  const call = fakeCall(t);
  const ctx = ownerCtx(biz, { agentId: "AGU" });
  const oil = items.upsert(biz, { name: "oil", unit: "litre", reorder_level: 10 });
  stock.move(biz, { itemId: oil.id, qty: 3, reason: "opening" });
  await flush();
  await registry.callTool(ctx, "confirm_reorder", { decision: "yes" });
  call.owner("maybe later?");
  await assert.rejects(registry.callTool(ctx, "confirm_reorder", { decision: "yes" }), (err) => err.code === "NOT_AFFIRMATIVE" && /yes or no/.test(err.say));
  call.owner("no");
  const no = await registry.callTool(ctx, "confirm_reorder", { decision: "no" });
  assert.equal(no.status, "declined");
  assert.equal(no.outcome, "All right, I will not buy more now.");
  assert.ok(outcomeSpoken(call.spoken.at(-1), no), call.spoken.at(-1));
});

// E2E regress bug 1: every set_reorder_level call failed with INVALID_ARGUMENTS in 0 ms (server log),
// because the model passed owner_words (as it does for set_opening_stock) and the tool's schema
// rejected the unknown argument. The clip: "बासमती चावल पचास किलो से कम हो जाए तो मुझे बताना।"
test("set_reorder_level takes the arguments the model copies from set_opening_stock (owner_words, a unit word, a level as text)", async (t) => {
  const biz = seedBusiness("hi-IN");
  const call = fakeCall(t);
  const ctx = ownerCtx(biz, { agentId: "AGL" });
  await registry.callTool(ownerCtx(biz), "set_opening_stock", { item: "बासमती चावल", quantity: 100, unit: "किलो", owner_words: "मेरे पास सौ किलो बासमती चावल है" });
  const asked = await registry.callTool(ctx, "set_reorder_level", {
    item: "बासमती चावल",
    level: 50,
    unit: "किलो",
    owner_words: "बासमती चावल पचास किलो से कम हो जाए तो मुझे बताना।",
    reply_language: "hi-IN",
  });
  assert.equal(asked.readbackSpoken, true);
  assert.equal(asked.say, "");
  assert.equal(agentRules.get(biz, asked.ruleId).status, "suggested");
  assert.match(call.spoken[0], /^जब बासमती चावल 50 किलो या उससे कम बचेगा.*क्या यह नियम रखूँ\?$/);

  // A level the model sends as text is the same number.
  const biz2 = seedBusiness("hi-IN");
  const typed = await registry.callTool(ownerCtx(biz2), "set_reorder_level", { item: "बासमती चावल", level: "50", unit: "किलो" });
  assert.equal(agentRules.get(biz2, typed.ruleId).params.level, 50);
});

test("set_reorder_level for an item with no stock record yet keeps the rule by name, or asks the unit clearly", async () => {
  const biz = seedBusiness("hi-IN");
  const proposed = await registry.callTool(ownerCtx(biz), "set_reorder_level", { item: "बासमती चावल", level: 50, unit: "किलो" });
  assert.equal(agentRules.get(biz, proposed.ruleId).params.item, "बासमती चावल");
  // Off a call the reply is a question with the tick, never a promise that the rule is kept.
  assert.match(proposed.say, /क्या यह नियम रखूँ\?/);
  await assert.rejects(registry.callTool(ownerCtx(biz), "set_reorder_level", { item: "चीनी", level: 5 }), (err) => {
    assert.equal(err.code, "UNIT_NEEDED");
    assert.equal(err.say, "चीनी किस इकाई में, किलो, पीस या बोरी?");
    return true;
  });
});
