// "Needs you" and the Yes card (UI v5, W3). No side column: the shell's "Needs you (n)" button,
// #/needs and Home's Check rows open this host, a bottom sheet on phones and a centred modal from
// 768px (W1's openSheet). Several waiting decisions -> a plain list first; one -> its Yes card.
//
// The Yes card, plain and big: the question, WHAT, WHO (+ "simulated vendor", rule 4), HOW MUCH,
// the folded "What Sahay read out", then No / Yes (64px, Yes pink) and one footnote.
//
// Behaviour (unchanged from v3; the state machine is waiting-model.js, the facts yes-facts.js):
//   - buttons post to /api/approvals/:id/decision, /api/invoices/:id/decision,
//     /api/stock/reorders/:id/decision, /api/agent/rules/:id/decision (store calls);
//   - Saving after a tap or the server's own decided event; Done only on order.created /
//     invoice.issued / stock.reorder_decided / rule.decided; "Not done yet" after 45 s;
//   - a card opens by itself only on a FRESH spoken read-back (approval.spoken, invoice.spoken,
//     stock.reorder_spoken, rule.spoken); another route closes the host;
//   - setNeedsCount(n) on every change.
//
// Exports: openNeeds(key?), createYesCard(item, { inline }), needsRows(), onNeedsRows(fn),
// onCount(fn), waitingCount(), waitingItems(), typedYesHint(text).

import { h, icon, fill, scripted, money, qtyText, itemName, button, yesNo, openSheet, testChip, emptyState, skeleton, errorLine, list, safeUrl } from "./ui.js";
import { t, addStrings, lang } from "./i18n.js";
import * as api from "../api.js";
import { state, subscribe, onEvent, pendingApprovals, approvalView, decideRule } from "./store.js";
import { sell, stock, pendingInvoices, decideInvoice, decideReorder, invoiceCustomer, itemOf, loadSell, loadStock } from "./store-sell.js";
import { setNeedsCount } from "./shell.js";
import { speakButton } from "./speak.js";
import { createWaitingModel, parseKey, speakKeyOf, isTypedYes, AREA } from "./waiting-model.js";
import { cardFacts, needsRow, hostPlan, iconOf } from "./yes-facts.js";
import { WT_STRINGS } from "./waiting-strings.js";

addStrings(WT_STRINGS);

const model = createWaitingModel();
const LANG_CODE = { hi: "hi-IN", kn: "kn-IN", en: "en-IN" };
const AREA_HASH = { buy: "#/buy", sell: "#/sell", stock: "#/stock", me: "#/me/teach" };
const reorderQuestion = new Map(); // proposalId -> { "hi-IN": ..., ... } from stock.reorder_proposed (live)
const openReadouts = new Set();    // cards whose "What Sahay read out" the owner unfolded

function ensureCss() {
  if (typeof document === "undefined" || document.querySelector('link[href="/css/yes.css"]')) return;
  document.head.append(h("link", { rel: "stylesheet", href: "/css/yes.css" }));
}

/* ---------------------------------------------------------------- sources -- */

const has = (v) => v !== null && v !== undefined && v !== "";

/** Every pending decision from the stores (no new wire fields). */
function collect() {
  const items = [];
  for (const a of pendingApprovals()) items.push({ key: `approval:${a.id}`, kind: "buy", id: String(a.id), createdAt: a.requestedAt || null, view: approvalView(a) });
  for (const inv of pendingInvoices()) items.push({ key: `invoice:${inv.id}`, kind: "bill", id: String(inv.id), createdAt: inv.createdAt || null, invoiceId: String(inv.id) });
  for (const [itemId, p] of stock.proposals) {
    const id = p && p.id ? String(p.id) : `item-${itemId}`;
    items.push({ key: `reorder:${id}`, kind: "reorder", id, createdAt: p.at || null, itemId: String(itemId), proposal: p, voiceOnly: !(p && p.id) });
  }
  const A = state.agent;
  if (A && A.rules) for (const r of A.rules.values()) if (r && r.status === "suggested") items.push({ key: `rule:${r.id}`, kind: "rule", id: String(r.id), createdAt: r.created_at || null, rule: r });
  return items;
}

