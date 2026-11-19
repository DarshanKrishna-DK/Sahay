// Small shared pieces for the Sell, Stock and Money screens: the stylesheet, the read-aloud
// button these cards use, quantity / money words, item names in the owner's script, the
// "ask Sahay" path with a prompt, and the per-screen load / missing / error views.

import { h, icon, amount, rupees, toDate, num } from "./dom.js";
import { t, lang, unitWord } from "./i18n.js";
import { speak, stopSpeaking } from "./speak.js";
import { stateView, loadingView, talkAction } from "./empty.js";
import { askSahay } from "./ui.js";
import { inCall, sendText } from "./call.js";
import { scriptOf } from "../voice.js";
import { st } from "./sell-i18n.js";

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
  return n === 0 ? st("sbx.today") : st("sbx.daysAgo", { n });
}

/** Text that carries its script's lang attribute (Noto faces for Devanagari / Kannada). */
export function scriptedText(tag, text, props = {}) {
  const sc = scriptOf(text || "");
  return h(tag, { ...props, lang: sc === "hi" || sc === "kn" ? sc : props.lang, text: text || "" });
}

/* ------------------------------------------------------------- ask Sahay -- */

/**
 * Ask the agent: on a live call the prompt is sent as typed words (a request, never a yes); with
 * no call, Talk opens and starts listening, with the hint under the orb.
 */
export function ask({ prompt, hint }) {
  if (inCall() && prompt) {
    location.hash = "#/talk";
    sendText(prompt);
    return;
  }
  askSahay(hint || null);
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
 * The round read-aloud button on every card (speaker icon, tooltip + aria-label). The server reads
 * its own sentence for `key` (Murf, or the live call). Only a card the server has no sentence for
 * passes `sentence()`, built from what the card shows, for the device voice.
 */
export function readButton(key, sentence = null, { size = "sm" } = {}) {
  const label = t("speak.label");
  const note = h("span", { class: "speak-note", role: "status", "aria-live": "polite" });
  const btn = h("button", { class: `speak speak-${size}`, type: "button", "aria-label": label, dataset: { tip: label, state: "idle" } },
    icon("speaker", size === "sm" ? 20 : 26));
  const wrap = h("span", { class: "speak-wrap" }, btn, note);
  let busy = false;
  const sync = (pk) => {
    if (!wrap.isConnected && wrap.__seen) { watchers.delete(sync); return; }
    if (wrap.isConnected) wrap.__seen = true;
    const on = pk === key;
    if (!busy && btn.dataset.state !== "error") btn.dataset.state = on ? "playing" : "idle";
    else if (on) btn.dataset.state = "playing";
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? t("speak.stop") : label);
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
    try {
      playing = { key };
      const how = await speak(key);
      if (how === "spoken") note.textContent = t("speak.onCall");
      // Server audio is played and stopped by speak.js; this button only shows its own speech.
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

/* ------------------------------------------------------- paper notches -- */

// A paper's punch notches sit at --notch-y; put them on the line of its perforation, whatever
// height the content above it has (names wrap, scripts differ). Re-measured on resize.
const notchObserver = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
  for (const e of entries) placeNotch(e.target);
}) : null;

function placeNotch(paperEl) {
  const perf = paperEl.querySelector(":scope > .perforation");
  if (!perf || !paperEl.isConnected) return;
  const y = perf.offsetTop + perf.offsetHeight / 2;
  if (y > 0) paperEl.style.setProperty("--notch-y", `${Math.round(y)}px`);
}

/** Align the notches of every .paper under `root` (call after rendering). */
export function alignNotches(root) {
  requestAnimationFrame(() => {
    for (const p of root.querySelectorAll(".paper")) {
      placeNotch(p);
      if (notchObserver && !p.__notchWatched) { p.__notchWatched = true; notchObserver.observe(p); }
    }
  });
}

/* ------------------------------------------------------- screen states -- */

/**
 * The state view for a part of the store: loading, missing (the route is not on this server yet)
 * or error, each designed and each with one action. Null when the data is ready.
 */
export function partState(part, { which, reload }) {
  if (part.status === "ready") return null;
  if (part.status === "idle" || part.status === "loading") return loadingView(st(`sbx.loading.${which}`));
  if (part.status === "missing") {
    return stateView({ kind: "empty", icon: "info", title: st("sbx.missing.title"), text: st(`sbx.missing.${which}`), action: { label: t("retry"), icon: "refresh", run: reload } });
  }
  const err = part.error;
  const text = (err && (err.say || (err.status === 0 ? t("err.network") : null))) || st("sbx.err.load");
  return stateView({ kind: "error", title: st("sbx.err.loadTitle"), text, action: { label: t("retry"), icon: "refresh", run: reload } });
}

/** The one big agent action at the top of each screen (icon + a short verb phrase). */
export function agentAction({ word, hint, prompt }) {
  return h("button", { class: "sb-ask keycap keycap-marigold keycap-lg", type: "button", on: { click: () => ask({ hint, prompt }) } },
    h("span", { class: "sb-ask-orb", "aria-hidden": "true" }, icon("mic", 26)),
    h("span", { text: word }));
}

/** A section heading: icon + one or two words, with an optional count. */
export function sectionHead(id, ic, word, n, tone) {
  return h("h2", { class: `sb-head${tone ? ` sb-head-${tone}` : ""}`, id },
    h("span", { class: "sb-head-ico", "aria-hidden": "true" }, icon(ic, 22)),
    h("span", { text: word }),
    n !== undefined && n !== null ? h("span", { class: "sb-count", text: String(n) }) : null);
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

export { talkAction };
