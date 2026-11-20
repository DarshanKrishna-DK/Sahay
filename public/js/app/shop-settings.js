// Shop details / GST (UI v3). The sheet where the owner says how the shop bills (three choice
// tiles: no GST, registered, composition), its GST number, its state (a searchable picker inside
// the sheet, D18: no native select) and, if they like, its address. Save -> POST
// /api/sell/settings (store-sell.js saveShopSettings); a refusal shows the server's own `say`.
// Opened from Sell (header, needs card, a bill refused with GSTIN_REQUIRED / STATE_REQUIRED) and
// from My Sahay. Also exports the shop card those screens show (tiles, GSTIN hidden until the
// owner presses Show) and the "needs" card.

import { h } from "./dom.js";
import { t, lang, addStrings } from "./i18n.js";
import { sell, loadSell, saveShopSettings } from "./store-sell.js";
import { st } from "./sell-i18n.js";
import { readButton, ic, panel, screenState, cardHead, resultLine, scriptedText } from "./sell-kit.js";
import {
  SCHEMES, stateLabel, stateIsNative, cleanGstin, gstinProblem, stateOfGstin,
  needsGstin, missingFact, formProblems, settingsBody, findStates,
} from "./shop-facts.js";
import { maskGstin } from "./sell-facts.js";

