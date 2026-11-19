"use strict";

// Items (contract STK): one item per name across scripts, typed errors, item.saved.
process.env.DB_FILE = ":memory:";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const db = require("../src/db");
const repo = require("../src/db/repo");
const events = require("../src/events");
const items = require("../src/stock/items");

function seedBusiness(language = "hi-IN") {
  const id = repo.newId("biz");
  repo.createBusiness(id, { name: "Asha Kirana", city: "Bengaluru", language });
  return id;
}

function savedEvents(businessId) {
  return repo.listAudit(businessId, {}).filter((row) => row.type === "item.saved");
}

test("upsert creates an item with a canonical unit and a native-script name for a Hindi business", () => {
  const biz = seedBusiness("hi-IN");
  const item = items.upsert(biz, { name: "Basmati Rice", unit: "kilos", sale_price: 95, reorder_level: 25 });
  assert.equal(item.name, "Basmati Rice");
  assert.equal(item.name_native, "बासमती चावल");
  assert.equal(item.unit, "kg");
  assert.equal(item.sale_price, 95);
  assert.equal(item.reorder_level, 25);
  assert.equal(item.hsn, null);
  assert.equal(item.gst_rate, null);
  assert.ok(item.id.startsWith("itm_"));
  assert.equal("business_id" in item, false);
  assert.equal("name_key" in item, false);
  const saved = savedEvents(biz);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].detail.item.id, item.id);
  assert.equal(saved[0].detail.created, true);
});

test("the same item named in Hindi, Kannada or English is one item; a later call updates it", () => {
  const biz = seedBusiness("kn-IN");
  const first = items.upsert(biz, { name: "चावल", unit: "किलो" });
  const second = items.upsert(biz, { name: "ಅಕ್ಕಿ", sale_price: 60 });
  const third = items.upsert(biz, { name: "rice", hsn: "1006 30", gst_rate: 5 });
  assert.equal(second.id, first.id);
  assert.equal(third.id, first.id);
  assert.equal(items.list(biz).length, 1);
  assert.equal(third.name, "चावल");
  assert.equal(third.sale_price, 60);
  assert.equal(third.hsn, "100630");
  assert.equal(third.gst_rate, 5);
  assert.equal(savedEvents(biz).at(-1).detail.created, false);
});

test("findByName matches native script, English and trade words, and ignores a quantity in the text", () => {
  const biz = seedBusiness("hi-IN");
  const rice = items.upsert(biz, { name: "बासमती चावल", unit: "kg" });
  const sugar = items.upsert(biz, { name: "sugar", unit: "kg" });
  const soap = items.upsert(biz, { name: "Lifebuoy soap", name_native: "लाइफबॉय साबुन", unit: "piece" });
  assert.equal(items.findByName(biz, "basmati rice").id, rice.id);
  assert.equal(items.findByName(biz, "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ").id, rice.id);
  assert.equal(items.findByName(biz, "50 किलो बासमती चावल").id, rice.id);
  assert.equal(items.findByName(biz, "चावल").id, rice.id, "a word of the item names it when only one item has it");
  assert.equal(items.findByName(biz, "चीनी").id, sugar.id);
  assert.equal(items.findByName(biz, "cheeni").id, sugar.id);
  assert.equal(items.findByName(biz, "लाइफबॉय साबुन").id, soap.id);
  assert.equal(items.findByName(biz, "LIFEBUOY  Soap").id, soap.id);
  assert.equal(items.findByName(biz, "cement"), null);
  assert.equal(items.findByName(biz, ""), null);
});

test("findByName refuses to guess between two items and names the choices", () => {
  const biz = seedBusiness("hi-IN");
  items.upsert(biz, { name: "basmati rice", unit: "kg" });
  items.upsert(biz, { name: "sona masoori rice", unit: "kg" });
  assert.throws(
    () => items.findByName(biz, "चावल"),
    (err) => err.code === "AMBIGUOUS_ITEM" && err.details.choices.length === 2,
  );
  assert.equal(items.findByName(biz, "sona masoori rice").name, "sona masoori rice");
});

test("items of another business are invisible", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const rice = items.upsert(a, { name: "rice", unit: "kg" });
  assert.equal(items.get(b, rice.id), null);
  assert.equal(items.findByName(b, "rice"), null);
  assert.deepEqual(items.list(b), []);
  const own = items.upsert(b, { name: "rice", unit: "bag" });
  assert.notEqual(own.id, rice.id);
  assert.equal(items.get(a, rice.id).unit, "kg");
});

test("bad input is refused with typed errors and nothing is stored", () => {
  const biz = seedBusiness();
  assert.throws(() => items.upsert(biz, { name: "rice" }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "rice", unit: "handful" }), { code: "UNKNOWN_UNIT" });
  assert.throws(() => items.upsert(biz, { name: "50 kg", unit: "kg" }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "  ", unit: "kg" }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "rice", unit: "kg", hsn: "10A6" }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "rice", unit: "kg", gst_rate: 41 }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "rice", unit: "kg", sale_price: -1 }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert(biz, { name: "x".repeat(81), unit: "kg" }), { code: "INVALID_ITEM" });
  assert.throws(() => items.upsert("", { name: "rice", unit: "kg" }), { code: "BUSINESS_REQUIRED" });
  assert.deepEqual(items.list(biz), []);
});

test("the unit of an item with stock moves cannot change", () => {
  const biz = seedBusiness();
  const rice = items.upsert(biz, { name: "rice", unit: "kg" });
  assert.equal(items.upsert(biz, { name: "rice", unit: "bag" }).unit, "bag", "no stock yet: the unit may change");
  db.prepare("INSERT INTO stock_moves (id, business_id, item_id, qty, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    repo.newId("stm"),
    biz,
    rice.id,
    10,
    "opening",
    new Date().toISOString(),
  );
  assert.throws(() => items.upsert(biz, { name: "rice", unit: "kg" }), { code: "UNIT_LOCKED" });
  assert.equal(items.get(biz, rice.id).unit, "bag");
});

test("nameKey folds the same item to the same key across scripts", () => {
  assert.equal(items.nameKey("Basmati Rice"), items.nameKey("बासमती चावल"));
  assert.equal(items.nameKey("ಬಾಸ್ಮತಿ ಅಕ್ಕಿ"), items.nameKey("basmati rice"));
  assert.equal(items.nameKey("Sona  Masoori!"), "sona masoori");
  assert.equal(items.nameKey("100 kg"), "");
});

test("the database refuses a stock move for another business's item", () => {
  const a = seedBusiness();
  const b = seedBusiness();
  const rice = items.upsert(a, { name: "rice", unit: "kg" });
  assert.throws(() =>
    db.prepare("INSERT INTO stock_moves (id, business_id, item_id, qty, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(repo.newId("stm"), b, rice.id, 5, "opening", new Date().toISOString()),
  );
  void events;
});
