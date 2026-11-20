// Sahay app (v5): boot (account -> session -> state -> live events), the shell (top bar, phone tab bar)
// and the hash router. Routes: routes.js. Screens: screens.js. Kit: ui.js. The words on screen follow
// this device's language (English by default, `sahay-ui-lang`), never the shop's voice language.

import { h, $, fill, icon, button, emptyState, skeleton, uiLang } from "./ui.js";
import { t, setLang, onLang, addStrings } from "./i18n.js";
import * as store from "./store.js";
import { state, pendingApprovals } from "./store.js";
import { pendingInvoices } from "./store-sell.js";
import { mountShell, slots, setRoute, setNeedsCount, setTitle, setShop, setLogout, openNeedsHost } from "./shell.js";
import { parseRoute } from "./routes.js";
import { SCREENS, AUTH } from "./screens.js";
import { startCall, serverEnded, preload } from "./call.js";
import "./yes.js"; // W3: the Needs-you host, the count, #/needs, Home's Check, auto-open on a spoken read-back
import "./moments.js";

addStrings({
  "boot.loginSoon": ["Log in is being rebuilt", "लॉग इन फिर से बन रहा है", "ಲಾಗಿನ್ ಮತ್ತೆ ನಿರ್ಮಾಣವಾಗುತ್ತಿದೆ"],
  "boot.loginSoonText": ["Open Sahay again in a few minutes.", "कुछ मिनट बाद सहाय फिर खोलें।", "ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಸಹಾಯ್ ಮತ್ತೆ ತೆರೆಯಿರಿ."],
});

const app = $("#app");
mountShell(app);
const main = slots.main;
const liveBanner = h("div", { class: "live-banner" });
slots.bannerSlot.append(liveBanner);

const screens = new Map();
let route = null;
let authView = null;

function screen(id) {
  if (!screens.has(id)) {
    const s = SCREENS[id]();
    s.el.classList.add("screen");
    s.el.dataset.screen = id;
    s.el.hidden = true;
    screens.set(id, s);
    main.append(s.el);
    s.update(state, new Set(["all"]));
  }
  return screens.get(id);
}

function titleFor(r) {
  if (r.id === "me" && r.sub === "history") return t("nav.history");
  return t(`nav.${r.id}`);
}

function go() {
  let r = parseRoute(location.hash);
  if (r.id === "needs") {
    // #/needs opens the Yes cards where the owner is (also a Telegram deep link); the URL goes back.
    openNeedsHost();
    const back = route ? `#/${route}` : "#/home";
    history.replaceState(null, "", back);
    if (route) return;
    r = parseRoute(back);
  }
  if (r.id === "signup" || r.id === "login") r = parseRoute("#/home");
  if (state.boot !== "ready") { route = r.id; return; }
  const prev = route && screens.get(route);
  const s = screen(r.id);
  if (prev !== s || s.el.hidden) {
    if (prev && prev !== s) { prev.el.hidden = true; if (prev.leave) prev.leave(); }
    s.el.hidden = false;
    window.scrollTo({ top: 0 });
    if (prev && prev !== s) { const h1 = s.el.querySelector("h1"); if (h1) h1.focus({ preventScroll: true }); else main.focus({ preventScroll: true }); }
  }
  route = r.id;
  if (s.enter) s.enter({ sub: r.sub });
  setRoute(r.id);
  setTitle(titleFor(r));
}

