// My Sahay: the owner's own agent. Profile (speaking speed, bargaining dial, language) via
// PUT /api/agent/profile; the constellation of rules and memories; a suggested rule opens a
// sheet with its sentence, why, read-aloud and the yes (keep) / no (forget) buttons (the button path). Typed text never
// keeps a rule. "Teach me" opens Talk with the teaching hint; History is one tap away.

import { h, icon, patch, scripted } from "./dom.js";
import { t, LANGS, cityWord, addStrings } from "./i18n.js";
import { state, loadAgent, updateProfile, decideRule, ownerLanguage, logout } from "./store.js";
import { createThinkingOrb } from "./thinking-orb.js";
import { passkeyAvailable, addPasskey, cancelled } from "./passkey.js";
import { sell, loadSell } from "./store-sell.js";
import { shopSummary } from "./shop-settings.js";
import { st } from "./sell-i18n.js";

addStrings({
  "me.account": ["Your account", "आपका खाता", "ನಿಮ್ಮ ಖಾತೆ"],
  "me.noAccount": ["This shop has no account yet. Make one to open Sahay on any phone.", "इस दुकान का अभी खाता नहीं है। खाता बनाइए, फिर किसी भी फ़ोन पर सहाय खोलें।", "ಈ ಅಂಗಡಿಗೆ ಇನ್ನೂ ಖಾತೆ ಇಲ್ಲ. ಖಾತೆ ಮಾಡಿ, ಯಾವುದೇ ಫೋನ್‌ನಲ್ಲಿ ಸಹಾಯ್ ತೆರೆಯಿರಿ."],
  "me.makeAccount": ["Make an account", "खाता बनाएँ", "ಖಾತೆ ಮಾಡಿ"],
  "me.addFinger": ["Add fingerprint", "उँगली जोड़ें", "ಬೆರಳಚ್ಚು ಸೇರಿಸಿ"],
  "me.fingerAdded": ["Fingerprint added", "उँगली जुड़ गई", "ಬೆರಳಚ್ಚು ಸೇರಿತು"],
  "me.fingerFail": ["Could not add the fingerprint. Try again.", "उँगली नहीं जुड़ी। फिर कोशिश करें।", "ಬೆರಳಚ್ಚು ಸೇರಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
  "me.logout": ["Log out", "लॉग आउट", "ಲಾಗ್ ಔಟ್"],
  "me.logoutFail": ["Could not log out. Try again.", "लॉग आउट नहीं हुआ। फिर कोशिश करें।", "ಲಾಗ್ ಔಟ್ ಆಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."],
});
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
  const shopBox = h("section", { class: "me-shopbox", "aria-labelledby": "me-shop-h" });
  const accountBox = h("div", { class: "me-account" });
  el.append(head, profileBox, shopBox, starsBox, actions, accountBox);
  const meOrb = createThinkingOrb({ size: 72, state: "idle" });
  const acct = { finger: null, busy: null, note: null, error: null };
  passkeyAvailable().then((ok) => { acct.finger = ok; renderAccount(); });
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
      h("span", { class: "me-orb", "aria-hidden": "true" }, meOrb.el),
      h("div", { class: "me-who" },
        h("h1", { class: "screen-title", id: "me-title", text: t("me.title") }),
        b.name ? scripted("p", [b.name, b.city ? cityWord(b.city) : null].filter(Boolean).join(", "), { class: "me-shop" }) : null),
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

  // Shop details / GST (contract SELL settings): how the shop bills, its state and GST number.
  function renderShop() {
    const s = sell.settings;
    const key = JSON.stringify([sell.status, s, document.documentElement.lang]);
    patch(shopBox, key, () => {
      const body = shopSummary();
      if (!body) return [];
      return [
        h("h2", { class: "pref-title", id: "me-shop-h" }, icon("store", 22), h("span", { text: st("shop.title") })),
        ...(Array.isArray(body) ? body : [body]),
      ];
    });
  }

  function renderActions() {
    patch(actions, document.documentElement.lang, () => [
      h("button", { class: "btn btn-primary btn-lg", type: "button", on: { click: teach } }, icon("mic", 24), h("span", { text: t("me.teach") })),
      h("a", { class: "btn btn-ghost btn-lg", href: "#/history" }, icon("history", 24), h("span", { text: t("me.history") })),
    ]);
  }

  async function onAddFinger() {
    acct.busy = "finger"; acct.note = null; acct.error = null; renderAccount();
    try { await addPasskey(); acct.note = t("me.fingerAdded"); }
    catch (err) { if (!cancelled(err)) acct.error = err.say || t("me.fingerFail"); }
    acct.busy = null; renderAccount();
  }

  async function onLogout() {
    acct.busy = "logout"; acct.error = null; renderAccount();
    try { await logout(); } catch (err) { acct.busy = null; acct.error = err.say || t("me.logoutFail"); renderAccount(); }
  }

  function renderAccount() {
    const a = state.account;
    const key = JSON.stringify([a, state.accounts, acct, document.documentElement.lang]);
    patch(accountBox, key, () => {
      if (state.accounts === "missing") return [];
      const body = [h("h2", { class: "section-title", text: t("me.account") })];
      if (!a) {
        body.push(h("p", { class: "me-account-line" }, icon("info", 22), h("span", { text: t("me.noAccount") })),
          h("div", { class: "me-account-actions" },
            h("a", { class: "keycap keycap-marigold keycap-md", href: "#/signup", on: { click: (e) => { e.preventDefault(); onLogoutToSignup(); } } }, icon("key", 22), h("span", { text: t("me.makeAccount") }))));
        return body;
      }
      const phone = String(a.phone || "").replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
      body.push(
        h("p", { class: "me-account-line" }, icon("phone", 22), h("span", { class: "me-phone", text: phone })),
        a.phone_verified ? null : h("p", { class: "auth-honest", role: "note" }, icon("info", 20), h("span", {}, h("strong", { text: t("auth.notVerified") }))),
        h("div", { class: "me-account-actions" },
          acct.finger ? h("button", { class: "keycap keycap-ghost keycap-md", type: "button", disabled: acct.busy ? true : undefined, on: { click: onAddFinger } },
            acct.busy === "finger" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("fingerprint", 22), h("span", { text: t("me.addFinger") })) : null,
          h("button", { class: "keycap keycap-ghost keycap-md", type: "button", disabled: acct.busy ? true : undefined, on: { click: onLogout } },
            acct.busy === "logout" ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("logout", 22), h("span", { text: t("me.logout") }))),
        acct.note ? h("p", { class: "me-account-ok", role: "status" }, icon("checkCircle", 22), h("span", { text: acct.note })) : null,
        acct.error ? h("p", { class: "yes-error", role: "alert" }, icon("alert", 20), h("span", { text: acct.error })) : null);
      return body;
    });
  }

  // A device-only shop makes its account through Sign up, which claims this shop (contract ACC).
  function onLogoutToSignup() {
    state.boot = "auth";
    history.replaceState(null, "", "#/signup");
    import("./store.js").then((m) => m.touch("boot"));
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (all || parts.has("business") || parts.has("boot")) renderAccount();
    if (all || parts.has("business")) renderHead();
    if (all || parts.has("agent")) { renderProfile(); renderStars(); }
    if (all || parts.has("sell")) renderShop();
    if (all) renderActions();
  }

  return { el, update: (_s, parts) => { if (sell.status === "idle" && state.boot === "ready") loadSell(); render(parts); }, enter() {
    if (state.agent.status === "error" || state.agent.status === "missing") loadAgent();
    if (state.boot === "ready" && (sell.status === "idle" || sell.status === "error")) loadSell();
  } };
}
