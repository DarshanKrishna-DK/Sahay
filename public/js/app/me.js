// My Sahay: the owner's own agent. Profile (speaking speed, bargaining dial, language) via
// PUT /api/agent/profile; the constellation of rules and memories; a suggested rule opens a
// sheet with its sentence, why, 🔊 and ✓ keep / ✕ forget (the button path). Typed text never
// keeps a rule. "Teach me" opens Talk with the teaching hint; History is one tap away.

import { h, icon, patch, scripted } from "./dom.js";
import { t, LANGS } from "./i18n.js";
import { state, loadAgent, updateProfile, decideRule, ownerLanguage } from "./store.js";
import { stateView, loadingView } from "./empty.js";
import { speakButton } from "./speak.js";
import { openSheet, closeSheet } from "./sheet.js";
import { renderConstellation, sentenceOf } from "./constellation.js";

const STYLES = ["gentle", "balanced", "tough"];

export function createMe() {
  const el = h("section", { class: "me", "aria-labelledby": "me-title" });
  const head = h("div", { class: "me-head" });
  const profileBox = h("div", { class: "me-profile" });
  const starsBox = h("div", { class: "me-stars" });
  const actions = h("div", { class: "me-actions" });
  el.append(head, profileBox, starsBox, actions);
  const saving = { field: null, error: null, ok: null };
  const ruleUi = new Map(); // ruleId -> { busy, error }
  const seen = new Set();
  let firstStars = true;
  let sheet = null;

  async function save(field, value) {
    saving.field = field; saving.error = null; saving.ok = null;
    render(new Set(["agent"]));
    try {
      await updateProfile({ [field]: value });
      saving.ok = field;
    } catch (err) {
      saving.error = { field, message: err.say || err.message || t("me.saveFail") };
    }
    saving.field = null;
    render(new Set(["agent"]));
  }

  function teach() {
    location.hash = "#/talk";
    document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: "talk.teachHint" } }));
  }

  function renderHead() {
    const b = state.business || {};
    patch(head, JSON.stringify([b.name, b.city, document.documentElement.lang]), () => [
      h("span", { class: "me-orb", "aria-hidden": "true" }),
      h("div", { class: "me-who" },
        h("h1", { class: "screen-title", id: "me-title", text: t("me.title") }),
        b.name ? scripted("p", [b.name, b.city].filter(Boolean).join(", "), { class: "me-shop" }) : null),
    ]);
  }

  function choice(field, value, label, ic, current) {
    const busy = saving.field === field;
    return h("button", {
      class: "chip-btn", type: "button", "aria-pressed": String(current === value), disabled: busy ? true : undefined,
      on: { click: () => { if (current !== value) save(field, value); } },
    }, ic ? icon(ic, 22) : null, h("span", { text: label }));
  }

  function dial(current) {
    const idx = Math.max(0, STYLES.indexOf(current || "balanced"));
    const busy = saving.field === "bargain_style";
    return h("div", { class: "dial", role: "radiogroup", "aria-label": t("me.style"), style: `--pos:${idx}` },
      h("span", { class: "dial-arc", "aria-hidden": "true" }, h("span", { class: "dial-needle" })),
      h("div", { class: "dial-stops" }, ...STYLES.map((s, i) => h("button", {
        class: "dial-stop", type: "button", role: "radio", "aria-checked": String(i === idx), disabled: busy ? true : undefined,
        on: {
          click: () => { if (i !== idx) save("bargain_style", s); },
          keydown: (e) => {
            const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const n = Math.min(2, Math.max(0, idx + d));
            if (n !== idx) save("bargain_style", STYLES[n]);
          },
        },
        tabindex: i === idx ? "0" : "-1",
      }, h("span", { text: t(`me.style.${s}`) })))));
  }

  function renderProfile() {
    const A = state.agent;
    const p = A.profile || {};
    const key = JSON.stringify([A.status, p, saving, document.documentElement.lang]);
    patch(profileBox, key, () => {
      if (A.status === "loading" || A.status === "idle") return loadingView(t("loading"));
      if (A.status === "missing") return h("p", { class: "me-note" }, icon("alert", 22), h("span", { text: t("me.notReady") }));
      if (A.status === "error") return stateView({ kind: "error", title: t("me.loadFail"), text: A.error ? (A.error.say || A.error.message) : "", action: { label: t("retry"), run: () => loadAgent() }, compact: true });
      const lang = p.language || ownerLanguage();
      const err = (f) => saving.error && saving.error.field === f ? h("p", { class: "field-err", role: "alert" }, icon("alert", 20), h("span", { text: saving.error.message })) : null;
      const ok = (f) => saving.ok === f ? h("span", { class: "saved", role: "status" }, icon("check", 18), h("span", { text: t("me.saved") })) : null;
      return [
        h("div", { class: "pref" },
          h("h2", { class: "pref-title" }, icon("speaker", 22), h("span", { text: t("me.speed") }), ok("voice_speed")),
          h("div", { class: "chips", role: "group", "aria-label": t("me.speed") },
            choice("voice_speed", "slow", t("me.speed.slow"), "turtle", p.voice_speed || "normal"),
            choice("voice_speed", "normal", t("me.speed.normal"), "gauge", p.voice_speed || "normal")),
          err("voice_speed")),
        h("div", { class: "pref" },
          h("h2", { class: "pref-title" }, icon("handshake", 22), h("span", { text: t("me.style") }), ok("bargain_style")),
          dial(p.bargain_style),
          err("bargain_style")),
        h("div", { class: "pref" },
          h("h2", { class: "pref-title" }, icon("globe", 22), h("span", { text: t("me.language") }), ok("language")),
          h("div", { class: "chips", role: "group", "aria-label": t("me.language") },
            ...LANGS.map((L) => h("button", {
              class: "chip-btn chip-script", type: "button", lang: L.short, "aria-pressed": String(lang === L.code),
              disabled: saving.field === "language" ? true : undefined,
              on: { click: () => { if (lang !== L.code) save("language", L.code); } },
            }, h("span", { text: L.native })))),
          err("language")),
      ];
    });
  }

  function ruleSheetBody(it) {
    const d = it.data;
    const code = ownerLanguage() || "en-IN";
    const why = d.why ? sentenceOf({ sentence: d.why }, code) : "";
    const ui = ruleUi.get(String(d.id)) || {};
    const rows = [
      scripted("p", sentenceOf(d, code), { class: "sheet-big rule-sentence" }),
      why ? h("p", { class: "fact why" }, icon("spark", 22), h("span", {}, h("b", { text: `${t("me.why")}: ` }), scripted("span", why))) : null,
      h("div", { class: "sheet-speak" }, speakButton(`${it.type}:${d.id}`)),
    ];
    if (it.type === "rule" && d.status !== "off") {
      rows.push(h("p", { class: "fact muted", text: t("me.voiceSays") }));
      rows.push(h("div", { class: "rule-actions" },
        h("button", { class: "yes-btn yes-btn-no", type: "button", "aria-label": t("me.forget"), disabled: ui.busy ? true : undefined, on: { click: () => decide(it, "forget") } },
          ui.busy === "forget" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("x", 36), h("span", { class: "yes-btn-word", text: t("me.forget") })),
        d.status === "suggested" ? h("button", { class: "yes-btn yes-btn-yes", type: "button", "aria-label": t("me.keep"), disabled: ui.busy ? true : undefined, on: { click: () => decide(it, "keep") } },
          ui.busy === "keep" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("check", 44), h("span", { class: "yes-btn-word", text: t("me.keep") })) : null));
    }
    if (ui.error) rows.push(h("p", { class: "yes-error", role: "alert" }, icon("alert", 20), h("span", { text: ui.error })));
    return rows.filter(Boolean);
  }

  async function decide(it, decision) {
    const id = String(it.data.id);
    ruleUi.set(id, { busy: decision });
    if (sheet) sheet.api.setBody(ruleSheetBody(it));
    try {
      await decideRule(id, decision);
      ruleUi.delete(id);
      closeSheet();
      sheet = null;
    } catch (err) {
      ruleUi.set(id, { error: err.status === 409 ? t("yes.gone") : (err.say || err.message || t("me.saveFail")) });
      if (sheet) sheet.api.setBody(ruleSheetBody({ ...it, data: state.agent.rules.get(id) || it.data }));
    }
  }

  function onPick(it, opener) {
    const title = it.type === "memory" ? t("me.memory") : it.data.status === "suggested" ? t("me.suggested") : t("me.rule");
    sheet = { id: `${it.type}:${it.data.id}`, it, api: openSheet({ title, body: ruleSheetBody(it), opener }) };
  }

  function renderStars() {
    const A = state.agent;
    if (A.status !== "ready") { patch(starsBox, `none|${A.status}`, () => []); return; }
    const rules = [...A.rules.values()].sort((a, b) => (a.status === "suggested" ? -1 : 0) - (b.status === "suggested" ? -1 : 0));
    const items = [...rules.filter((r) => r.status !== "off").map((d) => ({ type: "rule", data: d })), ...[...A.memories.values()].map((d) => ({ type: "memory", data: d }))];
    const fresh = new Set();
    for (const it of items) { const k = `${it.type}:${it.data.id}`; if (!seen.has(k)) { if (!firstStars) fresh.add(k); seen.add(k); } }
    firstStars = false;
    const code = ownerLanguage() || "en-IN";
    const key = JSON.stringify([items.map((i) => [i.type, i.data.id, i.data.status, i.data.sentence]), document.documentElement.lang]);
    patch(starsBox, key, () => [
      h("h2", { class: "pref-title stars-title" }, icon("spark", 22), h("span", { text: t("me.rulesTitle") })),
      items.length
        ? renderConstellation(items, { langCode: code, onPick, fresh })
        : stateView({ kind: "empty", icon: "spark", title: t("empty.rules.title"), text: t("empty.rules.text"), compact: true }),
    ]);
    // An open rule sheet follows SSE (decided in another tab or by voice).
    if (sheet && sheet.it.type === "rule") {
      const now = A.rules.get(String(sheet.it.data.id));
      if (now && now.status !== sheet.it.data.status) {
        if (now.status === "suggested") sheet.api.setBody(ruleSheetBody({ type: "rule", data: now }));
        else { closeSheet(); sheet = null; }
      }
    }
  }

  function renderActions() {
    patch(actions, document.documentElement.lang, () => [
      h("button", { class: "btn btn-primary btn-lg", type: "button", on: { click: teach } }, icon("mic", 24), h("span", { text: t("me.teach") })),
      h("a", { class: "btn btn-ghost btn-lg", href: "#/history" }, icon("history", 24), h("span", { text: t("me.history") })),
    ]);
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (all || parts.has("business")) renderHead();
    if (all || parts.has("agent")) { renderProfile(); renderStars(); }
    if (all) renderActions();
  }

  return { el, update: (_s, parts) => render(parts), enter() { if (state.agent.status === "error" || state.agent.status === "missing") loadAgent(); } };
}
