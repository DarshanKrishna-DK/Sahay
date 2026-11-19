// Route id -> screen factory. A screen is { el, update(state, parts), enter?(), leave?() }.

import { h, patch } from "./dom.js";
import { t } from "./i18n.js";
import { stateView, talkAction } from "./empty.js";
import { createTalk } from "./talk.js";
import { createWork } from "./work.js";

function simple(navKey, titleKey, textKey, ic) {
  return () => {
    const el = h("section", { class: "screen-simple" });
    return {
      el,
      update(_s, parts) {
        if (!parts.has("all") && !parts.has("lang")) return;
        patch(el, t(titleKey), () => [h("h1", { class: "screen-title", text: t(navKey) }),
          stateView({ kind: "empty", icon: ic, title: t(titleKey), text: t(textKey), action: talkAction() })]);
      },
    };
  };
}

export const SCREENS = {
  talk: createTalk,
  work: createWork,
  orders: simple("nav.orders", "empty.orders.title", "empty.orders.text", "receipt"),
  me: simple("nav.me", "empty.rules.title", "empty.rules.text", "spark"),
  history: simple("nav.history", "empty.history.title", "empty.history.text", "history"),
};
