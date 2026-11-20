// Money's sheets (UI v5): "Who paid?" (pick a customer who owes), the pay pad (amount, Cash / UPI,
// Save -> POST /api/receipts; the owner's own Save is the yes), "Add phone" (ten digits on the
// shared keypad -> POST /api/customers { name, phone }; the server keys customers by name), and
// the WhatsApp reminder (POST /api/customers/:id/remind gives the wa.me link). Digit rules live in
// sell-facts.js (node:test). Styles: css/money.css on top of the shared kit (css/components.css).

import { h, icon, rupees, safeUrl, money, initialsOf, scripted, button, errorLine, openSheet, closeSheet, createKeypad, toDate, daysSince } from "./ui.js";
import { t, when, addStrings } from "./i18n.js";
import { agentRequest } from "./store.js";
import { sell, recordReceipt, loadSell, remindCustomer, customerOf } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { padPress, formatPhone, phoneProblem } from "./sell-facts.js";
import { notifyPaid } from "./moments.js";

addStrings({
  "mp5.askTitle": ["Ask for money", "पैसे माँगें", "ಹಣ ಕೇಳಿ"],
  "mp5.askText": ["Choose who to remind. Sahay opens WhatsApp with the message and a pay link (test mode).", "किसे याद दिलाना है चुनिए। सहाय संदेश और भुगतान लिंक (टेस्ट मोड) के साथ WhatsApp खोलेगी।", "ಯಾರಿಗೆ ನೆನಪಿಸಬೇಕು ಆಯ್ಕೆಮಾಡಿ. ಸಹಾಯ್ ಸಂದೇಶ ಮತ್ತು ಪಾವತಿ ಲಿಂಕ್ (ಟೆಸ್ಟ್ ಮೋಡ್) ಜೊತೆ WhatsApp ತೆರೆಯುತ್ತದೆ."],
  "mp5.remindSub": ["Remind on WhatsApp", "WhatsApp पर याद दिलाएँ", "WhatsApp ನಲ್ಲಿ ನೆನಪಿಸಿ"],
  "mp5.nobody": ["Nobody owes you money.", "किसी पर पैसा बाकी नहीं।", "ಯಾರೂ ಹಣ ಬಾಕಿ ಇಟ್ಟಿಲ್ಲ."],
  "mp5.owesYou": ["Owes you", "आपको देना है", "ನಿಮಗೆ ಕೊಡಬೇಕು"],
  "mp5.since": ["Since {date}", "{date} से", "{date}ರಿಂದ"],
  "mp5.daysAgo": ["{n} days", "{n} दिन", "{n} ದಿನ"],
  "mp5.nothingOwed": ["Nothing owed right now.", "अभी कुछ बाकी नहीं।", "ಈಗ ಏನೂ ಬಾಕಿ ಇಲ್ಲ."],
  "mp5.of": ["{amt} owed in all", "कुल {amt} बाकी", "ಒಟ್ಟು {amt} ಬಾಕಿ"],
  "mp5.more": ["This is more than they owe.", "यह बाकी से ज़्यादा है।", "ಇದು ಬಾಕಿಗಿಂತ ಹೆಚ್ಚು."],
  "mp5.howPaid": ["How did they pay?", "कैसे दिए?", "ಹೇಗೆ ಕೊಟ್ಟರು?"],
  "mp5.saving": ["Writing it down", "लिख रहे हैं", "ಬರೆಯಲಾಗುತ್ತಿದೆ"],
  "mp5.clearAll": ["Clear the amount", "रकम हटाएँ", "ಮೊತ್ತ ಅಳಿಸಿ"],
  "mp5.phoneTitle": ["Phone for {name}", "{name} का फ़ोन", "{name} ಅವರ ಫೋನ್"],
  "mp5.phoneText": ["The 10-digit number they use on WhatsApp.", "वह 10 अंकों का नंबर जिस पर WhatsApp है।", "WhatsApp ಇರುವ 10 ಅಂಕೆಯ ಸಂಖ್ಯೆ."],
  "mp5.phoneSave": ["Save number", "नंबर सेव करें", "ಸಂಖ್ಯೆ ಉಳಿಸಿ"],
  "mp5.phoneShape": ["An Indian mobile number starts with 6, 7, 8 or 9.", "भारत का मोबाइल नंबर 6, 7, 8 या 9 से शुरू होता है।", "ಭಾರತದ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ 6, 7, 8 ಅಥವಾ 9 ರಿಂದ ಶುರುವಾಗುತ್ತದೆ."],
  "mp5.phoneShort": ["A mobile number has 10 digits.", "मोबाइल नंबर में 10 अंक होते हैं।", "ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯಲ್ಲಿ 10 ಅಂಕೆ ಇರುತ್ತವೆ."],
  "mp5.phoneSaved": ["Saved. You can send on WhatsApp now.", "सेव हो गया। अब WhatsApp पर भेज सकते हैं।", "ಉಳಿಸಲಾಗಿದೆ. ಈಗ WhatsApp ನಲ್ಲಿ ಕಳುಹಿಸಬಹುದು."],
  "mp5.phoneFail": ["The number was not saved.", "नंबर सेव नहीं हुआ।", "ಸಂಖ್ಯೆ ಉಳಿಯಲಿಲ್ಲ."],
  "mp5.addPhone": ["Add phone", "फ़ोन जोड़ें", "ಫೋನ್ ಸೇರಿಸಿ"],
  "mp5.addPhoneLong": ["Add a phone number for {name}", "{name} का फ़ोन नंबर जोड़ें", "{name} ಅವರ ಫೋನ್ ಸಂಖ್ಯೆ ಸೇರಿಸಿ"],
  "mp5.opened": ["WhatsApp opened with the reminder.", "याद दिलाने का संदेश WhatsApp में खुल गया।", "ನೆನಪಿನ ಸಂದೇಶ WhatsApp ನಲ್ಲಿ ತೆರೆಯಿತು."],
  "mp5.blocked": ["The browser stopped WhatsApp from opening. Press Open WhatsApp.", "ब्राउज़र ने WhatsApp नहीं खोलने दिया। WhatsApp खोलें दबाइए।", "ಬ್ರೌಸರ್ WhatsApp ತೆರೆಯಲು ಬಿಡಲಿಲ್ಲ. WhatsApp ತೆರೆಯಿರಿ ಒತ್ತಿ."],
  "mp5.noPhone": ["This customer has no phone number yet.", "इस ग्राहक का फ़ोन नंबर अभी नहीं है।", "ಈ ಗ್ರಾಹಕರ ಫೋನ್ ಸಂಖ್ಯೆ ಇನ್ನೂ ಇಲ್ಲ."],
});

