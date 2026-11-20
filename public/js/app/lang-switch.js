// UI language (brief v4 item 3): the app speaks ENGLISH by default; a visible, labelled switcher
// (globe + the current language's name; options English / हिन्दी / ಕನ್ನಡ, each in its own script)
// changes the words on screen for THIS device only. It is independent of the shop's voice language
// (the agent still detects the spoken language; My Sahay > Voice sets what Sahay speaks).
//
//   uiLang()                 -> "en" | "hi" | "kn" (saved choice, else "en")
//   setUiLang(code)          save on the device, switch the words, fire "sahay:ui-lang" { lang }
//   createLangSwitch({ compact }) -> { el, update() }   the button + popover; follows onLang itself
//
// Markup for pages without this module (landing): the same classes
//   <button class="lang-switch" aria-haspopup="menu"><svg globe/><span class="lang-switch-name">English</span><svg chevron/></button>
// and a menu of <button class="popover-item" role="menuitemradio" lang="hi">हिन्दी</button> inside .popover.glass.

import { h, icon } from "./dom.js";
import { t, lang, setLang, onLang, LANGS } from "./i18n.js";
import { openPopover } from "./menu.js";

export const UI_LANG_KEY = "sahay-ui-lang";
const NAMES = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const CODES = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

export function uiLang() {
  let v = null;
  try { v = localStorage.getItem(UI_LANG_KEY); } catch { /* storage blocked */ }
  return v === "hi" || v === "kn" || v === "en" ? v : "en";
}

export function setUiLang(code) {
  const short = String(code || "en").slice(0, 2).toLowerCase();
  const next = NAMES[short] ? short : "en";
  try { localStorage.setItem(UI_LANG_KEY, next); } catch { /* storage blocked: this visit only */ }
  setLang(CODES[next]);
  document.dispatchEvent(new CustomEvent("sahay:ui-lang", { detail: { lang: next } }));
}

export function createLangSwitch({ compact = false } = {}) {
  const name = h("span", { class: "lang-switch-name" });
  const btn = h("button", { class: `lang-switch${compact ? " lang-switch-compact" : ""}`, type: "button", "aria-haspopup": "menu", "aria-expanded": "false" },
    icon("globe", 20), name, icon("chevronDown", 18, "lang-switch-caret"));
  btn.addEventListener("click", () => {
    const cur = lang();
    openPopover({
      anchor: btn,
      label: t("shell.lang"),
      items: LANGS.map((L) => ({ id: L.short, label: NAMES[L.short], lang: L.short, current: L.short === cur })),
      onPick: async (id) => { setUiLang(id); },
    });
  });
  function update() {
    const cur = lang();
    name.textContent = NAMES[cur] || NAMES.en;
    name.setAttribute("lang", cur);
    btn.setAttribute("aria-label", `${t("shell.lang")}: ${NAMES[cur] || NAMES.en}`);
  }
  update();
  onLang(update);
  return { el: btn, update };
}
