// What Sahay found for the current need, as data for the discovery board (discovery.js): the need,
// the sellers (ranked, with where each listing came from and a link to check it), the bargaining
// round by round, and the best deal. Pure functions over store records, no DOM and no imports, so
// node:test loads this file as is (test/discovery-model.test.js). Nothing here is estimated: a
// figure is shown only when a record carries it.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const same = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
const values = (m) => (m && typeof m.values === "function" ? [...m.values()] : Array.isArray(m) ? m : []);

/** Where a seller came from: "indiamart" (a real public listing), "supplier" (the owner's own), "simulated". */
export function sourceOf(v) {
  if (!v) return "indiamart";
  if (v.simulated || v.kind === "simulated" || v.source === "simulated") return "simulated";
  if (v.kind === "human" || v.source === "human") return "supplier";
  return "indiamart";
}

/** A listing link only when it is a real https page (never javascript:, data: or a relative path). */
export function listingUrl(u) {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

/** The need card: what, how much, where, up to what price, by when (each only when set). */
export function needCard(req) {
  if (!req) return null;
  return {
    id: req.id,
    item: req.item || "",
    quantity: isNum(req.quantity) ? req.quantity : null,
    unit: req.unit || null,
    city: req.city || null,
    maxPrice: isNum(req.maxPrice) ? req.maxPrice : null,
    deliveryBy: req.deliveryBy || null,
  };
}

/**
 * The sellers of the need, best first: Sahay's rank when it has one, then the lower listed price,
 * then the name. Each: { id, name, city, price, unit, priceText, rating, source, url, rank,
 * bargaining (a talk with this seller exists), live (that talk is running now) }.
 */
export function sellerCards(vendors, { negotiations = [], requirementId = null } = {}) {
  const negos = values(negotiations);
  const list = values(vendors).filter((v) => v && (!requirementId || !v.requirementId || same(v.requirementId, requirementId)));
  const cards = list.map((v) => {
    const mine = negos.filter((n) => same(n.vendorId, v.id));
    return {
      id: String(v.id),
      name: v.name || "",
      city: v.city || null,
      price: isNum(v.listedPrice) ? v.listedPrice : null,
      unit: v.listedUnit || null,
      priceText: typeof v.listedPriceText === "string" && v.listedPriceText.trim() ? v.listedPriceText.trim() : null,
      rating: isNum(v.rating) ? v.rating : null,
      source: sourceOf(v),
      url: sourceOf(v) === "indiamart" ? listingUrl(v.sourceUrl) : null,
      rank: isNum(v.rank) ? v.rank : null,
      bargaining: mine.length > 0,
      live: mine.some((n) => !n.endedAt && (!n.status || ["open", "running", "starting"].includes(n.status))),
    };
  });
  return cards.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)
    || (a.price ?? 1e12) - (b.price ?? 1e12)
    || a.name.localeCompare(b.name));
}

/**
 * The bargaining, round by round, from ladder rows (buy-model ladderRows): each round
 * { round, ask, counter } (the seller's price and Sahay's answer, each null when not said yet),
 * plus the agreed price, the lowest the seller asked (`best`), and whether it ended without a deal.
 */
export function bargainRounds(lad) {
  if (!lad || !Array.isArray(lad.rows) || !lad.rows.length) return { rounds: [], agreed: lad ? lad.agreed ?? null : null, best: null, noDeal: Boolean(lad && lad.noDeal), unit: lad ? lad.unit || "" : "" };
  const byRound = new Map();
  let n = 0;
  for (const r of lad.rows) {
    const key = r.round ?? `p${r.pair}`;
    if (!byRound.has(key)) byRound.set(key, { round: r.round ?? ++n, ask: null, counter: null, askText: "", counterText: "" });
    const row = byRound.get(key);
    if (r.side === "ask") { if (row.ask === null) { row.ask = r.offer; row.askText = r.text || ""; } }
    else if (row.counter === null) { row.counter = r.offer; row.counterText = r.text || ""; }
  }
  const rounds = [...byRound.values()];
  const asks = rounds.map((r) => r.ask).filter(isNum);
  return { rounds, agreed: lad.agreed ?? null, best: asks.length ? Math.min(...asks) : null, noDeal: Boolean(lad.noDeal), unit: lad.unit || "" };
}

