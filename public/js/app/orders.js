// Orders (UI v4, Stitch 05-buy-laptop; D2: every purchase order lives here, on Buy). One card:
// title, one line, tabs To pay / On the way / Done with counts, then the orders of that tab. An
// order: status (dot + word), read-aloud (order:<id>), seller with the simulated-vendor pill, what
// and how much, total and rate, PO number and date, the next reminder, and at most one primary +
// two secondary actions: Pay (test mode), Arrived, Order paper (PO PDF).
// Also exports the Telegram link control for My Sahay (D4 moved it out of Buy).

import { h, icon, patch, scripted, rupees, amount, safeUrl, toDate } from "./dom.js";
import { t, unitWord } from "./i18n.js";
import * as api from "../api.js";
import { state } from "./store.js";
import { markDelivered } from "./store-sell.js";
import { speakButton } from "./speak.js";
import { orderShelves, orderShelf, orderFacts, remindersOf } from "./buy-model.js";
import { btn, simPill, testPill, stateView, skel, errorWords, errLine, dateTime, itemWords } from "./buy-kit.js";

const DOT = { toPay: "is-due", onTheWay: "is-way", done: "is-ok" };
const SHELF_WORD = { toPay: "b3.shelf.toPay", onTheWay: "b3.shelf.onTheWay", done: "b3.shelf.done" };

/** The order's status: a dot and the word (the word always says it, never the colour alone). */
function statusOf(o, shelf) {
  if (o.status === "cancelled" || o.status === "rejected") return h("p", { class: "b4-ord-status is-bad" }, icon("x", 16), h("span", { text: t("b3.cancelled") }));
  if (o.status === "delivered" || o.status === "closed") return h("p", { class: "b4-ord-status is-ok" }, icon("checkCircle", 16), h("span", { text: t("b3.delivered") }));
  return h("p", { class: `b4-ord-status ${DOT[shelf]}` }, h("span", { class: "b4-dot", "aria-hidden": "true" }),
    h("span", { text: shelf === "toPay" ? t("b3.shelf.toPay") : `${t("b3.shelf.onTheWay")} · ${t("b3.paid")}` }));
}

