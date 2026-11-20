// Sahay UI kit (v5). Every screen builds from these; looks live in public/css/components.css.
// Contract: public/css/README.md. All text goes in through textContent (dom.js h()), never as HTML.
//
//   h, $, fill, patch, scripted, icon, ICON_NAMES, rupees, amount, num, toDate, safeUrl   (dom.js)
//   money, qtyText, itemName, daysSince, daysWord, initial, initialsOf                      (format.js)
//   notify, dismiss                                                                          (toast.js)
//   createKeypad                                                                             (keypad.js)
//   button({ word, icon, kind, size, onClick, href, label, busy, block, type, newTab })
//   pageHead({ title, accent, sentence, action })        title + one plain sentence + ONE primary action
//   section({ title, count, sub, action, body })          an h2 group (never more than ~3 per view)
//   card({ title, sub, body, foot, onClick, needs })      a solid card; onClick makes it one button
//   list(rows, { limit = 5, showAllWord, onShowAll })     cards' list of rows; rows: { icon, title, sub, end, onClick, href, lang }
//   chip(word, { tone, icon })                            status chip: good | warn | needs | info | (neutral)
//   simChip(), testChip()                                 "simulated vendor", "test mode" (always shown where they apply)
//   emptyState({ icon, title, text, action, inline })     icon, one title, one sentence, one action
//   skeleton(kind = "rows", n = 3)                        rows | cards | lines, in the shape of what loads
//   errorLine(text)                                       alert icon + the words
//   field({...}), phoneField({...})                       labelled inputs (validate on first blur)
//   segmented({ label, options, value, onPick })          tabs / segmented choice
//   toggle({ label, checked, onChange })                  on / off switch
//   yesNo({ onYes, onNo, busy, yesWord, noWord, yesLabel, noLabel })   two big buttons, No left, Yes pink right
//   openSheet({ title, body, footer, opener, label, onClose, speakKey }) -> handle; closeSheet()
//                                                         bottom sheet on phones, centred modal from 768px
//   openMenu({ anchor, label, items, onPick })            small menu under its button (language, account)
//   langSwitch() -> { el, update }; uiLang(); setUiLang(code)   English default, per device (sahay-ui-lang)
//   brandMark({ word = true, size = 36 })                 the real Sahay logo (+ "Sahay")

import { h, $, fill, patch, scripted, icon, ICON_NAMES, rupees, amount, num, toDate, safeUrl } from "./dom.js";
import { t, lang, setLang, onLang, LANGS, addStrings } from "./i18n.js";
import { speakButton } from "./speak.js";

export { h, $, fill, patch, scripted, icon, ICON_NAMES, rupees, amount, num, toDate, safeUrl };
export { money, qtyText, itemName, daysSince, daysWord, initial, initialsOf } from "./format.js";
export { notify, dismiss } from "./toast.js";
export { createKeypad } from "./keypad.js";

addStrings({
  "ui.showAll": ["Show all ({n})", "सब देखें ({n})", "ಎಲ್ಲಾ ನೋಡಿ ({n})"],
  "ui.showLess": ["Show fewer", "कम दिखाएँ", "ಕಡಿಮೆ ತೋರಿಸಿ"],
  "ui.yes": ["Yes", "हाँ", "ಹೌದು"],
  "ui.no": ["No", "नहीं", "ಇಲ್ಲ"],
  "ui.language": ["Language", "भाषा", "ಭಾಷೆ"],
  "ui.testMode": ["test mode", "टेस्ट मोड", "ಟೆಸ್ಟ್ ಮೋಡ್"],
  "ui.saving": ["Saving", "सेव हो रहा है", "ಉಳಿಸುತ್ತಿದೆ"],
});

/* ------------------------------------------------------------ buttons -- */
const KINDS = new Set(["primary", "secondary", "ghost", "danger"]);
export function button({ word, icon: ic, kind = "primary", size = "md", onClick, href, label, busy = false, block = false, type = "button", newTab = false, cls = "" } = {}) {
  const k = KINDS.has(kind) ? kind : "primary";
  const classes = `btn btn-${k}${size === "hero" ? " btn-hero" : size === "sm" ? " btn-sm" : ""}${block ? " btn-block" : ""}${cls ? ` ${cls}` : ""}`;
  const inner = [busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : (ic ? icon(ic, 22) : null), scripted("span", word || "")];
  const aria = label && label !== word ? label : undefined;
  if (href) {
    const ext = newTab || /^https?:/i.test(href);
    return h("a", { class: classes, href, "aria-label": aria, target: ext ? "_blank" : undefined, rel: ext ? "noopener noreferrer" : undefined, on: onClick ? { click: onClick } : undefined }, ...inner);
  }
  return h("button", { class: classes, type, "aria-label": aria, "aria-busy": busy ? "true" : undefined, disabled: busy ? true : undefined, on: onClick ? { click: onClick } : undefined }, ...inner);
}

