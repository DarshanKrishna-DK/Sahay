// Sell (UI v5, screens.md section 05): the page pattern.
//   1. "Sell" + "Make a GST bill and send it on WhatsApp." + ONE primary "Make a bill" (starts the
//      call where the owner is, with the bill hint) and a small "Your shop" link (shop / GST sheet);
//   2. "Needs you", only when a bill waits for the owner's yes (W3's Yes card, createYesCard with
//      the item from waitingItems(); Check -> openNeeds(key) when W3 does not hold it yet) or the
//      shop details are missing;
//   3. one list card with Bills | Customers. Bill rows: customer, bill no. and date, amount, Paid /
//      Not paid, and one action (Send on WhatsApp, or Add phone first). Customer rows: name, phone,
//      what they owe. A row opens a sheet: the bill (lines, GST split, total, PDF, pay page in test
//      mode) or the customer (Got paid, Remind).
// Data: store-sell.js; rules: sell-facts.js (node:test). Styles: css/sell.css.

import { h, icon, scripted, patch, safeUrl, toDate, money, qtyText, itemName, button, pageHead, section, card, emptyState, skeleton, segmented, openSheet } from "./ui.js";
import { t, when, addStrings } from "./i18n.js";
import { state as appState } from "./store.js";
import { sell, loadSell, pendingInvoices, invoiceCustomer, itemOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { billStatus, gstRows, lineAmount, dueOf, filterBills, shortBillNo } from "./sell-facts.js";
import { shopMissing, shopNeedCard, shopLink } from "./shop-settings.js";
import { addPhoneButton, openCustomerSheet } from "./money-pad.js";
import { dataRow, rowsCard, statusWord, warnWord } from "./sell-rows.js";
import { createYesCard, waitingItems, openNeeds, onCount } from "./yes.js";

addStrings({
  "sl5.sentence": ["Make a GST bill and send it on WhatsApp.", "GST बिल बनाइए और WhatsApp पर भेजिए।", "GST ಬಿಲ್ ಮಾಡಿ, WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಿ."],
  "sl5.show": ["Show", "दिखाएँ", "ತೋರಿಸಿ"],
  "sl5.customers": ["Customers", "ग्राहक", "ಗ್ರಾಹಕರು"],
  "sl5.noBills": ["No bills yet.", "अभी कोई बिल नहीं।", "ಇನ್ನೂ ಬಿಲ್ ಇಲ್ಲ."],
  "sl5.noCustomers": ["No customers yet.", "अभी कोई ग्राहक नहीं।", "ಇನ್ನೂ ಗ್ರಾಹಕರಿಲ್ಲ."],
  "sl5.noPhone": ["No phone yet", "फ़ोन नहीं", "ಫೋನ್ ಇಲ್ಲ"],
  "sl5.owes": ["Owes you", "बाकी", "ಬಾಕಿ"],
  "sl5.nothingDue": ["Nothing due", "कुछ बाकी नहीं", "ಏನೂ ಬಾಕಿ ಇಲ್ಲ"],
  "sl5.openCustomer": ["Open {name}", "{name} खोलें", "{name} ತೆರೆಯಿರಿ"],
  "sl5.make": ["Make a bill", "बिल बनाएँ", "ಬಿಲ್ ಮಾಡಿ"],
  "sl5.needs": ["Needs you", "आपकी ज़रूरत", "ನಿಮ್ಮ ಗಮನ ಬೇಕು"],
  "sl5.waits": ["Bill for {name} waits for your yes", "{name} का बिल आपकी हाँ का इंतज़ार कर रहा है", "{name} ಅವರ ಬಿಲ್ ನಿಮ್ಮ ಒಪ್ಪಿಗೆಗೆ ಕಾಯುತ್ತಿದೆ"],
  "sl5.check": ["Check", "देखें", "ನೋಡಿ"],
  "sl5.checkLong": ["Check the bill for {name}", "{name} का बिल देखें", "{name} ಅವರ ಬಿಲ್ ನೋಡಿ"],
  "sl5.bills": ["Bills", "बिल", "ಬಿಲ್‌ಗಳು"],
  "sl5.paid": ["Paid", "पैसे मिले", "ಹಣ ಬಂದಿದೆ"],
  "sl5.notPaid": ["Not paid", "पैसे बाकी", "ಹಣ ಬಾಕಿ"],
  "sl5.partPaid": ["Part paid", "कुछ मिले", "ಸ್ವಲ್ಪ ಬಂದಿದೆ"],
  "sl5.draft": ["Not made yet", "अभी नहीं बना", "ಇನ್ನೂ ಆಗಿಲ್ಲ"],
  "sl5.waiting": ["Waits for your yes", "आपकी हाँ बाकी", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಬಾಕಿ"],
  "sl5.cancelled": ["Cancelled", "रद्द", "ರದ್ದು"],
  "sl5.no": ["No. {n}", "नं. {n}", "ಸಂ. {n}"],
  "sl5.open": ["Open the bill for {name}", "{name} का बिल खोलें", "{name} ಅವರ ಬಿಲ್ ತೆರೆಯಿರಿ"],
  "sl5.whatsapp": ["Send on WhatsApp", "WhatsApp पर भेजें", "WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಿ"],
  "sl5.whatsappLong": ["Send the bill for {name} on WhatsApp", "{name} का बिल WhatsApp पर भेजें", "{name} ಅವರ ಬಿಲ್ WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಿ"],
  "sl5.billNo": ["Bill {no}", "बिल {no}", "ಬಿಲ್ {no}"],
  "sl5.billFor": ["Bill for {name}", "{name} का बिल", "{name} ಅವರ ಬಿಲ್"],
  "sl5.sold": ["What was sold", "क्या बिका", "ಏನು ಮಾರಾಯಿತು"],
  "sl5.noLines": ["This bill has no items yet.", "इस बिल में अभी कोई चीज़ नहीं।", "ಈ ಬಿಲ್‌ನಲ್ಲಿ ಇನ್ನೂ ವಸ್ತು ಇಲ್ಲ."],
  "sl5.taxable": ["Before tax", "टैक्स से पहले", "ತೆರಿಗೆ ಮೊದಲು"],
  "sl5.cgst": ["CGST", "CGST", "CGST"],
  "sl5.sgst": ["SGST", "SGST", "SGST"],
  "sl5.igst": ["IGST", "IGST", "IGST"],
  "sl5.tax": ["GST", "GST", "GST"],
  "sl5.noGst": ["No GST on this bill", "इस बिल पर GST नहीं", "ಈ ಬಿಲ್‌ಗೆ GST ಇಲ್ಲ"],
  "sl5.total": ["Total", "कुल", "ಒಟ್ಟು"],
  "sl5.due": ["{amt} still due", "{amt} अभी बाकी", "{amt} ಇನ್ನೂ ಬಾಕಿ"],
  "sl5.gotPart": ["{amt} received", "{amt} मिले", "{amt} ಬಂದಿದೆ"],
  "sl5.kind.tax_invoice": ["Tax invoice", "टैक्स इनवॉइस", "ಟ್ಯಾಕ್ಸ್ ಇನ್‌ವಾಯ್ಸ್"],
  "sl5.kind.bill_of_supply": ["Bill of supply", "बिल ऑफ़ सप्लाई", "ಬಿಲ್ ಆಫ್ ಸಪ್ಲೈ"],
  "sl5.kind.plain": ["Plain bill", "सादा बिल", "ಸಾದಾ ಬಿಲ್"],
  "sl5.pdf": ["Bill PDF", "बिल PDF", "ಬಿಲ್ PDF"],
  "sl5.testMode": ["Test mode", "टेस्ट मोड", "ಟೆಸ್ಟ್ ಮೋಡ್"],
  "sl5.payPage": ["Pay page", "भुगतान पेज", "ಪಾವತಿ ಪುಟ"],
  "sl5.gone": ["This bill is not here any more.", "यह बिल अब यहाँ नहीं है।", "ಈ ಬಿಲ್ ಈಗ ಇಲ್ಲಿ ಇಲ್ಲ."],
});

const STATUS = {
  paid: { key: "sl5.paid", tone: "good", icon: "checkCircle" },
  issued: { key: "sl5.notPaid", tone: "needs", icon: "clock" },
  part_paid: { key: "sl5.partPaid", tone: "needs", icon: "clock" },
  pending: { key: "sl5.waiting", tone: "needs", icon: "bell" },
  draft: { key: "sl5.draft", tone: null, icon: "doc" },
  cancelled: { key: "sl5.cancelled", tone: null, icon: "ban" },
};

const statusChip = (status) => { const s = STATUS[status] || STATUS.draft; return statusWord(st(s.key), s.tone); };
const customerName = (inv) => { const c = invoiceCustomer(inv); return (c && c.name) || st("sell.walkin"); };
const hasPhone = (inv) => { const c = invoiceCustomer(inv); return Boolean(c && c.phone); };
const billDate = (inv) => toDate(inv.issuedAt || inv.createdAt);
const pdfHref = (inv) => inv.pdfUrl || `/api/invoices/${encodeURIComponent(inv.id)}/pdf`;
const kindWord = (inv) => st(inv.kind === "tax_invoice" || inv.kind === "bill_of_supply" ? `sl5.kind.${inv.kind}` : "sl5.kind.plain");
const lineName = (l) => itemName(itemOf(l.itemId) || { name: l.name, nameNative: l.nameNative }) || l.name || "";
const talk = () => document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: "sell.hint" } }));

