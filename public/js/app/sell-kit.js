// Shared pieces of the Sell, Stock and Money screens (UI v3): money and quantity words, item names
// in the owner's script, the read-aloud button every card carries in its top-right corner, the
// "speak" chip that starts the call in place (D11), headers and folds, the screen states
// (skeleton in the screen's shape, error with the server's say, not switched on, empty), the
// status stamp of a bill and the "simulated vendor" / "test mode" pills.
// Markup uses W1's shared component classes (public/css/README-v3.md section 2: .card, .paper,
// .stamp, .pill, .chip, .keycap, .rows, .state, .skel, .fold, .screen-head); only screen-specific
// rules live in public/css/app-sell.css. Logic without DOM: sell-facts.js and shop-facts.js.

import { h, icon, amount, rupees, toDate, num, svgEl, safeUrl, ICON_NAMES } from "./dom.js";
import { t, lang, unitWord, addStrings } from "./i18n.js";
import { speak, stopSpeaking } from "./speak.js";
import { talkAction } from "./empty.js";
import { openSheet, closeSheet } from "./sheet.js";
import { inCall, sendText } from "./call.js";
import { scriptOf } from "../voice.js";
import { st } from "./sell-i18n.js";

addStrings({
  "sv.today": ["today", "आज", "ಇಂದು"],
  "sv.days": ["{n} days", "{n} दिन", "{n} ದಿನ"],
  "sv.dayOne": ["1 day", "1 दिन", "1 ದಿನ"],
  "sv.speak": ["Speak", "बोलें", "ಮಾತಾಡಿ"],
  "sv.speakLong": ["Start talking to Sahay here", "यहीं से सहाय से बोलें", "ಇಲ್ಲಿಂದಲೇ ಸಹಾಯ್ ಜೊತೆ ಮಾತಾಡಿ"],
  "sv.testMode": ["test mode", "टेस्ट मोड", "ಟೆಸ್ಟ್ ಮೋಡ್"],
  "sv.loadingWord": ["Opening", "खुल रहा है", "ತೆರೆಯುತ್ತಿದೆ"],
  "sv.speakOn": ["Sahay is saying it on the call.", "सहाय कॉल पर बोल रही है।", "ಸಹಾಯ್ ಕರೆಯಲ್ಲಿ ಹೇಳುತ್ತಿದೆ."],
});

/* ------------------------------------------------------------ stylesheet -- */

/** app-sell.css, once. app.html may already link it; this only fills the gap. */
export function ensureCss() {
  if (document.querySelector('link[href="/css/app-sell.css"]')) return;
  document.head.append(h("link", { rel: "stylesheet", href: "/css/app-sell.css" }));
}

/* ------------------------------------------------------------- the words -- */

const inrPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "₹6,457.50" or "₹11,000": paise always as two digits, whole rupees without them. */
export function money(v) {
  const n = num(v);
  if (n === null) return "";
  return Number.isInteger(n) ? rupees(n) : `₹${inrPaise.format(n)}`;
}
/** One / many: st(key + "One") when n is 1, else st(key, { n }). */
export const count = (key, n) => st(n === 1 ? `${key}One` : key, { n });
export function qtyText(q, unit) {
  const n = amount(q);
  if (n === null) return "";
  const u = unitWord(unit);
  return u ? `${n} ${u}` : n;
}

/** The item's name in the owner's script when Sahay has it, else as stored. */
export function itemName(it) {
  if (!it) return "";
  const L = lang();
  if (it.nameNative && L !== "en" && scriptOf(it.nameNative) === L) return it.nameNative;
  return it.name || it.nameNative || "";
}