addStrings({
  "shop.title": ["Shop details", "दुकान की जानकारी", "ಅಂಗಡಿ ವಿವರ"],
  "shop.open": ["Shop details", "दुकान की जानकारी", "ಅಂಗಡಿ ವಿವರ"],
  "shop.yours": ["Your shop", "आपकी दुकान", "ನಿಮ್ಮ ಅಂಗಡಿ"],
  "shop.add": ["Add shop details", "दुकान की जानकारी डालें", "ಅಂಗಡಿ ವಿವರ ಹಾಕಿ"],
  "shop.change": ["Change", "बदलें", "ಬದಲಿಸಿ"],
  "shop.how": ["How do you bill?", "आप बिल कैसे बनाते हैं?", "ನೀವು ಬಿಲ್ ಹೇಗೆ ಮಾಡುತ್ತೀರಿ?"],
  "shop.intro": ["Sahay prints these on every bill.", "सहाय यह हर बिल पर छापती है।", "ಸಹಾಯ್ ಇದನ್ನು ಪ್ರತಿ ಬಿಲ್‌ನಲ್ಲಿ ಮುದ್ರಿಸುತ್ತದೆ."],
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
  "shop.gstinShow": ["Show", "दिखाएँ", "ತೋರಿಸಿ"],
  "shop.gstinHide": ["Hide", "छिपाएँ", "ಮರೆಮಾಡಿ"],
  "shop.gstinShowLong": ["Show the full GST number", "पूरा GST नंबर दिखाएँ", "ಪೂರ್ತಿ GST ಸಂಖ್ಯೆ ತೋರಿಸಿ"],
  "shop.state": ["State", "राज्य", "ರಾಜ್ಯ"],
  "shop.statePick": ["Choose your state", "अपना राज्य चुनिए", "ನಿಮ್ಮ ರಾಜ್ಯ ಆಯ್ಕೆಮಾಡಿ"],
  "shop.stateNeed": ["Choose the state your shop is in.", "दुकान किस राज्य में है, चुनिए।", "ಅಂಗಡಿ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ ಎಂದು ಆಯ್ಕೆಮಾಡಿ."],
  "shop.stateFromGstin": ["From your GST number", "आपके GST नंबर से", "ನಿಮ್ಮ GST ಸಂಖ್ಯೆಯಿಂದ"],
  "shop.stateSearch": ["Search a state", "राज्य खोजिए", "ರಾಜ್ಯ ಹುಡುಕಿ"],
  "shop.stateNone": ["No state matches this. Check the spelling.", "इस नाम का कोई राज्य नहीं मिला। स्पेलिंग देखिए।", "ಈ ಹೆಸರಿನ ರಾಜ್ಯ ಸಿಗಲಿಲ್ಲ. ಕಾಗುಣಿತ ನೋಡಿ."],
  "shop.stateClear": ["Clear search", "खोज हटाएँ", "ಹುಡುಕಾಟ ಅಳಿಸಿ"],
  "shop.back": ["Back", "वापस", "ಹಿಂದೆ"],
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
  "shop.noAddress": ["No address on bills", "बिल पर पता नहीं", "ಬಿಲ್‌ನಲ್ಲಿ ವಿಳಾಸ ಇಲ್ಲ"],
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

const loadingBody = () => screenState({ kind: "loading", title: st("sbx.loading.sell"), shape: "form" });

/** Open the Shop details sheet; `opener` gets focus back when it closes. */
export function openShopSheet({ opener = null } = {}) {
  const api = panel({ title: st("shop.title"), body: loadingBody(), opener });
  show(api);
  return api;
}

async function show(api) {
  if (sell.status !== "ready" || !sell.settings) {
    api.setBody(loadingBody());
    await loadSell();
  }
  if (!api.isOpen()) return;
  if (sell.status === "ready" && sell.settings) { form(sell.settings, api); return; }
  const retry = { label: t("retry"), icon: "refresh", run: () => show(api) };
  if (sell.status === "missing") {
    api.setBody(screenState({ kind: "missing", title: st("sbx.missing.title"), text: st("sbx.missing.sell"), action: retry, compact: true }));
    return;
  }
  const err = sell.error;
  const text = (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load");
  api.setBody(screenState({ kind: "error", title: st("sbx.err.loadTitle"), text, action: retry, compact: true }));
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

  /* ---- scheme: three choice tiles, a radio group ---- */
  const tiles = SCHEMES.map((scheme) => h("button", {
    class: "choice gs-tile", type: "button", role: "radio", "aria-checked": String(f.scheme === scheme),
    tabindex: f.scheme === scheme ? "0" : "-1", dataset: { scheme },
    on: { click: () => pick(scheme), keydown: (e) => roam(e, scheme) },
  },
  h("span", { class: "gs-tile-ico", "aria-hidden": "true" }, ic(SCHEME_ICON[scheme], 28)),
  h("span", { class: "gs-tile-word", text: schemeWord(scheme) }),
  h("span", { class: "gs-tile-paper", text: st(PAPER_KEY[scheme]) })));

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
  const gstinMsg = h("p", { class: "field-help", id: `${gstinId}-msg`, text: st("shop.gstinHelp") });
  const gstinCount = h("span", { class: "gs-count", "aria-hidden": "true" });
  const gstinInput = h("input", {
    class: "field-input gs-gstin", id: gstinId, name: "gstin", type: "text", inputmode: "text",
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
  const gstinBox = h("div", { class: "field gs-field" },
    h("label", { class: "field-label", for: gstinId }, ic("shield", 20), h("span", { text: st("shop.gstin") }), gstinCount),
    gstinInput, gstinMsg);

  function checkGstin() {
    if (!needsGstin(f.scheme)) return true;
    const p = gstinProblem(f.gstin);
    if (p === "ok") return true;
    setErr(gstinInput, gstinMsg, p === "empty" ? "shop.gstinNeed" : p === "short" ? "shop.gstinShort" : "shop.gstinShape");
    return false;
  }

  /* ---- state: a button that opens the picker inside this sheet ---- */
  const stateId = `${uid}-state`;
  const stateMsg = h("p", { class: "field-help", id: `${stateId}-msg`, hidden: true });
  const pickWord = h("span", { class: "gs-pick-word" });
  const pickBtn = h("button", {
    class: "gs-pick", id: stateId, type: "button", "aria-describedby": `${stateId}-msg`,
    on: { click: () => openPicker() },
  }, h("span", { class: "gs-pick-ico", "aria-hidden": "true" }, ic("pin", 22)), pickWord, h("span", { class: "gs-pick-chev", "aria-hidden": "true" }, ic("chevronRight", 22)));
  const derived = h("p", { class: "gs-derived", role: "status" });
  const stateBox = h("div", { class: "field gs-field" },
    h("span", { class: "field-label", id: `${stateId}-label` }, ic("pin", 20), h("span", { text: st("shop.state") })),
    pickBtn, derived, stateMsg);
  pickBtn.setAttribute("aria-labelledby", `${stateId}-label ${stateId}`);

  function paintPick() {
    pickBtn.classList.toggle("is-empty", !f.state);
    pickWord.replaceChildren(f.state ? stateText("span", f.state) : h("span", { text: st("shop.statePick") }));
  }

  function checkState() {
    if (needsGstin(f.scheme) && stateOfGstin(f.gstin)) return true;
    if (f.state) return true;
    setErr(pickBtn, stateMsg, "shop.stateNeed");
    return false;
  }

  /* ---- address ---- */
  const addrId = `${uid}-address`;
  const address = h("textarea", {
    class: "field-input gs-address", id: addrId, name: "address", rows: "2", maxlength: "300",
    autocomplete: "street-address", "aria-describedby": `${addrId}-msg`,
    on: { input: () => { f.address = address.value; } },
  });
  address.value = f.address;
  const addrBox = h("div", { class: "field gs-field" },
    h("label", { class: "field-label", for: addrId }, ic("store", 20), h("span", { text: st("shop.address") }),
      h("span", { class: "gs-optional", text: st("shop.optional") })),
    address,
    h("p", { class: "field-help", id: `${addrId}-msg`, text: st("shop.addressHelp") }));

  /* ---- save (in the sheet's footer, thumb reach) ---- */
  const saveIco = h("span", { class: "gs-save-ico", "aria-hidden": "true" }, ic("check", 24));
  const save = h("button", { class: "keycap keycap-primary keycap-md keycap-block gs-save", type: "button", on: { click: submit } }, saveIco, h("span", { text: st("shop.save") }));
  const result = h("div", { class: "gs-result", "aria-live": "polite" });
  const footer = h("div", { class: "gs-foot" }, result, save);

  function sync() {
    const gst = needsGstin(f.scheme);
    gstinBox.hidden = !gst;
    gstinCount.textContent = st("shop.gstinCount", { n: f.gstin.length });
    gstinCount.classList.toggle("is-full", f.gstin.length === 15);
    const fromGstin = gst ? stateOfGstin(f.gstin) : null;
    // A GSTIN's first two digits are its state: the picker gives way to that fact.
    pickBtn.hidden = Boolean(fromGstin);
    derived.hidden = !fromGstin;
    if (fromGstin) {
      derived.replaceChildren(ic("checkCircle", 20), stateText("b", fromGstin), h("span", { class: "gs-derived-why", text: st("shop.stateFromGstin") }));
      clearErr(pickBtn, stateMsg, null);
    }
    paintPick();
  }

  async function submit() {
    if (f.busy) return;
    f.touched.gstin = true; f.touched.state = true;
    const problems = formProblems(f);
    const okGstin = !problems.gstin || checkGstin();
    const okState = !problems.state || checkState();
    if (!okGstin || !okState) {
      showResult("error", st("shop.fixFirst"));
      (!okGstin ? gstinBox : stateBox).scrollIntoView({ block: "center", behavior: "smooth" });
      // Focusing the GSTIN box clears its message (forms rule); put it back so the owner sees what to fix.
      if (!okGstin) { gstinInput.focus({ preventScroll: true }); checkGstin(); } else pickBtn.focus({ preventScroll: true });
      return;
    }
    f.busy = true;
    save.setAttribute("aria-busy", "true");
    saveIco.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }));
    showResult("busy", st("shop.saving"));
    try {
      await saveShopSettings(settingsBody(f));
      showResult("ok", st("shop.saved"));
      setTimeout(() => { if (api.isOpen()) api.close(); }, 900);
    } catch (err) {
      const text = err.say || (err.status === 0 ? t("err.network") : err.status === 429 ? t("err.limit") : null) || st("shop.saveFail");
      if (err.code === "GSTIN_INVALID" && needsGstin(f.scheme)) {
        gstinInput.setAttribute("aria-invalid", "true");
        gstinMsg.textContent = text;
        gstinMsg.classList.add("field-error");
      }
      showResult("error", text);
    }
    f.busy = false;
    save.removeAttribute("aria-busy");
    saveIco.replaceChildren(ic("check", 24));
  }

  function showResult(kind, text) {
    result.replaceChildren(resultLine(kind, text) || "");
  }

  /* ---- the state picker, inside the sheet (search field + big rows; D18) ---- */
  let formNodes = null;
  function openPicker() {
    const search = h("input", {
      class: "field-input gs-search", type: "search", inputmode: "search", autocomplete: "off", autocapitalize: "none", spellcheck: "false",
      "aria-label": st("shop.stateSearch"), placeholder: st("shop.stateSearch"),
    });
    const clear = h("button", { class: "icon-btn gs-search-clear", type: "button", hidden: true, "aria-label": st("shop.stateClear"), dataset: { tip: st("shop.stateClear") } }, ic("x", 20));
    const list = h("div", { class: "picker-list gs-states", role: "group", "aria-label": st("shop.statePick") });
    const back = () => { api.setBody(formNodes); api.setFooter(footer); requestAnimationFrame(() => pickBtn.focus()); };
    const draw = () => {
      const rows = findStates(search.value, L);
      clear.hidden = !search.value;
      if (!rows.length) {
        list.replaceChildren(h("div", { class: "gs-none" },
          h("p", { class: "note-line" }, ic("search", 20), h("span", { text: st("shop.stateNone") })),
          h("button", { class: "keycap keycap-secondary keycap-sm", type: "button", on: { click: () => { search.value = ""; draw(); search.focus(); } } },
            ic("x", 20), h("span", { text: st("shop.stateClear") }))));
        return;
      }
      list.replaceChildren(...rows.map((r) => h("button", {
          class: "picker-item gs-state", type: "button", "aria-pressed": String(r.code === f.state),
          on: { click: () => { f.state = r.code; f.touched.state = true; clearErr(pickBtn, stateMsg, null); sync(); back(); } },
        },
        h("span", { class: "gs-state-name", lang: r.native ? L : undefined, text: r.label }),
        r.code === f.state ? h("span", { class: "pi-sub gs-state-tick", "aria-hidden": "true" }, ic("check", 22)) : null)));
    };
    search.addEventListener("input", draw);
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const first = list.querySelector(".gs-state"); if (first) { e.preventDefault(); first.click(); } }
      if (e.key === "Escape" && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ""; draw(); }
    });
    clear.addEventListener("click", () => { search.value = ""; draw(); search.focus(); });
    draw();
    api.setFooter(null);
    api.setBody(h("div", { class: "picker gs-picker" },
      h("div", { class: "gs-picker-head" },
        h("button", { class: "keycap keycap-ghost keycap-sm gs-back", type: "button", on: { click: back } }, ic("chevronLeft", 22), h("span", { text: st("shop.back") })),
        h("p", { class: "gs-picker-title", text: st("shop.statePick") })),
      h("div", { class: "picker-search gs-searchbox" }, h("span", { class: "gs-search-ico", "aria-hidden": "true" }, ic("search", 20)), search, clear),
      list));
    requestAnimationFrame(() => search.focus());
  }

  sync();
  const sentence = () => `${st("shop.sayHelp")} ${st("shop.sayNow", { scheme: schemeWord(f.scheme), state: stateWord((needsGstin(f.scheme) && stateOfGstin(f.gstin)) || f.state) })}`;
  formNodes = [
    h("div", { class: "gs-intro" }, h("p", { class: "gs-intro-text", text: st("shop.intro") }), readButton("shop-details", sentence, { size: "md" })),
    h("fieldset", { class: "gs-schemes" },
      h("legend", { class: "field-label" }, ic("receipt", 20), h("span", { text: st("shop.how") })),
      h("div", { class: "choices gs-tiles", role: "radiogroup", "aria-label": st("shop.how") }, ...tiles)),
    gstinBox,
    stateBox,
    addrBox,
  ];
  api.setBody(formNodes);
  api.setFooter(footer);
}

