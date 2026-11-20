// TopCapsule (phone) / TopStrip (tablet and up): the one header object. On phones it floats 8px under
// the top safe area as a glass capsule: automated-assistant chip, shop name (truncates), live dot,
// waiting count (opens the tray) and the My Sahay avatar. From 600px it becomes a quiet strip at the
// top of the content column: shop name, live dot, the long notice, an optional contextual action.
// The automated-assistant notice is visible at every size (rule 2).
//
// createTopCapsule({ onWaiting }) -> { el, update(model) }
//   model = { shopName, stream, waiting, route, action: {icon, word, label, run} | null }

import { h, icon, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { badgeText } from "./shell-geometry.js";

export function createTopCapsule({ onWaiting }) {
  const notice = h("p", { class: "cap-notice", role: "note" },
    h("span", { class: "cap-notice-ico", "aria-hidden": "true" }, icon("robot", 18)),
    h("span", { class: "cap-notice-short" }), h("span", { class: "cap-notice-long" }));
  const shop = h("span", { class: "cap-shop" });
  const live = h("span", { class: "cap-live", role: "status", "aria-live": "polite" },
    h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "cap-live-text" }));
  const wait = h("button", { class: "cap-wait", type: "button", hidden: true },
    icon("inbox", 20), h("span", { class: "cap-wait-n" }));
  wait.addEventListener("click", () => onWaiting());
  const action = h("span", { class: "cap-action" });
  const avatar = h("a", { class: "cap-me", href: "#/me" }, h("span", { class: "cap-avatar", "aria-hidden": "true" }, icon("user", 22)));

  const el = h("header", { class: "top-capsule glass glass-rim" },
    h("div", { class: "cap-main" }, shop, live),
    notice, action, wait, avatar);

  function update(m) {
    notice.querySelector(".cap-notice-short").textContent = t("notice.short");
    notice.querySelector(".cap-notice-long").textContent = t("notice.long");
    const name = m.shopName || "";
    if (shop.textContent !== name) {
      shop.replaceChildren(scripted("span", name));
      shop.title = "";
    }
    shop.hidden = !name;
    const st = m.offline ? "offline" : (m.stream || "connecting");
    live.dataset.state = st;
    live.querySelector(".cap-live-text").textContent = m.offline ? t("shell.offlineShort") : t(`live.${st}`);
    const n = Number(m.waiting) || 0;
    wait.hidden = n <= 0;
    wait.querySelector(".cap-wait-n").textContent = badgeText(n);
    wait.setAttribute("aria-label", n > 0 ? `${t("yes.pending", { n })}. ${t("shell.waitingOpen")}` : t("shell.waitingOpen"));
    avatar.setAttribute("aria-label", t("nav.me"));
    if (m.route === "me") avatar.setAttribute("aria-current", "page"); else avatar.removeAttribute("aria-current");
    const a = m.action;
    if (!a) { action.replaceChildren(); return; }
    action.replaceChildren(h("button", {
      class: "keycap keycap-ghost keycap-sm cap-action-btn", type: "button",
      "aria-label": a.label && a.label !== a.word ? a.label : undefined,
      on: { click: () => a.run && a.run() },
    }, a.icon ? icon(a.icon, 20) : null, h("span", { text: a.word })));
  }

  return { el, update };
}
