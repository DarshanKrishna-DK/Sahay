// Landing page entry: language, theme, the river rail, the edge orb, hover and scroll motion.
// Works without the motion libraries: every element is visible in its final state by default.

import { LANGS, applyLanguage, t } from "./i18n.js";
import { initEdgeOrb } from "./edge-orb.js";
import { initHover } from "./hover.js";
import { initMotion } from "./motion.js";

const root = document.documentElement;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: the choice lasts this visit */ }
}

// ---- Language ----------------------------------------------------------------------------
let lang = LANGS.includes(root.dataset.lang) ? root.dataset.lang : "en";

function setLanguage(next, { save = true } = {}) {
  lang = next;
  applyLanguage(lang);
  markHeroLine(lang);
  updateThemeLabel();
  if (save) store("sahay-landing-lang", lang);
  document.dispatchEvent(new CustomEvent("landing:language", { detail: { lang } }));
}

for (const btn of document.querySelectorAll("button[data-lang]")) {
  btn.addEventListener("click", () => setLanguage(btn.dataset.lang));
}

// ---- Hero: one line in three scripts; the owner's script is lit -----------------------------
const heroLines = [...document.querySelectorAll(".hero-line")];
function markHeroLine(active) {
  for (const line of heroLines) line.classList.toggle("is-lit", line.dataset.line === active);
}

/** Lights each script once (about four seconds, under the 5 s auto-update limit), then rests on the owner's. */
function cycleHeroOnce() {
  if (reducedQuery.matches) return;
  const order = ["en", "hi", "kn"].filter((l) => l !== lang).concat(lang);
  order.forEach((l, i) => setTimeout(() => markHeroLine(i === order.length - 1 ? lang : l), 900 + i * 1100));
}

// ---- Theme ---------------------------------------------------------------------------------
const themeBtn = document.getElementById("theme-btn");
function currentTheme() {
  if (root.dataset.theme === "light" || root.dataset.theme === "dark") return root.dataset.theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function updateThemeLabel() {
  const theme = currentTheme();
  themeBtn.setAttribute("aria-label", t(theme === "dark" ? "toLight" : "toDark", lang));
  themeBtn.dataset.current = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0B0E14" : "#EEF1F6";
}
themeBtn.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  store("sahay-theme", next);
  updateThemeLabel();
});
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", updateThemeLabel);

// ---- River rail: the step on screen lights up (works with or without motion) ---------------
function initRail() {
  const rail = document.getElementById("river-rail");
  const links = new Map([...rail.querySelectorAll("a[data-step]")].map((a) => [a.dataset.step, a]));
  const beats = [...document.querySelectorAll(".beat")];
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.intersectionRatio);
    let best = null;
    let bestRatio = 0.25;
    for (const [id, ratio] of visible) if (ratio > bestRatio) { best = id; bestRatio = ratio; }
    for (const [id, a] of links) {
      const on = id === best;
      a.classList.toggle("is-current", on);
      if (on) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current");
    }
    rail.classList.toggle("is-active", best !== null);
  }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
  for (const b of beats) io.observe(b);
}

// ---- Phones: the floating start button steps aside while a big start button is on screen ----
function initBottomCta() {
  const bottom = document.querySelector(".bottom-cta");
  const bigOnes = document.querySelectorAll(".cta-big, .cta-orb");
  if (!bottom || !bigOnes.length) return;
  const showing = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) showing.add(e.target); else showing.delete(e.target); }
    const hide = showing.size > 0;
    bottom.classList.toggle("is-hidden", hide);
    if (hide) bottom.setAttribute("tabindex", "-1"); else bottom.removeAttribute("tabindex");
  });
  for (const el of bigOnes) io.observe(el);
}

// ---- Boot ----------------------------------------------------------------------------------
setLanguage(lang, { save: false });
initRail();
initBottomCta();
initEdgeOrb();
initHover({ reducedQuery });

// The motion libraries are deferred classic scripts that run before this module; if a CDN file
// failed (offline, blocked), the page stays static and complete.
const motion = initMotion({ reducedQuery });
cycleHeroOnce();
document.addEventListener("landing:language", () => motion?.refresh());
