// Shop details / GST (UI v5): one sheet where the owner says how the shop bills (three choices: no
// GST, registered, composition), its GST number, its state (a searchable list inside the sheet, no
// native select) and, if they like, its address. Save -> POST /api/sell/settings (store-sell.js
// saveShopSettings); a refusal shows the server's own `say`. Opened from Sell ("Your shop", the
// "add your shop details" card) and from a bill refused with GSTIN_REQUIRED / STATE_REQUIRED.
// Rules without DOM: shop-facts.js (node:test). Styles: css/sell.css.

import { h, icon, scripted, button, field, errorLine, skeleton, emptyState, openSheet, card } from "./ui.js";
import { t, lang, addStrings } from "./i18n.js";
import { sell, loadSell, saveShopSettings } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import {
  SCHEMES, stateLabel, stateIsNative, cleanGstin, gstinProblem, stateOfGstin,
  needsGstin, missingFact, formProblems, settingsBody, findStates,
} from "./shop-facts.js";

addStrings({
  "shop.title": ["Your shop", "आपकी दुकान", "ನಿಮ್ಮ ಅಂಗಡಿ"],
  "shop.link": ["Your shop", "आपकी दुकान", "ನಿಮ್ಮ ಅಂಗಡಿ"],
  "shop.intro": ["Sahay prints these on every bill.", "सहाय यह हर बिल पर छापती है।", "ಸಹಾಯ್ ಇದನ್ನು ಪ್ರತಿ ಬಿಲ್‌ನಲ್ಲಿ ಮುದ್ರಿಸುತ್ತದೆ."],
  "shop.how": ["How do you bill?", "आप बिल कैसे बनाते हैं?", "ನೀವು ಬಿಲ್ ಹೇಗೆ ಮಾಡುತ್ತೀರಿ?"],
  "shop.scheme.unregistered": ["No GST", "GST नहीं", "GST ಇಲ್ಲ"],
  "shop.scheme.regular": ["GST registered", "GST रजिस्टर्ड", "GST ನೋಂದಾಯಿತ"],
  "shop.scheme.composition": ["GST composition", "GST कंपोज़िशन", "GST ಕಾಂಪೋಸಿಷನ್"],
  "shop.paper.unregistered": ["Plain bill", "सादा बिल", "ಸಾದಾ ಬಿಲ್"],
  "shop.paper.regular": ["Tax invoice", "टैक्स इनवॉइस", "ಟ್ಯಾಕ್ಸ್ ಇನ್‌ವಾಯ್ಸ್"],
  "shop.paper.composition": ["Bill of supply", "बिल ऑफ़ सप्लाई", "ಬಿಲ್ ಆಫ್ ಸಪ್ಲೈ"],
  "shop.gstin": ["GST number", "GST नंबर", "GST ಸಂಖ್ಯೆ"],
  "shop.gstinHelp": ["15 letters and digits, from your GST certificate.", "15 अक्षर और अंक, आपके GST प्रमाणपत्र से।", "15 ಅಕ್ಷರ ಮತ್ತು ಅಂಕೆ, ನಿಮ್ಮ GST ಪ್ರಮಾಣಪತ್ರದಿಂದ."],
  "shop.gstinNeed": ["Type your 15-character GST number.", "अपना 15 अक्षर का GST नंबर लिखिए।", "ನಿಮ್ಮ 15 ಅಕ್ಷರದ GST ಸಂಖ್ಯೆ ಬರೆಯಿರಿ."],
  "shop.gstinShort": ["A GST number has 15 characters. Check the missing ones.", "GST नंबर में 15 अक्षर होते हैं। छूटे हुए अक्षर देखिए।", "GST ಸಂಖ್ಯೆಯಲ್ಲಿ 15 ಅಕ್ಷರ ಇರುತ್ತವೆ. ಬಿಟ್ಟುಹೋದವನ್ನು ನೋಡಿ."],
  "shop.gstinShape": ["Check the GST number: it starts with your state's 2 digits, as on your certificate.", "GST नंबर जाँचिए: यह आपके राज्य के 2 अंकों से शुरू होता है, जैसा प्रमाणपत्र पर है।", "GST ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ: ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿರುವಂತೆ ನಿಮ್ಮ ರಾಜ್ಯದ 2 ಅಂಕೆಗಳಿಂದ ಶುರುವಾಗುತ್ತದೆ."],
  "shop.state": ["State", "राज्य", "ರಾಜ್ಯ"],
  "shop.statePick": ["Choose your state", "अपना राज्य चुनिए", "ನಿಮ್ಮ ರಾಜ್ಯ ಆಯ್ಕೆಮಾಡಿ"],
  "shop.stateNeed": ["Choose the state your shop is in.", "दुकान किस राज्य में है, चुनिए।", "ಅಂಗಡಿ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ ಎಂದು ಆಯ್ಕೆಮಾಡಿ."],
  "shop.stateFromGstin": ["from your GST number", "आपके GST नंबर से", "ನಿಮ್ಮ GST ಸಂಖ್ಯೆಯಿಂದ"],
  "shop.stateSearch": ["Search a state", "राज्य खोजिए", "ರಾಜ್ಯ ಹುಡುಕಿ"],
  "shop.stateNone": ["No state matches this. Check the spelling.", "इस नाम का कोई राज्य नहीं मिला। स्पेलिंग देखिए।", "ಈ ಹೆಸರಿನ ರಾಜ್ಯ ಸಿಗಲಿಲ್ಲ. ಕಾಗುಣಿತ ನೋಡಿ."],
  "shop.stateClear": ["Clear search", "खोज हटाएँ", "ಹುಡುಕಾಟ ಅಳಿಸಿ"],
  "shop.back": ["Back", "वापस", "ಹಿಂದೆ"],
  "shop.address": ["Shop address (if you like)", "दुकान का पता (चाहें तो)", "ಅಂಗಡಿ ವಿಳಾಸ (ಬೇಕಿದ್ದರೆ)"],
  "shop.addressHelp": ["Printed on your bills.", "आपके बिल पर छपेगा।", "ನಿಮ್ಮ ಬಿಲ್‌ನಲ್ಲಿ ಮುದ್ರಿಸಲಾಗುತ್ತದೆ."],
  "shop.save": ["Save", "सेव करें", "ಉಳಿಸಿ"],
  "shop.saving": ["Saving the shop details", "दुकान की जानकारी सेव हो रही है", "ಅಂಗಡಿ ವಿವರ ಉಳಿಸಲಾಗುತ್ತಿದೆ"],
  "shop.saved": ["Saved", "सेव हो गया", "ಉಳಿಸಲಾಗಿದೆ"],
  "shop.saveFail": ["The shop details were not saved.", "दुकान की जानकारी सेव नहीं हुई।", "ಅಂಗಡಿ ವಿವರ ಉಳಿಯಲಿಲ್ಲ."],
  "shop.fixFirst": ["Fix the marked box, then press Save.", "निशान वाला खाना ठीक करके सेव दबाइए।", "ಗುರುತಿಸಿದ ಪೆಟ್ಟಿಗೆ ಸರಿಪಡಿಸಿ, ನಂತರ ಉಳಿಸಿ ಒತ್ತಿ."],
  "shop.need.title": ["Add your shop details to make GST bills", "GST बिल के लिए दुकान की जानकारी डालें", "GST ಬಿಲ್‌ಗೆ ಅಂಗಡಿ ವಿವರ ಸೇರಿಸಿ"],
  "shop.need.GSTIN_REQUIRED": [
    "Add your shop's GST number, or choose No GST.",
    "दुकान का GST नंबर डालिए, या 'GST नहीं' चुनिए।",
    "ಅಂಗಡಿಯ GST ಸಂಖ್ಯೆ ಹಾಕಿ, ಅಥವಾ 'GST ಇಲ್ಲ' ಆಯ್ಕೆಮಾಡಿ.",
  ],
  "shop.need.STATE_REQUIRED": [
    "Add the state your shop is in.",
    "दुकान का राज्य डालिए।",
    "ಅಂಗಡಿಯ ರಾಜ್ಯ ಹಾಕಿ.",
  ],
  "shop.add": ["Add shop details", "दुकान की जानकारी डालें", "ಅಂಗಡಿ ವಿವರ ಹಾಕಿ"],
});

