// My Sahay (UI v5, screens.md 08; owner W5): #/me and #/me/<section>. Page pattern: title, one
// sentence, ONE pink button "Talk to Sahay" (it opens a short sheet first; only its "Start talking"
// starts a call, so nothing starts a call by accident). Then "Needs you" (only when a suggested rule
// waits: W3's Yes card, or a plain keep / forget card if that module is not in this build), then ONE
// card of setting rows, each = label + one sentence + one control:
//   Ask me before every order   toggle, on and locked ("Always on": product rule 3)
//   Sahay's voice               speaking speed -> "Change" (sheet)
//   Bargaining                  how hard Sahay bargains -> "Change" (sheet)
//   Language                    the language Sahay speaks: English / हिन्दी / ಕನ್ನಡ (segmented)
//   Shop details                name, GST number, phone -> "Change" (sheet: GST, state, address;
//                               the account: phone not verified, add fingerprint; Telegram updates)
//   What Sahay remembers        count -> "See all" (sheet: rules with Forget, memories read only)
//   History                     "See all" (sheet: day-grouped list, read only)
// The spec's spending limit and voice sample are left out: the server has neither (no invented features).
// Sections from the shell (#/me/shop, #/me/history, #/me/teach, #/me/voice) open their sheet.

import {
  h, icon, fill, patch, scripted, button, pageHead, section, card, list, emptyState, skeleton, errorLine,
  field, segmented, toggle, yesNo, openSheet, closeSheet, notify,
} from "./ui.js";
import { t, LANGS, lang as currentLang, cityWord, addStrings } from "./i18n.js";
import * as store from "./store.js";
import { state, loadAgent, updateProfile, decideRule, ownerLanguage } from "./store.js";
import * as api from "../api.js";
import { passkeyAvailable, addPasskey, cancelled } from "./passkey.js";
import { sell, loadSell, saveShopSettings } from "./store-sell.js";
import { SCHEMES, stateLabel, findStates, cleanGstin, stateOfGstin, needsGstin, missingFact, formProblems, settingsBody } from "./shop-facts.js";
import { speakButton } from "./speak.js";
import { starIcon, sentenceOf } from "./star-words.js";
import { createHistoryPanel } from "./history.js";
import { sectionFromHash, STYLES, SPEEDS, starItems, telegramLink } from "./me-logic.js";
import { phoneLine } from "./auth-logic.js";
import "./me-strings.js";