function setErr(input, msg, key) {
  input.setAttribute("aria-invalid", "true");
  msg.hidden = false;
  msg.textContent = st(key);
  msg.classList.add("field-error");
}

function clearErr(input, msg, helpKey) {
  if (input.getAttribute("aria-invalid") !== "true") return;
  input.removeAttribute("aria-invalid");
  msg.classList.remove("field-error");
  if (helpKey) msg.textContent = st(helpKey);
  else { msg.textContent = ""; msg.hidden = true; }
}

/* ------------------------------------------------- pieces for the screens -- */

/** The button that opens the sheet (icon + words). */
export function shopButton({ word = st("shop.open"), primary = false, size = "md" } = {}) {
  const btn = h("button", { class: `keycap ${primary ? "keycap-primary" : "keycap-secondary"} keycap-${size} gs-open`, type: "button" },
    ic("store", 22), h("span", { text: word }));
  btn.addEventListener("click", () => openShopSheet({ opener: btn }));
  return btn;
}

/**
 * The "needs" card (Sell top, and inside a bill refused for it): a bill cannot be made until this
 * fact is added. `code` is GSTIN_REQUIRED or STATE_REQUIRED; `say` is the server's own sentence.
 */
export function shopNeedCard(code, say = null) {
  return h("article", { class: "card card-alert gs-need", role: "alert" },
    h("span", { class: "gs-need-ico", "aria-hidden": "true" }, ic("alert", 26)),
    h("div", { class: "gs-need-main" },
      h("p", { class: "gs-need-title", text: st("shop.need.title") }),
      h("p", { class: "gs-need-text", text: say || st(`shop.need.${code}`) })),
    shopButton({ word: st("shop.add"), primary: true }));
}