const AMOUNT_MAX = 8;
const errText = (err, fallback) => (err && (err.say || (err.status === 0 ? t("err.network") : err.status === 429 ? t("err.limit") : null))) || fallback;

/* ------------------------------------------------------------- remind -- */

/**
 * Remind a customer on WhatsApp. The tab opens inside the tap (so a popup blocker lets it through)
 * and is filled when the link comes. Resolves { opened: true } or { link } when the browser blocked
 * the tab; rejects with a message for the owner.
 */
export async function remindOnWhatsApp(customerId) {
  let win = null;
  try { win = window.open("", "_blank"); } catch { win = null; }
  try {
    const url = safeUrl(await remindCustomer(customerId));
    if (!url || !/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) throw Object.assign(new Error(st("mp5.noPhone")), { status: 422 });
    if (win && !win.closed) {
      try { win.opener = null; } catch { /* ignore */ }
      win.location.href = url;
      return { opened: true };
    }
    return { link: url };
  } catch (err) {
    if (win && !win.closed) win.close();
    throw Object.assign(new Error(err.status === 422 ? err.message : errText(err, st("sbx.err.save"))), { status: err.status });
  }
}

/* ------------------------------------------------- ask for money, customer -- */

/** The name of a customer who owes (from the khata row or the customers list). */
export function owedName(o) {
  const c = o.customer || customerOf(o.customerId);
  return (c && c.name) || st("sell.walkin");
}