function orderCard(o, shelf, ui, onArrived) {
  const id = String(o.id);
  const u = ui.get(id) || {};
  const f = orderFacts(state, o);
  const { next, sent } = remindersOf(state, o.id);
  const pay = safeUrl(o.paymentUrl);
  const pdf = safeUrl(o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`);
  const created = toDate(o.createdAt);
  const qty = f.quantity !== null ? `${amount(f.quantity)}${f.unit ? ` ${unitWord(f.unit)}` : ""}` : null;
  const what = [qty, f.item ? itemWords(f.item) : null].filter(Boolean).join(" ");
  const rate = f.unitPrice !== null ? `${rupees(f.unitPrice)}${f.unit ? ` / ${unitWord(f.unit)}` : ""}` : null;
  const rem = next || sent;

  const actions = [];
  if (shelf === "toPay" && pay) actions.push(h("span", { class: "b4-pay" }, btn({ icon: "rupee", word: t("b3.pay"), tone: "lime", href: pay, external: true }), testPill()));
  if (shelf !== "done" && !u.done) actions.push(btn({ icon: "truck", word: t("b3.arrived"), label: t("b3.arrivedLong"), busy: Boolean(u.busy), onClick: () => onArrived(id) }));
  if (pdf) actions.push(btn({ icon: "download", word: t("b3.paper"), href: pdf, external: true, tone: "ghost" }));

  return h("li", { class: `b4-ord is-${shelf}` },
    h("article", { class: "b4-ord-card", "aria-label": o.poNumber || t("b3.orders") },
      h("header", { class: "b4-ord-top" },
        statusOf(o, shelf),
        h("span", { class: "card-speak" }, speakButton(`order:${id}`))),
      f.vendor ? h("h3", { class: "b4-ord-vendor" }, scripted("span", f.vendor), f.simulated ? simPill() : null) : null,
      what ? scripted("p", what, { class: "b4-ord-what" }) : null,
      h("div", { class: "b4-ord-money" },
        h("p", { class: "b4-ord-total" },
          h("span", { class: "b4-ord-label", text: t("b4.total") }),
          h("span", { class: "b4-ord-amt t-money", text: rupees(o.amount) || "" })),
        rate ? h("p", { class: "b4-ord-rate", text: rate }) : null),
      h("p", { class: "b4-ord-meta" },
        o.poNumber ? h("span", { class: "b4-po", text: o.poNumber }) : null,
        created ? h("span", { text: dateTime(created) }) : null),
      rem ? h("p", { class: "b4-ord-rem" }, icon(next ? "clock" : "bell", 18),
        h("span", { text: `${t(next ? "b3.reminderNext" : "b3.reminderSent")}: ${dateTime(toDate(next ? next.dueAt : sent.firedAt))}` })) : null,
      shelf === "toPay" && !pay ? h("p", { class: "b4-ord-note" }, icon("info", 18), h("span", { text: t("b3.noLink") })) : null,
      u.error ? errLine(u.error) : null,
      u.done ? h("p", { class: "b4-ord-ok", role: "status" }, icon("checkCircle", 20), h("span", { text: t("b3.arrivedDone") })) : null,
      actions.length ? h("div", { class: "b4-ord-acts" }, ...actions) : null));
}

const SHELVES = ["toPay", "onTheWay", "done"];

function skeleton() {
  return h("div", { class: "b4-ord-skel" }, skel("skel-line", "is-short"), skel("skel-line"), skel("skel-block", "is-amount"), skel("skel-block", "is-btn"));
}

export function createOrders() {
  const el = h("section", { class: "b4-orders card", "aria-labelledby": "b4-orders-title" });
  const head = h("header", { class: "b4-orders-head" });
  const body = h("div", { class: "b4-orders-body" });
  el.append(head, body);
  const ui = new Map(); // orderId -> { busy, error, done }
  let tab = null;       // the tab the owner picked; null = the first one that has orders

  async function arrived(id) {
    const o = state.orders.get(id);
    const from = o ? orderShelf(o) : null;
    ui.set(id, { busy: true });
    render(true);
    try {
      await markDelivered(id);
      ui.set(id, { done: true, from });
      setTimeout(() => { ui.delete(id); render(true); }, 2400);
    } catch (err) {
      ui.set(id, { error: errorWords(err) });
    }
    render(true);
  }

  function render(force = false) {
    if (force) { body.__key = null; head.__key = null; }
    const sh = orderShelves(state.orders);
    // An order that just arrived stays on the tab it was on for a moment, showing "Added to stock".
    for (const [id, u] of ui) {
      if (!u.done || !u.from || u.from === "done") continue;
      const at = sh.done.findIndex((o) => String(o.id) === id);
      if (at !== -1) sh[u.from].unshift(...sh.done.splice(at, 1));
    }
    const total = sh.toPay.length + sh.onTheWay.length + sh.done.length;
    const shown = tab && sh[tab] ? tab : SHELVES.find((k) => sh[k].length) || "toPay";
    patch(head, JSON.stringify([document.documentElement.lang, total ? SHELVES.map((k) => sh[k].length) : null, shown]), () => [
      h("div", { class: "b4-orders-titles" },
        h("h2", { class: "b4-card-title t-h3", id: "b4-orders-title", text: t("b3.orders") }),
        h("p", { class: "b4-card-sub", text: t("b4.orders.sub") })),
      total ? h("div", { class: "seg b4-tabs", role: "group", "aria-label": t("b3.orders") },
        ...SHELVES.map((k) => h("button", {
          class: "seg-opt", type: "button", "aria-pressed": String(k === shown),
          on: { click: () => { tab = k; render(true); } },
        }, h("span", { text: `${t(SHELF_WORD[k])} (${sh[k].length})` })))) : null,
    ]);
    const key = JSON.stringify([document.documentElement.lang, state.boot, shown, [...state.orders.values()], [...state.followups.values()], state.quotes.size, state.vendors.size, [...ui.entries()]]);
    patch(body, key, () => {
      if (state.boot !== "ready") return stateView({ kind: "loading", title: t("b3.loading"), skeleton, compact: true });
      if (!total) return stateView({ kind: "empty", icon: "receipt", title: t("b3.orders.empty.title"), text: t("b3.orders.empty.text"), compact: true });
      const rows = sh[shown];
      if (!rows.length) return h("p", { class: "b4-quiet" }, icon("receipt", 20), h("span", { text: t("b3.orders.empty.title") }));
      return h("ol", { class: "b4-ords" }, ...rows.map((o) => orderCard(o, shown, ui, arrived)));
    });
  }

  return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang") || parts.has("orders") || parts.has("work")) render(); } };
}

/* ----------------------------------------------------------- Telegram link -- */

/**
 * The Telegram updates control (D4: lives in My Sahay > Shop). States: not linked, opening,
 * popup blocked (a link to press), linked, not configured on this server.
 */
export function createTelegramLink() {
  const el = h("div", { class: "b4-tg" });
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
      if (state.telegramLinked) return [h("p", { class: "b4-tg-on" }, icon("check", 20), h("span", { text: t("orders.telegramOn") }))];
      return [
        btn({ icon: "send", word: t("orders.telegram"), busy: s.busy, onClick: link }),
        s.link ? h("p", { class: "b4-tg-note" }, h("span", { text: t("orders.telegramPress") }),
          s.blocked ? btn({ icon: "external", word: t("orders.openTelegram"), tone: "lime", href: s.link, external: true, size: "sm" }) : null) : null,
        s.error ? errLine(s.error) : null,
      ];
    });
  }
  render(true);
  return { el, update: () => render(false) };
}
