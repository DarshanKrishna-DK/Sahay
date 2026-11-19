// Shop details / GST: the sheet where the owner says how the shop bills (three big tiles: no GST,
// registered, composition), its GST number, its state and, if they like, its address.
// Save -> POST /api/sell/settings (store-sell.js saveShopSettings); a refusal shows the server's
// own `say`. Opened from My Sahay and from the Sell screen when a bill needs a missing fact
// (GSTIN_REQUIRED / STATE_REQUIRED). Also exports the small summary and "needs" card those
// screens show.

import { h, icon } from "./dom.js";
import { t, lang, addStrings } from "./i18n.js";
import { openSheet, closeSheet } from "./sheet.js";
import { stateView, loadingView } from "./empty.js";
import { sell, loadSell, saveShopSettings } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { readButton } from "./sell-kit.js";
import {
  SCHEMES, statesFor, stateLabel, stateIsNative, cleanGstin, gstinProblem, stateOfGstin,
  needsGstin, missingFact, formProblems, settingsBody,
} from "./shop-facts.js";

addStrings({
  "shop.title": ["Shop details", "दुकान की जानकारी", "ಅಂಗಡಿ ವಿವರ"],
  "shop.open": ["Shop details", "दुकान की जानकारी", "ಅಂಗಡಿ ವಿವರ"],
  "shop.add": ["Add shop details", "दुकान की जानकारी डालें", "ಅಂಗಡಿ ವಿವರ ಹಾಕಿ"],
  "shop.change": ["Change", "बदलें", "ಬದಲಿಸಿ"],
  "shop.how": ["How do you bill?", "आप बिल कैसे बनाते हैं?", "ನೀವು ಬಿಲ್ ಹೇಗೆ ಮಾಡುತ್ತೀರಿ?"],
  "shop.scheme.unregistered": ["No GST", "GST नहीं", "GST ಇಲ್ಲ"],
  "shop.scheme.regular": ["Registered", "रजिस्टर्ड", "ನೋಂದಾಯಿತ"],
  "shop.scheme.composition": ["Composition", "कंपोज़िशन", "ಕಾಂಪೋಸಿಷನ್"],
  "shop.paper.unregistered": ["Plain bill", "सादा बिल", "ಸಾದಾ ಬಿಲ್"],
  "shop.gstin": ["GST number", "GST नंबर", "GST ಸಂಖ್ಯೆ"],
  "shop.gstinHelp": ["15 letters and digits, from your GST certificate.", "15 अक्षर और अंक, आपके GST प्रमाणपत्र से।", "15 ಅಕ್ಷರ ಮತ್ತು ಅಂಕೆ, ನಿಮ್ಮ GST ಪ್ರಮಾಣಪತ್ರದಿಂದ."],
  "shop.gstinCount": ["{n} of 15", "15 में से {n}", "15 ರಲ್ಲಿ {n}"],
  "shop.gstinNeed": ["Type your 15-character GST number.", "अपना 15 अक्षर का GST नंबर लिखिए।", "ನಿಮ್ಮ 15 ಅಕ್ಷರದ GST ಸಂಖ್ಯೆ ಬರೆಯಿರಿ."],
  "shop.gstinShort": ["A GST number has 15 characters. Check the missing ones.", "GST नंबर में 15 अक्षर होते हैं। छूटे हुए अक्षर देखिए।", "GST ಸಂಖ್ಯೆಯಲ್ಲಿ 15 ಅಕ್ಷರ ಇರುತ್ತವೆ. ಬಿಟ್ಟುಹೋದವನ್ನು ನೋಡಿ."],
  "shop.gstinShape": ["Check the GST number: it starts with your state's 2 digits, as on your certificate.", "GST नंबर जाँचिए: यह आपके राज्य के 2 अंकों से शुरू होता है, जैसा प्रमाणपत्र पर है।", "GST ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ: ಪ್ರಮಾಣಪತ್ರದಲ್ಲಿರುವಂತೆ ನಿಮ್ಮ ರಾಜ್ಯದ 2 ಅಂಕೆಗಳಿಂದ ಶುರುವಾಗುತ್ತದೆ."],
  "shop.state": ["State", "राज्य", "ರಾಜ್ಯ"],
  "shop.statePick": ["Choose your state", "अपना राज्य चुनिए", "ನಿಮ್ಮ ರಾಜ್ಯ ಆಯ್ಕೆಮಾಡಿ"],
  "shop.stateNeed": ["Choose the state your shop is in.", "दुकान किस राज्य में है, चुनिए।", "ಅಂಗಡಿ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ ಎಂದು ಆಯ್ಕೆಮಾಡಿ."],
  "shop.stateFromGstin": ["From your GST number", "आपके GST नंबर से", "ನಿಮ್ಮ GST ಸಂಖ್ಯೆಯಿಂದ"],
  "shop.address": ["Shop address", "दुकान का पता", "ಅಂಗಡಿ ವಿಳಾಸ"],
  "shop.optional": ["if you like", "चाहें तो", "ಬೇಕಿದ್ದರೆ"],
  "shop.addressHelp": ["Printed on your bills.", "आपके बिल पर छपेगा।", "ನಿಮ್ಮ ಬಿಲ್‌ನಲ್ಲಿ ಮುದ್ರಿಸಲಾಗುತ್ತದೆ."],
  "shop.save": ["Save", "सेव करें", "ಉಳಿಸಿ"],
  "shop.saving": ["Saving the shop details", "दुकान की जानकारी सेव हो रही है", "ಅಂಗಡಿ ವಿವರ ಉಳಿಸಲಾಗುತ್ತಿದೆ"],
  "shop.saved": ["Saved", "सेव हो गया", "ಉಳಿಸಲಾಗಿದೆ"],
  "shop.saveFail": ["The shop details were not saved.", "दुकान की जानकारी सेव नहीं हुई।", "ಅಂಗಡಿ ವಿವರ ಉಳಿಯಲಿಲ್ಲ."],
  "shop.fixFirst": ["Fix the marked box, then press Save.", "निशान वाला खाना ठीक करके सेव दबाइए।", "ಗುರುತಿಸಿದ ಪೆಟ್ಟಿಗೆ ಸರಿಪಡಿಸಿ, ನಂತರ ಉಳಿಸಿ ಒತ್ತಿ."],
  "shop.noState": ["State not added", "राज्य नहीं डाला", "ರಾಜ್ಯ ಹಾಕಿಲ್ಲ"],
  "shop.noGstin": ["GST number not added", "GST नंबर नहीं डाला", "GST ಸಂಖ್ಯೆ ಹಾಕಿಲ್ಲ"],
  "shop.need.title": ["Bills need your shop details", "बिल के लिए दुकान की जानकारी चाहिए", "ಬಿಲ್‌ಗೆ ಅಂಗಡಿ ವಿವರ ಬೇಕು"],
  "shop.need.GSTIN_REQUIRED": [
    "Add your shop's GST number before making a GST bill, or choose No GST.",
    "GST बिल से पहले दुकान का GST नंबर डालिए, या 'GST नहीं' चुनिए।",
    "GST ಬಿಲ್ ಮಾಡುವ ಮೊದಲು ಅಂಗಡಿಯ GST ಸಂಖ್ಯೆ ಹಾಕಿ, ಅಥವಾ 'GST ಇಲ್ಲ' ಆಯ್ಕೆಮಾಡಿ.",
  ],
  "shop.need.STATE_REQUIRED": [
    "Add the state your shop is in before making a bill.",
    "बिल बनाने से पहले दुकान का राज्य डालिए।",
    "ಬಿಲ್ ಮಾಡುವ ಮೊದಲು ಅಂಗಡಿಯ ರಾಜ್ಯ ಹಾಕಿ.",
  ],
  "shop.sayHelp": [
    "Shop details. Choose how you bill: No GST, Registered, or Composition. Then choose your state and press Save.",
    "दुकान की जानकारी। चुनिए आप बिल कैसे बनाते हैं: GST नहीं, रजिस्टर्ड, या कंपोज़िशन। फिर अपना राज्य चुनकर सेव दबाइए।",
    "ಅಂಗಡಿ ವಿವರ. ನೀವು ಬಿಲ್ ಹೇಗೆ ಮಾಡುತ್ತೀರಿ ಆಯ್ಕೆಮಾಡಿ: GST ಇಲ್ಲ, ನೋಂದಾಯಿತ, ಅಥವಾ ಕಾಂಪೋಸಿಷನ್. ನಂತರ ನಿಮ್ಮ ರಾಜ್ಯ ಆಯ್ಕೆಮಾಡಿ ಉಳಿಸಿ ಒತ್ತಿ.",
  ],
  "shop.sayNow": ["Now: {scheme}, {state}.", "अभी: {scheme}, {state}।", "ಈಗ: {scheme}, {state}."],
});

