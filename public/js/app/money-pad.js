// Money's two number-pad sheets (UI v3).
//  - "Got paid" (PayPadSheet): the amount big, one tap for the full amount owed, Cash / UPI as two
//    choice tiles, 64 px keys (and the keyboard's digits), Save -> POST /api/receipts. The owner's
//    own press of Save is the yes (the voice path reads back first). Saved: the sheet closes and
//    the "payment recorded" toast says so (notifyPaid, the same id as the live event).
//  - "Add phone" (AddPhoneSheet, D14): ten digits on the same keys, +91 shown, Save -> POST
//    /api/customers { name, phone } (the server keys customers by name), then Remind works.
// Digit rules (no leading zero, length caps, phone shape) are in sell-facts.js (node:test).

import { h, rupees } from "./dom.js";
import { addStrings } from "./i18n.js";
import { agentRequest } from "./store.js";
import { recordReceipt, loadSell } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { buttonError, ic, panel, resultLine, scriptedText } from "./sell-kit.js";
import { padPress, cleanPhone, phoneProblem, formatPhone } from "./sell-facts.js";
import { notifyPaid } from "./moments.js";

addStrings({
  "pp.clearAll": ["Clear the number", "पूरा नंबर हटाएँ", "ಪೂರ್ತಿ ಸಂಖ್ಯೆ ಅಳಿಸಿ"],
  "pp.of": ["{amt} owed in all", "कुल {amt} बाकी", "ಒಟ್ಟು {amt} ಬಾಕಿ"],
  "pp.more": ["This is more than they owe.", "यह बाकी से ज़्यादा है।", "ಇದು ಬಾಕಿಗಿಂತ ಹೆಚ್ಚು."],
  "pp.saving": ["Writing it down", "लिख रहे हैं", "ಬರೆಯಲಾಗುತ್ತಿದೆ"],
  "pp.phoneTitle": ["Phone for {name}", "{name} का फ़ोन", "{name} ಅವರ ಫೋನ್"],
  "pp.phoneLabel": ["Mobile number", "मोबाइल नंबर", "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ"],
  "pp.phoneHelp": ["The 10-digit number they use on WhatsApp.", "वह 10 अंकों का नंबर जिस पर WhatsApp है।", "WhatsApp ಇರುವ 10 ಅಂಕೆಯ ಸಂಖ್ಯೆ."],
  "pp.phoneShort": ["A mobile number has 10 digits.", "मोबाइल नंबर में 10 अंक होते हैं।", "ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯಲ್ಲಿ 10 ಅಂಕೆ ಇರುತ್ತವೆ."],
  "pp.phoneShape": ["An Indian mobile number starts with 6, 7, 8 or 9.", "भारत का मोबाइल नंबर 6, 7, 8 या 9 से शुरू होता है।", "ಭಾರತದ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ 6, 7, 8 ಅಥವಾ 9 ರಿಂದ ಶುರುವಾಗುತ್ತದೆ."],
  "pp.phoneSave": ["Save number", "नंबर सेव करें", "ಸಂಖ್ಯೆ ಉಳಿಸಿ"],
  "pp.phoneSaving": ["Saving the number", "नंबर सेव हो रहा है", "ಸಂಖ್ಯೆ ಉಳಿಸಲಾಗುತ್ತಿದೆ"],
  "pp.phoneSaved": ["Saved. You can remind them now.", "सेव हो गया। अब याद दिला सकते हैं।", "ಉಳಿಸಲಾಗಿದೆ. ಈಗ ನೆನಪಿಸಬಹುದು."],
  "pp.phoneFail": ["The number was not saved.", "नंबर सेव नहीं हुआ।", "ಸಂಖ್ಯೆ ಉಳಿಯಲಿಲ್ಲ."],
});

const AMOUNT_MAX = 8;

