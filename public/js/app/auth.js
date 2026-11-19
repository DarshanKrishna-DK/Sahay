// Sign up and Log in (contract ACC). One question per screen, icon first, almost no reading:
// Sign up = language -> phone -> shop -> city -> PIN -> PIN again (-> access code if the server
// needs one) -> POST /api/auth/register. Log in = fingerprint first (only when this device has
// a platform passkey), PIN second: phone -> PIN -> POST /api/auth/login. After either, the owner
// is offered "use fingerprint next time" once. The phone is not verified (no OTP yet) and the
// screen says so. A server without /api/auth (404) can still start a shop without an account.

import { h, icon, fill } from "./dom.js";
import { t, LANGS, setLang, lang, addStrings } from "./i18n.js";
import * as api from "../api.js";
import * as store from "./store.js";
import { state, agentRequest } from "./store.js";
import { createKeypad } from "./keypad.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { passkeyAvailable, addPasskey, loginWithPasskey, cancelled } from "./passkey.js";

addStrings({
  "auth.welcome": ["Your shop's helper", "आपकी दुकान का सहायक", "ನಿಮ್ಮ ಅಂಗಡಿಯ ಸಹಾಯಕ"],
  "auth.signup": ["Make my Sahay", "मेरा सहाय बनाएँ", "ನನ್ನ ಸಹಾಯ್ ಮಾಡಿ"],
  "auth.login": ["Log in", "लॉग इन", "ಲಾಗಿನ್"],
  "auth.toLogin": ["I already have Sahay", "मेरे पास पहले से सहाय है", "ನನ್ನ ಬಳಿ ಈಗಾಗಲೇ ಸಹಾಯ್ ಇದೆ"],
  "auth.toSignup": ["New shop? Make Sahay", "नई दुकान? सहाय बनाएँ", "ಹೊಸ ಅಂಗಡಿ? ಸಹಾಯ್ ಮಾಡಿ"],
  "auth.phone": ["Your mobile number", "आपका मोबाइल नंबर", "ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್"],
  "auth.pin": ["Make a 4-number PIN", "4 अंकों का पिन बनाएँ", "4 ಅಂಕಿಯ ಪಿನ್ ಮಾಡಿ"],
  "auth.pin2": ["Same PIN once more", "वही पिन फिर से", "ಅದೇ ಪಿನ್ ಮತ್ತೊಮ್ಮೆ"],
  "auth.pinEnter": ["Your PIN", "आपका पिन", "ನಿಮ್ಮ ಪಿನ್"],
  "auth.pinWhy": ["You will use this PIN to open Sahay on any phone.", "किसी भी फ़ोन पर सहाय खोलने के लिए यही पिन लगेगा।", "ಯಾವುದೇ ಫೋನ್‌ನಲ್ಲಿ ಸಹಾಯ್ ತೆರೆಯಲು ಇದೇ ಪಿನ್."],
  "auth.pinMismatch": ["The two PINs are different. Make it again.", "दोनों पिन अलग हैं। फिर से बनाइए।", "ಎರಡು ಪಿನ್ ಬೇರೆ ಬೇರೆ. ಮತ್ತೆ ಮಾಡಿ."],
  "auth.notVerified": ["Phone not verified yet", "फ़ोन अभी सत्यापित नहीं है", "ಫೋನ್ ಇನ್ನೂ ಪರಿಶೀಲಿಸಿಲ್ಲ"],
  "auth.notVerifiedWhy": ["Sahay does not send an SMS code yet. Use your own number.", "सहाय अभी SMS कोड नहीं भेजता। अपना ही नंबर डालें।", "ಸಹಾಯ್ ಈಗ SMS ಕೋಡ್ ಕಳುಹಿಸುವುದಿಲ್ಲ. ನಿಮ್ಮದೇ ನಂಬರ್ ಹಾಕಿ."],
  "auth.badPhone": ["Write a 10-number Indian mobile number", "10 अंकों का भारतीय मोबाइल नंबर डालें", "10 ಅಂಕಿಯ ಭಾರತೀಯ ಮೊಬೈಲ್ ನಂಬರ್ ಹಾಕಿ"],
  "auth.creating": ["Making your Sahay", "आपका सहाय बन रहा है", "ನಿಮ್ಮ ಸಹಾಯ್ ತಯಾರಾಗುತ್ತಿದೆ"],
  "auth.checking": ["Checking", "जाँच रहे हैं", "ಪರಿಶೀಲಿಸುತ್ತಿದೆ"],
  "auth.finger": ["Use fingerprint", "उँगली से खोलें", "ಬೆರಳಚ್ಚಿನಿಂದ ತೆರೆಯಿರಿ"],
  "auth.fingerLong": ["Log in with fingerprint or screen lock", "उँगली या स्क्रीन लॉक से लॉग इन करें", "ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್‌ನಿಂದ ಲಾಗಿನ್"],
  "auth.usePin": ["Use PIN", "पिन से खोलें", "ಪಿನ್‌ನಿಂದ ತೆರೆಯಿರಿ"],
  "auth.fingerFail": ["Fingerprint did not work. Use your PIN.", "उँगली से नहीं खुला। पिन डालिए।", "ಬೆರಳಚ್ಚು ಕೆಲಸ ಮಾಡಲಿಲ್ಲ. ಪಿನ್ ಹಾಕಿ."],
  "auth.offerTitle": ["Open Sahay with your fingerprint next time?", "अगली बार उँगली से सहाय खोलें?", "ಮುಂದಿನ ಬಾರಿ ಬೆರಳಚ್ಚಿನಿಂದ ಸಹಾಯ್ ತೆರೆಯುವುದೇ?"],
  "auth.offerYes": ["Add fingerprint", "उँगली जोड़ें", "ಬೆರಳಚ್ಚು ಸೇರಿಸಿ"],
  "auth.later": ["Later", "बाद में", "ನಂತರ"],
  "auth.added": ["Fingerprint added", "उँगली जुड़ गई", "ಬೆರಳಚ್ಚು ಸೇರಿತು"],
  "auth.addFail": ["Could not add the fingerprint. You can add it later in My Sahay.", "उँगली नहीं जुड़ी। बाद में मेरा सहाय में जोड़ सकते हैं।", "ಬೆರಳಚ್ಚು ಸೇರಲಿಲ್ಲ. ನಂತರ ನನ್ನ ಸಹಾಯ್‌ನಲ್ಲಿ ಸೇರಿಸಬಹುದು."],
  "auth.noAccounts": ["Accounts are not switched on for this Sahay yet.", "इस सहाय पर अभी खाते चालू नहीं हैं।", "ಈ ಸಹಾಯ್‌ನಲ್ಲಿ ಇನ್ನೂ ಖಾತೆಗಳು ಆನ್ ಆಗಿಲ್ಲ."],
  "auth.noAccountStart": ["Start without an account", "बिना खाते के शुरू करें", "ಖಾತೆ ಇಲ್ಲದೆ ಪ್ರಾರಂಭಿಸಿ"],
  "auth.change": ["Change", "बदलें", "ಬದಲಿಸಿ"],
  "auth.langPick": ["Language", "भाषा", "ಭಾಷೆ"],
});