function sourceStatus() {
  const loading = state.boot !== "ready" || [sell.status, stock.status].some((s) => s === "loading" || s === "idle") || (state.agent && state.agent.status === "loading");
  const failed = [];
  if (sell.status === "error") failed.push({ err: sell.error, retry: () => loadSell() });
  if (stock.status === "error") failed.push({ err: stock.error, retry: () => loadStock() });
  return { loading, failed };
}

/** The store data one card shows (yes-facts.js turns it into WHAT / WHO / HOW MUCH). */
function dataFor(c) {
  const d = c.data || {};
  if (c.kind === "buy") return { view: d.view };
  if (c.kind === "bill") {
    const inv = sell.invoices.get(String(d.invoiceId || c.id)) || {};
    const cust = invoiceCustomer(inv);
    return { invoice: inv, customerName: (cust && cust.name) || t("wt.walkin") };
  }
  if (c.kind === "reorder") {
    const p = d.proposal || {};
    return { item: itemOf(d.itemId) || {}, proposal: p, question: (reorderQuestion.get(String(p.id)) || {})[LANG_CODE[lang()]] || null };
  }
  return { rule: d.rule, langCode: LANG_CODE[lang()] };
}

const FMT = {
  money, qty: qtyText, itemName,
  lineName: (l) => itemName(itemOf(l.itemId) || { name: l.name, nameNative: l.nameNative }) || l.name || "",
};
const factsOf = (c) => cardFacts(c, dataFor(c), FMT);
const amountText = (f) => (f.amount === null || f.amount === undefined ? null : f.amountKind === "money" ? money(f.amount) : String(f.amount));

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

/* ------------------------------------------------------------ the card -- */

/** One definition row: label left (muted), value right; a value may be several lines. */
function factRow(labelKey, value, under = null) {
  const lines = (Array.isArray(value) ? value : [value]).filter(has);
  if (!lines.length && !under) return null;
  return h("div", { class: "yes-row" },
    h("span", { class: "yes-row-label", text: t(labelKey) }),
    h("span", { class: "yes-row-value" }, ...lines.map((l) => scripted("span", String(l), { class: "yes-row-line" })), under));
}

/** WHAT, WHO, the extra facts, HOW MUCH, then the folded read-back. */
function facts(c, f) {
  const amt = amountText(f);
  const extra = f.extra.map((x) => factRow(x.labelKey, x.text !== undefined ? x.text : t(x.textKey, x.vars)));
  const readout = f.readback ? (() => {
    const d = h("details", { class: "yes-readout", open: openReadouts.has(c.key) ? true : undefined },
      h("summary", { class: "yes-readout-head" }, icon("speaker", 20), h("span", { text: t("wt.readout") }), icon("chevronDown", 20, "yes-readout-chev")),
      scripted("p", f.readback, { class: "yes-readout-text" }));
    d.addEventListener("toggle", () => { if (d.open) openReadouts.add(c.key); else openReadouts.delete(c.key); });
    return d;
  })() : null;
  return [
    h("div", { class: "yes-facts" },
      factRow("wt.what", f.more ? [...f.what, t("wt.more", { n: f.more })] : f.what),
      // Rule 4: "simulated vendor" in plain warn text right under the name, whenever it is simulated.
      factRow("wt.who", f.who, f.simulated ? h("span", { class: "yes-sim", text: t("simulated") }) : null),
      ...extra,
      amt ? h("div", { class: "yes-much" },
        h("span", { class: "yes-row-label", text: t(f.amountKind === "qty" ? "wt.howMuchBuy" : "wt.howMuch") }),
        h("p", { class: "yes-amount num", text: amt })) : null),
    readout,
  ];
}

function linkButton(word, ic, href, { kind = "secondary", external = true, label } = {}) {
  const url = external ? safeUrl(href) : href;
  return url ? button({ word, icon: ic, kind, size: "sm", href: url, newTab: external, label }) : null;
}

