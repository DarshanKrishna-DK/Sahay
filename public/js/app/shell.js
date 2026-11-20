// The v3 shell: hex-dot field, NavJelly / NavRail (laptop, tablet, phone landscape), NavDock (phone),
// TopCapsule / TopStrip, banner slot, agent column, and the mount points other packages fill.
// Contract: public/css/README-v3.md section 3. No full-width bar at any size (D17).
//
//   slots          { main, topCapsule, waitingPill, agentColumn, dockSlot, toastRegion, sheetRoot, bannerSlot }
//   onLayout(fn)   fn({ size, keyboardOpen, columnShown }) now and on every change; returns unsubscribe
//   layout()       the current layout
//   setNavAgentState(state)   the nav orb follows the agent
//   setBadge(key, n)          "sahay" | "buy" | "sell" | "stock" | "money" | "me" | "waiting"
//   claimBadges()             a package that owns the counts (W3) calls this once; interim counts stop
//   setTitle(text) ("Sell · Sahay"), setAction(spec | null), navigate(hash), toggleTheme(), setRoute(id)

import { h, icon } from "./dom.js";
import { t } from "./i18n.js";
import "./shell-strings.js";
import { sizeClass } from "./shell-geometry.js";
import { createHexField } from "./hex-field.js";
import { createNavJelly } from "./nav-jelly.js";
import { createNavDock } from "./nav-dock.js";
import { createTopCapsule } from "./top-capsule.js";
// v4 shared pieces, re-exported so screens import one module: the brand mark, the UI language
// switcher (English by default, per device) and the page head.
export { brandMark, BRAND } from "./brand.js";
export { createLangSwitch, uiLang, setUiLang } from "./lang-switch.js";
export { pageHead } from "./ui.js";

export const NAV_ITEMS = [
  { id: "buy", icon: "cart", key: "nav.buy" },
  { id: "sell", icon: "receipt", key: "nav.sell" },
  { id: "stock", icon: "jar", key: "nav.stock" },
  { id: "money", icon: "wallet", key: "nav.money" },
];
export const ROUTES = [{ id: "sahay", key: "nav.sahay" }, ...NAV_ITEMS, { id: "me", key: "nav.me" }];

const root = document.documentElement;
const listeners = new Set();
let current = { size: sizeClass(window.innerWidth, window.innerHeight), keyboardOpen: false, columnShown: window.innerWidth >= 1280 && window.innerHeight > 500 };
const badges = { sahay: 0, buy: 0, sell: 0, stock: 0, money: 0, me: 0, waiting: 0 };
let badgesClaimed = false;
let route = null;
let agent = "idle";
let agentLabel = "";
let action = null;
let shopName = "";
let shopCity = "";
let stream = "connecting";
let offline = typeof navigator !== "undefined" && navigator.onLine === false;
let mounted = false;

/* ------------------------------------------------------------- the DOM -- */
const hex = createHexField();
const nav = createNavJelly({ items: NAV_ITEMS, onOrb, onTheme: toggleTheme });
const dock = createNavDock({ items: NAV_ITEMS, onOrb });
const capsule = createTopCapsule({ onWaiting: () => openTray(), onTheme: () => toggleTheme(), themeLabel: () => (themeNow() === "dark" ? t("theme.light") : t("theme.dark")) });

const main = h("main", { id: "main", tabindex: "-1" });
const bannerSlot = h("div", { class: "banner-slot", "aria-live": "polite" });
const waitingPill = h("div", { class: "waiting-pill-slot" });
const dockSlot = h("div", { class: "dock-slot" });
const agentColumn = h("aside", { class: "agent-column" });
const toastRegion = h("div", { class: "toast-region" });
const sheetRoot = h("div", { class: "sheet-host" });
const floatHost = h("div", { class: "dock-float" });
const topZone = h("div", { class: "top-zone" }, capsule.el, bannerSlot, waitingPill);
const content = h("div", { class: "shell-content" }, topZone, main);
const shellEl = h("div", { class: "shell" }, nav.el, h("div", { class: "shell-body" }, content, agentColumn), dock.el, floatHost);

export const slots = { main, topCapsule: capsule.el, waitingPill, agentColumn, dockSlot, toastRegion, sheetRoot, bannerSlot };

/** Build the shell inside `app` (once). The hex field goes first in <body>, outside every wrapper. */
export function mountShell(app) {
  if (mounted) return slots;
  mounted = true;
  document.body.prepend(hex.el);
  app.append(shellEl);
  document.body.append(toastRegion, sheetRoot);
  measure();
  placeSlots();
  watchTopZone();
  watchOnline();
  return slots;
}

/* -------------------------------------------------------------- layout -- */
function computeKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return false;
  const active = document.activeElement;
  const typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
  return Boolean(typing) && window.innerHeight - vv.height > 150;
}

function measure() {
  const w = window.innerWidth, hgt = window.innerHeight;
  const next = {
    size: sizeClass(w, hgt),
    keyboardOpen: computeKeyboard(),
    columnShown: w >= 1280 && sizeClass(w, hgt) !== "phoneLand",
  };
  root.dataset.size = next.size;
  if (next.keyboardOpen) root.dataset.keyboard = "open"; else delete root.dataset.keyboard;
  if (next.columnShown) root.dataset.column = "on"; else delete root.dataset.column;
  const changed = next.size !== current.size || next.keyboardOpen !== current.keyboardOpen || next.columnShown !== current.columnShown;
  current = next;
  if (changed) {
    placeSlots();
    for (const fn of listeners) { try { fn({ ...current }); } catch (err) { console.error(err); } }
    document.dispatchEvent(new CustomEvent("sahay:layout", { detail: { ...current } }));
  }
  requestAnimationFrame(() => { nav.relayout(); dock.relayout(); });
}

