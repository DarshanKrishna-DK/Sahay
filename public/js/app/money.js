// Money (khata, UI v3): two big totals side by side, "to collect" (who owes the shop) and "to pay"
// (purchase orders not paid yet, D3: from GET /api/state orders, no new route). Who owes you:
// largest first, the amount big, a meter against the largest, how long the oldest bill has waited
// (30 days or more marked with a clock and words). "Got paid" opens the number pad (cash / UPI,
// POST /api/receipts); "Remind" asks the server for the WhatsApp link (POST
// /api/customers/:id/remind) and opens it; a customer with no phone gets "Add phone" (D14).
// To pay lists each order with its pay link (Razorpay test mode) and a simulated vendor labelled.
// Money received folds on a phone. Layout per spec section 6: one column on a phone; to-collect
// left, to-pay + received right when wide.

import { h, patch, safeUrl, toDate } from "./dom.js";
import { t, when, addStrings } from "./i18n.js";
import { state as appState } from "./store.js";
import { sell, loadSell, customerOf, remindCustomer } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { meterShare, ageBucket, sumOf, ordersToPay } from "./sell-facts.js";
import {
  ensureCss, money, scriptedText, readButton, partState, agentAction, sectionHead, buttonError, ask,
  daysSince, daysWord, count, ic, cardHead, screenHead, screenState, fold, resultLine, linkKey, simTag,
  testTag, initial,
} from "./sell-kit.js";
import { openPayPad, openAddPhone } from "./money-pad.js";

addStrings({
  "mn.collect": ["To collect", "लेना है", "ಬರಬೇಕು"],
  "mn.pay": ["To pay", "देना है", "ಕೊಡಬೇಕು"],
  "mn.orders": ["{n} orders", "{n} ऑर्डर", "{n} ಆರ್ಡರ್"],
  "mn.ordersOne": ["1 order", "1 ऑर्डर", "1 ಆರ್ಡರ್"],
  "mn.nobody": ["Nobody owes you money right now.", "अभी किसी पर पैसा बाकी नहीं।", "ಈಗ ಯಾರೂ ಹಣ ಬಾಕಿ ಇಟ್ಟಿಲ್ಲ."],
  "mn.payH": ["You have to pay", "आपको देना है", "ನೀವು ಕೊಡಬೇಕು"],
  "mn.noPay": ["Nothing to pay right now.", "अभी कुछ देना बाकी नहीं।", "ಈಗ ಏನೂ ಕೊಡಬೇಕಿಲ್ಲ."],
  "mn.seller": ["Seller", "विक्रेता", "ಮಾರಾಟಗಾರ"],
  "mn.payLong": ["Pay {name} {amt}", "{name} को {amt} दें", "{name} ಅವರಿಗೆ {amt} ಕೊಡಿ"],
  "mn.old": ["Over 30 days", "30 दिन से ज़्यादा", "30 ದಿನಕ್ಕಿಂತ ಹೆಚ್ಚು"],
  "mn.addPhone": ["Add phone", "फ़ोन जोड़ें", "ಫೋನ್ ಸೇರಿಸಿ"],
  "mn.addPhoneLong": ["Add a phone number for {name}", "{name} का फ़ोन नंबर जोड़ें", "{name} ಅವರ ಫೋನ್ ಸಂಖ್ಯೆ ಸೇರಿಸಿ"],
  "mn.opened": ["WhatsApp opened with the reminder.", "याद दिलाने का संदेश WhatsApp में खुल गया।", "ನೆನಪಿನ ಸಂದೇಶ WhatsApp ನಲ್ಲಿ ತೆರೆಯಿತು."],
  "mn.blocked": ["The browser stopped WhatsApp from opening. Press Open WhatsApp.", "ब्राउज़र ने WhatsApp नहीं खोलने दिया। WhatsApp खोलें दबाइए।", "ಬ್ರೌಸರ್ WhatsApp ತೆರೆಯಲು ಬಿಡಲಿಲ್ಲ. WhatsApp ತೆರೆಯಿರಿ ಒತ್ತಿ."],
  "mn.reminding": ["Making the reminder", "याद दिलाने का संदेश बन रहा है", "ನೆನಪಿನ ಸಂದೇಶ ಸಿದ್ಧವಾಗುತ್ತಿದೆ"],
  "mn.say.pay": ["You have to pay {amt} on {n} orders.", "आपको {n} ऑर्डर पर {amt} देना है।", "ನೀವು {n} ಆರ್ಡರ್‌ಗೆ {amt} ಕೊಡಬೇಕು."],
});