/**
 * "Ask for money" (Money's primary): choose a customer who owes. With a phone, the tap opens
 * WhatsApp with the reminder (inside the tap, so the browser allows the new tab); without one, the
 * Add phone keypad opens first.
 */
export function openAskForMoney(opener) {
  const result = h("div", { class: "mp-msg", "aria-live": "polite" });
  const rows = sell.owed.map((o) => {
    const name = owedName(o);
    const c = customerOf(o.customerId) || o.customer;
    const phone = c && c.phone;
    return h("li", null, h("button", {
      class: "row", type: "button", "aria-label": phone ? st("money.remindLong", { name }) : st("mp5.addPhoneLong", { name }),
      on: {
        click: async (e) => {
          if (!phone) { openAddPhone({ name, opener }); return; }
          const btn = e.currentTarget;
          btn.setAttribute("aria-busy", "true");
          try {
            const r = await remindOnWhatsApp(String(o.customerId));
            result.replaceChildren(remindNote(r));
          } catch (err) { result.replaceChildren(errorLine(err.message)); }
          btn.removeAttribute("aria-busy");
        },
      },
    },
    h("span", { class: "row-ico mp-initials", "aria-hidden": "true" }, scripted("span", initialsOf(name))),
    h("span", { class: "row-main" }, scripted("span", name, { class: "row-title" }),
      h("span", { class: "row-sub", text: phone ? st("mp5.remindSub") : st("mp5.noPhone") })),
    h("span", { class: "row-end" }, h("span", { class: "amount", text: money(o.amount) }), icon(phone ? "send" : "phone", 20, "row-chev"))));
  });
  openSheet({
    title: st("mp5.askTitle"),
    opener,
    body: rows.length
      ? [h("p", { class: "page-sentence", text: st("mp5.askText") }), h("ul", { class: "list", "aria-label": st("mp5.askTitle") }, ...rows)]
      : h("p", { class: "page-sentence", text: st("mp5.nobody") }),
    footer: result,
  });
}

/** The line under a reminder: opened, or blocked with the link to open by hand. */
export function remindNote(r) {
  if (r && r.link) {
    return h("div", { class: "mp-blocked" }, errorLine(st("mp5.blocked")),
      button({ word: st("money.openWhatsapp"), icon: "external", kind: "secondary", size: "sm", href: r.link, newTab: true }));
  }
  return h("p", { class: "note-line mp-ok" }, icon("checkCircle", 18), h("span", { text: st("mp5.opened") }));
}

/**
 * A customer's sheet (row tap on Money "Owed to you" or Sell "Customers"): what they owe, since
 * when, then Got paid (the pay pad) and Remind on WhatsApp (or Add phone first).
 */
export function openCustomerSheet({ customerId, opener }) {
  const id = String(customerId);
  const o = sell.owed.find((x) => String(x.customerId) === id) || null;
  const c = customerOf(id) || (o && o.customer) || null;
  const name = (c && c.name) || (o && owedName(o)) || st("sell.walkin");
  const owed = o ? o.amount : 0;
  const since = o ? toDate(o.oldestDue) : null;
  const days = o ? daysSince(o.oldestDue) : null;
  const note = h("div", { class: "mp-msg", "aria-live": "polite" });
  const remind = c && c.phone
    ? button({ word: st("money.remind"), icon: "send", kind: "secondary", block: true, label: st("money.remindLong", { name }),
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.setAttribute("aria-busy", "true");
        try { note.replaceChildren(remindNote(await remindOnWhatsApp(id))); } catch (err) { note.replaceChildren(errorLine(err.message)); }
        btn.removeAttribute("aria-busy");
      } })
    : addPhoneButton(name, { size: "md" });
  const body = [
    h("div", { class: "mp-cust" },
      h("span", { class: "mp-initials mp-initials-lg", "aria-hidden": "true" }, scripted("span", initialsOf(name))),
      h("div", null,
        c && c.phone ? h("p", { class: "mp-cust-phone", text: c.phone }) : h("p", { class: "mp-cust-phone is-none", text: st("mp5.noPhone") }))),
    owed
      ? h("div", { class: "mp-owes-block" },
        h("p", { class: "mp-label", text: st("mp5.owesYou") }),
        h("p", { class: "figure mp-owes-figure", text: money(owed) }),
        since ? h("p", { class: "mp-of", text: `${st("mp5.since", { date: when(since, { day: "numeric", month: "long" }) })}${days ? `, ${st("mp5.daysAgo", { n: days })}` : ""}` }) : null)
      : h("p", { class: "note-line mp-ok" }, icon("checkCircle", 18), h("span", { text: st("mp5.nothingOwed") })),
    note,
  ];
  const footer = owed
    ? [button({ word: st("money.gotPaid"), icon: "cash", kind: "primary", block: true, label: st("money.gotPaidLong", { name }), onClick: () => openPayPad({ customerId: id, name, owed, opener }) }), remind]
    : [remind];
  return openSheet({ title: name, body, footer, opener, speakKey: owed ? `owed:${id}` : undefined });
}