/** Whole days since a date (0 = today); null when the date is unknown. */
export function daysSince(ts) {
  const d = toDate(ts);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
export function daysWord(n) {
  if (n === null || n === undefined) return "";
  if (n === 0) return st("sv.today");
  return n === 1 ? st("sv.dayOne") : st("sv.days", { n });
}

/** Text that carries its script's lang attribute (Noto faces for Devanagari / Kannada). */
export function scriptedText(tag, text, props = {}) {
  const sc = scriptOf(text || "");
  return h(tag, { ...props, lang: sc === "hi" || sc === "kn" ? sc : props.lang, text: text || "" });
}

/** The first letter of a name (a whole grapheme, so a Devanagari conjunct stays whole). */
export function initial(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  try { return [...new Intl.Segmenter().segment(text)][0].segment; } catch { return text.slice(0, 1); }
}

/* ----------------------------------------------------------------- icons -- */

// Shapes these screens need that the shared set may not carry (24 x 24, stroke 2). The shared
// set wins when it has the name.
const LOCAL = {
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  eyeOff: ["M3 3l18 18", "M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9", "M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6", "M9.9 9.9a3 3 0 0 0 4.2 4.2"],
  chat: ["M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z", "M8.5 10.5c.4 1.9 2.2 3.7 4.2 4.2l1.3-1.2 2 .9"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2"],
  stop: ["M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 18l6-6-6-6"],
  chevronLeft: ["M15 18l-6-6 6-6"],
};

/** icon() from the shared set, else a local shape. */
export function ic(name, size = 24) {
  if (ICON_NAMES.includes(name) || !LOCAL[name]) return icon(name, size);
  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" });
  for (const d of LOCAL[name]) svg.appendChild(svgEl("path", { d }));
  return svg;
}

/* ------------------------------------------------------------- ask Sahay -- */

/**
 * The screen's "speak" chip: starts the call where the owner is (no jump to Sahay home), with the
 * screen's hint. On a live call a prompt is sent as typed words (a request, never a yes).
 */
export function ask({ prompt, hint }) {
  if (inCall() && prompt) { sendText(prompt); return; }
  document.dispatchEvent(new CustomEvent("sahay:talk", { detail: { mode: "voice", hint: hint || null } }));
}

/* ------------------------------------------------------------ read aloud -- */

let playing = null; // { key, utter? }
const watchers = new Set();
function emit() { for (const fn of [...watchers]) fn(playing && playing.key); }

const SPEECH_LANG = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
function browserVoiceFor(code) {
  try {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return voices.find((v) => v.lang === code) || voices.find((v) => v.lang && v.lang.startsWith(code.slice(0, 2))) || null;
  } catch { return null; }
}

function stopAll() {
  stopSpeaking();
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* ignore */ }
  playing = null;
  emit();
}

/** The device's own voice reads a sentence built from the numbers on the card (no server text). */
function speakOnDevice(key, sentence) {
  return new Promise((resolve, reject) => {
    const code = SPEECH_LANG[lang()] || "en-IN";
    const voice = browserVoiceFor(code);
    if (!window.speechSynthesis || !sentence || (!voice && lang() !== "en")) { reject(new Error(t("speak.failed"))); return; }
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = code;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => { if (playing && playing.key === key) { playing = null; emit(); } resolve("played"); };
    u.onerror = () => { if (playing && playing.key === key) { playing = null; emit(); } reject(new Error(t("speak.failed"))); };
    playing = { key, utter: u };
    emit();
    speechSynthesis.speak(u);
  });
}

/**
 * Keys the server builds a sentence for (src/agent/speak.js). For these the server's own voice is
 * the only voice: a failure is shown on the button, never replaced by the device's.
 */
const SERVER_KEY = /^(?:(?:now|customers|khata)|(?:rule|memory|approval|order|need|invoice|item|owed):[A-Za-z0-9_]{1,64})$/;
export const isServerKey = (key) => SERVER_KEY.test(String(key));

/**
 * The read-aloud button in the top-right corner of every card, sheet and header (48 px circle,
 * speaker icon; states idle, loading, playing = stop, error with one line under it). The server
 * reads its own sentence for `key`; only a card the server has no sentence for passes
 * `sentence()`, built from what the card shows, for the device voice.
 */
export function readButton(key, sentence = null, { size = "sm" } = {}) {
  const label = t("speak.label");
  const note = h("span", { class: "speak-note", role: "status", "aria-live": "polite" });
  const face = h("span", { class: "speak-face", "aria-hidden": "true" }, ic("speaker", 22));
  const btn = h("button", { class: `speak speak-${size}`, type: "button", "aria-label": label, dataset: { tip: label, state: "idle" } }, face);
  const wrap = h("span", { class: "speak-wrap" }, btn, note);
  let busy = false;
  // The face follows the state: speaker (idle, error), spinner (loading), stop (playing).
  const paint = () => {
    const st8 = btn.dataset.state;
    face.replaceChildren(st8 === "loading" ? h("span", { class: "spinner" }) : ic(st8 === "playing" ? "stop" : "speaker", st8 === "playing" ? 18 : 22));
  };
  const sync = (pk) => {
    if (!wrap.isConnected && wrap.__seen) { watchers.delete(sync); return; }
    if (wrap.isConnected) wrap.__seen = true;
    const on = pk === key;
    if (!busy && btn.dataset.state !== "error") btn.dataset.state = on ? "playing" : "idle";
    else if (on) btn.dataset.state = "playing";
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? t("speak.stop") : label);
    paint();
  };
  watchers.add(sync);
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (playing && playing.key === key) { stopAll(); return; }
    if (busy) return;
    stopAll();
    busy = true;
    note.textContent = "";
    btn.dataset.state = "loading";
    paint();
    try {
      playing = { key };
      const how = await speak(key);
      if (how === "spoken") note.textContent = st("sv.speakOn");
      playing = null;
      busy = false;
      btn.dataset.state = "idle";
    } catch (err) {
      if ((err && err.code === "LIMIT") || isServerKey(key) || !sentence) {
        busy = false; playing = null;
        btn.dataset.state = "error";
        note.textContent = (err && err.message) || t("speak.failed");
      } else {
        try {
          busy = false;
          await speakOnDevice(key, typeof sentence === "function" ? sentence() : sentence);
          btn.dataset.state = "idle";
        } catch (err2) {
          playing = null;
          btn.dataset.state = "error";
          note.textContent = err2.message || t("speak.failed");
        }
      }
    }
    sync(playing && playing.key);
  });
  return wrap;
}