const SCHEME_ICON = { unregistered: "receipt", regular: "shield", composition: "tag" };
const schemeWord = (scheme) => st(`shop.scheme.${scheme}`);
const errText = (err, fallback) => (err && (err.say || (err.status === 0 ? t("err.network") : err.status === 429 ? t("err.limit") : null))) || fallback;

/** A state name with lang= when it is shown in the owner's script. */
function stateText(tag, code, props = {}) {
  const L = lang();
  return h(tag, { ...props, lang: stateIsNative(code, L) ? L : undefined, text: stateLabel(code, L) || "" });
}

/* -------------------------------------------------------------- the sheet -- */

/** Open the Your shop sheet; `opener` gets focus back when it closes. */
export function openShopSheet({ opener = null } = {}) {
  const api = openSheet({ title: st("shop.title"), body: skeleton("lines", 4), opener });
  show(api);
  return api;
}

async function show(api) {
  if (sell.status !== "ready" || !sell.settings) {
    api.setBody(skeleton("lines", 4));
    await loadSell();
  }
  if (!api.isOpen()) return;
  if (sell.status === "ready" && sell.settings) { form(sell.settings, api); return; }
  const retry = { word: t("retry"), icon: "refresh", onClick: () => show(api) };
  if (sell.status === "missing") { api.setBody(emptyState({ icon: "info", title: st("sbx.missing.title"), text: st("sbx.missing.sell"), action: retry })); return; }
  api.setBody(emptyState({ icon: "alert", title: st("sbx.err.loadTitle"), text: errText(sell.error, st("sbx.err.load")), action: retry }));
}

