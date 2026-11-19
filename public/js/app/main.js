// Sahay app shell: boot (account -> session -> state -> live events), hash router (#/talk default,
// #/buy, #/sell, #/stock, #/money, #/me, #/history; #/signup and #/login before a shop exists),
// floating pill nav, edge orb and the floating layers. Screen switches use View Transitions where
// the browser has them (nav and edge orb stay put), a short fade otherwise.

import { h, $, fill } from "./dom.js";
import { t, setLang } from "./i18n.js";
import * as store from "./store.js";
import { state } from "./store.js";
import { createNav } from "./nav.js";
import { createEdgeOrb } from "./edge-orb.js";
import { stateView, loadingView } from "./empty.js";
import { startCall, endCall, setMode, serverEnded, preload } from "./call.js";
import { SCREENS, ALIASES } from "./screens.js";
import "./store-sell.js";
import { createWelcome } from "./welcome.js";
import { createYesLayer } from "./yes-card.js";
import { agentState } from "./activity.js";

const app = $("#app");
const main = h("main", { id: "main", tabindex: "-1" });
const banner = h("div", { class: "banner-slot", "aria-live": "polite" });
const { nav, top, update: updateNav, setAgent } = createNav();
const edge = createEdgeOrb({ onAction: edgeAction });
const yes = createYesLayer();
app.append(top, banner, main, nav, edge.el, yes.el);

const screens = new Map();
let route = null;
let welcome = null;

function currentRoute() {
  const m = /^#\/([a-z]+)/.exec(location.hash || "");
  const raw = m ? m[1] : "talk";
  const id = ALIASES[raw] || raw;
  return SCREENS[id] ? id : "talk";
}

/** Run a DOM swap inside a view transition when the browser supports it and motion is welcome. */
function transition(swap) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce || document.visibilityState !== "visible") { swap(); return; }
  try { document.startViewTransition(swap); } catch { swap(); }
}

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

function go() {
  const next = currentRoute();
  if (state.boot !== "ready") { route = next; return; }
  if (next === route && screens.has(next) && !screens.get(next).el.hidden) return;
  const prev = route && screens.get(route);
  const s = screen(next);
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
  route = next;
  if (s.enter) s.enter();
  updateNav(route);
  document.title = `${t(`nav.${next}`)} | ${t("app.name")}`;
  if (prev && prev !== s) main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function renderBoot() {
  document.body.dataset.boot = state.boot;
  $(".skip-link").textContent = t("skip");
  if (state.boot === "ready") {
    if (welcome) { welcome.el.remove(); welcome = null; }
    for (const el of main.querySelectorAll(":scope > .boot-view")) el.remove();
    go();
    return;
  }
  for (const s of screens.values()) s.el.hidden = true;
  for (const el of main.querySelectorAll(":scope > .boot-view")) el.remove();
  if (state.boot === "welcome") {
    if (!welcome) { welcome = createWelcome(); app.append(welcome.el); }
    welcome.update();
    return;
  }
  if (welcome) { welcome.el.remove(); welcome = null; }
  const view = state.boot === "loading"
    ? loadingView(t("boot.loading"))
    : stateView({ kind: "error", title: t("boot.error"), text: describe(state.bootError), action: { label: t("retry"), run: () => store.boot() } });
  main.append(h("div", { class: "boot-view" }, view));
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
    items.push(h("div", { class: "toast toast-warn", role: "status" },
      h("span", { text: t("live.banner") }),
      h("button", { class: "btn btn-ghost btn-sm", type: "button", text: t("live.retry"), on: { click: () => store.retryEvents() } })));
  }
  fill(banner, ...items);
}

function edgeAction(id) {
  if (id === "talk") { location.hash = "#/talk"; setMode("voice"); startCall("voice"); }
  else if (id === "type") { location.hash = "#/talk"; setMode("text"); document.dispatchEvent(new CustomEvent("sahay:focus-type")); }
  else if (id === "need") { location.hash = "#/talk"; document.dispatchEvent(new CustomEvent("sahay:hint", { detail: { key: "talk.hint" } })); startCall("voice"); }
  else if (id === "approve") yes.openFirst();
  else if (id === "pause") endCall();
}

document.addEventListener("sahay:talk", (e) => {
  const mode = (e.detail && e.detail.mode) || "voice";
  if (e.detail && e.detail.hint) document.dispatchEvent(new CustomEvent("sahay:hint", { detail: { key: e.detail.hint } }));
  if (mode === "voice") startCall("voice");
});

store.onEvent((evt) => {
  if (evt.type === "session.ended" && evt.data && evt.data.kind === "owner") serverEnded(evt.data.channel, evt.data.reason);
});

store.subscribe((s, parts) => {
  if (parts.has("lang") || parts.has("business") || parts.has("agent")) {
    const L = store.ownerLanguage();
    if (L) setLang(L);
  }
  if (parts.has("boot")) renderBoot();
  if (parts.has("lang")) {
    // Language changed: rebuild every mounted screen in the new language.
    for (const sc of screens.values()) sc.update(s, new Set(["all"]));
    if (welcome) welcome.update();
    renderBoot();
  }
  if (state.boot === "ready") {
    updateNav(route);
    for (const [id, sc] of screens) if (!sc.el.hidden || id === route) sc.update(s, parts);
  }
  edge.update();
  setAgent(agentState());
  yes.update(parts);
  if (parts.has("stream") || parts.has("boot") || parts.has("lang")) renderBanner();
});

window.addEventListener("hashchange", () => {
  go();
  // A screen that was hidden missed partial updates: refresh it whole.
  const s = screens.get(route);
  if (s) s.update(state, new Set(["all"]));
});

setLang(navigator.language || "en-IN");
updateNav(currentRoute());
edge.update();
renderBoot();
store.boot();
preload();
