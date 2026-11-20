"use strict";

/**
 * public/js/app/yes-facts.js: what the v5 Yes card says for each kind (screens.md 03: What, Who,
 * How much, the simulated-vendor words, the folded read-back) and which view the "Needs you" host
 * opens. No DOM, no imports, so the module is imported from its source as a data: URL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "yes-facts.js"), "utf8");
const load = () => import(`data:text/javascript;base64,${Buffer.from(SOURCE).toString("base64")}`);

const fmt = {
  money: (n) => `₹${Number(n).toLocaleString("en-IN")}`,
  qty: (n, u) => `${n}${u ? ` ${u}` : ""}`,
  itemName: (it) => (it && it.name) || "",
  lineName: (l) => l.name || "",
};

test("buy: three rows only - what (item, quantity), who (seller, simulated flag), how much (landed total)", async () => {
  const { cardFacts } = await load();
  const f = cardFacts({ key: "approval:1", kind: "buy" }, {
    view: { item: "basmati rice", quantity: 200, unit: "kg", vendor: "Srinidhi Foods", simulated: true, unitPrice: 101, total: 20200, leadTimeDays: 2, approval: { readback: "Srinidhi Foods, a simulated vendor ..." } },
  }, fmt);
  assert.deepEqual(f.what, ["basmati rice, 200 kg"]);
  assert.equal(f.who, "Srinidhi Foods");
  assert.equal(f.simulated, true);
  assert.equal(f.amount, 20200);
  assert.equal(f.amountKind, "money");
  assert.equal(f.askKey, "wt.ask.buy");
  assert.equal(f.footKey, "wt.foot.buy");
  assert.deepEqual(f.extra, [], "rate and delivery stay in the read-back (spec 03)");
  assert.match(f.readback, /simulated vendor/);
});

test("nothing is invented: a deal without a total or a seller shows no figure and no name", async () => {
  const { cardFacts } = await load();
  const f = cardFacts({ key: "approval:2", kind: "buy" }, { view: {} }, fmt);
  assert.deepEqual(f.what, []);
  assert.equal(f.who, null);
  assert.equal(f.amount, null);
  assert.equal(f.amountKind, null);
  assert.equal(f.simulated, false);
  assert.equal(f.readback, null);
});

test("bill: up to three lines as separate lines (no 'A · B' strings), the customer, the total", async () => {
  const { cardFacts } = await load();
  const f = cardFacts({ key: "invoice:7", kind: "bill" }, {
    customerName: "Ramesh Traders",
    invoice: { lines: [{ name: "rice", qty: 5, unit: "kg" }, { name: "dal", qty: 2, unit: "kg" }, { name: "oil", qty: 1, unit: "l" }, { name: "salt", qty: 1, unit: "kg" }], totals: { total: 1180, tax: 0 }, readback: "Bill for Ramesh ..." },
  }, fmt);
  assert.deepEqual(f.what, ["rice, 5 kg", "dal, 2 kg", "oil, 1 l"]);
  assert.equal(f.more, 1);
  assert.equal(f.who, "Ramesh Traders");
  assert.equal(f.amount, 1180);
  assert.ok(f.what.every((l) => !l.includes(" · ")));
});

test("reorder: what = the item, how much = the quantity to buy (not money), with what is left", async () => {
  const { cardFacts } = await load();
  const f = cardFacts({ key: "reorder:3", kind: "reorder" }, { item: { name: "sugar", unit: "kg", onHand: 4 }, proposal: { quantity: 25, unit: "kg" }, question: "चीनी 4 किलो बची है। 25 किलो और मँगाऊँ?" }, fmt);
  assert.deepEqual(f.what, ["sugar"]);
  assert.equal(f.amount, "25 kg");
  assert.equal(f.amountKind, "qty");
  assert.deepEqual(f.extra, [{ labelKey: "wt.leftNow", text: "4 kg" }]);
  assert.match(f.readback, /चीनी/, "the server's own sentence, native script");
  const out = cardFacts({ key: "reorder:4", kind: "reorder" }, { item: { name: "salt", onHand: 0 }, proposal: {} }, fmt);
  assert.deepEqual(out.extra, [{ labelKey: "wt.leftNow", textKey: "wt.outOf" }]);
  assert.equal(out.amount, null);
});

test("rule: the sentence and why in the UI language, English when that language is missing", async () => {
  const { cardFacts } = await load();
  const rule = { sentence: { "hi-IN": "चावल 10 किलो से कम हो तो बताना", "en-IN": "Tell me when rice is under 10 kg" }, why: { "en-IN": "You asked twice" } };
  assert.deepEqual(cardFacts({ key: "rule:9", kind: "rule" }, { rule, langCode: "hi-IN" }, fmt).what, ["चावल 10 किलो से कम हो तो बताना"]);
  const kn = cardFacts({ key: "rule:9", kind: "rule" }, { rule, langCode: "kn-IN" }, fmt);
  assert.deepEqual(kn.what, ["Tell me when rice is under 10 kg"]);
  assert.deepEqual(kn.extra, [{ labelKey: "wt.why", text: "You asked twice" }]);
});

test("Home's Needs row: what on the main line, who as the meta line, the figure, the simulated flag kept", async () => {
  const { cardFacts, needsRow } = await load();
  const card = { key: "approval:1", kind: "buy", phase: "waiting" };
  const row = needsRow(card, cardFacts(card, { view: { item: "rice", quantity: 50, unit: "kg", vendor: "Ravi Traders", simulated: true, total: 20200 } }, fmt));
  assert.deepEqual(row, { key: "approval:1", kind: "buy", icon: "cart", phase: "waiting", line: "rice, 50 kg", lineKey: null, meta: "Ravi Traders", simulated: true, amount: 20200, amountKind: "money", live: true });
  const billCard = { key: "invoice:7", kind: "bill", phase: "waiting" };
  const billRow = needsRow(billCard, cardFacts(billCard, { customerName: "Ramesh", invoice: { lines: [{ name: "rice", qty: 5, unit: "kg" }, { name: "dal", qty: 2, unit: "kg" }], totals: { total: 500 } } }, fmt));
  assert.equal(billRow.line, "rice, 5 kg +1");
  const bare = needsRow({ key: "rule:2", kind: "rule", phase: "saving" }, {});
  assert.equal(bare.line, null);
  assert.equal(bare.lineKey, "wt.ask.rule");
  assert.equal(bare.live, false);
});

test("the Needs host opens the asked card, the only card, or the list", async () => {
  const { hostPlan } = await load();
  const a = { key: "approval:1" }, b = { key: "invoice:2" };
  assert.deepEqual(hostPlan([]), { mode: "none", key: null });
  assert.deepEqual(hostPlan([a]), { mode: "card", key: "approval:1" });
  assert.deepEqual(hostPlan([a, b]), { mode: "list", key: null });
  assert.deepEqual(hostPlan([a, b], "invoice:2"), { mode: "card", key: "invoice:2" });
  assert.deepEqual(hostPlan([a, b], "rule:9"), { mode: "list", key: null }, "an asked card that is gone falls back");
});
