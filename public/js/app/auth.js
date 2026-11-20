// Log in, sign up and the fingerprint offer (UI v5, owner W5). Calm and simple: the shell's top bar
// already carries the real logo, the language switch and the automated-assistant line, so this view
// is one centred column: a title, one plain sentence, the answer, one pink button.
//
//   Log in   (screens.md 09) the logo, one sentence, phone number (+91) -> PIN keypad (64px keys,
//            the error between the dots and the keys) -> "Log in" -> POST /api/auth/login; "or" ->
//            "Use passkey" when this device has one; the footer says automated assistant + test mode.
//            Sahay has no SMS codes, so the spec's code boxes are the real 4-number PIN.
//            PIN_LOCKED shows the minutes left (Retry-After). A fresh device starts on Sign up.
//   Sign up  one question per screen (low literacy): language -> phone -> shop name -> city -> PIN ->
//            PIN again (-> access code) -> POST /api/auth/register; the phone is not verified (said)
//   Offer    "fingerprint next time?" once after sign-up / PIN log-in
//   Legacy   servers without /api/auth: language -> shop -> city (-> code) -> POST /api/session
// The rules (steps, checks, refusals, lock minutes) are auth-logic.js (tested); passkeys passkey.js.
//
// createAuth({ mode }) -> { el, update(), show(mode), destroy() }   (registered as AUTH in screens.js)

import { h, icon, fill, scripted, button, phoneField, field, createKeypad, setUiLang, brandMark } from "./ui.js";
import { t, LANGS, lang, cityWord } from "./i18n.js";
import * as api from "../api.js";
import * as store from "./store.js";
import { state } from "./store.js";
import { passkeyAvailable, addPasskey, loginWithPasskey, cancelled } from "./passkey.js";
import {
  NAME_MAX, isMobile, fmtPhone, signupSteps, isTextStep, textProblem,
  retryAfterSeconds, signupRefusal, loginRefusal, startMode, CITY_TILES,
} from "./auth-logic.js";
import "./me-strings.js";
import { addStrings } from "./i18n.js";

addStrings({
  "au5.loginSentence": ["Enter your mobile number, then your 4-number PIN.", "अपना मोबाइल नंबर डालें, फिर 4 अंकों का पिन।", "ನಿಮ್ಮ ಮೊಬೈಲ್ ನಂಬರ್ ಹಾಕಿ, ನಂತರ 4 ಅಂಕಿಯ ಪಿನ್."],
  "au5.fingerSentence": ["Touch the button and use your fingerprint or screen lock.", "बटन दबाइए और उँगली या स्क्रीन लॉक से खोलिए।", "ಬಟನ್ ಒತ್ತಿ, ಬೆರಳಚ್ಚು ಅಥವಾ ಸ್ಕ್ರೀನ್ ಲಾಕ್ ಬಳಸಿ."],
  "au5.chooseSentence": ["Sahay is an automated assistant that buys, bills and keeps your khata, with your yes.", "सहाय एक स्वचालित सहायक है जो आपकी हाँ से खरीदता, बिल बनाता और खाता रखता है।", "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ; ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯಿಂದ ಖರೀದಿ, ಬಿಲ್ ಮತ್ತು ಖಾತೆ ನೋಡಿಕೊಳ್ಳುತ್ತದೆ."],
  "au5.langSentence": ["Sahay will speak to you in this language. You can change it later.", "सहाय आपसे इसी भाषा में बात करेगी। बाद में बदल सकते हैं।", "ಸಹಾಯ್ ಈ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡುತ್ತದೆ. ನಂತರ ಬದಲಿಸಬಹುದು."],
  "au5.phoneSentence": ["Use your own number. You will log in with it.", "अपना ही नंबर डालें। इसी से लॉग इन करेंगे।", "ನಿಮ್ಮದೇ ನಂಬರ್ ಹಾಕಿ. ಇದರಿಂದಲೇ ಲಾಗಿನ್ ಆಗುತ್ತೀರಿ."],
  "au5.nameSentence": ["As customers know it. It goes on your bills.", "जैसा ग्राहक जानते हैं। यह आपके बिल पर छपेगा।", "ಗ್ರಾಹಕರು ತಿಳಿದಿರುವಂತೆ. ಇದು ನಿಮ್ಮ ಬಿಲ್‌ನಲ್ಲಿ ಬರುತ್ತದೆ."],
  "au5.citySentence": ["Sahay looks for sellers near this city.", "सहाय इस शहर के पास विक्रेता ढूँढेगी।", "ಸಹಾಯ್ ಈ ನಗರದ ಹತ್ತಿರ ಮಾರಾಟಗಾರರನ್ನು ಹುಡುಕುತ್ತದೆ."],
  "au5.pin2Sentence": ["Type the same 4 numbers again.", "वही 4 अंक फिर से डालें।", "ಅದೇ 4 ಅಂಕಿಗಳನ್ನು ಮತ್ತೆ ಹಾಕಿ."],
  "au5.tagline": ["Your shop helper that listens and talks.", "आपकी दुकान का सहायक जो सुनता और बोलता है।", "ಕೇಳಿ ಮಾತನಾಡುವ ನಿಮ್ಮ ಅಂಗಡಿಯ ಸಹಾಯಕ."],
  "au5.phoneNumber": ["Phone number", "फ़ोन नंबर", "ಫೋನ್ ನಂಬರ್"],
  "au5.or": ["or", "या", "ಅಥವಾ"],
  "au5.passkey": ["Use passkey", "पासकी से खोलें", "ಪಾಸ್‌ಕೀ ಬಳಸಿ"],
  "au5.autoLogin": ["Log in starts when you enter the 4th number.", "चौथा अंक डालते ही लॉग इन शुरू हो जाएगा।", "4ನೇ ಅಂಕಿ ಹಾಕಿದ ತಕ್ಷಣ ಲಾಗಿನ್ ಶುರುವಾಗುತ್ತದೆ."],
  "au5.footer": ["Sahay is an automated assistant. Payments are in test mode.", "सहाय एक स्वचालित सहायक है। भुगतान टेस्ट मोड में हैं।", "ಸಹಾಯ್ ಒಂದು ಸ್ವಯಂಚಾಲಿತ ಸಹಾಯಕ. ಪಾವತಿಗಳು ಟೆಸ್ಟ್ ಮೋಡ್‌ನಲ್ಲಿವೆ."],
});

