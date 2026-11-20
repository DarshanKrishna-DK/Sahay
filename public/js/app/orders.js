// Purchase orders as receipts (UI v3, D2: every purchase order lives here, on Buy). Three shelves:
// To pay -> On the way -> Done (folded). A receipt: punch notches on its tear line, PO number and
// date, read-aloud (order:<id>), seller with the simulated-vendor pill, what and how much, the
// amount, a paid / not paid stamp (icon + word), the next reminder on a clock arc, and at most
// one primary + two secondary actions: Pay (test mode), Order paper (PO PDF), Arrived.
// Also exports the Telegram link control for My Sahay (D4 moved it out of Buy).

import { h, icon, patch, scripted, rupees, amount, svgEl, safeUrl, toDate } from "./dom.js";
import { t, when, unitWord } from "./i18n.js";
import * as api from "../api.js";
import { state } from "./store.js";
import { markDelivered } from "./store-sell.js";
import { speakButton } from "./speak.js";
import { orderShelves, orderFacts, remindersOf, clockFraction, isPaid } from "./buy-model.js";
import { btn, simPill, testPill, stateView, skel, errorWords, errLine, alignNotches } from "./buy-kit.js";

function clockArc(from, to) {
  const frac = clockFraction(from, to);
  const r = 20, c = 2 * Math.PI * r;
  const svg = svgEl("svg", { class: "b3-clock", viewBox: "0 0 48 48", width: 48, height: 48, "aria-hidden": "true", focusable: "false" });
  svg.append(
    svgEl("circle", { cx: 24, cy: 24, r, class: "b3-clock-track" }),
    svgEl("circle", { cx: 24, cy: 24, r, class: "b3-clock-fill", "stroke-dasharray": `${(frac * c).toFixed(1)} ${c.toFixed(1)}`, transform: "rotate(-90 24 24)" }),
    svgEl("path", { d: "M24 13v11l6 4", class: "b3-clock-hands" }));
  return svg;
}

function stamp(o, shelf) {
  if (o.status === "cancelled" || o.status === "rejected") return h("p", { class: "b3-stamp is-bad" }, icon("x", 20), h("span", { text: t("b3.cancelled") }));
  if (o.status === "delivered" || o.status === "closed") return h("p", { class: "b3-stamp is-ok" }, icon("checkCircle", 20), h("span", { text: t("b3.delivered") }));
  if (isPaid(o)) return h("p", { class: "b3-stamp is-ok" }, icon("check", 20), h("span", { text: t("b3.paid") }));
  return h("p", { class: `b3-stamp ${shelf === "toPay" ? "is-due" : ""}` }, icon("history", 20), h("span", { text: t("b3.unpaid") }));
}

