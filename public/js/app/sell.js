// Sell: bills as receipts with punch notches and a status stamp (draft, your yes, billed, paid),
// the bill Yes card (big total, GST line, check / cross -> POST /api/invoices/:id/decision), PDF,
// pay page, WhatsApp share, and the customers list. Empty: "Tell Sahay who bought what".
// Data: store-sell.js (GET /api/sell + live invoice.* / customer.* / receipt.* events).

import { h, icon, patch, safeUrl, toDate } from "./dom.js";
import { t, when } from "./i18n.js";
import { state as appState } from "./store.js";
import { stateView } from "./empty.js";
import { yesNo, paper, perforation, pill } from "./ui.js";
import { sell, loadSell, decideInvoice, pendingInvoices, invoiceCustomer, itemOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { shopNeedCard, shopMissing } from "./shop-settings.js";
import { SHOP_CODES } from "./shop-facts.js";
import { ensureCss, money, qtyText, itemName, scriptedText, readButton, partState, agentAction, sectionHead, buttonError, ask, alignNotches, count } from "./sell-kit.js";

const STATUS_ICON = { draft: "doc", pending: "bell", issued: "receipt", part_paid: "rupee", paid: "checkCircle", cancelled: "ban" };

function customerName(inv) {
  const c = invoiceCustomer(inv);
  return (c && c.name) || st("sell.walkin");
}

function lineName(l) {
  const it = itemOf(l.itemId);
  return itemName(it || { name: l.name, nameNative: l.nameNative }) || l.name || "";
}

const statusOf = (inv) => (STATUS_ICON[inv.status] ? inv.status : "draft");

function stamp(status) {
  return h("span", { class: `sb-stamp sb-stamp-${status}` }, icon(STATUS_ICON[status], 20), h("span", { text: st(`sell.status.${status}`) }));
}

/** GST line: total tax, and how it splits (CGST + SGST inside the state, IGST across states). */
function gstLine(tot) {
  if (!tot || tot.tax === null || tot.tax === undefined) return null;
  if (!tot.tax) return h("p", { class: "sb-gst" }, h("span", { class: "sb-gst-word", text: st("sell.noGst") }));
  const split = tot.igst ? `IGST ${money(tot.igst)}` : (tot.cgst || tot.sgst) ? `CGST ${money(tot.cgst)} + SGST ${money(tot.sgst)}` : null;
  return h("p", { class: "sb-gst" },
    h("span", { class: "sb-gst-word", text: st("sell.gst") }),
    h("span", { class: "sb-gst-num", text: money(tot.tax) }),
    split ? h("span", { class: "sb-gst-split", text: split }) : null);
}

const hasPrice = (l) => l.unitPrice !== null && l.unitPrice !== undefined;

function linesList(inv, max = 3) {
  const lines = inv.lines || [];
  if (!lines.length) return null;
  return h("ul", { class: "sb-lines" },
    ...lines.slice(0, max).map((l) => h("li", { class: "sb-line" },
      scriptedText("span", lineName(l), { class: "sb-line-name" }),
      h("span", { class: "sb-line-qty" },
        h("span", { text: qtyText(l.qty, l.unit) }),
        hasPrice(l) ? h("span", { class: "sb-x", "aria-hidden": "true", text: "×" }) : null,
        hasPrice(l) ? h("span", { text: money(l.unitPrice) }) : null))),
    lines.length > max ? h("li", { class: "sb-line sb-line-more", text: st("sell.more", { n: lines.length - max }) }) : null);
}

/* ------------------------------------------------------------- yes card -- */

function yesCard(inv, ui, onDecide) {
  const id = String(inv.id);
  const u = ui.get(id) || {};
  const tot = inv.totals || {};
  const name = customerName(inv);
  const titleId = `sb-yes-${id}`;
  return paper({ tag: "section", tone: "pending", class: "sb-yes", role: "region", "aria-labelledby": titleId, dataset: { id } },
    h("div", { class: "sb-yes-head" },
      h("span", { class: "sb-pulse", "aria-hidden": "true" }, icon("bell", 22)),
      h("h2", { class: "sb-yes-title", id: titleId, tabindex: "-1", text: st("inv.yes.title") }),
      readButton(`invoice:${id}`)),
    h("p", { class: "sb-who" },
      h("span", { class: "sb-who-ico", "aria-hidden": "true" }, icon("user", 22)),
      scriptedText("span", name, { class: "sb-who-name" }),
      inv.simulated ? pill(t("simulated"), "robot", "sim") : null),
    linesList(inv, 4),
    perforation(),
    h("div", { class: "sb-sum" },
      gstLine(tot),
      h("p", { class: "sb-total" },
        h("span", { class: "sb-total-word", text: st("sell.total") }),
        h("span", { class: "sb-total-num", text: money(tot.total) }))),
    inv.readback ? scriptedText("p", inv.readback, { class: "sb-readback" }) : null,
    u.fix ? shopNeedCard(u.fix, u.error)
      : u.error ? h("p", { class: "sb-error", role: "alert" }, icon("alert", 20), h("span", { text: u.error })) : null,
    yesNo({
      busy: u.busy || null,
      yesWord: st("inv.yes.approve"), noWord: st("inv.yes.reject"),
      yesLabel: st("inv.yes.approveLong"), noLabel: st("inv.yes.rejectLong"),
      onYes: () => onDecide(id, "approve"), onNo: () => onDecide(id, "reject"),
    }),
    u.busy ? h("p", { class: "sr-only", role: "status", text: st("inv.yes.saving") }) : null);
}

/* ------------------------------------------------------------ the bills -- */

function linkAction({ href, ic, word, long, primary }) {
  const url = safeUrl(href);
  if (!url) return null;
  return h("a", { class: `btn ${primary ? "btn-primary" : "btn-ghost"} sb-act`, href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": long, dataset: { tip: long } },
    icon(ic, 22), h("span", { text: word }));
}

function bill(inv) {
  const status = statusOf(inv);
  const tot = inv.totals || {};
  const name = customerName(inv);
  const made = toDate(inv.issuedAt || inv.createdAt);
  const done = status === "issued" || status === "part_paid" || status === "paid";
  const unpaid = status === "issued" || status === "part_paid";
  const lines = inv.lines || [];
  const acts = [
    done ? linkAction({ href: inv.pdfUrl || `/api/invoices/${encodeURIComponent(inv.id)}/pdf`, ic: "download", word: st("sell.pdf"), long: st("sell.pdfLong") }) : null,
    unpaid ? linkAction({ href: inv.payUrl, ic: "rupee", word: st("sell.pay"), long: st("sell.payLong") }) : null,
    unpaid ? linkAction({ href: inv.shareUrl, ic: "share", word: st("sell.share"), long: st("sell.shareLong"), primary: true }) : null,
  ].filter(Boolean);
  return h("li", {},
    paper({ class: `sb-bill sb-bill-${status}`, tone: status === "paid" ? "paid" : status === "pending" ? "pending" : unpaid ? "due" : null },
      h("div", { class: "sb-bill-top" },
        h("span", { class: "sb-bill-ico", "aria-hidden": "true" }, icon("receipt", 22)),
        h("span", { class: "sb-bill-id" },
          inv.number ? h("span", { class: "sb-bill-no", text: inv.number }) : null,
          made ? h("span", { class: "sb-bill-date", text: when(made, { day: "numeric", month: "short" }) }) : null),
        readButton(`invoice:${inv.id}`)),
      perforation(),
      h("div", { class: "sb-bill-row" },
        h("div", { class: "sb-bill-who" },
          scriptedText("p", name, { class: "sb-bill-name" }),
          lines.length === 1
            ? h("p", { class: "sb-bill-what" }, scriptedText("span", lineName(lines[0])), h("span", { text: ` ${qtyText(lines[0].qty, lines[0].unit)}` }))
            : lines.length > 1 ? h("p", { class: "sb-bill-what", text: count("sell.items", lines.length) }) : null),
        stamp(status)),
      h("p", { class: "sb-bill-total", text: money(tot.total) }),
      tot.tax ? h("p", { class: "sb-bill-gst", text: `${st("sell.gst")} ${money(tot.tax)}` }) : null,
      acts.length ? h("div", { class: "sb-bill-acts" }, ...acts) : null));
}

/* ------------------------------------------------------------ customers -- */

function initial(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  try { return [...new Intl.Segmenter().segment(text)][0].segment; } catch { return text.slice(0, 1); }
}

function customersList(owedBy) {
  const list = [...sell.customers.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  if (!list.length) return h("p", { class: "sb-quiet", text: st("sell.noCustomers") });
  const counts = new Map();
  for (const inv of sell.invoices.values()) if (inv.customerId) counts.set(inv.customerId, (counts.get(inv.customerId) || 0) + 1);
  return h("ul", { class: "sb-people" }, ...list.map((c) => {
    const owes = owedBy.get(c.id);
    return h("li", { class: "sb-person" },
      scriptedText("span", initial(c.name), { class: "sb-avatar", "aria-hidden": "true" }),
      h("span", { class: "sb-person-main" },
        scriptedText("span", c.name || "", { class: "sb-person-name" }),
        h("span", { class: "sb-person-meta" },
          c.phone ? h("span", { class: "sb-phone" }, icon("phone", 16), h("span", { text: c.phone })) : null,
          counts.get(c.id) ? h("span", { text: count("sell.billsCount", counts.get(c.id)) }) : null)),
      owes ? h("span", { class: "sb-person-owes" }, icon("rupee", 16), h("span", { text: st("sell.owes", { amt: money(owes) }) })) : null);
  }));
}

/* --------------------------------------------------------------- screen -- */

export function createSell() {
  ensureCss();
  const el = h("section", { class: "sell sb-screen", "aria-labelledby": "sell-title" });
  const title = h("h1", { class: "screen-title", id: "sell-title" });
  const topAct = h("div", { class: "sb-top-act" });
  const body = h("div", { class: "sb-body" });
  el.append(h("header", { class: "sb-top" }, title, topAct), body);
  const ui = new Map(); // invoiceId -> { busy: "yes" | "no", error }

  async function decide(id, decision) {
    ui.set(id, { busy: decision === "approve" ? "yes" : "no" });
    render(true);
    try {
      await decideInvoice(id, decision);
      ui.delete(id);
    } catch (err) {
      // A bill refused for missing shop details (no GSTIN / no state) opens the Shop details sheet.
      if (SHOP_CODES.includes(err.code)) ui.set(id, { error: err.say || st(`shop.need.${err.code}`), fix: err.code, shop: JSON.stringify(sell.settings) });
      else ui.set(id, { error: err.status === 409 ? st("sbx.err.gone") : `${st("inv.yes.error")} ${buttonError(err)}`.trim() });
    }
    render(true);
  }

  function render(force = false) {
    title.textContent = t("nav.sell");
    const s = partState(sell, { which: "sell", reload: () => loadSell() });
    const invoices = [...sell.invoices.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const empty = sell.status === "ready" && !invoices.length && !sell.customers.size;
    patch(topAct, JSON.stringify([document.documentElement.lang, empty, sell.status]), () =>
      (empty || sell.status !== "ready" ? [] : [agentAction({ word: st("sell.act"), hint: "sell.hint" })]));
    if (force) body.__key = null;
    const need = shopMissing();
    // Once the shop details change (saved from the sheet), a bill's "add shop details" note goes.
    for (const [id, u] of ui) if (u.fix && u.shop !== JSON.stringify(sell.settings)) ui.delete(id);
    const key = JSON.stringify([document.documentElement.lang, sell.status, need, invoices, [...sell.customers.values()], sell.owed, [...ui.entries()], [...sell.receipts.map((r) => r.id)]]);
    patch(body, key, () => {
      if (s) return s;
      if (empty) {
        return [need ? shopNeedCard(need) : null, stateView({ kind: "empty", icon: "receipt", title: st("sell.empty.title"), text: st("sell.empty.text"),
          action: { label: st("sell.act"), icon: "mic", run: () => ask({ hint: "sell.hint" }) } })];
      }
      const pending = pendingInvoices();
      const others = invoices.filter((i) => i.status !== "pending");
      const owedBy = new Map(sell.owed.map((o) => [o.customerId, o.amount]));
      const names = [...sell.customers.values()].map((c) => c.name).filter(Boolean);
      return [
        need ? shopNeedCard(need) : null,
        pending.length ? h("div", { class: "sb-yes-stack" },
          pending.length > 1 ? h("p", { class: "sb-waiting", role: "status" }, icon("bell", 20), h("span", { text: st("inv.yes.waiting", { n: pending.length }) })) : null,
          ...pending.map((inv) => yesCard(inv, ui, decide))) : null,
        h("div", { class: "sb-cols" },
          h("section", { class: "sb-bills", "aria-labelledby": "sb-bills-h" },
            sectionHead("sb-bills-h", "receipt", st("sell.bills"), others.length || null),
            others.length ? h("ol", { class: "sb-receipts" }, ...others.map(bill)) : h("p", { class: "sb-quiet", text: st("sell.empty.text") })),
          h("section", { class: "sb-customers", "aria-labelledby": "sb-cust-h" },
            h("div", { class: "sb-head-row" },
              sectionHead("sb-cust-h", "users", st("sell.customers"), sell.customers.size || null),
              names.length ? readButton("customers") : null),
            customersList(owedBy))),
      ];
    });
    alignNotches(body);
  }

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && appState.boot === "ready") loadSell();
      if (parts.has("all") || parts.has("lang") || parts.has("sell") || parts.has("stock")) render(parts.has("lang"));
    },
    enter: () => { if (sell.status === "idle" || sell.status === "error" || sell.status === "missing") loadSell(); },
  };
}
