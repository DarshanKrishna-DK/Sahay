// NavJelly (laptop, tablet) and NavRail (phone landscape): one floating curved glass sidebar.
// The glass is a column whose right edge swells into a clear convex belly where the items sit
// (shell-geometry jellyOutline, applied as a clip-path on the glass layer itself, so the backdrop
// blur follows the curve and the hex field shows through). An SVG draws the rim (lime at the
// belly) and the soft shadow from the same outline. The Sahay orb sits in a polished socket that
// breaks the top edge and the right edge; Buy, Sell, Stock and Money ride the belly (the middle
// items furthest right); a lime droplet slides ALONG the belly to the active item with a short jelly
// stretch (a plain fade under reduced motion). Bottom: My Sahay, language, theme. In the rail
// (phoneLand) the bulge is 0, so the same shape is a plain rounded column.
//
// The container (nav.nav-jelly) carries no filter, mask, opacity or transform: the glass layer is a
// child, the socket sits outside its clip.
//
// createNavJelly({ items, onOrb, onLang, onTheme }) -> { el, update(model), relayout() }
//   model = { route, badges: {key: n}, agentState, orbLabel, langShort, themeLabel, themeIcon }

import { h, icon, svgEl } from "./dom.js";
import { t } from "./i18n.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { jellyOutline, bellyX, polygonCss, svgPath, badgeText } from "./shell-geometry.js";

const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createNavJelly({ items, onOrb, onLang, onTheme }) {
  const gid = `nj-rim-${Math.random().toString(36).slice(2, 7)}`;
  const shadow = svgEl("svg", { class: "nj-shadow", "aria-hidden": "true", focusable: "false" });
  const shadowPath = svgEl("path");
  shadow.append(shadowPath);
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

  const links = items.map((it) => h("a", { class: "nj-item", href: `#/${it.id}`, dataset: { route: it.id } },
    h("span", { class: "nj-ico", "aria-hidden": "true" }, icon(it.icon, 28), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" })));

  const marker = h("span", { class: "nj-marker", "aria-hidden": "true" });
  const me = h("a", { class: "nj-me", href: "#/me", dataset: { route: "me" } },
    h("span", { class: "nj-avatar", "aria-hidden": "true" }, icon("user", 24), h("span", { class: "badge nj-badge", hidden: true })),
    h("span", { class: "nj-word" }));
  const langBtn = h("button", { class: "nj-tool nj-lang tip-right", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" }, h("span", { class: "nj-lang-txt" }));
  const themeBtn = h("button", { class: "nj-tool nj-theme tip-right", type: "button" });
  langBtn.addEventListener("click", () => onLang(langBtn));
  themeBtn.addEventListener("click", () => onTheme());

  const el = h("nav", { class: "nav-jelly" },
    shadow, glass, rim,
    orbLink,
    h("div", { class: "nj-items" }, marker, ...links),
    h("div", { class: "nj-foot" }, me, h("div", { class: "nj-tools" }, langBtn, themeBtn)));

  let model = { route: null };
  let markerAt = null; // { x, y, route }
  let geo = { body: 0, h: 0, bulge: 0, centre: 0, span: 1, follow: 0.7 };

  function vars() {
    const cs = getComputedStyle(el);
    return {
      body: parseFloat(cs.getPropertyValue("--nj-body")) || el.clientWidth,
      bulge: parseFloat(cs.getPropertyValue("--nj-bulge")) || 0,
      follow: parseFloat(cs.getPropertyValue("--nj-follow")) || 0.7,
    };
  }

  /** Centre of an item's icon in nav coordinates, after its belly offset. */
  function iconCentre(link) {
    const ico = link.querySelector(".nj-ico");
    const dx = Number(link.dataset.dx || 0);
    return { x: link.offsetLeft + dx + ico.offsetLeft + ico.offsetWidth / 2, y: link.offsetTop + ico.offsetTop + ico.offsetHeight / 2 };
  }

  /** Draw the glass for the real height and seat every item on the belly. */
  function relayout() {
    // (A fixed element has no offsetParent; an undisplayed one has no client rects.)
    if (!el.isConnected || el.getClientRects().length === 0) return;
    const v = vars();
    const hgt = el.clientHeight;
    const ys = links.map((l) => l.offsetTop + l.offsetHeight / 2);
    const first = ys[0], last = ys[ys.length - 1];
    const centre = (first + last) / 2;
    const span = Math.max(80, (last - first) / 2 + 90);
    geo = { body: v.body, h: hgt, bulge: v.bulge, centre, span, follow: v.follow };
    const pts = jellyOutline(v.body, hgt, { bulge: v.bulge, centre, span, radius: 30 });
    glass.style.clipPath = polygonCss(pts);
    const d = svgPath(pts);
    const w = v.body + v.bulge;
    for (const svg of [rim, shadow]) { svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`); svg.style.width = `${w}px`; svg.style.height = `${hgt}px`; }
    rimPath.setAttribute("d", d);
    rimGlow.setAttribute("d", d);
    shadowPath.setAttribute("d", d);
    for (const link of links) {
      const yc = link.offsetTop + link.offsetHeight / 2;
      const dx = Math.round(bellyX(yc, v.body, v.bulge, centre, span, v.follow) - v.body / 2);
      link.dataset.dx = String(dx);
      link.style.setProperty("--dx", `${dx}px`);
    }
    markerAt = null;
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
        const g = geo;
        const xAt = (y) => bellyX(y, g.body, g.bulge, g.centre, g.span, g.follow);
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