/**
 * The best deal so far: the pending approval's deal when Sahay is waiting for the yes (its total is
 * the server's), else the cheapest recorded quote of the need (landed cost when the server worked it
 * out), else the agreed price of the talk. { vendorId, unitPrice, unit, quantity, total, approvalId,
 * agreed, quoteId } or null.
 */
export function bestDeal({ quotes = [], approvals = [], negotiation = null, agreed = null, unit = "" } = {}, req = null) {
  const qs = values(quotes).filter((q) => !req || !q.requirementId || same(q.requirementId, req.id));
  const pending = values(approvals).filter((a) => a.status === "pending" && qs.some((q) => same(q.id, a.quoteId)))
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")))[0] || null;
  if (pending) {
    const q = qs.find((x) => same(x.id, pending.quoteId));
    return { vendorId: q.vendorId ?? null, unitPrice: isNum(q.unitPrice) ? q.unitPrice : null, unit: q.unit || unit || null,
      quantity: isNum(q.quantity) ? q.quantity : (req && isNum(req.quantity) ? req.quantity : null),
      total: isNum(pending.totalAmount) ? pending.totalAmount : (isNum(q.landedCost) ? q.landedCost : null),
      approvalId: String(pending.id), agreed: true, quoteId: String(q.id) };
  }
  const priced = qs.filter((q) => isNum(q.unitPrice));
  if (priced.length) {
    const cost = (q) => (isNum(q.landedCost) ? q.landedCost : q.unitPrice * (isNum(q.quantity) ? q.quantity : 1));
    const q = priced.reduce((m, x) => (cost(x) < cost(m) ? x : m), priced[0]);
    return { vendorId: q.vendorId ?? null, unitPrice: q.unitPrice, unit: q.unit || unit || null,
      quantity: isNum(q.quantity) ? q.quantity : (req && isNum(req.quantity) ? req.quantity : null),
      total: isNum(q.landedCost) ? q.landedCost : null, approvalId: null, agreed: true, quoteId: String(q.id) };
  }
  if (isNum(agreed) && negotiation) {
    return { vendorId: negotiation.vendorId ?? null, unitPrice: agreed, unit: unit || null,
      quantity: req && isNum(req.quantity) ? req.quantity : null, total: null, approvalId: null, agreed: true, quoteId: null };
  }
  return null;
}

/** Which part of the board leads: "empty" (no need), "searching", "sellers", "bargaining", "deal". */
export function boardPhase({ req, sellers = [], rounds = [], deal = null, searching = false } = {}) {
  if (!req) return "empty";
  if (deal) return "deal";
  if (rounds.length) return "bargaining";
  if (sellers.length) return "sellers";
  return searching ? "searching" : "sellers";
}

/* ------------------------------------------------- GET /api/discovery -- */

const SOURCES = { indiamart: "indiamart", own_supplier: "supplier", simulated: "simulated", human: "vendor" };
const RUNNING_JOB = new Set(["running", "queued"]);

/**
 * The board's view of one GET /api/discovery answer (src/procurement/board.js), in the shapes the
 * board draws: { need, sellers, bargain, deal, searching, searchError }.
 *   sellers  [{ id, name, city, price, unit, priceText, rating, ratingCount, source, url, rank, avoided, bargaining, live }]
 *   bargain  { negotiationId, vendorId, vendorName, simulated, running, rounds, agreed, best, noDeal, unit } | null
 *   deal     { vendorId, vendorName, simulated, unitPrice, unit, quantity, total, approvalId, quoteId } | null
 * Only a "pending" approval is ever offered for a yes (the server sends pendingApproval only for
 * one; an expired approval comes back closed and is never offered).
 */
