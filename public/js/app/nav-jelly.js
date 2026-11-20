// NavJelly (laptop, tablet) and NavRail (phone landscape): one floating glass sidebar, CONCAVE (v4):
// full width at the top and the bottom, its right edge curving INWARD to its narrowest at the vertical
// centre, smooth and symmetric (shell-geometry concaveOutline, applied as a clip-path on the glass
// layer itself, so the light blur follows the curve and the hex dots show through). An SVG draws the
// rim (lime at the waist) and a shadow masked out from under the glass. Top: the Sahay logo (brand),
// then the agent orb in its socket (the voice element, not the brand). Buy, Sell, Stock and Money
// follow the curve (the centre items sit further left); a lime droplet slides ALONG the curve to the
// active item with a short jelly stretch (a fade under reduced motion). Bottom: My Sahay and theme.
// The UI language switcher lives in the top bar (lang-switch.js), not here. In the rail the depth is 0.
//
// From 1280px (Stitch v4, 03-home-laptop) it is a wide glass sidebar: logo + "Sahay" wordmark on top,
// rows of icon + word (Sahay, Buy, Sell, Stock, Money, My Sahay), the active row a lime pill that slides
// along the concave edge. Below 1280 it is the narrow rail (orb socket, icon over word, My Sahay below).
// CSS sets --nj-mode: wide | rail; the extra rows (Sahay, My Sahay) only show in the wide mode.
//
// The container (nav.nav-jelly) carries no filter, mask, opacity or transform.
//
// createNavJelly({ items, onOrb, onTheme }) -> { el, update(model), relayout() }
//   model = { route, badges: {key: n}, agentState, orbLabel, themeLabel, themeIcon }

