"use strict";

process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const repo = require("../src/db/repo");
const events = require("../src/events");
const approvals = require("../src/approvals");
const profile = require("../src/agent/profile");
const rules = require("../src/agent/rules");
const memories = require("../src/agent/memories");
const { scriptProblems } = require("../src/agora/script");

const LANGS = ["hi-IN", "kn-IN", "en-IN"];

function seedBusiness({ name = "Asha Stores", language = "hi-IN" } = {}) {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name, city: "Bengaluru", language });
  return id;
}

/** Collect the events of one business while `fn` runs. */
function captured(businessId, fn) {
  const seen = [];
  const stop = events.subscribe(businessId, (e) => seen.push(e));
  try {
    const out = fn();
    return { out, seen };
  } finally {
    stop();
  }
}

/** One approved, ordered deal for `item` from `vendorName` (button approval, like the Yes card). */
function seedOrder(businessId, { item = "चावल", quantity = 50, unit = "kg", price = 62, vendorName = "Lakshmi Traders", source = "indiamart" } = {}) {
  const need = repo.createRequirement(businessId, { item, quantity, unit, city: "Bengaluru" });
  const vendor = repo.createVendor(businessId, { requirement_id: need.id, source, name: vendorName });
  const negotiation = repo.createNegotiation(businessId, { requirement_id: need.id, vendor_id: vendor.id, counterpart: source === "simulated" ? "simulated" : "human" });
  const quote = repo.createQuote(businessId, {
    requirement_id: need.id, vendor_id: vendor.id, negotiation_id: negotiation.id, unit_price: price, unit, freight: 0, lead_time_days: 2,
    landed_cost: price * quantity,
  });
  const { approval } = approvals.requestApproval(businessId, quote.id);
  approvals.confirmApproval(businessId, approval.id, { decision: "approve", via: "button" });
  return repo.createOrderFromApproval(businessId, approval.id, { status: "confirmed", po_prefix: "SAHAY/2026/" });
}

/* -------------------------------------------------------------- profile --- */

test("profile defaults to normal speed, balanced bargaining and the business language", () => {
  const biz = seedBusiness({ language: "kn-IN" });
  assert.deepEqual(profile.get(biz), { business_id: biz, voice_speed: "normal", bargain_style: "balanced", language: "kn-IN" });
});

test("profile.update stores the choice, changes the business language and emits profile.updated", () => {
  const biz = seedBusiness();
  const { out, seen } = captured(biz, () => profile.update(biz, { voice_speed: "slow", bargain_style: "tough", language: "en-IN" }));
  assert.deepEqual(out, { business_id: biz, voice_speed: "slow", bargain_style: "tough", language: "en-IN" });
  assert.equal(repo.getBusiness(biz).language, "en-IN", "one source of truth for the language");
  assert.deepEqual(profile.get(biz), out);
  assert.deepEqual(seen.map((e) => [e.type, e.data.profile]), [["profile.updated", out]]);

  const partial = profile.update(biz, { voice_speed: "normal" });
  assert.equal(partial.bargain_style, "tough", "a partial update keeps the other fields");
});

test("profile.update refuses unknown values, unknown fields and an empty patch", () => {
  const biz = seedBusiness();
  for (const patch of [{ voice_speed: "fast" }, { bargain_style: "rude" }, { language: "ta-IN" }, { business_id: "biz_other" }, {}, null]) {
    assert.throws(() => profile.update(biz, patch), (err) => err.code === "INVALID", JSON.stringify(patch));
  }
  assert.equal(profile.get(biz).voice_speed, "normal");
});

/* ---------------------------------------------------------------- rules --- */

test("rules.propose builds a suggested rule with a sentence in all three scripts and emits rule.suggested", () => {
  const biz = seedBusiness();
  const { out: rule, seen } = captured(biz, () => rules.propose(biz, { kind: "max_price", params: { item: "चावल", unit: "kilo", price: 80 }, source: "owner_said" }));
  assert.match(rule.id, /^rul_/);
  assert.equal(rule.kind, "max_price");
  assert.deepEqual(rule.params, { item: "चावल", unit: "kg", price: 80 }, "unit stored as its canonical code");
  assert.equal(rule.status, "suggested");
  assert.equal(rule.source, "owner_said");
  assert.equal(rule.why, null);
  assert.equal(rule.decided_at, null);
  assert.ok(rule.created_at);
  assert.deepEqual(Object.keys(rule).sort(), ["created_at", "decided_at", "id", "kind", "params", "sentence", "source", "status", "why"]);
  for (const language of LANGS) {
    assert.ok(rule.sentence[language].includes("80"), `${language}: ${rule.sentence[language]}`);
  }
  assert.deepEqual(seen.map((e) => [e.type, e.data.rule.id]), [["rule.suggested", rule.id]]);
});