/* -------------------------------------------------------- page / section -- */
/** Every screen starts here: a title (its `accent` part pink), one plain sentence, ONE primary action. */
export function pageHead({ title, accent, sentence, action } = {}) {
  const act = action instanceof Node ? action : action ? button({ ...action, kind: "primary" }) : null;
  return h("header", { class: "page-head" },
    h("div", { class: "page-head-text" },
      h("h1", { class: "page-title", tabindex: "-1" }, title ? scripted("span", title) : null, accent ? scripted("span", accent, { class: "accent" }) : null),
      sentence ? scripted("p", sentence, { class: "page-sentence" }) : null),
    act ? h("div", { class: "page-action" }, act) : null);
}

export function section({ title, count, sub, action, body, id } = {}) {
  const head = h("div", { class: "section-head" },
    h("div", null,
      h("h2", { class: "section-title", id }, scripted("span", title || ""), count !== undefined && count !== null ? h("span", { class: "count", text: String(count) }) : null),
      sub ? scripted("p", sub, { class: "section-sub" }) : null),
    action || null);
  return h("section", { class: "section", "aria-labelledby": id || undefined }, head, ...(Array.isArray(body) ? body : [body]));
}

/* --------------------------------------------------------------- cards -- */
export function card({ title, sub, body, foot, onClick, needs = false, speakKey, cls = "" } = {}) {
  const head = title || speakKey ? h("div", { class: "card-head" },
    h("div", null, title ? scripted("h3", title, { class: "card-title" }) : null, sub ? scripted("p", sub, { class: "card-sub" }) : null),
    speakKey ? speakButton(speakKey) : null) : null;
  const kids = [head, ...(Array.isArray(body) ? body : body ? [body] : []), foot ? h("div", { class: "card-foot" }, ...(Array.isArray(foot) ? foot : [foot])) : null];
  const classes = `card${needs ? " card-needs" : ""}${cls ? ` ${cls}` : ""}`;
  if (onClick) return h("button", { class: classes, type: "button", on: { click: onClick } }, ...kids);
  return h("article", { class: classes }, ...kids);
}

function row(r) {
  const kids = [
    r.icon ? h("span", { class: "row-ico", "aria-hidden": "true" }, icon(r.icon, 22)) : null,
    h("span", { class: "row-main" }, scripted("span", r.title || "", { class: "row-title" }), r.sub ? scripted("span", r.sub, { class: "row-sub" }) : null),
    r.end || r.onClick || r.href ? h("span", { class: "row-end" }, ...(Array.isArray(r.end) ? r.end : r.end ? [r.end] : []), r.onClick || r.href ? icon("chevronRight", 20, "row-chev") : null) : null,
  ];
  if (r.href) return h("a", { class: "row", href: r.href, "aria-label": r.label }, ...kids);
  if (r.onClick) return h("button", { class: "row", type: "button", "aria-label": r.label, on: { click: r.onClick } }, ...kids);
  return h("div", { class: "row" }, ...kids);
}

/** A list of rows in one card; shows `limit` and a "Show all (n)" link for the rest. */
export function list(rows, { limit = 5, label } = {}) {
  const wrap = h("div", { class: "list-wrap" });
  let open = false;
  function render() {
    const shown = open ? rows : rows.slice(0, limit);
    const more = rows.length > limit
      ? h("button", { class: "link-btn show-all", type: "button", on: { click: () => { open = !open; render(); } } },
        h("span", { text: open ? t("ui.showLess") : t("ui.showAll", { n: rows.length }) }))
      : null;
    fill(wrap, h("ul", { class: "list", "aria-label": label }, ...shown.map((r) => h("li", null, row(r)))), more);
  }
  render();
  return wrap;
}

/* ------------------------------------------------------- chips, states -- */
const TONES = new Set(["good", "warn", "needs", "info"]);
export function chip(word, { tone, icon: ic } = {}) {
  return h("span", { class: `chip${TONES.has(tone) ? ` chip-${tone}` : ""}` }, ic ? icon(ic, 16) : null, scripted("span", word || ""));
}
export const simChip = () => chip(t("simulated"), { tone: "info", icon: "robot" });
export const testChip = () => chip(t("ui.testMode"), { tone: "warn", icon: "shield" });