const MODE_ICON = { cash: "cash", upi: "phone", razorpay_test: "wallet" };

function nameOf(o) {
  const c = o.customer || customerOf(o.customerId);
  return (c && c.name) || st("sell.walkin");
}

const wideNow = () => typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches;

/* ---------------------------------------------------------------- totals -- */

function totals(toPay) {
  const owed = sumOf(sell.owed);
  const due = sumOf(toPay);
  const paySentence = () => (toPay.length ? st("mn.say.pay", { amt: money(due), n: toPay.length }) : st("mn.noPay"));
  return h("section", { class: "mn-totals", "aria-label": `${st("mn.collect")}, ${st("mn.pay")}` },
    h("article", { class: "card mn-total mn-total-collect" },
      cardHead(h("p", { class: "mn-total-word" }, ic("moneyIn", 22), h("span", { text: st("mn.collect") })), null),
      h("p", { class: `bignum bignum-total mn-total-num${owed ? "" : " is-zero"}`, text: money(owed) || "₹0" }),
      h("p", { class: "mn-total-sub" }, ic("users", 18), h("span", { text: count("money.people", sell.owed.length) }))),
    h("article", { class: "card mn-total mn-total-pay" },
      cardHead(h("p", { class: "mn-total-word" }, ic("cart", 22), h("span", { text: st("mn.pay") })), readButton("topay", paySentence)),
      h("p", { class: `bignum bignum-total mn-total-num${due ? "" : " is-zero"}`, text: money(due) || "₹0" }),
      h("p", { class: "mn-total-sub" }, ic("receipt", 18), h("span", { text: count("mn.orders", toPay.length) }))));
}

/* ------------------------------------------------------------ who owes -- */

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
    ? h("button", { class: "keycap keycap-secondary keycap-md mn-add-phone", type: "button", "aria-label": st("mn.addPhoneLong", { name }),
      on: { click: (e) => handlers.addPhone(o, name, e.currentTarget) } }, ic("phone", 22), h("span", { text: st("mn.addPhone") }))
    : h("button", {
      class: "keycap keycap-secondary keycap-md mn-remind", type: "button", "aria-busy": u.busy ? "true" : undefined,
      "aria-label": st("money.remindLong", { name }), on: { click: () => handlers.remind(id) },
    }, u.busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : ic("chat", 22), h("span", { text: st("money.remind") }));
  return h("li", { class: "mn-owe-slot" },
    h("article", { class: `card mn-owe${age === "old" ? " is-old" : ""}`, "aria-labelledby": titleId, style: `--share:${meterShare(o.amount, max)}%` },
      cardHead(scriptedText("h3", name, { class: "card-title mn-owe-name", id: titleId }), readButton(`owed:${id}`),
        { lead: scriptedText("span", initial(name), { class: "mn-avatar", "aria-hidden": "true" }) }),
      h("div", { class: "mn-owe-mid" },
        h("p", { class: "bignum bignum-amount mn-owe-amt", text: money(o.amount) }),
        days !== null ? h("p", { class: `mn-age mn-age-${age}` }, ic("clock", 18),
          h("span", { text: age === "today" ? st("sv.today") : st("money.oldest", { d: daysWord(days) }) }),
          age === "old" ? h("b", { class: "mn-age-old", text: st("mn.old") }) : null) : null),
      h("div", { class: "mn-meter", "aria-hidden": "true" }, h("span", { class: "mn-meter-fill" })),
      h("div", { class: "mn-owe-acts" },
        h("button", { class: "keycap keycap-primary keycap-md mn-paid", type: "button", "aria-label": st("money.gotPaidLong", { name }),
          on: { click: (e) => handlers.paid(o, name, e.currentTarget) } }, ic("cash", 22), h("span", { text: st("money.gotPaid") })),
        remind),
      u.busy ? resultLine("busy", st("mn.reminding")) : null,
      u.opened ? resultLine("ok", st("mn.opened")) : null,
      u.link ? h("div", { class: "mn-blocked" }, resultLine("error", st("mn.blocked")),
        linkKey({ href: u.link, icon: "external", word: st("money.openWhatsapp"), tone: "primary", size: "sm" })) : null,
      u.error ? resultLine("error", u.error) : null));
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
    h("span", { class: "row-ico", "aria-hidden": "true" }, ic(MODE_ICON[r.mode] || "rupee", 22)),
    h("span", { class: "row-main" },
      scriptedText("span", name, { class: "row-title" }),
      h("span", { class: "row-sub" },
        h("span", { text: st(modeKey) !== modeKey ? st(modeKey) : (r.mode || "") }),
        r.mode === "razorpay_test" ? testTag() : null,
        d ? h("span", { text: when(d, { day: "numeric", month: "short" }) }) : null)),
    h("span", { class: "row-end mn-got-amt", text: money(r.amount) }));
}

