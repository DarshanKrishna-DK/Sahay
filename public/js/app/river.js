// The work river: the current need as stations along one glowing curved path.
// Heard you -> Searching (seller bubbles pop in) -> Bargaining -> Your yes -> Ordered -> Paid
// -> Reminder. Built only from the store (GET /api/state + SSE), so a reload mid-negotiation
// rebuilds the same stations, and live events only move them forward.

import { h, icon, svgEl, scripted, rupees, amount, toDate as toDateSafe } from "./dom.js";
import { t, when } from "./i18n.js";
import { state } from "./store.js";

/** One record per station: { id, icon, status: done|active|needs|upcoming|failed, detail } */
export function stationsFor(req) {
  const rid = req ? String(req.id) : null;
  const jobs = [...state.jobs.values()].filter((j) => rid && String(j.requirementId) === rid);
  const sourcing = jobs.filter((j) => j.kind === "sourcing").sort(byTime).pop();
  const negJobs = jobs.filter((j) => j.kind === "negotiation").sort(byTime);
  const vendors = [...state.vendors.values()].filter((v) => !v.requirementId || String(v.requirementId) === rid);
  const negos = [...state.negotiations.values()];
  const runningNego = negos.find((n) => !n.endedAt && (!n.status || ["open", "running", "starting"].includes(n.status)));
  const quotes = [...state.quotes.values()].filter((q) => !q.requirementId || String(q.requirementId) === rid);
  const quoteIds = new Set(quotes.map((q) => String(q.id)));
  const approvals = [...state.approvals.values()].filter((a) => quoteIds.has(String(a.quoteId)))
    .sort((a, b) => String(a.requestedAt || "").localeCompare(String(b.requestedAt || "")));
  const approval = approvals.find((a) => a.status === "pending") || approvals[approvals.length - 1] || null;
  const approvalIds = new Set(approvals.map((a) => String(a.id)));
  const order = [...state.orders.values()].find((o) => approvalIds.has(String(o.approvalId)) || quoteIds.has(String(o.quoteId))) || null;
  const follow = order ? [...state.followups.values()].filter((f) => String(f.orderId) === String(order.id))
    .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || ""))) : [];
  const nextFollow = follow.find((f) => f.status === "scheduled") || null;
  const firedFollow = follow.filter((f) => f.status === "fired").pop() || null;

  const s = [];
  s.push({ id: "heard", icon: "ear", status: req ? "done" : "upcoming" });

  let search = "upcoming";
  if (sourcing) search = sourcing.status === "running" || sourcing.status === "queued" ? "active" : sourcing.status === "failed" ? "failed" : "done";
  else if (vendors.length) search = "done";
  s.push({ id: "search", icon: "search", status: search, count: vendors.length, job: sourcing || null });

  let bargain = "upcoming";
  const lastNegJob = negJobs[negJobs.length - 1];
  if (runningNego || (lastNegJob && (lastNegJob.status === "running" || lastNegJob.status === "queued"))) bargain = "active";
  else if (quotes.length) bargain = "done";
  else if (negos.some((n) => n.endedAt) || (lastNegJob && lastNegJob.status === "failed")) bargain = "failed";
  const shownNego = runningNego || negos.slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).pop() || null;
  s.push({ id: "bargain", icon: "handshake", status: bargain, negotiation: shownNego, running: Boolean(runningNego) });

  let yes = "upcoming";
  if (approval) yes = approval.status === "pending" ? "needs" : approval.status === "rejected" ? "failed" : "done";
  s.push({ id: "yes", icon: "check", status: yes, approval });

  s.push({ id: "ordered", icon: "doc", status: order ? "done" : "upcoming", order });
  const paid = order && ["paid", "in_transit", "delivered", "closed"].includes(order.status);
  s.push({ id: "paid", icon: "rupee", status: paid ? "done" : order && order.paymentUrl ? "active" : "upcoming", order });
  s.push({ id: "reminder", icon: "bell", status: firedFollow && !nextFollow ? "done" : nextFollow ? "active" : "upcoming", followup: nextFollow || firedFollow });
  return { stations: s, vendors, quotes, approval, order };
}

function byTime(a, b) { return String(a.createdAt || "").localeCompare(String(b.createdAt || "")); }

const LABEL = { heard: "st.heard", search: "st.search", bargain: "st.bargain", yes: "st.yes", ordered: "st.ordered", paid: "st.paid", reminder: "st.reminder" };
const STATE = { done: "st.done", active: "st.active", needs: "st.needsYou", upcoming: "st.upcoming", failed: "st.failed" };

/** Station positions (0..1) for a horizontal wave (wide) or a vertical meander (narrow). */
function layout(n, vertical) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    if (vertical) pts.push([i % 2 === 0 ? 0.26 : 0.74, 0.06 + f * 0.88]);
    else pts.push([0.06 + f * 0.88, i % 2 === 0 ? 0.68 : 0.3]);
  }
  return pts;
}