const NAME_MAX = 80;
const isNameText = (v) => /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u.test(v) && /[\p{L}\p{N}]/u.test(v);
const isMobile = (d) => /^[6-9]\d{9}$/.test(d);
const fmtPhone = (d) => (d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d);
const LANG_CODE = { hi: "hi-IN", kn: "kn-IN", en: "en-IN" };

export function createAuth({ mode: startMode = "signup" } = {}) {
  const el = h("section", { class: "auth", "aria-labelledby": "auth-q" });
  const orb = createThinkingOrb({ size: 96, state: "idle" });
  const data = { language: null, phone: "", name: "", city: "", pin: "", accessCode: "" };
  let mode = startMode;   // signup | login | offer
  let step = 0;
  let busy = false;
  let error = null;       // { text, action? }
  let fieldError = null;
  let finger = null;      // null = unknown, true / false once checked
  let loginWithPin = false;
  let pad = null;

  passkeyAvailable().then((ok) => { finger = ok; if (mode === "login" && !loginWithPin) render(); });

  const signupSteps = () => ["lang", "phone", "name", "city", "pin", "pin2", ...(state.config.accessCodeRequired ? ["code"] : [])];
  const loginSteps = () => ["phone", "pinEnter"];
  const steps = () => (mode === "signup" ? signupSteps() : loginSteps());

  function language() { return data.language || LANG_CODE[lang()] || "en-IN"; }
  function sayOf(err, fallbackKey) {
    if (!err) return t(fallbackKey);
    if (err.status === 0) return t("err.network");
    return err.say || (err.status === 429 ? t("err.limit") : t(fallbackKey));
  }

  function setMode(next) {
    mode = next; step = 0; error = null; fieldError = null; busy = false; loginWithPin = false;
    if (next === "login") data.pin = "";
    history.replaceState(null, "", next === "login" ? "#/login" : "#/signup");
    render(true);
  }

  async function finishSignedIn(res) {
    state.account = res.account || null;
    state.accounts = "ready";
    if (res.business) state.business = res.business;
    try { localStorage.setItem("sahay-had-account", "1"); } catch { /* storage blocked */ }
    if (finger && res.account && !res.skipOffer) { mode = "offer"; busy = false; error = null; render(true); return; }
    enterApp(res.business);
  }

  async function enterApp(business) {
    location.hash = "#/talk";
    await store.boot({ session: { business } });
  }

  async function register() {
    busy = true; error = null; orb.set("connecting"); render();
    const body = { phone: data.phone, pin: data.pin, name: data.name, city: data.city, language: data.language || language() };
    if (state.config.accessCodeRequired) body.accessCode = data.accessCode;
    try {
      const res = await agentRequest("POST", "/api/auth/register", body);
      orb.set("idle");
      await finishSignedIn(res);
    } catch (err) {
      busy = false; orb.set("idle");
      if (err.status === 404) {
        state.accounts = "missing";
        error = { text: t("auth.noAccounts"), action: { label: t("auth.noAccountStart"), icon: "store", run: startWithoutAccount } };
      } else if (err.code === "ACCESS_CODE_REQUIRED") {
        state.config.accessCodeRequired = true;
        step = signupSteps().indexOf("code");
        fieldError = sayOf(err, "err.codeEmpty");
      } else if (err.code === "PHONE_TAKEN") {
        error = { text: sayOf(err, "err.save"), action: { label: t("auth.login"), icon: "key", run: () => { const p = data.phone; setMode("login"); data.phone = p; step = 1; render(true); } } };
      } else if (err.code === "INVALID_PHONE") {
        step = signupSteps().indexOf("phone"); fieldError = sayOf(err, "auth.badPhone");
      } else if (err.code === "INVALID_PIN") {
        step = signupSteps().indexOf("pin"); data.pin = ""; fieldError = sayOf(err, "err.save");
      } else {
        error = { text: sayOf(err, "err.save") };
      }
      render(true);
    }
  }

  async function startWithoutAccount() {
    busy = true; error = null; render();
    try {
      const session = await api.openSession({ name: data.name, city: data.city, language: data.language || language() });
      await enterApp(session.business);
    } catch (err) {
      busy = false; error = { text: sayOf(err, "err.save") }; render();
    }
  }

  async function login() {
    busy = true; error = null; orb.set("thinking"); render();
    try {
      const res = await agentRequest("POST", "/api/auth/login", { phone: data.phone, pin: data.pin, language: language() });
      orb.set("idle");
      if (res.business && res.business.language) setLang(res.business.language);
      await finishSignedIn(res);
    } catch (err) {
      busy = false; orb.set("idle"); data.pin = "";
      if (err.status === 404) error = { text: t("auth.noAccounts") };
      else fieldError = sayOf(err, "err.save");
      render(true);
      if (pad) pad.shake();
    }
  }

  async function fingerLogin() {
    busy = true; error = null; orb.set("connecting"); render();
    try {
      const res = await loginWithPasskey(isMobile(data.phone) ? data.phone : undefined);
      orb.set("idle");
      if (res.business && res.business.language) setLang(res.business.language);
      await finishSignedIn({ ...res, skipOffer: true });
    } catch (err) {
      busy = false; orb.set("idle");
      if (!cancelled(err)) error = { text: err && err.say ? err.say : t("auth.fingerFail") };
      loginWithPin = true;
      render(true);
    }
  }

  async function offerYes() {
    busy = true; error = null; render();
    try {
      await addPasskey();
      busy = false;
      error = null;
      el.querySelector(".auth-card").replaceChildren(h("p", { class: "auth-done", role: "status" }, icon("checkCircle", 30), h("span", { text: t("auth.added") })));
      setTimeout(() => enterApp(state.business), 900);
    } catch (err) {
      busy = false;
      if (cancelled(err)) { enterApp(state.business); return; }
      error = { text: t("auth.addFail") };
      render();
    }
  }

  function next(value) {
    const kind = steps()[step];
    fieldError = null; error = null;
    if (kind === "phone") {
      if (!isMobile(value)) { fieldError = t("auth.badPhone"); render(); if (pad) pad.shake(); return; }
      data.phone = value;
    } else if (kind === "pin") {
      data.pin = value;
    } else if (kind === "pin2") {
      if (value !== data.pin) { data.pin = ""; step = signupSteps().indexOf("pin"); fieldError = t("auth.pinMismatch"); render(true); return; }
    } else if (kind === "pinEnter") {
      data.pin = value; login(); return;
    } else if (kind === "name" || kind === "city" || kind === "code") {
      const input = el.querySelector("#auth-input");
      const v = input ? input.value.trim() : "";
      if (kind === "code") { if (!v) { fieldError = t("err.codeEmpty"); render(); return; } data.accessCode = v; }
      else {
        if (!v) fieldError = t(kind === "name" ? "err.nameEmpty" : "err.cityEmpty");
        else if (v.length > NAME_MAX) fieldError = t("err.long");
        else if (!isNameText(v)) fieldError = t("err.chars");
        if (fieldError) { render(); const i = el.querySelector("#auth-input"); if (i) i.focus(); return; }
        data[kind] = v;
      }
    }
    if (mode === "signup" && step === signupSteps().length - 1) { register(); return; }
    step += 1;
    render(true);
  }

  function back() {
    if (busy) return;
    if (step === 0) { if (mode === "login" && loginWithPin && finger) { loginWithPin = false; render(true); } return; }
    step -= 1; fieldError = null; error = null;
    if (steps()[step] === "pin") data.pin = "";
    render(true);
  }

  function chooseLang(code) { data.language = code; setLang(code); next(); }

  function dictateButton(input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const btn = h("button", { class: "icon-btn icon-btn-lg dictate", type: "button", "aria-label": t("welcome.speak"), dataset: { tip: t("welcome.speak") } }, icon("mic", 26));
    btn.addEventListener("click", () => {
      let rec;
      try { rec = new SR(); } catch { return; }
      rec.lang = language();
      rec.interimResults = false;
      btn.dataset.state = "listening";
      rec.onresult = (e) => { const said = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ""; if (said) input.value = said.trim().slice(0, NAME_MAX); };
      rec.onend = () => { delete btn.dataset.state; };
      rec.onerror = rec.onend;
      try { rec.start(); } catch { rec.onend(); }
    });
    return btn;
  }

  /** The answers so far as small icon chips, so the owner sees what Sahay has. */
  function answers() {
    const chips = [];
    if (data.phone && steps()[step] !== "phone") chips.push(["phone", `+91 ${fmtPhone(data.phone)}`, "phone"]);
    if (mode === "signup" && data.name && step > signupSteps().indexOf("name")) chips.push(["store", data.name, "name"]);
    if (mode === "signup" && data.city && step > signupSteps().indexOf("city")) chips.push(["pin", data.city, "city"]);
    if (!chips.length) return null;
    return h("ul", { class: "auth-answers" }, ...chips.map(([ic, text, kind]) => h("li", {},
      h("button", { class: "answer-chip", type: "button", disabled: busy ? true : undefined, "aria-label": `${t("auth.change")}: ${text}`,
        on: { click: () => { step = steps().indexOf(kind); fieldError = null; error = null; render(true); } } },
      icon(ic, 18), h("span", { text })))));
  }

  function question(ic, text, extra) {
    return h("h1", { id: "auth-q", class: "auth-q", tabindex: "-1" },
      h("span", { class: "auth-q-ico", "aria-hidden": "true" }, icon(ic, 30)), h("span", { text }), extra || null);
  }

  function padStep(kind) {
    const pin = kind !== "phone";
    pad = createKeypad({
      length: pin ? 4 : 10, mask: pin,
      label: pin ? t(kind === "pinEnter" ? "auth.pinEnter" : kind === "pin2" ? "auth.pin2" : "auth.pin") : t("auth.phone"),
      format: pin ? null : (d) => [h("span", { class: "pad-prefix", text: "+91" }), fmtPhone(d)],
      onDone: next,
    });
    if (busy) pad.setBusy(true);
    const title = { phone: "auth.phone", pin: "auth.pin", pin2: "auth.pin2", pinEnter: "auth.pinEnter" }[kind];
    return [
      question(pin ? "lock" : "phone", t(title)),
      kind === "pin" ? h("p", { class: "auth-why", text: t("auth.pinWhy") }) : null,
      pad.el,
      kind === "phone" ? h("p", { class: "auth-honest", role: "note" }, icon("info", 20), h("span", {}, h("strong", { text: t("auth.notVerified") }), h("span", { text: ` ${t("auth.notVerifiedWhy")}` }))) : null,
    ];
  }

  function textStep(kind) {
    const labelKey = { name: "welcome.shop", city: "welcome.city", code: "welcome.code" }[kind];
    const value = kind === "code" ? data.accessCode : data[kind];
    const input = h("input", {
      id: "auth-input", class: "wel-input", type: kind === "code" ? "password" : "text", maxlength: kind === "code" ? 200 : NAME_MAX,
      autocomplete: kind === "name" ? "organization" : kind === "city" ? "address-level2" : "off", enterkeyhint: "next",
      "aria-invalid": fieldError ? "true" : undefined, "aria-describedby": fieldError ? "auth-err" : undefined, disabled: busy ? true : undefined,
    });
    input.value = value;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
    return [
      h("label", { id: "auth-q", class: "auth-q", for: "auth-input" },
        h("span", { class: "auth-q-ico", "aria-hidden": "true" }, icon(kind === "name" ? "store" : kind === "city" ? "pin" : "tag", 30)), h("span", { text: t(labelKey) })),
      kind === "code" ? h("p", { class: "auth-why", text: t("welcome.codeWhy") }) : null,
      h("div", { class: "wel-field" }, input, kind !== "code" ? dictateButton(input) : null),
    ];
  }

  function langStep() {
    return [
      h("h1", { id: "auth-q", class: "auth-q auth-q-tri", tabindex: "-1" },
        h("span", { lang: "hi", text: t("welcome.lang", null, "hi") }),
        h("span", { lang: "kn", text: t("welcome.lang", null, "kn") }),
        h("span", { lang: "en", text: t("welcome.lang", null, "en") })),
      h("div", { class: "lang-tiles", role: "group", "aria-labelledby": "auth-q" },
        ...LANGS.map((L, i) => h("button", {
          class: `lang-tile lang-tile-${L.short}`, type: "button", lang: L.short, "aria-pressed": String(data.language === L.code), style: `--i:${i}`,
          on: { click: () => chooseLang(L.code) },
        }, h("span", { class: "lt-script", text: L.native }), h("span", { class: "lt-go", "aria-hidden": "true" }, icon("arrowRight", 26))))),
    ];
  }

  /** Small language switch for Log in (errors come back in the language sent). */
  function langSwitch() {
    return h("div", { class: "auth-langs", role: "group", "aria-label": t("auth.langPick") },
      ...LANGS.map((L) => h("button", { class: "lang-chip", type: "button", lang: L.short, "aria-pressed": String(lang() === L.short),
        on: { click: () => { data.language = L.code; setLang(L.code); render(); } } }, h("span", { text: L.native }))));
  }

  function fingerFirst() {
    return [
      h("h1", { id: "auth-q", class: "auth-q", tabindex: "-1" }, h("span", { text: t("auth.login") })),
      h("button", { class: "finger-btn", type: "button", "aria-label": t("auth.fingerLong"), disabled: busy ? true : undefined, on: { click: fingerLogin } },
        h("span", { class: "finger-ring", "aria-hidden": "true" }, busy ? h("span", { class: "spinner" }) : icon("fingerprint", 64)),
        h("span", { class: "finger-word", text: t("auth.finger") })),
      h("button", { class: "keycap keycap-ghost keycap-lg", type: "button", disabled: busy ? true : undefined, on: { click: () => { loginWithPin = true; step = 0; render(true); } } },
        icon("lock", 24), h("span", { text: t("auth.usePin") })),
    ];
  }

  function offer() {
    return [
      h("h1", { id: "auth-q", class: "auth-q", tabindex: "-1" }, h("span", { text: t("auth.offerTitle") })),
      h("span", { class: "finger-ring finger-ring-still", "aria-hidden": "true" }, icon("fingerprint", 64)),
      h("div", { class: "auth-actions" },
        h("button", { class: "keycap keycap-ghost keycap-lg", type: "button", disabled: busy ? true : undefined, on: { click: () => enterApp(state.business) } }, h("span", { text: t("auth.later") })),
        h("button", { class: "keycap keycap-marigold keycap-lg", type: "button", disabled: busy ? true : undefined, "aria-busy": busy ? "true" : undefined, on: { click: offerYes } },
          busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("fingerprint", 26), h("span", { text: t("auth.offerYes") }))),
    ];
  }

  function render(moveFocus = false) {
    pad = null;
    let body;
    let kind = null;
    if (mode === "offer") body = offer();
    else if (mode === "login" && !loginWithPin && finger) body = fingerFirst();
    else {
      const list = steps();
      kind = list[step];
      body = kind === "lang" ? langStep() : (kind === "name" || kind === "city" || kind === "code") ? textStep(kind) : padStep(kind);
    }
    const list = steps();
    const showProgress = mode === "signup" && kind;
    const progress = showProgress ? h("ol", { class: "wel-progress", "aria-label": t("welcome.step", { n: step + 1, total: list.length }) },
      ...list.map((_, i) => h("li", { class: i < step ? "is-done" : i === step ? "is-now" : "", "aria-current": i === step ? "step" : undefined }))) : null;
    const isText = kind === "name" || kind === "city" || kind === "code";
    const canBack = mode !== "offer" && (step > 0 || (mode === "login" && loginWithPin && finger));
    const actions = (canBack || isText) ? h("div", { class: "auth-actions" },
      canBack ? h("button", { class: "keycap keycap-ghost keycap-md", type: "button", disabled: busy ? true : undefined, on: { click: back } }, icon("arrowLeft", 22), h("span", { text: t("back") })) : null,
      isText ? h("button", { class: "keycap keycap-marigold keycap-lg", type: "button", disabled: busy ? true : undefined, "aria-busy": busy ? "true" : undefined, on: { click: () => next() } },
        busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon(step === list.length - 1 ? "check" : "arrowRight", 24),
        h("span", { text: busy ? t("auth.creating") : step === list.length - 1 ? t("auth.signup") : t("next") })) : null) : null;
    const switchLink = mode === "offer" ? null : h("button", { class: "auth-switch", type: "button", disabled: busy ? true : undefined, on: { click: () => setMode(mode === "signup" ? "login" : "signup") } },
      icon(mode === "signup" ? "key" : "store", 20), h("span", { text: t(mode === "signup" ? "auth.toLogin" : "auth.toSignup") }));
    fill(el,
      h("p", { class: "auth-notice", role: "note" }, h("span", { class: "ai-ico", "aria-hidden": "true" }, icon("robot", 20)), h("span", { text: t("notice.short") })),
      h("div", { class: "auth-orb" }, orb.el),
      mode === "login" ? langSwitch() : null,
      h("div", { class: "auth-card", dataset: { step: kind || mode } },
        progress,
        answers(),
        ...body,
        fieldError ? h("p", { class: "wel-field-err", id: "auth-err", role: "alert" }, icon("alert", 20), h("span", { text: fieldError })) : null,
        busy && kind && kind.startsWith("pin") ? h("p", { class: "auth-busy", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t(mode === "signup" ? "auth.creating" : "auth.checking") })) : null,
        error ? h("div", { class: "wel-error", role: "alert" }, icon("alert", 22), h("span", { text: error.text }),
          error.action ? h("button", { class: "keycap keycap-ghost keycap-md", type: "button", on: { click: error.action.run } }, icon(error.action.icon, 20), h("span", { text: error.action.label })) : null) : null,
        actions),
      switchLink);
    if (moveFocus || kind) {
      requestAnimationFrame(() => {
        const target = pad ? pad.el : el.querySelector(kind === "lang" ? ".lang-tile" : isText ? "#auth-input" : "#auth-q, .finger-btn");
        if (target && (moveFocus || document.activeElement === document.body || !el.contains(document.activeElement))) target.focus({ preventScroll: true });
      });
    }
  }

  return {
    el,
    update() { render(false); },
    show(nextMode) { if (nextMode && nextMode !== mode && mode !== "offer") setMode(nextMode); else render(false); },
    destroy() { orb.destroy(); },
  };
}