test("every rule kind has a native-script sentence in hi, kn and en", () => {
  const biz = seedBusiness();
  const cases = [
    { kind: "max_price", params: { item: "basmati rice", unit: "kg", price: 80.5 } },
    { kind: "prefer_vendor", params: { name: "Lakshmi Traders" } },
    { kind: "avoid_vendor", params: { name: "ಶ್ರೀ ಟ್ರೇಡರ್ಸ್" } },
    { kind: "usual_quantity", params: { item: "sugar", quantity: 200, unit: "bag" } },
    { kind: "reply_language", params: { language: "kn-IN" } },
    { kind: "bargain_style", params: { style: "gentle" } },
  ];
  for (const { kind, params } of cases) {
    const rule = rules.propose(biz, { kind, params, source: "owner_said" });
    const allow = [params.item, params.name].filter(Boolean);
    for (const language of LANGS) {
      const text = rule.sentence[language];
      assert.ok(typeof text === "string" && text.length > 5, `${kind} ${language}`);
      assert.deepEqual(scriptProblems(text, language, { allow }), { latin: [], foreign: false }, `${kind} ${language}: ${text}`);
    }
  }
});

test("rules.propose rejects unknown kinds and params outside the schema", () => {
  const biz = seedBusiness();
  const long = "A".repeat(81);
  const bad = [
    { kind: "always_order", params: {} },
    { kind: "max_price", params: { item: "rice", unit: "kg", price: 0 } },
    { kind: "max_price", params: { item: "rice", unit: "kg", price: -5 } },
    { kind: "max_price", params: { item: "rice", unit: "kg", price: "80" } },
    { kind: "max_price", params: { item: "rice", unit: "kg", price: Infinity } },
    { kind: "max_price", params: { item: "", unit: "kg", price: 80 } },
    { kind: "max_price", params: { item: "rice", unit: "bucketful", price: 80 } },
    { kind: "max_price", params: { item: "rice", unit: "kg", price: 80, approve: true } },
    { kind: "prefer_vendor", params: { name: "" } },
    { kind: "prefer_vendor", params: { name: "   \u0007 " } },
    { kind: "avoid_vendor", params: { name: long } },
    { kind: "avoid_vendor", params: { name: `${"B".repeat(78)}\n\n\nCC` } },
    { kind: "usual_quantity", params: { item: "rice", quantity: 0, unit: "kg" } },
    { kind: "reply_language", params: { language: "ta-IN" } },
    { kind: "bargain_style", params: { style: "aggressive" } },
  ];
  for (const proposal of bad) {
    assert.throws(() => rules.propose(biz, { ...proposal, source: "owner_said" }), (err) => err.code === "INVALID_RULE", JSON.stringify(proposal));
  }
  assert.throws(() => rules.propose(biz, { kind: "bargain_style", params: { style: "tough" }, source: "the_vendor" }), (err) => err.code === "INVALID_RULE");
  assert.equal(rules.list(biz).length, 0, "nothing was stored");
});

test("a vendor name is cleaned by the vendor-text sanitiser before it is checked and stored", () => {
  const biz = seedBusiness();
  const rule = rules.propose(biz, { kind: "avoid_vendor", params: { name: "  Ravi​\nTraders  " }, source: "owner_said" });
  assert.equal(rule.params.name, "Ravi Traders");
});