const SCHEME_ICON = { unregistered: "receipt", regular: "shield", composition: "tag" };
/** The paper the customer gets for each scheme (src/sell/gst.js KIND_BY_SCHEME). */
const PAPER_KEY = { unregistered: "shop.paper.unregistered", regular: "sell.kind.tax_invoice", composition: "sell.kind.bill_of_supply" };

const schemeWord = (scheme) => st(`shop.scheme.${scheme}`);
const stateWord = (code) => stateLabel(code, lang()) || st("shop.noState");

/** A state name with lang= when it is shown in the owner's script. */
function stateText(tag, code, props = {}) {
  const L = lang();
  return h(tag, { ...props, lang: stateIsNative(code, L) ? L : undefined, text: stateWord(code) });
}

/* -------------------------------------------------------------- the sheet -- */

/** Open the Shop details sheet; `opener` gets focus back when it closes. */
export function openShopSheet({ opener = null } = {}) {
  const api = openSheet({ title: st("shop.title"), body: loadingView(st("sbx.loading.sell")), opener });
  show(api);
  return api;
}

async function show(api) {
  if (sell.status !== "ready" || !sell.settings) {
    api.setBody(loadingView(st("sbx.loading.sell")));
    await loadSell();
  }
  if (!api.isOpen()) return;
  if (sell.status === "ready" && sell.settings) { api.setBody(form(sell.settings, api)); return; }
  const retry = { label: t("retry"), icon: "refresh", run: () => show(api) };
  if (sell.status === "missing") {
    api.setBody(stateView({ kind: "empty", icon: "info", title: st("sbx.missing.title"), text: st("sbx.missing.sell"), action: retry, compact: true }));
    return;
  }
  const err = sell.error;
  const text = (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load");
  api.setBody(stateView({ kind: "error", title: st("sbx.err.loadTitle"), text, action: retry, compact: true }));
}

function form(saved, api) {
  const L = lang();
  const f = {
    scheme: saved.gstScheme,
    gstin: cleanGstin(saved.gstin || ""),
    state: saved.stateCode || "",
    address: saved.address || "",
    touched: { gstin: false, state: false },
    busy: false,
  };
  const uid = `shop-${Date.now().toString(36)}`;

  /* ---- scheme tiles (a radio group of three big buttons) ---- */
  const tiles = SCHEMES.map((scheme) => h("button", {
    class: "shop-tile", type: "button", role: "radio", "aria-checked": String(f.scheme === scheme),
    tabindex: f.scheme === scheme ? "0" : "-1", dataset: { scheme },
    on: { click: () => pick(scheme), keydown: (e) => roam(e, scheme) },
  },
  h("span", { class: "shop-tile-ico", "aria-hidden": "true" }, icon(SCHEME_ICON[scheme], 30)),
  h("span", { class: "shop-tile-word", text: schemeWord(scheme) }),
  h("span", { class: "shop-tile-paper", text: st(PAPER_KEY[scheme]) }),
  h("span", { class: "shop-tile-tick", "aria-hidden": "true" }, icon("check", 18))));

  function pick(scheme, focus = false) {
    f.scheme = scheme;
    for (const b of tiles) {
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
    const i = (SCHEMES.indexOf(scheme) + d + SCHEMES.length) % SCHEMES.length;
    pick(SCHEMES[i], true);
  }

  /* ---- GST number ---- */
  const gstinId = `${uid}-gstin`;
  const gstinMsg = h("p", { class: "shop-help", id: `${gstinId}-msg`, text: st("shop.gstinHelp") });
  const gstinCount = h("span", { class: "shop-count", "aria-hidden": "true" });
  const gstinInput = h("input", {
    class: "shop-input shop-input-gstin", id: gstinId, name: "gstin", type: "text", inputmode: "text",
    autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "15",
    "aria-describedby": `${gstinId}-msg`,
    on: {
      input: () => {
        const v = cleanGstin(gstinInput.value);
        if (v !== gstinInput.value) gstinInput.value = v;
        f.gstin = v;
        clearErr(gstinInput, gstinMsg, "shop.gstinHelp");
        if (f.touched.gstin && gstinProblem(v) === "ok") checkGstin();
        sync();
      },
      focus: () => clearErr(gstinInput, gstinMsg, "shop.gstinHelp"),
      blur: () => { f.touched.gstin = true; checkGstin(); },
    },
  });
  gstinInput.value = f.gstin;
  const gstinBox = h("div", { class: "shop-field" },
    h("label", { class: "shop-label", for: gstinId }, icon("shield", 22), h("span", { text: st("shop.gstin") }), gstinCount),
    gstinInput, gstinMsg);

  function checkGstin() {
    if (!needsGstin(f.scheme)) return true;
    const p = gstinProblem(f.gstin);
    if (p === "ok") return true;
    setErr(gstinInput, gstinMsg, p === "empty" ? "shop.gstinNeed" : p === "short" ? "shop.gstinShort" : "shop.gstinShape");
    return false;
  }

  /* ---- state ---- */
  const stateId = `${uid}-state`;
  const stateMsg = h("p", { class: "shop-help", id: `${stateId}-msg`, hidden: true });
  const select = h("select", {
    class: "shop-input shop-select", id: stateId, name: "state", autocomplete: "address-level1",
    "aria-describedby": `${stateId}-msg`,
    on: {
      change: () => { f.state = select.value; f.touched.state = true; clearErr(select, stateMsg, null); },
      focus: () => clearErr(select, stateMsg, null),
      blur: () => { f.touched.state = true; checkState(); },
    },
  },
  h("option", { value: "", text: st("shop.statePick") }),
  ...statesFor(L).map((s) => h("option", { value: s.code, lang: s.native ? L : undefined, text: s.label })));
  select.value = f.state;
  const derived = h("p", { class: "shop-derived", role: "status" });
  const stateBox = h("div", { class: "shop-field" },
    h("label", { class: "shop-label", for: stateId }, icon("pin", 22), h("span", { text: st("shop.state") })),
    select, derived, stateMsg);

  function checkState() {
    if (needsGstin(f.scheme) && stateOfGstin(f.gstin)) return true;
    if (f.state) return true;
    setErr(select, stateMsg, "shop.stateNeed");
    return false;
  }

  /* ---- address ---- */
  const addrId = `${uid}-address`;
  const address = h("textarea", {
    class: "shop-input shop-textarea", id: addrId, name: "address", rows: "2", maxlength: "300",
    autocomplete: "street-address", "aria-describedby": `${addrId}-msg`,
    on: { input: () => { f.address = address.value; } },
  });
  address.value = f.address;
  const addrBox = h("div", { class: "shop-field" },
    h("label", { class: "shop-label", for: addrId }, icon("store", 22), h("span", { text: st("shop.address") }),
      h("span", { class: "shop-optional", text: `(${st("shop.optional")})` })),
    address,
    h("p", { class: "shop-help", id: `${addrId}-msg`, text: st("shop.addressHelp") }));

  /* ---- save ---- */
  const saveLabel = h("span", { text: st("shop.save") });
  const saveIco = h("span", { class: "shop-save-ico", "aria-hidden": "true" }, icon("check", 26));
  const save = h("button", { class: "keycap keycap-marigold shop-save", type: "button", on: { click: submit } }, saveIco, saveLabel);
  const result = h("div", { class: "shop-result", "aria-live": "polite" });

  function sync() {
    const gst = needsGstin(f.scheme);
    gstinBox.hidden = !gst;
    gstinCount.textContent = st("shop.gstinCount", { n: f.gstin.length });
    const fromGstin = gst ? stateOfGstin(f.gstin) : null;
    // A GSTIN's first two digits are its state: the picker gives way to that fact.
    select.hidden = Boolean(fromGstin);
    derived.hidden = !fromGstin;
    if (fromGstin) {
      derived.replaceChildren(icon("check", 20), stateText("b", fromGstin), h("span", { class: "shop-derived-why", text: st("shop.stateFromGstin") }));
      clearErr(select, stateMsg, null);
    }
  }

  async function submit() {
    if (f.busy) return;
    f.touched.gstin = true; f.touched.state = true;
    const problems = formProblems(f);
    const okGstin = !problems.gstin || checkGstin();
    const okState = !problems.state || checkState();
    if (!okGstin || !okState) {
      showResult("error", st("shop.fixFirst"));
      (!okGstin ? gstinInput : select).focus({ preventScroll: false });
      (!okGstin ? gstinBox : stateBox).scrollIntoView({ block: "center", behavior: "smooth" });
      // Focusing clears the message; put it back so the owner sees what to fix.
      if (!okGstin) checkGstin(); else checkState();
      return;
    }
    f.busy = true;
    save.setAttribute("aria-busy", "true");
    saveIco.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }));
    showResult("busy", st("shop.saving"));
    try {
      await saveShopSettings(settingsBody(f));
      showResult("ok", st("shop.saved"));
      setTimeout(() => { if (api.isOpen()) closeSheet(); }, 900);
    } catch (err) {
      const text = err.say || (err.status === 0 ? t("err.network") : err.status === 429 ? t("err.limit") : null) || st("shop.saveFail");
      if (err.code === "GSTIN_INVALID" && needsGstin(f.scheme)) {
        gstinInput.setAttribute("aria-invalid", "true");
        gstinMsg.textContent = text;
        gstinMsg.classList.add("is-error");
      }
      showResult("error", text);
    }
    f.busy = false;
    save.removeAttribute("aria-busy");
    saveIco.replaceChildren(icon("check", 26));
  }

  function showResult(kind, text) {
    const ic = kind === "ok" ? "checkCircle" : kind === "error" ? "alert" : null;
    result.replaceChildren(text ? h("p", { class: `shop-result-line is-${kind}`, role: kind === "error" ? "alert" : "status" },
      ic ? icon(ic, 22) : h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text })) : "");
  }

  sync();
  const sentence = () => `${st("shop.sayHelp")} ${st("shop.sayNow", { scheme: schemeWord(f.scheme), state: stateWord((needsGstin(f.scheme) && stateOfGstin(f.gstin)) || f.state) })}`;
  return [
    h("div", { class: "shop-intro" }, readButton("shop-details", sentence, { size: "md" })),
    h("fieldset", { class: "shop-schemes" },
      h("legend", { class: "shop-label shop-legend" }, icon("receipt", 22), h("span", { text: st("shop.how") })),
      h("div", { class: "shop-tiles", role: "radiogroup", "aria-label": st("shop.how") }, ...tiles)),
    gstinBox,
    stateBox,
    addrBox,
    result,
    h("div", { class: "shop-actions" }, save),
  ];
}

