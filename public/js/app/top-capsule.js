// TopCapsule (phone) / TopBar (600px and up, Stitch v4 03-home-laptop): the one header object.
// Phone: a floating glass capsule 8px under the top safe area, two rows:
//   [logo] [shop name, live dot] [waiting count] [account]
//   [automated-assistant notice]           [language switcher]
// 600px and up: [shop initials tile] [shop name + city chip / live dot + "Automated assistant"]
//   ... right: [language switcher] ["N waiting" (only when N > 0)] [account initials -> menu]
// Only real shop fields are shown (no city chip without a city). The automated-assistant notice is
// visible at every size (rule 2); the language switcher is on every app screen (brief v4 item 3).
//
// createTopCapsule({ onWaiting, onTheme, themeLabel }) -> { el, update(model) }
//   model = { shopName, city, stream, offline, waiting, route, action: {icon, word, label, run} | null }

import { h, icon, scripted } from "./dom.js";
import { t, cityWord } from "./i18n.js";
import { badgeText } from "./shell-geometry.js";
import { brandMark } from "./brand.js";
import { createLangSwitch } from "./lang-switch.js";
import { openPopover } from "./menu.js";

/** "Lakshmi Provision Mart" -> "LP"; one word -> its first letter; Indic names keep their first letter. */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = (w) => {
    const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(w)].map((x) => x.segment) : Array.from(w);
    return seg[0] || "";
  };
  return (first(words[0]) + (words[1] ? first(words[1]) : "")).toUpperCase();
}

export function createTopCapsule({ onWaiting, onTheme, themeLabel }) {
  const brand = h("a", { class: "cap-brand", href: "#/sahay" }, brandMark({ size: 32 }));
  const tile = h("span", { class: "cap-initials", "aria-hidden": "true" });
  const shop = h("span", { class: "cap-shop" });
  const city = h("span", { class: "cap-city" });
  const live = h("span", { class: "cap-live", role: "status", "aria-live": "polite" },
    h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "cap-live-text" }));
  const statusText = h("span", { class: "cap-status-text" });
  const notice = h("p", { class: "cap-notice", role: "note" },
    h("span", { class: "cap-notice-ico", "aria-hidden": "true" }, icon("robot", 18)),
    h("span", { class: "cap-notice-short" }), h("span", { class: "cap-notice-long" }));
  const wait = h("button", { class: "cap-wait", type: "button", hidden: true },
    h("span", { class: "cap-wait-dot", "aria-hidden": "true" }), h("span", { class: "cap-wait-n" }), h("span", { class: "cap-wait-word" }));
  wait.addEventListener("click", () => onWaiting());
  const langSwitch = createLangSwitch();
  langSwitch.el.classList.add("cap-lang");
  const action = h("span", { class: "cap-action" });
  const avatar = h("button", { class: "cap-me", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
    h("span", { class: "cap-avatar" }, icon("user", 22, "cap-avatar-ico"), h("span", { class: "cap-avatar-txt" })));
  avatar.addEventListener("click", () => {
    const go = (hash) => { if (location.hash !== hash) location.hash = hash; };
    openPopover({
      anchor: avatar,
      label: t("nav.me"),
      items: [
        { id: "me", label: t("nav.me"), icon: "user" },
        { id: "shop", label: t("shell.menuShop"), icon: "store" },
        { id: "history", label: t("nav.history"), icon: "history" },
        { id: "theme", label: themeLabel ? themeLabel() : t("theme.light"), icon: "sun" },
      ],
      onPick: async (id) => {
        if (id === "me") go("#/me");
        else if (id === "shop") go("#/me/shop");
        else if (id === "history") go("#/me/history");
        else if (id === "theme" && onTheme) onTheme();
      },
    });
  });

  const el = h("header", { class: "top-capsule glass glass-rim" },
    brand, tile,
    h("div", { class: "cap-main" },
      h("span", { class: "cap-title-line" }, shop, city),
      h("span", { class: "cap-status-line" }, live, statusText)),
    notice, langSwitch.el, action, wait, avatar);

  function update(m) {
    brand.setAttribute("aria-label", t("app.name"));
    notice.querySelector(".cap-notice-short").textContent = t("notice.short");
    notice.querySelector(".cap-notice-long").textContent = t("notice.long");
    statusText.textContent = t("notice.short");
    const name = m.shopName || "";
    if (shop.dataset.name !== name) {
      shop.dataset.name = name;
      shop.replaceChildren(scripted("span", name));
    }
    shop.hidden = !name;
    const ini = initialsOf(name);
    tile.textContent = ini;
    tile.hidden = !ini;
    const c = m.city ? cityWord(m.city) : "";
    city.replaceChildren(...(c ? [scripted("span", c)] : []));
    city.hidden = !c;
    const st = m.offline ? "offline" : (m.stream || "connecting");
    live.dataset.state = st;
    live.querySelector(".cap-live-text").textContent = m.offline ? t("shell.offlineShort") : t(`live.${st}`);
    const n = Number(m.waiting) || 0;
    wait.hidden = n <= 0;
    wait.querySelector(".cap-wait-n").textContent = badgeText(n);
    wait.querySelector(".cap-wait-word").textContent = t("shell.waitingWord");
    wait.setAttribute("aria-label", n > 0 ? `${t("yes.pending", { n })}. ${t("shell.waitingOpen")}` : t("shell.waitingOpen"));
    avatar.setAttribute("aria-label", t("shell.account"));
    avatar.querySelector(".cap-avatar-txt").textContent = ini;
    avatar.classList.toggle("has-initials", Boolean(ini));
    if (m.route === "me") avatar.setAttribute("aria-current", "page"); else avatar.removeAttribute("aria-current");
    langSwitch.update();
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
