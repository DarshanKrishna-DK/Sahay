// Floating pill nav (top centre on wide screens, bottom pill on phones) and the top strip
// that always shows the "automated assistant" notice, live status and the theme switch.

import { h, icon, fill } from "./dom.js";
import { t } from "./i18n.js";
import { state, pendingApprovals } from "./store.js";

export const ROUTES = [
  { id: "talk", icon: "talk", key: "nav.talk" },
  { id: "work", icon: "river", key: "nav.work" },
  { id: "orders", icon: "receipt", key: "nav.orders" },
  { id: "me", icon: "spark", key: "nav.me" },
];

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
  const nav = h("nav", { class: "pillnav", "aria-label": t("nav.label") },
    h("a", { class: "nav-logo", href: "#/talk", "aria-label": t("app.name") }, h("span", { class: "logo-orb", "aria-hidden": "true" })),
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
    h("span", { class: "top-right" }, liveDot("live-in-top"), themeBtn));

  function update(route) {
    nav.setAttribute("aria-label", t("nav.label"));
    nav.querySelector(".nav-logo").setAttribute("aria-label", t("app.name"));
    for (const a of links) {
      const r = ROUTES.find((x) => x.id === a.dataset.route);
      a.querySelector(".nav-word").textContent = t(r.key);
      const current = route === r.id || (route === "history" && r.id === "me");
      if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    const pending = pendingApprovals().length;
    const badge = links[1].querySelector(".nav-badge");
    badge.hidden = pending === 0;
    badge.textContent = pending ? String(pending) : "";
    links[1].setAttribute("aria-label", pending ? `${t("nav.work")}, ${t("yes.pending", { n: pending })}` : t("nav.work"));

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

  return { nav, top, update };
}
