"use strict";

/**
 * public/js/app/stock-model.js: jar fill and reorder line, low items first, and open purchase
 * orders matched to the stock item they bring. Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/stock-model.js"))}`);

test("low is the server's flag, else on hand at or under the line", async () => {
  const { isLow } = await load();
  assert.equal(isLow({ low: true, onHand: 100, reorderLevel: 10 }), true);
  assert.equal(isLow({ low: false, onHand: 1, reorderLevel: 10 }), false);
  assert.equal(isLow({ onHand: 10, reorderLevel: 10 }), true);
  assert.equal(isLow({ onHand: 11, reorderLevel: 10 }), false);
  assert.equal(isLow({ onHand: 0, reorderLevel: null }), false, "no line, no low");
});

test("jar levels: the reorder line sits in the lower third; no line, no line drawn", async () => {
  const { jarLevels } = await load();
  const a = jarLevels({ onHand: 5, reorderLevel: 10 });
  assert.ok(a.fill < a.line, "a low jar is filled below its line");
  assert.ok(a.line <= 1 / 3 + 1e-9);
  const b = jarLevels({ onHand: 100, reorderLevel: 10 });
  assert.ok(b.fill > b.line);
  assert.ok(b.fill <= 1);
  const c = jarLevels({ onHand: 40, reorderLevel: null });
  assert.equal(c.line, null);
  assert.ok(c.fill > 0.7 && c.fill < 0.8);
  assert.deepEqual(jarLevels({ onHand: 0 }), { fill: 0, line: null });
  assert.equal(jarLevels({ onHand: -5, reorderLevel: 2 }).fill, 0);
});

test("shelves: low first, emptiest first; the rest by name", async () => {
  const { shelves } = await load();
  const s = shelves([
    { id: 1, name: "Sugar", onHand: 50, reorderLevel: 10 },
    { id: 2, name: "Atta", onHand: 9, reorderLevel: 10 },
    { id: 3, name: "Dal", onHand: 1, reorderLevel: 10 },
    { id: 4, name: "Basmati", onHand: 80, reorderLevel: null },
  ]);
  assert.deepEqual(s.low.map((i) => i.id), [3, 2]);
  assert.deepEqual(s.rest.map((i) => i.id), [4, 1]);
});

test("incoming orders match a stock item by its name or native name, exactly", async () => {
  const { incomingByItem, stockCounts } = await load();
  const items = [{ id: 1, name: "Basmati rice", nameNative: "बासमती चावल" }, { id: 2, name: "Sugar" }];
  const m = incomingByItem(items, [
    { orderId: "o1", item: "बासमती  चावल", quantity: 200, unit: "kg", po: "PO-1" },
    { orderId: "o2", item: "basmati rice", quantity: 50, unit: "kg" },
    { orderId: "o3", item: "Rice", quantity: 10, unit: "kg" },
    { orderId: "o4", item: null },
  ]);
  assert.deepEqual([...m.keys()], ["1"]);
  assert.deepEqual(m.get("1").map((x) => x.orderId), ["o1", "o2"]);
  assert.deepEqual(stockCounts([{ onHand: 1, reorderLevel: 5 }, { onHand: 9, reorderLevel: 5 }], [{}, {}]), { items: 2, low: 1, coming: 2 });
});

test("an item said in another script shows in the screen's script when stock knows it in that script", async () => {
  const { itemInLang, scriptOfName } = await load();
  const items = [{ id: 1, name: "Basmati rice", nameNative: "बासमती चावल" }, { id: 2, name: "ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", nameNative: "बासमती चावल" }];
  assert.equal(scriptOfName("ಬಾಸ್ಮತಿ ಅಕ್ಕಿ"), "kn");
  assert.equal(scriptOfName("200"), null);
  assert.equal(itemInLang("ಬಾಸ್ಮತಿ ಅಕ್ಕಿ", items, "hi"), "बासमती चावल");
  assert.equal(itemInLang("बासमती चावल", items, "en"), "Basmati rice");
  assert.equal(itemInLang("बासमती चावल", items, "hi"), "बासमती चावल", "already in the screen's script");
  assert.equal(itemInLang("ತೊಗರಿ ಬೇಳೆ", items, "hi"), "ತೊಗರಿ ಬೇಳೆ", "unknown to stock: as said");
  assert.equal(itemInLang("", items, "hi"), "");
});