/* ------------------------------------------------------- receipt notches -- */

// A slip's punch notches sit at --notch-y; put them on the line of its perforation, whatever
// height the content above it has (names wrap, scripts differ). Re-measured on resize.
const notchObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
  for (const e of entries) placeNotch(e.target);
}) : null;

function placeNotch(slip) {
  const line = slip.querySelector(":scope > .perforation");
  if (!line || !slip.isConnected) return;
  const y = line.offsetTop + line.offsetHeight / 2;
  if (y > 0) slip.style.setProperty("--notch-y", `${Math.round(y)}px`);
}

/** Align the notches of every slip under `root` (call after rendering). */
export function alignNotches(root) {
  requestAnimationFrame(() => {
    for (const p of root.querySelectorAll(".paper")) {
      placeNotch(p);
      if (notchObserver && !p.__notchWatched) { p.__notchWatched = true; notchObserver.observe(p); }
    }
  });
}

/* ---------------------------------------------------------------- marks -- */

// Bill status -> the shared stamp class (components-v3.css `.stamp-*`) and its icon.
const STAMP = {
  draft: { cls: "draft", icon: "doc" },
  pending: { cls: "waiting", icon: "bell" },
  issued: { cls: "issued", icon: "clock" },
  part_paid: { cls: "part", icon: "clock" },
  paid: { cls: "paid", icon: "checkCircle" },
  cancelled: { cls: "cancelled", icon: "ban" },
};

/** The rubber status stamp of a bill: icon + word (colour never alone); tilted on a receipt. */
export function stamp(status, { big = false } = {}) {
  const key = status in STAMP ? status : "draft";
  const s = STAMP[key];
  return h("span", { class: `stamp stamp-${s.cls} sv-stamp${big ? " sv-stamp-big" : ""}`, dataset: { status: key } },
    ic(s.icon, big ? 22 : 18), h("span", { text: st(`sell.status.${key}`) }));
}

/** A static marker, icon + word (components-v3.css `.pill`). */
export const tag = (word, icn, tone) => h("span", { class: `pill${tone ? ` pill-${tone}` : ""}` }, ic(icn, 16), h("span", { text: word }));
/** "simulated vendor", wherever a simulated counterpart is named. */
export const simTag = () => tag(t("simulated"), "robot", "sim");
/** "test mode", on every pay link (Razorpay test mode only). */
export const testTag = () => tag(st("sv.testMode"), "shield", "test");

/** A card head: title on the left, the read-aloud button in its fixed top-right slot. */
export function cardHead(title, speakBtn, { level = "h3", id, lead = null } = {}) {
  return h("header", { class: "card-head" },
    lead,
    typeof title === "string" ? h(level, { class: "card-title", id, text: title }) : title,
    speakBtn ? h("span", { class: "card-speak" }, speakBtn) : null);
}

