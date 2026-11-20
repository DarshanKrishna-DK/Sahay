// Buy, as data: the seven stations of the current need, the HUD figures on them, the price ladder
// rows, the order shelves and the earlier needs. Pure functions over the store's maps (store.js
// `state`), no DOM and no imports, so node:test loads this file as is (test/buy-model.test.js).
// Every figure here comes from a server record; nothing is estimated or filled in.

const PAID = new Set(["paid", "in_transit", "delivered", "closed"]);
const FINISHED = new Set(["delivered", "closed", "cancelled", "rejected"]);
const RUNNING = new Set(["running", "queued"]);
const NEGO_OPEN = new Set(["open", "running", "starting"]);

const byCreated = (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
const values = (m) => (m && typeof m.values === "function" ? [...m.values()] : Array.isArray(m) ? m : []);
const same = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const STATION_IDS = ["heard", "search", "bargain", "yes", "ordered", "paid", "reminder"];

/**
 * The seven stations of `req`, from the store. Each: { id, status: done|active|needs|upcoming|failed, ... }.
 * Also returns the records the screen needs (vendors, quotes, approval, order, negotiation).
 */
export function stationsFor(st, req) {
  const rid = req ? String(req.id) : null;
  const jobs = rid ? values(st.jobs).filter((j) => same(j.requirementId, rid)) : [];
  const sourcing = jobs.filter((j) => j.kind === "sourcing").sort(byCreated).pop() || null;
  const negJobs = jobs.filter((j) => j.kind === "negotiation").sort(byCreated);
  const lastNegJob = negJobs[negJobs.length - 1] || null;
  const mine = (r) => !r.requirementId || same(r.requirementId, rid);
  const vendors = rid ? values(st.vendors).filter(mine).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) : [];
  const negos = rid ? values(st.negotiations).filter(mine).sort(byCreated) : [];
  const runningNego = negos.filter((n) => !n.endedAt && (!n.status || NEGO_OPEN.has(n.status))).pop() || null;
  const negotiation = runningNego || negos[negos.length - 1] || null;
  const quotes = rid ? values(st.quotes).filter(mine) : [];
  const quoteIds = new Set(quotes.map((q) => String(q.id)));
  const approvals = values(st.approvals).filter((a) => quoteIds.has(String(a.quoteId)))
    .sort((a, b) => String(a.requestedAt || "").localeCompare(String(b.requestedAt || "")));
  const approval = approvals.find((a) => a.status === "pending") || approvals[approvals.length - 1] || null;
  const approvalIds = new Set(approvals.map((a) => String(a.id)));
  const order = values(st.orders).find((o) => approvalIds.has(String(o.approvalId)) || quoteIds.has(String(o.quoteId))) || null;
  const follow = order ? values(st.followups).filter((f) => same(f.orderId, order.id))
    .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || ""))) : [];
  const nextFollow = follow.find((f) => f.status === "scheduled") || null;
  const firedFollow = follow.filter((f) => f.status === "fired").pop() || null;

  const stations = [];
  stations.push({ id: "heard", status: req ? "done" : "upcoming" });

  let search = "upcoming";
  if (sourcing) search = RUNNING.has(sourcing.status) ? "active" : sourcing.status === "failed" ? (vendors.length ? "done" : "failed") : "done";
  else if (vendors.length) search = "done";
  stations.push({ id: "search", status: search, job: sourcing });

  let bargain = "upcoming";
  if (runningNego || (lastNegJob && RUNNING.has(lastNegJob.status))) bargain = "active";
  else if (quotes.length) bargain = "done";
  else if (negos.some((n) => n.endedAt) || (lastNegJob && lastNegJob.status === "failed")) bargain = "failed";
  stations.push({ id: "bargain", status: bargain, job: lastNegJob, running: Boolean(runningNego) });

  let yes = "upcoming";
  if (approval) yes = approval.status === "pending" ? "needs" : approval.status === "rejected" ? "failed" : "done";
  stations.push({ id: "yes", status: yes });

  stations.push({ id: "ordered", status: order ? (order.status === "cancelled" ? "failed" : "done") : "upcoming" });
  const paid = Boolean(order && PAID.has(order.status));
  stations.push({ id: "paid", status: paid ? "done" : order && order.paymentUrl ? "active" : "upcoming" });
  stations.push({ id: "reminder", status: nextFollow ? "active" : firedFollow ? "done" : "upcoming" });

  return { stations, vendors, quotes, approval, order, negotiation, runningNegotiation: runningNego, nextFollow, firedFollow };
}