function doneLinks(c) {
  const r = c.result || {};
  if (c.kind === "buy") {
    const order = (r.orderId && state.orders.get(String(r.orderId))) || [...state.orders.values()].find((o) => String(o.approvalId) === String(c.id)) || null;
    const orderId = r.orderId || (order && order.id);
    const pay = order && order.paymentUrl ? linkButton(t("wt.pay"), "rupee", order.paymentUrl, { kind: "primary", label: t("wt.payLong") }) : null;
    return [orderId ? linkButton(t("wt.paper"), "doc", api.poPdfUrl(orderId), { label: t("wt.paperLong") }) : null, pay, pay ? testChip() : null];
  }
  if (c.kind === "bill") {
    const inv = sell.invoices.get(String(c.id)) || {};
    const pay = linkButton(t("wt.pay"), "rupee", inv.payUrl, { label: t("wt.payLong") });
    return [
      linkButton(t("wt.share"), "share", inv.shareUrl, { kind: "primary", label: t("wt.shareLong") }),
      linkButton(t("wt.file"), "download", inv.pdfUrl || `/api/invoices/${encodeURIComponent(c.id)}/pdf`, { label: t("wt.fileLong") }),
      pay, pay ? testChip() : null,
    ];
  }
  if (c.kind === "reorder") return [linkButton(t("wt.go", { area: t("wt.area.buy") }), "cart", AREA_HASH.buy, { external: false })];
  return [linkButton(t("wt.go", { area: t("wt.area.me") }), "spark", AREA_HASH.me, { external: false })];
}

function doneNumber(c) {
  const r = c.result || {};
  if (c.kind === "buy" && r.number) return r.number;
  if (c.kind === "bill") { const inv = sell.invoices.get(String(c.id)); return r.number || (inv && inv.number) || null; }
  return null;
}

function result(tone, ic, word, more = []) {
  return h("div", { class: `yes-result yes-result-${tone}`, role: "status" },
    h("span", { class: "yes-result-ico", "aria-hidden": "true" }, icon(ic, 26)),
    h("div", { class: "yes-result-main" }, scripted("p", word, { class: "yes-result-word" }), ...more));
}

/** The part under the facts that follows the phase (messages, outcome, links). */
function status(c) {
  switch (c.phase) {
    case "waiting": case "error": {
      const err = c.phase === "error" ? (c.say || (c.status === 0 ? t("wt.netError") : t("wt.error"))) : null;
      return [
        c.fix ? h("div", { class: "yes-fix", role: "alert" },
          scripted("p", c.say || t("wt.fixText"), { class: "yes-fix-text" }),
          button({ word: t("wt.fixAdd"), icon: "store", kind: "secondary", size: "sm", href: "#/me/shop" })) : null,
        err ? errorLine(err) : null,
        c.data && c.data.voiceOnly ? h("p", { class: "note-line" }, icon("mic", 18), h("span", { text: t("wt.voiceOnly") }))
          : c.spokenAt ? h("p", { class: "yes-hint" }, icon("mic", 18), h("span", { text: t("wt.voiceHint") })) : null,
      ];
    }
    case "saving":
      return [h("p", { class: "yes-saving", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }),
        h("span", { text: c.busy === "no" ? t("wt.savingNo") : t(`wt.saving.${c.kind}`) }))];
    case "done": {
      const n = doneNumber(c);
      const searching = c.kind === "reorder" && c.result && c.result.searching;
      return [
        result("good", "checkCircle", t(searching ? "wt.done.reorderSearch" : `wt.done.${c.kind}`),
          [n ? h("p", { class: "yes-result-sub num", text: t("wt.number", { n }) }) : null,
            c.kind === "bill" && c.result && c.result.problems ? scripted("p", t("wt.billProblem"), { class: "yes-result-sub" }) : null]),
        h("div", { class: "yes-links" }, ...doneLinks(c).filter(Boolean)),
      ];
    }
    case "declined": return [result("muted", "x", t(`wt.declined.${c.kind}`))];
    case "notDone":
      return [
        result("warn", "clock", t("wt.notDone", { area: t(`wt.area.${AREA[c.kind]}`) }), [c.say ? scripted("p", c.say, { class: "yes-result-sub" }) : null]),
        h("div", { class: "yes-links" }, linkButton(t("wt.go", { area: t(`wt.area.${AREA[c.kind]}`) }), "arrowRight", AREA_HASH[AREA[c.kind]], { external: false })),
      ];
    case "gone": return [result("muted", "info", c.say || t("wt.gone"))];
    default: return [];
  }
}

const needsKeys = (c) => ["waiting", "error", "saving"].includes(c.phase) && !(c.data && c.data.voiceOnly);