addStrings({
  "me5.talk": ["Talk to Sahay", "सहाय से बात करें", "ಸಹಾಯ್ ಜೊತೆ ಮಾತನಾಡಿ"],
  "me5.pageSentence": ["How Sahay works for your shop.", "सहाय आपकी दुकान के लिए कैसे काम करती है।", "ಸಹಾಯ್ ನಿಮ್ಮ ಅಂಗಡಿಗಾಗಿ ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ."],
  "me5.talkTitle": ["Change things by talking", "बात करके बदलें", "ಮಾತನಾಡಿ ಬದಲಿಸಿ"],
  "me5.talkStep2": ["Say what you want, like a new rule or a slower voice.", "जो चाहिए वह बोलिए, जैसे नया नियम या धीमी आवाज़।", "ಬೇಕಾದ್ದು ಹೇಳಿ, ಉದಾ ಹೊಸ ನಿಯಮ ಅಥವಾ ನಿಧಾನ ಧ್ವನಿ."],
  "me5.needsYou": ["Needs you", "आपकी ज़रूरत है", "ನಿಮ್ಮ ಅಗತ್ಯವಿದೆ"],
  "me5.settings": ["Settings", "सेटिंग", "ಸೆಟ್ಟಿಂಗ್"],
  "me5.askLabel": ["Ask me before every order", "हर ऑर्डर से पहले मुझसे पूछें", "ಪ್ರತಿ ಆರ್ಡರ್‌ಗೆ ಮೊದಲು ನನ್ನನ್ನು ಕೇಳಿ"],
  "me5.askSentence": ["Nothing is ordered, billed or paid without your yes.", "आपकी हाँ के बिना कुछ भी ऑर्डर, बिल या भुगतान नहीं होता।", "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಏನೂ ಆರ್ಡರ್, ಬಿಲ್ ಅಥವಾ ಪಾವತಿ ಆಗುವುದಿಲ್ಲ."],
  "me5.alwaysOn": ["Always on", "हमेशा चालू", "ಯಾವಾಗಲೂ ಆನ್"],
  "me5.voiceLabel": ["Sahay's voice", "सहाय की आवाज़", "ಸಹಾಯ್ ಧ್ವನಿ"],
  "me5.voiceSentence": ["Speaks at {speed} speed.", "{speed} रफ़्तार से बोलती है।", "{speed} ವೇಗದಲ್ಲಿ ಮಾತನಾಡುತ್ತದೆ."],
  "me5.styleLabel": ["Bargaining", "मोलभाव", "ಚೌಕಾಸಿ"],
  "me5.styleSentence": ["{style}: how hard Sahay bargains with sellers.", "{style}: सहाय विक्रेताओं से कितना मोलभाव करे।", "{style}: ಸಹಾಯ್ ಮಾರಾಟಗಾರರೊಂದಿಗೆ ಎಷ್ಟು ಚೌಕಾಸಿ ಮಾಡಲಿ."],
  "me5.langLabel": ["Language", "भाषा", "ಭಾಷೆ"],
  "me5.langSentence": ["The language Sahay speaks on calls.", "कॉल पर सहाय की भाषा।", "ಕರೆಗಳಲ್ಲಿ ಸಹಾಯ್ ಮಾತನಾಡುವ ಭಾಷೆ."],
  "me5.rememberLabel": ["What Sahay remembers", "सहाय को क्या याद है", "ಸಹಾಯ್‌ಗೆ ನೆನಪಿರುವುದು"],
  "me5.rememberSentence": ["{n} rules and notes from your work.", "आपके काम से {n} नियम और बातें।", "ನಿಮ್ಮ ಕೆಲಸದಿಂದ {n} ನಿಯಮಗಳು ಮತ್ತು ಟಿಪ್ಪಣಿಗಳು."],
  "me5.rememberNone": ["Nothing yet. Teach Sahay by talking.", "अभी कुछ नहीं। बात करके सिखाइए।", "ಇನ್ನೂ ಏನೂ ಇಲ್ಲ. ಮಾತನಾಡಿ ಕಲಿಸಿ."],
  "me5.historyLabel": ["History", "इतिहास", "ಇತಿಹಾಸ"],
  "me5.historySentence": ["Everything Sahay did, newest first.", "सहाय ने जो किया, नया सबसे ऊपर।", "ಸಹಾಯ್ ಮಾಡಿದ ಎಲ್ಲವೂ, ಹೊಸದು ಮೊದಲು."],
  "me5.seeAll": ["See all", "सब देखें", "ಎಲ್ಲಾ ನೋಡಿ"],
  "me5.changeShort": ["Change", "बदलें", "ಬದಲಿಸಿ"],
  "me5.speedTitle": ["Speaking speed", "बोलने की रफ़्तार", "ಮಾತಿನ ವೇಗ"],
  "me5.done": ["Done", "हो गया", "ಆಯಿತು"],
  "me5.teachStep1": ["Press Start talking.", "बात शुरू करें दबाइए।", "ಮಾತು ಶುರು ಮಾಡಿ ಒತ್ತಿ."],
  "me5.teachStep3": ["Sahay reads it back. It is kept only after your yes.", "सहाय पढ़कर सुनाएगी। आपकी हाँ के बाद ही रखेगी।", "ಸಹಾಯ್ ಓದಿ ಹೇಳುತ್ತದೆ. ನಿಮ್ಮ ಒಪ್ಪಿಗೆಯ ನಂತರವೇ ಉಳಿಸುತ್ತದೆ."],
  "me5.example": ["For example", "उदाहरण", "ಉದಾಹರಣೆ"],
  "me5.startTalking": ["Start talking", "बात शुरू करें", "ಮಾತು ಶುರು ಮಾಡಿ"],
  "me5.notNow": ["Not now", "अभी नहीं", "ಈಗ ಬೇಡ"],
  "me5.forgotten": ["Rule forgotten", "नियम भुला दिया", "ನಿಯಮ ಮರೆಯಲಾಗಿದೆ"],
  "me5.kept": ["Rule kept", "नियम रख लिया", "ನಿಯಮ ಉಳಿಸಲಾಗಿದೆ"],
  "me5.shopTitle": ["Shop details", "दुकान की जानकारी", "ಅಂಗಡಿ ವಿವರ"],
  "me5.shopName": ["Shop name", "दुकान का नाम", "ಅಂಗಡಿ ಹೆಸರು"],
  "me5.city": ["City", "शहर", "ನಗರ"],
  "me5.state": ["State", "राज्य", "ರಾಜ್ಯ"],
  "me5.gstin": ["GST number", "GST नंबर", "GST ಸಂಖ್ಯೆ"],
  "me5.address": ["Shop address (if you like)", "दुकान का पता (चाहें तो)", "ಅಂಗಡಿ ವಿಳಾಸ (ಬೇಕಿದ್ದರೆ)"],
  "me5.notAdded": ["Not added", "नहीं डाला", "ಹಾಕಿಲ್ಲ"],
  "me5.add": ["Add shop details", "दुकान की जानकारी डालें", "ಅಂಗಡಿ ವಿವರ ಹಾಕಿ"],
  "me5.scheme.unregistered": ["No GST", "GST नहीं", "GST ಇಲ್ಲ"],
  "me5.scheme.regular": ["Registered", "रजिस्टर्ड", "ನೋಂದಾಯಿತ"],
  "me5.scheme.composition": ["Composition", "कंपोज़िशन", "ಕಾಂಪೋಸಿಷನ್"],
  "me5.how": ["How do you bill?", "आप बिल कैसे बनाते हैं?", "ನೀವು ಬಿಲ್ ಹೇಗೆ ಮಾಡುತ್ತೀರಿ?"],
  "me5.stateSearch": ["Type your state", "अपना राज्य लिखें", "ನಿಮ್ಮ ರಾಜ್ಯ ಬರೆಯಿರಿ"],
  "me5.stateNone": ["No state matches. Check the spelling.", "कोई राज्य नहीं मिला। स्पेलिंग देखें।", "ಯಾವ ರಾಜ್ಯವೂ ಸಿಗಲಿಲ್ಲ. ಕಾಗುಣಿತ ನೋಡಿ."],
  "me5.stateFromGstin": ["From your GST number: {state}", "आपके GST नंबर से: {state}", "ನಿಮ್ಮ GST ಸಂಖ್ಯೆಯಿಂದ: {state}"],
  "me5.save": ["Save", "सेव करें", "ಉಳಿಸಿ"],
  "me5.saved": ["Shop details saved", "दुकान की जानकारी सेव हुई", "ಅಂಗಡಿ ವಿವರ ಉಳಿಸಲಾಗಿದೆ"],
  "me5.saveFail": ["The shop details were not saved.", "दुकान की जानकारी सेव नहीं हुई।", "ಅಂಗಡಿ ವಿವರ ಉಳಿಯಲಿಲ್ಲ."],
  "me5.gstin.empty": ["Type your 15-character GST number.", "अपना 15 अक्षर का GST नंबर लिखिए।", "ನಿಮ್ಮ 15 ಅಕ್ಷರದ GST ಸಂಖ್ಯೆ ಬರೆಯಿರಿ."],
  "me5.gstin.short": ["A GST number has 15 characters.", "GST नंबर में 15 अक्षर होते हैं।", "GST ಸಂಖ್ಯೆಯಲ್ಲಿ 15 ಅಕ್ಷರ ಇರುತ್ತವೆ."],
  "me5.gstin.shape": ["Check the GST number as it is on your certificate.", "GST नंबर प्रमाणपत्र से मिलाकर देखिए।", "ಪ್ರಮಾಣಪತ್ರದಂತೆ GST ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ."],
  "me5.state.empty": ["Choose the state your shop is in.", "दुकान किस राज्य में है, चुनिए।", "ಅಂಗಡಿ ಯಾವ ರಾಜ್ಯದಲ್ಲಿದೆ ಆಯ್ಕೆಮಾಡಿ."],
  "me5.need.GSTIN_REQUIRED": ["Add your GST number before making a GST bill, or choose No GST.", "GST बिल से पहले GST नंबर डालिए, या 'GST नहीं' चुनिए।", "GST ಬಿಲ್ ಮೊದಲು GST ಸಂಖ್ಯೆ ಹಾಕಿ, ಅಥವಾ 'GST ಇಲ್ಲ' ಆಯ್ಕೆಮಾಡಿ."],
  "me5.need.STATE_REQUIRED": ["Add your state before making a bill.", "बिल से पहले अपना राज्य डालिए।", "ಬಿಲ್ ಮೊದಲು ನಿಮ್ಮ ರಾಜ್ಯ ಹಾಕಿ."],
  "me5.shopOff": ["Billing is not on this server yet.", "इस सर्वर पर अभी बिल नहीं बनते।", "ಈ ಸರ್ವರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಬಿಲ್ ಆಗುವುದಿಲ್ಲ."],
  "me5.loadShopFail": ["Could not load the shop details.", "दुकान की जानकारी नहीं आई।", "ಅಂಗಡಿ ವಿವರ ಬರಲಿಲ್ಲ."],
  "me5.tgTitle": ["Telegram updates", "टेलीग्राम पर खबर", "ಟೆಲಿಗ್ರಾಮ್ ಸುದ್ದಿ"],
  "me5.accountTitle": ["Your account", "आपका खाता", "ನಿಮ್ಮ ಖಾತೆ"],
});

