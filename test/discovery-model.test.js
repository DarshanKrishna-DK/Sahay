"use strict";

/**
 * public/js/app/discovery-model.js: the discovery board shows the agent's real finds only. Sellers
 * are ranked, each says where it came from (IndiaMART / your supplier / simulated vendor) and links
 * only to a real https listing; bargaining is grouped round by round; the best deal is the server's
 * pending deal, else the cheapest recorded quote, else the agreed price, else nothing.
 * Loaded as is (no DOM, no imports).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const load = () => import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(ROOT, "public/js/app/discovery-model.js"), "utf8"))}`);
const mapOf = (rows) => new Map(rows.map((r) => [String(r.id), r]));

test("source of a seller: IndiaMART listing, the owner's supplier, or simulated vendor", async () => {
  const { sourceOf } = await load();
  assert.equal(sourceOf({ source: "indiamart", kind: "listed" }), "indiamart");
  assert.equal(sourceOf({ source: "human", kind: "human" }), "supplier");
  assert.equal(sourceOf({ source: "simulated", kind: "simulated" }), "simulated");
  assert.equal(sourceOf({ simulated: true }), "simulated");
});

test("a listing link is only ever a real https page", async () => {
  const { listingUrl } = await load();
  assert.equal(listingUrl("https://www.indiamart.com/proddetail/rice-123.html"), "https://www.indiamart.com/proddetail/rice-123.html");
  assert.equal(listingUrl("javascript:alert(1)"), null);
  assert.equal(listingUrl("http://example.com"), null);
  assert.equal(listingUrl("/relative"), null);
  assert.equal(listingUrl(null), null);
});

test("sellers: this need's only, Sahay's rank first, then price; facts only when the record has them", async () => {
  const { sellerCards } = await load();
  const vendors = mapOf([
    { id: "a", requirementId: 7, name: "Srinidhi Foods", source: "simulated", kind: "simulated", simulated: true, rank: 2, listedPrice: 60, listedUnit: "kg" },
    { id: "b", requirementId: 7, name: "Paras Traders", source: "indiamart", kind: "listed", rank: 1, listedPriceText: "Rs 58/Kg", rating: 4.2, city: "Bengaluru", sourceUrl: "https://www.indiamart.com/x" },
    { id: "c", requirementId: 7, name: "No rank", source: "indiamart", kind: "listed", listedPrice: 50 },
    { id: "d", requirementId: 9, name: "Other need", source: "indiamart", kind: "listed", rank: 1 },
  ]);
  const negos = mapOf([{ id: "n1", vendorId: "a", status: "running", endedAt: null }]);
  const cards = sellerCards(vendors, { negotiations: negos, requirementId: 7 });
  assert.deepEqual(cards.map((c) => c.id), ["b", "a", "c"]);
  assert.deepEqual(cards[0], { id: "b", name: "Paras Traders", city: "Bengaluru", price: null, unit: null, priceText: "Rs 58/Kg", rating: 4.2, source: "indiamart", url: "https://www.indiamart.com/x", rank: 1, bargaining: false, live: false });
  assert.equal(cards[1].source, "simulated");
  assert.equal(cards[1].url, null, "a simulated vendor never links anywhere");
  assert.equal(cards[1].live, true);
  assert.equal(cards[2].rating, null, "no rating is made up");
});

test("bargaining round by round: seller's ask, Sahay's counter, agreed price and the lowest ask", async () => {
  const { bargainRounds } = await load();
  const lad = {
    rows: [
      { side: "ask", round: 1, offer: 65, text: "65 is final" }, { side: "offer", round: 1, offer: 51, text: "" },
      { side: "ask", round: 2, offer: 58 }, { side: "offer", round: 2, offer: 55 }, { side: "ask", round: 3, offer: 55 },
    ],
    agreed: 55, noDeal: false, unit: "kg",
  };
  const b = bargainRounds(lad);
  assert.deepEqual(b.rounds.map((r) => [r.round, r.ask, r.counter]), [[1, 65, 51], [2, 58, 55], [3, 55, null]]);
  assert.equal(b.agreed, 55);
  assert.equal(b.best, 55);
  assert.equal(b.unit, "kg");
  assert.deepEqual(bargainRounds({ rows: [], agreed: null, noDeal: true }).rounds, []);
  assert.equal(bargainRounds(null).best, null);
});

test("best deal: the pending deal with the server's total, else the cheapest quote, else the agreed price, else none", async () => {
  const { bestDeal } = await load();
  const req = { id: 7, quantity: 200 };
  const quotes = mapOf([
    { id: "q1", requirementId: 7, vendorId: "a", unitPrice: 60, unit: "kg", quantity: 200, landedCost: 12500 },
    { id: "q2", requirementId: 7, vendorId: "b", unitPrice: 58, unit: "kg", quantity: 200, landedCost: 11900 },
  ]);
  const cheapest = bestDeal({ quotes, approvals: new Map() }, req);
  assert.equal(cheapest.vendorId, "b");
  assert.equal(cheapest.total, 11900);
  assert.equal(cheapest.approvalId, null);
  const approvals = mapOf([{ id: "ap1", quoteId: "q1", status: "pending", totalAmount: 12600, requestedAt: "2" }]);
  const pending = bestDeal({ quotes, approvals }, req);
  assert.equal(pending.approvalId, "ap1", "the deal waiting for the yes leads");
  assert.equal(pending.total, 12600, "the server's total, not a sum made here");
  const talk = bestDeal({ quotes: new Map(), approvals: new Map(), negotiation: { vendorId: "a" }, agreed: 55, unit: "kg" }, req);
  assert.deepEqual(talk, { vendorId: "a", unitPrice: 55, unit: "kg", quantity: 200, total: null, approvalId: null, agreed: true, quoteId: null });
  assert.equal(bestDeal({}, req), null);
});

test("board phase follows what exists", async () => {
  const { boardPhase } = await load();
  assert.equal(boardPhase({ req: null }), "empty");
  assert.equal(boardPhase({ req: {}, searching: true }), "searching");
  assert.equal(boardPhase({ req: {}, sellers: [{}] }), "sellers");
  assert.equal(boardPhase({ req: {}, sellers: [{}], rounds: [{}] }), "bargaining");
  assert.equal(boardPhase({ req: {}, deal: {} }), "deal");
});

test("the board's files never ship sample data", () => {
  for (const f of ["discovery.js", "discovery-model.js"]) {
    const src = fs.readFileSync(path.join(ROOT, "public/js/app", f), "utf8");
    assert.doesNotMatch(src, /lorem|sample row|Ravi Traders|Gupta Store|Maharaja Wholesalers|Shreeji Agency/i, f);
  }
});

test("GET /api/discovery: sellers with source, rating count and real links; live offers by round; the pending deal leads", async () => {
  const { fromDiscovery } = await load();
  const payload = {
    requirement: { id: "r1", item: "Basmati rice", quantity: 200, unit: "kg", city: "Bengaluru", maxPrice: 90 },
    search: { status: "done", count: 3 },
    sellers: [
      { rank: 1, vendorId: "v1", name: "Paras Traders", city: "Delhi", source: "indiamart", sourceLabel: "IndiaMART", simulated: false, listedPriceText: "Rs 58/Kg", listedUnit: "Kg", comparablePrice: 58, priceUnit: "kg", rating: 4.3, ratingCount: 120, sourceUrl: "https://www.indiamart.com/p/1" },
      { rank: 2, vendorId: "v2", name: "Own Kirana Supplier", source: "own_supplier", simulated: false, sourceUrl: "https://t.me/x" },
      { rank: null, vendorId: "v3", name: "Sim Foods", source: "simulated", simulated: true, avoided: true },
    ],
    negotiations: [{ negotiationId: "n1", vendorId: "v1", vendorName: "Paras Traders", simulated: false, running: true, createdAt: "2",
      offers: [{ speaker: "vendor", price: 62, unit: "kg", round: 1 }, { speaker: "sahay", price: 52, unit: "kg", round: 1 }, { speaker: "vendor", price: 58, unit: "kg", round: 2 }],
      agreed: null, agreedPrice: null }],
    deals: [{ quoteId: "q1", vendorId: "v1", vendorName: "Paras Traders", unitPrice: 58, unit: "kg", quantity: 200, landedCost: 11800 }],
    bestQuote: { quoteId: "q1", vendorId: "v1", vendorName: "Paras Traders", unitPrice: 58, unit: "kg", quantity: 200, landedCost: 11800 },
    pendingApproval: { approvalId: "a1", quoteId: "q1", totalAmount: 11900, readback: "read back" },
  };
  const b = fromDiscovery(payload);
  assert.equal(b.need.item, "Basmati rice");
  assert.deepEqual(b.sellers.map((s) => [s.id, s.source, s.url, s.ratingCount, s.avoided]), [
    ["v1", "indiamart", "https://www.indiamart.com/p/1", 120, false],
    ["v2", "supplier", null, null, false],
    ["v3", "simulated", null, null, true],
  ]);
  assert.equal(b.sellers[0].live, true);
  assert.deepEqual(b.bargain.rounds.map((r) => [r.round, r.ask, r.counter]), [[1, 62, 52], [2, 58, null]]);
  assert.equal(b.bargain.best, 58);
  assert.equal(b.bargain.noDeal, false);
  assert.equal(b.deal.approvalId, "a1");
  assert.equal(b.deal.total, 11900, "the approval's own total");
  delete payload.pendingApproval;
  const q = fromDiscovery(payload);
  assert.equal(q.deal.approvalId, null, "no pending approval: nothing to say yes to, only the best quote");
  assert.equal(q.deal.total, 11800);
  assert.deepEqual(fromDiscovery({ requirement: null }).sellers, []);
  assert.equal(fromDiscovery({ requirement: { id: "r" }, search: { status: "running" } }).searching, true);
  assert.equal(fromDiscovery({ requirement: { id: "r" }, search: { status: "failed", error: "IndiaMART did not answer" } }).searchError, "IndiaMART did not answer");
});

test("a refused seller pick shows the server's own words", async () => {
  const { refusalWords } = await load();
  assert.equal(refusalWords({ code: "NO_LISTED_PRICE", message: "No price listed.", say: "Paras Traders has no price listed; try Sim Foods." }), "Paras Traders has no price listed; try Sim Foods.");
  assert.equal(refusalWords({ code: "BUSY", message: "Sahay is already bargaining." }), "Sahay is already bargaining.");
  assert.equal(refusalWords(null), null);
});