/** No / Yes while the card waits or saves; Close once it has an outcome. */
function actions(c, { onClose } = {}) {
  if (needsKeys(c)) {
    return [
      yesNo({
        busy: c.phase === "saving" ? c.busy : null,
        yesLabel: t(`wt.yesLong.${c.kind}`, { item: c.kind === "reorder" ? (itemName(itemOf(c.data && c.data.itemId)) || "") : "" }),
        noLabel: t(`wt.noLong.${c.kind}`),
        onYes: () => decide(c.key, true), onNo: () => decide(c.key, false),
      }),
      scripted("p", t(`wt.foot.${c.kind}`), { class: "yes-footnote" }),
    ];
  }
  if (["waiting", "error"].includes(c.phase)) return []; // voice-only: no buttons
  return [button({ word: t("wt.close"), icon: "x", kind: "secondary", block: true, onClick: () => { model.dismiss(c.key); if (onClose) onClose(); renderAll(); } })];
}

function cardSig(c, extra) {
  const d = c.data || {};
  const live = c.kind === "buy" ? d.view
    : c.kind === "bill" ? [sell.invoices.get(String(c.id)), sell.customers.size]
      : c.kind === "reorder" ? [itemOf(d.itemId), d.proposal, reorderQuestion.get(String(d.proposal && d.proposal.id))]
        : d.rule;
  const after = c.phase === "done" ? [state.orders.size, c.kind === "buy" ? [...state.orders.values()].filter((o) => String(o.approvalId) === String(c.id)) : null] : null;
  return JSON.stringify([lang(), c.phase, c.busy, c.say, c.fix, c.result, c.status, Boolean(c.spokenAt), live, after, openReadouts.has(c.key), extra]);
}

/** Keep focus on "the same control" across a rebuild. */
const FOCUS_SEL = [".yes-yes", ".yes-no", ".yes-readout-head", ".yes-links a", ".btn"];
function focusRole(root) {
  const a = document.activeElement;
  if (!a || !root.contains(a)) return null;
  return FOCUS_SEL.find((s) => a.matches(s)) || null;
}
function restoreFocus(root, sel) {
  if (!sel) return;
  const el = root.querySelector(`${sel}:not([disabled])`);
  if (el) el.focus({ preventScroll: true });
}

/* -------------------------------------------------------------- the host -- */

let sheet = null;      // { api, mode, key, id, sig }
let sheetSeq = 0;
let wantedKey = null;  // the card the owner or the server asked for

function listBody(cards) {
  return [
    scripted("p", t("wt.manyText"), { class: "yes-sentence" }),
    list(cards.map((c) => {
      const f = factsOf(c);
      const r = needsRow(c, f);
      const amt = amountText(f);
      return {
        icon: r.icon,
        title: r.line || t(r.lineKey),
        sub: [r.meta, r.simulated ? t("simulated") : null].filter(Boolean).join(", ") || null,
        end: amt ? h("span", { class: "amount num", text: amt }) : null,
        label: `${t(`wt.ask.${c.kind}`)} ${r.line || ""} ${amt || ""}`.trim(),
        onClick: () => { wantedKey = c.key; showHost(); },
      };
    }), { limit: 8, label: t("wt.allWaiting") }),
  ];
}

function hostContent(plan, cards) {
  if (plan.mode === "none") {
    const st = sourceStatus();
    if (st.failed.length) {
      const say = st.failed.map((x) => x.err && x.err.say).filter(Boolean)[0];
      return { title: t("wt.tray"), body: [errorLine(say || t("wt.loadFail")), button({ word: t("wt.retry"), icon: "refresh", kind: "secondary", onClick: () => st.failed.forEach((x) => x.retry()) })], footer: [] };
    }
    if (st.loading) return { title: t("wt.tray"), body: [skeleton("lines", 3)], footer: [] };
    return { title: t("wt.tray"), body: [emptyState({ icon: "inbox", title: t("wt.noneNow"), text: t("wt.noneText") })], footer: [] };
  }
  if (plan.mode === "list") return { title: t("wt.many", { n: cards.length }), body: listBody(cards), footer: [] };
  const c = cards.find((x) => x.key === plan.key);
  const f = factsOf(c);
  return {
    title: t(f.askKey),
    speakKey: speakKeyOf(c.kind, c.id, c.data && c.data.itemId),
    body: [
      cards.length > 1 ? h("button", { class: "link-btn yes-back", type: "button", on: { click: () => { wantedKey = null; showHost({ forceList: true }); } } },
        icon("chevronLeft", 18), h("span", { text: t("wt.allWaiting") })) : null,
      ...facts(c, f),
      ...status(c),
    ].filter(Boolean),
    footer: actions(c, { onClose: () => { if (sheet) sheet.api.close(); } }),
    card: c,
  };
}