/* ------------------------------------------------------- screen states -- */

/** A skeleton in the shape of the screen that is opening (shared .skel classes). */
export function skeleton(which) {
  const line = (w) => h("span", { class: "skel skel-line", style: `--w:${w}` });
  const block = (cls = "") => h("span", { class: `skel skel-block${cls ? ` ${cls}` : ""}` });
  const circle = () => h("span", { class: "skel skel-circle" });
  if (which === "money") {
    return h("div", { class: "sv-skel sv-skel-money", "aria-hidden": "true" },
      h("div", { class: "sv-skel-pair" },
        h("div", { class: "skel-card" }, line("40%"), block("sv-skel-num")),
        h("div", { class: "skel-card" }, line("40%"), block("sv-skel-num"))),
      ...[0, 1, 2].map(() => h("div", { class: "skel-card sv-skel-row" }, circle(),
        h("div", { class: "sv-skel-lines" }, line("55%"), line("30%"), block("sv-skel-meter")))));
  }
  if (which === "stock") {
    return h("div", { class: "sv-skel sv-skel-grid", "aria-hidden": "true" },
      ...[0, 1, 2, 3].map(() => h("div", { class: "skel-card" }, block("sv-skel-jar"), line("60%"), line("35%"))));
  }
  return h("div", { class: "sv-skel sv-skel-grid", "aria-hidden": "true" },
    ...[0, 1, 2].map(() => h("div", { class: "skel-card sv-skel-slip" }, line("45%"), line("70%"), line("30%"), block("sv-skel-num"))));
}

/**
 * A designed screen state: { kind: "loading" | "empty" | "error" | "missing", icon, title, text,
 * action: { label, icon, run }, shape } (loading draws a skeleton in the screen's shape). Built on
 * the shared `.state` look with this screen's own skeleton.
 */
export function screenState({ kind, icon: icn, title, text, action, shape = "sell", compact = false }) {
  if (kind === "loading") {
    return h("div", { class: "state state-loading sv-state", role: "status", "aria-busy": "true" },
      h("p", { class: "sv-loadline" }, h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: title || st("sv.loadingWord") })),
      skeleton(shape));
  }
  return h("div", { class: `state state-${kind} sv-state${compact ? " state-compact" : ""}`, role: kind === "error" ? "alert" : undefined },
    h("span", { class: "state-mark", "aria-hidden": "true" }, ic(icn || (kind === "error" ? "alert" : kind === "missing" ? "info" : "spark"), 32)),
    title ? h("p", { class: "state-title", text: title }) : null,
    text ? h("p", { class: "state-text", text }) : null,
    action ? h("button", { class: `keycap ${kind === "empty" ? "keycap-primary" : "keycap-secondary"} keycap-md`, type: "button", on: { click: action.run } },
      ic(action.icon || (kind === "empty" ? "mic" : "refresh"), 24), h("span", { text: action.label })) : null);
}

/**
 * The state view for a part of the store: loading (skeleton), missing (the route is not on this
 * server yet) or error (the server's say + Retry). Null when the data is ready.
 */