test("decide keep makes the rule active and emits rule.decided", () => {
  const biz = seedBusiness();
  const rule = rules.propose(biz, { kind: "max_price", params: { item: "rice", unit: "kg", price: 80 }, source: "owner_said" });
  const { out: kept, seen } = captured(biz, () => rules.decide(biz, rule.id, "keep", { via: "button" }));
  assert.equal(kept.status, "active");
  assert.ok(kept.decided_at);
  assert.deepEqual(rules.active(biz).map((r) => r.id), [rule.id]);
  assert.deepEqual(seen.map((e) => [e.type, e.data.rule.id, e.data.rule.status, e.actor]), [["rule.decided", rule.id, "active", "owner"]]);
});

test("decide forget turns a suggested or an active rule off", () => {
  const biz = seedBusiness();
  const a = rules.propose(biz, { kind: "prefer_vendor", params: { name: "Lakshmi Traders" }, source: "owner_said" });
  assert.equal(rules.decide(biz, a.id, "forget", { via: "button" }).status, "off");
  const b = rules.propose(biz, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  rules.decide(biz, b.id, "keep", { via: "button" });
  assert.equal(rules.decide(biz, b.id, "forget", { via: "button" }).status, "off");
  assert.deepEqual(rules.active(biz), []);
});

test("deciding again the same way is harmless (a second tab); keeping a forgotten rule is refused", () => {
  const biz = seedBusiness();
  const rule = rules.propose(biz, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  rules.decide(biz, rule.id, "keep", { via: "button" });
  assert.equal(rules.decide(biz, rule.id, "keep", { via: "button" }).status, "active");
  rules.decide(biz, rule.id, "forget", { via: "button" });
  assert.equal(rules.decide(biz, rule.id, "forget", { via: "button" }).status, "off");
  assert.throws(() => rules.decide(biz, rule.id, "keep", { via: "button" }), (err) => err.code === "RULE_ALREADY_DECIDED");
});

test("decide refuses an unknown decision, an unknown via and a voice decision without the readback evidence", () => {
  const biz = seedBusiness();
  const rule = rules.propose(biz, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  assert.throws(() => rules.decide(biz, rule.id, "yes", { via: "button" }), (err) => err.code === "INVALID_DECISION");
  assert.throws(() => rules.decide(biz, rule.id, "keep", { via: "text" }), (err) => err.code === "INVALID_VIA");
  assert.throws(() => rules.decide(biz, rule.id, "keep", { via: "voice" }), (err) => err.code !== undefined && err.code !== "INVALID_VIA");
  assert.equal(rules.get(biz, rule.id).status, "suggested");
});

test("another business's rule id is not found", () => {
  const mine = seedBusiness();
  const theirs = seedBusiness({ name: "Other Shop" });
  const rule = rules.propose(theirs, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  assert.throws(() => rules.decide(mine, rule.id, "keep", { via: "button" }), (err) => err.code === "RULE_NOT_FOUND");
  assert.equal(rules.get(mine, rule.id), null);
  assert.equal(rules.get(theirs, rule.id).status, "suggested");
  assert.deepEqual(rules.list(mine), []);
});

test("one active rule per kind and item: a newer kept rule turns the older off", () => {
  const biz = seedBusiness();
  const older = rules.propose(biz, { kind: "max_price", params: { item: "Rice", unit: "kg", price: 90 }, source: "owner_said" });
  rules.decide(biz, older.id, "keep", { via: "button" });
  const sugar = rules.propose(biz, { kind: "max_price", params: { item: "sugar", unit: "kg", price: 40 }, source: "owner_said" });
  rules.decide(biz, sugar.id, "keep", { via: "button" });
  const newer = rules.propose(biz, { kind: "max_price", params: { item: "rice ", unit: "kg", price: 80 }, source: "owner_said" });

  const { seen } = captured(biz, () => rules.decide(biz, newer.id, "keep", { via: "button" }));
  assert.equal(rules.get(biz, older.id).status, "off");
  assert.deepEqual(rules.active(biz).map((r) => r.id).sort(), [sugar.id, newer.id].sort(), "a rule for another item is untouched");
  assert.deepEqual(seen.map((e) => [e.type, e.data.rule.id, e.data.rule.status]), [
    ["rule.decided", older.id, "off"],
    ["rule.decided", newer.id, "active"],
  ]);
});

test("preferring and avoiding the same vendor conflict: the newer kept one wins", () => {
  const biz = seedBusiness();
  const prefer = rules.propose(biz, { kind: "prefer_vendor", params: { name: "Lakshmi Traders" }, source: "owner_said" });
  rules.decide(biz, prefer.id, "keep", { via: "button" });
  const avoid = rules.propose(biz, { kind: "avoid_vendor", params: { name: "lakshmi traders" }, source: "owner_said" });
  rules.decide(biz, avoid.id, "keep", { via: "button" });
  assert.deepEqual(rules.active(biz).map((r) => r.kind), ["avoid_vendor"]);
});

test("a newer suggestion for the same kind and item replaces the older suggestion", () => {
  const biz = seedBusiness();
  const first = rules.propose(biz, { kind: "bargain_style", params: { style: "tough" }, source: "owner_said" });
  const second = rules.propose(biz, { kind: "bargain_style", params: { style: "gentle" }, source: "owner_said" });
  assert.equal(rules.get(biz, first.id).status, "off");
  assert.deepEqual(rules.list(biz, { status: "suggested" }).map((r) => r.id), [second.id]);
});

test("a learned rule keeps its why in three languages", () => {
  const biz = seedBusiness();
  const why = { "hi-IN": "आपने तीन बार यही भाव रखा।", "kn-IN": "ನೀವು ಮೂರು ಬಾರಿ ಇದೇ ಬೆಲೆ ಇಟ್ಟಿದ್ದೀರಿ.", "en-IN": "You set this price three times." };
  const rule = rules.propose(biz, { kind: "max_price", params: { item: "rice", unit: "kg", price: 90 }, source: "learned", why });
  assert.deepEqual(rule.why, why);
  assert.throws(() => rules.propose(biz, { kind: "max_price", params: { item: "rice", unit: "kg", price: 90 }, source: "learned", why: { "en-IN": "x" } }), (err) => err.code === "INVALID_RULE");
});

/* ------------------------------------------------------------- memories --- */

test("a fresh business has no memories", () => {
  const biz = seedBusiness();
  assert.deepEqual(memories.list(biz), []);
  assert.deepEqual(memories.refresh(biz), []);
});

test("memories.refresh derives last price, usual item and liked vendor from orders, labels a simulated vendor, and emits memory.updated once", () => {
  const biz = seedBusiness({ language: "en-IN" });
  seedOrder(biz, { item: "rice", price: 64, vendorName: "Mock Mills", source: "simulated" });
  seedOrder(biz, { item: "rice", price: 62, vendorName: "Mock Mills", source: "simulated" });

  const { out, seen } = captured(biz, () => memories.refresh(biz));
  const byKind = Object.fromEntries(out.map((m) => [m.kind, m]));
  assert.deepEqual(Object.keys(byKind).sort(), ["last_price", "liked_vendor", "usual_item"]);
  assert.equal(byKind.last_price.data.price, 62);
  assert.equal(byKind.last_price.data.simulated, true);
  assert.equal(byKind.liked_vendor.data.simulated, true);
  assert.equal(byKind.liked_vendor.data.vendorLabel, "simulated vendor");
  assert.match(byKind.liked_vendor.sentence["en-IN"], /simulated vendor/);
  assert.match(byKind.last_price.sentence["en-IN"], /simulated vendor/);
  for (const m of out) {
    assert.deepEqual(Object.keys(m).sort(), ["data", "id", "kind", "sentence", "updated_at"]);
    for (const language of LANGS) {
      assert.deepEqual(scriptProblems(m.sentence[language], language, { allow: ["rice", "Mock Mills"] }), { latin: [], foreign: false }, m.sentence[language]);
    }
  }
  assert.equal(seen.filter((e) => e.type === "memory.updated").length, 3);

  const again = captured(biz, () => memories.refresh(biz));
  assert.equal(again.seen.length, 0, "nothing changed, nothing emitted");
  assert.deepEqual(memories.list(biz).map((m) => m.id).sort(), out.map((m) => m.id).sort());
});

test("one order is a last price, not yet a usual item or a liked vendor; memories are per business", () => {
  const biz = seedBusiness();
  const other = seedBusiness({ name: "Other Shop" });
  seedOrder(biz, { item: "चावल" });
  assert.deepEqual(memories.refresh(biz).map((m) => m.kind), ["last_price"]);
  assert.deepEqual(memories.list(other), []);
});
