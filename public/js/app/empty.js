// Designed empty, loading and error views shared by every screen. An empty screen always
// offers one action: talk to Sahay.

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";

/**
 * stateView({ kind: "empty" | "loading" | "error", icon, title, text, action: { label, icon, run } })
 */
export function stateView({ kind = "empty", icon: ic, title, text, action, compact = false }) {
  const mark = kind === "loading"
    ? h("span", { class: "state-orbit", "aria-hidden": "true" }, h("i"), h("i"), h("i"))
    : h("span", { class: "state-blob", "aria-hidden": "true" }, icon(ic || (kind === "error" ? "alert" : "spark"), 34));
  return h("div", {
    class: `state state-${kind}${compact ? " state-compact" : ""}`,
    role: kind === "error" ? "alert" : kind === "loading" ? "status" : undefined,
    "aria-busy": kind === "loading" ? "true" : undefined,
  },
  mark,
  title ? h("p", { class: "state-title", text: title }) : null,
  text ? h("p", { class: "state-text", text }) : null,
  action ? h("button", { class: `btn ${kind === "error" ? "btn-ghost" : "btn-primary"} btn-lg`, type: "button", on: { click: action.run } },
    icon(action.icon || (kind === "error" ? "refresh" : "mic"), 24), h("span", { text: action.label })) : null);
}

/** The one action every empty screen offers. */
export function talkAction() {
  return { label: t("talkCta"), icon: "mic", run: () => { location.hash = "#/talk"; document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice" } })); } };
}

export function loadingView(title = t("loading")) {
  return stateView({ kind: "loading", title });
}