function curve(pts, W, H, vertical) {
  const P = pts.map(([x, y]) => [x * W, y * H]);
  let d = `M ${P[0][0]} ${P[0][1]}`;
  for (let i = 1; i < P.length; i++) {
    const [x0, y0] = P[i - 1], [x1, y1] = P[i];
    if (vertical) {
      const my = (y0 + y1) / 2;
      d += ` C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`;
    } else {
      const mx = (x0 + x1) / 2;
      d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
    }
  }
  return d;
}

/**
 * renderRiver(container, model, { vertical, onStation, freshVendorIds })
 * Rebuilt only when its key changes (see work.js); vendor bubbles new since last time pop in.
 */
export function renderRiver(model, { vertical, onStation, freshVendorIds = new Set() }) {
  const { stations, vendors } = model;
  const W = vertical ? 360 : 1000;
  const H = vertical ? 1040 : 300;
  const pts = layout(stations.length, vertical);
  const d = curve(pts, W, H, vertical);
  // Progress reaches the last station that is done / active / needs you.
  let reach = 0;
  stations.forEach((s, i) => { if (s.status !== "upcoming") reach = i; });
  const frac = stations.length > 1 ? reach / (stations.length - 1) : 0;

  const svg = svgEl("svg", { class: "river-svg", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": "true" });
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: "river-grad", x1: "0", y1: "0", x2: vertical ? "0" : "1", y2: vertical ? "1" : "0" });
  grad.append(svgEl("stop", { offset: "0", "stop-color": "var(--leaf)" }), svgEl("stop", { offset: "1", "stop-color": "var(--marigold)" }));
  defs.append(grad);
  svg.append(defs,
    svgEl("path", { d, class: "river-base", pathLength: 1, "vector-effect": "non-scaling-stroke" }),
    svgEl("path", { d, class: "river-glow", pathLength: 1, "stroke-dasharray": `${frac} 1`, "vector-effect": "non-scaling-stroke" }),
    svgEl("path", { d, class: "river-flow", pathLength: 1, "stroke-dasharray": `${frac} 1`, "vector-effect": "non-scaling-stroke" }));

  const list = h("ol", { class: "river-stations", "aria-label": t("work.stations") });
  stations.forEach((s, i) => {
    const [x, y] = pts[i];
    const label = t(LABEL[s.id]);
    const stateWord = t(STATE[s.status]);
    const btn = h("button", {
      class: "station", type: "button", dataset: { status: s.status, id: s.id },
      "aria-label": `${i + 1}. ${label}, ${stateWord}`,
      on: { click: (e) => onStation(s, e.currentTarget) },
    },
    h("span", { class: "station-dot" }, s.status === "done" ? icon("check", 26) : s.status === "failed" ? icon("x", 26) : icon(s.icon, 26)),
    h("span", { class: "station-word", text: label }),
    s.status !== "upcoming" ? h("span", { class: "station-state" }, stateIcon(s.status), h("span", { text: stateWord })) : null);
    list.append(h("li", { class: "station-item", style: `--x:${x};--y:${y}` }, btn));
  });

  // Seller bubbles sit on the river itself, like beads, between "Searching" and "Bargaining".
  const extra = vendors.length > 3 ? 1 : 0;
  const shown = vendors.slice(0, 3 - extra);
  const beads = shown.length + extra;
  const bub = h("div", { class: "river-vendors", "aria-hidden": "true" });
  const at = (k) => onCurve(pts[1], pts[2], (vertical ? 0.3 : 0.25) + (beads > 1 ? (k / (beads - 1)) * (vertical ? 0.4 : 0.5) : (vertical ? 0.2 : 0.25)), vertical);
  shown.forEach((v, i) => {
    const [x, y] = at(i);
    bub.append(h("span", { class: `vbub${freshVendorIds.has(String(v.id)) ? " pop" : ""}${v.simulated ? " sim" : ""}`, style: `--x:${x};--y:${y};--i:${i}` }, initials(v.name)));
  });
  if (extra) {
    const [x, y] = at(beads - 1);
    bub.append(h("span", { class: "vbub more", style: `--x:${x};--y:${y}` }, `+${vendors.length - shown.length}`));
  }
  return h("div", { class: `river${vertical ? " river-v" : ""}` }, svg, bub, list);
}

/** A point at t on the same cubic segment curve() draws between two stations (unit coordinates). */
function onCurve([x0, y0], [x1, y1], t, vertical) {
  const u = 1 - t;
  const b = (a, c1, c2, d) => u * u * u * a + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * d;
  if (vertical) { const my = (y0 + y1) / 2; return [b(x0, x0, x1, x1), b(y0, my, my, y1)]; }
  const mx = (x0 + x1) / 2;
  return [b(x0, mx, mx, x1), b(y0, y0, y1, y1)];
}

function stateIcon(status) {
  return icon({ done: "check", active: "refresh", needs: "alert", failed: "x" }[status] || "spark", 16);
}

export function initials(name) {
  const words = String(name || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words[1] ? words[1][0] : "")).toUpperCase();
}

