// Landing page entry: language, the hero point cloud, the story stage, the two anatomy figures,
// smooth scroll on a mouse (Lenis, if its pinned file loaded) and the phone's floating start button.
// Every element is visible in its final state without script; script only adds motion.

import { LANGS, LANG_NAMES, applyLanguage, t } from "./i18n.js";
import { initGather } from "./gather.js";
import { initStory } from "./story.js";
import { mountFigures } from "/figures/loader.js";

const root = document.documentElement;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: the choice lasts this visit */ }
}

// ---- Language ----------------------------------------------------------------------------
let lang = LANGS.includes(root.dataset.lang) ? root.dataset.lang : "en";
let gather = null;
let story = null;

const figures = mountFigures(document, { lang, reducedQuery });

function setLanguage(next, { save = true } = {}) {
  lang = next;
  applyLanguage(lang);
  langName.textContent = LANG_NAMES[lang];
  langName.lang = lang;
  langBtn.setAttribute("aria-label", t("langCurrent", lang).replace("{name}", LANG_NAMES[lang]));
  if (save) store("sahay-ui-lang", lang); // the app's per-device UI language (README-v3.md): carries into /app
  figures.setLanguage(lang);
  // Labels change width with the script: place the hero trackers again once fonts settle.
  requestAnimationFrame(() => gather?.relayout());
  story?.refresh();
  document.dispatchEvent(new CustomEvent("landing:language", { detail: { lang } }));
}
for (const btn of document.querySelectorAll("button[data-lang]")) {
  btn.addEventListener("click", () => {
    setLanguage(btn.dataset.lang);
    if (btn.closest("#lang-menu")) closeMenu({ focus: true });
  });
}

// ---- Language menu in the nav: globe + current name; English / हिन्दी / ಕನ್ನಡ ------------------
const langBtn = document.getElementById("lang-btn");
const langName = document.getElementById("lang-name");
const langMenu = document.getElementById("lang-menu");
const menuItems = [...langMenu.querySelectorAll(".popover-item")];
function openMenu() {
  langMenu.hidden = false;
  langBtn.setAttribute("aria-expanded", "true");
  (menuItems.find((b) => b.dataset.lang === lang) || menuItems[0]).focus();
}
function closeMenu({ focus = false } = {}) {
  if (langMenu.hidden) return;
  langMenu.hidden = true;
  langBtn.setAttribute("aria-expanded", "false");
  if (focus) langBtn.focus();
}
langBtn.addEventListener("click", () => (langMenu.hidden ? openMenu() : closeMenu()));
langBtn.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openMenu(); }
});
langMenu.addEventListener("keydown", (e) => {
  const i = menuItems.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); closeMenu({ focus: true }); }
  else if (e.key === "ArrowDown") { e.preventDefault(); menuItems[(i + 1) % menuItems.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); menuItems[(i - 1 + menuItems.length) % menuItems.length].focus(); }
  else if (e.key === "Home") { e.preventDefault(); menuItems[0].focus(); }
  else if (e.key === "End") { e.preventDefault(); menuItems[menuItems.length - 1].focus(); }
  else if (e.key === "Tab") closeMenu();
});
document.addEventListener("pointerdown", (e) => {
  if (!langMenu.hidden && !e.target.closest(".lang-switch-wrap")) closeMenu();
});

// ---- Smooth scroll (mouse and trackpad only; never under reduced motion) --------------------
let lenis = null;
function initSmoothScroll() {
  const { Lenis, gsap } = window;
  if (!Lenis || reducedQuery.matches || matchMedia("(pointer: coarse)").matches) return;
  lenis = new Lenis({ lerp: 0.11 });
  if (gsap?.ticker) {
    gsap.ticker.add((time) => lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (time) => { if (!lenis) return; lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  reducedQuery.addEventListener?.("change", () => { if (reducedQuery.matches) { lenis?.destroy(); lenis = null; } });
}
function scrollToY(y, { immediate = false } = {}) {
  if (lenis) lenis.scrollTo(y, { immediate });
  else window.scrollTo({ top: y, behavior: immediate || reducedQuery.matches ? "auto" : "smooth" });
}
// In-page links go through the same path, so Lenis and the native scroll never fight.
for (const a of document.querySelectorAll('a[href^="#"]')) {
  if (a.closest(".story-rail")) continue; // the story rail handles its own jumps
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    const el = id && document.getElementById(id);
    if (!el || !lenis) return;
    e.preventDefault();
    scrollToY(el.getBoundingClientRect().top + window.scrollY - (id === "top" ? 0 : 88));
    if (id === "main") el.focus({ preventScroll: true });
  });
}

// ---- Phones: the floating start button steps aside while a big start button is on screen ----
function initBottomCta() {
  const bottom = document.querySelector(".bottom-cta");
  const big = document.querySelectorAll("[data-big-cta]");
  if (!bottom || !big.length) return;
  const showing = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) showing.add(e.target); else showing.delete(e.target); }
    const hide = showing.size > 0;
    bottom.classList.toggle("is-hidden", hide);
    bottom.inert = hide;
  });
  for (const el of big) io.observe(el);
}

// ---- Boot ----------------------------------------------------------------------------------
setLanguage(lang, { save: false });
gather = initGather(document.getElementById("gather-host"), { reducedQuery });
initSmoothScroll();
story = initStory(document.getElementById("story"), { reducedQuery, figures, scrollTo: scrollToY });
initBottomCta();
document.fonts?.ready.then(() => gather?.relayout());
