// Money (khata, UI v4): the page head ("Money", one plain line, "Tell who paid"), then two big
// totals side by side, "to collect" (who owes the shop) and "to pay" (purchase orders not paid
// yet, D3: from GET /api/state orders, no new route); then "Who owes you" on the left: largest
// first, the amount big, a meter against the largest, how long the oldest bill has waited (30
// days or more marked with a clock and words), "Got paid" (number pad, POST /api/receipts) and
// "Remind" (WhatsApp link from POST /api/customers/:id/remind) or "Add phone" (D14). On the right,
// "To pay" (each order with its pay link in Razorpay test mode, a simulated vendor labelled) and
// "Received". One column on a phone; two from 680 px of content.

import { h, patch, safeUrl, toDate } from "./dom.js";
import { t, when, addStrings } from "./i18n.js";
import { pageHead } from "./ui.js";
import { state as appState } from "./store.js";
import { sell, loadSell, customerOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { meterShare, ageBucket, sumOf, ordersToPay, receivedToday } from "./sell-facts.js";
import {
  ensureCss, money, scriptedText, readButton, partState, ask,
  daysSince, daysWord, count, ic, screenState, resultLine, linkKey, simTag, panel,
  testTag, initial,
} from "./sell-kit.js";
import { openPayPad, openAddPhone, remindOnWhatsApp } from "./money-pad.js";

addStrings({
  "mn.sub": ["Who owes you, what you owe, and what came in", "किससे लेना है, किसे देना है, और क्या आया", "ಯಾರಿಂದ ಬರಬೇಕು, ಯಾರಿಗೆ ಕೊಡಬೇಕು, ಮತ್ತು ಏನು ಬಂತು"],
  "mn.showFewer": ["Show fewer", "कम दिखाएँ", "ಕಡಿಮೆ ತೋರಿಸಿ"],
  "mn.received": ["Received", "मिले पैसे", "ಬಂದ ಹಣ"],
  "mn.showAll": ["Show {n} payments", "{n} भुगतान दिखाएँ", "{n} ಪಾವತಿ ತೋರಿಸಿ"],
  "mn.record": ["Record payment", "पैसे लिखें", "ಪಾವತಿ ಬರೆಯಿರಿ"],
  "mn.whoPaid": ["Who paid?", "किसने पैसे दिए?", "ಯಾರು ಹಣ ಕೊಟ್ಟರು?"],
  "mn.whoPaidSub": ["Choose the customer, then type the amount.", "ग्राहक चुनिए, फिर रकम लिखिए।", "ಗ್ರಾಹಕರನ್ನು ಆಯ್ಕೆಮಾಡಿ, ನಂತರ ಮೊತ್ತ ಬರೆಯಿರಿ."],
  "mn.today": ["Received today", "आज मिले", "ಇಂದು ಬಂದದ್ದು"],
  "mn.customers": ["{n} customers", "{n} ग्राहक", "{n} ಗ್ರಾಹಕರು"],
  "mn.customersOne": ["1 customer", "1 ग्राहक", "1 ಗ್ರಾಹಕ"],
  "mn.collectSub": ["Credit your customers still owe", "ग्राहकों का बाकी उधार", "ಗ್ರಾಹಕರ ಬಾಕಿ ಸಾಲ"],
  "mn.paySub": ["Purchase orders not paid yet", "जिन ऑर्डर का भुगतान बाकी है", "ಪಾವತಿ ಬಾಕಿ ಇರುವ ಆರ್ಡರ್‌ಗಳು"],
  "mn.todaySub": ["Cash, UPI and online payments today", "आज के नकद, UPI और ऑनलाइन भुगतान", "ಇಂದಿನ ನಗದು, UPI ಮತ್ತು ಆನ್‌ಲೈನ್ ಪಾವತಿ"],
  "mn.daysDue": ["{d} due", "{d} से बाकी", "{d}ದಿಂದ ಬಾಕಿ"],
  "mn.collect": ["To collect", "लेना है", "ಬರಬೇಕು"],
  "mn.pay": ["To pay", "देना है", "ಕೊಡಬೇಕು"],
  "mn.orders": ["{n} orders", "{n} ऑर्डर", "{n} ಆರ್ಡರ್"],
  "mn.ordersOne": ["1 order", "1 ऑर्डर", "1 ಆರ್ಡರ್"],
  "mn.nobody": ["Nobody owes you money right now.", "अभी किसी पर पैसा बाकी नहीं।", "ಈಗ ಯಾರೂ ಹಣ ಬಾಕಿ ಇಟ್ಟಿಲ್ಲ."],
  "mn.noPay": ["Nothing to pay right now.", "अभी कुछ देना बाकी नहीं।", "ಈಗ ಏನೂ ಕೊಡಬೇಕಿಲ್ಲ."],
  "mn.seller": ["Seller", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "mn.payLong": ["Pay {name} {amt}", "{name} को {amt} दें", "{name} ಅವರಿಗೆ {amt} ಕೊಡಿ"],
  "mn.old": ["Over 30 days", "30 दिन से ज़्यादा", "30 ದಿನಕ್ಕಿಂತ ಹೆಚ್ಚು"],
  "mn.ladder": ["Who owes you", "किससे लेना है", "ಯಾರಿಂದ ಬರಬೇಕು"],
  "mn.reminding": ["Making the reminder", "याद दिलाने का संदेश बन रहा है", "ನೆನಪಿನ ಸಂದೇಶ ಸಿದ್ಧವಾಗುತ್ತಿದೆ"],
  "mn.say.pay": ["You have to pay {amt} on {n} orders.", "आपको {n} ऑर्डर पर {amt} देना है।", "ನೀವು {n} ಆರ್ಡರ್‌ಗೆ {amt} ಕೊಡಬೇಕು."],
});

const MODE_ICON = { cash: "cash", upi: "phone", razorpay_test: "wallet" };

function nameOf(o) {
  const c = o.customer || customerOf(o.customerId);
  return (c && c.name) || st("sell.walkin");
}


/* ---------------------------------------------------------------- totals -- */

/** One total card (Stitch 08-money): label and count on top, the figure big, one plain line under. */
function totalCard({ cls, label, n, amount, sub, speak }) {
  return h("article", { class: `card mn-total ${cls}` },
    h("div", { class: "mn-total-top" },
      h("p", { class: "t-label mn-total-label", text: label }),
      n ? h("span", { class: "mn-total-count", text: n }) : null,
      speak ? h("span", { class: "card-speak" }, speak) : null),
    h("p", { class: `t-figure mn-total-num${amount ? "" : " is-zero"}`, text: money(amount) || "₹0" }),
    h("p", { class: "mn-total-sub", text: sub }));
}

function totals(toPay) {
  const owed = sumOf(sell.owed);
  const due = sumOf(toPay);
  const got = receivedToday(sell.receipts);
  const paySentence = () => (toPay.length ? st("mn.say.pay", { amt: money(due), n: toPay.length }) : st("mn.noPay"));
  return h("section", { class: "mn-totals", "aria-label": `${st("mn.collect")}, ${st("mn.pay")}, ${st("mn.today")}` },
    totalCard({ cls: "mn-total-collect", label: st("mn.collect"), n: sell.owed.length ? count("mn.customers", sell.owed.length) : null, amount: owed, sub: st("mn.collectSub") }),
    totalCard({ cls: "mn-total-pay", label: st("mn.pay"), n: toPay.length ? count("mn.orders", toPay.length) : null, amount: due, sub: st("mn.paySub"), speak: readButton("topay", paySentence) }),
    totalCard({ cls: "mn-total-got", label: st("mn.today"), n: got.count ? count("money.payments", got.count) : null, amount: got.amount, sub: st("mn.todaySub") }));
}

/* ------------------------------------------------------------ who owes -- */

/**
 * One customer who owes (Stitch 08-money row): initials, name, phone and how long it has waited,
 * the amount, Got paid and Remind (or Add phone), a thin meter against the largest debt, and the
 * reminder's result under it.
 */
function owedCard(o, max, ui, handlers) {
  const id = String(o.customerId);
  const u = ui.get(id) || {};
  const name = nameOf(o);
  const days = daysSince(o.oldestDue);
  const age = ageBucket(days);
  const c = customerOf(o.customerId) || o.customer;
  const noPhone = Boolean(c && !c.phone);
  const titleId = `mn-owe-${id}`;
  const remind = noPhone
    ? h("button", { class: "keycap keycap-ghost keycap-sm mn-add-phone", type: "button", "aria-label": st("mn.addPhoneLong", { name }),
      on: { click: (e) => handlers.addPhone(o, name, e.currentTarget) } }, ic("phone", 20), h("span", { text: st("mn.addPhone") }))
    : h("button", {
      class: "keycap keycap-ghost keycap-sm mn-remind", type: "button", "aria-busy": u.busy ? "true" : undefined,
      "aria-label": st("money.remindLong", { name }), on: { click: () => handlers.remind(id) },
    }, u.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : ic("chat", 20), h("span", { text: st("money.remind") }));
  return h("li", { class: "mn-owe-slot" },
    h("article", { class: `mn-owe${age === "old" ? " is-old" : ""}`, "aria-labelledby": titleId, style: `--share:${meterShare(o.amount, max)}%` },
      scriptedText("span", initial(name), { class: "mn-avatar", "aria-hidden": "true" }),
      h("div", { class: "mn-owe-main" },
        scriptedText("h3", name, { class: "mn-owe-name", id: titleId }),
        h("p", { class: "mn-owe-sub" },
          c && c.phone ? h("span", { class: "mn-owe-phone", text: c.phone }) : h("span", { class: "mn-owe-phone is-none" }, ic("phone", 16), h("span", { text: st("sl.noPhone") })),
          days !== null ? h("span", { class: `mn-age mn-age-${age}` }, ic("clock", 16),
            h("span", { text: age === "today" ? st("sv.today") : st("mn.daysDue", { d: daysWord(days) }) }),
            age === "old" ? h("b", { class: "mn-age-old", text: st("mn.old") }) : null) : null)),
      h("p", { class: "t-money mn-owe-amt", text: money(o.amount) }),
      h("div", { class: "mn-owe-acts" },
        h("button", { class: "keycap keycap-primary keycap-sm mn-paid", type: "button", "aria-label": st("money.gotPaidLong", { name }),
          on: { click: (e) => handlers.paid(o, name, e.currentTarget) } }, ic("cash", 20), h("span", { text: st("money.gotPaid") })),
        remind,
        h("span", { class: "card-speak" }, readButton(`owed:${id}`))),
      h("div", { class: "mn-meter", "aria-hidden": "true" }, h("span", { class: "mn-meter-fill" })),
      u.busy ? resultLine("busy", st("mn.reminding")) : null,
      u.opened ? resultLine("ok", st("mn.opened")) : null,
      u.link ? h("div", { class: "mn-blocked" }, resultLine("error", st("mn.blocked")),
        linkKey({ href: u.link, icon: "external", word: st("money.openWhatsapp"), tone: "primary", size: "sm" })) : null,
      u.error ? resultLine("error", u.error) : null));
}

/**
 * "Record payment" (the page head's primary): choose who paid from the people who owe, then the
 * number pad. With nobody owing, the owner says it to Sahay instead.
 */
function openPayChooser(opener) {
  if (!sell.owed.length) { ask({ hint: "money.hint" }); return; }
  panel({
    title: st("mn.whoPaid"),
    opener,
    body: h("div", { class: "picker mn-chooser" },
      h("p", { class: "page-sub", text: st("mn.whoPaidSub") }),
      h("div", { class: "picker-list" }, ...sell.owed.map((o) => {
        const name = nameOf(o);
        return h("button", {
          class: "picker-item mn-choose", type: "button",
          // Opening the pad replaces this sheet; focus goes back to Record payment when it closes.
          on: { click: () => openPayPad({ customerId: o.customerId, name, owed: o.amount, opener }) },
        }, scriptedText("span", initial(name), { class: "mn-avatar", "aria-hidden": "true" }),
        scriptedText("span", name, { class: "mn-choose-name" }),
        h("span", { class: "pi-sub t-money mn-choose-amt", text: money(o.amount) }));
      }))),
  });
}

/* ---------------------------------------------------------------- to pay -- */

function toPayRow(o) {
  const vendor = o.vendorName || st("mn.seller");
  const pay = safeUrl(o.paymentUrl);
  const made = toDate(o.createdAt);
  return h("li", { class: "row mn-topay" },
    h("span", { class: "row-ico", "aria-hidden": "true" }, ic("cart", 22)),
    h("span", { class: "row-main" },
      scriptedText("span", vendor, { class: "row-title" }),
      h("span", { class: "row-sub" },
        o.simulated ? simTag() : null,
        o.poNumber ? h("span", { class: "mn-po", text: o.poNumber }) : null,
        made ? h("span", { text: when(made, { day: "numeric", month: "short" }) }) : null)),
    h("span", { class: "row-end mn-topay-end" },
      h("span", { class: "mn-topay-amt", text: money(o.amount) }),
      pay ? h("span", { class: "mn-topay-pay" },
        linkKey({ href: pay, icon: "rupee", word: t("orders.pay"), label: st("mn.payLong", { name: vendor, amt: money(o.amount) }), tone: "primary", size: "sm" }),
        testTag())
        : h("span", { class: "mn-nolink" }, ic("clock", 16), h("span", { text: t("orders.noLink") }))));
}

/* -------------------------------------------------------------- received -- */

function receiptRow(r) {
  const name = nameOf({ customerId: r.customerId });
  const d = toDate(r.createdAt);
  const modeKey = `money.${r.mode}`;
  return h("li", { class: "row mn-got" },
    h("span", { class: "row-ico mn-got-ico", "aria-hidden": "true" }, ic("check", 20)),
    h("span", { class: "row-main" },
      scriptedText("span", name, { class: "row-title" }),
      h("span", { class: "row-sub" },
        r.mode === "razorpay_test" ? testTag() : null,
        h("span", { class: "mn-got-mode" }, ic(MODE_ICON[r.mode] || "rupee", 16), h("span", { text: st(modeKey) !== modeKey ? st(modeKey) : (r.mode || "") })),
        d ? h("span", { text: when(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) }) : null)),
    h("span", { class: "row-end t-money mn-got-amt", text: money(r.amount) }));
}

/* ---------------------------------------------------------------- screen -- */

/** A section title (h2, display face) with the count beside it. */
function h2(id, word, n) {
  return h("h2", { class: "section-title mn-h2", id }, h("span", { text: word }), n ? h("span", { class: "mn-h2-count", text: String(n) }) : null);
}

const RECEIVED_SHOWN = 6;
let showAllReceived = false;

export function createMoney() {
  ensureCss();
  const el = h("section", { class: "money mn-screen", "aria-labelledby": "money-title" });
  const head = h("div", { class: "mn-headslot" });
  const body = h("div", { class: "mn-body" });
  el.append(head, body);
  const ui = new Map(); // customerId -> { busy, error, link, opened }

  const handlers = {
    paid(o, name, opener) {
      openPayPad({ customerId: o.customerId, name, owed: o.amount, opener });
    },
    addPhone(o, name, opener) {
      openAddPhone({ name, opener, onSaved: () => { ui.delete(String(o.customerId)); render(true); } });
    },
    async remind(id) {
      ui.set(id, { busy: true });
      render(true);
      try { ui.set(id, await remindOnWhatsApp(id)); } catch (err) { ui.set(id, { error: err.message }); }
      render(true);
    },
  };

  function render(force = false) {
    const ready = sell.status === "ready";
    const toPay = ordersToPay([...appState.orders.values()]);
    const empty = ready && !sell.owed.length && !sell.receipts.length && !toPay.length;
    patch(head, JSON.stringify([document.documentElement.lang, sell.status, empty, sell.owed.length > 0]), () => pageHead({
      title: t("nav.money"),
      sub: st("mn.sub"),
      actions: ready ? [
        h("button", { class: "keycap keycap-primary keycap-lg mn-record", type: "button", on: { click: (e) => openPayChooser(e.currentTarget) } },
          ic("plus", 24), h("span", { text: st("mn.record") })),
        sell.owed.length ? readButton("khata") : null,
      ].filter(Boolean) : [],
    }));
    const h1 = head.querySelector(".page-title");
    if (h1) h1.id = "money-title";
    if (force) body.__key = null;
    const key = JSON.stringify([document.documentElement.lang, sell.status, sell.owed, sell.receipts, [...sell.customers.values()], toPay, [...ui.entries()], showAllReceived]);
    patch(body, key, () => {
      const s = partState(sell, { which: "money", reload: () => loadSell() });
      if (s) return s;
      if (empty) {
        return screenState({ kind: "empty", icon: "wallet", title: st("money.empty.title"), text: st("money.empty.text"),
          action: { label: st("money.act"), icon: "mic", run: () => ask({ hint: "money.hint" }) }, shape: "money" });
      }
      const max = sell.owed.length ? Math.max(...sell.owed.map((o) => o.amount || 0)) : 0;
      return [
        totals(toPay),
        h("div", { class: "mn-cols" },
          h("section", { class: "mn-collect", "aria-labelledby": "mn-collect-h" },
            h2("mn-collect-h", st("mn.ladder"), sell.owed.length),
            sell.owed.length
              ? h("ol", { class: "mn-owed" }, ...sell.owed.map((o) => owedCard(o, max, ui, handlers)))
              : h("p", { class: "note-line mn-quiet" }, ic("checkCircle", 18), h("span", { text: st("mn.nobody") }))),
          h("div", { class: "mn-side" },
            h("section", { class: "mn-pay", "aria-labelledby": "mn-pay-h" },
              h2("mn-pay-h", st("mn.pay"), toPay.length),
              toPay.length
                ? h("ul", { class: "rows mn-topays" }, ...toPay.map(toPayRow))
                : h("p", { class: "note-line mn-quiet" }, ic("checkCircle", 18), h("span", { text: st("mn.noPay") }))),
            h("section", { class: "mn-received", "aria-labelledby": "mn-got-h" },
              h2("mn-got-h", st("mn.received"), sell.receipts.length),
              sell.receipts.length
                ? h("ul", { class: "rows mn-gots" }, ...(showAllReceived ? sell.receipts.slice(0, 60) : sell.receipts.slice(0, RECEIVED_SHOWN)).map(receiptRow))
                : h("p", { class: "note-line mn-quiet" }, ic("info", 18), h("span", { text: st("money.noRecent") })),
              sell.receipts.length > RECEIVED_SHOWN
                ? h("button", { class: "keycap keycap-ghost keycap-sm mn-more", type: "button", "aria-expanded": String(showAllReceived),
                  on: { click: () => { showAllReceived = !showAllReceived; render(true); } } },
                  ic(showAllReceived ? "chevronUp" : "chevronDown", 20), h("span", { text: showAllReceived ? st("mn.showFewer") : st("mn.showAll", { n: Math.min(sell.receipts.length, 60) }) }))
                : null))),
      ];
    });
  }

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && appState.boot === "ready") loadSell();
      if (parts.has("all") || parts.has("lang") || parts.has("sell") || parts.has("orders")) render(parts.has("lang"));
    },
    enter: () => { if (sell.status === "idle" || sell.status === "error" || sell.status === "missing") loadSell(); },
  };
}
