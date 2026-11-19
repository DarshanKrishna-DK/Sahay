// Shared building blocks for every screen (UI v2). Styles live in public/css/app.css under
// "components v2". Keep these small: screens compose them, never restyle them.
//
//   yesNo({...})        the two big round buttons of every consent moment (cross + check SVGs)
//   paper(props, ...)   a receipt / invoice / order sheet with punch notches and a perforation
//   perforation()       the dashed tear line inside a paper
//   askSahay(hintKey)   go to Talk and start a voice call with a hint ("buy more", "new bill")
//   keycapButton({...}) the tactile primary button with an icon and one word
//   shimmer(text)       the one highlighted word on a heading (use sparingly)
//   pill(word, icon)    a small icon + word marker (status, "simulated vendor")

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";

/**
 * yesNo({ onYes, onNo, busy: "yes"|"no"|null, yesWord, noWord, yesLabel, noLabel, size: "lg"|"md" })
 * The yes button is filled leaf with a check; the no button is a coral ring with a cross. Each
 * carries an icon AND a word; aria-label is the long form ("Yes, place the order").
 */
export function yesNo({ onYes, onNo, busy = null, yesWord, noWord, yesLabel, noLabel, size = "lg" } = {}) {
  const dis = busy ? true : undefined;
  const yw = yesWord || t("yes.approve");
  const nw = noWord || t("yes.reject");
  return h("div", { class: `yes-actions yesno-${size}` },
    h("button", { class: "yes-btn yes-btn-no", type: "button", "aria-label": noLabel || nw, disabled: dis, on: { click: (e) => onNo && onNo(e) } },
      busy === "no" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("x", size === "lg" ? 40 : 32),
      h("span", { class: "yes-btn-word", text: nw })),
    h("button", { class: "yes-btn yes-btn-yes", type: "button", "aria-label": yesLabel || yw, disabled: dis, on: { click: (e) => onYes && onYes(e) } },
      busy === "yes" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", size === "lg" ? 48 : 38),
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

/** Go to Talk and start a voice call; the hint is shown under the orb (an i18n key). */
export function askSahay(hintKey) {
  location.hash = "#/talk";
  document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: hintKey || null } }));
}

/** keycapButton({ icon, word, label, onClick, tone: "marigold"|"leaf"|"ghost", busy, size }) */
export function keycapButton({ icon: ic, word, label, onClick, tone = "marigold", busy = false, size = "lg", type = "button" } = {}) {
  return h("button", {
    class: `keycap keycap-${tone} keycap-${size}`, type,
    "aria-label": label && label !== word ? label : undefined,
    "aria-busy": busy ? "true" : undefined, disabled: busy ? true : undefined,
    on: onClick ? { click: onClick } : undefined,
  }, busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : (ic ? icon(ic, size === "lg" ? 26 : 22) : null), h("span", { text: word }));
}

/** The one highlighted word of a heading; Latin script only (clip artefacts on Indic conjuncts). */
export function shimmer(text) {
  return h("span", { class: "hl-word", text });
}

export function pill(word, ic, tone = "") {
  return h("span", { class: `mark${tone ? ` mark-${tone}` : ""}` }, ic ? icon(ic, 18) : null, h("span", { text: word }));
}