/** The one action of an unpaid bill: send it on WhatsApp, or add the customer's phone first. */
function billAction(inv, { size = "sm", block = false } = {}) {
  const status = billStatus(inv);
  if (status !== "issued" && status !== "part_paid") return null;
  const name = customerName(inv);
  const share = safeUrl(inv.shareUrl);
  if (hasPhone(inv) && share) return button({ word: st("sl5.whatsapp"), icon: "send", kind: "secondary", size, block, href: share, newTab: true, label: st("sl5.whatsappLong", { name }) });
  return addPhoneButton(name, { size });
}

/* ------------------------------------------------- the shared Yes card -- */

// W3's yes.js renders the one Yes card. A waiting bill on Sell is the card itself, made from the
// item W3 holds (waitingItems()); it follows the server until it leaves the page. If W3 does not
// hold the bill yet (its list catches up on the next event), a plain card says so and "Check"
// opens the Needs host on that bill (openNeeds(key)).
const yesEls = new Map();
function waitingCard(inv) {
  const key = `invoice:${inv.id}`;
  if (yesEls.has(key)) return yesEls.get(key);
  const item = waitingItems().find((i) => i.key === key);
  if (item) {
    const el = createYesCard(item, { inline: true });
    yesEls.set(key, el);
    return el;
  }
  return checkCard(inv);
}

