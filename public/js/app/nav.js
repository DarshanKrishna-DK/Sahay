// Floating pill nav (top centre on wide screens, bottom pill on phones): Talk, Buy, Sell, Stock,
// Money, with My Sahay behind the avatar orb. The top strip
// that always shows the "automated assistant" notice, live status and the theme switch.

import { h, icon, fill } from "./dom.js";
import { t } from "./i18n.js";
import { state, pendingApprovals } from "./store.js";
import { createThinkingOrb } from "./thinking-orb.js";

export const ROUTES = [
  { id: "talk", icon: "talk", key: "nav.talk" },
  { id: "buy", icon: "cart", key: "nav.buy" },
  { id: "sell", icon: "receipt", key: "nav.sell" },
  { id: "stock", icon: "jar", key: "nav.stock" },
  { id: "money", icon: "wallet", key: "nav.money" },
];
/** Routes that light up a nav item other than their own. */
const PARENT = { history: "me" };

function liveDot(cls) {
  return h("span", { class: `live ${cls}`, role: "status", "aria-live": "polite" },
    h("span", { class: "live-dot", "aria-hidden": "true" }), h("span", { class: "live-text" }));
}

export function createNav() {
  const links = ROUTES.map((r) => {
    const a = h("a", { class: "nav-link", href: `#/${r.id}`, dataset: { route: r.id } },
      h("span", { class: "nav-ico" }, icon(r.icon, 24), h("span", { class: "nav-badge", hidden: true, "aria-hidden": "true" })),
      h("span", { class: "nav-word" }));
    return a;
  });
  // My Sahay lives behind the avatar orb (a small breathing thinking orb), in the nav on wide
  // screens and in the top strip on phones.
  const avatarOrb = createThinkingOrb({ size: 40, state: "idle" });
  const avatar = h("a", { class: "nav-avatar", href: "#/me", dataset: { tip: t("nav.me") } }, h("span", { class: "avatar-ring", "aria-hidden": "true" }, avatarOrb.el));
  const avatarTopOrb = createThinkingOrb({ size: 36, state: "idle" });
  const avatarTop = h("a", { class: "top-avatar tip-below", href: "#/me", dataset: { tip: t("nav.me") } }, h("span", { class: "avatar-ring", "aria-hidden": "true" }, avatarTopOrb.el));
  const nav = h("nav", { class: "pillnav", "aria-label": t("nav.label") },
    avatar,
    h("div", { class: "nav-links" }, ...links),
    liveDot("live-in-nav"));

  const themeBtn = h("button", { class: "icon-btn theme-btn", type: "button" });
  themeBtn.addEventListener("click", () => {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const next = cur === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("sahay-theme", next); } catch { /* storage blocked */ }
    syncTheme();
  });
  function syncTheme() {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const label = cur === "dark" ? t("theme.light") : t("theme.dark");
    fill(themeBtn, icon(cur === "dark" ? "sun" : "moon", 22));
    themeBtn.setAttribute("aria-label", label);
    themeBtn.dataset.tip = label;
  }

  try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncTheme); } catch { /* old browser */ }

  const notice = h("p", { class: "ai-notice", role: "note" },
    h("span", { class: "ai-ico", "aria-hidden": "true" }, icon("robot", 20)),
    h("span", { class: "ai-short" }), h("span", { class: "ai-long" }));
  const shop = h("span", { class: "shop-name" });

  const top = h("header", { class: "topstrip" },
    h("span", { class: "top-brand" }, h("span", { class: "logo-orb", "aria-hidden": "true" }), shop),
    notice,
    h("span", { class: "top-right" }, liveDot("live-in-top"), themeBtn, avatarTop));

  function update(route) {
    nav.setAttribute("aria-label", t("nav.label"));
    const lit = PARENT[route] || route;
    for (const a of [avatar, avatarTop]) {
      a.setAttribute("aria-label", t("nav.me"));
      a.dataset.tip = t("nav.me");
      if (lit === "me") a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    for (const a of links) {
      const r = ROUTES.find((x) => x.id === a.dataset.route);
      a.querySelector(".nav-word").textContent = t(r.key);
      if (lit === r.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    // Waiting yeses are buying decisions: the badge sits on Buy.
    const pending = pendingApprovals().length;
    const buy = links[1];
    const badge = buy.querySelector(".nav-badge");
    badge.hidden = pending === 0;
    badge.textContent = pending ? String(pending) : "";
    buy.setAttribute("aria-label", pending ? `${t("nav.buy")}, ${t("yes.pending", { n: pending })}` : t("nav.buy"));

    for (const el of [nav, top]) {
      const lv = el.querySelector(".live");
      lv.dataset.state = state.stream;
      lv.querySelector(".live-text").textContent = t(`live.${state.stream}`);
    }
    notice.querySelector(".ai-short").textContent = t("notice.short");
    notice.querySelector(".ai-long").textContent = t("notice.long");
    const b = state.business;
    shop.textContent = b && b.name ? b.name : "";
    syncTheme();
  }

  /** The avatar orbs follow the agent (idle / listening / thinking ...), like the big orb on Talk. */
  function setAgent(agentState) { avatarOrb.set(agentState); avatarTopOrb.set(agentState); }

  return { nav, top, update, setAgent };
}