export function partState(part, { which, reload }) {
  if (part.status === "ready") return null;
  if (part.status === "idle" || part.status === "loading") return screenState({ kind: "loading", title: st(`sbx.loading.${which}`), shape: which });
  if (part.status === "missing") {
    return screenState({ kind: "missing", title: st("sbx.missing.title"), text: st(`sbx.missing.${which}`), action: { label: t("retry"), icon: "refresh", run: reload } });
  }
  const err = part.error;
  const text = (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load");
  return screenState({ kind: "error", title: st("sbx.err.loadTitle"), text, action: { label: t("retry"), icon: "refresh", run: reload } });
}

/* --------------------------------------------------------------- headers -- */

/** The "speak" chip of a screen header (D11): starts the call in place with the screen's hint. */
export function agentAction({ word, hint, prompt }) {
  const label = st("sv.speakLong");
  return h("button", { class: "chip chip-talk", type: "button", "aria-label": word ? `${word}: ${label}` : label, on: { click: () => ask({ hint, prompt }) } },
    ic("mic", 22), h("span", { text: word || st("sv.speak") }));
}

/** A screen header (shared `.screen-head`): title, then speaker, talk chip and up to two actions. */
export function screenHead({ id, title, speakBtn = null, actions = [] }) {
  return h("header", { class: "screen-head sv-head" },
    h("h1", { class: "screen-title", id, text: title }),
    h("div", { class: "screen-head-tools" }, speakBtn, ...actions.filter(Boolean)));
}

/** A section heading (shared `.section-title`): icon + one or two words, with an optional count. */
export function sectionHead(id, icn, word, n, tone) {
  return h("h2", { class: `section-title sv-sec${tone ? ` sv-sec-${tone}` : ""}`, id },
    h("span", { class: "sv-sec-ico", "aria-hidden": "true" }, ic(icn, 20)),
    h("span", { text: word }),
    n !== undefined && n !== null ? h("span", { class: "fold-count", text: String(n) }) : null);
}

/**
 * A collapsible block (shared `details.fold`): never hides data, shows its count while closed.
 * `open` decides the first state; the owner's own choice is kept by the caller.
 */
export function fold({ id, icon: icn, word, n, open = false, body, cls = "", onToggle }) {
  const d = h("details", { class: `fold sv-fold${cls ? ` ${cls}` : ""}`, open: open ? true : undefined },
    h("summary", { class: "fold-head", id },
      h("span", { class: "sv-sec-ico", "aria-hidden": "true" }, ic(icn, 20)),
      h("span", { class: "fold-word", text: word }),
      n !== undefined && n !== null ? h("span", { class: "fold-count", text: String(n) }) : null),
    h("div", { class: "fold-body" }, body));
  if (onToggle) d.addEventListener("toggle", () => onToggle(d.open));
  return d;
}

/** Errors from a button: a missing route reads as "not switched on yet". */
export function buttonError(err, fallbackKey = "sbx.err.save") {
  if (!err) return st(fallbackKey);
  if (err.status === 404 && /route|HTTP 404/i.test(err.message || "")) return st("sbx.err.notReady");
  if (err.status === 409) return st("sbx.err.gone");
  if (err.status === 0) return t("err.network");
  if (err.status === 429) return t("err.limit");
  return err.say || err.message || st(fallbackKey);
}

/** A one-line result under a control: ok (check), error (alert, role alert), busy (spinner). */
export function resultLine(kind, text) {
  if (!text) return null;
  return h("p", { class: `${kind === "error" ? "error-line" : "note-line"} sv-line sv-line-${kind}`, role: kind === "error" ? "alert" : "status" },
    kind === "busy" ? h("span", { class: "spinner", "aria-hidden": "true" }) : ic(kind === "ok" ? "checkCircle" : "alert", 20),
    h("span", { text }));
}

/** A link that looks like a keycap (opens outside the app); null when the URL is not safe. */
export function linkKey({ href, icon: icn, word, label, tone = "secondary", size = "md", cls = "" }) {
  const url = safeUrl(href);
  if (!url) return null;
  return h("a", { class: `keycap keycap-${tone} keycap-${size}${cls ? ` ${cls}` : ""}`, href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": label || undefined },
    ic(icn, 22), h("span", { text: word }));
}

/**
 * A sheet with a footer that stays at the bottom (the primary action in thumb reach). Works on
 * the shared openSheet (W1: { footer, onClose } and setFooter / close); on a sheet without a
 * footer slot the footer is appended under the body. Returns { setBody, setFooter, close, isOpen }.
 */
export function panel({ title, body, footer = null, opener = null, onClose }) {
  const list = (b) => (Array.isArray(b) ? b : [b]);
  let foot = footer;
  const api = openSheet({ title, body: list(body), footer: foot || undefined, opener, onClose });
  const hasFooter = typeof api.setFooter === "function";
  let current = list(body);
  if (!hasFooter && foot) api.setBody([...current, h("div", { class: "sv-foot" }, foot)]);
  return {
    setBody(b) { current = list(b); api.setBody(hasFooter || !foot ? current : [...current, h("div", { class: "sv-foot" }, foot)]); },
    setFooter(f) { foot = f; if (hasFooter) api.setFooter(f); else api.setBody(foot ? [...current, h("div", { class: "sv-foot" }, foot)] : current); },
    close() { if (typeof api.close === "function") api.close(); else closeSheet(); },
    isOpen: () => (typeof api.isOpen === "function" ? api.isOpen() : false),
  };
}

export { talkAction };