function form(saved, api) {
  const L = lang();
  const f = { scheme: saved.gstScheme, gstin: cleanGstin(saved.gstin || ""), state: saved.stateCode || "", address: saved.address || "", busy: false };

  /* ---- how you bill: three choices, a radio group ---- */
  const choices = SCHEMES.map((scheme) => h("button", {
    class: "shop-choice", type: "button", role: "radio", "aria-checked": String(f.scheme === scheme),
    tabindex: f.scheme === scheme ? "0" : "-1", dataset: { scheme },
    on: { click: () => pick(scheme), keydown: (e) => roam(e, scheme) },
  },
  h("span", { class: "shop-choice-ico", "aria-hidden": "true" }, icon(SCHEME_ICON[scheme], 22)),
  h("span", { class: "shop-choice-text" }, h("span", { class: "shop-choice-word", text: schemeWord(scheme) }), h("span", { class: "shop-choice-sub", text: st(`shop.paper.${scheme}`) })),
  h("span", { class: "shop-choice-tick", "aria-hidden": "true" }, icon("check", 18))));
  function pick(scheme, focus = false) {
    f.scheme = scheme;
    for (const b of choices) {
      const on = b.dataset.scheme === scheme;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    sync();
  }
  function roam(e, scheme) {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    pick(SCHEMES[(SCHEMES.indexOf(scheme) + d + SCHEMES.length) % SCHEMES.length], true);
  }

  /* ---- GST number ---- */
  const gstin = field({
    label: st("shop.gstin"), value: f.gstin, help: st("shop.gstinHelp"), maxlength: "15", autocomplete: "off",
    validate: () => {
      if (!needsGstin(f.scheme)) return null;
      const p = gstinProblem(f.gstin);
      return p === "ok" ? null : st(p === "empty" ? "shop.gstinNeed" : p === "short" ? "shop.gstinShort" : "shop.gstinShape");
    },
    onInput: (v) => {
      const c = cleanGstin(v);
      if (c !== gstin.input.value) gstin.input.value = c;
      f.gstin = c;
      sync();
    },
  });
  gstin.input.classList.add("shop-gstin");
  gstin.input.setAttribute("autocapitalize", "characters");
  gstin.input.setAttribute("spellcheck", "false");

  /* ---- state: a row that opens the list inside this sheet ---- */
  const stateWord = h("span", { class: "row-title" });
  const stateErr = h("span", { class: "field-error", role: "alert", hidden: true });
  const pickBtn = h("button", { class: "row shop-pick", type: "button", on: { click: () => openPicker() } },
    h("span", { class: "row-ico", "aria-hidden": "true" }, icon("pin", 22)),
    h("span", { class: "row-main" }, h("span", { class: "row-sub", text: st("shop.state") }), stateWord),
    h("span", { class: "row-end" }, icon("chevronRight", 20, "row-chev")));
  const derived = h("p", { class: "note-line shop-derived" });
  const stateBox = h("div", { class: "field" }, pickBtn, derived, stateErr);

  const setStateErr = (on) => {
    stateErr.hidden = !on;
    stateErr.replaceChildren(...(on ? [icon("alert", 16), h("span", { text: st("shop.stateNeed") })] : []));
    pickBtn.toggleAttribute("aria-invalid", on);
  };

  /* ---- address ---- */
  const address = field({ label: st("shop.address"), value: f.address, help: st("shop.addressHelp"), multiline: true, maxlength: "300", autocomplete: "street-address", onInput: (v) => { f.address = v; } });

  /* ---- save ---- */
  const result = h("div", { class: "shop-result", "aria-live": "polite" });
  const save = button({ word: st("shop.save"), icon: "check", kind: "primary", block: true, onClick: () => submit() });

  function sync() {
    const gst = needsGstin(f.scheme);
    gstin.el.hidden = !gst;
    const fromGstin = gst ? stateOfGstin(f.gstin) : null;
    // A GSTIN's first two digits are its state: the list gives way to that fact.
    pickBtn.hidden = Boolean(fromGstin);
    derived.hidden = !fromGstin;
    if (fromGstin) { derived.replaceChildren(icon("checkCircle", 18), stateText("b", fromGstin), h("span", { text: ` ${st("shop.stateFromGstin")}` })); setStateErr(false); }
    if (f.state) stateWord.replaceChildren(stateText("span", f.state)); else stateWord.textContent = st("shop.statePick");
    pickBtn.classList.toggle("is-empty", !f.state);
  }

  async function submit() {
    if (f.busy) return;
    const problems = formProblems(f);
    const okGstin = !problems.gstin || gstin.validate();
    if (problems.state) setStateErr(true);
    if (!okGstin || problems.state) {
      result.replaceChildren(errorLine(st("shop.fixFirst")));
      (!okGstin ? gstin.el : stateBox).scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    f.busy = true;
    save.setAttribute("aria-busy", "true");
    result.replaceChildren(h("p", { class: "note-line" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: st("shop.saving") })));
    try {
      await saveShopSettings(settingsBody(f));
      result.replaceChildren(h("p", { class: "note-line shop-ok" }, icon("checkCircle", 18), h("span", { text: st("shop.saved") })));
      setTimeout(() => { if (api.isOpen()) api.close(); }, 900);
    } catch (err) {
      const text = err.say || errText(err, st("shop.saveFail"));
      if (err.code === "GSTIN_INVALID" && needsGstin(f.scheme)) gstin.setError(text);
      result.replaceChildren(errorLine(text));
    }
    f.busy = false;
    save.removeAttribute("aria-busy");
  }

  /* ---- the state list (search + rows), inside the sheet ---- */
  let formNodes = null;
  function openPicker() {
    const search = field({ label: st("shop.stateSearch"), autocomplete: "off", onInput: () => draw() });
    search.input.type = "search";
    search.input.setAttribute("autocapitalize", "none");
    search.input.classList.add("shop-search");
    const list = h("div", { class: "shop-states" });
    const back = () => { api.setBody(formNodes); api.setFooter([result, save]); requestAnimationFrame(() => pickBtn.focus()); };
    function draw() {
      const rows = findStates(search.input.value, L);
      if (!rows.length) {
        list.replaceChildren(emptyState({ inline: true, icon: "search", title: st("shop.stateNone"),
          action: { word: st("shop.stateClear"), icon: "x", onClick: () => { search.input.value = ""; draw(); search.input.focus(); } } }));
        return;
      }
      list.replaceChildren(h("ul", { class: "list" }, ...rows.map((r) => h("li", null, h("button", {
        class: "row", type: "button", "aria-pressed": String(r.code === f.state),
        on: { click: () => { f.state = r.code; setStateErr(false); sync(); back(); } },
      },
      h("span", { class: "row-main" }, h("span", { class: "row-title", lang: r.native ? L : undefined, text: r.label })),
      r.code === f.state ? h("span", { class: "row-end shop-state-tick" }, icon("check", 20)) : null)))));
    }
    search.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const first = list.querySelector("button.row");
      if (first) { e.preventDefault(); first.click(); }
    });
    draw();
    api.setFooter(null);
    api.setBody([
      button({ word: st("shop.back"), icon: "chevronLeft", kind: "ghost", size: "sm", onClick: back }),
      scripted("p", st("shop.statePick"), { class: "shop-picker-title" }),
      search.el,
      list,
    ]);
    requestAnimationFrame(() => search.input.focus());
  }

  sync();
  formNodes = [
    h("p", { class: "page-sentence", text: st("shop.intro") }),
    h("fieldset", { class: "shop-schemes" }, h("legend", { class: "field-label", text: st("shop.how") }),
      h("div", { class: "shop-choices", role: "radiogroup", "aria-label": st("shop.how") }, ...choices)),
    gstin.el,
    stateBox,
    address.el,
  ];
  api.setBody(formNodes);
  api.setFooter([result, save]);
}

/* ------------------------------------------------- pieces for the screens -- */

/** The missing fact in the loaded settings (null when a bill can be made, or not loaded yet). */
export const shopMissing = () => (sell.status === "ready" ? missingFact(sell.settings) : null);

/** The "Your shop" link (Sell's head). */
export function shopLink() {
  return button({ word: st("shop.link"), icon: "store", kind: "ghost", size: "sm", onClick: (e) => openShopSheet({ opener: e.currentTarget }) });
}

/**
 * The plain "add your shop details" card (Sell "Needs you", and inside a bill refused for it).
 * `code` is GSTIN_REQUIRED or STATE_REQUIRED; `say` is the server's own sentence when it sent one.
 */
export function shopNeedCard(code, say = null) {
  return card({
    needs: true,
    title: st("shop.need.title"),
    body: scripted("p", say || st(`shop.need.${code}`), { class: "card-sub" }),
    foot: button({ word: st("shop.add"), icon: "store", kind: "primary", size: "sm", onClick: (e) => openShopSheet({ opener: e.currentTarget }) }),
  });
}
