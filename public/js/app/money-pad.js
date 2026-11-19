// "Got paid": a number pad in a bottom sheet. Big amount, one tap for the full amount owed, cash or
// UPI as two big tiles, Save -> POST /api/receipts (the owner's own button press is the yes; the
// voice path reads back first), then the sheet closes and a toast confirms. Physical keyboard
// digits work too.

import { h, icon, rupees } from "./dom.js";
import { openSheet, closeSheet } from "./sheet.js";
import { keycapButton } from "./ui.js";
import { recordReceipt } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { buttonError } from "./sell-kit.js";
import { notifyPaid } from "./moments.js";

const MAX_DIGITS = 8;

export function openPayPad({ customerId, name, owed, opener }) {
  let digits = "";
  let mode = "cash";
  let busy = false;

  const shown = h("output", { class: "mpad-amount", "aria-live": "polite" });
  const err = h("p", { class: "sb-error", role: "alert", hidden: true });
  const full = owed && owed > 0 && Number.isInteger(owed)
    ? h("button", { class: "btn btn-ghost btn-sm mpad-full", type: "button", on: { click: () => { digits = String(owed); sync(); } } },
      icon("rupee", 20), h("span", { text: st("mpad.full", { amt: rupees(owed) }) }))
    : null;

  const modeBtn = (id, ic) => h("button", { class: "mpad-mode", type: "button", "aria-pressed": "false", dataset: { mode: id }, on: { click: () => { mode = id; sync(); } } },
    icon(ic, 28), h("span", { text: st(`money.${id}`) }));
  const modes = h("div", { class: "mpad-modes", role: "group", "aria-label": st("mpad.how") }, modeBtn("cash", "cash"), modeBtn("upi", "phone"));

  const press = (k) => {
    if (busy) return;
    if (k === "back") digits = digits.slice(0, -1);
    else if (digits.length < MAX_DIGITS && !(digits === "" && (k === "0" || k === "00"))) digits = (digits + k).slice(0, MAX_DIGITS);
    sync();
  };
  const key = (k) => k === "back"
    ? h("button", { class: "mpad-key mpad-key-back", type: "button", "aria-label": st("mpad.clear"), dataset: { tip: st("mpad.clear") }, on: { click: () => press("back") } }, icon("backspace", 28))
    : h("button", { class: "mpad-key", type: "button", on: { click: () => press(k) } }, h("span", { text: k }));
  const keys = h("div", { class: "mpad-keys" }, ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"].map(key));

  const saveSlot = h("div", { class: "mpad-save" });

  async function save() {
    const amt = Number(digits);
    if (!amt) { err.hidden = false; err.textContent = st("mpad.needAmount"); return; }
    busy = true; err.hidden = true; sync();
    try {
      const rec = await recordReceipt({ customerId, amount: amt, mode });
      busy = false;
      // Saved: the sheet closes and the "Payment recorded" toast says it (same id as the live event).
      closeSheet();
      notifyPaid({ receiptId: rec && rec.id, customerId, name, amount: amt });
    } catch (e) {
      busy = false;
      err.hidden = false;
      err.textContent = `${st("sbx.err.save")} ${buttonError(e)}`.trim();
      sync();
    }
  }

  function sync() {
    const amt = Number(digits || 0);
    shown.textContent = rupees(amt) || "₹0";
    shown.classList.toggle("is-zero", !amt);
    for (const b of modes.querySelectorAll(".mpad-mode")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
    for (const b of keys.querySelectorAll("button")) b.disabled = busy;
    const label = amt ? st("mpad.saveLong", { amt: rupees(amt), name }) : st("mpad.save");
    saveSlot.replaceChildren(keycapButton({ icon: "check", word: st("mpad.save"), label, tone: "leaf", size: "lg", busy, onClick: save }));
  }

  const body = h("div", { class: "mpad" },
    h("div", { class: "mpad-display" }, h("span", { class: "mpad-label", text: st("mpad.amount") }), shown, full),
    h("p", { class: "mpad-how", text: st("mpad.how") }), modes,
    keys, err, saveSlot);
  body.addEventListener("keydown", (e) => {
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); press("back"); }
    else if (e.key === "Enter" && digits && !busy && e.target === body) { e.preventDefault(); save(); }
  });
  body.tabIndex = -1;
  sync();
  openSheet({ title: st("mpad.title", { name }), body, opener });
  requestAnimationFrame(() => { const first = keys.querySelector(".mpad-key"); if (first) first.focus(); });
  return { close: () => closeSheet() };
}