/** The 3 x 4 keys: 1-9, then `left` ("00" or "clear"), 0, back. Each press goes to onKey(k). */
function keys({ left = "00", onKey }) {
  const key = (k) => {
    if (k === "back") {
      return h("button", { class: "mp-key mp-key-back", type: "button", "aria-label": st("mpad.clear"), dataset: { tip: st("mpad.clear"), key: k }, on: { click: () => onKey(k) } }, ic("backspace", 28));
    }
    if (k === "clear") {
      return h("button", { class: "mp-key mp-key-clear", type: "button", "aria-label": st("pp.clearAll"), dataset: { tip: st("pp.clearAll"), key: k }, on: { click: () => onKey(k) } }, ic("x", 26));
    }
    return h("button", { class: "mp-key", type: "button", dataset: { key: k }, on: { click: () => onKey(k) } }, h("span", { text: k }));
  };
  return h("div", { class: "mp-keys", role: "group" }, ...["1", "2", "3", "4", "5", "6", "7", "8", "9", left, "0", "back"].map(key));
}

function setKeysBusy(grid, busy) {
  for (const b of grid.querySelectorAll("button")) b.disabled = busy;
}

/* --------------------------------------------------------------- got paid -- */

export function openPayPad({ customerId, name, owed, opener }) {
  let digits = "";
  let mode = "cash";
  let busy = false;

  const shown = h("output", { class: "bignum bignum-total mp-amount", "aria-live": "polite" });
  const over = h("p", { class: "note-line mp-over", hidden: true }, ic("info", 18), h("span", { text: st("pp.more") }));
  const err = h("div", { class: "mp-err", "aria-live": "assertive" });
  const full = owed && owed > 0 && Number.isInteger(owed)
    ? h("button", { class: "chip mp-full", type: "button", on: { click: () => { if (!busy) { digits = String(owed); sync(); } } } },
      ic("rupee", 20), h("span", { text: st("mpad.full", { amt: rupees(owed) }) }))
    : null;

  const modeTile = (id, icn) => h("button", {
    class: "choice mp-mode", type: "button", role: "radio", "aria-checked": "false", dataset: { mode: id },
    on: { click: () => { if (!busy) { mode = id; sync(); } }, keydown: (e) => roam(e) },
  }, ic(icn, 28), h("span", { text: st(`money.${id}`) }));
  const modes = h("div", { class: "choices mp-modes", role: "radiogroup", "aria-label": st("mpad.how") }, modeTile("cash", "cash"), modeTile("upi", "phone"));
  function roam(e) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    mode = mode === "cash" ? "upi" : "cash";
    sync();
    const on = modes.querySelector(`[data-mode="${mode}"]`);
    if (on) on.focus();
  }

  const grid = keys({ left: "00", onKey: (k) => press(k) });
  const saveIco = h("span", { class: "mp-save-ico", "aria-hidden": "true" }, ic("check", 26));
  const saveWord = h("span", { text: st("mpad.save") });
  const save = h("button", { class: "keycap keycap-primary keycap-md keycap-block mp-save", type: "button", on: { click: () => submit() } }, saveIco, saveWord);
  const footer = h("div", { class: "mp-foot" }, err, save);

  function press(k) {
    if (busy) return;
    digits = padPress(digits, k, { max: AMOUNT_MAX });
    err.replaceChildren();
    sync();
  }

  async function submit() {
    if (busy) return;
    const amt = Number(digits);
    if (!amt) { err.replaceChildren(resultLine("error", st("mpad.needAmount"))); return; }
    busy = true; sync();
    err.replaceChildren(resultLine("busy", st("pp.saving")));
    try {
      const rec = await recordReceipt({ customerId, amount: amt, mode });
      busy = false;
      api.close();
      notifyPaid({ receiptId: rec && rec.id, customerId, name, amount: amt });
    } catch (e) {
      busy = false;
      err.replaceChildren(resultLine("error", `${st("sbx.err.save")} ${buttonError(e)}`.trim()));
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
    setKeysBusy(grid, busy);
    save.setAttribute("aria-label", amt ? st("mpad.saveLong", { amt: rupees(amt), name }) : st("mpad.save"));
    if (busy) { save.setAttribute("aria-busy", "true"); saveIco.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" })); }
    else { save.removeAttribute("aria-busy"); saveIco.replaceChildren(ic("check", 26)); }
  }

  const body = h("div", { class: "mp-pad", tabindex: "-1" },
    h("div", { class: "mp-top" },
      h("div", { class: "mp-display" },
        h("span", { class: "mp-label", text: st("mpad.amount") }),
        shown,
        owed ? h("span", { class: "mp-of", text: st("pp.of", { amt: rupees(owed) }) }) : null)),
    full,
    over,
    h("p", { class: "mp-how", text: st("mpad.how") }),
    modes,
    grid);
  body.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest(".mp-mode")) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    else if (e.key === "Enter" && digits && !busy && !(e.target.closest && e.target.closest("button"))) { e.preventDefault(); submit(); }
  });
  sync();
  const api = panel({ title: st("mpad.title", { name }), body, footer, opener, speakKey: customerId ? `owed:${customerId}` : undefined });
  requestAnimationFrame(() => { const first = grid.querySelector(".mp-key"); if (first) first.focus(); });
  return api;
}