/** The missing fact in the loaded settings (null when a bill can be made, or not loaded yet). */
export const shopMissing = () => (sell.status === "ready" ? missingFact(sell.settings) : null);

let gstinShown = false;

function gstinValue(gstin) {
  const value = h("span", { class: "gs-gstin-value", text: gstinShown ? gstin : maskGstin(gstin) });
  const word = h("span", { text: st(gstinShown ? "shop.gstinHide" : "shop.gstinShow") });
  const eye = h("span", { class: "gs-eye", "aria-hidden": "true" }, ic(gstinShown ? "eyeOff" : "eye", 20));
  const toggle = h("button", {
    class: "keycap keycap-ghost keycap-sm gs-reveal", type: "button", "aria-pressed": String(gstinShown), "aria-label": st("shop.gstinShowLong"),
    on: {
      click: () => {
        gstinShown = !gstinShown;
        value.textContent = gstinShown ? gstin : maskGstin(gstin);
        word.textContent = st(gstinShown ? "shop.gstinHide" : "shop.gstinShow");
        eye.replaceChildren(ic(gstinShown ? "eyeOff" : "eye", 20));
        toggle.setAttribute("aria-pressed", String(gstinShown));
      },
    },
  }, eye, word);
  return [value, toggle];
}

const missingMark = (key) => h("span", { class: "gs-fact-missing" }, ic("alert", 18), h("span", { text: st(key) }));

