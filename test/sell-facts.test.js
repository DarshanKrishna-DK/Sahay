"use strict";

/**
 * public/js/app/sell-facts.js (Sell and Money arithmetic and grouping, no DOM, no imports) and the
 * state picker's search in shop-facts.js. Loaded as the browser loads them.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = (rel) => import(`data:text/javascript,${encodeURIComponent(read(rel))}`);
const facts = () => load("public/js/app/sell-facts.js");

test("sell-facts.js has no imports and no DOM, so it runs anywhere", () => {
  const src = read("public/js/app/sell-facts.js");
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /document\.|window\./);
});

test("bills group as unpaid, draft, paid, cancelled; waiting bills are left to their own place; newest first", async () => {
  const { billGroups } = await facts();
  const groups = billGroups([
    { id: "a", status: "paid", createdAt: "2026-11-01" },
    { id: "b", status: "issued", createdAt: "2026-11-02", issuedAt: "2026-11-03" },
    { id: "c", status: "pending", createdAt: "2026-11-04" },
    { id: "d", status: "part_paid", createdAt: "2026-11-05" },
    { id: "e", status: "weird", createdAt: "2026-11-06" },
    { id: "f", status: "cancelled", createdAt: "2026-11-07" },
  ]);
  assert.deepEqual(groups.map((g) => g.group), ["unpaid", "draft", "paid", "cancelled"]);
  assert.deepEqual(groups[0].bills.map((b) => b.id), ["d", "b"]);
  assert.deepEqual(groups[1].bills.map((b) => b.id), ["e"], "an unknown status reads as a draft");
  assert.ok(!groups.some((g) => g.bills.some((b) => b.id === "c")));
  assert.deepEqual(billGroups([]), []);
});

test("GST reads as a CGST + SGST split, IGST, none, a bare total or unknown, from the server's figures only", async () => {
  const { gstRows } = await facts();
  assert.deepEqual(gstRows({ taxable: 1000, cgst: 25, sgst: 25, tax: 50, total: 1050 }),
    { kind: "split", rows: [{ key: "taxable", amount: 1000 }, { key: "cgst", amount: 25 }, { key: "sgst", amount: 25 }], tax: 50 });
  assert.equal(gstRows({ taxable: 1000, igst: 50, tax: 50 }).kind, "igst");
  assert.deepEqual(gstRows({ taxable: 1000, igst: 50, tax: 50 }).rows.map((r) => r.key), ["taxable", "igst"]);
  assert.equal(gstRows({ tax: 0, total: 500 }).kind, "none");
  assert.equal(gstRows({ tax: 18 }).kind, "total");
  assert.deepEqual(gstRows({ total: 500 }), { kind: "unknown", rows: [], tax: null });
  assert.equal(gstRows(null).kind, "unknown");
});

test("a line's amount is the server's taxable value, else quantity x rate, else unknown", async () => {
  const { lineAmount } = await facts();
  assert.equal(lineAmount({ taxable: 990, qty: 10, unitPrice: 100 }), 990);
  assert.equal(lineAmount({ qty: 2.5, unitPrice: 40.1 }), 100.25);
  assert.equal(lineAmount({ qty: 3 }), null);
  assert.equal(lineAmount(null), null);
});

test("what is still due on a bill", async () => {
  const { dueOf } = await facts();
  assert.equal(dueOf({ status: "issued", totals: { total: 1050 } }), 1050);
  assert.equal(dueOf({ status: "part_paid", totals: { total: 1050 }, paid: 300 }), 750);
  assert.equal(dueOf({ status: "paid", totals: { total: 1050 } }), 0);
  assert.equal(dueOf({ status: "draft", totals: { total: 1050 } }), null);
  assert.equal(dueOf({ status: "issued" }), null, "no total, no invented due");
});

test("GSTIN is masked to its first two and last three characters", async () => {
  const { maskGstin } = await facts();
  assert.equal(maskGstin("29abcde1234f1z5"), "29••••••••••1Z5");
  assert.equal(maskGstin("29ABCDE1234F1Z5").length, 15);
  assert.equal(maskGstin(""), "");
  assert.equal(maskGstin(null), "");
});

test("phone numbers: ten digits, +91 or a leading 0 dropped, 6-9 first", async () => {
  const { cleanPhone, phoneProblem, formatPhone } = await facts();
  assert.equal(cleanPhone("+91 98765-43210"), "9876543210");
  assert.equal(cleanPhone("09876543210"), "9876543210");
  assert.equal(cleanPhone("98765432101234"), "9876543210");
  assert.equal(phoneProblem(""), "empty");
  assert.equal(phoneProblem("98765"), "short");
  assert.equal(phoneProblem("1234567890"), "shape");
  assert.equal(phoneProblem("9876543210"), "ok");
  assert.equal(formatPhone("9876543210"), "98765 43210");
  assert.equal(formatPhone("987"), "987");
});

test("number pad: digits, back, clear, no leading zero for amounts, a cap on length", async () => {
  const { padPress } = await facts();
  assert.equal(padPress("", "0"), "");
  assert.equal(padPress("", "00"), "");
  assert.equal(padPress("5", "00"), "500");
  assert.equal(padPress("500", "back"), "50");
  assert.equal(padPress("500", "clear"), "");
  assert.equal(padPress("12345678", "9"), "12345678");
  assert.equal(padPress("", "0", { noLeadingZero: false, max: 10 }), "0");
  assert.equal(padPress("12", "x"), "12", "anything else is ignored");
});

test("khata: meter share against the largest, waiting buckets, sums, orders still to pay", async () => {
  const { meterShare, ageBucket, sumOf, ordersToPay } = await facts();
  assert.equal(meterShare(5000, 5000), 100);
  assert.equal(meterShare(100, 5000), 6, "a small debt still shows");
  assert.equal(meterShare(2500, 5000), 50);
  assert.equal(meterShare(0, 5000), 0);
  assert.equal(meterShare(10, 0), 0);
  assert.equal(ageBucket(0), "today");
  assert.equal(ageBucket(29), "days");
  assert.equal(ageBucket(30), "old");
  assert.equal(ageBucket(null), null);
  assert.equal(sumOf([{ amount: 100.1 }, { amount: null }, { amount: 200.2 }]), 300.3);
  const open = ordersToPay([
    { id: 1, status: "confirmed", createdAt: "2026-11-01" },
    { id: 2, status: "paid" },
    { id: 3, status: "created", createdAt: "2026-11-03" },
    { id: 4, status: "cancelled" },
    { id: 5, status: "in_transit" },
    { id: 6 },
  ]);
  assert.deepEqual(open.map((o) => o.id), [3, 1]);
});

test("state picker search: any script, the GST code, spaces and case ignored", async () => {
  const { findStates, STATES } = await load("public/js/app/shop-facts.js");
  assert.equal(findStates("", "en").length, STATES.length);
  assert.deepEqual(findStates("karna", "en").map((r) => r.code), ["29"]);
  assert.deepEqual(findStates("कर्नाटक", "en").map((r) => r.code), ["29"]);
  assert.deepEqual(findStates("ಕರ್ನಾಟಕ", "kn").map((r) => r.code), ["29"]);
  assert.deepEqual(findStates("29", "hi").map((r) => r.code), ["29"]);
  assert.deepEqual(findStates("tamil nadu", "en").map((r) => r.code), ["33"]);
  assert.deepEqual(findStates("zzzz", "en"), []);
  assert.equal(findStates("karna", "hi")[0].label, "कर्नाटक", "rows carry the owner's script");
});

test("bill filters: today, not paid, all; waiting bills left out; counts for the labels", async () => {
  const { filterBills } = await facts();
  const now = new Date(2026, 10, 20, 15, 0);
  const at = (d, h) => new Date(2026, 10, d, h).toISOString();
  const bills = [
    { id: "a", status: "issued", createdAt: at(20, 9) },
    { id: "b", status: "paid", createdAt: at(19, 9), issuedAt: at(20, 10) },
    { id: "c", status: "part_paid", createdAt: at(18, 9) },
    { id: "d", status: "pending", createdAt: at(20, 11) },
    { id: "e", status: "draft", createdAt: at(17, 9) },
  ];
  const all = filterBills(bills, "all", now);
  assert.deepEqual(all.bills.map((b) => b.id), ["b", "a", "c", "e"]);
  assert.deepEqual(all.counts, { today: 2, unpaid: 2, all: 4 });
  assert.deepEqual(filterBills(bills, "today", now).bills.map((b) => b.id), ["b", "a"]);
  assert.deepEqual(filterBills(bills, "unpaid", now).bills.map((b) => b.id), ["a", "c"]);
  assert.equal(filterBills(bills, "nonsense", now).filter, "all");
});

test("money received today: only today's receipts, local time", async () => {
  const { receivedToday } = await facts();
  const now = new Date(2026, 10, 20, 18, 0);
  const at = (d, h) => new Date(2026, 10, d, h).toISOString();
  assert.deepEqual(receivedToday([
    { amount: 500, createdAt: at(20, 9) }, { amount: 250.5, createdAt: at(20, 17) },
    { amount: 999, createdAt: at(19, 23) }, { amount: 10 },
  ], now), { amount: 750.5, count: 2 });
  assert.deepEqual(receivedToday([], now), { amount: 0, count: 0 });
});

test("a bill number's badge shows its running part; the full number stays elsewhere", async () => {
  const { shortBillNo } = await facts();
  assert.equal(shortBillNo("INV/2026-27/0002"), "0002");
  assert.equal(shortBillNo("KB-8942"), "KB-8942");
  assert.equal(shortBillNo("INV/2026-27/"), "2026-27");
  assert.equal(shortBillNo(""), "");
  assert.equal(shortBillNo(null), "");
});
