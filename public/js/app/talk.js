// Sahay home (#/sahay; #/talk and the empty route are aliases), UI v4 (Stitch 03-home-laptop).
// Laptop: a hero row with the greeting ("Namaste, <shop>", shop name in lime), one status sentence,
// the trackers and the call controls (Talk to Sahay / Type request; Mute / End / Type during a
// call) on the left, and the lime thinking orb with its state pill on the right. Below, full width:
// the conversation card (live dot, title, call timer; turns as rows with a YOU / AI chip, a language
// and time line, and the bubble; the composer at its foot), then "Today" with four stat cards of
// real numbers. Phone: greeting, status, orb, controls, conversation, Today 2x2.
// End is its own red control and the orb never ends a call (D12); typing never mutes (D16); the
// recovery states of F8 sit under the controls. Logic is in home-model.js (tested without a DOM).

import { h, icon, fill, patch, scripted } from "./dom.js";
import { t, lang, when } from "./i18n.js";
import "./home-strings.js";
import { state, pendingApprovals } from "./store.js";
import { sell, stock, pendingInvoices, loadSell, loadStock } from "./store-sell.js";
import { call, inCall, startCall, endCall, setMuted, textSupported, resumeAudio, endServerCall } from "./call.js";
import { createOrb } from "./orb.js";
import { runningJobs, agentState, nowLine } from "./activity.js";
import { createTrackers, setWaitingCount } from "./hud.js";
import { createComposer } from "./composer.js";
import { mountCallDock, onHome } from "./call-dock.js";
import { speakButton } from "./speak.js";
import {
  orbView, callStrip, recoveryNotes, conversationView, isFirstVisit, pillKey, statusLine,
  todayStats, turnLang, parseTime, clock, inr, grouped,
} from "./home-model.js";

// The stylesheet for this screen (until the shell links it from app.html).
if (!document.querySelector('link[href="/css/app-agent.css"]')) {
  document.head.append(h("link", { rel: "stylesheet", href: "/css/app-agent.css" }));
}

/* ------------------------------------------------- waiting tray (W3) -- */
let waitingMod = null;
let waitingCount = null;
const waitingListeners = new Set();
import("./waiting.js").then((m) => {
  waitingMod = m;
  if (m && typeof m.onCount === "function") m.onCount((n) => { waitingCount = n; setWaitingCount(n); for (const fn of waitingListeners) fn(); });
}).catch(() => { /* no tray module on this build: approvals + bills count instead */ });
const countWaiting = () => waitingCount ?? (pendingApprovals().length + pendingInvoices().length);
function openTray() {
  if (waitingMod && typeof waitingMod.openTray === "function") waitingMod.openTray();
  else location.hash = "#/waiting";
}

const online = () => navigator.onLine !== false;

