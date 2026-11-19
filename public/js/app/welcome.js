// First visit: language (three script tiles), shop name, city, and the access code only when
// this server needs one. One question per screen, then POST /api/session and into the app.

import { h, icon, fill } from "./dom.js";
import { t, LANGS, setLang, lang } from "./i18n.js";
import * as api from "../api.js";
import * as store from "./store.js";
import { state } from "./store.js";

const NAME_MAX = 80;
// Same rule as the server (src/routes/api.js nameText).
const isNameText = (v) => /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u.test(v) && /[\p{L}\p{N}]/u.test(v);

export function createWelcome() {
  const data = { language: null, name: "", city: "", accessCode: "" };
  let step = 0;
  let busy = false;
  let error = null;      // form-level error text
  let fieldError = null; // current field's error text
  const el = h("section", { class: "welcome", "aria-labelledby": "welcome-q" });

  const steps = () => ["lang", "name", "city", ...(state.config.accessCodeRequired ? ["code"] : [])];

  function validate(kind, v) {
    if (kind === "code") return v ? null : t("err.codeEmpty");
    if (!v) return t(kind === "name" ? "err.nameEmpty" : "err.cityEmpty");
    if (v.length > NAME_MAX) return t("err.long");
    if (!isNameText(v)) return t("err.chars");
    return null;
  }

  async function submit() {
    busy = true; error = null; render();
    const body = { name: data.name, city: data.city, language: data.language };
    if (state.config.accessCodeRequired) body.accessCode = data.accessCode;
    try {
      const session = await api.openSession(body);
      busy = false;
      location.hash = "#/talk";
      await store.boot({ session });
    } catch (err) {
      busy = false;
      if (err.code === "ACCESS_CODE_REQUIRED") {
        state.config.accessCodeRequired = true;
        step = steps().indexOf("code");
        fieldError = data.accessCode ? (err.message || t("err.codeEmpty")) : t("err.codeEmpty");
      } else {
        error = err.status === 429 ? t("err.limit") : err.status === 0 ? t("err.network") : (err.say || err.message || t("err.save"));
      }
      render();
    }
  }

  function next() {
    const kind = steps()[step];
    if (kind !== "lang") {
      const input = el.querySelector("input");
      const v = input ? input.value.trim() : "";
      const key = kind === "code" ? "accessCode" : kind;
      data[key] = v;
      fieldError = validate(kind, v);
      if (fieldError) { render(); el.querySelector("input").focus(); return; }
    }
    if (step === steps().length - 1) { submit(); return; }
    step += 1; fieldError = null; error = null;
    render(true);
  }

  function back() {
    if (step === 0 || busy) return;
    step -= 1; fieldError = null; error = null;
    render(true);
  }

  function chooseLang(code) {
    data.language = code;
    setLang(code);
    next();
  }

  function dictateButton(input) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const btn = h("button", { class: "icon-btn icon-btn-lg dictate", type: "button", "aria-label": t("welcome.speak"), dataset: { tip: t("welcome.speak") } }, icon("mic", 26));
    btn.addEventListener("click", () => {
      let rec;
      try { rec = new SR(); } catch { return; }
      rec.lang = data.language || "en-IN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      btn.dataset.state = "listening";
      btn.setAttribute("aria-label", t("welcome.listening"));
      rec.onresult = (e) => {
        const said = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
        if (said) { input.value = said.trim().slice(0, NAME_MAX); input.dispatchEvent(new Event("input")); }
      };
      rec.onend = () => { delete btn.dataset.state; btn.setAttribute("aria-label", t("welcome.speak")); };
      rec.onerror = rec.onend;
      try { rec.start(); } catch { rec.onend(); }
    });
    return btn;
  }

  function render(moveFocus = false) {
    const list = steps();
    const kind = list[step];
    const progress = h("ol", { class: "wel-progress", "aria-label": t("welcome.step", { n: step + 1, total: list.length }) },
      ...list.map((_, i) => h("li", { class: i < step ? "is-done" : i === step ? "is-now" : "", "aria-current": i === step ? "step" : undefined },
        h("span", { class: "sr-only", text: String(i + 1) }))));
    let body;
    if (kind === "lang") {
      body = [
        h("h1", { id: "welcome-q", class: "wel-q wel-q-tri" },
          h("span", { lang: "hi", text: t("welcome.lang", null, "hi") }),
          h("span", { lang: "kn", text: t("welcome.lang", null, "kn") }),
          h("span", { lang: "en", text: t("welcome.lang", null, "en") })),
        h("div", { class: "lang-tiles", role: "group", "aria-labelledby": "welcome-q" },
          ...LANGS.map((L, i) => h("button", {
            class: `lang-tile lang-tile-${L.short}`, type: "button", lang: L.short,
            "aria-pressed": String(data.language === L.code), style: `--i:${i}`,
            on: { click: () => chooseLang(L.code) },
          }, h("span", { class: "lt-script", text: L.native }), h("span", { class: "lt-go", "aria-hidden": "true" }, icon("arrowRight", 26))))),
      ];
    } else {
      const labelKey = { name: "welcome.shop", city: "welcome.city", code: "welcome.code" }[kind];
      const value = kind === "code" ? data.accessCode : data[kind];
      const errId = "wel-err";
      const input = h("input", {
        id: "wel-input", class: "wel-input", type: kind === "code" ? "password" : "text",
        value, maxlength: kind === "code" ? 200 : NAME_MAX, autocomplete: kind === "name" ? "organization" : kind === "city" ? "address-level2" : "off",
        enterkeyhint: "next", "aria-invalid": fieldError ? "true" : undefined, "aria-describedby": fieldError ? errId : undefined,
        disabled: busy ? true : undefined,
      });
      input.value = value;
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
      input.addEventListener("input", () => { if (fieldError) { fieldError = null; const fe = el.querySelector(".wel-field-err"); if (fe) fe.remove(); input.removeAttribute("aria-invalid"); } });
      body = [
        h("label", { id: "welcome-q", class: "wel-q", for: "wel-input" },
          h("span", { class: "wel-q-ico", "aria-hidden": "true" }, icon(kind === "name" ? "store" : kind === "city" ? "pin" : "tag", 30)),
          h("span", { text: t(labelKey) })),
        kind === "code" ? h("p", { class: "wel-why", text: t("welcome.codeWhy") }) : null,
        h("div", { class: "wel-field" }, input, kind !== "code" ? dictateButton(input) : null),
        fieldError ? h("p", { class: "wel-field-err", id: errId, role: "alert" }, icon("alert", 20), h("span", { text: fieldError })) : null,
      ];
    }
    const actions = h("div", { class: "wel-actions" },
      step > 0 ? h("button", { class: "btn btn-ghost btn-lg", type: "button", disabled: busy ? true : undefined, on: { click: back } }, icon("arrowLeft", 24), h("span", { text: t("back") })) : null,
      kind !== "lang" ? h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: busy ? true : undefined, "aria-busy": busy ? "true" : undefined, on: { click: next } },
        busy ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon(step === list.length - 1 ? "mic" : "arrowRight", 24),
        h("span", { text: busy ? t("welcome.saving") : step === list.length - 1 ? t("welcome.done") : t("next") })) : null);
    fill(el,
      h("div", { class: "wel-orb", "aria-hidden": "true" }),
      h("div", { class: "wel-card", dataset: { step: kind } },
        progress,
        ...body,
        error ? h("div", { class: "wel-error", role: "alert" }, icon("alert", 22), h("span", { text: error })) : null,
        actions),
      h("p", { class: "wel-notice", role: "note" }, icon("robot", 20), h("span", { text: t("notice.long") })));
    if (moveFocus || kind !== "lang") {
      requestAnimationFrame(() => {
        const f = el.querySelector(kind === "lang" ? ".lang-tile" : "#wel-input");
        if (f && (moveFocus || document.activeElement === document.body)) f.focus();
      });
    }
  }

  return { el, update: () => render(false), lang };
}
