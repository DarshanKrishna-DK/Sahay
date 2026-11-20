// Popover and picker primitives (D18: no native <select>, no dropdown menus on owner screens; the
// only popover is the three-language LangPopover; long lists are a PickerSheet).
//
// openPopover({ anchor, label, items: [{ id, label, lang, current, icon }], onPick(id) (may return a
//   promise: the item shows saving, then the popover closes; a rejection shows errorText()),
//   errorText }) -> { close() }
//   Glass, anchored to the control (above/right of it when there is room), roving focus with the
//   arrow keys, Esc / outside tap closes and focus returns to the anchor.
//
// openPicker({ title, items: [{ id, label, sub, lang }], current, searchLabel, emptyText, onPick(id),
//   opener }) -> the sheet handle. Big rows, a search field on top, "no match" state.

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { openSheet, closeSheet } from "./sheet.js";

let open = null;

function host() {
  return document.querySelector(".sheet-host") || document.body;
}

export function closePopover(restore = true) {
  if (!open) return;
  const { el, anchor, off } = open;
  open = null;
  off();
  el.classList.remove("is-open");
  setTimeout(() => el.remove(), 180);
  if (restore && anchor && anchor.isConnected) anchor.focus();
  if (anchor) anchor.setAttribute("aria-expanded", "false");
}

export function openPopover({ anchor, label, items, onPick, errorText }) {
  closePopover(false);
  const err = h("p", { class: "error-line popover-err", role: "alert", hidden: true });
  const buttons = items.map((it) => h("button", {
    class: "popover-item", type: "button", role: "menuitemradio", lang: it.lang || undefined,
    "aria-checked": it.current ? "true" : "false", dataset: { id: it.id }, tabindex: "-1",
  }, it.icon ? icon(it.icon, 22) : null, h("span", { text: it.label }), it.current ? h("span", { class: "pi-check" }, icon("check", 20)) : null));
  const el = h("div", { class: "popover glass glass-rim", role: "menu", "aria-label": label },
    label ? h("p", { class: "popover-title", "aria-hidden": "true", text: label }) : null, ...buttons, err);
  host().append(el);

  // Position: under the anchor (top bar), right-aligned to it; above it when there is no room below;
  // beside it for a control low in a left rail. Clamped to the viewport.
  const r = anchor.getBoundingClientRect();
  const pw = el.offsetWidth, ph = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(vw - pw - 12, Math.max(12, r.right - pw)), top = r.bottom + 8;
  let origin = "right top";
  if (top + ph > vh - 12) {
    if (r.left < 160 && r.right + 12 + pw < vw - 12) { left = r.right + 12; top = Math.max(12, r.bottom - ph); origin = "left bottom"; }
    else { top = r.top - ph - 8; origin = "right bottom"; }
  }
  if (top < 12) top = 12;
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
  el.style.setProperty("--origin", origin);
  anchor.setAttribute("aria-expanded", "true");

  const focusAt = (i) => { const b = buttons[(i + buttons.length) % buttons.length]; b.focus(); };
  const onKey = (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closePopover(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(buttons.length - 1); }
    else if (e.key === "Tab") closePopover(false);
  };
  const onDown = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(false); };
  el.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onDown, true);
  const off = () => { document.removeEventListener("pointerdown", onDown, true); };
  open = { el, anchor, off };

  for (const b of buttons) {
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-checked") === "true") { closePopover(); return; }
      err.hidden = true;
      b.setAttribute("aria-busy", "true");
      const spin = h("span", { class: "spinner pi-check", "aria-hidden": "true" });
      b.append(spin);
      try {
        await onPick(b.dataset.id);
        closePopover();
      } catch (e) {
        spin.remove();
        b.removeAttribute("aria-busy");
        err.replaceChildren(icon("alert", 18), h("span", { text: (errorText && errorText(e)) || (e && (e.say || e.message)) || "" }));
        err.hidden = false;
      }
    });
  }
  requestAnimationFrame(() => {
    el.classList.add("is-open");
    const cur = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    focusAt(cur < 0 ? 0 : cur);
  });
  return { close: () => closePopover() };
}

export function openPicker({ title, items, current = null, searchLabel, emptyText, onPick, opener, speakKey }) {
  const input = h("input", { class: "field-input", type: "search", autocomplete: "off", spellcheck: "false", "aria-label": searchLabel || t("shell.search") });
  const list = h("div", { class: "picker-list", role: "listbox", "aria-label": title });
  const none = h("p", { class: "note-line", role: "status", hidden: true }, icon("search", 20), h("span", { text: emptyText || t("shell.noMatch") }));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/\s+/g, " ").trim();
  function render() {
    const q = norm(input.value);
    const shown = items.filter((it) => !q || norm(it.label).includes(q) || norm(it.sub).includes(q) || norm(it.id).includes(q));
    list.replaceChildren(...shown.map((it) => h("button", {
      class: "picker-item", type: "button", role: "option", lang: it.lang || undefined,
      "aria-selected": String(it.id === current), dataset: { id: it.id },
      on: { click: () => { closeSheet(); onPick(it.id); } },
    }, it.id === current ? icon("check", 22) : null, h("span", { text: it.label }), it.sub ? h("span", { class: "pi-sub", text: it.sub }) : null)));
    none.hidden = shown.length > 0;
  }
  input.addEventListener("input", render);
  render();
  const body = h("div", { class: "picker" },
    h("label", { class: "field picker-search" }, h("span", { class: "field-label", text: searchLabel || t("shell.search") }), input),
    none, list);
  const sheet = openSheet({ title, body, opener, speakKey });
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
  return sheet;
}