/** The plain "waits for your yes" card: what, how much, and Check (opens that bill's Yes card). */
function checkCard(inv) {
  const name = customerName(inv);
  const tot = inv.totals || {};
  return card({
    needs: true,
    title: st("sl5.waits", { name }),
    speakKey: `invoice:${inv.id}`,
    body: h("p", { class: "figure sl5-needs-amt", text: money(tot.total) }),
    foot: button({ word: st("sl5.check"), kind: "secondary", size: "sm", label: st("sl5.checkLong", { name }), onClick: () => openNeeds(`invoice:${inv.id}`) }),
  });
}

/* ---------------------------------------------------------- bill sheet -- */

function billBody(inv) {
  if (!inv) return emptyState({ icon: "receipt", title: st("sl5.gone") });
  const status = billStatus(inv);
  const tot = inv.totals || {};
  const made = billDate(inv);
  const due = dueOf(inv);
  const lines = inv.lines || [];
  const g = gstRows(tot);
  const c = invoiceCustomer(inv);
  return [
    h("div", { class: "sl5-sheet-top" },
      statusChip(status),
      h("span", { class: "sl5-sheet-kind", text: kindWord(inv) }),
      made ? h("span", { class: "sl5-sheet-date", text: when(made, { day: "numeric", month: "long", year: "numeric" }) }) : null),
    h("div", { class: "sl5-sheet-who" },
      icon("user", 20),
      scripted("span", customerName(inv), { class: "sl5-sheet-name" }),
      c && c.phone ? h("span", { class: "sl5-sheet-phone", text: c.phone }) : null,
      inv.simulated ? warnWord(t("simulated")) : null),
    h("section", { class: "sl5-lines", "aria-label": st("sl5.sold") },
      h("h3", { class: "sl5-h3", text: st("sl5.sold") }),
      lines.length
        ? h("ul", { class: "sl5-line-list" }, ...lines.map((l) => {
          const amt = lineAmount(l);
          const rate = l.unitPrice !== null && l.unitPrice !== undefined ? ` × ${money(l.unitPrice)}` : "";
          return h("li", null,
            h("span", { class: "sl5-line-main" }, scripted("span", lineName(l), { class: "sl5-line-name" }), h("span", { class: "sl5-line-qty", text: `${qtyText(l.qty, l.unit)}${rate}` })),
            amt !== null ? h("span", { class: "amount sl5-line-amt", text: money(amt) }) : null);
        }))
        : h("p", { class: "note-line" }, icon("info", 18), h("span", { text: st("sl5.noLines") }))),
    h("div", { class: "sl5-sum" },
      g.kind === "none" ? h("p", { class: "note-line" }, icon("info", 18), h("span", { text: st("sl5.noGst") })) : null,
      ...(g.kind === "unknown" || g.kind === "none" ? [] : [
        ...g.rows.map((r) => h("p", { class: "sl5-sum-row" }, h("span", { text: st(`sl5.${r.key}`) }), h("span", { class: "num", text: money(r.amount) }))),
        h("p", { class: "sl5-sum-row sl5-sum-tax" }, h("span", { text: st("sl5.tax") }), h("span", { class: "num", text: money(g.tax) })),
      ]),
      h("p", { class: "sl5-sum-total" }, h("span", { text: st("sl5.total") }), h("span", { class: "figure", text: money(tot.total) })),
      status === "part_paid" && inv.paid ? h("p", { class: "note-line sl5-good" }, icon("checkCircle", 18), h("span", { text: st("sl5.gotPart", { amt: money(inv.paid) }) })) : null,
      (status === "part_paid" || status === "issued") && due ? h("p", { class: "note-line sl5-warn" }, icon("clock", 18), h("span", { text: st("sl5.due", { amt: money(due) }) })) : null),
    // The bill's Yes card lives on the page and in the Needs host; here, Check opens it.
    status === "pending" ? checkCard(inv) : null,
  ];
}

