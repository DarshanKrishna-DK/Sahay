// Sign up, Log in and the first-visit chooser (spec F1; 3.1 rows 56-60), UI v3. One question per
// screen (StepScreen): progress dots, back top-left, the question with a speaker (device voice:
// there is no session yet, so no server read-aloud), the answer in the bottom half, one primary
// button. Rules live in auth-logic.js (tested): steps, D13 auto-advance at 10 valid digits, text
// checks, PIN lock minutes, what each refusal means.
//
//   Chooser  new shop / I have Sahay (each tile says its words on tap)
//   Sign up  language -> phone -> shop -> city -> PIN -> PIN again (-> access code) -> POST /api/auth/register
//   Log in   fingerprint first when this device has a platform passkey, else phone -> PIN
//            -> POST /api/auth/login; PIN_LOCKED shows the minutes left (Retry-After)
//   Offer    "fingerprint next time?" once after sign-up / PIN log-in
//   Legacy   servers without /api/auth: language -> shop -> city (-> code) -> POST /api/session
// The phone is not verified (no OTP yet) and the screen says so.
//
// createAuth({ mode: "choose"|"signup"|"login"|"legacy" }) -> { el, update(), show(mode), destroy() }

import { h, icon, fill } from "./dom.js";
import { t, LANGS, setLang, lang, cityWord } from "./i18n.js";
import * as api from "../api.js";
import * as store from "./store.js";
import { state } from "./store.js";
import { createKeypad } from "./keypad.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { passkeyAvailable, addPasskey, loginWithPasskey, cancelled } from "./passkey.js";
import {
  NAME_MAX, isMobile, fmtPhone, signupSteps, loginSteps, isTextStep, padOutcome, textProblem,
  retryAfterSeconds, signupRefusal, loginRefusal, startMode, CITY_TILES,
} from "./auth-logic.js";
import "./me-strings.js";

const LANG_CODE = { hi: "hi-IN", kn: "kn-IN", en: "en-IN" };
const QUESTION = { lang: "au.lang", phone: "au.phone", name: "au.name", city: "au.city", pin: "au.pin", pin2: "au.pin2", pinEnter: "au.pinEnter", code: "au.code" };
const Q_ICON = { lang: "languages", phone: "phone", name: "store", city: "pin", pin: "lock", pin2: "lock", pinEnter: "lock", code: "key" };

/** The device's own voice for a question (no session yet). Silent where the browser has none. */
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