export function fromDiscovery(d) {
  const empty = { need: null, sellers: [], bargain: null, deal: null, searching: false, searchError: null };
  if (!d || typeof d !== "object" || !d.requirement) return empty;
  const r = d.requirement;
  const need = needCard({ id: r.id, item: r.item, quantity: r.quantity, unit: r.unit, city: r.city, maxPrice: r.maxPrice, deliveryBy: r.deliveryBy });
  const negos = Array.isArray(d.negotiations) ? d.negotiations : [];
  const sellers = (Array.isArray(d.sellers) ? d.sellers : []).map((s) => {
    const source = SOURCES[s.source] || (s.simulated ? "simulated" : "indiamart");
    const mine = negos.filter((n) => same(n.vendorId, s.vendorId));
    const comparable = isNum(s.comparablePrice);
    return {
      id: String(s.vendorId),
      name: s.name || "",
      city: s.city || null,
      price: comparable ? s.comparablePrice : isNum(s.listedPrice) ? s.listedPrice : null,
      unit: comparable ? s.priceUnit || null : s.listedUnit || null,
      priceText: typeof s.listedPriceText === "string" && s.listedPriceText.trim() ? s.listedPriceText.trim() : null,
      rating: isNum(s.rating) ? s.rating : null,
      ratingCount: isNum(s.ratingCount) ? s.ratingCount : null,
      source,
      url: source === "indiamart" ? listingUrl(s.sourceUrl) : null,
      rank: isNum(s.rank) ? s.rank : null,
      avoided: Boolean(s.avoided),
      bargaining: mine.length > 0,
      live: mine.some((n) => n.running),
    };
  });

  const byNewest = negos.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const n = byNewest.find((x) => x.running) || byNewest[0] || null;
  let bargain = null;
  if (n) {
    const rounds = new Map();
    let k = 0;
    const offers = Array.isArray(n.offers) ? n.offers : [];
    for (const o of offers) {
      if (!isNum(o.price)) continue;
      const key = isNum(o.round) ? o.round : `x${++k}`;
      if (!rounds.has(key)) rounds.set(key, { round: isNum(o.round) ? o.round : rounds.size + 1, ask: null, counter: null, askText: "", counterText: "" });
      const row = rounds.get(key);
      if (o.speaker === "vendor") { if (row.ask === null) { row.ask = o.price; row.askText = o.text || ""; } }
      else if (row.counter === null) { row.counter = o.price; row.counterText = o.text || ""; }
    }
    const list = [...rounds.values()].sort((a, b) => a.round - b.round);
    const asks = list.map((x) => x.ask).filter(isNum);
    const unit = (offers.find((o) => o.unit) || {}).unit || "";
    bargain = {
      negotiationId: n.negotiationId, vendorId: n.vendorId, vendorName: n.vendorName || null, simulated: Boolean(n.simulated),
      running: Boolean(n.running), rounds: list,
      agreed: isNum(n.agreedPrice) ? n.agreedPrice : null,
      best: asks.length ? Math.min(...asks) : null,
      noDeal: !n.running && n.agreed === false,
      unit,
    };
  }

  const deals = Array.isArray(d.deals) ? d.deals : [];
  const p = d.pendingApproval;
  let deal = null;
  if (p && p.approvalId) {
    const q = deals.find((x) => same(x.quoteId, p.quoteId)) || {};
    deal = { vendorId: q.vendorId ?? null, vendorName: q.vendorName || null, simulated: Boolean(q.simulated || p.simulated),
      unitPrice: isNum(q.unitPrice) ? q.unitPrice : null, unit: q.unit || null, quantity: isNum(q.quantity) ? q.quantity : need.quantity,
      total: isNum(p.totalAmount) ? p.totalAmount : isNum(q.landedCost) ? q.landedCost : null, approvalId: String(p.approvalId), quoteId: p.quoteId ?? null };
  } else if (d.bestQuote) {
    const q = d.bestQuote;
    deal = { vendorId: q.vendorId ?? null, vendorName: q.vendorName || null, simulated: Boolean(q.simulated),
      unitPrice: isNum(q.unitPrice) ? q.unitPrice : null, unit: q.unit || null, quantity: isNum(q.quantity) ? q.quantity : need.quantity,
      total: isNum(q.landedCost) ? q.landedCost : null, approvalId: null, quoteId: q.quoteId ?? null };
  } else if (bargain && bargain.agreed !== null) {
    deal = { vendorId: bargain.vendorId, vendorName: bargain.vendorName, simulated: bargain.simulated, unitPrice: bargain.agreed, unit: bargain.unit || null,
      quantity: need.quantity, total: null, approvalId: null, quoteId: null };
  }

  const search = d.search || null;
  return {
    need, sellers, bargain, deal,
    searching: Boolean(search && RUNNING_JOB.has(search.status)),
    searchError: search && search.status === "failed" && search.error ? String(search.error) : null,
  };
}

/** The words for a refused "Bargain with this seller": the server's own (say, else message). */
export function refusalWords(err) {
  if (!err) return null;
  if (typeof err.say === "string" && err.say.trim()) return err.say.trim();
  if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
  return null;
}
