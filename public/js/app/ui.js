// Shared building blocks for every screen (UI v3). Styles: public/css/components-v3.css; contract:
// public/css/README-v3.md section 2. Screens compose these, never restyle them.
//
//   yesNo({...})              the consent pair: No (coral ring + cross) left, Yes (lime keycap + check) right, >= 88px
//   paper(props, ...)         a receipt / bill / order record with punch notches; perforation() the tear line
//   askSahay(hintKey)         start a voice call IN PLACE with a hint (D11; never changes screen)
//   talkChip(hintKey, word?)  the "Speak" chip for screen headers (icon + word, starts the call in place)
//   keycapButton({...})       tactile button: tone primary | secondary | danger | ghost; size lg | md | sm
//   pill(word, icon, tone)    a static icon + word marker: sim | test | ok | due | wait
//   stamp(word, status)       a bill / order status stamp: draft | waiting | issued | part | paid | cancelled
//   badgeText(n)              "" | "1".."9" | "9+"
//   bigNumber(text, {kind, unit})   kind: total | amount | onhand
//   screenHeader({...})       title + read-aloud + Speak chip + up to two actions
//   textField({...})          label, input, help, error (validates on first blur; clears on focus)
//   choiceTiles({...})        2-4 big radio tiles; segmented({...}) a segmented control
//   shimmer(text)             the one highlighted Latin word of a heading (use sparingly)

import { h, icon, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { speakButton } from "./speak.js";
import { badgeText as badge } from "./shell-geometry.js";

/**
 * yesNo({ onYes, onNo, busy: "yes"|"no"|null, yesWord, noWord, yesLabel, noLabel, size: "lg"|"md" })
 * Each button carries an icon AND a word; aria-label is the long form ("Yes, place the order").
 * "md": both 88px; "lg" (default): Yes 104px.
 */
export function yesNo({ onYes, onNo, busy = null, yesWord, noWord, yesLabel, noLabel, size = "lg" } = {}) {
  const dis = busy ? true : undefined;
  const yw = yesWord || t("yes.approve");
  const nw = noWord || t("yes.reject");
  return h("div", { class: `yes-actions yesno-${size}` },
    h("button", { class: "yes-btn yes-btn-no", type: "button", "aria-label": noLabel || nw, disabled: dis, "aria-busy": busy === "no" ? "true" : undefined, on: { click: (e) => onNo && onNo(e) } },
      busy === "no" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("x", 34),
      h("span", { class: "yes-btn-word", text: nw })),
    h("button", { class: "yes-btn yes-btn-yes", type: "button", "aria-label": yesLabel || yw, disabled: dis, "aria-busy": busy === "yes" ? "true" : undefined, on: { click: (e) => onYes && onYes(e) } },
      busy === "yes" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", size === "lg" ? 44 : 38),
      h("span", { class: "yes-btn-word", text: yw })));
}

/** paper({ tag, class, tone: "due"|"paid"|"pending"|null, ...attrs }, ...children) */
export function paper(props = {}, ...children) {
  const { tag = "article", class: cls = "", tone, ...rest } = props;
  return h(tag, { ...rest, class: `paper${tone ? ` paper-${tone}` : ""}${cls ? ` ${cls}` : ""}` }, ...children);
}

export function perforation() {
  return h("span", { class: "perforation", "aria-hidden": "true" });
}

/** Start a voice call where the owner is (D11), with a hint shown on Sahay home (an i18n key). */
export function askSahay(hintKey) {
  document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: hintKey || null } }));
}

/** The "Speak" chip of a screen header: icon + word, starts the call in place with the hint. */
export function talkChip(hintKey, word) {
  const w = word || t("shell.talk");
  return h("button", { class: "chip chip-talk", type: "button", on: { click: () => askSahay(hintKey) } }, icon("mic", 22), h("span", { text: w }));
}

const TONES = { primary: "primary", secondary: "secondary", danger: "danger", ghost: "ghost", leaf: "primary" };