/* ------------------------------------------------------- try chips -- */
const TRY = ["home.try1", "home.try2", "home.try3"];
const VOICE_LANG = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
function sayOnDevice(text, done) {
  const synth = window.speechSynthesis;
  if (!synth || typeof window.SpeechSynthesisUtterance !== "function") { done(); return false; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[lang()] || "en-IN";
  u.onend = done; u.onerror = done;
  synth.speak(u);
  return true;
}

/** The words of a now-line that carry its colour: its own key word (home.key.*), else its values. */
const KEY_WORD = { "now.waitingYes": "home.key.yes", "now.ordered": "home.key.order", "now.failed": "home.key.stopped" };
function keyWords(key, vars) {
  if (KEY_WORD[key]) return [t(KEY_WORD[key])];
  return Object.values(vars || {}).filter((v) => v !== null && v !== undefined && String(v).trim()).map(String);
}
/** The sentence with the first match of each key word wrapped in a toned <strong>. */
function marked(sentence, words) {
  const hits = words.map((w) => ({ w, i: sentence.indexOf(w) })).filter((x) => x.w && x.i >= 0).sort((a, b) => a.i - b.i);
  const out = [];
  let at = 0;
  for (const { w, i } of hits) {
    if (i < at) continue;
    if (i > at) out.push(scripted("span", sentence.slice(at, i)));
    out.push(scripted("strong", w, { class: "sh-key" }));
    at = i + w.length;
  }
  if (at < sentence.length) out.push(scripted("span", sentence.slice(at)));
  return out;
}

/** "Sahay is ready. Tap {talk} and say what you need." with the word Talk drawn in lime. */
function withTalkWord(sentence) {
  const parts = sentence.split("{talk}");
  if (parts.length < 2) return [scripted("span", sentence)];
  return [scripted("span", parts[0]), scripted("strong", t("home.talkWord"), { class: "sh-lime" }), scripted("span", parts.slice(1).join(""))];
}

export function createSahayHome() {
  mountCallDock();
  const phoneQuery = matchMedia("(max-width: 599px)");
  const el = h("section", { class: "sh-home", dataset: { visual: "idle" } });

  /* ---- hero ---- */
  const greet = h("h1", { class: "sh-greet", id: "sh-title" });
  const status = h("div", { class: "sh-status" });
  const trackers = createTrackers();
  const orb = createOrb({ onPress: orbPress });
  const pill = h("p", { class: "sh-pill", "aria-live": "polite" });
  const figure = h("div", { class: "sh-figure" }, h("div", { class: "sh-orb-wrap" }, orb.el), pill);
  const actions = h("div", { class: "sh-actions", role: "group" });
  const notes = h("div", { class: "sh-notes", hidden: true });
  const hint = h("p", { class: "sh-hint", hidden: true });
  const hero = h("section", { class: "sh-hero", "aria-labelledby": "sh-title" }, greet, status, figure, actions, hint, notes);

  /* ---- conversation card ---- */
  const convoTitle = h("h2", { class: "sh-card-title", id: "sh-convo-title" });
  const liveDot = h("span", { class: "sh-live-dot", "aria-hidden": "true" });
  const timer = h("span", { class: "sh-timer", hidden: true });
  const convo = h("ol", { class: "sh-convo" });
  const tryRow = h("div", { class: "sh-try-row", hidden: true });
  let keyboardBtn = null;
  const composer = createComposer({
    openTray,
    waitingCount: countWaiting,
    onOpenChange: (open, restore) => {
      el.dataset.composer = open ? "open" : "closed";
      renderActions();
      if (!open && restore && keyboardBtn) keyboardBtn.focus({ preventScroll: true });
    },
  });
  const convoCard = h("article", { class: "card sh-convo-card", "aria-labelledby": "sh-convo-title" },
    h("header", { class: "sh-card-head" }, liveDot, convoTitle, trackers.el, timer), convo, tryRow, composer.el);

  /* ---- today ---- */
  const todayLabel = h("h2", { class: "sh-today-label", id: "sh-today-title" });
  const todayDate = h("span", { class: "sh-today-date" });
  const stats = h("ul", { class: "sh-stats", role: "list" });
  const statsNote = h("div", { class: "sh-stats-note" });
  const today = h("section", { class: "sh-today", "aria-labelledby": "sh-today-title" },
    h("header", { class: "sh-today-head" }, todayLabel, todayDate), stats, statsNote);

  el.append(hero, convoCard, today);
  el.dataset.composer = "closed";

  let hintKey = null;
  let showEarlier = false;
  let stick = true; // keep the newest turn in view unless the owner scrolled up to read
  let liveSince = null;
  let tick = 0;
  convo.addEventListener("scroll", () => { stick = convo.scrollHeight - convo.scrollTop - convo.clientHeight < 40; }, { passive: true });
  phoneQuery.addEventListener("change", () => { convo.__key = null; renderConvo(); });

  for (const ev of ["online", "offline"]) window.addEventListener(ev, () => render(new Set(["call"])));
  // The shell's "type" entry points (sahay:compose; sahay:focus-type from older callers) open the composer.
  for (const ev of ["sahay:compose", "sahay:focus-type"]) {
    document.addEventListener(ev, () => {
      if (!onHome()) location.hash = "#/sahay";
      requestAnimationFrame(() => composer.open());
    });
  }
  document.addEventListener("sahay:hint", (e) => { hintKey = e.detail && e.detail.key; render(new Set(["call"])); });
  waitingListeners.add(() => render(new Set(["approvals"])));

  const first = () => isFirstVisit({ turns: call.transcript.length, requirements: state.requirements.length, orders: state.orders.size, hasRequirement: Boolean(state.requirement) });

  function view() {
    return orbView({
      status: call.status, agentState: call.agentState, mode: call.mode, route: call.route, error: call.error,
      ended: call.ended, online: online(), working: runningJobs().length > 0, muted: call.muted, first: first(),
    });
  }

  function orbPress() {
    const s = call.status;
    if (s === "idle" || s === "error") { startCall("voice"); return; }
    // Live: the orb opens or unmutes the mic, never ends the call (D12).
    if (inCall() && (call.micless || call.muted)) setMuted(false);
  }

  /* ---------------------------------------------------------- hero -- */

  function renderGreeting() {
    const shop = (state.business && state.business.name) || "";
    patch(greet, `${document.documentElement.lang}|${shop}`, () => [
      scripted("span", t("home.hello"), { class: "sh-greet-word" }), " ",
      shop ? scripted("span", shop, { class: "sh-greet-name" }) : null,
    ]);
  }

  function renderStatus(v) {
    const n = nowLine();
    const s = statusLine({ orbState: v.state, nowKey: n.key, live: inCall() });
    const sentence = s.now ? t(n.key, n.vars) : t(s.key);
    // Normal text colour; only the key words (the item, the seller, the count, or the key's own
    // word such as "yes") carry the tone colour.
    const keys = s.now ? keyWords(n.key, n.vars) : [];
    patch(status, `${document.documentElement.lang}|${sentence}|${s.talk}|${n.tone}`, () => [
      h("p", { class: "sh-status-line", dataset: { tone: s.now ? n.tone : "calm" } }, ...(s.talk ? withTalkWord(sentence) : marked(sentence, keys))),
      speakButton("now", { size: "sm" }),
    ]);
  }

  function renderOrb(v) {
    const pressable = call.status === "idle" || call.status === "error" || (inCall() && (call.micless || call.muted));
    const words = t(v.key);
    orb.set({ visual: v.visual, state: v.state, label: pressable || !inCall() ? words : `${words}. ${t("home.orb.pressLive")}`, agent: agentState(), badge: v.visual === "error" || v.tone === "warn" ? v.icon : null, pressable });
    el.dataset.visual = v.visual;
    el.dataset.state = v.state;
    el.dataset.tone = v.tone;
    const word = t(pillKey(v.state));
    patch(pill, `${word}|${v.tone}|${words}`, () => [h("span", { class: "sh-pill-dot", "aria-hidden": "true" }), scripted("span", word, { class: "sh-pill-word" }), h("span", { class: "sr-only", text: `. ${words}` })]);
    pill.dataset.tone = v.tone;
    pill.dataset.state = v.state;
  }

  function act(action) {
    if (action === "start") startCall("voice");
    else if (action === "retry") startCall(call.mode === "text" ? "text" : "voice");
    else if (action === "hear") resumeAudio();
    else if (action === "mute") setMuted(true);
    else if (action === "unmute" || action === "openMic") setMuted(false);
    else if (action === "tray") openTray();
    else if (action === "type") composer.open();
    else if (action === "endOther") endServerCall();
  }

  function renderActions() {
    const s = callStrip({ status: call.status, mode: call.mode, muted: call.muted, micless: call.micless, autoplay: call.autoplay, error: call.error, ended: call.ended, textSupported: textSupported() });
    actions.setAttribute("aria-label", t("home.controls"));
    const parts = [];
    if (s.primary) {
      const key = s.primary.action === "start" ? "home.talkToSahay" : s.primary.key;
      parts.push(h("button", { class: `keycap keycap-lg keycap-primary sh-act sh-act-primary is-${s.primary.action}`, type: "button", on: { click: () => act(s.primary.action) } },
        icon(s.primary.icon, 24), h("span", { text: t(key) })));
    }
    if (s.mute) {
      parts.push(h("button", {
        class: `keycap keycap-lg keycap-secondary sh-act sh-act-mute${s.mute.on ? "" : " is-off"}`, type: "button",
        "aria-pressed": s.mute.action === "openMic" ? undefined : String(call.muted),
        "aria-label": s.mute.action === "mute" ? t("home.muteLong") : s.mute.action === "unmute" ? t("home.unmuteLong") : t(s.mute.key),
        on: { click: () => act(s.mute.action) },
      }, icon(s.mute.icon, 24), h("span", { text: t(s.mute.key) })));
    }
    if (s.end) {
      parts.push(h("button", { class: "keycap keycap-lg keycap-danger sh-act sh-act-end", type: "button", "aria-label": inCall() ? t("home.endLong") : t(s.end.key), on: { click: () => endCall() } },
        icon("phoneOff", 24), h("span", { text: t(s.end.key) })));
    }
    keyboardBtn = null;
    if (s.keyboard) {
      const open = composer.isOpen();
      keyboardBtn = h("button", {
        class: "keycap keycap-lg keycap-ghost sh-act sh-act-type", type: "button", "aria-expanded": String(open), "aria-controls": "sh-composer-input",
        on: { click: () => (open ? composer.close(true) : composer.open()) },
      }, icon(open ? "x" : "keyboard", 24), h("span", { text: open ? t("home.typeClose") : t("home.typeRequest") }));
      parts.push(keyboardBtn);
    }
    fill(actions, ...parts);
    actions.dataset.count = String(parts.length);
  }

  function renderNotes() {
    const list = recoveryNotes({
      status: call.status, error: call.error, ended: call.ended, online: online(), jobsRunning: runningJobs().length,
      voiceServerActive: Boolean(state.voiceServer && state.voiceServer.active), issues: call.issues, autoplay: call.autoplay,
    });
    const key = JSON.stringify([document.documentElement.lang, list.map((n) => [n.kind, n.key, n.sub, n.actions]), call.endingOther]);
    patch(notes, key, () => list.map((n) => h("div", { class: "sh-note", dataset: { tone: n.tone, kind: n.kind }, role: n.tone === "bad" ? "alert" : "status" },
      h("span", { class: "sh-note-icon", "aria-hidden": "true" }, icon(n.icon, 20)),
      h("div", { class: "sh-note-body" },
        h("p", { class: "sh-note-title", text: t(n.key) }),
        n.sub ? h("p", { class: "sh-note-text", text: t(n.sub) }) : null),
      noteActions(n))));
    notes.hidden = list.length === 0;
    hint.hidden = !hintKey || call.transcript.length > 0;
    hint.textContent = hintKey ? t(hintKey) : "";
  }

  function noteActions(n) {
    const btns = n.actions.map(noteAction).filter(Boolean);
    return btns.length ? h("div", { class: "sh-note-actions" }, ...btns) : null;
  }

  function noteAction(a) {
    // Retry is the hero's primary button already; a note never repeats it.
    if (a === "tray") return h("button", { class: "chip", type: "button", on: { click: () => act("tray") } }, icon("check", 20), h("span", { text: t("home.useButtons") }));
    if (a === "type") return h("button", { class: "chip", type: "button", on: { click: () => act("type") } }, icon("keyboard", 20), h("span", { text: t("home.typeInstead") }));
    if (a === "endOther") {
      return h("button", { class: "chip", type: "button", "aria-busy": call.endingOther ? "true" : undefined, disabled: call.endingOther ? true : undefined, on: { click: () => act("endOther") } },
        call.endingOther ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("phoneOff", 20), h("span", { text: t("talk.endThat") }));
    }
    return null;
  }

  /* -------------------------------------------------- conversation -- */

  function timeWord(ts) {
    const d = parseTime(ts);
    return d ? when(d, { hour: "numeric", minute: "2-digit" }) : "";
  }

  function row(role, turn, extra = {}) {
    const meta = [];
    if (extra.pinned) meta.push(h("span", { class: "sh-row-notice" }, icon("shield", 16), h("span", { text: t("notice.short") })));
    else {
      meta.push(h("span", { text: t(`home.lang.${turnLang(turn)}`) }));
      const tw = timeWord(turn.time);
      if (tw) meta.push(h("span", { text: tw }));
      if (turn.via === "text") meta.push(h("span", { class: "sh-row-flag" }, icon("keyboard", 14), h("span", { text: t("home.typed") })));
      if (turn.live && role === "owner") meta.push(h("span", { class: "sh-row-flag is-hearing", text: t("home.hearing") }));
      if (turn.interrupted) meta.push(h("span", { class: "sh-row-flag is-cut", text: t("home.cut") }));
    }
    return h("li", { class: `sh-row is-${role}${turn.live ? " is-live" : ""}${extra.pinned ? " is-pinned" : ""}` },
      h("span", { class: "sh-chip-who", "aria-hidden": "true", text: role === "agent" ? t("home.chip.ai") : t("home.chip.you") }),
      h("div", { class: "sh-bubble" },
        h("p", { class: "sh-row-meta" }, h("span", { class: "sr-only", text: `${role === "agent" ? t("home.sahay") : t("home.you")}: ` }), ...meta),
        scripted("p", turn.text, { class: "sh-row-text" })));
  }

  function renderConvo() {
    const biz = (state.business && state.business.name) || "";
    const v = conversationView(call.transcript, { disclosure: t("talk.disclosure", { biz }), showEarlier, keep: phoneQuery.matches ? 4 : 8 });
    if (!v.older) showEarlier = false;
    convoTitle.textContent = t("home.convo");
    convo.setAttribute("aria-label", t("home.convo"));
    const key = JSON.stringify([document.documentElement.lang, v.pinned.text, showEarlier, v.older, v.shown.map((x) => [x.key, x.text, x.live, x.interrupted, x.via])]);
    const changed = patch(convo, key, () => {
      const items = [row("agent", { text: v.pinned.text }, { pinned: true })];
      if (v.older) {
        items.push(h("li", { class: "sh-earlier" },
          h("button", {
            class: "chip sh-earlier-btn", type: "button", "aria-expanded": String(showEarlier),
            on: { click: () => { showEarlier = !showEarlier; renderConvo(); requestAnimationFrame(() => { const b = convo.querySelector(".sh-earlier-btn"); if (b) b.focus({ preventScroll: true }); }); } },
          }, icon(showEarlier ? "chevronUp" : "history", 20), h("span", { text: showEarlier ? t("home.earlierHide") : t("home.earlier", { n: v.older }) }))));
      }
      for (const x of v.shown) items.push(row(x.role, x));
      if (!v.count) items.push(h("li", { class: "sh-convo-empty" }, h("p", { text: t(first() ? "home.convoFirst" : "home.convoEmpty") })));
      return items;
    });
    if (changed && stick) requestAnimationFrame(() => { convo.scrollTop = convo.scrollHeight; });
    el.dataset.turns = String(v.count);
    renderTry(!v.count && first());
  }

  function renderTry(show) {
    tryRow.hidden = !show;
    if (!show) return;
    patch(tryRow, `try|${document.documentElement.lang}`, () => {
      const chips = TRY.map((k) => {
        const words = t(k);
        const b = h("button", { class: "chip sh-try", type: "button", dataset: { state: "idle" }, "aria-label": `${t("home.tryHear")}: ${words}` },
          icon("speaker", 20), scripted("span", words));
        b.addEventListener("click", () => {
          for (const o of tryRow.querySelectorAll(".sh-try")) o.dataset.state = "idle";
          b.dataset.state = "playing";
          sayOnDevice(words, () => { b.dataset.state = "idle"; });
        });
        return h("li", null, b);
      });
      return [h("p", { class: "sh-try-title", text: t("home.trySaying") }), h("ul", { class: "sh-try-list", role: "list" }, ...chips)];
    });
  }

  function renderTimer() {
    const live = inCall();
    if (live && !liveSince) liveSince = Date.now();
    if (!live && call.status !== "ending") liveSince = null;
    convoCard.dataset.live = String(live);
    timer.hidden = !liveSince;
    if (liveSince) {
      timer.textContent = clock(Date.now() - liveSince);
      timer.setAttribute("aria-label", t("home.callTime", { time: timer.textContent }));
      if (!tick) tick = setInterval(() => { if (!liveSince) { clearInterval(tick); tick = 0; return; } timer.textContent = clock(Date.now() - liveSince); }, 1000);
    } else if (tick) { clearInterval(tick); tick = 0; }
  }

  /* --------------------------------------------------------- today -- */

  function statCard(x) {
    const value = x.value === null ? null : x.kind === "money" ? inr(x.value) : grouped(x.value);
    if (value === null) return h("li", { "aria-hidden": "true" }, h("span", { class: "skel skel-card sh-stat-skel" }));
    return h("li", null, h("a", { class: "card card-interactive sh-stat", href: x.route, dataset: { id: x.id, tone: x.tone } },
      h("span", { class: "sh-stat-word" }, icon(x.icon, 18), h("span", { text: t(x.key) })),
      h("span", { class: "sh-stat-num", text: value })));
  }

  function renderToday() {
    todayLabel.textContent = t("home.today");
    todayDate.textContent = when(new Date(), { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const list = todayStats({
      now: new Date(),
      orders: [...state.orders.values()],
      ordersReady: state.boot === "ready",
      invoices: sell.status === "ready" ? [...sell.invoices.values()] : null,
      receipts: sell.status === "ready" ? sell.receipts : null,
      items: stock.status === "ready" ? [...stock.items.values()] : null,
    });
    // A source that failed or is missing on this server says so instead of a skeleton.
    const gone = (id) => (id === "low" ? ["error", "missing"].includes(stock.status) : (id === "bills" || id === "received") && ["error", "missing"].includes(sell.status));
    const shown = list.filter((x) => !gone(x.id));
    patch(stats, JSON.stringify([document.documentElement.lang, shown.map((x) => [x.id, x.value])]), () => shown.map(statCard));
    stats.dataset.count = String(shown.length);
    const failed = [sell, stock].filter((x) => x.status === "error").length;
    patch(statsNote, `${document.documentElement.lang}|${failed}`, () => failed
      ? h("p", { class: "error-line", role: "alert" }, icon("alert", 20), h("span", { text: t("home.statsFail") }),
        h("button", { class: "chip", type: "button", on: { click: () => { if (sell.status === "error") loadSell(); if (stock.status === "error") loadStock(); } } }, icon("refresh", 20), h("span", { text: t("retry") })))
      : []);
  }

  /* -------------------------------------------------------- render -- */

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    const v = view();
    if (all || parts.has("business")) renderGreeting();
    if (all || parts.has("call") || parts.has("work") || parts.has("approvals") || parts.has("business") || parts.has("agent")) {
      renderOrb(v); renderNotes(); renderActions(); renderTimer(); composer.update();
    }
    if (all || parts.has("call") || parts.has("work") || parts.has("approvals") || parts.has("orders") || parts.has("transcript")) { renderStatus(v); trackers.update(); }
    if (all || parts.has("transcript") || parts.has("call") || parts.has("business") || parts.has("orders")) renderConvo();
    if (all || parts.has("orders") || parts.has("sell") || parts.has("stock") || parts.has("boot")) renderToday();
    el.dataset.live = String(inCall());
    el.dataset.mode = call.mode;
  }

  return {
    el,
    update: (_s, parts) => render(parts),
    enter() {
      // Today reads sell and stock; load them quietly once (a missing route shows its own line).
      if (sell.status === "idle") loadSell({ quiet: true });
      if (stock.status === "idle") loadStock({ quiet: true });
      render(new Set(["all"]));
    },
    leave() { if (composer.isOpen()) composer.close(false); },
  };
}

/** Kept for screens.js until the shell routes #/sahay by its own name. */
export const createTalk = createSahayHome;
