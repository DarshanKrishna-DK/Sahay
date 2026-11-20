// Money (UI v5, screens.md section 07): the page pattern.
//   1. "Money" + "Who owes you, what you must pay, and what came in." + ONE primary "Ask for money"
//      (choose who owes; WhatsApp opens with the reminder and a pay link in test mode);
//   2. one list card with Owed to you | To pay | Received, a "Total" line at its top (the real sum),
//      rows of name, since / date, amount and one action (Remind or Add phone / Pay / none). A
//      customer row opens their sheet (what they owe, Got paid -> the pay pad, Remind); an order row
//      opens its sheet (vendor, simulated vendor labelled, amount, Pay with "Test mode").
// Data: store-sell.js (khata) and the purchase orders in GET /api/state (D3, no new route).

import { h, patch, safeUrl, toDate, money, button, pageHead, emptyState, skeleton, segmented, openSheet, scripted, icon } from "./ui.js";
import { t, when, addStrings } from "./i18n.js";
import { state as appState } from "./store.js";
import { sell, loadSell, customerOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { sumOf, ordersToPay, ageBucket } from "./sell-facts.js";
import { daysSince } from "./format.js";
import { openAskForMoney, openCustomerSheet, openAddPhone, remindOnWhatsApp, remindNote, owedName } from "./money-pad.js";
import { dataRow, rowsCard, statusWord, warnWord } from "./sell-rows.js";

addStrings({
  "mn5.sentence": ["Who owes you, what you must pay, and what came in.", "किससे लेना है, किसे देना है, और क्या आया।", "ಯಾರಿಂದ ಬರಬೇಕು, ಯಾರಿಗೆ ಕೊಡಬೇಕು, ಮತ್ತು ಏನು ಬಂತು."],
  "mn5.ask": ["Ask for money", "पैसे माँगें", "ಹಣ ಕೇಳಿ"],
  "mn5.show": ["Show", "दिखाएँ", "ತೋರಿಸಿ"],
  "mn5.owed": ["Owed to you", "आपको लेना है", "ನಿಮಗೆ ಬರಬೇಕು"],
  "mn5.pay": ["To pay", "देना है", "ಕೊಡಬೇಕು"],
  "mn5.got": ["Received", "मिला", "ಬಂದದ್ದು"],
  "mn5.total": ["Total", "कुल", "ಒಟ್ಟು"],
  "mn5.none.owed": ["Nobody owes you money.", "किसी पर पैसा बाकी नहीं।", "ಯಾರೂ ಹಣ ಬಾಕಿ ಇಟ್ಟಿಲ್ಲ."],
  "mn5.none.pay": ["Nothing to pay.", "कुछ देना बाकी नहीं।", "ಏನೂ ಕೊಡಬೇಕಿಲ್ಲ."],
  "mn5.none.got": ["Nothing received yet.", "अभी कुछ नहीं मिला।", "ಇನ್ನೂ ಏನೂ ಬಂದಿಲ್ಲ."],
  "mn5.since": ["Since {date}", "{date} से", "{date}ರಿಂದ"],
  "mn5.days": ["{n} days", "{n} दिन", "{n} ದಿನ"],
  "mn5.old": ["Over 30 days", "30 दिन से ज़्यादा", "30 ದಿನಕ್ಕಿಂತ ಹೆಚ್ಚು"],
  "mn5.remind": ["Remind", "याद दिलाएँ", "ನೆನಪಿಸಿ"],
  "mn5.addPhone": ["Add phone", "फ़ोन जोड़ें", "ಫೋನ್ ಸೇರಿಸಿ"],
  "mn5.openCustomer": ["Open {name}", "{name} खोलें", "{name} ತೆರೆಯಿರಿ"],
  "mn5.openOrder": ["Open the order from {name}", "{name} का ऑर्डर खोलें", "{name} ಅವರ ಆರ್ಡರ್ ತೆರೆಯಿರಿ"],
  "mn5.seller": ["Seller", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "mn5.payBtn": ["Pay", "भुगतान करें", "ಪಾವತಿಸಿ"],
  "mn5.payLong": ["Pay {name} {amt}", "{name} को {amt} दें", "{name} ಅವರಿಗೆ {amt} ಕೊಡಿ"],
  "mn5.testMode": ["Test mode", "टेस्ट मोड", "ಟೆಸ್ಟ್ ಮೋಡ್"],
  "mn5.noLink": ["Pay link not made yet", "भुगतान लिंक अभी नहीं बना", "ಪಾವತಿ ಲಿಂಕ್ ಇನ್ನೂ ಆಗಿಲ್ಲ"],
  "mn5.notPaid": ["Not paid", "भुगतान बाकी", "ಪಾವತಿ ಬಾಕಿ"],
  "mn5.orderNo": ["Order {no}", "ऑर्डर {no}", "ಆರ್ಡರ್ {no}"],
  "mn5.orderPdf": ["Order paper", "ऑर्डर की पर्ची", "ಆರ್ಡರ್ ಚೀಟಿ"],
  "mn5.amount": ["Amount", "रकम", "ಮೊತ್ತ"],
  "mn5.cash": ["Cash", "नकद", "ನಗದು"],
  "mn5.upi": ["UPI", "UPI", "UPI"],
  "mn5.online": ["Online (test mode)", "ऑनलाइन (टेस्ट मोड)", "ಆನ್‌ಲೈನ್ (ಟೆಸ್ಟ್ ಮೋಡ್)"],
});

const MODE = { cash: "mn5.cash", upi: "mn5.upi", razorpay_test: "mn5.online" };
const TABS = ["owed", "pay", "got"];
let tab = "owed";

/* ------------------------------------------------------------------ rows -- */

function owedRow(o, ui, handlers) {
  const id = String(o.customerId);
  const name = owedName(o);
  const c = customerOf(o.customerId) || o.customer;
  const since = toDate(o.oldestDue);
  const days = daysSince(o.oldestDue);
  const old = ageBucket(days) === "old";
  const u = ui.get(id) || {};
  const action = c && !c.phone
    ? button({ word: st("mn5.addPhone"), icon: "phone", kind: "secondary", size: "sm", label: st("mp5.addPhoneLong", { name }), onClick: (e) => openAddPhone({ name, opener: e.currentTarget }) })
    : button({ word: st("mn5.remind"), icon: "send", kind: "secondary", size: "sm", busy: Boolean(u.busy), label: st("money.remindLong", { name }), onClick: () => handlers.remind(id) });
  const row = dataRow({
    icon: "user",
    title: name,
    meta: [
      since ? st("mn5.since", { date: when(since, { day: "numeric", month: "short" }) }) : null,
      old ? warnWord(st("mn5.old")) : days ? st("mn5.days", { n: days }) : null,
    ],
    amount: money(o.amount),
    amountTone: "warn",
    action,
    onOpen: (opener) => openCustomerSheet({ customerId: id, opener }),
    openLabel: st("mn5.openCustomer", { name }),
  });
  if (u.note) row.append(h("div", { class: "sv5-row-note" }, u.note));
  return row;
}

function orderSheet(o, opener) {
  const vendor = o.vendorName || st("mn5.seller");
  const pay = safeUrl(o.paymentUrl);
  const made = toDate(o.createdAt);
  openSheet({
    title: o.poNumber ? st("mn5.orderNo", { no: o.poNumber }) : vendor,
    opener,
    body: [
      h("div", { class: "mp-cust" },
        h("span", { class: "mp-initials", "aria-hidden": "true" }, icon("cart", 22)),
        h("div", null, scripted("p", vendor, { class: "mp-vendor" }), o.simulated ? warnWord(t("simulated")) : null)),
      h("div", { class: "mp-owes-block" },
        h("p", { class: "mp-label", text: st("mn5.amount") }),
        h("p", { class: "figure", text: money(o.amount) }),
        made ? h("p", { class: "mp-of", text: when(made, { day: "numeric", month: "long", year: "numeric" }) }) : null),
      statusWord(st("mn5.notPaid"), "needs"),
    ],
    footer: [
      pay ? h("div", { class: "mn5-pay-line" },
        button({ word: st("mn5.payBtn"), icon: "rupee", kind: "primary", block: true, href: pay, newTab: true, label: st("mn5.payLong", { name: vendor, amt: money(o.amount) }) }),
        warnWord(st("mn5.testMode")))
        : h("p", { class: "note-line" }, icon("clock", 18), h("span", { text: st("mn5.noLink") })),
      o.pdfUrl && safeUrl(o.pdfUrl) ? button({ word: st("mn5.orderPdf"), icon: "download", kind: "secondary", size: "sm", href: safeUrl(o.pdfUrl), newTab: true }) : null,
    ],
  });
}

function payRow(o) {
  const vendor = o.vendorName || st("mn5.seller");
  const pay = safeUrl(o.paymentUrl);
  const made = toDate(o.createdAt);
  return dataRow({
    icon: "cart",
    title: vendor,
    meta: [
      o.simulated ? warnWord(t("simulated")) : null,
      o.poNumber || null,
      made ? when(made, { day: "numeric", month: "short" }) : null,
    ],
    amount: money(o.amount),
    action: pay
      ? h("span", { class: "mn5-pay-line" },
        button({ word: st("mn5.payBtn"), icon: "rupee", kind: "primary", size: "sm", href: pay, newTab: true, label: st("mn5.payLong", { name: vendor, amt: money(o.amount) }) }),
        warnWord(st("mn5.testMode")))
      : null,
    onOpen: (opener) => orderSheet(o, opener),
    openLabel: st("mn5.openOrder", { name: vendor }),
  });
}

function gotRow(r) {
  const c = customerOf(r.customerId);
  const name = (c && c.name) || st("sell.walkin");
  const d = toDate(r.createdAt);
  return dataRow({
    icon: "checkCircle",
    title: name,
    meta: [st(MODE[r.mode] || "mn5.cash"), d ? when(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null],
    amount: money(r.amount),
    amountTone: "good",
  });
}

/* ---------------------------------------------------------------- screen -- */

export function createMoney() {
  ensureCss();
  const el = h("div", { class: "screen mn5" });
  const head = h("div");
  const body = h("div", { class: "mn5-body" });
  el.append(head, body);
  const ui = new Map(); // customerId -> { busy, note }

  const handlers = {
    async remind(id) {
      ui.set(id, { busy: true });
      render(true);
      try { ui.set(id, { note: remindNote(await remindOnWhatsApp(id)) }); } catch (err) { ui.set(id, { note: h("p", { class: "error-line", role: "alert" }, icon("alert", 18), h("span", { text: err.message })) }); }
      render(true);
    },
  };

  function render(force = false) {
    patch(head, JSON.stringify([document.documentElement.lang]), () => pageHead({
      title: t("nav.money"),
      sentence: st("mn5.sentence"),
      action: { word: st("mn5.ask"), icon: "send", onClick: (e) => openAskForMoney(e.currentTarget) },
    }));
    if (force) body.__key = null;
    const toPay = ordersToPay([...appState.orders.values()]);
    const key = JSON.stringify([document.documentElement.lang, sell.status, sell.owed, sell.receipts, [...sell.customers.values()], toPay, tab, [...ui.keys()], [...ui.values()].map((u) => Boolean(u.busy))]);
    patch(body, key, () => {
      if (sell.status === "idle" || sell.status === "loading") return skeleton("rows", 4);
      if (sell.status === "missing") return emptyState({ icon: "info", title: st("sbx.missing.title"), text: st("sbx.missing.money"), action: { word: t("retry"), icon: "refresh", onClick: () => loadSell() } });
      if (sell.status !== "ready") {
        const err = sell.error;
        return emptyState({ icon: "alert", title: st("sbx.err.loadTitle"), text: (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load"), action: { word: t("retry"), icon: "refresh", onClick: () => loadSell() } });
      }
      const counts = { owed: sell.owed.length, pay: toPay.length, got: sell.receipts.length };
      const totals = { owed: sumOf(sell.owed), pay: sumOf(toPay), got: sumOf(sell.receipts) };
      const seg = segmented({
        label: st("mn5.show"), value: tab, onPick: (id) => { tab = id; render(true); },
        options: TABS.map((id) => ({ id, word: `${st(`mn5.${id}`)} ${counts[id]}` })),
      });
      const total = counts[tab]
        ? h("p", { class: "sv5-total" }, h("span", { text: st("mn5.total") }), h("span", { class: `amount sv5-total-amt is-${tab}`, text: money(totals[tab]) }))
        : null;
      const rows = tab === "owed" ? sell.owed.map((o) => owedRow(o, ui, handlers))
        : tab === "pay" ? toPay.map(payRow)
          : sell.receipts.map(gotRow);
      return rowsCard({ label: st(`mn5.${tab}`), head: seg, total, rows, empty: st(`mn5.none.${tab}`) });
    });
  }

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && appState.boot === "ready") loadSell();
      if (parts.has("all") || parts.has("lang") || parts.has("sell") || parts.has("orders")) render(parts.has("lang"));
    },
    enter: () => {
      if (sell.status === "idle" || sell.status === "error" || sell.status === "missing") loadSell();
      render();
    },
  };
}

/** css/money.css and css/sell.css (shared rows), once. */
function ensureCss() {
  for (const href of ["/css/sell.css", "/css/money.css"]) {
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h("link", { rel: "stylesheet", href }));
  }
}
