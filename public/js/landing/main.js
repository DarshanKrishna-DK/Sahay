// Landing page entry (v7): language, the nav (clear over the hero, solid once scrolled, the section
// in view marked), the phone menu, the "What Sahay does" carousel, and smooth scroll on a mouse
// (Lenis, if its pinned file loaded). Every section is complete without script.

import { LANGS, LANG_NAMES, applyLanguage, t } from "./i18n.js";
import { initCarousel } from "./carousel.js";

const root = document.documentElement;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: the choice lasts this visit */ }
}

// ---- Language ----------------------------------------------------------------------------------
let lang = LANGS.includes(root.dataset.lang) ? root.dataset.lang : "en";
const langBtn = document.getElementById("lang-btn");
const langName = document.getElementById("lang-name");
const langMenu = document.getElementById("lang-menu");
const menuItems = [...langMenu.querySelectorAll(".popover-item")];

function setLanguage(next, { save = true } = {}) {
  lang = next;
  applyLanguage(lang);
  langName.textContent = LANG_NAMES[lang];
  langName.lang = lang;
  langBtn.setAttribute("aria-label", t("langCurrent", lang).replace("{name}", LANG_NAMES[lang]));
  menuBtn.setAttribute("aria-label", t(menuBtn.getAttribute("aria-expanded") === "true" ? "menuClose" : "menu", lang));
  if (save) store("sahay-ui-lang", lang); // the app's per-device UI language: carries into /app
  carousel?.update();
}
for (const btn of document.querySelectorAll("button[data-lang]")) {
  btn.addEventListener("click", () => {
    setLanguage(btn.dataset.lang);
    if (btn.closest("#lang-menu")) closeLangMenu({ focus: true });
  });
}

// Language menu in the nav (laptops): globe + the current language's name.
function openLangMenu() {
  langMenu.hidden = false;
  langBtn.setAttribute("aria-expanded", "true");
  (menuItems.find((b) => b.dataset.lang === lang) || menuItems[0]).focus();
}
function closeLangMenu({ focus = false } = {}) {
  if (langMenu.hidden) return;
  langMenu.hidden = true;
  langBtn.setAttribute("aria-expanded", "false");
  if (focus) langBtn.focus();
}
langBtn.addEventListener("click", () => (langMenu.hidden ? openLangMenu() : closeLangMenu()));
langBtn.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openLangMenu(); }
});
langMenu.addEventListener("keydown", (e) => {
  const i = menuItems.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); closeLangMenu({ focus: true }); }
  else if (e.key === "ArrowDown") { e.preventDefault(); menuItems[(i + 1) % menuItems.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); menuItems[(i - 1 + menuItems.length) % menuItems.length].focus(); }
  else if (e.key === "Home") { e.preventDefault(); menuItems[0].focus(); }
  else if (e.key === "End") { e.preventDefault(); menuItems[menuItems.length - 1].focus(); }
  else if (e.key === "Tab") closeLangMenu();
});
document.addEventListener("pointerdown", (e) => {
  if (!langMenu.hidden && !e.target.closest(".lang-switch-wrap")) closeLangMenu();
});

// ---- Phone menu --------------------------------------------------------------------------------
const nav = document.getElementById("nav");
const menuBtn = document.getElementById("menu-btn");
const siteMenu = document.getElementById("site-menu");
function setMenu(open, { focus = false } = {}) {
  siteMenu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", t(open ? "menuClose" : "menu", lang));
  nav.classList.toggle("menu-open", open);
  if (focus) menuBtn.focus();
}
menuBtn.addEventListener("click", () => setMenu(siteMenu.hidden));
siteMenu.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !siteMenu.hidden) setMenu(false, { focus: true }); });
matchMedia("(min-width: 1024px)").addEventListener?.("change", (e) => { if (e.matches) setMenu(false); });

// ---- Nav: clear over the hero, solid (and a lime call to action) once the page has scrolled -------
function syncNav() {
  const scrolled = window.scrollY > 24;
  nav.classList.toggle("nav-clear", !scrolled);
  nav.classList.toggle("nav-solid", scrolled);
}
window.addEventListener("scroll", syncNav, { passive: true });
syncNav();

// The section in view gets its nav link marked (lime text and underline).
const spyLinks = [...document.querySelectorAll(".nav-links a[data-spy]")];
const spied = spyLinks.map((a) => document.getElementById(a.dataset.spy)).filter(Boolean);
if (spied.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of spyLinks) {
        if (a.dataset.spy === e.target.id) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      }
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  for (const s of spied) io.observe(s);
  // Back over the hero or the about section: no link is current.
  const top = document.getElementById("top"), about = document.getElementById("about");
  const clear = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) for (const a of spyLinks) a.removeAttribute("aria-current");
  }, { rootMargin: "-45% 0px -50% 0px" });
  if (top) clear.observe(top);
  if (about) clear.observe(about);
}

// ---- Carousel ------------------------------------------------------------------------------------
const carousel = initCarousel(document.getElementById("fx-track"), {
  progress: document.querySelector(".fx-progress"),
  arrows: [...document.querySelectorAll(".fx-arrows [data-fx]")],
  reducedQuery,
});

// ---- Smooth scroll (mouse and trackpad only; never under reduced motion) --------------------------
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
// In-page links go through the same path, so Lenis and the native scroll never fight.
for (const a of document.querySelectorAll('a[href^="#"]')) {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    const el = id && document.getElementById(id);
    if (!el || !lenis) return;
    e.preventDefault();
    lenis.scrollTo(id === "top" ? 0 : el.getBoundingClientRect().top + window.scrollY - 80);
    if (id === "main") el.focus({ preventScroll: true });
  });
}

// ---- Boot ----------------------------------------------------------------------------------------
setLanguage(lang, { save: false });
// The deferred CDN files run before this module (both wait for the document); start Lenis now.
initSmoothScroll();