/* ---------------------------------------------------------- details -- */

/** Body of a station's sheet: plain facts from the store, with a 🔊 where a key exists. */
export function stationDetail(s, model, req, speakButton, extra = {}) {
  const rows = [];
  const fact = (ic, text) => text ? h("p", { class: "fact" }, icon(ic, 22), scripted("span", String(text))) : null;
  if (s.id === "heard" && req) {
    rows.push(h("p", { class: "sheet-big" }, scripted("span", [amount(req.quantity), req.unit, req.item].filter(Boolean).join(" "))));
    rows.push(fact("rupee", req.maxPrice !== null && req.maxPrice !== undefined ? t("work.upTo", { p: `${rupees(req.maxPrice)}${req.unit ? `/${req.unit}` : ""}` }) : null));
    rows.push(fact("pin", req.city));
    rows.push(fact("truck", req.deliveryBy ? t("work.when", { d: req.deliveryBy }) : null));
    rows.push(h("div", { class: "sheet-speak" }, speakButton(`need:${req.id}`)));
  } else if (s.id === "search") {
    if (!model.vendors.length) rows.push(h("p", { class: "fact muted", text: s.status === "active" ? t("now.searching", { item: req ? req.item : "" }) : t("work.noSellers") }));
    else {
      rows.push(h("p", { class: "fact" }, icon("store", 22), h("span", { text: t("work.sellers", { n: model.vendors.length }) })));
      rows.push(h("ol", { class: "seller-list" }, ...model.vendors.slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 10).map((v) =>
        h("li", { class: "seller" },
          h("span", { class: `vbub static${v.simulated ? " sim" : ""}`, "aria-hidden": "true" }, initials(v.name)),
          h("span", { class: "seller-main" }, scripted("span", v.name || "", { class: "seller-name" }),
            h("span", { class: "seller-sub" }, [v.city, v.listedPrice !== null && v.listedPrice !== undefined ? `${rupees(v.listedPrice)}${v.listedUnit ? `/${v.listedUnit}` : ""}` : v.listedPriceText].filter(Boolean).join(", "))),
          v.simulated ? h("span", { class: "sim-pill" }, h("span", { text: t("simulated") })) : null))));
    }
    if (req) rows.push(h("div", { class: "sheet-speak" }, speakButton(`need:${req.id}`)));
  } else if (s.id === "bargain") {
    if (extra.ladder) rows.push(extra.ladder);
    if (extra.listen) rows.push(extra.listen);
  } else if (s.id === "yes" && model.approval) {
    const a = model.approval;
    rows.push(h("p", { class: "sheet-big" }, rupees(a.totalAmount) || ""));
    if (a.readback) rows.push(scripted("p", a.readback, { class: "fact-text" }));
    if (a.status !== "pending") rows.push(fact(a.status === "rejected" ? "x" : "check", `${t(a.status === "rejected" ? "hist.approval.no" : "hist.approval.yes")}${a.decidedVia ? `, ${t(a.decidedVia === "voice" ? "hist.byVoice" : "hist.byButton")}` : ""}`));
    rows.push(h("div", { class: "sheet-speak" }, speakButton(`approval:${a.id}`)));
  } else if ((s.id === "ordered" || s.id === "paid") && model.order) {
    const o = model.order;
    rows.push(h("p", { class: "sheet-big" }, rupees(o.amount) || ""));
    rows.push(fact("doc", o.poNumber));
    rows.push(fact(s.status === "done" && s.id === "paid" ? "check" : "rupee", s.id === "paid" ? t(s.status === "done" ? "orders.paid" : "orders.unpaid") : t(`orders.status.${o.status}`) !== `orders.status.${o.status}` ? t(`orders.status.${o.status}`) : null));
    rows.push(h("div", { class: "sheet-actions" },
      o.pdfUrl ? h("a", { class: "btn btn-ghost", href: o.pdfUrl, target: "_blank", rel: "noopener" }, icon("download", 22), h("span", { text: t("orders.paper") })) : null,
      o.paymentUrl && s.status !== "done" ? h("a", { class: "btn btn-primary", href: o.paymentUrl, target: "_blank", rel: "noopener noreferrer" }, icon("rupee", 22), h("span", { text: t("orders.pay") })) : null,
      speakButton(`order:${o.id}`)));
  } else if (s.id === "reminder" && s.followup) {
    const f = s.followup;
    rows.push(fact("bell", t(`orders.rem.${f.kind}`) !== `orders.rem.${f.kind}` ? t(`orders.rem.${f.kind}`) : f.kind));
    const d = toDateSafe(f.status === "fired" ? f.firedAt : f.dueAt);
    rows.push(fact("history", d ? `${t(f.status === "fired" ? "orders.sent" : "orders.next")}: ${when(d)}` : null));
    if (f.message) rows.push(scripted("p", f.message, { class: "fact-text" }));
  } else {
    rows.push(h("p", { class: "fact muted", text: t("st.upcoming") }));
  }
  return rows.filter(Boolean);
}