/** Open (or refresh) the host for the current plan. */
function showHost({ forceList = false } = {}) {
  const cards = model.list();
  let plan = hostPlan(cards, wantedKey);
  if (forceList && cards.length > 1) plan = { mode: "list", key: null };
  // The card on screen was answered elsewhere (another tab, by voice) and nothing else waits: close.
  if (plan.mode === "none" && sheet && sheet.api.isOpen() && !sheet.ident.startsWith("none")) { sheet.api.close(); return; }
  const content = hostContent(plan, cards);
  const ident = `${plan.mode}|${plan.key || ""}|${lang()}`;
  const sig = JSON.stringify([ident, content.card ? cardSig(content.card, [cards.length, model.speaking() === content.card.key]) : cards.map((c) => [c.key, c.phase, cardSig(c)])]);
  if (sheet && sheet.api.isOpen() && sheet.ident === ident) {
    if (sheet.sig === sig) return;
    sheet.sig = sig;
    const panel = sheet.api.el;
    const role = focusRole(panel);
    sheet.api.setBody(content.body);
    sheet.api.setFooter(content.footer);
    restoreFocus(panel, role);
    return;
  }
  const id = ++sheetSeq;
  // Switching views reopens the sheet with its new title: the old sheet's onClose must not reset the host.
  const keepOpener = sheet && sheet.opener;
  sheet = null;
  const opener = keepOpener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const api2 = openSheet({
    title: content.title, body: content.body, footer: content.footer, speakKey: content.speakKey,
    opener,
    // Spec 03: on the Yes card a tap on the scrim does nothing; only No, Yes or the close X end it.
    scrimCloses: plan.mode !== "card",
    onClose: () => { if (sheet && sheet.id === id) { sheet = null; wantedKey = null; settleOnClose(); } },
  });
  sheet = { api: api2, id, ident, sig, hash: location.hash, opener };
}

/** Closing the host clears answered cards (their outcome was seen); waiting ones stay. */
function settleOnClose() {
  for (const c of model.list()) if (c.phase === "done" || c.phase === "declined" || c.phase === "gone") model.dismiss(c.key);
  renderAll();
}

/** Open the Needs host: the asked card, the only card, or the list. */
export function openNeeds(key = null) {
  ensureCss();
  wantedKey = key || null;
  showHost();
}