function billFooter(inv) {
  if (!inv) return null;
  const status = billStatus(inv);
  if (!(status === "issued" || status === "part_paid" || status === "paid")) return null;
  const unpaid = status !== "paid";
  const pay = unpaid ? safeUrl(inv.payUrl) : null;
  return [
    billAction(inv, { size: "md", block: true }),
    h("div", { class: "sl5-sheet-links" },
      button({ word: st("sl5.pdf"), icon: "download", kind: "secondary", size: "sm", href: pdfHref(inv), newTab: true, label: st("sell.pdfLong") }),
      pay ? button({ word: st("sl5.payPage"), icon: "rupee", kind: "secondary", size: "sm", href: pay, newTab: true, label: st("sell.payLong") }) : null,
      pay ? warnWord(st("sl5.testMode")) : null),
  ];
}

const billTitle = (inv) => (!inv ? st("sl5.bills") : inv.number ? st("sl5.billNo", { no: inv.number }) : st("sl5.billFor", { name: customerName(inv) }));

/* -------------------------------------------------------------- the list -- */

function billRow(inv, onOpen) {
  const status = billStatus(inv);
  const name = customerName(inv);
  const made = billDate(inv);
  const tot = inv.totals || {};
  const s = STATUS[status] || STATUS.draft;
  return dataRow({
    icon: "receipt",
    title: name,
    meta: [
      inv.number ? h("span", { title: inv.number, text: st("sl5.no", { n: shortBillNo(inv.number) }) }) : null,
      made ? when(made, { day: "numeric", month: "short" }) : null,
    ],
    amount: money(tot.total),
    status: statusWord(st(s.key), s.tone),
    action: billAction(inv),
    onOpen: (opener) => onOpen(inv.id, opener),
    openLabel: `${st("sl5.open", { name })}${inv.number ? `, ${inv.number}` : ""}`,
  });
}

function customerRow(c, owes) {
  return dataRow({
    icon: "user",
    title: c.name || "",
    meta: [c.phone ? c.phone : st("sl5.noPhone")],
    amount: owes ? money(owes) : null,
    amountTone: owes ? "warn" : null,
    status: owes ? statusWord(st("sl5.owes"), "warn") : statusWord(st("sl5.nothingDue"), "good"),
    onOpen: (opener) => openCustomerSheet({ customerId: c.id, opener }),
    openLabel: st("sl5.openCustomer", { name: c.name || "" }),
  });
}

/* --------------------------------------------------------------- screen -- */

let view = "bills"; // "bills" | "customers"