/** Move the CallDock and the Waiting pill to their place for this size (spec 1.3, 6.1). */
function placeSlots() {
  const s = current.size;
  const place = current.columnShown ? "column" : s === "phone" ? "dock" : "float";
  dockSlot.dataset.place = place;
  if (place === "column") { if (dockSlot.parentNode !== agentColumn) agentColumn.prepend(dockSlot); }
  else if (dockSlot.parentNode !== floatHost) floatHost.append(dockSlot);
  floatHost.dataset.place = place;
  // Waiting pill: under the capsule on phones; inside the top strip's own flow on tablet and
  // 1024-1279 (never over the notice); hidden at 1280+ where the tray lives in the agent column.
  const pillPlace = current.columnShown ? "column" : s === "phone" || s === "phoneLand" ? "capsule" : "strip";
  waitingPill.dataset.place = pillPlace;
  if (pillPlace === "strip") { if (waitingPill.parentNode !== capsule.el) capsule.el.append(waitingPill); }
  else if (waitingPill.parentNode !== topZone) topZone.append(waitingPill);
}

export function onLayout(fn) {
  listeners.add(fn);
  try { fn({ ...current }); } catch (err) { console.error(err); }
  return () => listeners.delete(fn);
}
export function layout() { return { ...current }; }

let resizeT = 0;
window.addEventListener("resize", () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(measure); }, { passive: true });
if (window.visualViewport) window.visualViewport.addEventListener("resize", () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(measure); });
document.addEventListener("focusin", () => setTimeout(measure, 350));
document.addEventListener("focusout", () => setTimeout(measure, 350));

/** The floating top zone's height, so content starts below it on phones (--top-zone-h). */
function watchTopZone() {
  const set = () => root.style.setProperty("--top-zone-h", `${Math.ceil(topZone.getBoundingClientRect().height)}px`);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(set).observe(topZone);
  set();
}

/* -------------------------------------------------------------- banners -- */
let offlineBanner = null;
function watchOnline() {
  const sync = () => {
    if (navigator.onLine === false) {
      if (!offlineBanner) {
        offlineBanner = h("div", { class: "banner banner-warn glass", role: "status" },
          h("span", { class: "banner-ico", "aria-hidden": "true" }, icon("wifiOff", 20)),
          h("span", { class: "banner-text" }));
        bannerSlot.prepend(offlineBanner);
      }
      offlineBanner.querySelector(".banner-text").textContent = t("shell.offline");
    } else if (offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
    offline = navigator.onLine === false;
    render();
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

/* ----------------------------------------------------------- nav, orb -- */
function onOrb(e) {
  // D11: from another screen the orb goes home (no call, no mic prompt); on home it starts the call.
  if (route === "sahay") {
    e.preventDefault();
    document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", from: "orb" } }));
  }
}

function openTray() {
  document.dispatchEvent(new CustomEvent("sahay:open-tray"));
}

function themeNow() {
  return root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
export function toggleTheme() {
  const next = themeNow() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("sahay-theme", next); } catch { /* storage blocked */ }
  render();
}
try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => render()); } catch { /* old browser */ }



function render() {
  const dark = themeNow() === "dark";
  const model = {
    route, badges: { ...badges, sahay: badges.sahay }, agentState: agent, orbLabel: agentLabel,
    themeLabel: dark ? t("theme.light") : t("theme.dark"), themeIcon: dark ? "sun" : "moon",
  };
  nav.update(model);
  dock.update(model);
  capsule.update({ shopName, city: shopCity, stream, offline, waiting: badges.waiting, route, action });
}

/* --------------------------------------------------------------- API -- */
export function setRoute(id) {
  if (id !== route) action = null;
  route = id;
  root.dataset.route = id || "";
  render();
}
export function setNavAgentState(state, label = "") {
  if (state === agent && label === agentLabel) return;
  agent = state || "idle";
  agentLabel = label;
  root.dataset.agent = agent;
  render();
}
export function setBadge(key, n, source = "owner") {
  if (!(key in badges)) return;
  if (source === "interim" && badgesClaimed) return;
  if (source !== "interim") badgesClaimed = true; // the first owner call takes the counts over
  const v = Math.max(0, Number(n) || 0);
  if (badges[key] === v) return;
  badges[key] = v;
  render();
}
export function claimBadges() { badgesClaimed = true; }
/** "Sell · सहाय"; just the app name on Sahay home (no "सहाय | सहाय"). */
export function setTitle(text) {
  const app = t("app.name");
  document.title = text && text !== app && text !== t("nav.sahay") ? `${text} · ${app}` : app;
}
export function setAction(spec) { action = spec || null; render(); }
export function setShop({ name, city, stream: s } = {}) {
  if (name !== undefined) shopName = name || "";
  if (city !== undefined) shopCity = city || "";
  if (s !== undefined) stream = s || "connecting";
  render();
}
export function navigate(hash) { if (location.hash !== hash) location.hash = hash; }
export function refresh() { render(); }
