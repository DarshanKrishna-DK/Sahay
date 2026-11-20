// Sell (UI v4, Stitch 06-sell): the page head (display title, one plain line, "Make bill" on the
// right), then bills waiting for the owner's yes (the shared Yes card from waiting.js, D6), then
// "Recent bills" with Today / Not paid / All as receipts (status word, punch notches on the
// perforation, the total big, Send on WhatsApp or Add phone first, Open), and on the right the
// customers card (who owes, remind on WhatsApp) and the shop card. A bill opens its detail sheet
// (lines, GST split, total, PDF, pay page in test mode, WhatsApp). A bill refused for missing
// shop facts (GSTIN_REQUIRED / STATE_REQUIRED) shows the needs card. Data: store-sell.js.

import { h, patch, toDate, safeUrl } from "./dom.js";
import { t, when, addStrings } from "./i18n.js";
import { state as appState } from "./store.js";
import { yesNo, paper, perforation, pageHead, segmented } from "./ui.js";
import { sell, loadSell, decideInvoice, pendingInvoices, invoiceCustomer, itemOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { shopNeedCard, shopMissing, shopButton, shopSummary } from "./shop-settings.js";
import { SHOP_CODES } from "./shop-facts.js";
import { billStatus, gstRows, lineAmount, dueOf, filterBills, BILL_FILTERS } from "./sell-facts.js";
import { openAddPhone, remindOnWhatsApp } from "./money-pad.js";
import {
  ensureCss, money, qtyText, itemName, scriptedText, readButton, partState, buttonError, ask,
  alignNotches, ic, stamp, simTag, testTag, cardHead, screenState, resultLine, linkKey, panel, initial,
} from "./sell-kit.js";

addStrings({
  "sl.sub": ["Bills, WhatsApp and your customers", "बिल, WhatsApp और आपके ग्राहक", "ಬಿಲ್, WhatsApp ಮತ್ತು ನಿಮ್ಮ ಗ್ರಾಹಕರು"],
  "sl.makeBill": ["Make bill", "बिल बनाएँ", "ಬಿಲ್ ಮಾಡಿ"],
  "sl.recent": ["Recent bills", "हाल के बिल", "ಇತ್ತೀಚಿನ ಬಿಲ್‌ಗಳು"],
  "sl.filterLabel": ["Show bills", "कौन से बिल दिखाएँ", "ಯಾವ ಬಿಲ್ ತೋರಿಸಲಿ"],
  "sl.f.today": ["Today ({n})", "आज ({n})", "ಇಂದು ({n})"],
  "sl.f.unpaid": ["Not paid ({n})", "पैसे बाकी ({n})", "ಹಣ ಬಾಕಿ ({n})"],
  "sl.f.all": ["All ({n})", "सभी ({n})", "ಎಲ್ಲಾ ({n})"],
  "sl.none.today": ["No bills made today.", "आज कोई बिल नहीं बना।", "ಇಂದು ಯಾವ ಬಿಲ್ಲೂ ಆಗಿಲ್ಲ."],
  "sl.none.unpaid": ["Every bill is paid.", "सब बिलों के पैसे मिल गए।", "ಎಲ್ಲಾ ಬಿಲ್‌ಗಳ ಹಣ ಬಂದಿದೆ."],
  "sl.none.all": ["No bills yet.", "अभी कोई बिल नहीं।", "ಇನ್ನೂ ಬಿಲ್ ಇಲ್ಲ."],
  "sl.showAllBills": ["Show all bills", "सभी बिल दिखाएँ", "ಎಲ್ಲಾ ಬಿಲ್ ತೋರಿಸಿ"],
  "sl.sendWa": ["Send on WhatsApp", "WhatsApp पर भेजें", "WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಿ"],
  "sl.totalGst": ["Total (GST {amt})", "कुल (GST {amt})", "ಒಟ್ಟು (GST {amt})"],
  "sl.totalNoGst": ["Total, no GST", "कुल, GST नहीं", "ಒಟ್ಟು, GST ಇಲ್ಲ"],
  "sl.paidAll": ["Paid in full", "पूरे पैसे मिले", "ಪೂರ್ತಿ ಹಣ ಬಂದಿದೆ"],
  "sl.dueWord": ["due", "बाकी", "ಬಾಕಿ"],
  "sl.nothingDue": ["Nothing due", "कुछ बाकी नहीं", "ಏನೂ ಬಾಕಿ ಇಲ್ಲ"],
  "sl.showAll": ["Show all {n} customers", "सभी {n} ग्राहक दिखाएँ", "ಎಲ್ಲಾ {n} ಗ್ರಾಹಕರನ್ನು ತೋರಿಸಿ"],
  "sl.showFewer": ["Show fewer", "कम दिखाएँ", "ಕಡಿಮೆ ತೋರಿಸಿ"],
  "sl.waiting": ["Waiting for your yes", "आपकी हाँ का इंतज़ार", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿವೆ"],
  "sl.group.unpaid": ["Not paid yet", "पैसे बाकी", "ಹಣ ಬಾಕಿ"],
  "sl.group.draft": ["Not made yet", "अभी नहीं बने", "ಇನ್ನೂ ಆಗಿಲ್ಲ"],
  "sl.group.paid": ["Paid", "पैसे मिले", "ಹಣ ಬಂದಿದೆ"],
  "sl.group.cancelled": ["Cancelled", "रद्द", "ರದ್ದಾದವು"],
  "sl.open": ["Open", "खोलें", "ತೆರೆಯಿರಿ"],
  "sl.openLong": ["Open the bill for {name}", "{name} का बिल खोलें", "{name} ಅವರ ಬಿಲ್ ತೆರೆಯಿರಿ"],
  "sl.noNumber": ["No bill number yet", "अभी बिल नंबर नहीं", "ಇನ್ನೂ ಬಿಲ್ ಸಂಖ್ಯೆ ಇಲ್ಲ"],
  "sl.due": ["{amt} due", "{amt} बाकी", "{amt} ಬಾಕಿ"],
  "sl.paidPart": ["{amt} paid", "{amt} मिले", "{amt} ಬಂತು"],
  "sl.taxable": ["Before tax", "टैक्स से पहले", "ತೆರಿಗೆ ಮೊದಲು"],
  "sl.cgst": ["CGST", "CGST", "CGST"],
  "sl.sgst": ["SGST", "SGST", "SGST"],
  "sl.igst": ["IGST", "IGST", "IGST"],
  "sl.taxTotal": ["GST", "GST", "GST"],
  "sl.kind.plain": ["Plain bill", "सादा बिल", "ಸಾದಾ ಬಿಲ್"],
  "sl.billOf": ["Bill {no}", "बिल {no}", "ಬಿಲ್ {no}"],
  "sl.billFor": ["Bill for {name}", "{name} का बिल", "{name} ಅವರ ಬಿಲ್"],
  "sl.sold": ["What was sold", "क्या बिका", "ಏನು ಮಾರಾಯಿತು"],
  "sl.noLines": ["This bill has no items yet.", "इस बिल में अभी कोई चीज़ नहीं।", "ಈ ಬಿಲ್‌ನಲ್ಲಿ ಇನ್ನೂ ವಸ್ತು ಇಲ್ಲ."],
  "sl.noPhone": ["No phone", "फ़ोन नहीं", "ಫೋನ್ ಇಲ್ಲ"],
  "sl.gone": ["This bill is not here any more.", "यह बिल अब यहाँ नहीं है।", "ಈ ಬಿಲ್ ಈಗ ಇಲ್ಲಿ ಇಲ್ಲ."],
  "sl.whatsapp": ["WhatsApp", "WhatsApp", "WhatsApp"],
  "sl.noShare": ["WhatsApp needs this customer's phone number.", "WhatsApp के लिए ग्राहक का फ़ोन नंबर चाहिए।", "WhatsApp ಗೆ ಗ್ರಾಹಕರ ಫೋನ್ ಸಂಖ್ಯೆ ಬೇಕು."],
  "sl.say.waiting": ["{n} bills wait for your yes.", "{n} बिल आपकी हाँ का इंतज़ार कर रहे हैं।", "{n} ಬಿಲ್‌ಗಳು ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿವೆ."],
  "sl.say.unpaid": ["{n} bills are not paid yet, {amt} in all.", "{n} बिलों के पैसे बाकी हैं, कुल {amt}।", "{n} ಬಿಲ್‌ಗಳ ಹಣ ಬಾಕಿ ಇದೆ, ಒಟ್ಟು {amt}."],
  "sl.say.clear": ["Every bill is paid.", "सब बिलों के पैसे मिल गए।", "ಎಲ್ಲಾ ಬಿಲ್‌ಗಳ ಹಣ ಬಂದಿದೆ."],
  "sl.say.empty": ["No bills yet. Press Make a bill and say who bought what.", "अभी कोई बिल नहीं। बिल बनाएँ दबाकर बोलिए किसने क्या खरीदा।", "ಇನ್ನೂ ಬಿಲ್ ಇಲ್ಲ. ಬಿಲ್ ಮಾಡಿ ಒತ್ತಿ ಯಾರು ಏನು ಕೊಂಡರು ಹೇಳಿ."],
});

function customerName(inv) {
  const c = invoiceCustomer(inv);
  return (c && c.name) || st("sell.walkin");
}

function lineName(l) {
  const it = itemOf(l.itemId);
  return itemName(it || { name: l.name, nameNative: l.nameNative }) || l.name || "";
}

const hasPrice = (l) => l.unitPrice !== null && l.unitPrice !== undefined;
const kindWord = (inv) => (inv.kind === "tax_invoice" || inv.kind === "bill_of_supply" ? st(`sell.kind.${inv.kind}`) : st("sl.kind.plain"));
const billDate = (inv) => toDate(inv.issuedAt || inv.createdAt);
/** WhatsApp only for a customer with a phone; otherwise the owner adds one first (D14). */
const hasPhone = (inv) => { const c = invoiceCustomer(inv); return Boolean(c && c.phone); };
function addPhoneKey(inv, { size = "sm", block = false } = {}) {
  const name = customerName(inv);
  return h("button", {
    class: `keycap keycap-primary keycap-${size}${block ? " keycap-block" : ""} sl-add-phone`, type: "button", "aria-label": st("mn.addPhoneLong", { name }),
    on: { click: (e) => openAddPhone({ name, opener: e.currentTarget }) },
  }, ic("phone", 22), h("span", { text: st("mn.addPhone") }));
}
const pdfHref = (inv) => inv.pdfUrl || `/api/invoices/${encodeURIComponent(inv.id)}/pdf`;

/* ------------------------------------------------- the shared Yes card -- */

// The one Yes card renderer is W3's waiting.js (spec 5.2: renderCard(item, { place: "inline" })).
// Loaded lazily so Sell still works on a build without it; until it answers, a bill waiting here
// uses the small card below (same route, same rules).
let waiting = null;
let waitingAsked = false;
function askWaiting(onReady) {
  if (waitingAsked) return;
  waitingAsked = true;
  import("./waiting.js").then((m) => {
    if (m && typeof m.renderCard === "function" && typeof m.waitingItems === "function") { waiting = m; onReady(); }
  }).catch(() => { waiting = null; });
}

// renderCard() returns a live element that follows the server by itself: keep one per bill.
const sharedEls = new Map();
function sharedCard(inv) {
  if (!waiting) return null;
  const key = `invoice:${inv.id}`;
  if (sharedEls.has(key)) return sharedEls.get(key);
  try {
    const item = waiting.waitingItems().find((i) => i.key === key);
    if (!item) return null;
    const el = waiting.renderCard(item, { place: "inline" });
    sharedEls.set(key, el);
    return el;
  } catch { return null; }
}
/** A second, separate live card for the bill detail sheet (an element lives in one place only). */
function sheetCard(inv) {
  if (!waiting) return null;
  try {
    const item = waiting.waitingItems().find((i) => i.key === `invoice:${inv.id}`);
    return item ? waiting.renderCard(item, { place: "sheet" }) : null;
  } catch { return null; }
}
function pruneShared() {
  const live = new Set(pendingInvoices().map((i) => `invoice:${i.id}`));
  for (const key of [...sharedEls.keys()]) if (!live.has(key)) sharedEls.delete(key);
}

function gstBlock(tot, { compact = false } = {}) {
  const g = gstRows(tot);
  if (g.kind === "unknown") return null;
  if (g.kind === "none") return h("p", { class: "note-line sl-gst-none" }, ic("info", 18), h("span", { text: st("sell.noGst") }));
  const rows = compact ? g.rows.filter((r) => r.key !== "taxable") : g.rows;
  return h("dl", { class: `sl-gst${compact ? " sl-gst-compact" : ""}` },
    ...rows.map((r) => h("div", { class: `sl-gst-row sl-gst-${r.key}` }, h("dt", { text: st(`sl.${r.key}`) }), h("dd", { text: money(r.amount) }))),
    g.kind === "total" || !compact ? h("div", { class: "sl-gst-row sl-gst-tax" }, h("dt", { text: st("sl.taxTotal") }), h("dd", { text: money(g.tax) })) : null);
}

function linesList(inv, max = 4) {
  const lines = inv.lines || [];
  if (!lines.length) return null;
  return h("ul", { class: "sl-lines" },
    ...lines.slice(0, max).map((l) => {
      const amt = lineAmount(l);
      return h("li", { class: "sl-line" },
        scriptedText("span", lineName(l), { class: "sl-line-name" }),
        h("span", { class: "sl-line-qty" },
          h("span", { text: qtyText(l.qty, l.unit) }),
          hasPrice(l) ? h("span", { class: "sl-x", "aria-hidden": "true", text: "×" }) : null,
          hasPrice(l) ? h("span", { text: money(l.unitPrice) }) : null),
        amt !== null ? h("span", { class: "sl-line-amt", text: money(amt) }) : null);
    }),
    lines.length > max ? h("li", { class: "sl-line sl-line-more", text: st("sell.more", { n: lines.length - max }) }) : null);
}

/** A waiting bill when the shared Yes card is not on this build: the same route and rules. */
function fallbackYes(inv, ui, onDecide) {
  const id = String(inv.id);
  const u = ui.get(id) || {};
  const tot = inv.totals || {};
  const titleId = `sl-yes-${id}`;
  return h("article", { class: "card card-now sl-yes", "aria-labelledby": titleId, dataset: { id } },
    cardHead(st("inv.yes.title"), readButton(`invoice:${id}`), { id: titleId, lead: h("span", { class: "sl-yes-bell", "aria-hidden": "true" }, ic("bell", 22)) }),
    h("p", { class: "sl-who" }, ic("user", 20), scriptedText("span", customerName(inv), { class: "sl-who-name" }), inv.simulated ? simTag() : null),
    linesList(inv, 4),
    gstBlock(tot, { compact: true }),
    h("p", { class: "sl-yes-total" }, h("span", { class: "sl-total-word", text: st("sell.total") }), h("span", { class: "bignum bignum-total", text: money(tot.total) })),
    inv.readback ? scriptedText("p", inv.readback, { class: "sl-readback" }) : null,
    u.fix ? shopNeedCard(u.fix, u.error) : u.error ? resultLine("error", u.error) : null,
    yesNo({
      busy: u.busy || null,
      yesWord: st("inv.yes.approve"), noWord: st("inv.yes.reject"),
      yesLabel: st("inv.yes.approveLong"), noLabel: st("inv.yes.rejectLong"),
      onYes: () => onDecide(id, "approve"), onNo: () => onDecide(id, "reject"),
    }),
    u.busy ? h("p", { class: "sr-only", role: "status", text: st("inv.yes.saving") }) : null);
}

/* ------------------------------------------------------------ receipts -- */

const STATUS_ICON = { draft: "doc", pending: "bell", issued: "clock", part_paid: "clock", paid: "checkCircle", cancelled: "ban" };

/**
 * A bill as a receipt (Stitch 06-sell): status word on top (icon + colour), the bill number and
 * the speaker on the right, the customer, time and kind, up to four lines, the perforation with its
 * punch notches, the total big, then the one thing to do: send on WhatsApp (or add the phone
 * first), or the paid line with the PDF. The whole slip opens the bill.
 */
function billCard(inv, onOpen) {
  const status = billStatus(inv);
  const tot = inv.totals || {};
  const name = customerName(inv);
  const made = billDate(inv);
  const unpaid = status === "issued" || status === "part_paid";
  const due = dueOf(inv);
  const lines = inv.lines || [];
  const g = gstRows(tot);
  const titleId = `sl-bill-${inv.id}`;
  const openBtn = h("button", { class: "keycap keycap-ghost keycap-sm sl-open", type: "button", "aria-label": st("sl.openLong", { name }), on: { click: (e) => onOpen(inv.id, e.currentTarget) } },
    ic("doc", 20), h("span", { text: st("sl.open") }));
  let main = null;
  if (unpaid) {
    main = hasPhone(inv) && safeUrl(inv.shareUrl)
      ? linkKey({ href: inv.shareUrl, icon: "chat", word: st("sl.sendWa"), label: st("sell.shareLong"), tone: "secondary", size: "md", cls: "sl-wa" })
      : addPhoneKey(inv, { size: "md" });
  } else if (status === "paid") {
    main = linkKey({ href: pdfHref(inv), icon: "download", word: st("sell.pdf"), label: st("sell.pdfLong"), tone: "ghost", size: "sm" });
  }
  const totalWord = g.kind === "none" ? st("sl.totalNoGst") : g.tax ? st("sl.totalGst", { amt: money(g.tax) }) : st("sell.total");
  const card = paper({ class: `sl-bill sl-bill-${status}`, tone: status === "paid" ? "paid" : unpaid ? "due" : null, dataset: { id: inv.id }, "aria-labelledby": titleId },
    h("div", { class: "sl-bill-top" },
      h("p", { class: `t-label sl-bill-state sl-state-${status}` }, ic(STATUS_ICON[status] || "doc", 16), h("span", { text: st(`sell.status.${status}`) })),
      inv.number ? h("span", { class: "sl-bill-no", text: `#${inv.number}` }) : null,
      h("span", { class: "card-speak" }, readButton(`invoice:${inv.id}`))),
    scriptedText("h3", name, { class: "t-h3 sl-bill-name", id: titleId }),
    h("p", { class: "sl-bill-meta" },
      made ? h("span", { class: "sl-bill-when" }, ic("clock", 18), h("span", { text: when(made, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })) : null,
      h("span", { class: "sl-bill-kind", text: kindWord(inv) })),
    lines.length
      ? h("ul", { class: "sl-bill-lines" },
        ...lines.slice(0, 4).map((l) => {
          const amt = lineAmount(l);
          return h("li", {},
            h("span", { class: "sl-bl-what" }, h("span", { class: "sl-bl-qty", text: qtyText(l.qty, l.unit) }), scriptedText("span", lineName(l), { class: "sl-bl-name" })),
            amt !== null ? h("span", { class: "sl-bl-amt", text: money(amt) }) : null);
        }),
        lines.length > 4 ? h("li", { class: "sl-bl-more", text: st("sell.more", { n: lines.length - 4 }) }) : null)
      : h("p", { class: "note-line" }, ic("info", 18), h("span", { text: st("sl.noLines") })),
    perforation(),
    h("div", { class: "sl-bill-total" },
      h("p", { class: "sl-bill-total-word", text: totalWord }),
      h("p", { class: "t-money sl-bill-amt", text: money(tot.total) })),
    status === "part_paid" && due !== null ? h("p", { class: "sl-bill-due" }, ic("clock", 18), h("span", { text: st("sl.due", { amt: money(due) }) })) : null,
    status === "paid" ? h("p", { class: "sl-bill-paid" }, ic("checkCircle", 18), h("span", { text: st("sl.paidAll") })) : null,
    h("div", { class: "sl-bill-acts" }, main, openBtn));
  // The whole receipt opens the bill; its own buttons and links keep their jobs.
  card.addEventListener("click", (e) => { if (!e.target.closest("a, button")) onOpen(inv.id, openBtn); });
  return h("li", { class: "sl-bill-slot" }, card);
}

/* --------------------------------------------------------- bill detail -- */

let detail = null; // { id, api, key }

function detailBody(inv, ui, onDecide) {
  if (!inv) return screenState({ kind: "missing", icon: "receipt", title: st("sl.gone"), compact: true });
  const status = billStatus(inv);
  const tot = inv.totals || {};
  const name = customerName(inv);
  const cust = invoiceCustomer(inv);
  const made = billDate(inv);
  const due = dueOf(inv);
  const lines = inv.lines || [];
  const pending = status === "pending";
  return [
    h("div", { class: "sl-detail-top" },
      stamp(status, { big: true }),
      h("p", { class: "sl-detail-kind" }, h("b", { text: kindWord(inv) }), made ? h("span", { text: when(made, { day: "numeric", month: "long", year: "numeric" }) }) : null)),
    h("div", { class: "sl-detail-who" },
      scriptedText("span", initial(name), { class: "sl-avatar", "aria-hidden": "true" }),
      h("div", { class: "sl-detail-whomain" },
        scriptedText("p", name, { class: "sl-detail-name" }),
        cust && cust.phone ? h("p", { class: "sl-phone" }, ic("phone", 18), h("span", { text: cust.phone }))
          : h("p", { class: "sl-phone is-none" }, ic("phone", 18), h("span", { text: st("sl.noPhone") }))),
      inv.simulated ? simTag() : null),
    h("section", { class: "sl-detail-lines", "aria-label": st("sl.sold") },
      h("h3", { class: "sl-detail-h", text: st("sl.sold") }),
      lines.length ? linesList(inv, 50) : h("p", { class: "note-line" }, ic("info", 18), h("span", { text: st("sl.noLines") }))),
    h("div", { class: "sl-detail-sum" },
      gstBlock(tot),
      h("p", { class: "sl-detail-total" }, h("span", { class: "sl-total-word", text: st("sell.total") }), h("span", { class: "bignum bignum-total", text: money(tot.total) })),
      status === "part_paid" && inv.paid ? h("p", { class: "sl-detail-paid" }, ic("checkCircle", 18), h("span", { text: st("sl.paidPart", { amt: money(inv.paid) }) })) : null,
      (status === "part_paid" || status === "issued") && due ? h("p", { class: "sl-bill-due" }, ic("clock", 18), h("span", { text: st("sl.due", { amt: money(due) }) })) : null),
    pending ? (((ui.get(String(inv.id)) || {}).fix ? null : sheetCard(inv)) || fallbackYes(inv, ui, onDecide)) : null,
  ];
}

function detailFooter(inv) {
  if (!inv) return null;
  const status = billStatus(inv);
  if (!(status === "issued" || status === "part_paid" || status === "paid")) return null;
  const unpaid = status !== "paid";
  const share = unpaid && hasPhone(inv) ? linkKey({ href: inv.shareUrl, icon: "chat", word: st("sell.shareLong"), tone: "primary", size: "md", cls: "keycap-block" }) : null;
  return h("div", { class: "sl-detail-acts" },
    share || (unpaid ? [h("p", { class: "note-line" }, ic("phone", 18), h("span", { text: st("sl.noShare") })), addPhoneKey(inv, { size: "md", block: true })] : null),
    h("div", { class: "sl-detail-acts-row" },
      linkKey({ href: pdfHref(inv), icon: "download", word: st("sell.pdf"), label: st("sell.pdfLong"), size: "md" }),
      unpaid ? linkKey({ href: inv.payUrl, icon: "rupee", word: st("sell.pay"), label: st("sell.payLong"), size: "md" }) : null,
      unpaid && inv.payUrl ? testTag() : null));
}

function detailTitle(inv) {
  if (!inv) return st("sell.bills");
  return inv.number ? st("sl.billOf", { no: inv.number }) : st("sl.billFor", { name: customerName(inv) });
}

/* ------------------------------------------------------------ customers -- */

const CUSTOMERS_SHOWN = 6;

/**
 * The customers card (Stitch 06-sell, right column): name (two lines at most, never cut short),
 * phone or "No phone", what they owe or "Nothing due", and for a customer who owes: remind on
 * WhatsApp, or add the phone first. The server reads the list aloud (key `customers`).
 */
function customersCard(owedBy, cui, handlers, showAll) {
  const list = [...sell.customers.values()].sort((a, b) => (owedBy.get(b.id) || 0) - (owedBy.get(a.id) || 0) || String(a.name || "").localeCompare(String(b.name || "")));
  const shown = showAll ? list : list.slice(0, CUSTOMERS_SHOWN);
  return h("article", { class: "card sl-customers", "aria-labelledby": "sl-cust-h" },
    h("header", { class: "card-head" },
      h("h2", { class: "t-h3 sl-side-title", id: "sl-cust-h" }, h("span", { text: st("sell.customers") }), list.length ? h("span", { class: "sl-side-count", text: String(list.length) }) : null),
      list.length ? h("span", { class: "card-speak" }, readButton("customers")) : null),
    list.length
      ? h("ul", { class: "sl-people" }, ...shown.map((c) => {
        const owes = owedBy.get(c.id) || 0;
        const u = cui.get(String(c.id)) || {};
        const act = !owes ? null
          : c.phone
            ? h("button", {
              class: "icon-btn sl-remind", type: "button", "aria-busy": u.busy ? "true" : undefined,
              "aria-label": st("money.remindLong", { name: c.name || "" }), dataset: { tip: st("money.remind") },
              on: { click: () => handlers.remind(String(c.id)) },
            }, u.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : ic("chat", 22))
            : h("button", {
              class: "icon-btn sl-addphone", type: "button", "aria-label": st("mn.addPhoneLong", { name: c.name || "" }), dataset: { tip: st("mn.addPhone") },
              on: { click: (e) => openAddPhone({ name: c.name || "", opener: e.currentTarget }) },
            }, ic("phone", 22));
        return h("li", { class: `sl-person${owes ? " is-due" : ""}` },
          h("div", { class: "sl-person-main" },
            scriptedText("p", c.name || "", { class: "sl-person-name" }),
            c.phone ? h("p", { class: "sl-phone" }, h("span", { text: c.phone }))
              : h("p", { class: "sl-phone is-none" }, ic("phone", 16), h("span", { text: st("sl.noPhone") }))),
          h("div", { class: "sl-person-end" },
            owes
              ? [h("p", { class: "t-money sl-owes", text: money(owes) }), h("p", { class: "sl-owes-word", text: st("sl.dueWord") })]
              : h("p", { class: "sl-clear" }, ic("check", 16), h("span", { text: st("sl.nothingDue") }))),
          act,
          u.opened ? resultLine("ok", st("mn.opened")) : null,
          u.link ? h("div", { class: "sl-person-note" }, resultLine("error", st("mn.blocked")),
            linkKey({ href: u.link, icon: "external", word: st("money.openWhatsapp"), tone: "primary", size: "sm" })) : null,
          u.error ? resultLine("error", u.error) : null);
      }))
      : h("p", { class: "note-line" }, ic("users", 18), h("span", { text: st("sell.noCustomers") })),
    list.length > CUSTOMERS_SHOWN
      ? h("button", { class: "keycap keycap-ghost keycap-sm sl-more-people", type: "button", "aria-expanded": String(showAll), on: { click: handlers.toggleAll } },
        ic(showAll ? "chevronUp" : "chevronDown", 20), h("span", { text: showAll ? st("sl.showFewer") : st("sl.showAll", { n: list.length }) }))
      : null);
}

/* --------------------------------------------------------------- screen -- */

let billFilter = null; // "today" | "unpaid" | "all"; null = Today when there are bills today, else All
let showAllCustomers = false;

export function createSell() {
  ensureCss();
  const el = h("section", { class: "sell sl-screen", "aria-labelledby": "sell-title" });
  const head = h("div", { class: "sl-headslot" });
  const body = h("div", { class: "sl-body" });
  el.append(head, body);
  const ui = new Map(); // invoiceId -> { busy: "yes" | "no", error, fix, shop }
  const cui = new Map(); // customerId -> { busy, opened, link, error } (remind)
  askWaiting(() => render(true));

  async function decide(id, decision) {
    ui.set(id, { busy: decision === "approve" ? "yes" : "no" });
    render(true);
    try {
      await decideInvoice(id, decision);
      ui.delete(id);
    } catch (err) {
      // A bill refused for missing shop details (no GSTIN / no state) shows the Shop details card.
      if (SHOP_CODES.includes(err.code)) ui.set(id, { error: err.say || st(`shop.need.${err.code}`), fix: err.code, shop: JSON.stringify(sell.settings) });
      else ui.set(id, { error: err.status === 409 ? st("sbx.err.gone") : `${st("inv.yes.error")} ${buttonError(err)}`.trim() });
    }
    render(true);
  }

  const handlers = {
    async remind(id) {
      cui.set(id, { busy: true });
      render(true);
      try { cui.set(id, await remindOnWhatsApp(id)); } catch (err) { cui.set(id, { error: err.message }); }
      render(true);
    },
    toggleAll() { showAllCustomers = !showAllCustomers; render(true); },
  };

  function openBill(id, opener) {
    const inv = sell.invoices.get(String(id)) || null;
    const api = panel({ title: detailTitle(inv), body: detailBody(inv, ui, decide), footer: detailFooter(inv), opener, onClose: () => { detail = null; }, speakKey: inv ? `invoice:${inv.id}` : undefined });
    detail = { id: String(id), api, key: null };
  }

  function refreshDetail() {
    if (!detail) return;
    if (!detail.api.isOpen()) { detail = null; return; }
    const inv = sell.invoices.get(detail.id) || null;
    const key = JSON.stringify([document.documentElement.lang, inv, [...ui.entries()], waiting ? 1 : 0]);
    if (detail.key === null) { detail.key = key; return; }
    if (key === detail.key) return;
    detail.key = key;
    detail.api.setBody(detailBody(inv, ui, decide));
    detail.api.setFooter(detailFooter(inv));
  }

  function headSentence() {
    const invoices = [...sell.invoices.values()];
    if (!invoices.length) return st("sl.say.empty");
    const pending = pendingInvoices().length;
    const unpaid = invoices.filter((i) => ["issued", "part_paid"].includes(billStatus(i)));
    const owed = unpaid.reduce((s, i) => s + (dueOf(i) || 0), 0);
    return [
      pending ? st("sl.say.waiting", { n: pending }) : "",
      unpaid.length ? st("sl.say.unpaid", { n: unpaid.length, amt: money(owed) }) : st("sl.say.clear"),
    ].join(" ").trim();
  }

  function makeBill() {
    return h("button", { class: "keycap keycap-primary keycap-lg sl-make", type: "button", on: { click: () => ask({ hint: "sell.hint" }) } },
      ic("plus", 24), h("span", { text: st("sl.makeBill") }));
  }

  function billsSection(invoices) {
    const first = filterBills(invoices, "all");
    const filter = billFilter || (first.counts.today ? "today" : "all");
    const { bills, counts } = filterBills(invoices, filter);
    const pick = (id) => { billFilter = id; render(true); };
    return h("section", { class: "sl-bills", "aria-labelledby": "sl-bills-h" },
      h("div", { class: "sl-bills-head" },
        h("h2", { class: "section-title sl-h2", id: "sl-bills-h" }, h("span", { text: st("sl.recent") })),
        counts.all ? segmented({
          label: st("sl.filterLabel"),
          value: filter,
          onPick: pick,
          options: BILL_FILTERS.map((id) => ({ id, word: st(`sl.f.${id}`, { n: counts[id] }) })),
        }) : null),
      bills.length
        ? h("ol", { class: "sl-receipts" }, ...bills.map((inv) => billCard(inv, openBill)))
        : counts.all
          ? h("div", { class: "sl-filtered-none" },
            h("p", { class: "note-line" }, ic("info", 18), h("span", { text: st(`sl.none.${filter}`) })),
            h("button", { class: "keycap keycap-secondary keycap-sm", type: "button", on: { click: () => pick("all") } }, ic("receipt", 20), h("span", { text: st("sl.showAllBills") })))
          : h("p", { class: "note-line" }, ic("info", 18), h("span", { text: st("sell.empty.text") })));
  }

  function render(force = false) {
    const invoices = [...sell.invoices.values()];
    const ready = sell.status === "ready";
    const empty = ready && !invoices.length && !sell.customers.size;
    patch(head, JSON.stringify([document.documentElement.lang, sell.status, empty]), () => pageHead({
      title: t("nav.sell"),
      sub: st("sl.sub"),
      actions: ready ? [makeBill(), empty ? null : shopButton({ size: "md" }), readButton("sell-head", headSentence)].filter(Boolean) : [],
    }));
    const h1 = head.querySelector(".page-title");
    if (h1) h1.id = "sell-title";
    if (force) body.__key = null;
    const need = shopMissing();
    // Once the shop details change (saved from the sheet), a bill's "add shop details" note goes.
    for (const [id, u] of ui) if (u.fix && u.shop !== JSON.stringify(sell.settings)) ui.delete(id);
    const key = JSON.stringify([document.documentElement.lang, sell.status, need, invoices, [...sell.customers.values()], sell.owed, sell.settings, [...ui.entries()], [...cui.entries()], billFilter, showAllCustomers, waiting ? 1 : 0]);
    patch(body, key, () => {
      const s = partState(sell, { which: "sell", reload: () => loadSell() });
      if (s) return s;
      if (empty) {
        return [need ? shopNeedCard(need) : null, screenState({ kind: "empty", icon: "receipt", title: st("sell.empty.title"), text: st("sell.empty.text"),
          action: { label: st("sl.makeBill"), icon: "mic", run: () => ask({ hint: "sell.hint" }) } })];
      }
      const pending = pendingInvoices();
      pruneShared();
      const owedBy = new Map(sell.owed.map((o) => [o.customerId, o.amount]));
      return [
        need ? shopNeedCard(need) : null,
        pending.length ? h("section", { class: "sl-waiting", "aria-labelledby": "sl-waiting-h" },
          h("h2", { class: "section-title sl-h2", id: "sl-waiting-h" }, h("span", { text: st("sl.waiting") }), h("span", { class: "sl-h2-count", text: String(pending.length) })),
          h("div", { class: "sl-waiting-cards" }, ...pending.map((inv) => {
            const u = ui.get(String(inv.id)) || {};
            // A refusal for shop facts is this screen's to show; otherwise the shared card.
            return (!u.fix && sharedCard(inv)) || fallbackYes(inv, ui, decide);
          }))) : null,
        h("div", { class: "sl-cols" },
          billsSection(invoices),
          h("aside", { class: "sl-side", "aria-label": `${st("sell.customers")}, ${st("shop.yours")}` },
            customersCard(owedBy, cui, handlers, showAllCustomers),
            shopSummary())),
      ];
    });
    alignNotches(body);
    refreshDetail();
  }

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && appState.boot === "ready") loadSell();
      if (parts.has("all") || parts.has("lang") || parts.has("sell") || parts.has("stock")) render(parts.has("lang"));
    },
    enter: () => {
      if (sell.status === "idle" || sell.status === "error" || sell.status === "missing") loadSell();
    },
  };
}
