// Sahay app: boot (account -> session -> state -> live events), the v3 shell (shell.js: hex field,
// curved sidebar / phone dock, top capsule, slots) and the hash router. Routes (spec 1.1): #/sahay
// (default; #/talk), #/buy (#/work, #/orders), #/sell, #/stock, #/money, #/me and #/me/<section>
// (#/history), #/waiting (opens the tray in place), #/signup and #/login before a session.
// Screen switches use View Transitions where the browser has them (the nav, dock and capsule stay
// put), a short fade otherwise. The edge orb is gone (D5): talk = the nav orb / home orb, type = the
// composer, approve = the waiting tray, pause = End in the call dock.

import { h, $, fill, icon } from "./dom.js";
import { t, setLang, onLang } from "./i18n.js";
import * as store from "./store.js";
import { state, pendingApprovals } from "./store.js";
import * as shellApi from "./shell.js";
import { mountShell, slots, setRoute, setNavAgentState, setBadge, setTitle, setShop, refresh as refreshShell } from "./shell.js";
import { uiLang } from "./lang-switch.js";
import { parseRoute } from "./shell-geometry.js";
import { bootSplash, bootError } from "./boot-screens.js";
import { startCall, serverEnded, preload } from "./call.js";
import { SCREENS } from "./screens.js";
import "./store-sell.js";
import "./moments.js";
import { attachShell } from "./waiting.js";
import { createWelcome } from "./welcome.js";
import { createAuth } from "./auth.js";
import { agentState } from "./activity.js";

const app = $("#app");
mountShell(app);
attachShell(shellApi);
const main = slots.main;
const liveBanner = h("div", { class: "live-banner" });
slots.bannerSlot.append(liveBanner);

const screens = new Map();
let route = null;      // screen key ("buy", "me", "me/history")
let routeId = null;    // destination id for the nav ("me" for "me/history")
let welcome = null;
let authView = null;
let bootScreen = null; // { el, destroy() } from boot-screens.js

function authMode() {
  if (/^#\/login/.test(location.hash)) return "login";
  if (/^#\/signup/.test(location.hash)) return "signup";
  let had = false;
  try { had = localStorage.getItem("sahay-had-account") === "1"; } catch { /* storage blocked */ }
  return had ? "login" : "signup";
}

/** Screen key for a parsed route: "me/history" when that section has its own factory. */
function screenKey(r) {
  if (r.sub && SCREENS[`${r.id}/${r.sub}`]) return `${r.id}/${r.sub}`;
  return SCREENS[r.id] ? r.id : "sahay";
}

/** Run a DOM swap inside a view transition when the browser supports it and motion is welcome. */
function transition(swap) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce || document.visibilityState !== "visible") { swap(); return; }
  const html = document.documentElement;
  html.classList.add("vt-screen");
  try {
    const vt = document.startViewTransition(swap);
    vt.finished.finally(() => html.classList.remove("vt-screen"));
  } catch { html.classList.remove("vt-screen"); swap(); }
}

function screen(key) {
  if (!screens.has(key)) {
    const s = SCREENS[key]();
    s.el.classList.add("screen");
    s.el.dataset.screen = key;
    s.el.hidden = true;
    screens.set(key, s);
    main.append(s.el);
    s.update(state, new Set(["all"]));
  }
  return screens.get(key);
}

function titleFor(r) {
  if (r.id === "me" && r.sub) return t(`nav.${r.sub}`) !== `nav.${r.sub}` ? t(`nav.${r.sub}`) : t("nav.me");
  return t(`nav.${r.id}`);
}

