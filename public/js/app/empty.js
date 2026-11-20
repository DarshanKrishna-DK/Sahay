// Designed empty, loading, error and missing views shared by every screen (spec 3.1 row 20), and
// skeletons in a screen's own shape. An empty screen always offers one action: talk to Sahay,
// which starts the call in place with that screen's hint (D11).
//
//   stateView({ kind: "empty"|"loading"|"error"|"missing", icon, title, text, action: { label, icon, run }, compact })
//   loadingView(title)        the lime thinking orb + one line
//   talkAction(hintKey)       { label, icon, run } for an empty state's one button
//   skeleton(shape, n)        shape: "rows" | "cards" | "jars" | "home" | "lines"; aria-busy region

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";

export function stateView({ kind = "empty", icon: ic, title, text, action, compact = false }) {
  let mark;
  if (kind === "loading") {
    const orb = createThinkingOrb({ size: compact ? 48 : 64, state: "working" });
    mark = h("span", { class: "state-mark", "aria-hidden": "true" }, orb.el);
  } else {
    const fallback = kind === "error" ? "alert" : kind === "missing" ? "info" : "spark";
    mark = h("span", { class: "state-mark", "aria-hidden": "true" }, icon(ic || fallback, compact ? 28 : 36));
  }
  return h("div", {
    class: `state state-${kind}${compact ? " state-compact" : ""}`,
    role: kind === "error" ? "alert" : kind === "loading" ? "status" : undefined,
    "aria-busy": kind === "loading" ? "true" : undefined,
  },
  mark,
  title ? h("p", { class: "state-title", text: title }) : null,
  text ? h("p", { class: "state-text", text }) : null,
  action ? h("button", { class: `keycap ${kind === "error" ? "keycap-secondary" : "keycap-primary"} ${compact ? "keycap-md" : "keycap-lg"}`, type: "button", on: { click: action.run } },
    icon(action.icon || (kind === "error" ? "refresh" : "mic"), 24), h("span", { text: action.label })) : null);
}

/** The one action every empty screen offers: the call starts here, with the screen's hint. */
export function talkAction(hintKey = null) {
  return {
    label: t("talkCta"), icon: "mic",
    run: () => {
      if (hintKey) document.dispatchEvent(new CustomEvent("sahay:hint", { detail: { key: hintKey } }));
      document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: hintKey } }));
    },
  };
}

export function loadingView(title = t("loading")) {
  return stateView({ kind: "loading", title });
}

/** Skeletons in the screen's shape while its data loads (shimmer stops under reduced motion). */
export function skeleton(shape = "rows", n = 3) {
  const items = [];
  for (let i = 0; i < n; i++) {
    if (shape === "cards") items.push(h("span", { class: "skel skel-card" }));
    else if (shape === "jars") items.push(h("span", { class: "skel skel-block" }));
    else if (shape === "lines") items.push(h("span", { class: `skel skel-line${i === n - 1 ? " is-short" : ""}` }));
    else items.push(h("span", { class: "skel-row" }, h("span", { class: "skel skel-circle" }), h("span", { class: "skel-wrap skel-grow" }, h("span", { class: "skel skel-line" }), h("span", { class: "skel skel-line is-short" }))));
  }
  return h("div", { class: `skel-wrap skel-${shape}`, role: "status", "aria-busy": "true", "aria-label": t("loading") },
    shape === "home" ? h("span", { class: "skel skel-title" }) : null, ...items);
}
