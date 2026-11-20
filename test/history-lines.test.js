"use strict";

/**
 * public/js/app/history-lines.js: the History timeline (My Sahay > History) shows an owner line for
 * buying, selling, money, stock and account steps, never machine detail, newest first, by day,
 * with "by voice / by button" on decisions and the simulated flag kept on vendor rows.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// The module is a browser ES module with no imports; node loads its source as a data: URL (the
// package is CommonJS, so a file: import would parse it as a script).
const load = () => import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "..", "public", "js", "app", "history-lines.js")).toString("base64")}`);
const fmt = { rupees: (n) => (n === null || n === undefined ? null : `₹${Number(n).toLocaleString("en-IN")}`), unit: (u) => ({ kg: "किलो" }[u] || u) };

test("decisions say yes or no and how they were given", async () => {
  const H = await load();
  const yes = H.historyLine({ type: "approval.decided", data: { status: "approved", via: "voice", total_amount: 11000 } }, fmt);
  assert.equal(yes.key, "hist.approval.yes");
  assert.equal(yes.tone, "ok");
  assert.equal(yes.via, "voice");
  assert.equal(yes.detail, "₹11,000");
  const no = H.historyLine({ type: "invoice.decided", data: { status: "rejected", via: "button", number: "INV/1" } }, fmt);
  assert.equal(no.key, "hx.invoice.no");
  assert.equal(no.via, "button");
  assert.equal(H.historyLine({ type: "stock.reorder_decided", data: { status: "accepted" } }, fmt).key, "hx.reorder.yes");
});

test("selling, money and stock steps have owner lines with real numbers only", async () => {
  const H = await load();
  assert.equal(H.historyLine({ type: "invoice.issued", data: { invoice: { number: "INV/2", total: 4725 } } }, fmt).detail, "INV/2, ₹4,725");
  assert.equal(H.historyLine({ type: "invoice.paid", data: { number: "INV/2", amountPaise: 472500 } }, fmt).detail, "INV/2, ₹4,725");
  assert.equal(H.historyLine({ type: "receipt.recorded", data: { receipt: { amount: 500 }, customer: { name: "रमेश" } } }, fmt).detail, "रमेश, ₹500");
  assert.equal(H.historyLine({ type: "stock.low", data: { item: { name: "चावल" } } }, fmt).key, "hx.stock.low");
  assert.equal(H.historyLine({ type: "requirement.saved", data: { requirement: { quantity: 200, unit: "kg", item: "basmati" } } }, fmt).detail, "200 किलो basmati");
  assert.equal(H.historyLine({ type: "invoice.issued", data: {} }, fmt).detail, null, "no number is made up");
});

test("a simulated vendor stays marked on the timeline", async () => {
  const H = await load();
  assert.equal(H.historyLine({ type: "order.created", data: { poNumber: "SAHAY/2026/1", amount: 100, simulated: true } }, fmt).simulated, true);
  assert.equal(H.historyLine({ type: "vendor.found", data: { vendor: { name: "BS Foods", simulated: true } } }, fmt).simulated, true);
});

test("machine detail and repeats never reach the owner's timeline", async () => {
  const H = await load();
  for (const type of ["job.progress", "transcript", "approval.spoken", "invoice.drafted", "order.status", "memory.updated"]) {
    assert.equal(H.historyLine({ type, data: {} }), null, type);
  }
  assert.equal(H.historyLine({ type: "customer.saved", data: { created: false } }), null, "an edited customer is not news");
});

test("rows newest first by id, capped, and only those with words", async () => {
  const H = await load();
  const audit = [
    { id: "1", type: "session.started", ts: "2026-11-20T10:00:00Z" },
    { id: "3", type: "job.progress", ts: "2026-11-20T10:02:00Z" },
    { id: "2", type: "order.created", ts: "2026-11-20T10:01:00Z", data: {} },
    { id: "4", type: "brand.new", ts: "2026-11-20T10:03:00Z" },
  ];
  const known = new Set(["hist.session.started", "hist.order.created"]);
  assert.deepEqual(H.historyRows(audit, { has: (k) => known.has(k) }).map((r) => r.id), ["2", "1"]);
  assert.equal(H.historyRows(Array.from({ length: 300 }, (_, i) => ({ id: String(i), type: "session.started" }))).length, 150);
});

test("day groups: today, yesterday, then the date", async () => {
  const H = await load();
  const now = new Date(2026, 10, 20, 15, 0);
  const rows = [
    { id: 3, ts: new Date(2026, 10, 20, 9, 0).toISOString() },
    { id: 2, ts: new Date(2026, 10, 19, 22, 0).toISOString() },
    { id: 1, ts: new Date(2026, 10, 12, 8, 0).toISOString() },
  ];
  assert.deepEqual(H.dayGroups(rows, now).map((g) => [g.day, g.rows.length]), [["today", 1], ["yesterday", 1], ["2026-11-12", 1]]);
});

test("times say the part of the day in Hindi and Kannada, never a Latin am / pm (QA #18)", async () => {
  const H = await load();
  assert.equal(H.clockWords(new Date(2026, 10, 20, 10, 5), "hi"), "सुबह 10:05");
  assert.equal(H.clockWords(new Date(2026, 10, 20, 14, 30), "hi"), "दोपहर 2:30");
  assert.equal(H.clockWords(new Date(2026, 10, 20, 18, 0), "kn"), "ಸಂಜೆ 6:00");
  assert.equal(H.clockWords(new Date(2026, 10, 20, 23, 45), "kn"), "ರಾತ್ರಿ 11:45");
  assert.equal(H.clockWords(new Date(2026, 10, 20, 0, 15), "hi"), "रात 12:15");
  assert.equal(H.clockWords(new Date(2026, 10, 20, 9, 0), "en"), "9:00 am");
  assert.doesNotMatch(H.clockWords(new Date(2026, 10, 20, 9, 0), "hi"), /am|pm/i);
  assert.equal(H.clockWords(new Date("x"), "hi"), "");
});