/* ---------------------------------------------------------------- screen -- */

let receivedOpen = null; // the owner's own choice for the received fold

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
      // Open the tab inside the tap so a popup blocker lets it through; fill it when the link comes.
      let win = null;
      try { win = window.open("", "_blank"); } catch { win = null; }
      ui.set(id, { busy: true });
      render(true);
      try {
        const url = safeUrl(await remindCustomer(id));
        if (!url || !/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) throw Object.assign(new Error(st("sell.noPhone")), { status: 422 });
        if (win && !win.closed) {
          try { win.opener = null; } catch { /* ignore */ }
          win.location.href = url;
          ui.set(id, { opened: true });
        } else ui.set(id, { link: url });
      } catch (err) {
        if (win && !win.closed) win.close();
        ui.set(id, { error: err.status === 422 ? err.message : buttonError(err) });
      }
      render(true);
    },
  };

  function render(force = false) {
    const ready = sell.status === "ready";
    const toPay = ordersToPay([...appState.orders.values()]);
    const empty = ready && !sell.owed.length && !sell.receipts.length && !toPay.length;
    patch(head, JSON.stringify([document.documentElement.lang, sell.status, empty]), () => screenHead({
      id: "money-title",
      title: t("nav.money"),
      speakBtn: ready && sell.owed.length ? readButton("khata") : null,
      actions: ready ? [agentAction({ word: st("money.act"), hint: "money.hint" })] : [],
    }));
    if (force) body.__key = null;
    const key = JSON.stringify([document.documentElement.lang, sell.status, sell.owed, sell.receipts, [...sell.customers.values()], toPay, [...ui.entries()]]);
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
            sectionHead("mn-collect-h", "users", st("money.ladder"), sell.owed.length || null),
            sell.owed.length
              ? h("ol", { class: "mn-owed" }, ...sell.owed.map((o) => owedCard(o, max, ui, handlers)))
              : h("p", { class: "note-line mn-quiet" }, ic("checkCircle", 18), h("span", { text: st("mn.nobody") }))),
          h("div", { class: "mn-side" },
            h("section", { class: "mn-pay", "aria-labelledby": "mn-pay-h" },
              sectionHead("mn-pay-h", "cart", st("mn.payH"), toPay.length || null),
              toPay.length
                ? h("ul", { class: "rows mn-topays" }, ...toPay.map(toPayRow))
                : h("p", { class: "note-line mn-quiet" }, ic("checkCircle", 18), h("span", { text: st("mn.noPay") }))),
            fold({
              id: "mn-got-h", icon: "wallet", word: st("money.recent"), n: sell.receipts.length || null, cls: "mn-received",
              open: receivedOpen === null ? wideNow() : receivedOpen,
              onToggle: (open) => { receivedOpen = open; },
              body: sell.receipts.length
                ? h("ul", { class: "rows mn-gots" }, ...sell.receipts.slice(0, 30).map(receiptRow))
                : h("p", { class: "note-line mn-quiet" }, ic("info", 18), h("span", { text: st("money.noRecent") })),
            }))),
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
