// Buy (UI v5, screens.md 04 Buy): the page pattern, three groups at most.
//   1. Title "Buy", one sentence, ONE primary button "Ask Sahay to buy" (starts a voice call here).
//   2. "Needs you" (only when a deal waits for the owner's yes): W3's rows (yes.js needsRows), a row
//      opens W3's Yes card.
//   3. "Your orders": the current need while Sahay works on it (Asking vendors / Waiting for you),
//      every purchase order (Ordered / Cancelled), earlier needs (Asked before). Row: item + quantity,
//      vendor + day, amount, status word with a dot. Five rows, then "Show all". A row opens a
//      sheet: what was said (every vendor line marked "simulated vendor" when it is one), Listen
//      in while live, and the order's actions (Pay with test mode, Arrived, Order paper) or Remove.
// Every figure comes from the store (buy-model); nothing is filled in. Words: buy-i18n.js.

import { h, icon, patch, scripted, rupees, amount, toDate, safeUrl, daysWord, daysSince,
  button, pageHead, card, list, chip, simChip, testChip, emptyState, skeleton, errorLine,
  openSheet, notify } from "./ui.js";
import { t, unitWord, cityWord } from "./i18n.js";
import { state, dismissRequirement } from "./store.js";
import { markDelivered } from "./store-sell.js";
import { NegotiationListener } from "../voice.js";
import { stationsFor, ladderRows, progressOf, bestPrice, buyRows, orderShelf, orderFacts, remindersOf } from "./buy-model.js";
import { talkHere, errorWords, dateTime, itemWords } from "./buy-kit.js";

const STATUS = {
  asking: ["b5.st.asking", "info"], waiting: ["b5.st.waiting", "needs"], ordered: ["b5.st.ordered", "good"],
  cancelled: ["b5.st.cancelled", "muted"], earlier: ["b5.st.earlier", "muted"],
};
const STEP_ICON = { asked: "ear", found: "search", bargain: "handshake", yes: "check", ordered: "receipt" };
const perUnit = (p, unit) => `${rupees(p)}${unit ? ` / ${unitWord(unit)}` : ""}`;
const needLine = (r) => [amount(r.quantity), unitWord(r.unit), itemWords(r.item)].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
const langKey = () => document.documentElement.lang;
const day = (ts) => { const n = daysSince(ts); return n === null ? null : daysWord(n); };

function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href }));
}

/** The status word with its 8px dot (the word always says it; the colour only helps). */
function statusEl(status) {
  const [key, tone] = STATUS[status] || STATUS.earlier;
  return h("span", { class: `b5-status is-${tone}` }, h("span", { class: "b5-dot", "aria-hidden": "true" }), h("span", { text: t(key) }));
}

