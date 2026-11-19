// Big number keypad: 76px key-caps 1-9, delete, 0, done. Used for the phone number and the PIN
// (and anything else that is only digits). The physical keyboard works too (digits, Backspace,
// Enter) while focus is inside the pad's root. Nothing here is a <form>: the owner never has to
// find a submit button, the green check is it.
//
// createKeypad({ length, mask, label, onDone, format }) -> { el, value, clear(), setBusy(b), focus() }

import { h, icon, fill } from "./dom.js";
import { t, addStrings } from "./i18n.js";

addStrings({
  "pad.delete": ["Delete last number", "आखिरी अंक मिटाएँ", "ಕೊನೆಯ ಅಂಕಿ ಅಳಿಸಿ"],
  "pad.done": ["Done", "हो गया", "ಆಯಿತು"],
  "pad.count": ["{n} of {total} numbers", "{total} में से {n} अंक", "{total} ರಲ್ಲಿ {n} ಅಂಕಿ"],
});

export function createKeypad({ length = 4, mask = false, label = "", onDone, format, doneWord } = {}) {
  let value = "";
  let busy = false;
  const cells = h("div", { class: `pad-cells${mask ? " pad-cells-pin" : " pad-cells-text"}`, "aria-hidden": "true" });
  const status = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const keys = h("div", { class: "pad-keys", role: "group", "aria-label": label });
  const root = h("div", { class: "pad", tabindex: "-1" }, cells, status, keys);

  const key = (digit) => h("button", { class: "pad-key", type: "button", dataset: { digit }, text: digit, on: { click: () => press(digit) } });
  const del = h("button", { class: "pad-key pad-key-del", type: "button", "aria-label": t("pad.delete"), dataset: { tip: t("pad.delete") }, on: { click: back } }, icon("backspace", 30));
  const done = h("button", { class: "pad-key pad-key-done", type: "button", "aria-label": doneWord || t("pad.done"), dataset: { tip: doneWord || t("pad.done") }, on: { click: finish } }, icon("check", 34));
  keys.append(...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(key), del, key("0"), done);

  root.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); back(); }
    else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); finish(); }
  });
  root.addEventListener("paste", (e) => {
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    const digits = text.replace(/\D/g, "").slice(-length);
    if (digits) { e.preventDefault(); value = digits; render(); }
  });

  function press(d) { if (busy || value.length >= length) return; value += d; render(); if (mask && value.length === length) finish(); }
  function back() { if (busy) return; value = value.slice(0, -1); render(); }
  function finish() { if (busy || value.length !== length) return; if (onDone) onDone(value); }

  function render() {
    if (mask) {
      fill(cells, ...Array.from({ length }, (_, i) => h("span", { class: `pad-cell${i < value.length ? " is-on" : ""}${i === value.length ? " is-next" : ""}` })));
    } else {
      fill(cells, h("span", { class: "pad-text" }, format ? format(value) : value, h("span", { class: "pad-caret" })));
    }
    status.textContent = t("pad.count", { n: value.length, total: length });
    done.disabled = busy || value.length !== length;
    del.disabled = busy || value.length === 0;
    for (const b of keys.querySelectorAll("[data-digit]")) b.disabled = busy;
    root.dataset.full = String(value.length === length);
  }
  render();

  return {
    el: root,
    get value() { return value; },
    clear() { value = ""; render(); },
    setBusy(b) { busy = b; render(); },
    focus() { root.focus({ preventScroll: true }); },
    shake() { root.classList.remove("pad-shake"); void root.offsetWidth; root.classList.add("pad-shake"); },
  };
}