/** Header/body request that keeps Retry-After (store.agentRequest drops headers). */
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
  const orb = createThinkingOrb({ size: 64, state: "idle" });
  const data = { language: null, phone: "", name: "", city: "", cityOther: false, pin: "", accessCode: "" };
  // The hash decides (#/signup, #/login); otherwise a fresh device starts on the chooser and one
  // that had an account on Log in. "legacy" is the device-only start for servers without accounts.
  let mode = firstMode === "legacy" ? "legacy" : startMode(location.hash, hadAccount); // choose | signup | login | legacy | offer | added
  let step = 0;
  let busy = false;
  let error = null;       // { text, action? } card-level
  let fieldError = null;  // one line under the field
  let finger = null;      // null unknown, then true / false
  let fingerState = null; // null | "waiting" | "cancelled"
  let loginWithPin = false;
  let locked = null;      // { minutes } while PIN log-in is locked
  let pad = null;
  let destroyed = false;

  passkeyAvailable().then((ok) => { finger = ok; if (!destroyed && mode === "login" && !loginWithPin) render(); });

  const accessCodeRequired = () => Boolean(state.config && state.config.accessCodeRequired);
  const legacySteps = () => ["lang", "name", "city", ...(accessCodeRequired() ? ["code"] : [])];
  const steps = () => (mode === "signup" ? signupSteps({ accessCodeRequired: accessCodeRequired() }) : mode === "legacy" ? legacySteps() : loginSteps());
  const language = () => data.language || LANG_CODE[lang()] || "en-IN";
  const textOf = (err, key) => (err && err.status === 0 ? t("err.network") : (err && err.say) || t(key));

  function setMode(next) {
    mode = next; step = 0; error = null; fieldError = null; busy = false; loginWithPin = false; locked = null; fingerState = null;
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
    location.hash = "#/sahay";
    await store.boot({ session: { business } });
  }

  async function register() {
    busy = true; error = null; orb.set("connecting"); render();
    const body = { phone: data.phone, pin: data.pin, name: data.name, city: data.city, language: language() };
    if (accessCodeRequired()) body.accessCode = data.accessCode;
    try {
      const res = await authPost("/api/auth/register", body);
      orb.set("idle");
      await finishSignedIn(res);
    } catch (err) {
      busy = false; orb.set("idle");
      const r = signupRefusal(err, { accessCodeRequired: accessCodeRequired() });
      if (r.kind === "noAccounts") {
        state.accounts = "missing";
        error = { text: t("au.noAccounts"), action: { label: t("au.noAccountStart"), icon: "store", run: startWithoutAccount } };
      } else if (r.kind === "field") {
        if (r.needsCode) state.config.accessCodeRequired = true;
        if (r.clearPin) data.pin = "";
        step = Math.max(0, r.step);
        fieldError = r.key === "auth.badPhone" ? t("au.badPhone") : textOf(err, r.key);
      } else if (r.action === "login") {
        error = { text: err.say || t("au.phoneTaken"), action: { label: t("au.login"), icon: "key", run: () => { const p = data.phone; setMode("login"); data.phone = p; step = 1; render(true); } } };
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
    busy = true; error = null; fieldError = null; orb.set("thinking"); render();
    try {
      const res = await authPost("/api/auth/login", { phone: data.phone, pin: data.pin, language: language() });
      orb.set("idle");
      if (res.business && res.business.language) setLang(res.business.language);
      await finishSignedIn(res);
    } catch (err) {
      busy = false; orb.set("idle"); data.pin = "";
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
    busy = true; error = null; fingerState = "waiting"; orb.set("connecting"); render();
    try {
      const res = await loginWithPasskey(isMobile(data.phone) ? data.phone : undefined);
      orb.set("idle");
      if (res.business && res.business.language) setLang(res.business.language);
      await finishSignedIn(res, { offer: false });
    } catch (err) {
      busy = false; orb.set("idle");
      if (cancelled(err)) fingerState = "cancelled";
      else { fingerState = null; loginWithPin = true; error = { text: (err && err.say) || t("au.fingerFail") }; }
      render(true);
    }
  }

  async function offerYes() {
    busy = true; error = null; render();
    try {
      await addPasskey();
      busy = false;
      mode = "added";
      render(true);
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
      if (!isMobile(value)) { fieldError = t("au.badPhone"); render(); if (pad) pad.shake(); return; }
      data.phone = value;
    } else if (kind === "pin") {
      data.pin = value;
    } else if (kind === "pin2") {
      if (value !== data.pin) { data.pin = ""; step = steps().indexOf("pin"); fieldError = t("au.pinMismatch"); render(true); if (pad) pad.shake(); return; }
    } else if (kind === "pinEnter") {
      data.pin = value; login(); return;
    } else if (isTextStep(kind)) {
      const input = el.querySelector("#auth-input");
      const v = (value !== undefined ? value : input ? input.value : "").trim();
      const problem = textProblem(kind, v);
      if (problem) { fieldError = t(problem); render(); const i = el.querySelector("#auth-input"); if (i) i.focus(); return; }
      if (kind === "code") data.accessCode = v; else data[kind] = v;
    }
    const list = steps();
    if (step === list.length - 1) {
      if (mode === "signup") register();
      else if (mode === "legacy") startWithoutAccount();
      return;
    }
    step += 1;
    render(true);
  }

  function back() {
    if (busy) return;
    if (mode === "login" && step === 0 && loginWithPin && finger) { loginWithPin = false; error = null; fieldError = null; render(true); return; }
    if (step === 0) { if (mode === "signup" || mode === "login") { mode = "choose"; error = null; fieldError = null; history.replaceState(null, "", "#/signup"); render(true); } return; }
    step -= 1; fieldError = null; error = null;
    if (steps()[step] === "pin") data.pin = "";
    render(true);
  }

  function chooseLang(code) {
    data.language = code;
    setLang(code);
    next();
  }

  /* ------------------------------------------------------------ pieces -- */
  function hearButton(text) {
    if (!canSay()) return null;
    return h("button", { class: "icon-btn auth-hear tip-end", type: "button", "aria-label": t("au.hear"), dataset: { tip: t("au.hear") }, on: { click: () => sayLocal(text) } }, icon("speaker", 24));
  }

  function topBar({ canBack, progress }) {
    return h("div", { class: "auth-bar" },
      canBack ? h("button", { class: "icon-btn auth-back tip-below", type: "button", "aria-label": t("back"), dataset: { tip: t("back") }, disabled: busy ? true : undefined, on: { click: back } }, icon("arrowLeft", 24)) : h("span", { class: "auth-bar-gap", "aria-hidden": "true" }),
      progress || h("span", { class: "auth-bar-fill", "aria-hidden": "true" }),
      h("p", { class: "pill auth-notice", role: "note" }, icon("robot", 18), h("span", { text: t("notice.short") })));
  }

  function dots(list) {
    return h("ol", { class: "auth-dots", "aria-label": t("au.step", { n: step + 1, total: list.length }) },
      ...list.map((_, i) => h("li", { class: i < step ? "is-done" : i === step ? "is-now" : "", "aria-current": i === step ? "step" : undefined })));
  }

  function question(kind, text, extraClass = "") {
    return h("div", { class: "auth-qrow" },
      h("h1", { id: "auth-q", class: `auth-q ${extraClass}`, tabindex: "-1" },
        h("span", { class: "auth-q-ico", "aria-hidden": "true" }, icon(Q_ICON[kind] || "spark", 28)),
        h("span", { text })),
      hearButton(text));
  }

  /** Answers so far as chips the owner can tap to change. */
  function answers() {
    if (mode !== "signup" && mode !== "legacy") return null;
    const list = steps();
    const kind = list[step];
    const chips = [];
    if (data.phone && list.indexOf("phone") > -1 && step > list.indexOf("phone")) chips.push(["phone", `+91 ${fmtPhone(data.phone)}`, "phone"]);
    if (data.name && step > list.indexOf("name")) chips.push(["store", data.name, "name"]);
    if (data.city && step > list.indexOf("city")) chips.push(["pin", cityWord(data.city), "city"]);
    if (!chips.length || kind === "lang") return null;
    return h("ul", { class: "auth-answers" }, ...chips.map(([ic, text, k]) => h("li", {},
      h("button", { class: "chip auth-answer", type: "button", disabled: busy ? true : undefined, "aria-label": `${t("au.change")}: ${text}`,
        on: { click: () => { step = steps().indexOf(k); fieldError = null; error = null; if (k === "pin") data.pin = ""; render(true); } } },
      icon(ic, 18), h("span", { text })))));
  }

  function fieldErrorLine() {
    return fieldError ? h("p", { class: "field-error auth-field-error", id: "auth-err", role: "alert" }, icon("alert", 20), h("span", { text: fieldError })) : null;
  }

  function errorBox() {
    if (!error) return null;
    return h("div", { class: "error-box auth-error", role: "alert" },
      h("p", { class: "error-line" }, icon("alert", 22), h("span", { text: error.text })),
      error.action ? h("button", { class: "keycap keycap-secondary keycap-md keycap-block", type: "button", disabled: busy ? true : undefined, on: { click: error.action.run } }, icon(error.action.icon, 22), h("span", { text: error.action.label })) : null);
  }

  function langStep() {
    return [
      h("div", { class: "auth-qrow" },
        h("h1", { id: "auth-q", class: "auth-q auth-q-tri", tabindex: "-1" },
          h("span", { lang: "hi", text: t("au.lang", null, "hi") }),
          h("span", { lang: "kn", text: t("au.lang", null, "kn") }),
          h("span", { lang: "en", text: t("au.lang", null, "en") }))),
      h("div", { class: "auth-answer-zone" },
        h("div", { class: "choices auth-langs", role: "radiogroup", "aria-labelledby": "auth-q" },
          ...LANGS.map((L) => h("button", {
            class: `choice auth-lang auth-lang-${L.short}`, type: "button", role: "radio", lang: L.short,
            "aria-checked": String(data.language === L.code), disabled: busy ? true : undefined,
            on: { click: () => { sayLocal(L.native, L.short); chooseLang(L.code); } },
          }, h("span", { class: "auth-lang-script", text: L.native }), h("span", { class: "auth-lang-go", "aria-hidden": "true" }, icon("arrowRight", 24)))))),
    ];
  }

  function padStep(kind) {
    const pinKind = kind !== "phone";
    const label = t(QUESTION[kind]);
    pad = createKeypad({
      length: pinKind ? 4 : 10, mask: pinKind, label,
      format: pinKind ? null : (d) => [h("span", { class: "pad-prefix", text: "+91 " }), fmtPhone(d)],
      onDone: next, autoAdvance: true,
    });
    // D13 with the older keypad (no autoAdvance): move on at 10 valid digits without a Done tap.
    if (!pinKind && typeof pad.setLocked !== "function") {
      const check = () => { if (padOutcome("phone", pad.value) === "advance") next(pad.value); };
      pad.el.addEventListener("click", check);
      pad.el.addEventListener("keydown", (e) => { if (/^[0-9]$/.test(e.key)) check(); });
      pad.el.addEventListener("paste", () => setTimeout(check, 0));
    }
    if (busy) pad.setBusy(true);
    if (kind === "pinEnter" && locked && typeof pad.setLocked === "function") pad.setLocked(locked.minutes ? t("au.locked", { n: locked.minutes }) : t("au.lockedSoon"));
    if (fieldError && typeof pad.setError === "function") pad.setError(null); // the line below the pad carries it
    const lockedBox = kind === "pinEnter" && locked ? h("div", { class: "auth-locked", role: "alert" },
      h("span", { class: "auth-locked-mark", "aria-hidden": "true" }, icon("lock", 30)),
      h("p", { class: "auth-locked-title", text: locked.minutes ? t("au.locked", { n: locked.minutes }) : t("au.lockedSoon") }),
      h("p", { class: "auth-locked-why", text: finger ? t("au.lockedWhy") : t("au.lockedWhyNoFinger") }),
      finger ? h("button", { class: "keycap keycap-primary keycap-md keycap-block", type: "button", on: { click: () => { loginWithPin = false; locked = null; render(true); fingerLogin(); } } }, icon("fingerprint", 24), h("span", { text: t("au.finger") })) : null) : null;
    return [
      question(kind, label),
      kind === "pin" ? h("p", { class: "auth-why", text: t("au.pinWhy") }) : null,
      kind === "phone" ? h("div", { class: "auth-honest", role: "note" },
        h("p", { class: "pill pill-wait" }, icon("alert", 18), h("span", { text: t("au.notVerified") })),
        h("p", { class: "auth-honest-why", text: t("au.notVerifiedWhy") })) : null,
      h("div", { class: "auth-answer-zone auth-pad-zone" },
        lockedBox || pad.el,
        fieldErrorLine(),
        busy ? h("p", { class: "auth-busy", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t(mode === "signup" ? "au.creating" : "au.checking") })) : null),
    ];
  }

  function dictateButton(input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const btn = h("button", { class: "icon-btn icon-btn-md auth-mic tip-end", type: "button", "aria-label": t("au.speak"), dataset: { tip: t("au.speak") } }, icon("mic", 26));
    btn.addEventListener("click", () => {
      let rec;
      try { rec = new SR(); } catch { return; }
      let heard = false;
      rec.lang = language();
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", t("au.listening"));
      btn.dataset.tip = t("au.listening");
      rec.onresult = (e) => {
        const said = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
        if (said) { heard = true; input.value = said.trim().slice(0, NAME_MAX); input.dispatchEvent(new Event("input")); }
      };
      rec.onend = () => {
        btn.removeAttribute("aria-pressed");
        btn.setAttribute("aria-label", t("au.speak"));
        btn.dataset.tip = t("au.speak");
        if (!heard) { fieldError = t("au.heardNothing"); const zone = el.querySelector(".auth-field-slot"); if (zone) fill(zone, fieldErrorLine()); }
      };
      rec.onerror = () => {};
      try { rec.start(); } catch { rec.onend(); }
    });
    return btn;
  }

  function textField(kind) {
    const value = kind === "code" ? data.accessCode : data[kind] || "";
    const input = h("input", {
      id: "auth-input", class: "field-input auth-input", type: kind === "code" ? "password" : "text",
      maxlength: kind === "code" ? 200 : NAME_MAX,
      autocomplete: kind === "name" ? "organization" : kind === "city" ? "address-level2" : "off",
      enterkeyhint: "next", "aria-invalid": fieldError ? "true" : undefined, "aria-describedby": fieldError ? "auth-err" : undefined,
      disabled: busy ? true : undefined,
    });
    input.value = kind === "city" && !CITY_TILES.includes(value) ? value : kind === "city" ? "" : value;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
    input.addEventListener("input", () => {
      if (!fieldError) return;
      fieldError = null; input.removeAttribute("aria-invalid");
      const slot = el.querySelector(".auth-field-slot"); if (slot) fill(slot);
    });
    return h("label", { class: "field auth-field", for: "auth-input" },
      h("span", { class: "field-label", text: kind === "city" ? t("au.cityType") : t(QUESTION[kind]) }),
      h("span", { class: "field-row auth-field-row" }, input, kind !== "code" ? dictateButton(input) : null),
      h("span", { class: "auth-field-slot" }, fieldErrorLine()));
  }

  function primary(word, ic, onClick) {
    return h("button", { class: "keycap keycap-primary keycap-lg keycap-block auth-primary", type: "button", "aria-busy": busy ? "true" : undefined, disabled: busy ? true : undefined, on: { click: onClick } },
      busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon(ic, 26), h("span", { text: word }));
  }

  function textStep(kind) {
    const list = steps();
    const last = step === list.length - 1;
    const word = busy ? t("au.creating") : last ? (mode === "legacy" ? t("au.start") : t("au.make")) : t("next");
    const zone = [];
    if (kind === "city") {
      zone.push(h("div", { class: "choices auth-cities", role: "radiogroup", "aria-label": t("au.city") },
        ...CITY_TILES.map((c) => h("button", {
          class: "choice auth-city", type: "button", role: "radio", "aria-checked": String(data.city === c && !data.cityOther), disabled: busy ? true : undefined,
          on: { click: () => { data.city = c; data.cityOther = false; next(c); } },
        }, h("span", { class: "auth-city-word", lang: lang(), text: cityWord(c) })))));
    }
    zone.push(textField(kind));
    zone.push(primary(word, last ? "check" : "arrowRight", () => next()));
    return [
      question(kind, t(QUESTION[kind])),
      kind === "code" ? h("p", { class: "auth-why", text: t("au.codeWhy") }) : null,
      h("div", { class: "auth-answer-zone" }, ...zone),
    ];
  }

  function chooser() {
    const tile = (id, ic, word, sub) => h("button", {
      class: `auth-choose-tile auth-choose-${id}`, type: "button",
      on: { click: () => { sayLocal(word); setMode(id === "new" ? "signup" : "login"); } },
    }, h("span", { class: "auth-choose-ico", "aria-hidden": "true" }, icon(ic, 34)),
    h("span", { class: "auth-choose-text" }, h("span", { class: "auth-choose-word", text: word }), h("span", { class: "auth-choose-sub", text: sub })),
    h("span", { class: "auth-choose-go", "aria-hidden": "true" }, icon("arrowRight", 24)));
    return [
      h("div", { class: "auth-orb", "aria-hidden": "true" }, orb.el),
      question("lang", t("au.chooseQ"), "auth-q-center"),
      langChips(),
      h("div", { class: "auth-answer-zone auth-choose" },
        tile("new", "store", t("au.new"), t("au.newSub")),
        tile("have", "key", t("au.have"), t("au.haveSub"))),
    ];
  }

  /** Small three-script switch for the chooser and Log in (errors come back in the language sent). */
  function langChips() {
    return h("div", { class: "auth-lang-chips", role: "radiogroup", "aria-label": t("au.langSwitch") },
      ...LANGS.map((L) => h("button", { class: "chip auth-lang-chip", type: "button", role: "radio", lang: L.short, "aria-checked": String(lang() === L.short),
        on: { click: () => { data.language = L.code; setLang(L.code); render(); } } }, h("span", { text: L.native }))));
  }

  function fingerFirst() {
    const waiting = fingerState === "waiting";
    return [
      h("div", { class: "auth-orb", "aria-hidden": "true" }, orb.el),
      question("pinEnter", t("au.loginQ"), "auth-q-center"),
      langChips(),
      h("div", { class: "auth-answer-zone auth-finger-zone" },
        h("button", { class: `auth-finger${waiting ? " is-waiting" : ""}`, type: "button", "aria-label": t("au.fingerLong"), "aria-busy": waiting ? "true" : undefined, disabled: busy ? true : undefined, on: { click: fingerLogin } },
          h("span", { class: "auth-finger-ring", "aria-hidden": "true" }, icon("fingerprint", 64)),
          h("span", { class: "auth-finger-word", text: waiting ? t("au.fingerWait") : t("au.finger") })),
        fingerState === "cancelled" ? h("p", { class: "note-line", role: "status" }, icon("info", 20), h("span", { text: t("au.fingerCancelled") })) : null,
        h("button", { class: "keycap keycap-secondary keycap-md keycap-block", type: "button", disabled: busy ? true : undefined, on: { click: () => { loginWithPin = true; step = 0; fingerState = null; render(true); } } },
          icon("lock", 22), h("span", { text: t("au.usePin") }))),
    ];
  }

  function offer() {
    return [
      h("div", { class: "auth-qrow" }, h("h1", { id: "auth-q", class: "auth-q auth-q-center", tabindex: "-1" }, h("span", { text: t("au.offerQ") })), hearButton(t("au.offerQ"))),
      h("p", { class: "auth-why auth-why-center", text: t("au.offerWhy") }),
      h("div", { class: "auth-answer-zone auth-finger-zone" },
        h("span", { class: "auth-finger-ring is-still", "aria-hidden": "true" }, icon("fingerprint", 64)),
        h("div", { class: "auth-actions" },
          h("button", { class: "keycap keycap-ghost keycap-md", type: "button", disabled: busy ? true : undefined, on: { click: () => enterApp(state.business) } }, h("span", { text: t("au.later") })),
          h("button", { class: "keycap keycap-primary keycap-md", type: "button", disabled: busy ? true : undefined, "aria-busy": busy ? "true" : undefined, on: { click: offerYes } },
            busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("fingerprint", 24), h("span", { text: t("au.offerYes") })))),
    ];
  }

  function added() {
    return [
      h("div", { class: "auth-done", role: "status" },
        h("span", { class: "auth-done-mark", "aria-hidden": "true" }, icon("check", 48)),
        h("h1", { id: "auth-q", class: "auth-q auth-q-center", tabindex: "-1" }, h("span", { text: t("au.added") })),
        h("p", { class: "auth-why auth-why-center", text: t("au.ready") })),
    ];
  }

  /* ------------------------------------------------------------ render -- */
  function render(moveFocus = false) {
    pad = null;
    let body;
    let kind = null;
    let canBack = false;
    let progress = null;
    if (mode === "choose") body = chooser();
    else if (mode === "offer") body = offer();
    else if (mode === "added") body = added();
    else if (mode === "login" && !loginWithPin && finger) { body = fingerFirst(); canBack = true; }
    else {
      const list = steps();
      kind = list[step];
      body = kind === "lang" ? langStep() : isTextStep(kind) ? textStep(kind) : padStep(kind);
      canBack = step > 0 || mode === "signup" || mode === "login";
      if (mode === "signup" || mode === "legacy") progress = dots(list);
    }
    el.dataset.mode = mode;
    el.dataset.step = kind || mode;
    fill(el,
      h("div", { class: "auth-card" },
        topBar({ canBack, progress }),
        answers(),
        ...body,
        errorBox()),
      mode === "signup" || mode === "login" ? h("button", { class: "auth-switch", type: "button", disabled: busy ? true : undefined, on: { click: () => setMode(mode === "signup" ? "login" : "signup") } },
        icon(mode === "signup" ? "key" : "store", 20), h("span", { text: t(mode === "signup" ? "au.toLogin" : "au.toSignup") })) : null);
    if (moveFocus || kind) {
      requestAnimationFrame(() => {
        if (destroyed) return;
        const target = pad && !locked ? pad.el : el.querySelector(kind === "lang" ? ".auth-lang" : isTextStep(kind) ? "#auth-input" : "#auth-q");
        if (target && (moveFocus || document.activeElement === document.body || !el.contains(document.activeElement))) target.focus({ preventScroll: true });
      });
    }
  }

  return {
    el,
    update() { render(false); },
    show(nextMode) { if (nextMode && nextMode !== mode && mode !== "offer" && mode !== "added" && mode !== "legacy") setMode(nextMode); else render(false); },
    destroy() { destroyed = true; orb.destroy(); },
  };
}

