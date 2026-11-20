// The v5 app shell: a slim top bar and, on phones, a bottom tab bar. No sidebars, no side columns.
//   Laptop / tablet (900px+): [logo + "Sahay"] [Home Buy Sell Stock Money] [language] [Needs you (n)] [account]
//   Phone: top [logo] [language] [account] + the automated-assistant line under it; bottom: 5 tabs, 64px.
// The automated-assistant notice is visible on every screen (small, in the bar). Contract: css/README.md.
//
//   mountShell(appEl) -> slots { main, needsHost, toastRegion, bannerSlot }
//   setRoute(id), setNeedsCount(n, source?), onNeeds(fn), setTitle(text), setShop({ name, stream }), navigate(hash)

import { h, icon, scripted, fill, langSwitch, brandMark, openMenu, initialsOf } from "./ui.js";
import { t, onLang, addStrings } from "./i18n.js";
import { TABS } from "./routes.js";
import "./shell-strings.js";

addStrings({
  "nav.home": ["Home", "होम", "ಮುಖಪುಟ"],
  "app.notice": ["Sahay is an automated assistant", "सहाय एक स्वचालित सहायक है", "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"],
  "app.noticeShort": ["Automated assistant", "स्वचालित सहायक", "ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ"],
  "app.needs": ["Needs you", "आपकी हाँ चाहिए", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಬೇಕು"],
  "app.needsLong": ["{n} things need your yes. Open them.", "{n} काम आपकी हाँ चाहते हैं। खोलें।", "{n} ಕೆಲಸಗಳಿಗೆ ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಬೇಕು. ತೆರೆಯಿರಿ."],
  "app.account": ["Account", "खाता", "ಖಾತೆ"],
  "app.logout": ["Log out", "लॉग आउट", "ಲಾಗ್ ಔಟ್"],
  "app.logoutFail": ["Could not log out. Try again.", "लॉग आउट नहीं हुआ। फिर कोशिश करें।", "ಲಾಗ್ ಔಟ್ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "app.tabs": ["Main", "मुख्य", "ಮುಖ್ಯ"],
});

const TAB_ICON = { home: "home", buy: "cart", sell: "receipt", stock: "box", money: "wallet" };
const TAB_KEY = { home: "nav.home", buy: "nav.buy", sell: "nav.sell", stock: "nav.stock", money: "nav.money" };

let route = "home";
let needs = 0;
let needsClaimed = false;
let shopName = "";
let stream = "connecting";
let logoutFn = null;
const needsListeners = new Set();

/* ------------------------------------------------------------- top bar -- */
const lang = langSwitch();
const needsBtn = h("button", { class: "needs-btn", type: "button", hidden: true },
  h("span", { class: "needs-dot", "aria-hidden": "true" }), h("span", { class: "needs-word" }), h("span", { class: "needs-n num" }));
needsBtn.addEventListener("click", () => openNeeds());
const account = h("button", { class: "account-btn", type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
  h("span", { class: "account-ini" }), icon("userCircle", 22, "account-ico"));
account.addEventListener("click", () => openMenu({
  anchor: account, label: t("app.account"),
  items: [
    { id: "me", label: t("nav.me"), icon: "user" },
    { id: "shop", label: t("shell.menuShop"), icon: "store" },
    { id: "history", label: t("nav.history"), icon: "history" },
    { sep: true },
    { id: "logout", label: t("app.logout"), icon: "logout" },
  ],
  onPick: (id) => {
    if (id === "me") navigate("#/me");
    else if (id === "shop") navigate("#/me/shop");
    else if (id === "history") navigate("#/me/history");
    else if (id === "logout" && logoutFn) logoutFn();
  },
}));
const live = h("span", { class: "live-dot", "aria-hidden": "true" });
const notice = h("p", { class: "notice", role: "note" }, icon("robot", 16), h("span", { class: "notice-text" }), live);

const tabsTop = h("nav", { class: "tabs-top" }, ...TABS.map((id) => tab(id, "tab")));
const tabbar = h("nav", { class: "tabbar" }, ...TABS.map((id) => tab(id, "tabbar-item")));

function tab(id, cls) {
  return h("a", { class: cls, href: `#/${id}`, dataset: { route: id } },
    h("span", { class: `${cls}-ico`, "aria-hidden": "true" }, icon(TAB_ICON[id], cls === "tab" ? 20 : 24), h("span", { class: "badge tab-badge", hidden: true })),
    h("span", { class: `${cls}-word` }));
}

const topbar = h("header", { class: "topbar" },
  h("div", { class: "topbar-in" },
    brandMark({ word: true }),
    tabsTop,
    h("div", { class: "topbar-end" }, notice, lang.el, needsBtn, account)));
// Under 1280px the notice sits on its own thin line under the bar (moved by CSS order, same element).

const main = h("main", { id: "main", tabindex: "-1" });
const bannerSlot = h("div", { class: "banner-slot", "aria-live": "polite" });
const needsHost = h("div", { class: "needs-host" });
const toastRegion = h("div", { class: "toast-region" });
const sheetHost = h("div", { class: "sheet-host" });
export const slots = { main, needsHost, toastRegion, bannerSlot };

export function mountShell(app) {
  app.append(topbar, h("div", { class: "page" }, bannerSlot, main), tabbar);
  document.body.append(needsHost, toastRegion, sheetHost);
  watchOnline();
  render();
  return slots;
}

/* ------------------------------------------------------------- offline -- */
let offlineBanner = null;
function watchOnline() {
  const sync = () => {
    if (navigator.onLine === false) {
      if (!offlineBanner) {
        offlineBanner = h("div", { class: "banner banner-warn", role: "status" }, icon("wifiOff", 20), h("span", { class: "banner-text" }));
        bannerSlot.prepend(offlineBanner);
      }
      offlineBanner.querySelector(".banner-text").textContent = t("shell.offline");
    } else if (offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
    render();
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
}

/* -------------------------------------------------------------- render -- */
function render() {
  for (const nav of [tabsTop, tabbar]) {
    nav.setAttribute("aria-label", t("app.tabs"));
    for (const a of nav.querySelectorAll("a[data-route]")) {
      const id = a.dataset.route;
      a.querySelector("[class$='-word']").textContent = t(TAB_KEY[id]);
      if (id === route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      const b = a.querySelector(".tab-badge");
      const n = id === "home" ? needs : 0;
      b.hidden = n <= 0;
      b.textContent = n > 9 ? "9+" : String(n);
      a.setAttribute("aria-label", n > 0 ? `${t(TAB_KEY[id])}, ${t("app.needsLong", { n })}` : t(TAB_KEY[id]));
    }
  }
  needsBtn.hidden = needs <= 0;
  needsBtn.querySelector(".needs-word").textContent = t("app.needs");
  needsBtn.querySelector(".needs-n").textContent = `(${needs})`;
  needsBtn.setAttribute("aria-label", t("app.needsLong", { n: needs }));
  const ini = initialsOf(shopName);
  account.querySelector(".account-ini").textContent = ini;
  account.classList.toggle("has-ini", Boolean(ini));
  account.setAttribute("aria-label", t("app.account"));
  if (route === "me") account.setAttribute("aria-current", "page"); else account.removeAttribute("aria-current");
  notice.querySelector(".notice-text").textContent = t("app.notice");
  live.dataset.state = navigator.onLine === false ? "offline" : stream;
}
onLang(render);

function openNeeds() {
  for (const fn of needsListeners) { try { fn(); } catch (err) { console.error(err); } }
  document.dispatchEvent(new CustomEvent("sahay:open-needs"));
}

/* ----------------------------------------------------------------- API -- */
export function setRoute(id) { route = id; document.documentElement.dataset.route = id || ""; render(); }
/** The "Needs you (n)" count. The Yes-card owner (W3) calls it; main.js only fills in until then. */
export function setNeedsCount(n, source = "owner") {
  if (source === "interim" && needsClaimed) return;
  if (source !== "interim") needsClaimed = true;
  const v = Math.max(0, Number(n) || 0);
  if (v === needs) return;
  needs = v;
  render();
}
export function onNeeds(fn) { needsListeners.add(fn); return () => needsListeners.delete(fn); }
export function openNeedsHost() { openNeeds(); }
export function setTitle(text) { const app = t("app.name"); document.title = text && text !== app ? `${text} · ${app}` : app; }
export function setShop({ name, stream: s } = {}) {
  if (name !== undefined) shopName = name || "";
  if (s !== undefined) stream = s || "connecting";
  render();
}
export function setLogout(fn) { logoutFn = fn; }
export function navigate(hash) { if (location.hash !== hash) location.hash = hash; }
export { fill, scripted };