/* ------------------------------------------------------------ pay pad -- */

export function openPayPad({ customerId, name, owed, opener }) {
  let digits = "";
  let mode = "cash";
  let busy = false;

  const shown = h("output", { class: "figure mp-amount", "aria-live": "polite" });
  const over = h("p", { class: "note-line mp-over", hidden: true }, icon("info", 18), h("span", { text: st("mp5.more") }));
  const msg = h("div", { class: "mp-msg", "aria-live": "assertive" });
  const full = owed && owed > 0 && Number.isInteger(owed)
    ? button({ word: st("mpad.full", { amt: rupees(owed) }), icon: "rupee", kind: "secondary", size: "sm", onClick: () => { if (!busy) { digits = String(owed); sync(); } } })
    : null;

  const modeBtn = (id, ic) => h("button", {
    class: "mp-mode", type: "button", role: "radio", "aria-checked": "false", dataset: { mode: id },
    on: { click: () => { if (!busy) { mode = id; sync(); } }, keydown: roam },
  }, icon(ic, 24), h("span", { text: st(`money.${id}`) }));
  const modes = h("div", { class: "mp-modes", role: "radiogroup", "aria-label": st("mp5.howPaid") }, modeBtn("cash", "cash"), modeBtn("upi", "phone"));
  function roam(e) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    mode = mode === "cash" ? "upi" : "cash";
    sync();
    const on = modes.querySelector(`[data-mode="${mode}"]`);
    if (on) on.focus();
  }

  const key = (k) => {
    if (k === "back") return h("button", { class: "pad-key pad-key-del", type: "button", "aria-label": st("mpad.clear"), dataset: { tip: st("mpad.clear") }, on: { click: () => press(k) } }, icon("backspace", 26));
    return h("button", { class: "pad-key", type: "button", dataset: { digit: k }, text: k, on: { click: () => press(k) } });
  };
  const keys = h("div", { class: "pad-keys mp-keys", role: "group", "aria-label": st("mpad.amount") }, ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map(key));
  const save = button({ word: st("mpad.save"), icon: "check", kind: "primary", block: true, onClick: () => submit() });

  function press(k) {
    if (busy) return;
    digits = padPress(digits, k, { max: AMOUNT_MAX });
    msg.replaceChildren();
    sync();
  }

  async function submit() {
    if (busy) return;
    const amt = Number(digits);
    if (!amt) { msg.replaceChildren(errorLine(st("mpad.needAmount"))); return; }
    busy = true; sync();
    msg.replaceChildren(h("p", { class: "note-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: st("mp5.saving") })));
    try {
      const rec = await recordReceipt({ customerId, amount: amt, mode });
      busy = false;
      closeSheet();
      notifyPaid({ receiptId: rec && rec.id, customerId, name, amount: amt });
    } catch (e) {
      busy = false;
      msg.replaceChildren(errorLine(`${st("sbx.err.save")} ${errText(e, "")}`.trim()));
      sync();
    }
  }

  function sync() {
    const amt = Number(digits || 0);
    shown.textContent = rupees(amt) || "₹0";
    shown.classList.toggle("is-zero", !amt);
    over.hidden = !(owed && amt > owed);
    for (const b of modes.querySelectorAll(".mp-mode")) {
      const on = b.dataset.mode === mode;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const b of keys.querySelectorAll("button")) b.disabled = busy;
    save.setAttribute("aria-label", amt ? st("mpad.saveLong", { amt: rupees(amt), name }) : st("mpad.save"));
    if (busy) save.setAttribute("aria-busy", "true"); else save.removeAttribute("aria-busy");
  }

  const body = h("div", { class: "mp-pad", tabindex: "-1" },
    h("div", { class: "mp-display" },
      h("span", { class: "mp-label", text: st("mpad.amount") }),
      shown,
      owed ? h("span", { class: "mp-of", text: st("mp5.of", { amt: rupees(owed) }) }) : null),
    full, over,
    h("p", { class: "mp-how", text: st("mp5.howPaid") }), modes,
    keys);
  body.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest(".mp-mode")) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    else if (e.key === "Enter" && digits && !busy && !(e.target.closest && e.target.closest("button"))) { e.preventDefault(); submit(); }
  });
  sync();
  const api = openSheet({ title: st("mpad.title", { name }), body, footer: [msg, save], opener, speakKey: customerId ? `owed:${customerId}` : undefined });
  requestAnimationFrame(() => { const first = keys.querySelector(".pad-key"); if (first) first.focus(); });
  return api;
}

