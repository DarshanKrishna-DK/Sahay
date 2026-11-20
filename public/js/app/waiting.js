// "Waiting for your yes" (UX v3 D6-D9, spec 3.1 rows 46-47, 6.3): ONE tray and ONE Yes card for
// every owner decision: purchase approval, bill, reorder proposal, suggested rule.
//
//   waitingItems()                      every card the tray holds now (pending, saving, settled)
//   renderCard(item, { place })         the only Yes card renderer: "tray" | "inline" | "sheet" | "column";
//                                       the element stays live (it follows SSE) until it leaves the page
//   openTray(key?)                      open the tray (phone/tablet sheet, 1024-1279 drawer, 1280+ column)
//   onCount(fn) -> unsubscribe          decisions that still need the owner (the badge), now and on change
//   typedYesHint(text) -> el | null     composer note when a typed "haan" meets a waiting card (rule 3)
//   attachShell(shell)                  W1's shell API (slots, onLayout, setBadge); found by itself too
//
// The state lives in waiting-model.js (pure, tested). Sources are the existing stores, no new wire
// fields: pendingApprovals()/approvalView() (store.js), pendingInvoices() (store-sell.js),
// stock.proposals (store-sell.js), state.agent.rules with status "suggested" (store.js). The D7
// "spoken" events and the D8 outcome events come through store.onEvent. Buttons post to the same
// routes as before: /api/approvals/:id/decision, /api/invoices/:id/decision,
// /api/stock/reorders/:id/decision, /api/agent/rules/:id/decision.

import { h, icon, rupees, scripted, safeUrl, fill, reducedMotion } from "./dom.js";
import { t, unitWord, cityWord, addStrings, lang } from "./i18n.js";
import * as api from "../api.js";
import { state, subscribe, onEvent, pendingApprovals, approvalView, decideRule } from "./store.js";
import { sell, stock, pendingInvoices, decideInvoice, decideReorder, invoiceCustomer, itemOf, loadSell, loadStock } from "./store-sell.js";
import { speakButton } from "./speak.js";
import { openSheet } from "./sheet.js";
import { keycapButton, pill } from "./ui.js";
import { stateView } from "./empty.js";
import { openShopSheet, shopMissing } from "./shop-settings.js";
import { money, qtyText, itemName } from "./sell-kit.js";
import { createWaitingModel, placeFor, parseKey, speakKeyOf, isTypedYes, AREA } from "./waiting-model.js";
import { WT_STRINGS } from "./waiting-strings.js";

addStrings(WT_STRINGS);

const model = createWaitingModel();
const KIND_ICON = { buy: "cart", bill: "receipt", reorder: "jar", rule: "spark" };
const AREA_HASH = { buy: "#/buy", sell: "#/sell", stock: "#/stock", me: "#/me/teach" };
const LANG_CODE = { hi: "hi-IN", kn: "kn-IN", en: "en-IN" };
const reorderQuestion = new Map(); // proposalId -> { "hi-IN": ..., ... } from stock.reorder_proposed (live)

/* ------------------------------------------------------------ stylesheet -- */

function ensureCss() {
  if (typeof document === "undefined" || document.querySelector('link[href="/css/app-waiting.css"]')) return;
  document.head.append(h("link", { rel: "stylesheet", href: "/css/app-waiting.css" }));
}

/* ---------------------------------------------------------------- sources -- */

const has = (v) => v !== null && v !== undefined && v !== "";

/** Every pending decision from the stores, as model items carrying what their card shows. */
function collect() {
  const items = [];
  for (const a of pendingApprovals()) {
    items.push({ key: `approval:${a.id}`, kind: "buy", id: String(a.id), createdAt: a.requestedAt || null, view: approvalView(a) });
  }
  for (const inv of pendingInvoices()) {
    items.push({ key: `invoice:${inv.id}`, kind: "bill", id: String(inv.id), createdAt: inv.createdAt || null, invoiceId: String(inv.id) });
  }
  for (const [itemId, p] of stock.proposals) {
    const id = p && p.id ? String(p.id) : `item-${itemId}`;
    items.push({ key: `reorder:${id}`, kind: "reorder", id, createdAt: p.at || null, itemId: String(itemId), proposal: p, voiceOnly: !(p && p.id) });
  }
  const A = state.agent;
  if (A && A.rules) {
    for (const r of A.rules.values()) {
      if (r && r.status === "suggested") items.push({ key: `rule:${r.id}`, kind: "rule", id: String(r.id), createdAt: r.created_at || null, rule: r });
    }
  }
  return items;
}

/** Which sources are still loading / failed (a 404 "missing" source is simply not on this server). */
function sourceStatus() {
  const loading = state.boot !== "ready" || [sell.status, stock.status].some((s) => s === "loading" || s === "idle") || (state.agent && state.agent.status === "loading");
  const failed = [];
  if (sell.status === "error") failed.push({ err: sell.error, retry: () => loadSell() });
  if (stock.status === "error") failed.push({ err: stock.error, retry: () => loadStock() });
  return { loading, failed };
}

/* ------------------------------------------------------------- decisions -- */

async function decide(key, yes) {
  const c = model.card(key);
  const word = model.tap(key, yes);
  if (!word) return;
  renderAll();
  const p = parseKey(key);
  try {
    if (p.kind === "buy") await api.decideApproval(p.id, word);
    else if (p.kind === "bill") await decideInvoice(p.id, word);
    else if (p.kind === "reorder") await decideReorder(c.data.itemId, word);
    else if (p.kind === "rule") await decideRule(p.id, word);
  } catch (err) {
    model.tapFailed(key, { status: err && err.status, code: err && err.code, say: err && err.say });
  }
  ensureTimer();
  renderAll();
}

/* ---------------------------------------------------------------- pieces -- */