export function emptyState({ icon: ic = "spark", title, text, action, inline = false } = {}) {
  const act = action instanceof Node ? action : action ? button({ kind: "secondary", ...action }) : null;
  return h("div", { class: `empty${inline ? " empty-inline" : ""}` },
    h("span", { class: "empty-ico", "aria-hidden": "true" }, icon(ic, inline ? 22 : 28)),
    h("div", null, title ? scripted("p", title, { class: "empty-title" }) : null, text ? scripted("p", text, { class: "empty-text" }) : null, act));
}

export function skeleton(kind = "rows", n = 3) {
  const items = [];
  for (let i = 0; i < n; i++) {
    if (kind === "cards") items.push(h("span", { class: "skel skel-card" }));
    else if (kind === "lines") items.push(h("span", { class: `skel skel-line${i === n - 1 ? " short" : ""}` }));
    else items.push(h("span", { class: "skel skel-row" }));
  }
  const wrapClass = kind === "cards" ? "grid" : kind === "rows" ? "list" : "";
  return h("div", { class: wrapClass, role: "status", "aria-busy": "true", "aria-label": t("loading") }, ...items);
}

export function errorLine(text) {
  return h("p", { class: "error-line", role: "alert" }, icon("alert", 18), scripted("span", text || ""));
}

/* -------------------------------------------------------------- fields -- */
let seq = 0;
/** field({ label, value, help, type, inputmode, autocomplete, name, multiline, validate(v) -> message|null, onInput }) */
export function field({ label, value = "", help = "", type = "text", inputmode, autocomplete, name, multiline = false, validate, onInput, maxlength } = {}) {
  const id = `f${++seq}`;
  const helpEl = help ? h("span", { class: "field-help", id: `${id}-h`, text: help }) : null;
  const err = h("span", { class: "field-error", id: `${id}-e`, role: "alert", hidden: true });
  const input = h(multiline ? "textarea" : "input", {
    class: "input", id, name, type: multiline ? undefined : type, inputmode, autocomplete, maxlength,
    "aria-describedby": [helpEl ? `${id}-h` : null, `${id}-e`].filter(Boolean).join(" "),
  });
  input.value = value;
  const el = h("div", { class: "field" }, h("label", { class: "field-label", for: id, text: label }), input, helpEl, err);
  const setError = (text) => {
    if (text) { fill(err, icon("alert", 16), h("span", { text })); err.hidden = false; input.setAttribute("aria-invalid", "true"); if (helpEl) helpEl.hidden = true; }
    else { err.hidden = true; input.removeAttribute("aria-invalid"); if (helpEl) helpEl.hidden = false; }
  };
  const check = () => { const m = validate ? validate(input.value) : null; setError(m); return !m; };
  input.addEventListener("blur", check);
  input.addEventListener("input", () => { if (input.getAttribute("aria-invalid") === "true") setError(null); if (onInput) onInput(input.value); });
  return { el, input, get value() { return input.value; }, setError, validate: check };
}

/** phoneField({ label, value, onInput }) -> a 10-digit Indian mobile number with a fixed +91. */
export function phoneField({ label, value = "", help = "", onInput } = {}) {
  const id = `f${++seq}`;
  const input = h("input", { class: "input", id, type: "tel", inputmode: "numeric", autocomplete: "tel-national", maxlength: "10", pattern: "[0-9]{10}" });
  input.value = value;
  input.addEventListener("input", () => { const d = input.value.replace(/\D/g, "").slice(0, 10); if (d !== input.value) input.value = d; if (onInput) onInput(d); });
  const el = h("div", { class: "field" }, h("label", { class: "field-label", for: id, text: label }),
    h("div", { class: "phone-field" }, h("span", { class: "phone-cc", "aria-hidden": "true", text: "+91" }), input),
    help ? h("span", { class: "field-help", text: help }) : null);
  return { el, input, get value() { return input.value; } };
}

export function segmented({ label, options, value, onPick } = {}) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    ...options.map((o) => h("button", { class: "seg-opt", type: "button", "aria-pressed": String(o.id === value), on: { click: () => { if (o.id !== value && onPick) onPick(o.id); } } },
      o.icon ? icon(o.icon, 20) : null, scripted("span", o.word))));
}