/**
 * The shop card (Sell's side column and My Sahay): how the shop bills, its state and GST number
 * (hidden until Show), the address on bills, and Change / Add. Null when Sell is not on this server.
 */
export function shopSummary() {
  const s = sell.settings;
  if (sell.status === "loading" || sell.status === "idle") return loadingBody();
  if (sell.status === "missing") return null;
  if (sell.status === "error" || !s) {
    return screenState({ kind: "error", title: st("sbx.err.loadTitle"), text: (sell.error && sell.error.say) || st("sbx.err.load"),
      action: { label: t("retry"), icon: "refresh", run: () => loadSell() }, compact: true });
  }
  const need = missingFact(s);
  const sentence = () => [
    st("shop.sayNow", { scheme: schemeWord(s.gstScheme), state: stateWord(s.stateCode) }),
    need ? st(`shop.need.${need}`) : "",
  ].join(" ").trim();
  const tile = (icn, label, value, cls = "") => h("li", { class: `gs-fact${cls ? ` ${cls}` : ""}` },
    h("span", { class: "gs-fact-ico", "aria-hidden": "true" }, ic(icn, 22)),
    h("span", { class: "gs-fact-label", text: label }),
    h("span", { class: "gs-fact-value" }, value));
  return h("article", { class: `card gs-summary${need ? " card-alert" : ""}`, "aria-labelledby": "gs-summary-h" },
    cardHead(h("h2", { class: "t-label gs-summary-h", id: "gs-summary-h", text: st("shop.yours") }), readButton("shop-facts", sentence)),
    h("ul", { class: "gs-facts" },
      tile(SCHEME_ICON[s.gstScheme] || "receipt", st("shop.how"), [h("b", { text: schemeWord(s.gstScheme) }), h("span", { class: "gs-fact-sub", text: st(PAPER_KEY[s.gstScheme]) })]),
      tile("pin", st("shop.state"), s.stateCode ? stateText("b", s.stateCode) : missingMark("shop.noState")),
      needsGstin(s.gstScheme) ? tile("shield", st("shop.gstin"), s.gstin ? gstinValue(s.gstin) : missingMark("shop.noGstin"), "gs-fact-gstin") : null,
      tile("store", st("shop.address"), s.address ? scriptedText("span", s.address, { class: "gs-address-text" }) : h("span", { class: "gs-fact-sub", text: st("shop.noAddress") }), "gs-fact-wide")),
    need ? resultLine("error", st(`shop.need.${need}`)) : null,
    shopButton({ word: need || !s.saved ? st("shop.add") : st("shop.change"), primary: Boolean(need), size: "sm" }));
}