function setErr(input, msg, key) {
  input.setAttribute("aria-invalid", "true");
  msg.hidden = false;
  msg.textContent = st(key);
  msg.classList.add("is-error");
}

function clearErr(input, msg, helpKey) {
  if (input.getAttribute("aria-invalid") !== "true") return;
  input.removeAttribute("aria-invalid");
  msg.classList.remove("is-error");
  if (helpKey) msg.textContent = st(helpKey);
  else { msg.textContent = ""; msg.hidden = true; }
}

/* ------------------------------------------------- pieces for the screens -- */

/** The button that opens the sheet (icon + words). */
export function shopButton({ word = st("shop.open"), primary = false } = {}) {
  const btn = h("button", { class: `keycap ${primary ? "keycap-marigold" : "keycap-ghost"} keycap-md shop-open`, type: "button" },
    icon("store", 22), h("span", { text: word }));
  btn.addEventListener("click", () => openShopSheet({ opener: btn }));
  return btn;
}

/**
 * The "needs" card for the Sell screen: a bill cannot be made until this fact is added.
 * `code` is GSTIN_REQUIRED or STATE_REQUIRED; `say` is the server's own sentence when it sent one.
 */
export function shopNeedCard(code, say = null) {
  return h("div", { class: "shop-need", role: "alert" },
    h("span", { class: "shop-need-ico", "aria-hidden": "true" }, icon("store", 26)),
    h("div", { class: "shop-need-main" },
      h("p", { class: "shop-need-title", text: st("shop.need.title") }),
      h("p", { class: "shop-need-text", text: say || st(`shop.need.${code}`) })),
    shopButton({ word: st("shop.add"), primary: true }));
}