export function toggle({ label, checked = false, onChange } = {}) {
  const input = h("input", { type: "checkbox", role: "switch" });
  input.checked = checked;
  input.addEventListener("change", () => onChange && onChange(input.checked));
  return h("label", { class: "toggle" }, input, h("span", { class: "toggle-track", "aria-hidden": "true" }), scripted("span", label || ""));
}

/** The consent pair: No (outline) left, Yes (pink) right, both 64px; icon + word; long aria labels. */
export function yesNo({ onYes, onNo, busy = null, yesWord, noWord, yesLabel, noLabel } = {}) {
  const yw = yesWord || t("ui.yes");
  const nw = noWord || t("ui.no");
  return h("div", { class: "yesno" },
    button({ word: nw, icon: busy === "no" ? null : "x", kind: "secondary", busy: busy === "no", label: noLabel || nw, onClick: onNo, cls: "yes-no" }),
    button({ word: yw, icon: busy === "yes" ? null : "check", kind: "primary", busy: busy === "yes", label: yesLabel || yw, onClick: onYes, cls: "yes-yes" }));
}

/* --------------------------------------------------------- sheet / modal -- */
let current = null;
const host = () => document.querySelector(".sheet-host") || document.body;

/**
 * openSheet({ title, body, footer, opener, label, onClose, speakKey }) -> { el, setBody, setFooter, setBusy, close, isOpen }
 * A bottom sheet on phones, a centred modal from 768px. Esc, the scrim and Close dismiss; focus stays
 * inside and returns to the opener; swipe down on the grip closes a phone sheet.
 */
export function openSheet({ title, body, footer, opener, label, onClose, speakKey } = {}) {
  closeSheet(false);
  const tid = `sh${++seq}`;
  const content = h("div", { class: "sheet-body" });
  const foot = h("div", { class: "sheet-foot" });
  const close = h("button", { class: "icon-btn", type: "button", "aria-label": t("close"), dataset: { tip: t("close") } }, icon("x", 22));
  const grip = h("span", { class: "sheet-grip", "aria-hidden": "true" });
  const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": title ? tid : undefined, "aria-label": title ? undefined : label, tabindex: "-1" },
    grip,
    h("div", { class: "sheet-head" }, title ? scripted("h2", title, { class: "sheet-title", id: tid }) : h("span", { class: "sheet-title" }), speakKey ? speakButton(speakKey) : null, close),
    content, foot);
  const scrim = h("div", { class: "sheet-scrim" });
  const root = h("div", { class: "sheet-root" }, scrim, panel);
  fill(content, ...(Array.isArray(body) ? body : [body]));
  if (footer) fill(foot, ...(Array.isArray(footer) ? footer : [footer]));
  host().append(root);
  requestAnimationFrame(() => { root.classList.add("is-open"); panel.focus({ preventScroll: true }); });
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey, true);
  close.addEventListener("click", () => closeSheet());
  scrim.addEventListener("click", () => closeSheet());
  let startY = null;
  grip.addEventListener("pointerdown", (e) => { startY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  grip.addEventListener("pointerup", (e) => { if (startY !== null && e.clientY - startY > 80) closeSheet(); startY = null; });
  current = { root, opener, onKey, onClose };
  return {
    el: panel,
    setBody: (b) => fill(content, ...(Array.isArray(b) ? b : [b])),
    setFooter: (b) => fill(foot, ...(Array.isArray(b) ? b : [b])),
    setBusy: (on) => { if (on) panel.setAttribute("aria-busy", "true"); else panel.removeAttribute("aria-busy"); },
    close: () => { if (current && current.root === root) closeSheet(); },
    isOpen: () => Boolean(current && current.root === root),
  };
}

export function closeSheet(restore = true) {
  if (!current) return;
  const { root, opener, onKey, onClose } = current;
  current = null;
  document.removeEventListener("keydown", onKey, true);
  root.classList.remove("is-open");
  root.classList.add("is-closing");
  setTimeout(() => root.remove(), 220);
  if (restore && opener && opener.isConnected) opener.focus();
  if (onClose) { try { onClose(); } catch (err) { console.error(err); } }
}
export const sheetOpen = () => Boolean(current);

/* ---------------------------------------------------------------- menu -- */
let menuOpen = null;
export function closeMenu(restore = true) {
  if (!menuOpen) return;
  const { el, anchor, off } = menuOpen;
  menuOpen = null;
  off();
  el.classList.remove("is-open");
  setTimeout(() => el.remove(), 150);
  anchor.setAttribute("aria-expanded", "false");
  if (restore && anchor.isConnected) anchor.focus();
}

/** openMenu({ anchor, label, items: [{ id, label, icon, lang, current, sep }], onPick(id) }) */
export function openMenu({ anchor, label, items, onPick } = {}) {
  closeMenu(false);
  const buttons = [];
  const kids = items.map((it) => {
    if (it.sep) return h("div", { class: "menu-sep", role: "separator" });
    const b = h("button", {
      class: "menu-item", type: "button", role: it.current !== undefined ? "menuitemradio" : "menuitem", lang: it.lang || undefined,
      "aria-checked": it.current !== undefined ? String(Boolean(it.current)) : undefined, tabindex: "-1",
      on: { click: () => { closeMenu(); if (onPick) onPick(it.id); } },
    }, it.icon ? icon(it.icon, 20) : null, h("span", { text: it.label }), it.current ? h("span", { class: "menu-check" }, icon("check", 18)) : null);
    buttons.push(b);
    return b;
  });
  const el = h("div", { class: "menu", role: "menu", "aria-label": label }, ...kids);
  host().append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, ht = el.offsetHeight;
  let left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
  let top = r.bottom + 8;
  if (top + ht > window.innerHeight - 12) top = Math.max(12, r.top - ht - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");
  const focusAt = (i) => buttons[(i + buttons.length) % buttons.length].focus();
  el.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === "Tab") closeMenu(false);
  });
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(false); };
  document.addEventListener("pointerdown", onDown, true);
  menuOpen = { el, anchor, off: () => document.removeEventListener("pointerdown", onDown, true) };
  requestAnimationFrame(() => { el.classList.add("is-open"); const c = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true"); focusAt(c < 0 ? 0 : c); });
}

/* ------------------------------------------------------------ language -- */
export const UI_LANG_KEY = "sahay-ui-lang";
const LANG_NAMES = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const LANG_CODES = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** The words on screen: this device's choice, English by default (independent of Sahay's voice language). */
export function uiLang() {
  let v = null;
  try { v = localStorage.getItem(UI_LANG_KEY); } catch { /* storage blocked */ }
  return v === "hi" || v === "kn" || v === "en" ? v : "en";
}
export function setUiLang(code) {
  const short = String(code || "en").slice(0, 2).toLowerCase();
  const next = LANG_NAMES[short] ? short : "en";
  try { localStorage.setItem(UI_LANG_KEY, next); } catch { /* storage blocked: this visit only */ }
  setLang(LANG_CODES[next]);
  document.dispatchEvent(new CustomEvent("sahay:ui-lang", { detail: { lang: next } }));
}