import { h, icon, svgEl } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { concaveOutline, concaveX, polygonCss, svgPath, badgeText } from "./shell-geometry.js";
import { brandMark } from "./brand.js";

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createNavJelly({ items, onOrb, onTheme }) {
  const gid = `nj-rim-${Math.random().toString(36).slice(2, 7)}`;
  // The shadow is cut out where the glass is (an SVG mask), so the glass never blurs its own
  // shadow: behind the glass there is only the hex field.
  const cutId = `nj-cut-${Math.random().toString(36).slice(2, 7)}`;
  const shadow = svgEl("svg", { class: "nj-shadow", "aria-hidden": "true", focusable: "false" });
  const cutRect = svgEl("rect", { fill: "#fff" });
  const cutPath = svgEl("path", { fill: "#000" });
  const cut = svgEl("mask", { id: cutId, maskUnits: "userSpaceOnUse" });
  cut.append(cutRect, cutPath);
  const shadowDefs = svgEl("defs");
  shadowDefs.append(cut);
  const shadowPath = svgEl("path", { transform: "translate(6 12)" });
  const shadowGroup = svgEl("g", { mask: `url(#${cutId})` });
  shadowGroup.append(shadowPath);
  shadow.append(shadowDefs, shadowGroup);
  const glass = h("div", { class: "nj-glass", "aria-hidden": "true" });
  const rim = svgEl("svg", { class: "nj-rim", "aria-hidden": "true", focusable: "false" });
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: gid, x1: "0", y1: "0", x2: "0", y2: "1" });
  const stops = [svgEl("stop", { offset: "0", class: "rim-a" }), svgEl("stop", { offset: ".5", class: "rim-b" }), svgEl("stop", { offset: "1", class: "rim-c" })];
  grad.append(...stops);
  defs.append(grad);
  const rimPath = svgEl("path", { stroke: `url(#${gid})` });
  const rimGlow = svgEl("path", { class: "nj-rim-glow", stroke: `url(#${gid})` });
  rim.append(defs, rimGlow, rimPath);

  // The socket is a dark well in both themes, so the orb always paints its dark-theme lime.
  const orb = createThinkingOrb({ size: 56, state: "idle", theme: "dark" });
  const orbBadge = h("span", { class: "badge nj-badge", hidden: true, "aria-hidden": "true" });
  const orbLink = h("a", { class: "nj-orb", href: "#/sahay", dataset: { route: "sahay" } },
    h("span", { class: "nj-socket", "aria-hidden": "true" }, orb.el, orbBadge),
    h("span", { class: "nj-word nj-orb-word" }));
  orbLink.addEventListener("click", (e) => onOrb(e));

  const rows = [
    { id: "sahay", icon: "home", key: "nav.sahay", wideOnly: true },
    ...items,
    { id: "me", icon: "user", key: "nav.me", wideOnly: true },
  ];
  const links = rows.map((it) => h("a", { class: `nj-item${it.wideOnly ? " nj-wide-only" : ""}`, href: `#/${it.id}`, dataset: { route: it.id } },
    h("span", { class: "nj-ico", "aria-hidden": "true" }, icon(it.icon, 26), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" }),
    it.id === "sahay" ? h("span", { class: "nj-live", "aria-hidden": "true" }) : null));

  const marker = h("span", { class: "nj-marker", "aria-hidden": "true" });
  const me = h("a", { class: "nj-me", href: "#/me", dataset: { route: "me" } },
    h("span", { class: "nj-avatar", "aria-hidden": "true" }, icon("user", 24), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" }));
  const themeBtn = h("button", { class: "nj-tool nj-theme tip-right", type: "button" });
  themeBtn.addEventListener("click", () => onTheme());
  const brand = h("a", { class: "nj-brand", href: "#/sahay" }, brandMark({ size: 44, word: true }));

  const el = h("nav", { class: "nav-jelly" },
    shadow, glass, rim,
    brand,
    orbLink,
    h("div", { class: "nj-items" }, marker, ...links),
    h("div", { class: "nj-foot" }, me, h("div", { class: "nj-tools" }, themeBtn)));

  let model = { route: null };
  let markerAt = null; // { x, y, route }
  let geo = { w: 0, h: 0, depth: 0 };

  const wide = () => getComputedStyle(el).getPropertyValue("--nj-mode").trim() === "wide";
  const shown = (l) => l.getClientRects().length > 0;

  /** Where the marker sits for an item: its icon (rail) or the whole row (wide), after the curve offset. */
  function iconCentre(link) {
    if (wide()) {
      const dxw = Number(link.dataset.dx || 0);
      return { x: link.offsetLeft + dxw + link.offsetWidth / 2, y: link.offsetTop + link.offsetHeight / 2 };
    }
    const ico = link.querySelector(".nj-ico");
    const dx = Number(link.dataset.dx || 0);
    return { x: link.offsetLeft + dx + ico.offsetLeft + ico.offsetWidth / 2, y: link.offsetTop + ico.offsetTop + ico.offsetHeight / 2 };
  }

  /** Draw the glass for the real size and seat every item on the inward curve. */
  function relayout() {
    // (A fixed element has no offsetParent; an undisplayed one has no client rects.)
    if (!el.isConnected || el.getClientRects().length === 0) return;
    const w = el.clientWidth;
    const hgt = el.clientHeight;
    const depth = parseFloat(getComputedStyle(el).getPropertyValue("--nj-depth")) || 0;
    geo = { w, h: hgt, depth };
    const pts = concaveOutline(w, hgt, { depth, radius: 30 });
    glass.style.clipPath = polygonCss(pts);
    const d = svgPath(pts);
    for (const svg of [rim, shadow]) { svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`); svg.style.width = `${w}px`; svg.style.height = `${hgt}px`; }
    rimPath.setAttribute("d", d);
    rimGlow.setAttribute("d", d);
    shadowPath.setAttribute("d", d);
    cutPath.setAttribute("d", d);
    for (const [k, v] of Object.entries({ x: -80, y: -80, width: w + 160, height: hgt + 160 })) { cut.setAttribute(k, v); cutRect.setAttribute(k, v); }
    for (const link of links) {
      if (!shown(link)) continue;
      const yc = link.offsetTop + link.offsetHeight / 2;
      const dx = Math.round(concaveX(yc, w, hgt, depth) - w / 2);
      link.dataset.dx = String(dx);
      link.style.setProperty("--dx", `${dx}px`);
    }
    markerAt = null;
    placeMarker(false);
  }

  function placeMarker(animate) {
    const active = links.find((l) => l.dataset.route === model.route && shown(l));
    if (!active) {
      marker.classList.remove("is-on");
      markerAt = null;
      return;
    }
    const to = iconCentre(active);
    const from = markerAt;
    marker.classList.add("is-on");
    const final = `translate(${to.x}px, ${to.y}px) translate(-50%, -50%)`;
    if (animate && from && from.route !== model.route && typeof marker.animate === "function") {
      if (reduce()) {
        marker.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "linear" });
      } else {
        const g = geo;
        const xAt = (y) => concaveX(y, g.w, g.h, g.depth);
        const shift = to.x - xAt(to.y);
        const n = Math.max(2, Math.ceil(Math.abs(to.y - from.y) / 10));
        const frames = [];
        for (let i = 0; i <= n; i++) {
          const k = i / n;
          const y = from.y + (to.y - from.y) * k;
          const stretch = Math.sin(Math.PI * k); // 0 at the ends, 1 mid-way: the jelly stretch
          frames.push({ transform: `translate(${(xAt(y) + shift).toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(1 - 0.14 * stretch).toFixed(3)}, ${(1 + 0.34 * stretch).toFixed(3)})`, offset: k });
        }
        frames[frames.length - 1].transform = final;
        marker.animate(frames, { duration: 480, easing: "cubic-bezier(.22, 1, .36, 1)" });
      }
    }
    marker.style.transform = final;
    markerAt = { ...to, route: model.route };
  }

  function setBadge(node, n, word) {
    const b = node.querySelector(".nj-badge");
    const txt = badgeText(n);
    b.hidden = !txt;
    b.textContent = txt;
    node.setAttribute("aria-label", txt ? `${word}, ${t("shell.badge", { n })}` : word);
  }

  function update(next) {
    const prevRoute = model.route;
    model = { ...model, ...next };
    const badges = model.badges || {};
    el.setAttribute("aria-label", t("nav.label"));
    const onHome = model.route === "sahay";
    orbLink.querySelector(".nj-orb-word").textContent = t("nav.sahay");
    const orbWord = onHome ? t("shell.orbTalk") : t("shell.orbGo");
    setBadge(orbLink, badges.sahay || 0, model.orbLabel ? `${orbWord}, ${model.orbLabel}` : orbWord);
    orbLink.dataset.tip = orbWord;
    orbLink.classList.add("tip-right");
    if (onHome) orbLink.setAttribute("aria-current", "page"); else orbLink.removeAttribute("aria-current");
    orbLink.dataset.agent = model.agentState || "idle";
    orb.set(model.agentState || "idle");
    for (const link of links) {
      const it = rows.find((x) => x.id === link.dataset.route);
      const word = t(it.key);
      link.querySelector(".nj-word").textContent = word;
      setBadge(link, badges[it.id] || 0, word);
      if (model.route === it.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
      if (it.id === "sahay") link.dataset.agent = model.agentState || "idle";
    }
    me.querySelector(".nj-word").textContent = t("nav.me");
    setBadge(me, badges.me || 0, t("nav.me"));
    if (model.route === "me") me.setAttribute("aria-current", "page"); else me.removeAttribute("aria-current");
    brand.setAttribute("aria-label", t("app.name"));
    themeBtn.replaceChildren(icon(model.themeIcon || "sun", 22));
    themeBtn.setAttribute("aria-label", model.themeLabel || "");
    themeBtn.dataset.tip = model.themeLabel || "";
    if (prevRoute !== model.route) requestAnimationFrame(() => placeMarker(true));
  }

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => relayout()).observe(el);
  window.addEventListener("resize", () => requestAnimationFrame(relayout), { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => relayout());

  return { el, update, relayout, orb };
}
