// NavJelly (laptop, tablet) and NavRail (phone landscape): one floating curved glass sidebar.
// Its right edge is a convex bow (elliptical border-radius, so the backdrop blur is clipped to the
// same curve and the hex field shows through). The Sahay orb sits in a round socket at the top that
// bulges past the edge; Buy, Sell, Stock and Money follow the bow (the middle items furthest right);
// a lime droplet slides ALONG the bow to the active item with a short jelly stretch (a plain fade
// under reduced motion). Bottom: My Sahay, language, theme. In the rail (phoneLand) the bow is 0.
//
// createNavJelly({ items, onOrb, onLang, onTheme }) -> { el, update(model), relayout() }
//   model = { route, badges: {key: n}, agentState, orbLabel, langShort, themeLabel, themeIcon }

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { arcOffset, arcSamples, badgeText } from "./shell-geometry.js";

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createNavJelly({ items, onOrb, onLang, onTheme }) {
  const orb = createThinkingOrb({ size: 56, state: "idle" });
  const orbBadge = h("span", { class: "badge nj-badge", hidden: true, "aria-hidden": "true" });
  const orbLink = h("a", { class: "nj-orb", href: "#/sahay", dataset: { route: "sahay" } },
    h("span", { class: "nj-socket", "aria-hidden": "true" }, orb.el, orbBadge),
    h("span", { class: "nj-word nj-orb-word" }));
  orbLink.addEventListener("click", (e) => onOrb(e));

  const links = items.map((it) => h("a", { class: "nj-item", href: `#/${it.id}`, dataset: { route: it.id } },
    h("span", { class: "nj-ico", "aria-hidden": "true" }, icon(it.icon, 28), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" })));

  const marker = h("span", { class: "nj-marker", "aria-hidden": "true" });
  const me = h("a", { class: "nj-me", href: "#/me", dataset: { route: "me" } },
    h("span", { class: "nj-avatar", "aria-hidden": "true" }, icon("user", 24), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" }));
  const langBtn = h("button", { class: "nj-tool nj-lang", type: "button", "aria-haspopup": "menu" }, h("span", { class: "nj-lang-txt" }));
  const themeBtn = h("button", { class: "nj-tool nj-theme", type: "button" });
  langBtn.addEventListener("click", () => onLang(langBtn));
  themeBtn.addEventListener("click", () => onTheme());

  const el = h("nav", { class: "nav-jelly glass glass-rim" },
    orbLink,
    h("div", { class: "nj-items" }, marker, ...links),
    h("div", { class: "nj-foot" }, me, h("div", { class: "nj-tools" }, langBtn, themeBtn)));

  let model = { route: null };
  let markerAt = null; // { x, y, route }

  /** Centre of an item's icon in nav coordinates, after its bow offset. */
  function iconCentre(link) {
    const ico = link.querySelector(".nj-ico");
    const dx = Number(link.dataset.dx || 0);
    return { x: link.offsetLeft + dx + ico.offsetLeft + ico.offsetWidth / 2, y: link.offsetTop + ico.offsetTop + ico.offsetHeight / 2 };
  }

  function geometry() {
    const cs = getComputedStyle(el);
    return { w: el.clientWidth, h: el.clientHeight, bulge: parseFloat(cs.getPropertyValue("--nj-bulge")) || 0 };
  }

  /** Put every item on the bow (transform only, so focus order and hit areas stay in the column). */
  function relayout() {
    // (A fixed element has no offsetParent; an undisplayed one has no client rects.)
    if (!el.isConnected || el.getClientRects().length === 0) return;
    const g = geometry();
    for (const link of links) {
      const yc = link.offsetTop + link.offsetHeight / 2;
      const dx = g.bulge ? Math.round(arcOffset(yc, g.h, g.bulge) / 2) : 0;
      link.dataset.dx = String(dx);
      link.style.setProperty("--dx", `${dx}px`);
    }
    placeMarker(false);
  }

  function placeMarker(animate) {
    const active = links.find((l) => l.dataset.route === model.route);
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
        const g = geometry();
        const pts = arcSamples(g.w, g.h, g.bulge, from.y, to.y, 10);
        const n = pts.length - 1;
        const xShift = to.x - (g.bulge ? (g.w - g.bulge + arcOffset(to.y, g.h, g.bulge)) / 2 : to.x);
        const frames = pts.map((p, i) => {
          const k = n ? i / n : 1;
          const stretch = Math.sin(Math.PI * k); // 0 at the ends, 1 mid-way: the jelly stretch
          const x = p.x + xShift;
          return { transform: `translate(${x}px, ${p.y}px) translate(-50%, -50%) scale(${(1 - 0.14 * stretch).toFixed(3)}, ${(1 + 0.32 * stretch).toFixed(3)})`, offset: k };
        });
        frames[frames.length - 1].transform = final;
        marker.animate(frames, { duration: 460, easing: "cubic-bezier(.22, 1, .36, 1)" });
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
      const it = items.find((x) => x.id === link.dataset.route);
      const word = t(it.key);
      link.querySelector(".nj-word").textContent = word;
      setBadge(link, badges[it.id] || 0, word);
      if (model.route === it.id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    me.querySelector(".nj-word").textContent = t("nav.me");
    setBadge(me, badges.me || 0, t("nav.me"));
    if (model.route === "me") me.setAttribute("aria-current", "page"); else me.removeAttribute("aria-current");
    langBtn.querySelector(".nj-lang-txt").textContent = model.langShort || "";
    langBtn.setAttribute("aria-label", t("shell.lang"));
    langBtn.dataset.tip = t("shell.lang");
    langBtn.classList.add("tip-right");
    themeBtn.replaceChildren(icon(model.themeIcon || "sun", 22));
    themeBtn.setAttribute("aria-label", model.themeLabel || "");
    themeBtn.dataset.tip = model.themeLabel || "";
    themeBtn.classList.add("tip-right");
    if (prevRoute !== model.route) requestAnimationFrame(() => placeMarker(true));
  }

  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => relayout()).observe(el);
  window.addEventListener("resize", () => requestAnimationFrame(relayout), { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => relayout());

  return { el, update, relayout, orb };
}