function receipt(o, shelf, ui, onArrived) {
  const id = String(o.id);
  const u = ui.get(id) || {};
  const f = orderFacts(state, o);
  const { next, sent } = remindersOf(state, o.id);
  const pay = safeUrl(o.paymentUrl);
  const pdf = safeUrl(o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`);
  const created = toDate(o.createdAt);
  const qty = f.quantity !== null ? `${amount(f.quantity)}${f.unit ? ` ${unitWord(f.unit)}` : ""}` : null;
  const priceLine = f.unitPrice !== null && qty ? `${rupees(f.unitPrice)}${f.unit ? ` / ${unitWord(f.unit)}` : ""} × ${qty}` : null;
  const rem = next || sent;

  const actions = [];
  if (shelf === "toPay" && pay) actions.push(h("span", { class: "b3-pay" }, btn({ icon: "rupee", word: t("b3.pay"), tone: "lime", href: pay, external: true }), testPill()));
  if (pdf) actions.push(btn({ icon: "download", word: t("b3.paper"), href: pdf, external: true }));
  if (shelf !== "done" && !u.done) actions.push(btn({ icon: "truck", word: t("b3.arrived"), label: t("b3.arrivedLong"), busy: Boolean(u.busy), onClick: () => onArrived(id) }));

  return h("li", { class: `b3-rcpt is-${shelf}` },
    h("article", { class: `b3-paper paper ${isPaid(o) || shelf === "done" ? "paper-paid" : "paper-due"}`, "aria-label": o.poNumber || t("b3.orders") },
      h("header", { class: "card-head b3-rcpt-top" },
        h("span", { class: "b3-rcpt-ico", "aria-hidden": "true" }, icon("receipt", 22)),
        h("h4", { class: "card-title b3-rcpt-id" },
          h("span", { class: "b3-po", text: o.poNumber || t("b3.orders") }),
          created ? h("span", { class: "b3-rcpt-date", text: when(created, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }) : null),
        h("span", { class: "card-speak" }, speakButton(`order:${id}`))),
      h("span", { class: "perforation", "aria-hidden": "true" }),
      f.item ? h("p", { class: "b3-rcpt-what" }, scripted("span", f.item, { class: "b3-rcpt-item" }), qty ? h("span", { class: "b3-rcpt-qty", text: qty }) : null) : null,
      f.vendor ? h("p", { class: "b3-rcpt-from" }, icon("store", 18), scripted("span", f.vendor, { class: "b3-rcpt-vendor" }), f.simulated ? simPill() : null) : null,
      h("div", { class: "b3-rcpt-money" },
        h("p", { class: "b3-rcpt-amt", text: rupees(o.amount) || "" }),
        stamp(o, shelf)),
      priceLine ? h("p", { class: "b3-rcpt-rate", text: priceLine }) : null,
      rem ? h("div", { class: "b3-rcpt-rem" },
        next ? clockArc(o.createdAt, next.dueAt) : h("span", { class: "b3-rcpt-bell", "aria-hidden": "true" }, icon("bell", 22)),
        h("p", {},
          h("span", { class: "b3-rem-what", text: t(next ? "b3.reminderNext" : "b3.reminderSent") }),
          h("span", { class: "b3-rem-when", text: when(toDate(next ? next.dueAt : sent.firedAt)) }))) : null,
      shelf === "toPay" && !pay ? h("p", { class: "b3-rcpt-note" }, icon("info", 18), h("span", { text: t("b3.noLink") })) : null,
      u.error ? errLine(u.error) : null,
      u.done ? h("p", { class: "b3-rcpt-ok", role: "status" }, icon("checkCircle", 20), h("span", { text: t("b3.arrivedDone") })) : null,
      actions.length ? h("div", { class: "b3-rcpt-acts" }, ...actions) : null));
}

const SHELVES = [["toPay", "rupee", "b3.shelf.toPay"], ["onTheWay", "truck", "b3.shelf.onTheWay"], ["done", "checkCircle", "b3.shelf.done"]];

function skeleton() {
  return h("div", { class: "b3-rcpt-skel skel-card" }, skel("skel-line", "is-short"), skel("skel-line"), skel("skel-block", "is-amount"), skel("skel-block", "is-btn"));
}

export function createOrders() {
  const el = h("section", { class: "b3-orders", "aria-labelledby": "b3-orders-title" });
  const title = h("h2", { class: "section-title b3-sec-title", id: "b3-orders-title" });
  const body = h("div", { class: "b3-orders-body" });
  el.append(title, body);
  const ui = new Map(); // orderId -> { busy, error, done }
  let showDone = false;

  async function arrived(id) {
    ui.set(id, { busy: true });
    render(true);
    try {
      await markDelivered(id);
      ui.set(id, { done: true });
      setTimeout(() => { ui.delete(id); render(true); }, 2400);
    } catch (err) {
      ui.set(id, { error: errorWords(err) });
    }
    render(true);
  }

  function render(force = false) {
    title.replaceChildren(icon("receipt", 22), h("span", { text: t("b3.orders") }));
    if (force) body.__key = null;
    const sh = orderShelves(state.orders);
    const total = sh.toPay.length + sh.onTheWay.length + sh.done.length;
    const key = JSON.stringify([document.documentElement.lang, state.boot, [...state.orders.values()], [...state.followups.values()], state.quotes.size, state.vendors.size, [...ui.entries()]]);
    patch(body, key, () => {
      if (state.boot !== "ready") return stateView({ kind: "loading", title: t("b3.loading"), skeleton, compact: true });
      if (!total) return stateView({ kind: "empty", icon: "receipt", title: t("b3.orders.empty.title"), text: t("b3.orders.empty.text"), compact: true });
      return SHELVES.map(([k, ic, word]) => {
        const rows = sh[k];
        if (!rows.length) return null;
        const folded = k === "done" && !showDone;
        const list = h("ol", { class: "b3-rcpts" }, ...rows.map((o) => receipt(o, k, ui, arrived)));
        if (k === "done") {
          // Done orders stay folded until opened (a count shows how many); the fold keeps its state.
          const fold = h("details", { class: `b3-shelf is-${k} fold`, open: showDone ? true : undefined },
            h("summary", { class: "fold-head b3-shelf-head" }, icon(ic, 20), h("span", { text: t(word) }), h("span", { class: "fold-count", text: String(rows.length) })),
            list);
          fold.addEventListener("toggle", () => { showDone = fold.open; });
          return fold;
        }
        return h("section", { class: `b3-shelf is-${k}`, "aria-label": t(word) },
          h("h3", { class: "b3-shelf-head" }, icon(ic, 20), h("span", { text: t(word) }), h("span", { class: "b3-count", text: String(rows.length) })),
          list);
      });
    });
    alignNotches(body);
  }

  return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang") || parts.has("orders") || parts.has("work")) render(); } };
}

/* ----------------------------------------------------------- Telegram link -- */

/**
 * The Telegram updates control (D4: lives in My Sahay > Shop). States: not linked, opening,
 * popup blocked (a link to press), linked, not configured on this server.
 */
export function createTelegramLink() {
  const el = h("div", { class: "b3-tg" });
  const s = { busy: false, error: null, link: null, blocked: false };

  async function link() {
    let win = null;
    try { win = window.open("", "_blank"); } catch { win = null; }
    s.busy = true; s.error = null; render(true);
    try {
      const r = await api.telegramLinkCode();
      const url = r && typeof r.deepLink === "string" && /^https:\/\/t\.me\//.test(r.deepLink) ? r.deepLink : null;
      if (!url) throw Object.assign(new Error(t("orders.telegramOff")), { code: "TELEGRAM_NOT_CONFIGURED" });
      s.link = url;
      if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = url; s.blocked = false; } else s.blocked = true;
    } catch (err) {
      if (win && !win.closed) win.close();
      s.error = err && err.code === "TELEGRAM_NOT_CONFIGURED" ? t("orders.telegramOff") : (err && (err.say || err.message)) || t("orders.telegramOff");
    }
    s.busy = false;
    render(true);
  }

  function render(force) {
    if (force) el.__key = null;
    patch(el, JSON.stringify([state.telegramLinked, s, document.documentElement.lang]), () => {
      if (state.telegramLinked) return [h("p", { class: "b3-tg-on" }, icon("check", 20), h("span", { text: t("orders.telegramOn") }))];
      return [
        btn({ icon: "send", word: t("orders.telegram"), busy: s.busy, onClick: link }),
        s.link ? h("p", { class: "b3-tg-note" }, h("span", { text: t("orders.telegramPress") }),
          s.blocked ? btn({ icon: "external", word: t("orders.openTelegram"), tone: "lime", href: s.link, external: true, size: "sm" }) : null) : null,
        s.error ? errLine(s.error) : null,
      ];
    });
  }
  render(true);
  return { el, update: () => render(false) };
}