/* ---------------------------------------------------------- add phone -- */

/** D14: add a customer's phone so WhatsApp works. `onSaved(digits)` runs after the save. */
export function openAddPhone({ name, opener, onSaved }) {
  const msg = h("div", { class: "mp-msg", "aria-live": "polite" }, h("p", { class: "note-line", text: st("mp5.phoneText") }));
  let api = null;
  const pad = createKeypad({
    length: 10, label: st("mp5.phoneTitle", { name }), doneWord: st("mp5.phoneSave"),
    format: (d) => [h("span", { class: "mp-cc", text: "+91" }), h("span", { text: formatPhone(d) })],
    onDone: (d) => submit(d),
  });
  const save = button({ word: st("mp5.phoneSave"), icon: "check", kind: "primary", block: true, onClick: () => submit(pad.value) });

  async function submit(digits) {
    const p = phoneProblem(digits);
    if (p !== "ok") { pad.setError(st(p === "shape" ? "mp5.phoneShape" : "mp5.phoneShort")); pad.shake(); return; }
    pad.setBusy(true);
    save.setAttribute("aria-busy", "true");
    try {
      await agentRequest("POST", "/api/customers", { name, phone: digits });
      await loadSell({ quiet: true });
      msg.replaceChildren(h("p", { class: "note-line mp-ok" }, icon("checkCircle", 18), h("span", { text: st("mp5.phoneSaved") })));
      if (onSaved) onSaved(digits);
      setTimeout(() => { if (api && api.isOpen()) api.close(); }, 900);
    } catch (e) {
      pad.setBusy(false);
      msg.replaceChildren(errorLine(`${st("mp5.phoneFail")} ${errText(e, "")}`.trim()));
    }
    save.removeAttribute("aria-busy");
  }

  api = openSheet({
    title: st("mp5.phoneTitle", { name }),
    body: [scripted("p", name, { class: "mp-phone-who" }), pad.el],
    footer: [msg, save],
    opener,
  });
  requestAnimationFrame(() => pad.focus());
  return api;
}

/** The small button that opens Add phone for a customer. */
export function addPhoneButton(name, { size = "sm", onSaved } = {}) {
  return button({
    word: st("mp5.addPhone"), icon: "phone", kind: "secondary", size, label: st("mp5.addPhoneLong", { name }),
    onClick: (e) => openAddPhone({ name, opener: e.currentTarget, onSaved }),
  });
}

