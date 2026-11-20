// My Sahay (spec 1.1 row 6, D4; 3.1 rows 48-54): the owner's own agent in four sections, Teach,
// Voice, Shop and History, at #/me/<section>. Phone, phone landscape and tablet: a segmented
// control on top, the section below. Laptop and wide: the section list on the left, the body on
// the right.
//   Teach   "Teach Sahay" starts a call in place with the teaching hint (D11); a suggested rule
//           waits here as W3's Yes card (waiting.js renderCard, the only Yes-card renderer, D6);
//           the Rules and Memory lists (Stitch 09); a row opens its sheet (sentence, why,
//           read-aloud; a suggested rule's sheet holds its Yes card, an active rule can be
//           forgotten, a memory is read only). Typed text never keeps a rule.
//   Voice   language, speaking speed and the bargaining dial (PUT /api/agent/profile), each with
//           its own saving / saved / error.
//   Shop    shop details and GST (W4B's shop sheet), Telegram link (W4A's createTelegramLink), account: phone
//           (not verified, and why), add fingerprint, log out; a device-only shop makes an account.
//   History the timeline (history.js).

import { h, icon, patch, scripted } from "./dom.js";
import { t, LANGS, lang as currentLang } from "./i18n.js";
import * as store from "./store.js";
import { state, loadAgent, updateProfile, decideRule, ownerLanguage, logout } from "./store.js";
import { createTelegramLink } from "./orders.js";
import { passkeyAvailable, addPasskey, cancelled } from "./passkey.js";
import { sell, loadSell } from "./store-sell.js";
import { openShopSheet } from "./shop-settings.js";
import { stateLabel, needsGstin, missingFact } from "./shop-facts.js";
import { st } from "./sell-i18n.js";
import { stateView } from "./empty.js";
import { speakButton } from "./speak.js";
import { openSheet, closeSheet } from "./sheet.js";
import { renderCard } from "./waiting.js";
import { pageHead } from "./ui.js";
import { starWord, starIcon, sentenceOf } from "./star-words.js";
import { createHistoryPanel } from "./history.js";
import { ME_SECTIONS, sectionFromHash, sectionHash, STYLES, SPEEDS, dialKey, starItems } from "./me-logic.js";
import { phoneLine } from "./auth-logic.js";
import { addStrings } from "./i18n.js";
import "./me-strings.js";

addStrings({
  "me3.gone": ["This was already answered.", "इसका जवाब पहले ही हो चुका है।", "ಇದಕ್ಕೆ ಈಗಾಗಲೇ ಉತ್ತರಿಸಲಾಗಿದೆ."],
  "me3.retry": ["Try again", "फिर कोशिश करें", "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ"],
});

const SCHEME_ICON = { unregistered: "receipt", regular: "shield", composition: "tag" };
const PAPER_KEY = { unregistered: "shop.paper.unregistered", regular: "sell.kind.tax_invoice", composition: "sell.kind.bill_of_supply" };
const SPEED_ICON = { slow: "turtle", normal: "gauge" };

const errLine = (text) => h("p", { class: "error-line", role: "alert" }, icon("alert", 20), h("span", { text }));
const noteLine = (text, ic = "info") => h("p", { class: "note-line" }, icon(ic, 20), h("span", { text }));
const busySpin = () => h("span", { class: "spinner", "aria-hidden": "true" });
const sayOf = (err, key) => (err && (err.say || (err.status === 0 ? t("err.network") : null))) || t(key);

function cardHead(title, ic, extra) {
  return h("header", { class: "card-head" },
    h("h2", { class: "card-title me-card-title" }, icon(ic, 24), h("span", { text: title })),
    extra ? h("span", { class: "card-speak" }, extra) : null);
}

function agentGate(A) {
  if (A.status === "loading" || A.status === "idle") {
    return h("div", { class: "skel-wrap", role: "status", "aria-busy": "true" },
      h("span", { class: "sr-only", text: t("loading") }),
      h("span", { class: "skel skel-card" }), h("span", { class: "skel skel-block" }));
  }
  if (A.status === "missing") return stateView({ kind: "missing", icon: "sliders", title: t("me3.missing.title"), text: t("me3.missing.text"), compact: true });
  if (A.status === "error") {
    return stateView({ kind: "error", title: t("me.loadFail"), text: A.error ? sayOf(A.error, "err.network") : "", action: { label: t("retry"), icon: "refresh", run: () => loadAgent() }, compact: true });
  }
  return null;
}