export function createBuy() {
  ensureCss("/css/buy.css");
  const el = h("div", { class: "screen b5-buy" });
  const headBox = h("div");
  const needsBox = h("div");
  const ordersBox = h("div");
  el.append(headBox, needsBox, ordersBox);

  const listen = { status: "idle", error: null, route: null };
  const listener = new NegotiationListener((s) => { Object.assign(listen, s); refreshSheet(); });
  let sheet = null; // { api, row, key }
  const busy = { arrived: new Set(), remove: false };
  let sheetError = null;
  let needs = [];
  let offNeeds = () => {};
  // W3's "Needs you" rows (yes.js), loaded lazily so Buy still works while that module is not there.
  import("./yes.js").then((m) => {
    if (m && typeof m.onNeedsRows === "function") offNeeds = m.onNeedsRows((rows) => { needs = rows; renderNeeds(); });
  }).catch(() => {});

  /* ------------------------------------------------------- needs you -- */
  function renderNeeds() {
    const rows = needs.filter((r) => r.kind === "buy");
    patch(needsBox, JSON.stringify([langKey(), rows.map((r) => [r.key, r.phase, r.line, r.amountText, r.meta, r.simulated])]), () => (rows.length
      ? card({ title: t("b5.needsYou"), needs: true, cls: "b5-needs",
        body: list(rows.map((r) => ({
          icon: r.icon || "cart",
          title: r.line,
          sub: [r.meta, r.simulated ? t("simulated") : null].filter(Boolean).join(", ") || undefined,
          subCls: r.simulated ? "is-sim" : undefined,
          end: [r.amountText ? h("span", { class: "amount num", text: r.amountText }) : null, h("span", { class: "btn btn-secondary btn-sm b5-check", "aria-hidden": "true" }, h("span", { text: t("b5.check") }))].filter(Boolean),
          label: `${t("b5.check")}: ${r.line}`,
          onClick: () => r.open(),
        })), { limit: 3, label: t("b5.needsYou") }) })
      : []));
  }

  /* ------------------------------------------------- what was said -- */
  function transcript(m) {
    const n = m.negotiation;
    const lad = ladderRows(n);
    if (!n) return null;
    const v = n.vendorId !== undefined && n.vendorId !== null ? state.vendors.get(String(n.vendorId)) : null;
    const sim = Boolean((v && v.simulated) || lad.simulated);
    const vendor = (v && v.name) || (n.outcome && n.outcome.vendorName) || t("ladder.asks");
    const rows = lad.rows.map((r) => {
      const ask = r.side === "ask";
      return {
        icon: ask ? "store" : "spark",
        title: t(ask ? "b5.sellerAsks" : "b5.sahayOffers", { p: perUnit(r.offer, r.unit || lad.unit) }),
        sub: [ask ? vendor : t("b4.lad.sahay"), ask && sim ? t("simulated") : null, r.text || null].filter(Boolean).join(" · "),
        end: r.meet ? chip(t("b4.lad.tagAgreed"), { tone: "good", icon: "check" }) : null,
      };
    });
    return h("div", { class: "b5-said" },
      h("h3", { class: "b5-said-title", text: t("b5.transcript") }),
      lad.agreed !== null ? h("p", { class: "b5-agreed" }, icon("check", 20), h("span", { text: t("ladder.agreed", { p: perUnit(lad.agreed, lad.unit) }) })) : null,
      lad.noDeal ? errorLine(t("ladder.noDeal")) : null,
      rows.length ? list(rows, { limit: 6, label: t("b5.transcript") })
        : emptyState({ icon: "handshake", title: lad.ended ? t("ladder.noDeal") : t("b3.lad.waitStart"), inline: true }));
  }

  function listenButton(m) {
    const n = m.runningNegotiation;
    if (!n && listen.status === "idle") return null;
    if (listen.status === "joining") return button({ word: t(listen.route === "proxy" ? "talk.saferRoute" : "b3.listen.connecting"), kind: "secondary", busy: true });
    if (listen.status === "listening") return button({ word: t("b5.listenStop"), icon: "stop", kind: "secondary", onClick: () => listener.stop() });
    return button({ word: t("work.listen"), icon: "headphones", kind: "secondary", onClick: () => { if (n) listener.start(n.id); } });
  }

  /** The five plain steps of the need Sahay is working on. */
  function steps(m) {
    const p = progressOf(m);
    return h("ol", { class: "b5-steps", "aria-label": t("work.stations") },
      ...p.steps.map((s, i) => {
        const st = s.status === "done" ? "done" : i === p.current ? (s.status === "failed" ? "failed" : "now") : "next";
        return h("li", { class: `b5-step is-${st}` },
          h("span", { class: "b5-step-ico", "aria-hidden": "true" }, icon(st === "done" ? "check" : st === "failed" ? "x" : STEP_ICON[s.word], 20)),
          h("span", { class: "b5-step-word", text: t(`b5.step.${s.word}`) }),
          h("span", { class: "sr-only", text: `, ${t(st === "done" ? "st.done" : st === "now" ? "st.active" : st === "failed" ? "st.failed" : "st.upcoming")}` }));
      }));
  }

  /* ------------------------------------------------------- row sheets -- */
  async function arrived(id) {
    if (busy.arrived.has(id)) return;
    busy.arrived.add(id); sheetError = null; refreshSheet(true);
    try {
      await markDelivered(id);
      notify({ tone: "success", icon: "checkCircle", title: t("b3.arrivedDone") });
    } catch (err) {
      sheetError = errorWords(err);
    }
    busy.arrived.delete(id); refreshSheet(true);
  }

  async function remove(need) {
    if (busy.remove) return;
    busy.remove = true; sheetError = null; refreshSheet(true);
    try {
      await dismissRequirement(String(need.id));
      busy.remove = false;
      if (sheet) sheet.api.close();
      return;
    } catch (err) {
      const code = err && err.code;
      sheetError = code === "REQUIREMENT_BUSY" ? t("work.dismissBusy") : code === "REQUIREMENT_ORDERED" ? t("work.dismissOrdered") : (err && err.say) || t("work.dismissFail");
    }
    busy.remove = false; refreshSheet(true);
  }

  function sheetParts(row) {
    const fact = (ic, text) => (text ? h("p", { class: "b5-fact" }, icon(ic, 20), scripted("span", text)) : null);
    if (row.kind === "need" || (row.kind === "order" && row.need)) {
      const req = row.need;
      const m = stationsFor(state, req);
      const best = bestPrice(m);
      const a = m.approval && m.approval.status === "pending" ? m.approval : null;
      const where = [req.maxPrice !== null && req.maxPrice !== undefined ? t("work.upTo", { p: perUnit(req.maxPrice, req.unit) }) : null, req.city ? cityWord(req.city) : null].filter(Boolean).join(" · ");
      const body = [
        h("p", { class: "b5-sheet-row" }, statusEl(row.status), where ? h("span", { class: "b5-where", text: where }) : null),
        steps(m),
        m.stations[1].status === "failed" && m.stations[1].job && m.stations[1].job.error ? errorLine(String(m.stations[1].job.error)) : null,
        best ? h("div", { class: "b5-best" },
          h("p", { class: "b5-best-label", text: t(best.agreed ? "b5.agreed" : "b5.best") }),
          h("p", { class: "figure num", text: perUnit(best.price, best.unit) })) : null,
        row.order ? orderFacts_(row.order, fact) : null,
        transcript(m),
        sheetError ? errorLine(sheetError) : null,
      ];
      const foot = [
        a ? button({ word: t("b5.check"), icon: "check", kind: "primary", label: t("b5.yesNeeded"), onClick: () => { sheet.api.close(); document.dispatchEvent(new CustomEvent("sahay:open-needs")); } }) : null,
        row.order ? orderActions(row.order) : null,
        listenButton(m),
      ];
      return { title: needLine(req), speakKey: `need:${req.id}`, body, foot,
        key: JSON.stringify([langKey(), row.status, m.stations.map((s) => s.status), m.negotiation && m.negotiation.turns.length, m.negotiation && m.negotiation.endedAt, listen.status, a && a.id, row.order && row.order.status, sheetError, [...busy.arrived]]) };
    }
    if (row.kind === "order") {
      const o = row.order;
      return { title: o.poNumber || t("b5.order"), speakKey: `order:${o.id}`,
        body: [h("p", { class: "b5-sheet-row" }, statusEl(row.status)), orderFacts_(o, fact), sheetError ? errorLine(sheetError) : null],
        foot: [orderActions(o)], key: JSON.stringify([langKey(), o.status, o.paymentUrl, sheetError, [...busy.arrived]]) };
    }
    const need = row.need;
    const d = toDate(need.createdAt);
    return { title: needLine(need), speakKey: `need:${need.id}`,
      body: [h("p", { class: "b5-sheet-row" }, statusEl("earlier")), d ? fact("calendar", t("b5.told", { d: dateTime(d, { day: "numeric", month: "short" }) })) : null,
        h("p", { class: "b5-sheet-text", text: t("work.dismissWhy") }), sheetError ? errorLine(sheetError) : null],
      foot: [button({ word: t("b5.remove"), icon: "x", kind: "danger", busy: busy.remove, onClick: () => remove(need) })],
      key: JSON.stringify([langKey(), busy.remove, sheetError]) };
  }

  function orderFacts_(o, fact) {
    const f = orderFacts(state, o);
    const { next, sent } = remindersOf(state, o.id);
    const qty = f.quantity !== null ? `${amount(f.quantity)} ${unitWord(f.unit)}`.trim() : null;
    const shelf = orderShelf(o);
    return h("div", { class: "b5-order-facts" },
      h("p", { class: "figure num", text: rupees(o.amount) || "" }),
      f.vendor ? h("p", { class: "b5-sheet-row" }, icon("store", 20), scripted("span", f.vendor), f.simulated ? simChip() : null) : null,
      fact("box", [qty, f.item ? itemWords(f.item) : null].filter(Boolean).join(" ")),
      fact("tag", f.unitPrice !== null ? perUnit(f.unitPrice, f.unit) : null),
      fact("receipt", o.poNumber ? `${o.poNumber} · ${dateTime(toDate(o.createdAt))}` : null),
      fact(shelf === "toPay" ? "rupee" : shelf === "onTheWay" ? "truck" : "checkCircle",
        o.status === "delivered" || o.status === "closed" ? t("b3.delivered") : shelf === "toPay" ? t("b3.unpaid") : shelf === "onTheWay" ? `${t("b3.paid")} · ${t("b3.shelf.onTheWay")}` : null),
      next || sent ? fact("bell", `${t(next ? "b3.reminderNext" : "b3.reminderSent")}: ${dateTime(toDate(next ? next.dueAt : sent.firedAt))}`) : null,
      shelf === "toPay" && !o.paymentUrl ? h("p", { class: "note-line" }, icon("info", 18), h("span", { text: t("b3.noLink") })) : null);
  }

  function orderActions(o) {
    const shelf = orderShelf(o);
    const id = String(o.id);
    return h("div", { class: "b5-actions" },
      shelf === "toPay" && o.paymentUrl ? h("span", { class: "b5-pay" }, button({ word: t("b3.pay"), icon: "rupee", kind: "primary", href: safeUrl(o.paymentUrl) }), testChip()) : null,
      shelf !== "done" ? button({ word: t("b3.arrived"), icon: "truck", kind: shelf === "onTheWay" ? "primary" : "secondary", label: t("b3.arrivedLong"), busy: busy.arrived.has(id), onClick: () => arrived(id) }) : null,
      button({ word: t("b3.paper"), icon: "download", kind: "ghost", href: safeUrl(o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`), newTab: true }));
  }

  function openRow(row, opener) {
    sheetError = null;
    const p = sheetParts(row);
    sheet = { row, key: p.key, api: openSheet({ title: p.title, speakKey: p.speakKey, opener, body: p.body.filter(Boolean), footer: p.foot.filter(Boolean),
      onClose: () => { sheet = null; if (listen.status !== "idle") listener.stop(); } }) };
  }

  function refreshSheet(force = false) {
    if (!sheet || !sheet.api.isOpen()) return;
    // The row may have moved on (an order was made for the need): find it again by what it is.
    const rows = buyRows(state, state.requirement);
    const r = sheet.row;
    const now = rows.find((x) => (r.order && x.order && String(x.order.id) === String(r.order.id))
      || (r.need && x.need && String(x.need.id) === String(r.need.id))) || r;
    const p = sheetParts(now);
    if (!force && p.key === sheet.key) return;
    sheet.row = now; sheet.key = p.key;
    sheet.api.setBody(p.body.filter(Boolean));
    sheet.api.setFooter(p.foot.filter(Boolean));
  }

  /* ---------------------------------------------------------- orders -- */
  function rowView(row) {
    let title, vendor = null;
    if (row.kind === "order") {
      const f = orderFacts(state, row.order);
      const qty = f.quantity !== null ? `${amount(f.quantity)} ${unitWord(f.unit)}`.trim() : null;
      title = [qty, f.item ? itemWords(f.item) : null].filter(Boolean).join(" ") || row.order.poNumber || t("b5.order");
      vendor = f.vendor ? (f.simulated ? `${f.vendor} (${t("simulated")})` : f.vendor) : null;
    } else {
      title = needLine(row.need);
      const v = row.vendorId !== undefined && row.vendorId !== null ? state.vendors.get(String(row.vendorId)) : null;
      vendor = v ? (v.simulated ? `${v.name} (${t("simulated")})` : v.name) : null;
    }
    return {
      title,
      sub: [vendor, day(row.at)].filter(Boolean).join(", ") || undefined,
      end: [row.amount !== null ? h("span", { class: "amount num", text: rupees(row.amount) }) : null, statusEl(row.status)].filter(Boolean),
      onClick: (e) => openRow(row, e.currentTarget),
    };
  }

  function renderOrders() {
    const rows = state.boot === "ready" ? buyRows(state, state.requirement) : [];
    const key = JSON.stringify([langKey(), state.boot, rows.map((r) => [r.kind, r.status, r.amount, r.order && [r.order.id, r.order.status], r.need && r.need.id]), state.quotes.size, state.vendors.size]);
    patch(ordersBox, key, () => {
      if (state.boot !== "ready") return card({ title: t("b5.yourOrders"), body: skeleton("rows", 3) });
      if (!rows.length) return card({ title: t("b5.yourOrders"), body: h("p", { class: "b5-empty", text: t("b5.noOrders") }) });
      return card({ title: t("b5.yourOrders"), cls: "b5-orders", body: list(rows.map(rowView), { limit: 5, label: t("b5.yourOrders") }) });
    });
    refreshSheet();
  }

  /* ---------------------------------------------------------- render -- */
  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (!all && !["work", "approvals", "orders", "stream"].some((p) => parts.has(p))) return;
    patch(headBox, langKey(), () => pageHead({ title: t("nav.buy"), sentence: t("b5.sentence2"),
      action: { word: t("b5.ask"), icon: "mic", onClick: () => talkHere({ hint: "b3.hint" }) } }));
    if (all) needsBox.__key = null;
    renderNeeds();
    renderOrders();
  }

  return {
    el,
    update: (_s, parts) => render(parts),
    leave() { if (listen.status !== "idle") listener.stop(); if (sheet && sheet.api.isOpen()) sheet.api.close(); },
    destroy() { offNeeds(); },
  };
}