export function createSell() {
  ensureCss();
  const el = h("div", { class: "screen sl5" });
  const head = h("div");
  const body = h("div", { class: "sl5-body" });
  el.append(head, body);
  let detail = null; // { id, api, key }
  // W3's list of waiting decisions changes on server events: a bill that just became W3's item
  // swaps its plain card for the live Yes card.
  let waitingSeen = -1;
  onCount((n) => { if (n !== waitingSeen) { waitingSeen = n; if (head.isConnected || body.childNodes.length) render(true); } });

  function openBill(id, opener) {
    const inv = sell.invoices.get(String(id)) || null;
    const api = openSheet({ title: billTitle(inv), body: billBody(inv), footer: billFooter(inv), opener, speakKey: inv ? `invoice:${inv.id}` : undefined, onClose: () => { detail = null; } });
    detail = { id: String(id), api, key: JSON.stringify([document.documentElement.lang, inv]) };
  }

  function refreshDetail() {
    if (!detail) return;
    if (!detail.api.isOpen()) { detail = null; return; }
    const inv = sell.invoices.get(detail.id) || null;
    const key = JSON.stringify([document.documentElement.lang, inv]);
    if (key === detail.key) return;
    detail.key = key;
    detail.api.setBody(billBody(inv));
    detail.api.setFooter(billFooter(inv));
  }

  function listCard(invoices) {
    const bills = filterBills(invoices, "all").bills;
    const owedBy = new Map(sell.owed.map((o) => [String(o.customerId), o.amount]));
    const customers = [...sell.customers.values()].sort((a, b) => (owedBy.get(String(b.id)) || 0) - (owedBy.get(String(a.id)) || 0) || String(a.name || "").localeCompare(String(b.name || "")));
    const pick = (id) => { view = id; render(true); };
    const head = segmented({
      label: st("sl5.show"), value: view, onPick: pick,
      options: [
        { id: "bills", word: `${st("sl5.bills")} ${bills.length}` },
        { id: "customers", word: `${st("sl5.customers")} ${customers.length}` },
      ],
    });
    return view === "customers"
      ? rowsCard({ label: st("sl5.customers"), head, rows: customers.map((c) => customerRow(c, owedBy.get(String(c.id)) || 0)), empty: st("sl5.noCustomers") })
      : rowsCard({ label: st("sl5.bills"), head, rows: bills.map((inv) => billRow(inv, openBill)), empty: st("sl5.noBills") });
  }

  function render(force = false) {
    const ready = sell.status === "ready";
    patch(head, JSON.stringify([document.documentElement.lang, ready]), () => pageHead({
      title: t("nav.sell"),
      sentence: st("sl5.sentence"),
      action: h("div", { class: "sl5-head-acts" },
        button({ word: st("sl5.make"), icon: "receipt", kind: "primary", onClick: talk }),
        ready ? shopLink() : null),
    }));
    if (force) body.__key = null;
    const invoices = [...sell.invoices.values()];
    const need = shopMissing();
    const key = JSON.stringify([document.documentElement.lang, sell.status, need, invoices, [...sell.customers.values()], sell.owed, view]);
    patch(body, key, () => {
      if (sell.status === "idle" || sell.status === "loading") return skeleton("rows", 4);
      if (sell.status === "missing") return emptyState({ icon: "info", title: st("sbx.missing.title"), text: st("sbx.missing.sell"), action: { word: t("retry"), icon: "refresh", onClick: () => loadSell() } });
      if (sell.status !== "ready") {
        const err = sell.error;
        return emptyState({ icon: "alert", title: st("sbx.err.loadTitle"), text: (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load"), action: { word: t("retry"), icon: "refresh", onClick: () => loadSell() } });
      }
      const pending = pendingInvoices();
      for (const k of [...yesEls.keys()]) if (!pending.some((i) => `invoice:${i.id}` === k)) yesEls.delete(k);
      const needs = [...pending.map(waitingCard), need ? shopNeedCard(need) : null].filter(Boolean);
      return [
        needs.length ? section({ id: "sl5-needs-h", title: st("sl5.needs"), count: needs.length, body: h("div", { class: "sl5-needs" }, ...needs) }) : null,
        listCard(invoices),
      ];
    });
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
      render();
    },
  };
}

/** css/sell.css, once (app.html may link it already). */
function ensureCss() {
  if (document.querySelector('link[href="/css/sell.css"]')) return;
  document.head.append(h("link", { rel: "stylesheet", href: "/css/sell.css" }));
}