/** The missing fact in the loaded settings (null when a bill can be made, or not loaded yet). */
export const shopMissing = () => (sell.status === "ready" ? missingFact(sell.settings) : null);

/** My Sahay's row: how the shop bills, its state and GST number, with Change / Add. */
export function shopSummary() {
  const s = sell.settings;
  if (sell.status === "loading" || sell.status === "idle") return loadingView(st("sbx.loading.sell"));
  if (sell.status === "missing") return null;
  if (sell.status === "error" || !s) {
    return stateView({ kind: "error", title: st("sbx.err.loadTitle"), text: (sell.error && sell.error.say) || st("sbx.err.load"),
      action: { label: t("retry"), icon: "refresh", run: () => loadSell() }, compact: true });
  }
  const need = missingFact(s);
  return [
    h("ul", { class: "shop-facts" },
      h("li", {}, icon(SCHEME_ICON[s.gstScheme] || "receipt", 22),
        h("b", { text: schemeWord(s.gstScheme) }), h("span", { class: "shop-fact-sub", text: st(PAPER_KEY[s.gstScheme]) })),
      h("li", {}, icon("pin", 22), s.stateCode ? stateText("span", s.stateCode) : h("span", { class: "shop-fact-missing", text: st("shop.noState") })),
      needsGstin(s.gstScheme) ? h("li", {}, icon("shield", 22),
        s.gstin ? h("span", { class: "shop-gstin", text: s.gstin }) : h("span", { class: "shop-fact-missing", text: st("shop.noGstin") })) : null),
    need ? h("p", { class: "shop-need-line", role: "note" }, icon("alert", 22), h("span", { text: st(`shop.need.${need}`) })) : null,
    shopButton({ word: need || !s.saved ? st("shop.add") : st("shop.change"), primary: Boolean(need) }),
  ];
}