/** keycapButton({ icon, word, label, onClick, tone, busy, size, type, block }) */
export function keycapButton({ icon: ic, word, label, onClick, tone = "primary", busy = false, size = "lg", type = "button", block = false } = {}) {
  const tn = TONES[tone] || "primary";
  return h("button", {
    class: `keycap keycap-${tn} keycap-${size}${block ? " keycap-block" : ""}`, type,
    "aria-label": label && label !== word ? label : undefined,
    "aria-busy": busy ? "true" : undefined, disabled: busy ? true : undefined,
    on: onClick ? { click: onClick } : undefined,
  }, busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : (ic ? icon(ic, size === "lg" ? 26 : 22) : null), h("span", { text: word }));
}

/** The one highlighted word of a heading; Latin script only (clip artefacts on Indic conjuncts). */
export function shimmer(text) {
  return h("span", { class: "hl-word", text });
}

/** pill(word, icon, tone): sim | test | ok | due | wait (static marker, icon + word). */
export function pill(word, ic, tone = "") {
  return h("span", { class: `pill${tone ? ` pill-${tone}` : ""}` }, ic ? icon(ic, 18) : null, scripted("span", word));
}

const STAMP_ICON = { draft: "doc", waiting: "clock", issued: "receipt", part: "clock", paid: "checkCircle", cancelled: "ban" };
export function stamp(word, status) {
  return h("span", { class: `stamp stamp-${status}` }, icon(STAMP_ICON[status] || "doc", 18), scripted("span", word));
}

export const badgeText = badge;

/** bigNumber("₹11,000", { kind: "total"|"amount"|"onhand", unit: "किलो" }) */
export function bigNumber(text, { kind = "amount", unit = null, tag = "p" } = {}) {
  return h(tag, { class: `bignum bignum-${kind}` }, h("span", { text }), unit ? scripted("span", unit, { class: "bignum-unit" }) : null);
}

/**
 * pageHead({ title, accent, sub, actions: [node], speakKey }) - v4 (Stitch): every screen starts with
 * it. A big display title (left) whose `accent` part is lime ("Namaste, " + accent "Lakshmi Provision
 * Mart"), one plain line under it, the screen's primary action(s) on the right on laptops and under
 * the title on phones. No chips or pills in the head.
 */
export function pageHead({ title, accent, sub, actions = [], speakKey } = {}) {
  const h1 = h("h1", { class: "page-title" },
    title ? scripted("span", title) : null,
    accent ? scripted("span", accent, { class: "page-title-accent" }) : null);
  return h("header", { class: "page-head" },
    h("div", { class: "page-head-text" },
      h1,
      sub ? scripted("p", sub, { class: "page-sub" }) : null),
    actions.length || speakKey ? h("div", { class: "page-actions" },
      ...actions.slice(0, 3),
      speakKey ? h("span", { class: "card-speak" }, speakButton(speakKey, { size: "md" })) : null) : null);
}

/** screenHeader({ title, speakKey, talkHint, talkWord, actions: [node] }) - v3; prefer pageHead. */
export function screenHeader({ title, speakKey, talkHint, talkWord, actions = [] } = {}) {
  return h("header", { class: "screen-head" },
    scripted("h1", title || "", { class: "screen-title" }),
    h("div", { class: "screen-head-tools" },
      ...actions.slice(0, 2),
      talkHint !== undefined ? talkChip(talkHint, talkWord) : null,
      speakKey ? h("span", { class: "card-speak" }, speakButton(speakKey, { size: "md" })) : null));
}

let fieldSeq = 0;
/**
 * textField({ label, value, help, type, inputmode, autocomplete, name, required, validate(v) -> message|null, onInput })
 * -> { el, input, value, setError(text|null), setState("idle"|"saving"|"saved"), validate() -> bool }
 * Pristine fields never turn red; the first blur validates; focus or a keystroke clears the error.
 */
