// Money screen (UI-B track owns this file). Until it lands, the route shows the shared empty view.

import { h } from "./dom.js";
import { t } from "./i18n.js";
import { stateView, talkAction } from "./empty.js";

export function createMoney() {
  const el = h("section", { class: "money", "aria-labelledby": "money-title" });
  function render() {
    el.replaceChildren(
      h("h1", { class: "screen-title", id: "money-title", text: t("nav.money") }),
      stateView({ kind: "empty", icon: "talk", title: t("nav.money"), text: t("talk.hint"), action: talkAction() }));
  }
  return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang")) render(); } };
}