const LANG_CODE = { hi: "hi-IN", kn: "kn-IN", en: "en-IN" };
const QUESTION = { lang: "au.lang", phone: "au.phone", name: "au.name", city: "au.city", pin: "au.pin", pin2: "au.pin2", code: "au.code" };
const SENTENCE = { lang: "au5.langSentence", phone: "au5.phoneSentence", name: "au5.nameSentence", city: "au5.citySentence", pin: "au.pinWhy", pin2: "au5.pin2Sentence", code: "au.codeWhy" };
const LANG_NAMES = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

/** The device's own voice (there is no session yet, so no server read-aloud). Silent where none. */
const canSay = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
function sayLocal(text, short = lang()) {
  if (!canSay() || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = LANG_CODE[short] || "en-IN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}

/** POST that keeps Retry-After (store.agentRequest drops headers): the PIN lock's minutes come from it. */
async function authPost(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST", credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch {
    throw new api.ApiError(0, "NETWORK", "Could not reach the Sahay server.");
  }
  let payload = null;
  if ((res.headers.get("content-type") || "").includes("application/json")) {
    try { payload = await res.json(); } catch { payload = null; }
  }
  if (!res.ok) {
    const err = new api.ApiError(res.status, (payload && payload.code) || `HTTP_${res.status}`, (payload && payload.message) || `HTTP ${res.status}`, payload && payload.say);
    err.retryAfterSeconds = retryAfterSeconds(res.headers.get("retry-after"));
    throw err;
  }
  return payload || {};
}

export function createAuth({ mode: firstMode } = {}) {
  let hadAccount = false;
  try { hadAccount = localStorage.getItem("sahay-had-account") === "1"; } catch { /* storage blocked */ }
  const el = h("section", { class: "auth", "aria-labelledby": "auth-q" });
  const data = { language: null, phone: "", name: "", city: "", pin: "", accessCode: "" };
  // Servers without accounts start a device-only shop; otherwise the hash decides, else Sign up on a
  // fresh device and Log in on one that had an account.
  let mode = state.boot === "welcome" || firstMode === "legacy" ? "legacy" : startMode(location.hash, hadAccount);
  if (mode === "choose") mode = "signup"; // a fresh device: the first question is the language
  let step = 0;
  let busy = false;
  let error = null;       // { text, action? } under the form
  let fieldError = null;  // keypad steps: the slot between the dots and the keys; text steps: under the field
  let phoneError = null;  // log in: under the mobile number
  let finger = null;      // null unknown, then true / false
  let fingerState = null; // null | "waiting" | "cancelled"
  let locked = null;      // { minutes } while PIN log-in is locked
  let pad = null;
  let destroyed = false;

  passkeyAvailable().then((ok) => { finger = ok; if (!destroyed && mode === "login") render(); });

  const accessCodeRequired = () => Boolean(state.config && state.config.accessCodeRequired);
  const legacySteps = () => ["lang", "name", "city", ...(accessCodeRequired() ? ["code"] : [])];
  const steps = () => (mode === "legacy" ? legacySteps() : signupSteps({ accessCodeRequired: accessCodeRequired() }));
  const language = () => data.language || LANG_CODE[lang()] || "en-IN";
  const textOf = (err, key) => (err && err.status === 0 ? t("err.network") : (err && err.say) || t(key));

  function setMode(next) {
    mode = next; step = 0; error = null; fieldError = null; phoneError = null; busy = false; locked = null; fingerState = null;
    if (next === "login") data.pin = "";
    if (next === "signup" || next === "login") history.replaceState(null, "", `#/${next}`);
    render(true);
  }

  /* ------------------------------------------------------------ server -- */
  async function finishSignedIn(res, { offer = true } = {}) {
    state.account = res.account || null;
    state.accounts = "ready";
    if (res.business) state.business = res.business;
    try { localStorage.setItem("sahay-had-account", "1"); } catch { /* storage blocked */ }
    let offered = false;
    try { offered = localStorage.getItem("sahay-finger-offered") === "1"; localStorage.setItem("sahay-finger-offered", "1"); } catch { /* storage blocked */ }
    if (offer && finger && res.account && !offered) { mode = "offer"; busy = false; error = null; render(true); return; }
    enterApp(res.business);
  }

  async function enterApp(business) {
    location.hash = "#/home";
    await store.boot({ session: { business } });
  }

  async function register() {
    busy = true; error = null; render();
    const body = { phone: data.phone, pin: data.pin, name: data.name, city: data.city, language: language() };
    if (accessCodeRequired()) body.accessCode = data.accessCode;
    try {
      await finishSignedIn(await authPost("/api/auth/register", body));
    } catch (err) {
      busy = false;
      const r = signupRefusal(err, { accessCodeRequired: accessCodeRequired() });
      if (r.kind === "noAccounts") {
        state.accounts = "missing";
        error = { text: t("au.noAccounts"), action: { word: t("au.noAccountStart"), icon: "store", run: startWithoutAccount } };
      } else if (r.kind === "field") {
        if (r.needsCode) state.config.accessCodeRequired = true;
        if (r.clearPin) data.pin = "";
        step = Math.max(0, r.step);
        fieldError = r.key === "auth.badPhone" ? t("au.badPhone") : textOf(err, r.key);
      } else if (r.action === "login") {
        error = { text: err.say || t("au.phoneTaken"), action: { word: t("au.login"), icon: "key", run: () => { const p = data.phone; setMode("login"); data.phone = p; render(true); } } };
      } else {
        error = { text: textOf(err, r.key) };
      }
      render(true);
    }
  }

  async function startWithoutAccount() {
    busy = true; error = null; render();
    try {
      const session = await api.openSession({ name: data.name, city: data.city, language: language(), ...(accessCodeRequired() && data.accessCode ? { accessCode: data.accessCode } : {}) });
      await enterApp(session.business);
    } catch (err) {
      busy = false;
      if (err.code === "ACCESS_CODE_REQUIRED") {
        state.config.accessCodeRequired = true;
        if (mode === "legacy") { step = legacySteps().indexOf("code"); fieldError = textOf(err, "err.codeEmpty"); }
        else error = { text: textOf(err, "err.codeEmpty") };
      } else error = { text: textOf(err, "err.save") };
      render(true);
    }
  }

  async function login() {
    busy = true; error = null; fieldError = null; phoneError = null; render();
    try {
      await finishSignedIn(await authPost("/api/auth/login", { phone: data.phone, pin: data.pin, language: language() }));
    } catch (err) {
      busy = false; data.pin = "";
      const r = loginRefusal(err);
      if (r.kind === "locked") locked = { minutes: r.minutes };
      else if (r.kind === "wrong") fieldError = err.say || t("au.wrongPin");
      else if (r.kind === "noAccounts") error = { text: t("au.noAccounts") };
      else error = { text: textOf(err, r.key) };
      render(true);
      if (pad && r.kind === "wrong") pad.shake();
    }
  }

  async function fingerLogin() {
    busy = true; error = null; fingerState = "waiting"; render();
    try {
      await finishSignedIn(await loginWithPasskey(isMobile(data.phone) ? data.phone : undefined), { offer: false });
    } catch (err) {
      busy = false;
      if (cancelled(err)) fingerState = "cancelled";
      else { fingerState = null; error = { text: (err && err.say) || t("au.fingerFail") }; }
      render(true);
    }
  }

  async function offerYes() {
    busy = true; error = null; render();
    try {
      await addPasskey();
      busy = false; mode = "added"; render(true);
      setTimeout(() => enterApp(state.business), 900);
    } catch (err) {
      busy = false;
      if (cancelled(err)) { enterApp(state.business); return; }
      error = { text: t("au.addFail") };
      render();
    }
  }

  /* -------------------------------------------------------------- flow -- */
  function next(value) {
    if (busy) return;
    const kind = steps()[step];
    fieldError = null; error = null;
    if (kind === "phone") {
      const v = value !== undefined ? value : data.phone;
      if (!isMobile(v)) { fieldError = t("au.badPhone"); render(); focusInput(); return; }
      data.phone = v;
    } else if (kind === "pin") {
      data.pin = value;
    } else if (kind === "pin2") {
      if (value !== data.pin) { data.pin = ""; step = steps().indexOf("pin"); fieldError = t("au.pinMismatch"); render(true); if (pad) pad.shake(); return; }
    } else if (isTextStep(kind)) {
      const input = el.querySelector("#auth-input");
      const v = (value !== undefined ? value : input ? input.value : "").trim();
      const problem = textProblem(kind, v);
      if (problem) { fieldError = t(problem); render(); focusInput(); return; }
      if (kind === "code") data.accessCode = v; else data[kind] = v;
    }
    if (step === steps().length - 1) {
      if (mode === "signup") register(); else startWithoutAccount();
      return;
    }
    step += 1;
    render(true);
  }

  function back() {
    if (busy) return;
    locked = null; fingerState = null; error = null; fieldError = null; phoneError = null;
    if (mode === "login") return;
    if (step === 0) return;
    step -= 1;
    if (steps()[step] === "pin") data.pin = "";
    render(true);
  }

  // The sign-up language is the shop's voice language (sent to the server); the words on this
  // device follow it too, through the same per-device choice the language switch sets.
  function chooseLang(code) {
    data.language = code;
    setUiLang(code);
    next();
  }

  const focusInput = () => requestAnimationFrame(() => { const i = el.querySelector("#auth-input, #auth-phone input, .phone-field input"); if (i) i.focus(); });

  /* ------------------------------------------------------------ pieces -- */
  function head(title, sentence, { stepLine = null, canBack = false } = {}) {
    return h("header", { class: "auth-head" },
      canBack || stepLine ? h("div", { class: "auth-nav" },
        canBack ? h("button", { class: "icon-btn auth-back", type: "button", "aria-label": t("back"), dataset: { tip: t("back") }, disabled: busy ? true : undefined, on: { click: back } }, icon("arrowLeft", 22)) : null,
        stepLine) : null,
      h("div", { class: "auth-title-row" },
        scripted("h1", title, { class: "auth-title", id: "auth-q", tabindex: "-1" }),
        canSay() ? h("button", { class: "icon-btn auth-hear", type: "button", "aria-label": t("au.hear"), dataset: { tip: t("au.hear") }, on: { click: () => sayLocal(`${title}. ${sentence || ""}`) } }, icon("speaker", 22)) : null),
      sentence ? scripted("p", sentence, { class: "auth-sentence" }) : null);
  }

  function stepLine(list) {
    const n = step + 1;
    return h("div", { class: "auth-step", role: "img", "aria-label": t("au.step", { n, total: list.length }) },
      h("span", { class: "auth-step-text", text: t("au.step", { n, total: list.length }) }),
      h("span", { class: "auth-step-bar", "aria-hidden": "true" }, h("span", { class: "auth-step-fill", style: `width:${Math.round((n / list.length) * 100)}%` })));
  }

  function errorBox() {
    if (!error) return null;
    return h("div", { class: "auth-error", role: "alert" },
      h("p", { class: "error-line" }, icon("alert", 18), scripted("span", error.text)),
      error.action ? button({ word: error.action.word, icon: error.action.icon, kind: "secondary", block: true, onClick: error.action.run }) : null);
  }

  const slotError = () => (fieldError ? h("p", { class: "error-line auth-field-error", role: "alert" }, icon("alert", 18), scripted("span", fieldError)) : null);

  function makePad({ length, label, onDone, kind }) {
    pad = createKeypad({ length, mask: true, label, onDone, autoAdvance: true });
    if (busy) pad.setBusy(true);
    if (fieldError) pad.setError(fieldError);
    if (kind === "pinEnter" && locked) pad.setLocked(locked.minutes ? t("au.locked", { n: locked.minutes }) : t("au.lockedSoon"));
    return pad.el;
  }

  function lockedView() {
    return h("div", { class: "auth-locked", role: "alert" },
      h("span", { class: "auth-locked-ico", "aria-hidden": "true" }, icon("lock", 26)),
      scripted("p", locked.minutes ? t("au.locked", { n: locked.minutes }) : t("au.lockedSoon"), { class: "auth-locked-title" }),
      scripted("p", finger ? t("au.lockedWhy") : t("au.lockedWhyNoFinger"), { class: "auth-locked-text" }),
      finger ? button({ word: t("au5.passkey"), icon: "fingerprint", kind: "secondary", block: true, onClick: () => { locked = null; render(true); fingerLogin(); } }) : null);
  }

  function dictate(input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const btn = h("button", { class: "icon-btn auth-mic", type: "button", "aria-label": t("au.speak"), dataset: { tip: t("au.speak") } }, icon("mic", 22));
    btn.addEventListener("click", () => {
      let rec;
      try { rec = new SR(); } catch { return; }
      let heard = false;
      rec.lang = language();
      rec.interimResults = false;
      btn.setAttribute("aria-pressed", "true");
      rec.onresult = (e) => {
        const said = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
        if (said) { heard = true; input.value = said.trim().slice(0, NAME_MAX); input.dispatchEvent(new Event("input")); }
      };
      rec.onend = () => {
        btn.removeAttribute("aria-pressed");
        if (!heard) { fieldError = t("au.heardNothing"); const s = el.querySelector(".auth-slot"); if (s) fill(s, slotError()); }
      };
      rec.onerror = () => {};
      try { rec.start(); } catch { rec.onend(); }
    });
    return btn;
  }

  /* ----------------------------------------------------------- screens -- */
  function submitLogin() {
    if (busy) return;
    const v = pad ? pad.value : data.pin;
    if (!isMobile(data.phone)) {
      phoneError = t("au.badPhone"); fieldError = null; render(); focusInput();
      return;
    }
    if (!v || v.length !== 4) { fieldError = t("au.pinNeed"); render(); if (pad) pad.shake(); return; }
    data.pin = v;
    login();
  }

  /** screens.md 09: phone number, the PIN keypad, Log in; "or" Use passkey; New shop? Sign up. */
  function loginForm() {
    const phone = phoneField({
      label: t("au5.phoneNumber"), value: data.phone,
      onInput: (d) => { data.phone = d; if (phoneError) { phoneError = null; phone.input.removeAttribute("aria-invalid"); const s = el.querySelector(".auth-phone-slot"); if (s) fill(s); } },
    });
    phone.el.id = "auth-phone";
    phone.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (pad) pad.focus(); } });
    if (phoneError) phone.input.setAttribute("aria-invalid", "true");
    const waiting = fingerState === "waiting";
    return [
      h("h1", { class: "sr-only", id: "auth-q", tabindex: "-1", text: t("au.login") }),
      h("div", { class: "auth-form" },
        phone.el,
        h("span", { class: "auth-phone-slot" }, phoneError ? h("p", { class: "error-line", role: "alert" }, icon("alert", 18), scripted("span", phoneError)) : null),
        h("p", { class: "field-label auth-pin-label", id: "auth-pin-label", text: t("au.pinLabel") }),
        locked ? null : scripted("p", t("au5.autoLogin"), { class: "auth-note", id: "auth-pin-note" }),
        locked ? lockedView() : makePad({ length: 4, label: t("au.pinLabel"), kind: "pinEnter", onDone: (v) => { data.pin = v; submitLogin(); } }),
        locked ? null : button({ word: busy && !waiting ? t("au.checking") : t("au.login"), icon: busy ? null : "arrowRight", kind: "primary", block: true, busy: busy && !waiting, onClick: submitLogin })),
      finger ? h("div", { class: "auth-or", role: "separator" }, h("span", { text: t("au5.or") })) : null,
      finger ? button({ word: waiting ? t("au.fingerWait") : t("au5.passkey"), icon: waiting ? null : "fingerprint", kind: "secondary", block: true, busy: waiting, label: t("au.fingerLong"), onClick: fingerLogin }) : null,
      fingerState === "cancelled" ? h("p", { class: "note-line", role: "status" }, icon("info", 18), scripted("span", t("au.fingerCancelled"))) : null,
    ];
  }

  function langStep(list) {
    return [
      head(t("au.lang"), t("au5.langSentence"), { stepLine: stepLine(list) }),
      h("div", { class: "auth-langs", role: "radiogroup", "aria-labelledby": "auth-q" },
        ...LANGS.map((L) => h("button", {
          class: "card auth-lang", type: "button", role: "radio", lang: L.short, "aria-checked": String(data.language === L.code), disabled: busy ? true : undefined,
          on: { click: () => { sayLocal(LANG_NAMES[L.short], L.short); chooseLang(L.code); } },
        }, h("span", { class: "auth-lang-name", text: LANG_NAMES[L.short] }), icon("chevronRight", 22, "auth-choice-chev")))),
    ];
  }

  function phoneStep(list) {
    const phone = phoneField({
      label: t("au.mobileLabel"), value: data.phone,
      onInput: (d) => {
        data.phone = d;
        if (fieldError) { fieldError = null; const s = el.querySelector(".auth-slot"); if (s) fill(s); }
        if (isMobile(d)) next(d); // D13: the tenth valid digit moves on by itself
      },
    });
    phone.el.id = "auth-phone";
    phone.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(phone.value); } });
    if (fieldError) phone.input.setAttribute("aria-invalid", "true");
    return [
      head(t("au.phone"), t("au5.phoneSentence"), { stepLine: stepLine(list), canBack: true }),
      h("div", { class: "auth-form" },
        phone.el,
        h("span", { class: "auth-slot" }, slotError()),
        h("div", { class: "auth-honest", role: "note" },
          h("span", { class: "chip chip-warn" }, icon("alert", 16), scripted("span", t("au.notVerified"))),
          scripted("p", t("au.notVerifiedWhy"), { class: "auth-honest-text" })),
        button({ word: t("next"), icon: "arrowRight", kind: "primary", block: true, onClick: () => next(phone.value) })),
    ];
  }

  function textStep(kind, list) {
    const last = step === list.length - 1;
    const f = field({ label: kind === "city" ? t("au.cityType") : t(QUESTION[kind]), value: kind === "code" ? data.accessCode : (kind === "city" && CITY_TILES.includes(data.city) ? "" : data[kind] || ""), type: kind === "code" ? "password" : "text", autocomplete: kind === "name" ? "organization" : kind === "city" ? "address-level2" : "off", maxlength: kind === "code" ? 200 : NAME_MAX });
    f.input.id = "auth-input";
    f.input.setAttribute("enterkeyhint", "next");
    f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
    f.input.addEventListener("input", () => { if (fieldError) { fieldError = null; const s = el.querySelector(".auth-slot"); if (s) fill(s); } });
    const mic = kind !== "code" ? dictate(f.input) : null;
    if (mic) f.input.after(mic);
    if (mic) f.input.parentNode.classList.add("auth-field-mic");
    return [
      head(t(QUESTION[kind]), t(SENTENCE[kind]), { stepLine: stepLine(list), canBack: true }),
      h("div", { class: "auth-form" },
        kind === "city" ? h("div", { class: "auth-cities", role: "radiogroup", "aria-label": t("au.city") },
          ...CITY_TILES.map((c) => h("button", {
            class: "seg-opt auth-city", type: "button", role: "radio", "aria-checked": String(data.city === c), disabled: busy ? true : undefined,
            on: { click: () => { data.city = c; next(c); } },
          }, scripted("span", cityWord(c))))) : null,
        f.el,
        h("span", { class: "auth-slot" }, slotError()),
        button({ word: busy ? t("au.creating") : last ? (mode === "legacy" ? t("au.start") : t("au.make")) : t("next"), icon: busy ? null : last ? "check" : "arrowRight", kind: "primary", block: true, busy, onClick: () => next() })),
    ];
  }

  function pinStep(kind, list) {
    return [
      head(t(QUESTION[kind]), t(SENTENCE[kind]), { stepLine: stepLine(list), canBack: true }),
      h("div", { class: "auth-form" },
        makePad({ length: 4, label: t(QUESTION[kind]), kind, onDone: (v) => next(v) }),
        busy ? h("p", { class: "auth-busy", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), scripted("span", t("au.creating"))) : null),
    ];
  }

  function offer() {
    return [
      head(t("au.offerQ"), t("au.offerWhy")),
      h("div", { class: "auth-finger-zone" },
        h("span", { class: "auth-finger-ring is-still", "aria-hidden": "true" }, icon("fingerprint", 56)),
        h("div", { class: "auth-actions" },
          button({ word: t("au.later"), kind: "secondary", onClick: () => enterApp(state.business) }),
          button({ word: t("au.offerYes"), icon: "fingerprint", kind: "primary", busy, onClick: offerYes }))),
    ];
  }

  function added() {
    return [h("div", { class: "auth-done", role: "status" },
      h("span", { class: "auth-done-ico", "aria-hidden": "true" }, icon("check", 36)),
      scripted("h1", t("au.added"), { class: "auth-title", id: "auth-q", tabindex: "-1" }),
      scripted("p", t("au.ready"), { class: "auth-sentence" }))];
  }

  /* ------------------------------------------------------------ render -- */
  function render(moveFocus = false) {
    pad = null;
    let body;
    let kind = mode;
    if (mode === "offer") body = offer();
    else if (mode === "added") body = added();
    else if (mode === "login") body = loginForm();
    else {
      const list = steps();
      kind = list[step];
      body = kind === "lang" ? langStep(list) : kind === "phone" ? phoneStep(list) : isTextStep(kind) ? textStep(kind, list) : pinStep(kind, list);
    }
    el.dataset.mode = mode;
    el.dataset.step = kind;
    fill(el,
      h("div", { class: "auth-col" },
        h("div", { class: "auth-brand" }, brandMark({ word: true, size: 56, href: null }),
          mode === "login" ? scripted("p", t("au5.tagline"), { class: "auth-sentence auth-tagline" }) : null),
        ...body,
        errorBox(),
        mode === "signup" || mode === "login" ? h("p", { class: "auth-switch" },
          scripted("span", t(mode === "signup" ? "au.haveQ" : "au.newQ")),
          h("button", { class: "link-btn", type: "button", disabled: busy ? true : undefined, on: { click: () => setMode(mode === "signup" ? "login" : "signup") } },
            scripted("span", t(mode === "signup" ? "au.login" : "au.signUp")))) : null,
        scripted("p", t("au5.footer"), { class: "auth-footer" })));
    if (moveFocus) {
      requestAnimationFrame(() => {
        if (destroyed) return;
        let target = null;
        if (mode === "login") target = isMobile(data.phone) && pad && !locked ? pad.el : el.querySelector("#auth-phone input");
        else if (pad) target = pad.el;
        else target = el.querySelector("#auth-input, #auth-phone input") || el.querySelector("#auth-q");
        if (target) target.focus({ preventScroll: true });
      });
    }
  }

  render(false);
  return {
    el,
    update() { render(false); },
    show(nextMode) { if (nextMode && nextMode !== mode && mode !== "offer" && mode !== "added" && mode !== "legacy") setMode(nextMode); else render(false); },
    destroy() { destroyed = true; },
  };
}