function authMode() {
  if (/^#\/login/.test(location.hash)) return "login";
  if (/^#\/signup/.test(location.hash)) return "signup";
  let had = false;
  try { had = localStorage.getItem("sahay-had-account") === "1"; } catch { /* storage blocked */ }
  return had ? "login" : "signup";
}

const clearBoot = () => { for (const el of main.querySelectorAll(":scope > .boot-view")) el.remove(); };

function renderBoot() {
  document.body.dataset.boot = state.boot;
  $(".skip-link").textContent = t("skip");
  if (state.boot === "ready") {
    if (authView) { authView.el.remove(); if (authView.destroy) authView.destroy(); authView = null; }
    if (/^#\/(signup|login)/.test(location.hash)) history.replaceState(null, "", "#/home");
    clearBoot();
    route = null;
    go();
    return;
  }
  for (const s of screens.values()) s.el.hidden = true;
  clearBoot();
  if (state.boot === "auth" || state.boot === "welcome") {
    if (AUTH) {
      if (!authView) { authView = AUTH({ mode: authMode() }); main.append(authView.el); history.replaceState(null, "", `#/${authMode()}`); }
      if (authView.update) authView.update();
      return;
    }
    // Until the log-in screen (W5) lands: say so plainly, no fake form.
    main.append(h("div", { class: "boot-view" }, emptyState({ icon: "lock", title: t("boot.loginSoon"), text: t("boot.loginSoonText") })));
    return;
  }
  main.append(h("div", { class: "boot-view" },
    state.boot === "loading"
      ? h("div", { class: "boot-loading" }, h("p", { class: "boot-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t("boot.loading") })), skeleton("cards", 3))
      : emptyState({ icon: "wifiOff", title: t("boot.error"), text: describe(state.bootError),
        action: button({ word: t("retry"), icon: "refresh", kind: "primary", onClick: () => store.boot() }) })));
}

export function describe(err) {
  if (!err || err.status === 0) return t("err.network");
  if (err.status === 401 || err.status === 403) return t("err.session");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || t("err.network");
}

function renderBanner() {
  const items = [];
  if (state.boot === "ready" && state.stream === "closed") {
    items.push(h("div", { class: "banner banner-needs", role: "status" }, icon("wifiOff", 20),
      h("span", { class: "banner-text", text: t("live.banner") }),
      button({ word: t("live.retry"), icon: "refresh", kind: "secondary", size: "sm", onClick: () => store.retryEvents() })));
  }
  fill(liveBanner, ...items);
}

function syncShell() {
  const b = state.business;
  setShop({ name: b && b.name ? b.name : "", stream: state.stream });
  let n = pendingApprovals().length;
  try { n += pendingInvoices().length; } catch { /* sell not loaded */ }
  setNeedsCount(n, "interim");
}

// Speaking from anywhere starts the call in place (no jump to another screen).
document.addEventListener("sahay:talk", (e) => {
  const mode = (e.detail && e.detail.mode) || "voice";
  if (e.detail && e.detail.hint) document.dispatchEvent(new CustomEvent("sahay:hint", { detail: { key: e.detail.hint } }));
  if (mode === "voice") startCall("voice");
});

setLogout(async () => {
  try { await store.logout(); } catch (err) { console.error(err); }
});

store.onEvent((evt) => {
  if (evt.type === "session.ended" && evt.data && evt.data.kind === "owner") serverEnded(evt.data.channel, evt.data.reason);
});

store.subscribe((s, parts) => {
  if (parts.has("boot")) renderBoot();
  if (parts.has("lang")) {
    for (const sc of screens.values()) sc.update(s, new Set(["all"]));
    if (authView && authView.update) authView.update();
    if (state.boot !== "ready") renderBoot();
  }
  if (state.boot === "ready") {
    for (const [id, sc] of screens) if (!sc.el.hidden || id === route) sc.update(s, parts);
    if (parts.has("lang")) setTitle(titleFor(parseRoute(location.hash)));
  }
  syncShell();
  if (parts.has("stream") || parts.has("boot") || parts.has("lang")) renderBanner();
});

window.addEventListener("hashchange", () => {
  if (state.boot !== "ready") { if (authView && authView.show && /^#\/(signup|login)/.test(location.hash)) authView.show(authMode()); return; }
  go();
  const s = screens.get(route);
  if (s) s.update(state, new Set(["all"]));
});

// UI language: this device's choice, English by default; any change re-renders every screen.
setLang(uiLang());
onLang(() => store.touch("lang"));
setRoute(parseRoute(location.hash).id);
syncShell();
renderBoot();
store.boot();
preload();