/** Index of the furthest station that has started (the glowing part of the river ends there). */
export function reachOf(stations) {
  let reach = 0;
  stations.forEach((s, i) => { if (s.status !== "upcoming") reach = i; });
  return reach;
}

/**
 * HUD figures for each station, only when a record carries them (Gather-style trackers):
 *   heard { at }, search { sellers, simulated, error }, bargain { rounds, ask, offer, unit, agreed },
 *   yes { total }, ordered { po }, paid { paid, link }, reminder { at, sent }.
 * A station with nothing real to say gets null and shows no tracker.
 */
export function hudFor(model, req) {
  const out = {};
  out.heard = req && req.createdAt ? { at: req.createdAt } : null;
  const search = model.stations.find((s) => s.id === "search");
  const sims = model.vendors.filter((v) => v.simulated).length;
  out.search = model.vendors.length
    ? { sellers: model.vendors.length, simulated: sims }
    : search && search.status === "failed" && search.job && search.job.error ? { error: String(search.job.error) } : null;
  const lad = ladderRows(model.negotiation);
  out.bargain = lad.rows.length
    ? { rounds: lad.rounds, ask: lad.lastAsk, offer: lad.lastOffer, unit: lad.unit, agreed: lad.agreed }
    : null;
  out.yes = model.approval && isNum(model.approval.totalAmount) ? { total: model.approval.totalAmount, status: model.approval.status } : null;
  out.ordered = model.order && model.order.poNumber ? { po: String(model.order.poNumber) } : null;
  out.paid = model.order ? (PAID.has(model.order.status) ? { paid: true } : model.order.paymentUrl ? { link: true } : null) : null;
  out.reminder = model.nextFollow ? { at: model.nextFollow.dueAt, sent: false } : model.firedFollow ? { at: model.firedFollow.firedAt, sent: true } : null;
  return out;
}

/**
 * The negotiation as ladder rows. Each row: { side: "ask"|"offer", round, offer, unit, text, ts, pair }
 * in the order they were said; `pair` is the row's place in its own column (ask k sits beside offer k).
 * agreed = the outcome's unit price when the talk ended in a deal.
 */
