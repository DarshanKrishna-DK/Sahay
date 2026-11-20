// NavDock (phone portrait): a floating curved glass dock, 12px above the bottom safe area and 12px
// from each side. Its top edge arcs upward; a round notch in the middle cradles the raised Sahay orb
// (64px, lifted 18px). Slots: Buy, Sell, [orb], Stock, Money, each icon + word. The glass shape is a
// clip-path polygon computed for the dock's real width (so the backdrop blur follows the curve); an
// SVG draws the rim and the soft shadow with the same outline. Hidden while the keyboard is open.
//
// createNavDock({ items, onOrb }) -> { el, update(model), relayout() }

import { h, icon, svgEl } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { dockOutline, polygonCss, svgPath, badgeText } from "./shell-geometry.js";

export function createNavDock({ items, onOrb }) {
  const NS_ID = `dock-rim-${Math.random().toString(36).slice(2, 7)}`;
  const shadow = svgEl("svg", { class: "dock-shadow", "aria-hidden": "true", focusable: "false" });
  const shadowPath = svgEl("path");
  shadow.append(shadowPath);
  const rim = svgEl("svg", { class: "dock-rim", "aria-hidden": "true", focusable: "false" });
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: NS_ID, x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.append(svgEl("stop", { offset: "0", class: "rim-a" }), svgEl("stop", { offset: ".45", class: "rim-b" }), svgEl("stop", { offset: "1", class: "rim-c" }));
  defs.append(grad);
  const rimPath = svgEl("path", { stroke: `url(#${NS_ID})` });
  rim.append(defs, rimPath);
  const glass = h("div", { class: "dock-glass", "aria-hidden": "true" });

  const make = (it) => h("a", { class: "dk-item", href: `#/${it.id}`, dataset: { route: it.id } },
    h("span", { class: "dk-ico", "aria-hidden": "true" }, icon(it.icon, 26), h("span", { class: "badge dk-badge", hidden: true })),
    h("span", { class: "dk-word" }));
  const left = items.slice(0, 2).map(make);
  const right = items.slice(2).map(make);
  const links = [...left, ...right];

  const orb = createThinkingOrb({ size: 52, state: "idle" });
  const orbBadge = h("span", { class: "badge dk-badge", hidden: true, "aria-hidden": "true" });
  const orbLink = h("a", { class: "dk-orb", href: "#/sahay", dataset: { route: "sahay" } },
    h("span", { class: "dk-orb-ball", "aria-hidden": "true" }, orb.el, orbBadge),
    h("span", { class: "dk-word dk-orb-word" }));
  orbLink.addEventListener("click", (e) => onOrb(e));

  const el = h("nav", { class: "nav-dock" },
    shadow, glass, rim,
    h("div", { class: "dk-row" }, ...left, h("span", { class: "dk-gap", "aria-hidden": "true" }), ...right),
    orbLink);

  let model = { route: null };

  function relayout() {
    const w = el.clientWidth;
    const hgt = el.clientHeight;
    if (!w || !hgt) return;
    const cs = getComputedStyle(el);
    const orbSize = parseFloat(cs.getPropertyValue("--dock-orb")) || 64;
    const lift = parseFloat(cs.getPropertyValue("--dock-lift")) || 18;
    const pts = dockOutline(w, hgt, { orb: orbSize, gap: 6, orbCy: orbSize / 2 - lift, arc: 10, radius: 26, radiusBottom: 30 });
    glass.style.clipPath = polygonCss(pts);
    const d = svgPath(pts);
    for (const svg of [rim, shadow]) svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    rimPath.setAttribute("d", d);
    shadowPath.setAttribute("d", d);
  }

  function setBadge(node, n, word) {
    const b = node.querySelector(".dk-badge");
    const txt = badgeText(n);
    b.hidden = !txt;
    b.textContent = txt;
    node.setAttribute("aria-label", txt ? `${word}, ${t("shell.badge", { n })}` : word);
  }

  function update(next) {
    model = { ...model, ...next };
    const badges = model.badges || {};
    el.setAttribute("aria-label", t("nav.label"));
    for (const link of links) {
      const it = items.find((x) => x.id === link.dataset.route);
      const word = t(it.key);
      link.querySelector(".dk-word").textContent = word;
      setBadge(link, badges[it.id] || 0, word);
      if (model.route === it.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    const onHome = model.route === "sahay";
    orbLink.querySelector(".dk-orb-word").textContent = t("nav.sahay");
    const orbWord = onHome ? t("shell.orbTalk") : t("shell.orbGo");
    setBadge(orbLink, badges.sahay || 0, model.orbLabel ? `${orbWord}, ${model.orbLabel}` : orbWord);
    if (onHome) orbLink.setAttribute("aria-current", "page"); else orbLink.removeAttribute("aria-current");
    orbLink.dataset.agent = model.agentState || "idle";
    orb.set(model.agentState || "idle");
  }

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => relayout()).observe(el);
  return { el, update, relayout, orb };
}
