// Stock screen (UI-B track owns this file). Until it lands, the route shows the shared empty view.

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { stateView, talkAction } from "./empty.js";

export function createStock() {
  const el = h("section", { class: "stock", "aria-labelledby": "stock-title" });
  function render() {
    el.replaceChildren(
      h("h1", { class: "screen-title", id: "stock-title", text: t("nav.stock") }),
      stateView({ kind: "empty", icon: "talk", title: t("nav.stock"), text: t("talk.hint"), action: talkAction() }));
  }
  return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang")) render(); } };
}