/* -------------------------------------------------------------- add phone -- */

/** D14: add a customer's phone so Remind can open WhatsApp. `onSaved()` runs after the save. */
export function openAddPhone({ name, opener, onSaved }) {
  let digits = "";
  let busy = false;
  let tried = false;

  const shown = h("span", { class: "mp-phone-digits" });
  const display = h("div", { class: "mp-phone", role: "status", "aria-live": "polite" },
    h("span", { class: "mp-phone-cc", text: "+91" }), shown);
  const msg = h("div", { class: "mp-phone-msg" });
  const grid = keys({ left: "clear", onKey: (k) => press(k) });
  const saveIco = h("span", { class: "mp-save-ico", "aria-hidden": "true" }, ic("check", 26));
  const save = h("button", { class: "keycap keycap-primary keycap-md keycap-block mp-save", type: "button", on: { click: () => submit() } }, saveIco, h("span", { text: st("pp.phoneSave") }));
  const footer = h("div", { class: "mp-foot" }, save);

  function help() {
    const p = phoneProblem(digits);
    if (tried && p !== "ok") {
      display.setAttribute("aria-invalid", "true");
      msg.replaceChildren(resultLine("error", st(p === "shape" ? "pp.phoneShape" : "pp.phoneShort")));
    } else {
      display.removeAttribute("aria-invalid");
      msg.replaceChildren(h("p", { class: "field-help", text: st("pp.phoneHelp") }));
    }
  }

  function press(k) {
    if (busy) return;
    digits = padPress(digits, k, { max: 10, noLeadingZero: false });
    // Fixing the number clears the error at once (forms rule); it comes back only on Save.
    tried = false;
    sync();
  }

  async function submit() {
    if (busy) return;
    tried = true;
    if (phoneProblem(digits) !== "ok") { sync(); return; }
    busy = true; sync();
    msg.replaceChildren(resultLine("busy", st("pp.phoneSaving")));
    try {
      await agentRequest("POST", "/api/customers", { name, phone: digits });
      await loadSell({ quiet: true });
      msg.replaceChildren(resultLine("ok", st("pp.phoneSaved")));
      busy = false;
      setKeysBusy(grid, true);
      if (onSaved) onSaved(digits);
      setTimeout(() => { if (api.isOpen()) api.close(); }, 900);
    } catch (e) {
      busy = false;
      sync();
      msg.replaceChildren(resultLine("error", `${st("pp.phoneFail")} ${buttonError(e)}`.trim()));
    }
  }

  function sync() {
    shown.textContent = formatPhone(digits);
    display.classList.toggle("is-zero", !digits);
    display.classList.toggle("is-full", digits.length === 10);
    setKeysBusy(grid, busy);
    if (busy) { save.setAttribute("aria-busy", "true"); saveIco.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" })); }
    else { save.removeAttribute("aria-busy"); saveIco.replaceChildren(ic("check", 26)); if (!msg.querySelector(".sv-line-ok")) help(); }
  }

  const body = h("div", { class: "mp-pad mp-pad-phone", tabindex: "-1" },
    h("p", { class: "field-label mp-phone-label" }, ic("phone", 20), h("span", { text: st("pp.phoneLabel") }), scriptedText("b", name, { class: "mp-phone-who" })),
    display, msg, grid);
  body.addEventListener("keydown", (e) => {
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
  });
  body.addEventListener("paste", (e) => {
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    if (!text) return;
    e.preventDefault();
    digits = cleanPhone(text);
    tried = false;
    sync();
  });
  sync();
  const api = panel({ title: st("pp.phoneTitle", { name }), body, footer, opener });
  requestAnimationFrame(() => { const first = grid.querySelector(".mp-key"); if (first) first.focus(); });
  return api;
}