export function createMe() {
  const el = h("section", { class: "me", "aria-labelledby": "me-title" });
  const head = h("div", { class: "me-head" });
  const tabs = h("nav", { class: "me-tabs", "aria-label": t("me3.sections") });
  const body = h("div", { class: "me-body" });
  const panels = Object.fromEntries(ME_SECTIONS.map((s) => [s.id, h("div", { class: `me-panel me-panel-${s.id}`, id: `me-panel-${s.id}`, role: "region", "aria-labelledby": `me-tab-${s.id}`, hidden: true })]));
  body.append(...Object.values(panels));
  el.append(head, h("div", { class: "me-layout" }, tabs, body));

  const history = createHistoryPanel();
  panels.history.append(history.el);

  let section = sectionFromHash(location.hash) || "teach";
  const saving = { field: null, error: null, ok: null };
  const ruleUi = new Map(); // ruleId -> { busy, error }
  const seen = new Set();
  let firstStars = true;
  let sheet = null;
  const acct = { finger: null, busy: null, note: null, error: null };
  const tgLink = createTelegramLink(); // W4A owns its logic (not linked, opening, popup blocked, linked, not configured)
  passkeyAvailable().then((ok) => { acct.finger = ok; renderShop(true); });

  /* ------------------------------------------------------------ header -- */
  // v4 page head: display title, one plain line (the shop and its city), the primary action.
  function renderHead() {
    patch(head, currentLang(), () => {
      const sub = t("me3.pageSub");
      const node = pageHead({
        title: t("me.title"), sub,
        actions: [h("button", { class: "keycap keycap-primary keycap-md", type: "button", on: { click: teach } }, icon("mic", 24), h("span", { text: t("me3.teachNew") }))],
      });
      const h1 = node.querySelector("h1");
      if (h1) h1.id = "me-title";
      return node;
    });
  }

  /* -------------------------------------------------------------- tabs -- */
  function renderTabs() {
    const waiting = [...state.agent.rules.values()].filter((r) => r.status === "suggested").length;
    patch(tabs, JSON.stringify([section, currentLang(), waiting]), () => h("ul", { class: "me-tablist" }, ...ME_SECTIONS.map((s) => h("li", {},
      h("a", {
        class: "me-tab", id: `me-tab-${s.id}`, href: sectionHash(s.id), "aria-current": s.id === section ? "page" : undefined,
        "aria-controls": `me-panel-${s.id}`,
      },
      h("span", { class: "me-tab-ico", "aria-hidden": "true" }, icon(s.icon, 24),
        s.id === "teach" && waiting ? h("span", { class: "badge me-tab-badge", text: waiting > 9 ? "9+" : String(waiting) }) : null),
      h("span", { class: "me-tab-word", text: t(s.word) }))))));
  }

  function show(next, { focus = false } = {}) {
    section = ME_SECTIONS.some((s) => s.id === next) ? next : "teach";
    for (const [id, p] of Object.entries(panels)) p.hidden = id !== section;
    renderTabs();
    render(new Set(["all"]));
    if (focus) {
      const tab = tabs.querySelector(`#me-tab-${section}`);
      if (tab && !tab.contains(document.activeElement)) tab.focus({ preventScroll: true });
    }
  }

  /* ------------------------------------------------------------- Teach -- */
  function teach() {
    document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: "talk.teachHint" } }));
  }

  function ruleSheetBody(it, withSpeak) {
    const d = it.data;
    const code = ownerLanguage() || "en-IN";
    const why = d.why ? sentenceOf({ sentence: d.why }, code) : "";
    const ui = ruleUi.get(String(d.id)) || {};
    const rows = [
      withSpeak ? h("div", { class: "me-sheet-speak" }, speakButton(`${it.type}:${d.id}`)) : null,
      h("p", { class: `me-sheet-kind is-${it.type === "memory" ? "memory" : d.status === "suggested" ? "suggested" : "rule"}` },
        icon(it.type === "memory" ? "box" : d.status === "suggested" ? "clock" : "check", 20), h("span", { text: starWord(it) })),
      scripted("p", sentenceOf(d, code), { class: "sheet-big me-rule-sentence" }),
      why ? h("div", { class: "me-why" }, h("p", { class: "me-why-label" }, icon("spark", 20), h("span", { text: t("me.why") })), scripted("p", why, { class: "me-why-text" })) : null,
    ];
    if (it.type === "memory") rows.push(noteLine(t("me3.memoryNote")));
    else if (d.status === "active") {
      rows.push(noteLine(t("me3.activeNote"), "check"));
      rows.push(h("div", { class: "me-sheet-actions" },
        h("button", { class: "keycap keycap-ghost keycap-md", type: "button", "aria-label": t("me3.forgetLong"), "aria-busy": ui.busy ? "true" : undefined, disabled: ui.busy ? true : undefined, on: { click: () => decide(it, "forget") } },
          ui.busy === "forget" ? busySpin() : icon("x", 22), h("span", { text: t("me.forget") }))));
    }
    if (ui.error) rows.push(errLine(ui.error));
    return rows.filter(Boolean);
  }

  function setSheetBody(it) {
    if (!sheet) return;
    sheet.it = it;
    // A suggested rule is a decision: its sheet holds the Yes card itself (waiting.js), which
    // follows the server from waiting to saving to done.
    if (it.type === "rule" && it.data.status === "suggested") {
      sheet.api.setBody([renderCard({ key: `rule:${it.data.id}` }, { place: "sheet" }), noteLine(t("me.voiceSays"), "shield")]);
      return;
    }
    sheet.api.setBody(ruleSheetBody(it, sheet.inlineSpeak));
  }

  async function decide(it, decision) {
    const id = String(it.data.id);
    ruleUi.set(id, { busy: "forget" });
    setSheetBody(it);
    try {
      await decideRule(id, decision);
      ruleUi.delete(id);
      closeRuleSheet();
    } catch (err) {
      ruleUi.set(id, { error: err.status === 409 ? t("me3.gone") : sayOf(err, "me.saveFail") });
      setSheetBody({ ...it, data: state.agent.rules.get(id) || it.data });
    }
  }

  function closeRuleSheet() {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    if (s.api.close) s.api.close(); else closeSheet();
  }

  function onPick(it, opener) {
    const title = it.type === "memory" ? t("me.memory") : it.data.status === "suggested" ? t("me.suggested") : t("me.rule");
    const speakKey = `${it.type}:${it.data.id}`;
    const api0 = openSheet({ title, body: [], opener, speakKey, onClose: () => { sheet = null; } });
    // The v3 sheet puts the read-aloud button in its title row; the older one gets it in the body.
    sheet = { it, api: api0, inlineSpeak: !api0.setFooter };
    setSheetBody(it);
  }

  /* v4 (Stitch 09-mysahay): Rules and Memory are lists of cards (icon, sentence, why), with the
     waiting suggestions as W3 Yes cards on top and, from 1024px, a side column: Sahay's promise
     (nothing is ordered or paid without the owner's yes) and how to add a rule by voice. */
  function freshKeys(items) {
    const fresh = new Set();
    for (const it of items) { const k = `${it.type}:${it.data.id}`; if (!seen.has(k)) { if (!firstStars) fresh.add(k); seen.add(k); } }
    if (state.agent.status === "ready") firstStars = false;
    return fresh;
  }

  async function forgetInline(it) {
    const id = String(it.data.id);
    ruleUi.set(id, { busy: "forget" });
    renderRules(true);
    try {
      await decideRule(id, "forget");
      ruleUi.delete(id);
    } catch (err) {
      ruleUi.set(id, { error: err.status === 409 ? t("me3.gone") : sayOf(err, "me.saveFail") });
    }
    renderRules(true);
  }

  function itemRow(it, fresh, code) {
    const d = it.data;
    const ui = ruleUi.get(String(d.id)) || {};
    const why = d.why ? sentenceOf({ sentence: d.why }, code) : "";
    const isNew = fresh.has(`${it.type}:${d.id}`);
    const sub = why || (it.type === "memory" ? t("me3.legend.memory") : t("me3.legend.rule"));
    return h("li", { class: `me-item${ui.busy ? " is-busy" : ""}` },
      h("button", { class: "me-item-main", type: "button", on: { click: (e) => onPick(it, e.currentTarget) } },
        h("span", { class: `me-item-ico is-${it.type}`, "aria-hidden": "true" }, icon(starIcon(it), 24)),
        h("span", { class: "me-item-text" },
          scripted("span", sentenceOf(d, code), { class: "me-item-title" }),
          scripted("span", sub, { class: "me-item-sub" })),
        isNew ? h("span", { class: "pill pill-ok me-item-new" }, h("span", { text: t("me3.new") })) : null),
      it.type === "rule" && d.status === "active"
        ? h("button", { class: "keycap keycap-ghost keycap-sm me-item-forget", type: "button", "aria-label": `${t("me3.forgetLong")}: ${sentenceOf(d, code)}`, "aria-busy": ui.busy ? "true" : undefined, disabled: ui.busy ? true : undefined, on: { click: () => forgetInline(it) } },
          ui.busy ? busySpin() : icon("x", 20), h("span", { text: t("me.forget") }))
        : null,
      ui.error ? h("p", { class: "me-item-err" }, errLine(ui.error)) : null);
  }

  function sideColumn() {
    return h("aside", { class: "me-side" },
      h("article", { class: "card me-promise" },
        h("p", { class: "t-label me-side-label" }, icon("shield", 20), h("span", { text: t("me3.promiseLabel") })),
        h("h2", { class: "me-promise-title", text: t("me3.promiseTitle") }),
        h("p", { class: "me-side-text", text: t("me3.promiseText") })),
      h("article", { class: "card me-speak-card" },
        h("p", { class: "t-label me-side-label" }, icon("mic", 20), h("span", { text: t("me3.speakLabel") })),
        h("p", { class: "me-side-text" }, h("span", { text: `${t("me3.speakSay")} ` }), h("strong", { class: "me-say", text: t("me3.speakPhrase") }), h("span", { text: ` ${t("me3.speakOr")}` }))));
  }

  function listBlock({ label, text, count, items, fresh, code, empty }) {
    return h("section", { class: "me-list" },
      h("header", { class: "me-list-head" },
        h("p", { class: "t-label me-list-label", text: label }),
        h("p", { class: "me-list-text", text }),
        h("p", { class: "me-list-count", text: count })),
      items.length ? h("ul", { class: "me-items" }, ...items.map((it) => itemRow(it, fresh, code))) : empty);
  }

  function renderRules(force = false) {
    if (force) panels.teach.__key = null;
    const A = state.agent;
    const code = ownerLanguage() || "en-IN";
    const items = A.status === "ready" ? starItems([...A.rules.values()], []) : [];
    const fresh = freshKeys(items);
    const suggested = items.filter((i) => i.data.status === "suggested");
    const active = items.filter((i) => i.data.status === "active");
    const key = JSON.stringify([A.status, items.map((i) => [i.data.id, i.data.status, i.data.sentence, i.data.why]), [...fresh], [...ruleUi], currentLang()]);
    patch(panels.teach, key, () => {
      const gate = agentGate(A);
      const main = h("div", { class: "me-main" });
      if (gate) main.append(gate);
      else {
        if (suggested.length) {
          main.append(h("section", { class: "me-waiting-cards", "aria-label": t("me3.legend.suggested") },
            h("p", { class: "t-label me-list-label me-waiting-label" }, icon("clock", 18), h("span", { text: t(suggested.length === 1 ? "me3.waitingRules" : "me3.waitingRulesMany", { n: suggested.length }) })),
            ...suggested.map((i) => renderCard({ key: `rule:${i.data.id}` }, { place: "inline" }))));
        }
        main.append(listBlock({
          label: t("me3.rulesLabel"), text: t("me3.rulesText"), count: t("me3.activeCount", { n: active.length }),
          items: active, fresh, code,
          empty: stateView({ kind: "empty", icon: "star", title: t("empty.rules.title"), text: t("empty.rules.text"), action: { label: t("me3.teachNow"), icon: "mic", run: teach }, compact: true }),
        }));
      }
      return h("div", { class: "me-split" }, main, sideColumn());
    });
    // An open sheet follows SSE (decided in another tab or by voice). A suggested rule's sheet
    // keeps its Yes card a moment so the owner sees it done, then closes.
    if (sheet && sheet.it.type === "rule") {
      const now = A.rules.get(String(sheet.it.data.id));
      if (now && now.status !== sheet.it.data.status) {
        if (sheet.it.data.status === "suggested") { const s0 = sheet; s0.it = { type: "rule", data: now }; setTimeout(() => { if (sheet === s0) closeRuleSheet(); }, 1800); }
        else if (now.status === "off") closeRuleSheet();
        else setSheetBody({ type: "rule", data: now });
      }
    }
  }

  function renderMemory() {
    const A = state.agent;
    const code = ownerLanguage() || "en-IN";
    const items = A.status === "ready" ? starItems([], [...A.memories.values()]) : [];
    const fresh = freshKeys(items);
    const key = JSON.stringify([A.status, items.map((i) => [i.data.id, i.data.sentence, i.data.why]), [...fresh], currentLang()]);
    patch(panels.memory, key, () => {
      const gate = agentGate(A);
      const main = h("div", { class: "me-main" });
      if (gate) main.append(gate);
      else main.append(listBlock({
        label: t("me3.memoryLabel"), text: t("me3.memoryText"), count: t("me3.memoryCount", { n: items.length }),
        items, fresh, code,
        empty: stateView({ kind: "empty", icon: "box", title: t("me3.memoryEmpty.title"), text: t("me3.memoryEmpty.text"), compact: true }),
      }));
      return h("div", { class: "me-split" }, main, sideColumn());
    });
  }

  /* ------------------------------------------------------------- Voice -- */
  async function save(field, value) {
    saving.field = field; saving.error = null; saving.ok = null;
    renderVoice();
    try {
      await updateProfile({ [field]: value });
      saving.ok = field;
    } catch (err) {
      saving.error = { field, message: sayOf(err, "me.saveFail") };
    }
    saving.field = null;
    renderVoice();
  }

  const fieldNote = (f) => {
    if (saving.field === f) return h("p", { class: "me-field-state", role: "status" }, busySpin(), h("span", { text: t("me3.saving") }));
    if (saving.error && saving.error.field === f) return errLine(saving.error.message);
    if (saving.ok === f) return h("p", { class: "me-field-state is-saved", role: "status" }, icon("checkCircle", 20), h("span", { text: t("me.saved") }));
    return null;
  };

  function tiles(field, options, current, label) {
    const busy = saving.field === field;
    return h("div", { class: "choices me-choices", role: "radiogroup", "aria-label": label },
      ...options.map((o) => h("button", {
        class: `choice${busy ? " is-saving" : ""}`, type: "button", role: "radio",
        "aria-checked": String(current === o.id), lang: o.lang, disabled: busy ? true : undefined,
        on: { click: () => { if (current !== o.id) save(field, o.id); } },
      },
      o.icon ? h("span", { class: "choice-ico", "aria-hidden": "true" }, icon(o.icon, 26)) : null,
      h("span", { class: "me-choice-word", text: o.word }),
      o.sub ? h("span", { class: "me-choice-sub", text: o.sub }) : null)));
  }

  function dial(current) {
    const idx = Math.max(0, STYLES.indexOf(current || "balanced"));
    const busy = saving.field === "bargain_style";
    const move = (n) => { if (n !== null && n !== idx) save("bargain_style", STYLES[n]); };
    return h("div", { class: "me-dial", style: `--pos:${idx}` },
      h("div", { class: "me-dial-face", "aria-hidden": "true" },
        h("span", { class: "me-dial-arc" }),
        h("span", { class: "me-dial-ticks" }, h("i"), h("i"), h("i")),
        h("span", { class: "me-dial-needle" }),
        h("span", { class: "me-dial-hub" })),
      h("div", { class: "me-dial-stops", role: "radiogroup", "aria-label": t("me3.styleTitle") },
        ...STYLES.map((s, i) => h("button", {
          class: "me-dial-stop", type: "button", role: "radio", "aria-checked": String(i === idx), tabindex: i === idx ? "0" : "-1",
          disabled: busy ? true : undefined,
          on: {
            click: () => move(i),
            keydown: (e) => { const n = dialKey(e.key, idx); if (n !== null) { e.preventDefault(); move(n); } },
          },
        },
        h("span", { class: "me-dial-word", text: t(`me.style.${s}`) }),
        h("span", { class: "me-dial-sub", text: t(`me3.style.${s}.sub`) })))));
  }

  /* Screen colour (dark / light), saved on this device. The shell's toggleTheme when it has one. */
  const themeNow = () => {
    const d = document.documentElement.dataset.theme;
    if (d === "dark" || d === "light") return d;
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  };
  function setTheme(next) {
    if (themeNow() === next) return;
    import("./shell.js").then((m) => {
      if (m && typeof m.toggleTheme === "function") m.toggleTheme();
      else throw new Error("no toggle");
    }).catch(() => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("sahay-theme", next); } catch { /* storage blocked */ }
    }).finally(() => { panels.voice.__key = null; renderVoice(); });
  }
  function themeCard() {
    const cur = themeNow();
    return h("article", { class: "card me-voice-card" },
      cardHead(t("me3.themeTitle"), cur === "dark" ? "moon" : "sun"),
      h("div", { class: "choices me-choices", role: "radiogroup", "aria-label": t("me3.themeTitle") },
        ...["dark", "light"].map((id) => h("button", {
          class: "choice", type: "button", role: "radio", "aria-checked": String(cur === id),
          on: { click: () => setTheme(id) },
        }, h("span", { class: "choice-ico", "aria-hidden": "true" }, icon(id === "dark" ? "moon" : "sun", 26)),
        h("span", { class: "me-choice-word", text: t(`me3.theme.${id}`) }),
        h("span", { class: "me-choice-sub", text: t(`me3.theme.${id}.sub`) })))));
  }

  function renderVoice() {
    const A = state.agent;
    const p = A.profile || {};
    const key = JSON.stringify([A.status, p, saving, currentLang(), themeNow()]);
    patch(panels.voice, key, () => {
      const gate = agentGate(A);
      if (gate) return [gate, themeCard()];
      const lang = p.language || ownerLanguage();
      const speed = p.voice_speed || "normal";
      return [
        h("article", { class: "card me-voice-card" },
          cardHead(t("me3.langTitle"), "languages"),
          tiles("language", LANGS.map((L) => ({ id: L.code, word: L.native, lang: L.short })), lang, t("me.language")),
          fieldNote("language")),
        h("article", { class: "card me-voice-card" },
          cardHead(t("me3.speedTitle"), "speaker"),
          tiles("voice_speed", SPEEDS.map((s) => ({ id: s, icon: SPEED_ICON[s], word: t(`me.speed.${s}`), sub: t(`me3.speed.${s}.sub`) })), speed, t("me.speed")),
          fieldNote("voice_speed")),
        h("article", { class: "card me-voice-card" },
          cardHead(t("me3.styleTitle"), "handshake"),
          dial(p.bargain_style),
          fieldNote("bargain_style")),
        noteLine(t("me3.voiceNote"), "clock"),
        themeCard(),
      ];
    });
  }

  /* -------------------------------------------------------------- Shop -- */
  function shopCard() {
    const s = sell.settings;
    if (sell.status === "missing") {
      return h("article", { class: "card me-shop-card" }, cardHead(t("me3.shopCard"), "store"), noteLine(t("me3.shopOff")));
    }
    if (sell.status === "loading" || sell.status === "idle") {
      return h("article", { class: "card me-shop-card" }, cardHead(t("me3.shopCard"), "store"),
        h("div", { class: "skel-wrap", role: "status", "aria-busy": "true" }, h("span", { class: "sr-only", text: t("loading") }),
          h("span", { class: "skel skel-line" }), h("span", { class: "skel skel-line is-short" }), h("span", { class: "skel skel-line" })));
    }
    if (sell.status === "error" || !s) {
      return h("article", { class: "card me-shop-card" }, cardHead(t("me3.shopCard"), "store"),
        stateView({ kind: "error", title: st("sbx.err.loadTitle"), text: (sell.error && sell.error.say) || st("sbx.err.load"), action: { label: t("retry"), icon: "refresh", run: () => loadSell() }, compact: true }));
    }
    const need = missingFact(s);
    const L = currentLang();
    const stateName = s.stateCode ? stateLabel(s.stateCode, L) : null;
    const btn = h("button", { class: `keycap ${need ? "keycap-primary" : "keycap-secondary"} keycap-md keycap-block`, type: "button" },
      icon(need ? "plus" : "store", 22), h("span", { text: need || !s.saved ? st("shop.add") : st("shop.change") }));
    btn.addEventListener("click", () => openShopSheet({ opener: btn }));
    return h("article", { class: `card me-shop-card${need ? " card-alert" : ""}` },
      cardHead(t("me3.shopCard"), "store"),
      h("p", { class: "me-card-why", text: t("me3.shopCardWhy") }),
      h("ul", { class: "rows me-facts" },
        h("li", { class: "row" }, h("span", { class: "row-ico", "aria-hidden": "true" }, icon(SCHEME_ICON[s.gstScheme] || "receipt", 22)),
          h("span", { class: "row-main" }, h("span", { class: "row-title", text: st(`shop.scheme.${s.gstScheme}`) }), h("span", { class: "row-sub", text: st(PAPER_KEY[s.gstScheme] || "shop.paper.unregistered") }))),
        h("li", { class: "row" }, h("span", { class: "row-ico", "aria-hidden": "true" }, icon("pin", 22)),
          h("span", { class: "row-main" }, stateName ? scripted("span", stateName, { class: "row-title" }) : h("span", { class: "row-title is-missing", text: st("shop.noState") }), h("span", { class: "row-sub", text: st("shop.state") }))),
        needsGstin(s.gstScheme) ? h("li", { class: "row" }, h("span", { class: "row-ico", "aria-hidden": "true" }, icon("shield", 22)),
          h("span", { class: "row-main" }, s.gstin ? h("span", { class: "row-title me-gstin", text: s.gstin }) : h("span", { class: "row-title is-missing", text: st("shop.noGstin") }), h("span", { class: "row-sub", text: st("shop.gstin") }))) : null),
      need ? errLine(st(`shop.need.${need}`)) : null,
      btn);
  }

  function telegramCard() {
    const linked = state.telegramLinked;
    tgLink.update();
    return h("article", { class: `card me-tg-card${linked ? " is-linked" : ""}` },
      cardHead(t("me3.tg"), "send"),
      linked ? h("p", { class: "me-card-why", text: t("me3.tgOnSub") }) : h("p", { class: "me-card-why", text: t("me3.tgWhy") }),
      tgLink.el);
  }

  async function onAddFinger() {
    acct.busy = "finger"; acct.note = null; acct.error = null; renderShop(true);
    try { await addPasskey(); acct.note = t("me3.fingerAdded"); }
    catch (err) { if (!cancelled(err)) acct.error = sayOf(err, "me3.fingerFail"); }
    acct.busy = null; renderShop(true);
  }

  async function onLogout() {
    acct.busy = "logout"; acct.error = null; renderShop(true);
    try { await logout(); } catch (err) { acct.busy = null; acct.error = sayOf(err, "me3.logoutFail"); renderShop(true); }
  }

  // A device-only shop makes its account through Sign up, which claims this shop (contract ACC).
  function makeAccount() {
    state.boot = "auth";
    history.replaceState(null, "", "#/signup");
    store.touch("boot");
  }

  function accountCard() {
    const a = state.account;
    if (state.accounts === "missing") return null;
    if (!a) {
      return h("article", { class: "card me-account-card" },
        cardHead(t("me3.account"), "user"),
        noteLine(t("me3.deviceOnly")),
        h("button", { class: "keycap keycap-primary keycap-md keycap-block", type: "button", on: { click: makeAccount } }, icon("key", 22), h("span", { text: t("me3.makeAccount") })));
    }
    const busy = Boolean(acct.busy);
    return h("article", { class: "card me-account-card" },
      cardHead(t("me3.account"), "user"),
      h("p", { class: "me-phone" }, icon("phone", 22), h("span", { class: "num", text: phoneLine(a.phone) })),
      a.phone_verified ? null : h("div", { class: "me-honest", role: "note" },
        h("p", { class: "pill pill-wait" }, icon("alert", 18), h("span", { text: t("me3.notVerified") })),
        h("p", { class: "me-honest-why", text: t("me3.notVerifiedWhy") })),
      h("ul", { class: "rows me-account-rows" },
        acct.finger ? h("li", { class: `row${acct.busy === "finger" ? " is-busy" : ""}` },
          h("button", { class: "row-button", type: "button", disabled: busy ? true : undefined, "aria-busy": acct.busy === "finger" ? "true" : undefined, on: { click: onAddFinger } },
            h("span", { class: "row-ico", "aria-hidden": "true" }, acct.busy === "finger" ? busySpin() : icon("fingerprint", 24)),
            h("span", { class: "row-main" }, h("span", { class: "row-title", text: t("me3.finger") }), h("span", { class: "row-sub", text: t("me3.fingerSub") })),
            h("span", { class: "row-end", "aria-hidden": "true" }, icon("chevronRight", 22)))) : null,
        h("li", { class: `row${acct.busy === "logout" ? " is-busy" : ""}` },
          h("button", { class: "row-button me-logout", type: "button", disabled: busy ? true : undefined, "aria-busy": acct.busy === "logout" ? "true" : undefined, on: { click: onLogout } },
            h("span", { class: "row-ico", "aria-hidden": "true" }, acct.busy === "logout" ? busySpin() : icon("logout", 24)),
            h("span", { class: "row-main" }, h("span", { class: "row-title", text: acct.busy === "logout" ? t("me3.loggingOut") : t("me3.logout") }), h("span", { class: "row-sub", text: t("me3.logoutSub") })),
            h("span", { class: "row-end", "aria-hidden": "true" }, icon("chevronRight", 22))))),
      acct.note ? h("p", { class: "me-ok-line", role: "status" }, h("span", { class: "me-ok-mark", "aria-hidden": "true" }, icon("check", 22)), h("span", { text: acct.note })) : null,
      acct.error ? errLine(acct.error) : null);
  }

  function renderShop(force = false) {
    if (force) panels.shop.__key = null;
    const key = JSON.stringify([sell.status, sell.settings, state.telegramLinked, state.account, state.accounts, acct, currentLang()]);
    patch(panels.shop, key, () => [shopCard(), telegramCard(), accountCard()].filter(Boolean));
  }

  /* ------------------------------------------------------------ render -- */
  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (all || parts.has("business")) renderHead();
    if (all || parts.has("agent")) renderTabs();
    if (section === "teach" && (all || parts.has("agent"))) renderRules();
    else if (section === "memory" && (all || parts.has("agent"))) renderMemory();
    else if (all || parts.has("agent")) firstStarsSeen();
    if (section === "voice" && (all || parts.has("agent"))) renderVoice();
    if (section === "shop" && (all || parts.has("sell") || parts.has("orders") || parts.has("business") || parts.has("boot"))) renderShop();
    if (section === "history") history.update(all ? new Set(["all"]) : parts);
  }

  // Off the Teach section, still remember which stars exist so "New" marks only real arrivals.
  function firstStarsSeen() {
    const A = state.agent;
    if (A.status !== "ready") return;
    for (const it of starItems([...A.rules.values()], [...A.memories.values()])) seen.add(`${it.type}:${it.data.id}`);
    firstStars = false;
    // A rule decided by voice while its sheet is open elsewhere still closes the sheet.
    if (sheet && sheet.it.type === "rule") {
      const now = A.rules.get(String(sheet.it.data.id));
      if (now && now.status !== sheet.it.data.status && now.status !== "suggested") closeRuleSheet();
    }
  }

  function onHash() {
    if (!/^#\/(me|history)(\/|$)/.test(location.hash)) return;
    const next = sectionFromHash(location.hash) || "teach";
    if (next !== section) show(next, { focus: true });
  }
  window.addEventListener("hashchange", onHash);

  for (const [id, p] of Object.entries(panels)) p.hidden = id !== section;

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && state.boot === "ready") loadSell();
      render(parts);
    },
    enter(arg) {
      const sub = (arg && arg.sub) || sectionFromHash(location.hash);
      show(sub || section);
      if (state.agent.status === "error" || state.agent.status === "missing") loadAgent();
      if (state.boot === "ready" && (sell.status === "idle" || sell.status === "error")) loadSell();
    },
    leave() { closeRuleSheet(); },
  };
}