function editableFocused() {
  const a = document.activeElement;
  return Boolean(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
}

let deferredOpen = null;
/** D7: the server is reading this card out now; it opens (after the phone keyboard closes). */
function autoOpen(key) {
  if (!model.card(key)) return;
  if (editableFocused() && window.innerWidth < 768) { deferredOpen = key; return; }
  openNeeds(key);
}

/* ------------------------------------------------------------ inline cards -- */

const hosts = new Set(); // { el, key, sig, born }

/**
 * The Yes card for one waiting item inside a screen (Sell bills, Stock proposals, My Sahay rules,
 * the composer's typed-yes note). It follows the server until it leaves the page.
 */
export function createYesCard(item, { inline = true } = {}) {
  ensureCss();
  const key = typeof item === "string" ? item : item && item.key;
  const host = { el: h("div", { class: `yes-host${inline ? " is-inline" : ""}`, dataset: { key } }), key, sig: null, born: Date.now() };
  hosts.add(host);
  paintHost(host);
  return host.el;
}

function paintHost(host) {
  const c = model.card(host.key);
  if (!c) { if (host.sig !== "none") { host.sig = "none"; fill(host.el); host.el.hidden = true; } return; }
  host.el.hidden = false;
  const sig = cardSig(c, ["inline", model.speaking() === c.key]);
  if (sig === host.sig) return;
  host.sig = sig;
  const role = focusRole(host.el);
  const f = factsOf(c);
  const live = c.phase === "waiting" || c.phase === "error";
  fill(host.el, h("article", { class: `card yes-card${live ? " card-needs" : ""}${model.speaking() === c.key && live ? " is-now" : ""}`, dataset: { phase: c.phase } },
    h("div", { class: "card-head" },
      h("div", null,
        h("p", { class: "yes-kind" }, icon(iconOf(c.kind), 18), h("span", { text: t(`wt.kind.${c.kind}`) })),
        scripted("h3", t(f.askKey), { class: "card-title" })),
      speakKeyOf(c.kind, c.id, c.data && c.data.itemId) ? speakButton(speakKeyOf(c.kind, c.id, c.data && c.data.itemId)) : null),
    ...facts(c, f),
    ...status(c),
    h("div", { class: "card-foot yes-card-foot" }, ...actions(c))));
  restoreFocus(host.el, role);
}

/* ------------------------------------------------------------- Home rows -- */

const rowSubs = new Set();
let lastRowsSig = "";

/** Home's "Needs you" rows: icon, one line, the figure, the simulated label; open() shows the card. */
export function needsRows() {
  return model.list().filter((c) => c.phase === "waiting" || c.phase === "error" || c.phase === "saving").map((c) => {
    const f = factsOf(c);
    const r = needsRow(c, f);
    return { ...r, line: r.line || t(r.lineKey), ask: t(`wt.ask.${c.kind}`), amountText: amountText(f), open: () => openNeeds(c.key) };
  });
}
/** fn(rows) now and whenever the rows change. */
export function onNeedsRows(fn) {
  rowSubs.add(fn);
  try { fn(needsRows()); } catch (err) { console.error(err); }
  return () => rowSubs.delete(fn);
}

/* ---------------------------------------------------------------- render -- */

const countSubs = new Set();
let lastCount = -1;

function renderAll() {
  if (typeof document === "undefined") return;
  const n = model.count();
  if (n !== lastCount) {
    lastCount = n;
    setNeedsCount(n);
    for (const fn of countSubs) { try { fn(n); } catch (err) { console.error(err); } }
  }
  const rows = needsRows();
  const rs = JSON.stringify([lang(), rows.map((r) => [r.key, r.phase, r.line, r.meta, r.amountText, r.simulated])]);
  if (rs !== lastRowsSig) { lastRowsSig = rs; for (const fn of rowSubs) { try { fn(rows); } catch (err) { console.error(err); } } }
  if (sheet && sheet.api.isOpen()) showHost();
  for (const host of hosts) {
    if (!host.el.isConnected && (host.el.__mounted || Date.now() - host.born > 5000)) { hosts.delete(host); continue; }
    if (host.el.isConnected) host.el.__mounted = true;
    paintHost(host);
  }
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
  ensureCss();
  subscribe((_s, parts) => { if (PARTS.some((p) => parts.has(p))) schedule(); });
  onEvent((evt) => {
    if (evt && evt.type === "stock.reorder_proposed" && evt.data && evt.data.proposalId !== undefined && evt.data.question) {
      reorderQuestion.set(String(evt.data.proposalId), evt.data.question);
    }
    model.event(evt);
    ensureTimer();
    schedule();
  });
  // The shell's "Needs you (n)" button and #/needs (main.js turns the route into this call).
  // One door: the shell fires sahay:open-needs for its button and #/needs; Home fires it with { key } for Check.
  document.addEventListener("sahay:open-needs", (e) => openNeeds((e && e.detail && e.detail.key) || null));
  // Another screen puts the host away; the count stays in the top bar.
  window.addEventListener("hashchange", () => {
    if (/^#\/(needs|waiting)\b/.test(location.hash)) return;
    if (sheet && sheet.api.isOpen() && location.hash !== sheet.hash) sheet.api.close();
  });
  document.addEventListener("focusout", () => {
    if (!deferredOpen) return;
    setTimeout(() => { if (deferredOpen && !editableFocused()) { const k = deferredOpen; deferredOpen = null; openNeeds(k); } }, 250);
  });
  schedule();
}

start();

/* --------------------------------------------------------------- exports -- */

/** Every card the host holds, in host order. */
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
export const waitingCount = () => model.count();

/**
 * The composer's note when the owner types a yes while a card waits (rule 3): a typed yes never
 * counts. Returns the note with a button that opens that card, or null.
 */
export function typedYesHint(text) {
  if (!isTypedYes(text)) return null;
  const c = model.list().find((x) => (x.phase === "waiting" || x.phase === "error") && !(x.data && x.data.voiceOnly));
  if (!c) return null;
  return h("div", { class: "yes-typed", role: "note" },
    h("p", { class: "yes-typed-line" }, icon("keyboard", 20), h("span", { text: t("wt.typed") })),
    button({ word: t("wt.check"), icon: "check", kind: "primary", size: "sm", onClick: () => openNeeds(c.key) }));
}