export function ladderRows(n) {
  const empty = { rows: [], rounds: 0, unit: "", agreed: null, ended: false, noDeal: false, firstAsk: null, lastAsk: null, lastOffer: null, simulated: false };
  if (!n) return empty;
  const outcome = n.outcome && typeof n.outcome === "object" ? n.outcome : null;
  const agreed = outcome && outcome.agreed && isNum(outcome.unitPrice) ? outcome.unitPrice : null;
  const seen = new Set();
  const rows = [];
  const turns = Array.isArray(n.turns) ? n.turns : [];
  turns.forEach((x, i) => {
    if (!x || !isNum(x.offer) || (x.speaker !== "vendor" && x.speaker !== "agent")) return;
    const side = x.speaker === "vendor" ? "ask" : "offer";
    const key = `${side}|${x.round ?? ""}|${x.offer}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ side, round: isNum(x.round) ? x.round : null, offer: x.offer, unit: x.unit || "", text: typeof x.text === "string" ? x.text.trim() : "", ts: x.ts ?? null, at: i });
  });
  rows.sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || a.at - b.at);
  const counts = { ask: 0, offer: 0 };
  for (const r of rows) { counts[r.side] += 1; r.pair = counts[r.side]; delete r.at; }
  const asks = rows.filter((r) => r.side === "ask");
  const offers = rows.filter((r) => r.side === "offer");
  const unit = (rows[0] && rows[0].unit) || (outcome && outcome.unit) || "";
  const rounds = rows.reduce((m, r) => Math.max(m, r.round ?? 0), 0) || Math.max(asks.length, offers.length);
  for (const r of rows) r.meet = agreed !== null && r.offer === agreed;
  return {
    rows,
    rounds,
    unit,
    agreed,
    ended: Boolean(n.endedAt),
    noDeal: Boolean(n.endedAt) && agreed === null,
    firstAsk: asks.length ? asks[0].offer : null,
    lastAsk: asks.length ? asks[asks.length - 1].offer : null,
    lastOffer: offers.length ? offers[offers.length - 1].offer : null,
    simulated: n.counterpart === "simulated" || Boolean(outcome && outcome.simulated),
  };
}

/** Which shelf an order sits on: to pay, on the way (Arrived), or done. */
export function orderShelf(o) {
  const s = o && o.status ? String(o.status) : "";
  if (FINISHED.has(s)) return "done";
  if (PAID.has(s)) return "onTheWay";
  return "toPay";
}
export const isPaid = (o) => Boolean(o && PAID.has(o.status));

/** All purchase orders, newest first, on their three shelves. */
export function orderShelves(orders) {
  const all = values(orders).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const out = { toPay: [], onTheWay: [], done: [] };
  for (const o of all) out[orderShelf(o)].push(o);
  return out;
}

/** The next and the last reminder of an order. */
export function remindersOf(st, orderId) {
  const f = values(st.followups).filter((x) => same(x.orderId, orderId));
  const next = f.filter((x) => x.status === "scheduled").sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")))[0] || null;
  const sent = f.filter((x) => x.status === "fired").sort((a, b) => String(b.firedAt || "").localeCompare(String(a.firedAt || "")))[0] || null;
  return { next, sent };
}

/** How far the clock has run from `from` to `to` (0..1); 0 when either date is unknown. */
export function clockFraction(from, to, now = Date.now()) {
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.min(1, Math.max(0, (now - a) / (b - a)));
}

/** The order's seller and what was bought, from the order, its quote and the need. */
export function orderFacts(st, o) {
  const q = o && o.quoteId !== undefined && o.quoteId !== null && st.quotes ? st.quotes.get(String(o.quoteId)) : null;
  const reqs = Array.isArray(st.requirements) ? st.requirements : [];
  const req = q && q.requirementId !== undefined ? reqs.find((r) => same(r.id, q.requirementId)) || null : null;
  const vendorRec = q && q.vendorId !== undefined && st.vendors ? st.vendors.get(String(q.vendorId)) : null;
  return {
    vendor: (o && o.vendorName) || (q && q.vendorName) || (vendorRec && vendorRec.name) || null,
    simulated: Boolean((o && o.simulated) || (q && q.simulated) || (vendorRec && vendorRec.simulated)),
    item: req ? req.item || null : null,
    quantity: q && isNum(q.quantity) ? q.quantity : req && isNum(req.quantity) ? req.quantity : null,
    unit: (q && q.unit) || (req && req.unit) || null,
    unitPrice: q && isNum(q.unitPrice) ? q.unitPrice : null,
  };
}

/** Earlier needs: every need but the current one and the dismissed, newest first, at most `max`. */
export function earlierNeeds(st, req, max = 8) {
  const reqs = Array.isArray(st.requirements) ? st.requirements : [];
  return reqs.filter((r) => r && r.status !== "dismissed" && !(req && same(r.id, req.id))).slice().reverse().slice(0, max)
    .map((r) => ({ need: r, busy: values(st.jobs).some((j) => same(j.requirementId, r.id) && RUNNING.has(j.status)) }));
}

/**
 * The seller's name as given, short but whole: whole words up to about 18 characters, never a
 * cut word or initials. One very long first word stays whole.
 */
export function shortName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  let out = words[0];
  for (const w of words.slice(1)) {
    if ([...`${out} ${w}`].length > 18) return `${out}…`;
    out = `${out} ${w}`;
  }
  return out;
}

/**
 * Points of the river path for `n` stations in a box W x H: a gentle wave through the centres of
 * n equal columns (horizontal) or a meander (vertical). Returned in box units, plus the SVG path through them.
 */
export function riverGeometry(n, vertical, W, H) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0.5;
    if (vertical) pts.push([W * (0.5 + 0.22 * Math.sin(f * Math.PI * 2.5)), H * (0.05 + f * 0.9)]);
    else pts.push([W * (i + 0.5) / n, H * (0.5 - 0.3 * Math.sin(f * Math.PI * 1.7 + 0.3))]);
  }
  let d = pts.length ? `M ${r1(pts[0][0])} ${r1(pts[0][1])}` : "";
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (vertical) { const my = (y0 + y1) / 2; d += ` C ${r1(x0)} ${r1(my)}, ${r1(x1)} ${r1(my)}, ${r1(x1)} ${r1(y1)}`; }
    else { const mx = (x0 + x1) / 2; d += ` C ${r1(mx)} ${r1(y0)}, ${r1(mx)} ${r1(y1)}, ${r1(x1)} ${r1(y1)}`; }
  }
  return { pts, d };
}
const r1 = (v) => Math.round(v * 10) / 10;
