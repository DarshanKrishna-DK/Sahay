// Sell screen (UI-B track owns this file). Until it lands, the route shows the shared empty view.

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { stateView, talkAction } from "./empty.js";

export function createSell() {
  const el = h("section", { class: "sell", "aria-labelledby": "sell-title" });
  function render() {
    el.replaceChildren(
      h("h1", { class: "screen-title", id: "sell-title", text: t("nav.sell") }),
      stateView({ kind: "empty", icon: "talk", title: t("nav.sell"), text: t("talk.hint"), action: talkAction() }));
  }
  return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang")) render(); } };
}
