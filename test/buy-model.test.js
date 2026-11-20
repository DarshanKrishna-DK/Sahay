"use strict";

/**
 * public/js/app/buy-model.js: the Buy screen's stations, HUD figures, price ladder rows and order
 * shelves come only from store records (no figure is made up), and a station moves only on a
 * record. Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const load = () => import(`data:text/javascript,${encodeURIComponent(read("public/js/app/buy-model.js"))}`);

const mapOf = (rows) => new Map(rows.map((r) => [String(r.id), r]));
function store(over = {}) {
  return {
    requirements: [], jobs: new Map(), vendors: new Map(), negotiations: new Map(), quotes: new Map(),
    approvals: new Map(), orders: new Map(), followups: new Map(), ...over,
  };
}
const REQ = { id: 7, item: "बासमती चावल", quantity: 200, unit: "kg", city: "Bengaluru", createdAt: "2026-11-20T04:11:00Z" };
const status = (m) => Object.fromEntries(m.stations.map((s) => [s.id, s.status]));

test("a need with nothing else: Heard done, every other station still to come, no HUD figures", async () => {
  const { stationsFor, hudFor, STATION_IDS } = await load();
  const m = stationsFor(store({ requirements: [REQ] }), REQ);
  assert.deepEqual(m.stations.map((s) => s.id), STATION_IDS);
  assert.deepEqual(status(m), { heard: "done", search: "upcoming", bargain: "upcoming", yes: "upcoming", ordered: "upcoming", paid: "upcoming", reminder: "upcoming" });
  const hud = hudFor(m, REQ);
  assert.deepEqual(hud.heard, { at: REQ.createdAt });
  for (const k of ["search", "bargain", "yes", "ordered", "paid", "reminder"]) assert.equal(hud[k], null, k);
});

test("no need: nothing is done", async () => {
  const { stationsFor } = await load();
  assert.equal(stationsFor(store(), null).stations[0].status, "upcoming");
});

test("search runs, then sellers arrive; a failed search with no seller is shown as stopped with the server's reason", async () => {
  const { stationsFor, hudFor } = await load();
  const running = store({ jobs: mapOf([{ id: 1, kind: "sourcing", status: "running", requirementId: 7, createdAt: "1" }]) });
  assert.equal(status(stationsFor(running, REQ)).search, "active");
  const found = store({
    jobs: mapOf([{ id: 1, kind: "sourcing", status: "done", requirementId: 7 }]),
    vendors: mapOf([{ id: "a", name: "Srinidhi Foods", rank: 2, requirementId: 7, simulated: true }, { id: "b", name: "Paras Traders", rank: 1, requirementId: 7 }, { id: "c", name: "Other need", requirementId: 9 }]),
  });
  const m = stationsFor(found, REQ);
  assert.equal(status(m).search, "done");
  assert.deepEqual(m.vendors.map((v) => v.id), ["b", "a"], "sellers of this need only, best rank first");
  assert.deepEqual(hudFor(m, REQ).search, { sellers: 2, simulated: 1 });
  const failed = store({ jobs: mapOf([{ id: 1, kind: "sourcing", status: "failed", requirementId: 7, error: "IndiaMART did not answer" }]) });
  const f = stationsFor(failed, REQ);
  assert.equal(status(f).search, "failed");
  assert.deepEqual(hudFor(f, REQ).search, { error: "IndiaMART did not answer" });
});

test("ladder rows: asks and offers in the order said, paired by column, deduplicated, agreed price marked", async () => {
  const { ladderRows } = await load();
  const n = {
    id: "n1", counterpart: "simulated", endedAt: "x", outcome: { agreed: true, unitPrice: 55, unit: "kg" },
    turns: [
      { speaker: "vendor", round: 1, offer: 65, unit: "kg", text: "65 se kam nahin" },
      { speaker: "agent", round: 1, offer: 51, unit: "kg", text: "51 denge" },
      { speaker: "agent", round: 1, offer: 51, unit: "kg", text: "repeat" },
      { speaker: "vendor", round: 2, offer: 57, unit: "kg", text: "" },
      { speaker: "agent", round: 2, offer: null, text: "no price in this line" },
      { speaker: "agent", round: 3, offer: 55, unit: "kg" },
      { speaker: "vendor", round: 3, offer: 55, unit: "kg" },
    ],
  };
  const l = ladderRows(n);
  assert.deepEqual(l.rows.map((r) => [r.side, r.round, r.offer, r.pair]), [["ask", 1, 65, 1], ["offer", 1, 51, 1], ["ask", 2, 57, 2], ["offer", 3, 55, 2], ["ask", 3, 55, 3]]);
  assert.equal(l.agreed, 55);
  assert.deepEqual(l.rows.filter((r) => r.meet).map((r) => r.side), ["offer", "ask"]);
  assert.equal(l.unit, "kg");
  assert.equal(l.rounds, 3);
  assert.equal(l.firstAsk, 65);
  assert.equal(l.lastAsk, 55);
  assert.equal(l.lastOffer, 55);
  assert.equal(l.simulated, true);
  assert.equal(l.noDeal, false);
});

test("ladder: a talk that ended without a deal says so; one still running is neither", async () => {
  const { ladderRows } = await load();
  const ended = ladderRows({ endedAt: "x", outcome: { agreed: false }, turns: [{ speaker: "vendor", round: 1, offer: 70 }] });
  assert.equal(ended.noDeal, true);
  const live = ladderRows({ endedAt: null, turns: [{ speaker: "vendor", round: 1, offer: 70 }] });
  assert.equal(live.noDeal, false);
  assert.equal(live.ended, false);
  assert.deepEqual(ladderRows(null).rows, []);
});

test("bargain, yes, ordered, paid and reminder follow their records; HUD shows the real figures", async () => {
  const { stationsFor, hudFor } = await load();
  const s = store({
    negotiations: mapOf([{ id: "n1", requirementId: 7, endedAt: "x", createdAt: "1", outcome: { agreed: true, unitPrice: 55 }, turns: [{ speaker: "vendor", round: 1, offer: 65, unit: "kg" }, { speaker: "agent", round: 1, offer: 55, unit: "kg" }] }]),
    quotes: mapOf([{ id: "q1", requirementId: 7, unitPrice: 55 }]),
    approvals: mapOf([{ id: "a1", quoteId: "q1", status: "pending", totalAmount: 11000, requestedAt: "2" }]),
  });
  let m = stationsFor(s, REQ);
  assert.equal(status(m).bargain, "done");
  assert.equal(status(m).yes, "needs");
  const hud = hudFor(m, REQ);
  assert.deepEqual(hud.bargain, { rounds: 1, ask: 65, offer: 55, unit: "kg", agreed: 55 });
  assert.deepEqual(hud.yes, { total: 11000, status: "pending" });

  s.approvals.get("a1").status = "approved";
  s.orders = mapOf([{ id: "o1", approvalId: "a1", poNumber: "PO-1", status: "confirmed", paymentUrl: "/pay/x", createdAt: "3" }]);
  s.followups = mapOf([{ id: "f1", orderId: "o1", status: "scheduled", dueAt: "2026-11-22T00:00:00Z", kind: "delivery" }]);
  m = stationsFor(s, REQ);
  assert.deepEqual(status(m), { heard: "done", search: "upcoming", bargain: "done", yes: "done", ordered: "done", paid: "active", reminder: "active" });
  const h2 = hudFor(m, REQ);
  assert.deepEqual(h2.ordered, { po: "PO-1" });
  assert.deepEqual(h2.paid, { link: true });
  assert.deepEqual(h2.reminder, { at: "2026-11-22T00:00:00Z", sent: false });

  s.orders.get("o1").status = "paid";
  assert.equal(status(stationsFor(s, REQ)).paid, "done");
  assert.deepEqual(hudFor(stationsFor(s, REQ), REQ).paid, { paid: true });
});

test("a running negotiation makes Bargaining active; a rejected yes stops the Yes station", async () => {
  const { stationsFor } = await load();
  const s = store({
    negotiations: mapOf([{ id: "n1", status: "running", endedAt: null, turns: [] }]),
    quotes: mapOf([{ id: "q1", requirementId: 7 }]),
    approvals: mapOf([{ id: "a1", quoteId: "q1", status: "rejected" }]),
  });
  const m = stationsFor(s, REQ);
  assert.equal(status(m).bargain, "active");
  assert.equal(m.runningNegotiation.id, "n1");
  assert.equal(status(m).yes, "failed");
});

test("orders sit on three shelves: to pay, on the way, done; newest first", async () => {
  const { orderShelves, orderShelf, isPaid } = await load();
  const o = (id, s, at) => ({ id, status: s, createdAt: at });
  const sh = orderShelves(mapOf([o(1, "confirmed", "1"), o(2, "paid", "2"), o(3, "in_transit", "3"), o(4, "delivered", "4"), o(5, "cancelled", "5"), o(6, "pending_payment", "6")]));
  assert.deepEqual(sh.toPay.map((x) => x.id), [6, 1]);
  assert.deepEqual(sh.onTheWay.map((x) => x.id), [3, 2]);
  assert.deepEqual(sh.done.map((x) => x.id), [5, 4]);
  assert.equal(orderShelf({ status: "closed" }), "done");
  assert.equal(isPaid({ status: "delivered" }), true);
  assert.equal(isPaid({ status: "confirmed" }), false);
});

test("order facts come from the order, its quote and the need; simulated is carried from any of them", async () => {
  const { orderFacts } = await load();
  const s = store({ requirements: [REQ], quotes: mapOf([{ id: "q1", requirementId: 7, vendorId: "v1", quantity: 200, unit: "kg", unitPrice: 55 }]), vendors: mapOf([{ id: "v1", name: "Srinidhi Foods", simulated: true }]) });
  assert.deepEqual(orderFacts(s, { id: "o1", quoteId: "q1" }), { vendor: "Srinidhi Foods", simulated: true, item: "बासमती चावल", quantity: 200, unit: "kg", unitPrice: 55 });
  assert.deepEqual(orderFacts(s, { id: "o2", vendorName: "Paras", simulated: false }), { vendor: "Paras", simulated: false, item: null, quantity: null, unit: null, unitPrice: null });
});

test("reminders and the clock arc", async () => {
  const { remindersOf, clockFraction } = await load();
  const s = store({ followups: mapOf([
    { id: 1, orderId: "o1", status: "fired", firedAt: "2026-11-19T00:00:00Z" },
    { id: 2, orderId: "o1", status: "scheduled", dueAt: "2026-11-25T00:00:00Z" },
    { id: 3, orderId: "o1", status: "scheduled", dueAt: "2026-11-21T00:00:00Z" },
    { id: 4, orderId: "o2", status: "scheduled", dueAt: "2026-11-20T00:00:00Z" },
  ]) });
  const r = remindersOf(s, "o1");
  assert.equal(r.next.id, 3);
  assert.equal(r.sent.id, 1);
  assert.equal(clockFraction("2026-11-20T00:00:00Z", "2026-11-22T00:00:00Z", Date.parse("2026-11-21T00:00:00Z")), 0.5);
  assert.equal(clockFraction(null, "2026-11-22T00:00:00Z"), 0);
  assert.equal(clockFraction("2026-11-22T00:00:00Z", "2026-11-20T00:00:00Z"), 0);
});

test("earlier needs leave out the current and the dismissed, newest first, and say which are busy", async () => {
  const { earlierNeeds } = await load();
  const s = store({
    requirements: [{ id: 1 }, { id: 2, status: "dismissed" }, { id: 3 }, REQ],
    jobs: mapOf([{ id: "j", requirementId: 3, status: "queued" }]),
  });
  assert.deepEqual(earlierNeeds(s, REQ).map((x) => [x.need.id, x.busy]), [[3, true], [1, false]]);
});

test("short seller names keep whole words", async () => {
  const { shortName } = await load();
  assert.equal(shortName("Srinidhi Foods"), "Srinidhi Foods");
  assert.equal(shortName("Sri Lakshmi Venkateshwara Traders"), "Sri Lakshmi…");
  assert.equal(shortName(""), "");
});

test("river geometry: one point per station, inside the box, and a path through them", async () => {
  const { riverGeometry } = await load();
  for (const vertical of [false, true]) {
    const W = vertical ? 320 : 1000, H = vertical ? 900 : 240;
    const g = riverGeometry(7, vertical, W, H);
    assert.equal(g.pts.length, 7);
    for (const [x, y] of g.pts) { assert.ok(x >= 0 && x <= W); assert.ok(y >= 0 && y <= H); }
    assert.equal((g.d.match(/ C /g) || []).length, 6);
  }
});

test("the Buy screen files never ship sample rows or invented figures", () => {
  for (const f of ["buy.js", "work.js", "river.js", "ladder.js", "orders.js", "buy-model.js", "stock.js", "stock-model.js"]) {
    const src = read(`public/js/app/${f}`);
    assert.doesNotMatch(src, /confidence|latency|savings|lorem|sample row|placeholder/i, f);
  }
});

test("Buy and Stock are v3 only: no old markup classes, no marigold or saffron in their files", () => {
  const OLD = /class: "(?:river|station|vname|vbub|pchip|ladder|ladder-[a-z]+|receipt|receipts|rc-[a-z]+|work|work-[a-z]+|earlier|earlier-[a-z]+|need-[a-z]+|sb-[a-z-]+|keycap-marigold|keycap-leaf|sim-pill|mark)"|tone: "(?:marigold|leaf)"/;
  for (const f of ["buy.js", "work.js", "river.js", "ladder.js", "orders.js", "stock.js", "buy-kit.js"]) {
    const src = read(`public/js/app/${f}`);
    assert.doesNotMatch(src, OLD, f);
    assert.doesNotMatch(src, /marigold|saffron|#FFB020|#FF7A1A/i, f);
  }
  for (const f of ["app-buy.css", "app-stock.css"]) {
    const css = read(`public/css/${f}`);
    assert.doesNotMatch(css, /marigold|saffron|#FFB020|#FF7A1A/i, f);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${f}: tokens only, no raw hex`);
    assert.match(css, /prefers-reduced-motion: reduce/, `${f}: reduced motion branch`);
  }
  const app = read("public/css/app.css");
  for (const old of [".river {", ".ladder {", ".receipt {", ".work {", ".earlier {"]) assert.ok(!app.includes(old), `old Buy rule ${old} removed from app.css`);
});