const SPEED_ICON = { slow: "turtle", normal: "gauge" };
const LANG_NAMES = { en: "English", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const STYLE_ICON = { gentle: "heart", balanced: "handshake", tough: "shield" };
const sayOf = (err, key) => (err && (err.say || (err.status === 0 ? t("err.network") : err.status === 429 ? t("err.limit") : null))) || t(key);

/** W3's Yes card renderer when this build has it (yes.js createYesCard); null otherwise. */
let yesModule = null;
import("./yes.js").then((m) => { if (m && typeof m.createYesCard === "function") { yesModule = m; store.touch("agent"); } }).catch(() => {});

export function createMe() {
  const el = h("section", { class: "me", "aria-labelledby": "me-title" });
  const head = h("div", { class: "me-head" });
  const needs = h("div", { class: "me-needs" });
  const settings = h("div", { class: "me-settings" });
  el.append(head, needs, settings);

  const saving = { field: null, error: null, ok: null };
  const ruleBusy = new Map(); // ruleId -> "keep" | "forget" | { error }
  const acct = { finger: null, busy: null, note: null, error: null };
  const tg = { busy: false, error: null, off: false, link: null, code: null, blocked: false };
  let openSub = null; // which sheet is open: "voice" | "style" | "shop" | "teach" | "history"
  let sheetApi = null;
  let historyPanel = null;
  passkeyAvailable().then((ok) => { acct.finger = ok; if (openSub === "shop") paintShopSheet(); });

  const code = () => ownerLanguage() || "en-IN";
  const profile = () => state.agent.profile || {};

  /* ------------------------------------------------------------ head -- */
  function openTalk(e) {
    const start = () => {
      closeSheet(false);
      document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: "talk.teachHint" } }));
    };
    openSheet({
      title: t("me5.talkTitle"), opener: e && e.currentTarget,
      body: [
        h("ol", { class: "me-steps" },
          h("li", null, h("span", { class: "me-step-n", text: "1" }), scripted("span", t("me5.teachStep1"))),
          h("li", null, h("span", { class: "me-step-n", text: "2" }), scripted("span", t("me5.talkStep2"))),
          h("li", null, h("span", { class: "me-step-n", text: "3" }), scripted("span", t("me5.teachStep3")))),
        h("div", { class: "me-example" }, h("p", { class: "field-label", text: t("me5.example") }), scripted("p", t("me3.speakPhrase"), { class: "me-example-text" })),
      ],
      footer: [
        button({ word: t("me5.notNow"), kind: "secondary", onClick: () => closeSheet() }),
        button({ word: t("me5.startTalking"), icon: "mic", kind: "primary", onClick: start }),
      ],
    });
  }

  function renderHead() {
    patch(head, currentLang(), () => {
      const node = pageHead({ title: t("me.title"), sentence: t("me5.pageSentence"), action: { word: t("me5.talk"), icon: "mic", onClick: openTalk } });
      const h1 = node.querySelector("h1");
      if (h1) h1.id = "me-title";
      return node;
    });
  }

  /* -------------------------------------------------------- Needs you -- */
  async function decide(rule, decision) {
    const id = String(rule.id);
    ruleBusy.set(id, decision);
    renderAll();
    try {
      await decideRule(id, decision);
      ruleBusy.delete(id);
      notify({ tone: "good", title: t(decision === "keep" ? "me5.kept" : "me5.forgotten"), icon: decision === "keep" ? "check" : "x" });
    } catch (err) {
      ruleBusy.set(id, { error: err.status === 409 ? t("me3.gone") : sayOf(err, "me.saveFail") });
    }
    renderAll();
  }

  function suggestedCard(rule) {
    if (yesModule) {
      try { return yesModule.createYesCard({ key: `rule:${rule.id}`, kind: "rule", id: String(rule.id) }, { inline: true }); } catch (err) { console.error(err); }
    }
    const b = ruleBusy.get(String(rule.id));
    const why = rule.why ? sentenceOf({ sentence: rule.why }, code()) : "";
    return card({
      title: sentenceOf(rule, code()), sub: why ? `${t("me.why")}: ${why}` : null, speakKey: `rule:${rule.id}`, needs: true,
      body: [
        h("p", { class: "note-line" }, icon("shield", 18), scripted("span", t("me.voiceSays"))),
        yesNo({ busy: b === "keep" ? "yes" : b === "forget" ? "no" : null, yesWord: t("me.keep"), noWord: t("me.forget"), yesLabel: t("me3.keepLong"), noLabel: t("me3.forgetLong"), onYes: () => decide(rule, "keep"), onNo: () => decide(rule, "forget") }),
        b && b.error ? errorLine(b.error) : null,
      ],
    });
  }

  function renderNeeds() {
    const A = state.agent;
    const sugg = A.status === "ready" ? [...A.rules.values()].filter((r) => r.status === "suggested") : [];
    patch(needs, JSON.stringify([sugg.map((r) => [r.id, r.sentence, r.why]), [...ruleBusy], Boolean(yesModule), currentLang()]), () => sugg.length
      ? section({ title: t("me5.needsYou"), count: sugg.length, body: h("div", { class: "me-cards" }, ...sugg.map(suggestedCard)) })
      : []);
  }

  /* ---------------------------------------------------- settings card -- */
  function settingRow({ id, label, sentence, control, wide = false }) {
    return h("li", { class: `me-row${wide ? " me-row-wide" : ""}`, id: id ? `me-row-${id}` : undefined },
      h("div", { class: "me-row-text" }, scripted("p", label, { class: "me-row-label" }), sentence ? scripted("p", sentence, { class: "me-row-sentence" }) : null),
      h("div", { class: "me-row-control" }, ...(Array.isArray(control) ? control : [control])));
  }

  const changeBtn = (word, onClick, labelText) => button({ word, kind: "secondary", size: "sm", label: labelText, onClick });

  async function save(fieldName, value) {
    saving.field = fieldName; saving.error = null; saving.ok = null;
    renderAll();
    try { await updateProfile({ [fieldName]: value }); saving.ok = fieldName; }
    catch (err) { saving.error = { field: fieldName, message: sayOf(err, "me.saveFail") }; }
    saving.field = null;
    renderAll();
  }

  function stateLine(f) {
    if (saving.field === f) return h("p", { class: "me-save-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t("ui.saving") }));
    if (saving.error && saving.error.field === f) return errorLine(saving.error.message);
    if (saving.ok === f) return h("p", { class: "me-save-line is-ok", role: "status" }, icon("check", 18), h("span", { text: t("me.saved") }));
    return null;
  }

  function choiceSheet(sub, title, f, options) {
    openSub = sub;
    const paint = () => {
      const cur = profile()[f] || (f === "voice_speed" ? "normal" : "balanced");
      const seg = segmented({ label: title, options, value: cur, onPick: (id) => { if (saving.field !== f) save(f, id); } });
      seg.classList.add("me-choice");
      return [seg, stateLine(f)];
    };
    sheetApi = openSheet({ title, body: paint(), footer: button({ word: t("me5.done"), kind: "primary", block: true, onClick: () => closeSheet() }), onClose: () => { openSub = null; sheetApi = null; } });
    sheetApi.repaint = () => sheetApi.setBody(paint());
  }
  const openVoice = () => choiceSheet("voice", t("me5.speedTitle"), "voice_speed", SPEEDS.map((x) => ({ id: x, icon: SPEED_ICON[x], word: t(`me.speed.${x}`) })));
  const openStyle = () => choiceSheet("style", t("me3.styleTitle"), "bargain_style", STYLES.map((x) => ({ id: x, icon: STYLE_ICON[x], word: t(`me.style.${x}`) })));

  function rememberCount() {
    const A = state.agent;
    if (A.status !== "ready") return null;
    return starItems([...A.rules.values()], [...A.memories.values()]).filter((i) => i.type === "memory" || i.data.status === "active").length;
  }

  function renderSettings() {
    const A = state.agent;
    const p = profile();
    const b = state.business || {};
    const s = sell.settings;
    const n = rememberCount();
    const key = JSON.stringify([A.status, p, saving, n, b.name, b.city, sell.status, s, state.account && state.account.phone, currentLang()]);
    patch(settings, key, () => {
      const gate = A.status === "loading" || A.status === "idle" ? skeleton("rows", 4)
        : A.status === "error" ? emptyState({ inline: true, icon: "alert", title: t("me.loadFail"), text: A.error ? sayOf(A.error, "err.network") : "", action: { word: t("retry"), icon: "refresh", onClick: () => loadAgent() } })
          : A.status === "missing" ? emptyState({ inline: true, icon: "sliders", title: t("me3.missing.title"), text: t("me3.missing.text") }) : null;
      const lockToggle = toggle({ label: t("me5.alwaysOn"), checked: true });
      const box = lockToggle.querySelector("input");
      if (box) { box.disabled = true; box.setAttribute("aria-label", `${t("me5.askLabel")}: ${t("me5.alwaysOn")}`); }
      const shopBits = [b.name || t("me5.notAdded")];
      if (s && needsGstin(s.gstScheme)) shopBits.push(s.gstin || `${t("me5.gstin")}: ${t("me5.notAdded")}`);
      else if (s) shopBits.push(t("me5.scheme.unregistered"));
      if (state.account && state.account.phone) shopBits.push(phoneLine(state.account.phone));
      const need = s ? missingFact(s) : null;
      const rows = [
        settingRow({ id: "ask", label: t("me5.askLabel"), sentence: t("me5.askSentence"), control: lockToggle }),
      ];
      if (!gate) {
        rows.push(
          settingRow({ id: "voice", label: t("me5.voiceLabel"), sentence: t("me5.voiceSentence", { speed: t(`me.speed.${p.voice_speed || "normal"}`) }), control: [changeBtn(t("me5.changeShort"), openVoice, `${t("me5.changeShort")}: ${t("me5.voiceLabel")}`), stateLine("voice_speed")] }),
          settingRow({ id: "style", label: t("me5.styleLabel"), sentence: t("me5.styleSentence", { style: t(`me.style.${p.bargain_style || "balanced"}`) }), control: [changeBtn(t("me5.changeShort"), openStyle, `${t("me5.changeShort")}: ${t("me5.styleLabel")}`), stateLine("bargain_style")] }),
          settingRow({ id: "lang", wide: true, label: t("me5.langLabel"), sentence: t("me5.langSentence"), control: [
            segmented({ label: t("me5.langLabel"), options: LANGS.map((L) => ({ id: L.code, word: LANG_NAMES[L.short] })), value: p.language || ownerLanguage() || "en-IN", onPick: (id) => { if (saving.field !== "language") save("language", id); } }),
            stateLine("language")] }),
        );
      }
      rows.push(settingRow({ id: "shop", label: t("me5.shopTitle"), sentence: need ? t(`me5.need.${need}`) : shopBits.join(", "), control: changeBtn(need ? t("me5.add") : t("me5.changeShort"), (e) => openShop(e.currentTarget), `${t("me5.changeShort")}: ${t("me5.shopTitle")}`) }));
      if (!gate) rows.push(settingRow({ id: "remember", label: t("me5.rememberLabel"), sentence: n ? t("me5.rememberSentence", { n }) : t("me5.rememberNone"), control: changeBtn(t("me5.seeAll"), (e) => openRemember(e.currentTarget), `${t("me5.seeAll")}: ${t("me5.rememberLabel")}`) }));
      rows.push(settingRow({ id: "history", label: t("me5.historyLabel"), sentence: t("me5.historySentence"), control: changeBtn(t("me5.seeAll"), (e) => openHistory(e.currentTarget), `${t("me5.seeAll")}: ${t("me5.historyLabel")}`) }));
      return h("article", { class: "card me-card" },
        h("h2", { class: "sr-only", text: t("me5.settings") }),
        h("ul", { class: "me-rows" }, ...rows),
        gate);
    });
  }

  /* ------------------------------------------------- What Sahay remembers -- */
  function rememberBody() {
    const A = state.agent;
    const items = A.status === "ready" ? starItems([...A.rules.values()], [...A.memories.values()]).filter((i) => i.type === "memory" || i.data.status === "active") : [];
    if (!items.length) return emptyState({ icon: "star", title: t("me5.rememberNone") });
    return list(items.map((it) => {
      const d = it.data;
      const b = ruleBusy.get(String(d.id));
      const why = d.why ? sentenceOf({ sentence: d.why }, code()) : "";
      return {
        icon: starIcon(it),
        title: sentenceOf(d, code()),
        sub: b && b.error ? b.error : (why || (it.type === "memory" ? t("me3.legend.memory") : t("me3.legend.rule"))),
        end: [
          speakButton(`${it.type}:${d.id}`),
          it.type === "rule" ? button({ word: t("me.forget"), icon: b === "forget" ? null : "x", kind: "secondary", size: "sm", busy: b === "forget", label: `${t("me3.forgetLong")}: ${sentenceOf(d, code())}`, onClick: () => decide(d, "forget") }) : null,
        ].filter(Boolean),
      };
    }), { label: t("me5.rememberLabel"), limit: 20 });
  }
  function openRemember(opener) {
    openSub = "teach";
    sheetApi = openSheet({ title: t("me5.rememberLabel"), opener, body: rememberBody(), onClose: () => { openSub = null; sheetApi = null; } });
    sheetApi.repaint = () => sheetApi.setBody(rememberBody());
  }

  /* -------------------------------------------------------------- History -- */
  function openHistory(opener) {
    openSub = "history";
    historyPanel = createHistoryPanel();
    historyPanel.update(new Set(["all"]));
    sheetApi = openSheet({ title: t("me5.historyLabel"), opener, body: historyPanel.el, onClose: () => { openSub = null; sheetApi = null; historyPanel = null; } });
  }

  /* ----------------------------------------------------------------- Shop -- */
  const form = { scheme: "unregistered", gstin: "", state: "", address: "", query: "", errs: {}, busy: false, refusal: null };

  function openShop(opener) {
    const s = sell.settings || {};
    Object.assign(form, { scheme: s.gstScheme || "unregistered", gstin: s.gstin || "", state: s.stateCode || "", address: s.address || "", query: "", errs: {}, busy: false, refusal: null });
    openSub = "shop";
    sheetApi = openSheet({ title: t("me5.shopTitle"), opener, body: [], onClose: () => { openSub = null; sheetApi = null; } });
    sheetApi.repaint = paintShopSheet;
    paintShopSheet();
  }

  async function saveShop() {
    if (form.busy) return;
    form.errs = formProblems(form);
    if (Object.keys(form.errs).length) { paintShopSheet(); return; }
    form.busy = true; form.refusal = null; paintShopSheet();
    try {
      await saveShopSettings(settingsBody(form));
      form.busy = false;
      notify({ tone: "good", title: t("me5.saved"), icon: "check" });
      closeSheet();
    } catch (err) {
      form.busy = false;
      form.refusal = sayOf(err, "me5.saveFail");
      paintShopSheet();
    }
  }

  function paintShopSheet() {
    if (!sheetApi || openSub !== "shop") return;
    const L = currentLang();
    const b = state.business || {};
    const parts = [];
    parts.push(list([
      { icon: "store", title: b.name || t("me5.notAdded"), sub: t("me5.shopName") },
      { icon: "pin", title: b.city ? cityWord(b.city) : t("me5.notAdded"), sub: t("me5.city") },
    ], { label: t("me5.shopTitle") }));
    if (sell.status === "missing") parts.push(h("p", { class: "note-line" }, icon("info", 18), h("span", { text: t("me5.shopOff") })));
    else if (sell.status === "loading" || sell.status === "idle") parts.push(skeleton("lines", 3));
    else if (sell.status === "error") parts.push(emptyState({ inline: true, icon: "alert", title: t("me5.loadShopFail"), action: { word: t("retry"), icon: "refresh", onClick: () => loadSell() } }));
    else {
      parts.push(h("p", { class: "field-label", text: t("me5.how") }),
        segmented({ label: t("me5.how"), options: SCHEMES.map((k) => ({ id: k, word: t(`me5.scheme.${k}`) })), value: form.scheme, onPick: (k) => { form.scheme = k; form.errs = {}; paintShopSheet(); } }));
      if (needsGstin(form.scheme)) {
        const g = field({ label: t("me5.gstin"), value: form.gstin, autocomplete: "off", maxlength: 15, onInput: (v) => { form.gstin = cleanGstin(v); if (g.input.value !== form.gstin) g.input.value = form.gstin; } });
        g.input.setAttribute("autocapitalize", "characters");
        g.input.addEventListener("change", () => paintShopSheet());
        if (form.errs.gstin) g.setError(t(`me5.gstin.${form.errs.gstin}`));
        parts.push(g.el);
      }
      const fromG = needsGstin(form.scheme) ? stateOfGstin(form.gstin) : null;
      if (fromG) parts.push(h("p", { class: "note-line" }, icon("check", 18), scripted("span", t("me5.stateFromGstin", { state: stateLabel(fromG, L) }))));
      else {
        const search = field({ label: t("me5.state"), value: form.query, autocomplete: "off", onInput: (v) => { form.query = v; fill(stateList, ...stateRows()); } });
        search.input.setAttribute("placeholder", t("me5.stateSearch"));
        const stateList = h("div", { class: "me-states" });
        const stateRows = () => {
          const rows = findStates(form.query, L).slice(0, 6);
          if (!rows.length) return [h("p", { class: "note-line" }, icon("info", 18), h("span", { text: t("me5.stateNone") }))];
          return [h("ul", { class: "list", "aria-label": t("me5.state") }, ...rows.map((r) => h("li", null,
            h("button", { class: "row", type: "button", "aria-pressed": String(form.state === r.code), on: { click: () => { form.state = r.code; form.errs.state = null; paintShopSheet(); } } },
              h("span", { class: "row-main" }, scripted("span", r.label, { class: "row-title" })),
              form.state === r.code ? h("span", { class: "row-end" }, icon("check", 20)) : null))))];
        };
        fill(stateList, ...stateRows());
        parts.push(search.el, form.state ? h("p", { class: "note-line" }, icon("pin", 18), scripted("span", `${t("me5.state")}: ${stateLabel(form.state, L)}`)) : null, stateList,
          form.errs.state ? errorLine(t("me5.state.empty")) : null);
      }
      const addr = field({ label: t("me5.address"), value: form.address, multiline: true, maxlength: 300, onInput: (v) => { form.address = v; } });
      parts.push(addr.el, form.refusal ? errorLine(form.refusal) : null,
        button({ word: t("me5.save"), icon: form.busy ? null : "check", kind: "primary", block: true, busy: form.busy, onClick: saveShop }));
    }
    parts.push(accountPart(), telegramPart());
    sheetApi.setBody(parts.filter(Boolean));
  }

  async function linkTelegram() {
    let win = null;
    try { win = window.open("", "_blank"); } catch { win = null; }
    Object.assign(tg, { busy: true, error: null, off: false, link: null, code: null, blocked: false });
    paintShopSheet();
    try {
      const r = await api.telegramLinkCode();
      const url = telegramLink(r);
      if (!url) throw Object.assign(new Error("no link"), { code: "TELEGRAM_NOT_CONFIGURED" });
      tg.link = url;
      tg.code = r && typeof r.code === "string" ? r.code : null;
      if (win && !win.closed) { try { win.opener = null; } catch { /* ignore */ } win.location.href = url; } else tg.blocked = true;
    } catch (err) {
      if (win && !win.closed) win.close();
      if (err && (err.code === "TELEGRAM_NOT_CONFIGURED" || err.status === 503)) tg.off = true;
      else tg.error = sayOf(err, "me3.tgFail");
    }
    tg.busy = false;
    paintShopSheet();
  }

  function telegramPart() {
    const kids = [h("h3", { class: "me-sheet-h", text: t("me5.tgTitle") })];
    if (state.telegramLinked) kids.push(h("p", { class: "note-line me-ok" }, icon("check", 18), scripted("span", `${t("me3.tgOn")}. ${t("me3.tgOnSub")}`)));
    else if (tg.off) kids.push(h("p", { class: "note-line" }, icon("info", 18), scripted("span", t("me3.tgOff"))));
    else if (tg.link) {
      kids.push(h("p", { class: "note-line", role: "status" }, icon("info", 18), scripted("span", tg.blocked ? t("me3.tgBlocked") : t("me3.tgPress"))));
      kids.push(button({ word: t("me3.tgOpen"), icon: "external", kind: tg.blocked ? "primary" : "secondary", href: tg.link, block: true }));
      if (tg.code) kids.push(h("p", { class: "me-code" }, h("span", { class: "field-label", text: t("me3.tgCode") }), h("span", { class: "me-code-value num", translate: "no", text: `/start ${tg.code}` })));
    } else {
      kids.push(scripted("p", t("me3.tgWhy"), { class: "me-row-sentence" }));
      kids.push(button({ word: tg.busy ? t("me3.tgOpening") : t("me3.tgLink"), icon: tg.busy ? null : "send", kind: "secondary", block: true, busy: tg.busy, onClick: linkTelegram }));
      if (tg.error) kids.push(errorLine(tg.error));
    }
    return h("div", { class: "me-sheet-part" }, ...kids);
  }

  async function onAddFinger() {
    acct.busy = "finger"; acct.note = null; acct.error = null; paintShopSheet();
    try { await addPasskey(); acct.note = t("me3.fingerAdded"); }
    catch (err) { if (!cancelled(err)) acct.error = sayOf(err, "me3.fingerFail"); }
    acct.busy = null; paintShopSheet();
  }

  // A device-only shop makes its account through Sign up, which claims this shop (contract ACC).
  function makeAccount() {
    closeSheet(false);
    state.boot = "auth";
    history.replaceState(null, "", "#/signup");
    store.touch("boot");
  }

  function accountPart() {
    if (state.accounts === "missing") return null;
    const a = state.account;
    const kids = [h("h3", { class: "me-sheet-h", text: t("me5.accountTitle") })];
    if (!a) {
      kids.push(h("p", { class: "note-line" }, icon("info", 18), scripted("span", t("me3.deviceOnly"))),
        button({ word: t("me3.makeAccount"), icon: "key", kind: "primary", block: true, onClick: makeAccount }));
      return h("div", { class: "me-sheet-part" }, ...kids);
    }
    kids.push(h("p", { class: "me-phone" }, icon("phone", 20), h("span", { class: "num", text: phoneLine(a.phone) })));
    if (!a.phone_verified) {
      kids.push(h("p", { class: "me-honest" }, h("span", { class: "me-warn-word" }, icon("alert", 16), scripted("span", t("me3.notVerified"))), scripted("span", ` ${t("me3.notVerifiedWhy")}`, { class: "me-honest-text" })));
    }
    if (acct.finger) kids.push(button({ word: t("me3.finger"), icon: acct.busy === "finger" ? null : "fingerprint", kind: "secondary", block: true, busy: acct.busy === "finger", onClick: onAddFinger }));
    if (acct.note) kids.push(h("p", { class: "note-line me-ok", role: "status" }, icon("check", 18), scripted("span", acct.note)));
    if (acct.error) kids.push(errorLine(acct.error));
    return h("div", { class: "me-sheet-part" }, ...kids);
  }

  /* --------------------------------------------------------------- render -- */
  function renderAll() {
    renderNeeds();
    renderSettings();
    if (sheetApi && sheetApi.repaint && (openSub === "voice" || openSub === "style" || openSub === "teach")) sheetApi.repaint();
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    if (all) renderHead();
    if (all || parts.has("agent") || parts.has("sell") || parts.has("business") || parts.has("boot")) renderAll();
    if (openSub === "shop" && (parts.has("sell") || parts.has("orders") || parts.has("lang"))) paintShopSheet();
    if (openSub === "history" && historyPanel) historyPanel.update(parts);
  }

  /** #/me/<section> (account menu: Shop, History) opens that sheet over the settings. */
  function openFor(sub) {
    if (!sub || openSub === sub) return;
    const opener = null;
    if (sub === "shop") openShop(opener);
    else if (sub === "history") openHistory(opener);
    else if (sub === "teach" || sub === "memory") openRemember(opener);
    else if (sub === "voice") openVoice();
  }

  window.addEventListener("hashchange", () => {
    if (!/^#\/(me|history)(\/|$)/.test(location.hash)) return;
    openFor(sectionFromHash(location.hash));
  });

  return {
    el,
    update: (_s, parts) => {
      if (sell.status === "idle" && state.boot === "ready") loadSell();
      render(parts);
    },
    enter(arg) {
      render(new Set(["all"]));
      if (state.agent.status === "error" || state.agent.status === "missing") loadAgent();
      if (state.boot === "ready" && (sell.status === "idle" || sell.status === "error")) loadSell();
      openFor((arg && arg.sub) || sectionFromHash(location.hash));
    },
    leave() { if (openSub) closeSheet(false); },
  };
}
