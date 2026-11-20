// A screen that only shows its title, so every route renders while W2-W5 build the real ones.
// screens.js maps each route to its owner's factory; an owner replaces its line when its screen lands.

import { h, pageHead } from "./ui.js";
import { t } from "./i18n.js";

export function placeholder(key) {
  return () => {
    const el = h("div", { class: "screen" });
    const render = () => el.replaceChildren(pageHead({ title: t(key) }));
    render();
    return { el, update: (_s, parts) => { if (parts.has("all") || parts.has("lang")) render(); } };
  };
}