function go() {
  let r = parseRoute(location.hash);
  if (r.id === "waiting") {
    // #/waiting opens the tray where the owner is (also a Telegram deep link); the URL goes back.
    document.dispatchEvent(new CustomEvent("sahay:open-tray"));
    const back = route ? `#/${route}` : "#/sahay";
    history.replaceState(null, "", back);
    if (route) return;
    r = parseRoute(back);
  }
  if (r.id === "signup" || r.id === "login") r = parseRoute("#/sahay");
  const key = screenKey(r);
  if (state.boot !== "ready") { route = key; routeId = r.id; return; }
  const same = key === route && screens.has(key) && !screens.get(key).el.hidden;
  const prev = route && screens.get(route);
  const s = screen(key);
  if (!same) {
    const swap = () => {
      if (prev && prev !== s) { prev.el.hidden = true; if (prev.leave) prev.leave(); }
      s.el.hidden = false;
      if (!document.startViewTransition) {
        s.el.classList.remove("screen-in");
        void s.el.offsetWidth; // restart the entrance
        s.el.classList.add("screen-in");
      }
    };
    if (prev && prev !== s) transition(swap); else swap();
  }
  route = key;
  routeId = r.id;
  if (s.enter) s.enter({ sub: r.sub });
  setRoute(r.id);
  setTitle(titleFor(r));
  if (!same && prev && prev !== s) { main.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
}

function renderBoot() {
  document.body.dataset.boot = state.boot;
  $(".skip-link").textContent = t("skip");
  if (state.boot === "ready") {
    if (welcome) { welcome.el.remove(); welcome = null; }
    if (authView) { authView.el.remove(); authView.destroy(); authView = null; }
    if (/^#\/(signup|login)/.test(location.hash)) history.replaceState(null, "", "#/sahay");
    for (const el of main.querySelectorAll(":scope > .boot-view")) el.remove();
    if (bootScreen) { bootScreen.destroy(); bootScreen = null; }
    route = null;
    go();
    return;
  }
  for (const s of screens.values()) s.el.hidden = true;
  for (const el of main.querySelectorAll(":scope > .boot-view")) el.remove();
  if (bootScreen) { bootScreen.destroy(); bootScreen = null; }
  if (state.boot === "auth") {
    if (welcome) { welcome.el.remove(); welcome = null; }
    if (!authView) { authView = createAuth({ mode: authMode() }); app.append(authView.el); history.replaceState(null, "", `#/${authMode()}`); }
    authView.update();
    return;
  }
  if (authView) { authView.el.remove(); authView.destroy(); authView = null; }
  if (state.boot === "welcome") {
    if (!welcome) { welcome = createWelcome(); app.append(welcome.el); }
    welcome.update();
    return;
  }
  if (welcome) { welcome.el.remove(); welcome = null; }
  // W5's boot screens (spec 3.1 row 55): the connecting orb, or the error with Try again / Log in.
  bootScreen = state.boot === "loading"
    ? bootSplash()
    : bootError({ err: state.bootError, onRetry: () => store.boot(), onLogin: () => { state.boot = "auth"; store.touch("boot"); } });
  main.append(h("div", { class: "boot-view" }, bootScreen.el));
}

export function describe(err) {
  if (!err) return t("err.network");
  if (err.status === 0) return t("err.network");
  if (err.status === 401 || err.status === 403) return t("err.session");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || t("err.network");
}

function renderBanner() {
  const items = [];
  if (state.boot === "ready" && state.stream === "closed") {
    items.push(h("div", { class: "banner banner-error glass", role: "status" },
      h("span", { class: "banner-ico", "aria-hidden": "true" }, icon("wifiOff", 20)),
      h("span", { class: "banner-text", text: t("live.banner") }),
      h("button", { class: "keycap keycap-ghost keycap-sm", type: "button", on: { click: () => store.retryEvents() } },
        icon("refresh", 20), h("span", { text: t("live.retry") }))));
  }
  fill(liveBanner, ...items);
}

/** Interim counts until the waiting tray (W3) claims the badges through the shell. */
function interimBadges() {
  const n = pendingApprovals().length;
  setBadge("waiting", n, "interim");
  setBadge("buy", n, "interim");
}

function syncShell() {
  const b = state.business;
  setShop({ name: b && b.name ? b.name : "", city: b && b.city ? b.city : "", stream: state.stream });
  setNavAgentState(agentState());
  interimBadges();
}

// Speaking anywhere starts the call in place (D11): no jump to another screen.
document.addEventListener("sahay:talk", (e) => {
  const mode = (e.detail && e.detail.mode) || "voice";
  if (e.detail && e.detail.hint) document.dispatchEvent(new CustomEvent("sahay:hint", { detail: { key: e.detail.hint } }));
  if (mode === "voice") startCall("voice");
});

store.onEvent((evt) => {
  if (evt.type === "session.ended" && evt.data && evt.data.kind === "owner") serverEnded(evt.data.channel, evt.data.reason);
});

store.subscribe((s, parts) => {
  // The words on screen follow the device's UI language only (v4); the shop's language is Sahay's voice.
  if (parts.has("boot")) renderBoot();
  if (parts.has("lang")) {
    // Language changed: rebuild every mounted screen in the new language.
    for (const sc of screens.values()) sc.update(s, new Set(["all"]));
    if (welcome) welcome.update();
    if (authView) authView.update();
    renderBoot();
    refreshShell();
  }
  if (state.boot === "ready") {
    for (const [key, sc] of screens) if (!sc.el.hidden || key === route) sc.update(s, parts);
    if (routeId) setTitle(titleFor(parseRoute(location.hash)));
  }
  syncShell();
  if (parts.has("stream") || parts.has("boot") || parts.has("lang")) renderBanner();
});

window.addEventListener("hashchange", () => {
  if (state.boot === "auth" && authView) { if (/^#\/(signup|login)/.test(location.hash)) authView.show(authMode()); return; }
  go();
  // A screen that was hidden missed partial updates: refresh it whole.
  const s = screens.get(route);
  if (s) s.update(state, new Set(["all"]));
});

// UI language: this device's choice (lang-switch.js), English by default. A change re-renders every
// mounted screen through the store's "lang" part (screens already rebuild on it).
setLang(uiLang());
onLang(() => { refreshShell(); store.touch("lang"); });
setRoute(parseRoute(location.hash).id);
syncShell();
renderBoot();
store.boot();
preload();
