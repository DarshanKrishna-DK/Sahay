// Orders as receipts: amount, seller, paid / not paid (icon + word), the order paper (PO PDF),
// Pay (our /pay page), the next reminder on a clock arc, read-aloud per order, and Telegram updates.

import { h, icon, patch, scripted, rupees, svgEl, safeUrl, toDate } from "./dom.js";
import { t, when } from "./i18n.js";
import * as api from "../api.js";
import { state } from "./store.js";
import { speakButton } from "./speak.js";

const PAID = ["paid", "in_transit", "delivered", "closed"];

function clockArc(createdAt, dueAt) {
  const a = toDate(createdAt), b = toDate(dueAt);
  let frac = 0;
  if (a && b && b > a) frac = Math.min(1, Math.max(0, (Date.now() - a) / (b - a)));
  const r = 22, c = 2 * Math.PI * r;
  const svg = svgEl("svg", { class: "clock-arc", viewBox: "0 0 56 56", width: 56, height: 56, "aria-hidden": "true" });
  svg.append(
    svgEl("circle", { cx: 28, cy: 28, r, class: "clock-track" }),
    svgEl("circle", { cx: 28, cy: 28, r, class: "clock-fill", "stroke-dasharray": `${(frac * c).toFixed(1)} ${c.toFixed(1)}`, transform: "rotate(-90 28 28)" }),
    svgEl("path", { d: "M28 16v12l7 5", class: "clock-hands" }));
  return svg;
}

function receipt(o) {
  const q = o.quoteId !== undefined ? state.quotes.get(String(o.quoteId)) : null;
  const vendor = o.vendorName || (q && q.vendorName) || null;
  const simulated = Boolean(o.simulated || (q && q.simulated));
  const paid = PAID.includes(o.status);
  const follow = [...state.followups.values()].filter((f) => String(f.orderId) === String(o.id));
  const next = follow.filter((f) => f.status === "scheduled").sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0];
  const fired = follow.filter((f) => f.status === "fired").sort((a, b) => String(b.firedAt || "").localeCompare(String(a.firedAt || "")))[0];
  const pay = safeUrl(o.paymentUrl);
  const pdf = safeUrl(o.pdfUrl || `/api/orders/${encodeURIComponent(o.id)}/po.pdf`);
  const statusKey = `orders.status.${o.status}`;
  const created = toDate(o.createdAt);
  return h("li", { class: `receipt${paid ? " is-paid" : ""}` },
    h("div", { class: "rc-top" },
      h("span", { class: "rc-ico", "aria-hidden": "true" }, icon("receipt", 24)),
      h("div", { class: "rc-id" },
        o.poNumber ? h("span", { class: "rc-po", text: o.poNumber }) : null,
        created ? h("span", { class: "rc-date", text: when(created, { day: "numeric", month: "short" }) }) : null),
      speakButton(`order:${o.id}`, { size: "sm" })),
    vendor ? h("p", { class: "rc-vendor" }, icon("store", 20), scripted("span", vendor), simulated ? h("span", { class: "sim-pill" }, h("span", { text: t("simulated") })) : null) : null,
    h("p", { class: "rc-amount", text: rupees(o.amount) || "" }),
    h("p", { class: `rc-status ${paid ? "ok" : "due"}` },
      icon(paid ? "check" : "rupee", 22),
      h("span", { text: paid ? t("orders.paid") : t("orders.unpaid") }),
      t(statusKey) !== statusKey && !paid && o.status !== "confirmed" ? h("span", { class: "rc-sub", text: t(statusKey) }) : null),
    next || fired ? h("div", { class: "rc-remind" },
      next ? clockArc(o.createdAt, next.dueAt) : h("span", { class: "rc-bell", "aria-hidden": "true" }, icon("bell", 22)),
      h("div", {},
        h("p", { class: "rc-remind-what", text: `${next ? t("orders.next") : t("orders.sent")}: ${t(`orders.rem.${(next || fired).kind}`)}` }),
        h("p", { class: "rc-remind-when", text: when(toDate(next ? next.dueAt : fired.firedAt)) }))) : null,
    h("div", { class: "rc-actions" },
      pdf ? h("a", { class: "btn btn-ghost", href: pdf, target: "_blank", rel: "noopener" }, icon("download", 22), h("span", { text: t("orders.paper") })) : null,
      !paid && pay ? h("a", { class: "btn btn-primary", href: pay, target: "_blank", rel: "noopener noreferrer" }, icon("rupee", 22), h("span", { text: t("orders.pay") })) : null,
      !paid && !pay ? h("span", { class: "rc-nolink", text: t("orders.noLink") }) : null));
}

export function createOrders() {
  const el = h("section", { class: "orders", "aria-labelledby": "orders-title" });
  const title = h("h2", { class: "section-title", id: "orders-title" });
  const list = h("div", { class: "orders-body" });
  const tg = h("div", { class: "telegram" });
  el.append(title, list, tg);
  const tgs = { busy: false, error: null, link: null, blocked: false };

  async function linkTelegram() {
    let win = null;
    try { win = window.open("", "_blank"); } catch { win = null; }
    tgs.busy = true; tgs.error = null; renderTg(true);
    try {
      const r = await api.telegramLinkCode();
      const url = r && typeof r.deepLink === "string" && /^https:\/\/t\.me\//.test(r.deepLink) ? r.deepLink : null;
      if (!url) throw new Error(t("orders.telegramOff"));
      tgs.link = url;
      if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = url; tgs.blocked = false; } else tgs.blocked = true;
    } catch (err) {
      if (win && !win.closed) win.close();
      tgs.error = err && err.code === "TELEGRAM_NOT_CONFIGURED" ? t("orders.telegramOff") : (err && (err.say || err.message)) || t("orders.telegramOff");
    }
    tgs.busy = false;
    renderTg(true);
  }

  function renderTg(force) {
    const key = JSON.stringify([state.telegramLinked, tgs, document.documentElement.lang]);
    if (force) tg.__key = null;
    patch(tg, key, () => {
      if (state.telegramLinked) return [h("p", { class: "tg-on" }, icon("check", 22), h("span", { text: t("orders.telegramOn") }))];
      return [
        h("button", { class: "btn btn-ghost", type: "button", disabled: tgs.busy ? true : undefined, on: { click: linkTelegram } },
          tgs.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("send", 22), h("span", { text: t("orders.telegram") })),
        tgs.link ? h("p", { class: "tg-note" }, h("span", { text: t("orders.telegramPress") }),
          tgs.blocked ? h("a", { class: "btn btn-primary btn-sm", href: tgs.link, target: "_blank", rel: "noopener noreferrer" }, h("span", { text: t("orders.openTelegram") })) : null) : null,
        tgs.error ? h("p", { class: "tg-err", role: "alert" }, icon("alert", 20), h("span", { text: tgs.error })) : null,
      ];
    });
  }

  function render(parts) {
    if (!parts.has("all") && !parts.has("lang") && !parts.has("orders") && !parts.has("work")) return;
    title.textContent = t("orders.title");
    const orders = [...state.orders.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const key = JSON.stringify([document.documentElement.lang, orders, [...state.followups.values()], state.quotes.size]);
    // Inside Buy the need's empty state already offers "Talk to Sahay": with no orders this
    // section stays out of the way instead of showing a second empty view.
    el.hidden = orders.length === 0;
    patch(list, key, () => orders.length ? h("ol", { class: "receipts" }, ...orders.map(receipt)) : []);
    tg.hidden = !orders.length && !state.telegramLinked;
    renderTg(false);
  }

  return { el, update: (_s, parts) => render(parts) };
}