/** The visible switcher: globe + the current language's name + caret; menu English / हिन्दी / ಕನ್ನಡ. */
export function langSwitch({ compact = false } = {}) {
  const name = h("span", { class: "lang-switch-name" });
  const el = h("button", { class: "lang-switch", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
    icon("globe", 20), name, icon("chevronDown", 16, "lang-switch-caret"));
  el.addEventListener("click", () => openMenu({
    anchor: el, label: t("ui.language"),
    items: LANGS.map((L) => ({ id: L.short, label: LANG_NAMES[L.short], lang: L.short, current: L.short === lang() })),
    onPick: (id) => setUiLang(id),
  }));
  function update() {
    const cur = lang();
    name.textContent = compact ? cur.toUpperCase() === "EN" ? "English" : LANG_NAMES[cur] : LANG_NAMES[cur] || "English";
    name.setAttribute("lang", cur);
    el.setAttribute("aria-label", `${t("ui.language")}: ${LANG_NAMES[cur] || "English"}`);
  }
  update();
  onLang(update);
  return { el, update };
}

/* --------------------------------------------------------------- brand -- */
/** The real Sahay logo (public/assets/brand/), optionally with the word "Sahay". */
export function brandMark({ word = true, size = 36, href = "#/home" } = {}) {
  const w = Math.round(size * 861 / 1078);
  const img = h("img", { src: "/assets/brand/sahay-mark-128.png", srcset: "/assets/brand/sahay-mark-256.png 2x", width: String(w), height: String(size), alt: word ? "" : t("app.name"), decoding: "async" });
  const kids = [img, word ? h("span", { class: "brand-word", text: t("app.name") }) : null];
  return href ? h("a", { class: "brand", href, "aria-label": t("app.name") }, ...kids) : h("span", { class: "brand" }, ...kids);
}