let seq = 0;
const domId = (prefix, key) => `${prefix}-${++seq}-${String(key).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

function linkKey({ href, ic, word, long, primary = false, external = true }) {
  const url = external ? safeUrl(href) : href;
  if (!url) return null;
  return h("a", {
    class: `keycap keycap-md ${primary ? "keycap-primary" : "keycap-secondary"} yc-link`, href: url,
    target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined,
    "aria-label": long && long !== word ? long : undefined,
  }, icon(ic, 22), h("span", { text: word }));
}

function closeButton(key) {
  const word = t("wt.close");
  return h("button", { class: "icon-btn yc-close", type: "button", "aria-label": word, dataset: { tip: word }, on: { click: () => { model.dismiss(key); renderAll(); } } }, icon("x", 22));
}

function areaWord(kind) { return t(`wt.area.${AREA[kind]}`); }

function titleOf(c) { return t(`wt.title.${c.kind}`); }

/** The short line a collapsed row shows: the figure the owner decides on. */
function rowFigure(c) {
  const d = c.data || {};
  if (c.kind === "buy") { const v = d.view || {}; return has(v.total) ? rupees(v.total) : (v.vendor || ""); }
  if (c.kind === "bill") { const inv = sell.invoices.get(String(d.invoiceId || c.id)); return inv && inv.totals && has(inv.totals.total) ? money(inv.totals.total) : ""; }
  if (c.kind === "reorder") return itemName(itemOf(d.itemId)) || "";
  if (c.kind === "rule") return ruleSentence(d.rule) || "";
  return "";
}

function ruleSentence(r) {
  if (!r || !r.sentence) return "";
  const s = r.sentence;
  return s[LANG_CODE[lang()]] || s["en-IN"] || s["hi-IN"] || s["kn-IN"] || "";
}

/* ------------------------------------------------------------ card bodies -- */
// v4 (Stitch 03-home-laptop, right column): label, the subject as h3 + place line, item lines, a
// boxed Total, one meta row, then the read-back. Only real data: no credit terms or certificates.

/** Who or what the owner decides about: the card's h3. */
function subjectOf(c) {
  const d = c.data || {};
  if (c.kind === "buy") return (d.view && d.view.vendor) || titleOf(c);
  if (c.kind === "bill") { const inv = sell.invoices.get(String(d.invoiceId || c.id)) || {}; const cust = invoiceCustomer(inv); return (cust && cust.name) || t("wt.walkin"); }
  if (c.kind === "reorder") return itemName(itemOf(d.itemId)) || titleOf(c);
  return titleOf(c);
}

/** The line under the h3: the seller's city (buy), the customer's phone (bill). Never invented. */
function placeOf(c) {
  const d = c.data || {};
  if (c.kind === "buy") {
    const q = d.view && d.view.quote;
    const v = q && q.vendorId !== undefined && q.vendorId !== null ? state.vendors.get(String(q.vendorId)) : null;
    return v && v.city ? cityWord(v.city) : null;
  }
  if (c.kind === "bill") { const inv = sell.invoices.get(String(d.invoiceId || c.id)) || {}; const cust = invoiceCustomer(inv); return (cust && cust.phone) || null; }
  return null;
}

function totalBox(amountText) {
  return h("div", { class: "yc-total" },
    h("span", { class: "yc-total-label", text: t("wt.totalColon") }),
    h("span", { class: "t-money yc-total-num", text: amountText }));
}

function buyBody(c) {
  const v = (c.data && c.data.view) || {};
  const unit = v.unit ? unitWord(v.unit) : "";
  const lineLeft = [has(v.quantity) ? qtyText(v.quantity, v.unit) : null, v.item || null].filter(Boolean).join(" ");
  const rate = has(v.unitPrice) ? `${rupees(v.unitPrice)}${unit ? ` / ${unit}` : ""}` : null;
  return [
    v.simulated ? pill(t("simulated"), "robot", "sim") : null,
    lineLeft || rate ? h("ul", { class: "yc-lines" },
      h("li", { class: "yc-line" },
        lineLeft ? scripted("span", lineLeft, { class: "yc-line-name" }) : null,
        rate ? h("span", { class: "yc-line-fig", text: rate }) : null)) : null,
    has(v.total) ? totalBox(rupees(v.total)) : null,
    has(v.leadTimeDays) ? h("div", { class: "yc-meta" },
      h("span", { class: "yc-meta-item" }, icon("truck", 18), h("span", { text: v.leadTimeDays === 1 ? t("wt.deliveryOne") : t("wt.delivery", { n: v.leadTimeDays }) }))) : null,
    v.approval && v.approval.readback ? heard(v.approval.readback, c.key) : null,
  ];
}

/** Read-backs the owner opened in full (key set); a long one is three lines with "Read more" (QA #6). */
const openHeard = new Set();

function heard(text, key) {
  const long = String(text || "").length > 110;
  const open = openHeard.has(key);
  const id = domId("yc-heard", key);
  return h("div", { class: "yc-heard" },
    h("p", { class: "t-label yc-heard-label", text: t("wt.heard") }),
    scripted("p", text, { class: `yc-heard-text${long && !open ? " is-clamped" : ""}`, id }),
    long ? h("button", {
      class: "chip yc-more", type: "button", "aria-expanded": String(open), "aria-controls": id,
      on: { click: () => { if (open) openHeard.delete(key); else openHeard.add(key); renderAll(); } },
    }, icon(open ? "chevronUp" : "chevronDown", 20), h("span", { text: t(open ? "wt.readLess" : "wt.readMore") })) : null);
}

function billBody(c) {
  const inv = sell.invoices.get(String((c.data && c.data.invoiceId) || c.id)) || {};
  const lines = inv.lines || [];
  const tot = inv.totals || {};
  const MAX = 4;
  return [
    lines.length ? h("ul", { class: "yc-lines" },
      ...lines.slice(0, MAX).map((l) => {
        const it = itemOf(l.itemId);
        const name = itemName(it || { name: l.name, nameNative: l.nameNative }) || l.name || "";
        return h("li", { class: "yc-line" },
          scripted("span", `${qtyText(l.qty, l.unit)} ${name}`.trim(), { class: "yc-line-name" }),
          has(l.unitPrice) ? h("span", { class: "yc-line-fig", text: `${money(l.unitPrice)}${l.unit ? ` / ${unitWord(l.unit)}` : ""}` }) : null);
      }),
      lines.length > MAX ? h("li", { class: "yc-line yc-line-more", text: t("wt.more", { n: lines.length - MAX }) }) : null) : null,
    has(tot.total) ? totalBox(money(tot.total)) : null,
    gstLine(tot),
    inv.readback ? heard(inv.readback, c.key) : null,
  ];
}

function gstLine(tot) {
  if (!tot || !has(tot.tax)) return null;
  if (!tot.tax) return h("div", { class: "yc-meta" }, h("span", { class: "yc-meta-item", text: t("wt.noGst") }));
  const split = tot.igst ? `IGST ${money(tot.igst)}` : (tot.cgst || tot.sgst) ? `CGST ${money(tot.cgst)} + SGST ${money(tot.sgst)}` : null;
  return h("div", { class: "yc-meta" },
    h("span", { class: "yc-meta-item" }, h("span", { class: "yc-gst-word", text: t("wt.gst") }), h("span", { class: "yc-gst-num", text: money(tot.tax) })),
    split ? h("span", { class: "yc-meta-item yc-gst-split", text: split }) : null);
}

function reorderBody(c) {
  const d = c.data || {};
  const it = itemOf(d.itemId) || {};
  const name = itemName(it);
  const p = d.proposal || {};
  const asked = (reorderQuestion.get(String(p.id)) || {})[LANG_CODE[lang()]] || null;
  const onHand = has(it.onHand) ? it.onHand : null;
  return [
    onHand !== null ? h("p", { class: "yc-left" },
      icon("alert", 20),
      h("span", { text: onHand <= 0 ? t("wt.outOf") : t("wt.left", { q: qtyText(onHand, it.unit) }) })) : null,
    asked
      ? scripted("p", asked, { class: "yc-ask" })
      : h("p", { class: "yc-ask", text: has(p.quantity) ? t("wt.buyQty", { q: qtyText(p.quantity, p.unit || it.unit) }) : t("wt.buySome", { item: name }) }),
    h("p", { class: "note-line yc-note" }, icon("info", 20), h("span", { text: t("wt.searchOnly") })),
  ];
}

function ruleBody(c) {
  const r = (c.data && c.data.rule) || {};
  const why = r.why ? (r.why[LANG_CODE[lang()]] || r.why["en-IN"]) : null;
  return [
    scripted("p", ruleSentence(r), { class: "yc-rule" }),
    why ? h("p", { class: "yc-why" }, h("span", { class: "yc-why-word", text: t("wt.why") }), scripted("span", why)) : null,
  ];
}

const BODY = { buy: buyBody, bill: billBody, reorder: reorderBody, rule: ruleBody };

/* ------------------------------------------------------------ card footers -- */

function itemWord(c) {
  if (c.kind !== "reorder") return "";
  return itemName(itemOf(c.data && c.data.itemId)) || "";
}

function actions(c) {
  const busy = c.phase === "saving" ? c.busy : null;
  const no = keycapButton({ icon: "x", word: t("wt.no"), label: t(`wt.noLong.${c.kind}`), tone: "secondary", size: "lg", busy: busy === "no", onClick: () => decide(c.key, false) });
  const yes = keycapButton({ icon: "check", word: t("wt.yes"), label: t(`wt.yesLong.${c.kind}`, { item: itemWord(c) }), tone: "primary", size: "lg", busy: busy === "yes", onClick: () => decide(c.key, true) });
  no.classList.add("yc-no");
  yes.classList.add("yc-yes");
  if (busy) { no.disabled = true; yes.disabled = true; }
  return h("div", { class: "yc-decide" }, no, yes);
}

/** "You can also say हाँ": only once the server has read this card out, so a spoken yes can count. */
function voiceHint(c) {
  if (!c.spokenAt || (c.data && c.data.voiceOnly)) return null;
  return h("p", { class: "yc-hint" }, icon("mic", 18), h("span", { text: t("wt.voiceHint") }));
}

function doneLinks(c) {
  const r = c.result || {};
  if (c.kind === "buy") {
    const order = (r.orderId && state.orders.get(String(r.orderId))) || [...state.orders.values()].find((o) => String(o.approvalId) === String(c.id)) || null;
    const orderId = r.orderId || (order && order.id);
    return [
      orderId ? linkKey({ href: api.poPdfUrl(orderId), ic: "doc", word: t("wt.paper"), long: t("wt.paperLong") }) : null,
      order && order.paymentUrl ? linkKey({ href: order.paymentUrl, ic: "rupee", word: t("wt.pay"), long: t("wt.payLong"), primary: true }) : null,
    ];
  }
  if (c.kind === "bill") {
    const inv = sell.invoices.get(String(c.id)) || {};
    return [
      linkKey({ href: inv.shareUrl, ic: "share", word: t("wt.share"), long: t("wt.shareLong"), primary: true }),
      linkKey({ href: inv.pdfUrl || `/api/invoices/${encodeURIComponent(c.id)}/pdf`, ic: "download", word: t("wt.file"), long: t("wt.fileLong") }),
      linkKey({ href: inv.payUrl, ic: "rupee", word: t("wt.pay"), long: t("wt.payLong") }),
    ];
  }
  if (c.kind === "reorder") return [linkKey({ href: AREA_HASH.buy, ic: "cart", word: t("wt.go", { area: t("wt.area.buy") }), external: false })];
  return [linkKey({ href: AREA_HASH.me, ic: "spark", word: t("wt.go", { area: t("wt.area.me") }), external: false })];
}

function doneNumber(c) {
  const r = c.result || {};
  if (c.kind === "buy" && r.number) return r.number;
  if (c.kind === "bill") { const inv = sell.invoices.get(String(c.id)); return r.number || (inv && inv.number) || null; }
  return null;
}

function foot(c, place, { actionsOut = false } = {}) {
  const closable = place !== "inline" || c.phase !== "saving";
  switch (c.phase) {
    case "waiting": case "error": {
      const d = c.data || {};
      const errText = c.phase === "error" ? (c.say || (c.status === 0 ? t("wt.netError") : t("wt.error"))) : null;
      return [
        c.fix ? h("div", { class: "yc-fix", role: "alert" },
          h("span", { class: "yc-fix-ico", "aria-hidden": "true" }, icon("store", 24)),
          h("div", { class: "yc-fix-main" },
            h("p", { class: "yc-fix-title", text: t("wt.fixTitle") }),
            scripted("p", c.say || t("wt.fixText"), { class: "yc-fix-text" })),
          h("button", { class: "keycap keycap-primary keycap-md", type: "button", on: { click: (e) => openShopSheet({ opener: e.currentTarget }) } },
            icon("plus", 22), h("span", { text: t("wt.fixAdd") }))) : null,
        errText ? h("p", { class: "error-line yc-error", role: "alert" }, icon("alert", 20), scripted("span", errText)) : null,
        voiceHint(c),
        d.voiceOnly
          ? h("p", { class: "note-line yc-voice" }, icon("mic", 20), h("span", { text: t("wt.voiceOnly") }))
          : actionsOut ? null : actions(c),
      ];
    }
    case "saving":
      return [
        actionsOut ? null : actions(c),
        h("p", { class: "yc-status yc-status-saving", role: "status" },
          h("span", { class: "spinner", "aria-hidden": "true" }),
          h("span", { text: c.busy === "no" ? t("wt.savingNo") : t(`wt.saving.${c.kind}`) })),
      ];
    case "done": {
      const n = doneNumber(c);
      const searching = c.kind === "reorder" && c.result && c.result.searching;
      return [
        h("div", { class: "yc-result", role: "status" },
          h("span", { class: "yc-result-ico", "aria-hidden": "true" }, icon("checkCircle", 30)),
          h("div", { class: "yc-result-main" },
            h("p", { class: "yc-result-word", text: t(searching ? "wt.done.reorderSearch" : `wt.done.${c.kind}`) }),
            n ? h("p", { class: "yc-result-num", text: t("wt.number", { n }) }) : null),
          closable ? closeButton(c.key) : null),
        c.kind === "bill" && c.result && c.result.problems ? h("p", { class: "note-line" }, icon("info", 20), h("span", { text: t("wt.billProblem") })) : null,
        h("div", { class: "yc-links" }, ...doneLinks(c).filter(Boolean)),
      ];
    }
    case "declined":
      return [h("div", { class: "yc-result yc-result-no", role: "status" },
        h("span", { class: "yc-result-ico", "aria-hidden": "true" }, icon("x", 28)),
        h("div", { class: "yc-result-main" }, h("p", { class: "yc-result-word", text: t(`wt.declined.${c.kind}`) })),
        closable ? closeButton(c.key) : null)];
    case "notDone":
      return [
        h("div", { class: "yc-result yc-result-wait", role: "status" },
          h("span", { class: "yc-result-ico", "aria-hidden": "true" }, icon("clock", 28)),
          h("div", { class: "yc-result-main" },
            h("p", { class: "yc-result-word", text: t("wt.notDone", { area: areaWord(c.kind) }) }),
            c.say ? scripted("p", c.say, { class: "yc-result-say" }) : null),
          closeButton(c.key)),
        h("div", { class: "yc-links" }, linkKey({ href: AREA_HASH[AREA[c.kind]], ic: "arrowRight", word: t("wt.go", { area: areaWord(c.kind) }), external: false })),
      ];
    case "gone":
      return [h("div", { class: "yc-result yc-result-gone", role: "status" },
        h("span", { class: "yc-result-ico", "aria-hidden": "true" }, icon("info", 28)),
        h("div", { class: "yc-result-main" }, scripted("p", c.say || t("wt.gone"), { class: "yc-result-word" })),
        closeButton(c.key))];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ card -- */

function cardSig(c, extra) {
  const d = c.data || {};
  const live = c.kind === "buy" ? d.view
    : c.kind === "bill" ? [sell.invoices.get(String(c.id)), sell.customers.size]
      : c.kind === "reorder" ? [itemOf(d.itemId), d.proposal, reorderQuestion.get(String(d.proposal && d.proposal.id))]
        : d.rule;
  const after = c.phase === "done" ? [state.orders.size, c.kind === "buy" ? [...state.orders.values()].filter((o) => String(o.approvalId) === String(c.id)) : null] : null;
  return JSON.stringify([lang(), c.phase, c.busy, c.say, c.fix, c.result, c.status, live, after, openHeard.has(c.key), extra]);
}

/** One Yes card element for a model card. */
function buildCard(c, { place, index = 0, total = 1, speaking = false, actionsOut = false }) {
  const titleId = domId("yc-t", c.key);
  const kindId = domId("yc-k", c.key);
  const isLive = c.phase === "waiting" || c.phase === "error";
  const now = speaking && isLive;
  const speakKey = speakKeyOf(c.kind, c.id, c.data && c.data.itemId);
  const where = placeOf(c);
  const cls = ["card", "yc", `yc-${c.kind}`, `is-${c.phase}`];
  if (now) cls.push("card-now");
  if (c.phase === "error" || c.fix) cls.push("card-alert");
  return h("article", { class: cls.join(" "), role: "region", "aria-labelledby": `${kindId} ${titleId}`, dataset: { key: c.key, phase: c.phase, place } },
    h("header", { class: "card-head yc-head" },
      h("div", { class: "yc-head-main" },
        h("p", { class: "t-label yc-kind", id: kindId },
          h("span", { text: t(`wt.label.${c.kind}`) }),
          h("span", { class: "wt-sr", text: ` ${titleOf(c)}` }),
          total > 1 ? h("span", { class: "yc-of", text: t("wt.count", { i: index + 1, n: total }) }) : null),
        scripted("h3", subjectOf(c), { class: "card-title yc-title", id: titleId, tabindex: "-1" }),
        where ? scripted("p", where, { class: "yc-place" }) : null),
      speakKey ? h("span", { class: "card-speak" }, speakButton(speakKey)) : null),
    now ? h("p", { class: "yc-now" }, h("span", { class: "yc-now-dot", "aria-hidden": "true" }), h("span", { text: t("wt.speaking") })) : null,
    h("div", { class: "yc-body" }, ...BODY[c.kind](c).filter(Boolean)),
    h("div", { class: "yc-foot" }, ...foot(c, place, { actionsOut }).filter(Boolean)));
}

/** A collapsed tray row: kind icon, title, the figure, phase mark; tap expands it. */
function buildRow(c, onOpen) {
  const fig = rowFigure(c);
  const phaseIcon = { saving: null, done: "checkCircle", declined: "x", notDone: "clock", gone: "info", error: "alert" }[c.phase];
  return h("button", { class: "row-button yc-row", type: "button", dataset: { phase: c.phase }, "aria-label": `${titleOf(c)} ${fig}`.trim(), on: { click: () => onOpen(c.key) } },
    h("span", { class: "row-ico yc-row-ico", "aria-hidden": "true" }, icon(KIND_ICON[c.kind], 22)),
    h("span", { class: "row-main" },
      h("span", { class: "row-title", text: titleOf(c) }),
      fig ? scripted("span", fig, { class: "row-sub yc-row-fig" }) : null),
    h("span", { class: "row-end" },
      c.phase === "saving" ? h("span", { class: "spinner", "aria-hidden": "true" }) : phaseIcon ? icon(phaseIcon, 22, `yc-row-mark yc-row-${c.phase}`) : null,
      icon("chevronRight", 22)));
}

/* ------------------------------------------------------------------ tray -- */

/** One tray view (the sheet/drawer body, or the agent column). */
function createTrayView({ place, withHead, onFoot = null, selfFoot = false }) {
  const el = h("section", { class: `wt wt-${place}`, "aria-labelledby": undefined });
  const headId = domId("wt-h", place);
  const count = h("span", { class: "t-label wt-tag" });
  const head = withHead ? h("header", { class: "wt-head" },
    h("span", { class: "wt-dot", "aria-hidden": "true" }),
    h("h2", { class: "wt-title", id: headId }, h("span", { text: t("wt.tray") })), count) : null;
  if (withHead) el.setAttribute("aria-labelledby", headId);
  const list = h("ol", { class: "wt-list" });
  const stateBox = h("div", { class: "wt-state" });
  el.append(...[head, stateBox, list].filter(Boolean));
  const nodes = new Map(); // key -> { li, sig }
  let expanded = null;
  let stateKey = "";
  let footSig = null;
  if (selfFoot && !onFoot) onFoot = (node) => { footEl.hidden = !node; };
  const footEl = onFoot ? h("div", { class: "wt-foot" }) : null;
  if (selfFoot) { footEl.hidden = true; el.append(footEl); }

  function render() {
    if (head) {
      head.querySelector(".wt-title span").textContent = t("wt.tray");
      const n = model.count();
      count.textContent = t("wt.actionRequired");
      count.hidden = n === 0;
      head.classList.toggle("is-waiting", n > 0);
    }
    const cards = model.list();
    // Nothing to list: loading, a source error, or the designed empty view.
    let sk = "list";
    if (!cards.length) {
      const st = sourceStatus();
      sk = st.failed.length ? `error|${st.failed.map((f) => f.err && f.err.say).join("|")}` : st.loading ? "loading" : "empty";
    }
    sk += `|${lang()}`;
    if (sk !== stateKey) {
      stateKey = sk;
      const st = sourceStatus();
      if (sk.startsWith("list")) fill(stateBox);
      else if (sk.startsWith("loading")) {
        fill(stateBox, h("div", { class: "wt-skel", role: "status", "aria-label": t("wt.loading") },
          h("span", { class: "skel skel-card wt-skel-card", "aria-hidden": "true" }),
          h("p", { class: "wt-skel-word", text: t("wt.loading") })));
      } else if (sk.startsWith("error")) {
        const say = st.failed.map((f) => f.err && f.err.say).filter(Boolean)[0];
        fill(stateBox, stateView({ kind: "error", title: t("wt.loadFail"), text: say || undefined, compact: true,
          action: { label: t("wt.retry"), icon: "refresh", run: () => st.failed.forEach((f) => f.retry()) } }));
      } else {
        fill(stateBox, stateView({ kind: "empty", icon: "inbox", title: t("wt.none"), text: t("wt.noneText"), compact: true }));
      }
    }
    if (!cards.some((c) => c.key === expanded)) expanded = cards.length ? cards[0].key : null;
    const speaking = model.speaking();
    const keep = new Set();
    const order = [];
    cards.forEach((c, i) => {
      keep.add(c.key);
      const open = c.key === expanded;
      const sig = cardSig(c, [open, i, cards.length, speaking === c.key, place]);
      let n = nodes.get(c.key);
      if (!n) { n = { li: h("li", { class: "wt-item" }), sig: null }; nodes.set(c.key, n); }
      if (n.sig !== sig) {
        n.sig = sig;
        const hadFocus = n.li.contains(document.activeElement) ? document.activeElement : null;
        const focusSel = hadFocus ? focusPath(hadFocus) : null;
        n.li.className = `wt-item${open ? " is-open" : " row"}`;
        fill(n.li, open ? buildCard(c, { place, index: i, total: cards.length, speaking: speaking === c.key, actionsOut: Boolean(onFoot) }) : buildRow(c, (k) => { expanded = k; render(); focusTitle(k); }));
        if (focusSel) restoreFocus(n.li, focusSel);
      }
      order.push(n.li);
    });
    for (const [k, n] of nodes) if (!keep.has(k)) { n.li.remove(); nodes.delete(k); }
    // Re-order only when the order changed (moving a node can drop its focus).
    const current = [...list.children];
    if (current.length !== order.length || current.some((li, i) => li !== order[i])) {
      for (const li of order) list.append(li);
    }
    list.hidden = cards.length === 0;
    if (onFoot) {
      // The expanded card's Yes / No sit in the sheet footer: always in view above the safe area.
      const c = cards.find((x) => x.key === expanded);
      const needs = c && ["waiting", "error", "saving"].includes(c.phase) && !(c.data && c.data.voiceOnly);
      const sig = needs ? JSON.stringify([c.key, c.phase, c.busy, lang()]) : "none";
      if (sig !== footSig) {
        footSig = sig;
        const had = footEl.contains(document.activeElement) ? focusPath(document.activeElement) : null;
        if (needs) fill(footEl, actions(c)); else fill(footEl);
        onFoot(needs ? footEl : null);
        if (had) restoreFocus(footEl, had);
      }
    }
  }

  function focusTitle(key) {
    requestAnimationFrame(() => {
      const n = nodes.get(key);
      const title = n && n.li.querySelector(".yc-title");
      if (title) { title.focus({ preventScroll: true }); n.li.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }); }
    });
  }

  return {
    el, render, focusTitle,
    expand(key) { if (key) expanded = key; render(); },
    resetFoot() { footSig = null; },
    hasKey: (key) => nodes.has(key),
  };
}

/** Keep focus on "the same control" across a rebuild: its role in the card (yes / no / close / speak). */
function focusPath(el) {
  for (const sel of [".yc-yes", ".yc-no", ".yc-close", ".card-speak button", ".yc-title", ".yc-row", ".yc-link", ".yc-fix button", ".yc-more"]) {
    if (el.matches(sel)) return sel;
  }
  return ".yc-title";
}
function restoreFocus(root, sel) {
  const el = root.querySelector(`${sel}:not([disabled])`) || root.querySelector(".yc-title") || root.querySelector("button:not([disabled])");
  if (el) el.focus({ preventScroll: true });
}

/* ------------------------------------------------------------- placement -- */

let shell = null;
let layout = null;              // the shell's layout() or our own measure
let columnView = null;          // tray inside slots.agentColumn (1280+)
let sheetView = null;           // tray inside a sheet / drawer
let sheetApi = null;
let sheetFoot = null;           // the expanded card's Yes / No for the sheet footer
let sheetRoute = null;          // the route the sheet opened on: another route closes it
let pillEl = null;
let fallbackHost = null;        // our own layer when the shell is not there (old main.js)
let deferredOpen = null;        // a card that wanted to open while the phone keyboard was up
const live = typeof document !== "undefined" ? h("div", { class: "wt-sr", role: "status", "aria-live": "polite" }) : null;
const countSubs = new Set();
let lastCount = -1;
let lastBadges = "";

function measure() {
  if (shell && typeof shell.layout === "function") {
    try { const l = shell.layout(); if (l) return l; } catch { /* shell not ready */ }
  }
  const vv = window.visualViewport;
  const keyboardOpen = Boolean(vv && window.innerWidth < 600 && window.innerHeight - vv.height > 150);
  return { keyboardOpen };
}

function place() {
  const l = layout || measure();
  // The column exists only with the shell's agent column; without it, 1280+ falls back to the drawer.
  const col = Boolean(columnView && shellSlot("agentColumn"));
  const columnShown = col && (l.columnShown !== undefined ? Boolean(l.columnShown) : window.innerWidth >= 1280);
  return placeFor({ width: window.innerWidth, height: window.innerHeight, size: l.size, columnShown });
}

function shellSlot(name) {
  const s = shell && shell.slots && shell.slots[name];
  // A slot counts only once the shell is mounted in the page (old main.js imports it without mounting).
  return s && s.nodeType === 1 && s.isConnected ? s : null;
}

function sheetIsOpen() {
  return Boolean(sheetApi && typeof sheetApi.isOpen === "function" && sheetApi.isOpen());
}

/** Open the tray where it lives at this size; `key` expands (and focuses) that card. */
export function openTray(key = null) {
  ensureMounted();
  const p = place();
  if (p === "column" && columnView) {
    columnView.expand(key);
    columnView.focusTitle(key || (model.list()[0] || {}).key);
    return;
  }
  if (!sheetView) sheetView = createTrayView({ place: "sheet", withHead: false, onFoot: (el) => { sheetFoot = el; if (sheetIsOpen() && sheetApi.setFooter) sheetApi.setFooter(el ? [el] : []); } });
  sheetView.expand(key);
  if (!sheetIsOpen()) {
    sheetApi = openSheet({
      title: t("wt.tray"),
      body: sheetView.el,
      opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      kind: "yes", // sheet.js places it per spec 6.3: phone sheet, landscape / 1024+ drawer, tablet centred sheet
      place: p === "drawer" || p === "landDrawer" ? "drawer" : undefined,
      closeLabel: t("wt.later"),
      footer: sheetFoot ? [sheetFoot] : undefined,
      onClose: () => { sheetApi = null; settleOnClose(); },
    });
    sheetRoute = location.hash;
  }
  const first = key || (model.list()[0] || {}).key;
  if (first) sheetView.focusTitle(first);
}

/** Closing the tray clears answered cards (their outcome was seen); waiting ones stay. */
function settleOnClose() {
  for (const c of model.list()) if (c.phase === "done" || c.phase === "declined" || c.phase === "gone") model.dismiss(c.key);
  renderAll();
}

function editableFocused() {
  const a = document.activeElement;
  return Boolean(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
}

/** D7: the server spoke the read-back. The card opens and focus moves to its title, once, politely. */
function autoOpen(key) {
  const c = model.card(key);
  if (!c) return;
  announce(`${t("wt.new")}: ${titleOf(c)}`);
  const p = place();
  const l = layout || measure();
  if (p === "column" && columnView) {
    columnView.expand(key);
    if (!editableFocused()) columnView.focusTitle(key);
    return;
  }
  // Phone keyboard open: the card waits until it closes; the pill pulses now (spec 6.3).
  if (l.keyboardOpen) { deferredOpen = key; pulsePill(); return; }
  openTray(key);
}

function announce(text) {
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = text; });
}

/* ------------------------------------------------------------------ pill -- */

function buildPill() {
  const word = h("span", { class: "wt-pill-word" });
  const num = h("span", { class: "wt-pill-num" });
  const btn = h("button", { class: "wt-pill", type: "button", hidden: true, on: { click: () => openTray() } },
    h("span", { class: "wt-pill-drop", "aria-hidden": "true" }, icon("bell", 20)), num, word);
  btn.__num = num; btn.__word = word;
  return btn;
}

function renderPill(n) {
  if (!pillEl) return;
  if (n === 0) { pillEl.hidden = true; if (pillEl.parentNode && pillEl.parentNode !== fallbackHost) pillEl.remove(); return; }
  if (!pillEl.isConnected || (fallbackHost && pillEl.parentNode === fallbackHost && shellSlot("waitingPill"))) mountPill();
  pillEl.hidden = false;
  pillEl.__num.textContent = n > 9 ? "9+" : String(n);
  pillEl.__word.textContent = t("wt.new");
  pillEl.setAttribute("aria-label", t("wt.pillLong", { n }));
}

let pulseTimer = 0;
function pulsePill() {
  if (!pillEl) return;
  pillEl.classList.remove("is-new");
  void pillEl.offsetWidth;
  pillEl.classList.add("is-new");
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => pillEl && pillEl.classList.remove("is-new"), 2400);
}

/* ---------------------------------------------------------------- mount -- */

let mounted = false;
function ensureMounted() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  ensureCss();
  document.body.append(live);
  pillEl = buildPill();
  mountPill();
  window.addEventListener("resize", onResize, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("sahay:open-tray", () => openTray());
  // #/waiting (a Telegram deep link, or Sahay home before this module loaded): the shell fires
  // sahay:open-tray for it; without the shell the hash itself opens the tray. Opening twice is a no-op.
  const fromHash = () => {
    if (location.hash === "#/waiting" || location.hash.startsWith("#/waiting?")) { requestAnimationFrame(() => openTray()); return; }
    // Moving to another screen puts the tray away (QA #21); the pill keeps the count.
    if (sheetIsOpen() && sheetRoute !== null && location.hash !== sheetRoute && typeof sheetApi.close === "function") sheetApi.close();
  };
  window.addEventListener("hashchange", fromHash);
  fromHash();
}

function mountPill() {
  const slot = shellSlot("waitingPill");
  if (slot) { slot.append(pillEl); if (fallbackHost) fallbackHost.classList.remove("wt-has-pill"); return; }
  if (!fallbackHost) fallbackHost = h("div", { class: "wt-layer" });
  fallbackHost.classList.add("wt-has-pill");
  fallbackHost.append(pillEl);
  if (!fallbackHost.isConnected) document.body.append(fallbackHost);
}

function mountColumn() {
  const col = shellSlot("agentColumn");
  if (!col || columnView) return;
  columnView = createTrayView({ place: "column", withHead: true, selfFoot: true });
  col.append(columnView.el);
}

function onResize() {
  layout = measure();
  if (deferredOpen && !layout.keyboardOpen) { const k = deferredOpen; deferredOpen = null; openTray(k); }
  // Moving to 1280+ while the sheet is open: the column takes over and the sheet closes.
  if (sheetIsOpen() && place() === "column" && columnView && typeof sheetApi.close === "function") sheetApi.close();
  renderAll();
}

/** W1's shell API: slots { waitingPill, agentColumn, sheetRoot, ... }, onLayout, layout, setBadge. */
export function attachShell(s) {
  if (!s || shell === s) return;
  shell = s;
  ensureMounted();
  // The waiting count is ours now: the shell drops its interim approvals-only badge.
  if (typeof s.claimBadges === "function") { try { s.claimBadges(); } catch { /* older shell */ } }
  mountPill();
  mountColumn();
  if (typeof s.onLayout === "function") s.onLayout((l) => { layout = l; onResize(); });
  lastBadges = "";
  renderAll();
}

/* --------------------------------------------------------------- inline -- */

const hosts = new Set(); // { el, key, place, sig }

/**
 * The Yes card for one item, live: it follows every server event until it leaves the page.
 * `item` is from waitingItems() (or any { key }). place: "tray" | "inline" | "sheet" | "column".
 */
export function renderCard(item, { place: where = "inline" } = {}) {
  ensureMounted();
  const key = typeof item === "string" ? item : item && item.key;
  const host = { el: h("div", { class: `yc-host yc-host-${where}`, dataset: { key } }), key, place: where, sig: null, born: Date.now() };
  hosts.add(host);
  paintHost(host);
  return host.el;
}

function paintHost(host) {
  const c = model.card(host.key);
  if (!c) { if (host.sig !== "none") { host.sig = "none"; fill(host.el); host.el.hidden = true; } return; }
  host.el.hidden = false;
  const sig = cardSig(c, [host.place, model.speaking() === c.key]);
  if (sig === host.sig) return;
  host.sig = sig;
  const had = host.el.contains(document.activeElement) ? focusPath(document.activeElement) : null;
  fill(host.el, buildCard(c, { place: host.place, speaking: model.speaking() === c.key }));
  if (had) restoreFocus(host.el, had);
}

/* --------------------------------------------------------------- render -- */

function areaCounts() {
  const out = { buy: 0, sell: 0, stock: 0, me: 0 };
  for (const c of model.list()) if (c.phase === "waiting" || c.phase === "error") out[AREA[c.kind]] += 1;
  return out;
}

function renderAll() {
  if (typeof document === "undefined") return;
  // The shell may mount after this module loaded: move the pill into its slot and open the column then.
  if (!columnView) mountColumn();
  const n = model.count();
  const per = areaCounts();
  const badgeSig = JSON.stringify([n, per, Boolean(shell)]);
  if (n > lastCount && lastCount >= 0) pulsePill();
  renderPill(n);
  if (badgeSig !== lastBadges) {
    lastBadges = badgeSig;
    if (shell && typeof shell.setBadge === "function") {
      try {
        shell.setBadge("waiting", n);
        for (const [k, v] of Object.entries(per)) shell.setBadge(k, v);
      } catch { /* shell without that badge */ }
    }
  }
  if (n !== lastCount) {
    lastCount = n;
    for (const fn of countSubs) { try { fn(n); } catch (err) { console.error(err); } }
  }
  if (columnView) columnView.render();
  if (sheetView && sheetIsOpen()) sheetView.render();
  for (const host of hosts) {
    // A card a screen dropped (or built and never placed) stops following the store.
    if (!host.el.isConnected && (host.el.__mounted || Date.now() - host.born > 5000)) { hosts.delete(host); continue; }
    if (host.el.isConnected) host.el.__mounted = true;
    paintHost(host);
  }
  if (sheetApi && !sheetIsOpen()) sheetApi = null;
}

let timer = 0;
function ensureTimer() {
  if (timer || !model.hasTimers()) return;
  timer = setInterval(() => {
    if (model.tick()) renderAll();
    if (!model.hasTimers()) { clearInterval(timer); timer = 0; }
  }, 1000);
}

/** Pull from the stores, resolve outcomes a snapshot already shows, then open what the server spoke. */
function refresh() {
  if (state.boot === "ready") {
    if (sell.status === "idle") loadSell({ quiet: true });
    if (stock.status === "idle") loadStock({ quiet: true });
  }
  model.sync(collect());
  for (const c of model.list()) {
    if (c.phase !== "saving" && c.phase !== "notDone") continue;
    if (c.kind === "buy") {
      const o = [...state.orders.values()].find((x) => String(x.approvalId) === String(c.id));
      if (o) model.resolve(c.key, { number: o.poNumber || null, orderId: String(o.id) });
    } else if (c.kind === "bill") {
      const inv = sell.invoices.get(String(c.id));
      if (inv && inv.number && ["issued", "part_paid", "paid"].includes(inv.status)) model.resolve(c.key, { number: inv.number, invoiceId: String(c.id) });
    }
  }
  if (!shopMissing()) for (const c of model.list()) if (c.kind === "bill" && c.fix) model.clearFix(c.key);
  ensureTimer();
  renderAll();
  for (const s of model.takeSignals()) if (s.type === "open") autoOpen(s.key);
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; refresh(); });
}

const PARTS = ["approvals", "work", "orders", "sell", "stock", "agent", "lang", "boot", "all", "business"];

function start() {
  if (typeof document === "undefined") return;
  subscribe((_s, parts) => { if (PARTS.some((p) => parts.has(p))) schedule(); });
  onEvent((evt) => {
    if (evt && evt.type === "stock.reorder_proposed" && evt.data && evt.data.proposalId !== undefined && evt.data.question) {
      reorderQuestion.set(String(evt.data.proposalId), evt.data.question);
    }
    model.event(evt);
    ensureTimer();
    schedule();
  });
  // W1's shell, when this build has it (it is found once; a missing module is ignored).
  import("./shell.js").then((m) => { if (m && m.slots) attachShell(m); }).catch(() => {});
  schedule();
}

start();

/* --------------------------------------------------------------- exports -- */

/** Every card the tray holds, in tray order (contract 5.2). */
export function waitingItems() {
  return model.list().map((c) => ({
    key: c.key, kind: c.kind, area: AREA[c.kind], phase: c.phase,
    spokenAt: c.spokenAt || null, createdAt: c.createdAt || null,
    speakKey: speakKeyOf(c.kind, c.id, c.data && c.data.itemId),
  }));
}

/** fn(count) now and whenever the number of decisions waiting for the owner changes. */
export function onCount(fn) {
  countSubs.add(fn);
  try { fn(model.count()); } catch (err) { console.error(err); }
  return () => countSubs.delete(fn);
}

/** The pending count right now. */
export const waitingCount = () => model.count();

/**
 * The composer's note when the owner types a yes while a card waits (F7, rule 3): a typed yes
 * never counts. Returns the note with that card's real Yes button under it, or null.
 */
export function typedYesHint(text) {
  if (!isTypedYes(text)) return null;
  const c = model.list().find((x) => (x.phase === "waiting" || x.phase === "error") && !(x.data && x.data.voiceOnly));
  if (!c) return null;
  return h("div", { class: "wt-typed", role: "note" },
    h("p", { class: "wt-typed-line" }, icon("keyboard", 20), h("span", { text: t("wt.typed") })),
    h("div", { class: "wt-typed-card" },
      h("span", { class: "wt-typed-what" }, icon(KIND_ICON[c.kind], 20), h("span", { text: titleOf(c) }),
        rowFigure(c) ? scripted("b", rowFigure(c)) : null),
      h("button", { class: "keycap keycap-primary keycap-md", type: "button", "aria-label": t(`wt.yesLong.${c.kind}`, { item: itemWord(c) }), on: { click: () => { decide(c.key, true); openTray(c.key); } } },
        icon("check", 22), h("span", { text: t("wt.yes") }))));
}

/** The legacy layer mount for main.js before the v3 shell: the fallback pill lives in it. */
export function legacyLayer() {
  ensureMounted();
  if (!fallbackHost) fallbackHost = h("div", { class: "wt-layer" });
  return fallbackHost;
}