export function textField({ label, value = "", help = "", type = "text", inputmode, autocomplete, name, required = false, validate, onInput, lang } = {}) {
  const id = `fld-${++fieldSeq}`;
  const helpEl = help ? h("span", { class: "field-help", id: `${id}-help`, text: help }) : null;
  const errEl = h("span", { class: "field-error", id: `${id}-err`, role: "alert", hidden: true });
  const stateEl = h("span", { class: "field-state", "aria-hidden": "true" });
  const input = h("input", {
    class: "field-input", id, type, name, inputmode, autocomplete, lang, required: required ? true : undefined,
    "aria-describedby": [helpEl ? `${id}-help` : null, `${id}-err`].filter(Boolean).join(" "),
  });
  input.value = value;
  const el = h("label", { class: "field", for: id }, h("span", { class: "field-label", text: label }), h("span", { class: "field-row" }, input, stateEl), helpEl, errEl);
  let touched = false;
  function setError(text) {
    if (text) {
      errEl.replaceChildren(icon("alert", 18), h("span", { text }));
      errEl.hidden = false;
      input.setAttribute("aria-invalid", "true");
      if (helpEl) helpEl.hidden = true;
    } else {
      errEl.hidden = true;
      errEl.replaceChildren();
      input.removeAttribute("aria-invalid");
      if (helpEl) helpEl.hidden = false;
    }
  }
  function check() {
    const msg = validate ? validate(input.value) : null;
    setError(msg);
    return !msg;
  }
  input.addEventListener("blur", () => { touched = true; check(); });
  input.addEventListener("focus", () => { if (input.getAttribute("aria-invalid") === "true") setError(null); });
  input.addEventListener("input", () => {
    if (input.getAttribute("aria-invalid") === "true") setError(null);
    el.classList.remove("is-saved");
    stateEl.replaceChildren();
    if (onInput) onInput(input.value);
  });
  return {
    el, input,
    get value() { return input.value; },
    get touched() { return touched; },
    setError,
    validate: () => { touched = true; return check(); },
    setState(s) {
      el.classList.toggle("is-saving", s === "saving");
      el.classList.toggle("is-saved", s === "saved");
      input.disabled = s === "saving";
      stateEl.replaceChildren(s === "saving" ? h("span", { class: "spinner" }) : s === "saved" ? icon("checkCircle", 22) : "");
    },
  };
}

/** choiceTiles({ label, options: [{ id, icon, word, sub, lang }], value, onPick, saving }) */
export function choiceTiles({ label, options, value, onPick, saving = null } = {}) {
  const tiles = options.map((o) => h("button", {
    class: `choice${saving === o.id ? " is-saving" : ""}`, type: "button", role: "radio", lang: o.lang || undefined,
    "aria-checked": String(o.id === value), disabled: saving ? true : undefined,
    on: { click: () => { if (o.id !== value && onPick) onPick(o.id); } },
  }, o.icon ? h("span", { class: "choice-ico" }, saving === o.id ? h("span", { class: "spinner" }) : icon(o.icon, 26)) : null,
  scripted("span", o.word), o.sub ? h("span", { class: "card-sub", text: o.sub }) : null));
  const group = h("div", { class: "choices", role: "radiogroup", "aria-label": label }, ...tiles);
  group.addEventListener("keydown", (e) => {
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    tiles[(i + d + tiles.length) % tiles.length].focus();
  });
  return group;
}

/** segmented({ label, options: [{ id, icon, word }], value, onPick }) */
export function segmented({ label, options, value, onPick } = {}) {
  return h("div", { class: "seg", role: "group", "aria-label": label },
    ...options.map((o) => h("button", {
      class: "seg-opt", type: "button", "aria-pressed": String(o.id === value),
      on: { click: () => { if (o.id !== value && onPick) onPick(o.id); } },
    }, o.icon ? icon(o.icon, 20) : null, scripted("span", o.word))));
}
