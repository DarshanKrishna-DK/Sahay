// Home (#/home; #/sahay, #/talk and the empty route are aliases). UI v5, screens.md section 4 (01, 02).
// Calm and simple, one column: a time-of-day greeting, the agent figure (voicebox.js) with its state
// word, one big pink "Talk to Sahay" (Mute / End during a call, End red), "Type instead" (a one-line
// input in place), the automated-assistant line; the conversation only during or just after a call
// or after typing; then two cards: "Needs you" (up to 3 rows, "Check" opens the Yes card) and "Today"
// (four tiles with real numbers, each opens its screen). Nothing else.
// Behaviour kept from v3: the call contract (call.js / voice.js), drop and blocked-network recovery,
// typing during a call never mutes the mic (D16), a typed yes never approves, read-aloud of "now".
// Logic is in home-model.js (tested without a DOM).

import { h, icon, fill, patch, scripted, button, card, errorLine, money } from "./ui.js";
import { t } from "./i18n.js";
import "./home-strings.js";
import { state } from "./store.js";
import { sell, stock, loadSell, loadStock } from "./store-sell.js";
// yes.js is imported here directly so Home never depends on boot order (W3 owns the decisions).
import { needsRows, onNeedsRows, openNeeds, onCount, typedYesHint } from "./yes.js";
import { createVoicebox } from "./voicebox.js";
import { call, inCall, busy, startCall, endCall, setMuted, sendText, textSupported, resumeAudio, endServerCall, onLevels } from "./call.js";
import { runningJobs, nowLine } from "./activity.js";
import { speakButton } from "./speak.js";
import {
  orbView, callStrip, recoveryNotes, conversationView, isTypedYes, todayStats, boxState, stateWord,
  greetingKey, showConversation, grouped,
} from "./home-model.js";

// This screen's stylesheet (until the shell links it from app.html).
if (!document.querySelector('link[href="/css/home.css"]')) {
  document.head.append(h("link", { rel: "stylesheet", href: "/css/home.css" }));
}

const online = () => navigator.onLine !== false;
const MAX_TEXT = 500;

/**
 * The agent figure (voicebox.js), the hero of Home: 168px on laptops, 144px on phones, 120px on
 * short phones. If its art cannot load, the box keeps its size (empty) and the console says why.
 */
const FIG_QUERIES = ["(max-width: 767px)", "(max-height: 700px)"];
function figureSize() {
  if (matchMedia("(max-width: 767px)").matches) return matchMedia("(max-height: 700px)").matches ? 120 : 144;
  return 168;
}
function createFigure() {
  const host = h("div", { class: "hm-figure" });
  let box = null;
  let size = 0;
  let current = "idle";
  function mount() {
    const want = figureSize();
    if (want === size && box) return;
    size = want;
    host.style.setProperty("--fig", `${size}px`);
    if (box) { try { box.destroy(); } catch { /* gone */ } box = null; }
    try {
      box = createVoicebox({ size, label: t("home.figure") });
      host.replaceChildren(box.el);
      box.setState(current);
      box.ready.then(() => { host.dataset.load = "ready"; }, (err) => {
        host.dataset.load = "error";
        console.warn("Home: the voice box art did not load", err);
      });
    } catch (err) {
      host.dataset.load = "error";
      host.replaceChildren(h("span", { class: "hm-figure-blank" }));
      console.warn("Home: the voice box could not be made", err);
    }
  }
  for (const q of FIG_QUERIES) matchMedia(q).addEventListener("change", mount);
  mount();
  return {
    el: host,
    set(st) {
      current = st;
      host.dataset.state = st;
      if (box) { try { box.setState(st); } catch (err) { console.warn(err); } }
    },
    level(n) { if (box) box.setLevel(n); },
    relabel() { if (box && box.el) box.el.setAttribute("aria-label", t("home.figure")); },
  };
}

export function createHome() {
  const el = h("div", { class: "screen hm", dataset: { state: "idle" } });

  /* ---- hero ---- */
  const greet = h("h1", { class: "hm-greet", id: "hm-title", tabindex: "-1" });
  const figure = createFigure();
  const word = h("p", { class: "hm-state", role: "status", "aria-live": "polite" });
  const actions = h("div", { class: "hm-actions", role: "group" });
  const typeLink = h("button", { class: "link-btn hm-type", type: "button", "aria-controls": "hm-input" });
  const composer = h("form", { class: "hm-composer", hidden: true, autocomplete: "off" });
  const assistant = h("p", { class: "hm-assistant" });
  const notes = h("div", { class: "hm-notes", hidden: true });
  const hero = h("section", { class: "hm-hero", "aria-labelledby": "hm-title" },
    greet, h("div", { class: "hm-figure-row" }, figure.el, word), h("div", { class: "hm-talk-row" }, actions, typeLink), composer, assistant, notes);

  /* ---- conversation (only during / just after a call, or after typing) ---- */
  const convoList = h("ol", { class: "hm-convo" });
  const convoMore = h("div", { class: "hm-convo-more" });
  const convo = h("div", { class: "hm-convo-wrap", hidden: true });

  /* ---- Needs you + Today ---- */
  const needsBody = h("div", { class: "hm-needs" });
  const todayBody = h("div", { class: "hm-today" });
  const cards = h("div", { class: "hm-cards" });

  el.append(hero, convo, cards);

  let showAll = false;
  let typed = false;
  let endedAt = null;
  let wasLive = false;
  let composerOpen = false;
  let failedText = null;
  let typedYes = false;

  /* ---- typing ---- */
  const input = h("input", { class: "input hm-input", id: "hm-input", type: "text", maxlength: String(MAX_TEXT), enterkeyhint: "send", autocomplete: "off" });
  const inputLabel = h("label", { class: "sr-only", for: "hm-input" });
  const send = h("button", { class: "btn btn-primary hm-send", type: "submit" });
  const composerHint = h("p", { class: "hm-composer-hint" });
  const composerNote = h("div", { class: "hm-composer-note", role: "status", "aria-live": "polite" });
  composer.append(inputLabel, h("div", { class: "hm-composer-row" }, input, send), composerHint, composerNote);
  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || call.sending) return;
    failedText = null;
    typedYes = isTypedYes(text) && needsRows().length > 0 ? text : false;
    const ok = await sendText(text);
    if (ok) { input.value = ""; typed = true; } else { failedText = text; typedYes = false; }
    renderComposer();
    renderConvo();
    input.focus({ preventScroll: true });
  });
  input.addEventListener("input", () => { failedText = null; renderComposer(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); setComposer(false, true); } });
  typeLink.addEventListener("click", () => setComposer(!composerOpen, true));

  function setComposer(open, focus) {
    composerOpen = open;
    composer.hidden = !open;
    if (!open) { typedYes = false; failedText = null; }
    renderComposer();
    if (focus) requestAnimationFrame(() => (open ? input : typeLink).focus({ preventScroll: true }));
  }

  function renderComposer() {
    typeLink.hidden = !textSupported();
    fill(typeLink, icon(composerOpen ? "x" : "keyboard", 20), h("span", { text: composerOpen ? t("home.typeClose") : t("home.typeInstead") }));
    typeLink.setAttribute("aria-expanded", String(composerOpen));
    inputLabel.textContent = t("home.composer");
    const sending = Boolean(call.sending);
    input.disabled = sending;
    send.disabled = sending || !input.value.trim();
    send.setAttribute("aria-busy", sending ? "true" : "false");
    fill(send, sending ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("send", 20), h("span", { text: sending ? t("home.sending") : t("home.send") }));
    composerHint.textContent = inCall() ? (call.mode === "text" && call.micless ? "" : t("home.micStaysOn")) : t("home.typedStarts");
    composerHint.hidden = !composerHint.textContent;
    const parts = [];
    if (failedText !== null) parts.push(errorLine(t("home.sendFail")));
    // A typed yes never counts (rule 3): the Yes card's own note, with the button that opens that card.
    const hint = typedYes ? typedYesHint(typedYes) : null;
    if (hint) parts.push(hint);
    fill(composerNote, ...parts);
    input.setAttribute("aria-invalid", failedText !== null ? "true" : "false");
  }

  /* ---- hero ---- */
  function view() {
    return orbView({
      status: call.status, agentState: call.agentState, mode: call.mode, route: call.route, error: call.error,
      ended: call.ended, online: online(), working: runningJobs().length > 0, muted: call.muted,
    });
  }

  function renderGreeting() {
    const shop = (state.business && state.business.name) || "";
    const g = t(greetingKey());
    greet.textContent = shop ? `${g}, ${shop}` : g;
    assistant.textContent = t("home.assistant");
  }

  function renderState(v) {
    const waiting = needsRows().length; // the same rows the Needs you card lists
    figure.set(boxState(v, waiting));
    const n = nowLine();
    const w = stateWord({ view: v, nowKey: n.key, waitingYes: waiting });
    const text = w.now ? t(n.key, n.vars) : t(w.key);
    patch(word, `${document.documentElement.lang}|${text}|${w.tone}`, () => [
      h("span", { class: "hm-state-dot", "aria-hidden": "true" }),
      scripted("span", text, { class: "hm-state-text" }),
      w.now ? speakButton("now", { size: "sm" }) : null,
    ]);
    word.dataset.tone = w.tone;
    el.dataset.state = v.state;
  }

  function act(a) {
    if (a === "start") startCall("voice");
    else if (a === "retry") startCall(call.mode === "text" ? "text" : "voice");
    else if (a === "hear") resumeAudio();
    else if (a === "mute") setMuted(true);
    else if (a === "unmute" || a === "openMic") setMuted(false);
    else if (a === "tray") openNeeds(null);
    else if (a === "type") setComposer(true, true);
    else if (a === "endOther") endServerCall();
  }

  function renderActions() {
    const s = callStrip({ status: call.status, mode: call.mode, muted: call.muted, micless: call.micless, autoplay: call.autoplay, error: call.error, ended: call.ended, textSupported: textSupported() });
    actions.setAttribute("aria-label", t("home.controls"));
    const parts = [];
    if (s.primary) parts.push(button({ word: t(s.primary.action === "start" ? "home.talkToSahay" : s.primary.key), icon: s.primary.icon, kind: "primary", size: "hero", cls: "hm-talk", onClick: () => act(s.primary.action) }));
    if (s.mute) {
      const b = button({ word: t(s.mute.key), icon: s.mute.icon, kind: "secondary", size: "hero", cls: `hm-mute${s.mute.on ? "" : " is-off"}`,
        label: s.mute.action === "mute" ? t("home.muteLong") : s.mute.action === "unmute" ? t("home.unmuteLong") : t(s.mute.key), onClick: () => act(s.mute.action) });
      if (s.mute.action !== "openMic") b.setAttribute("aria-pressed", String(call.muted));
      parts.push(b);
    }
    if (s.end) parts.push(button({ word: t(s.end.key), icon: "phoneOff", kind: "danger", size: "hero", cls: "hm-end", label: inCall() ? t("home.endLong") : t(s.end.key), onClick: () => endCall() }));
    fill(actions, ...parts);
    actions.dataset.count = String(parts.length);
  }

  function renderNotes() {
    const list = recoveryNotes({
      status: call.status, error: call.error, ended: call.ended, online: online(), jobsRunning: runningJobs().length,
      voiceServerActive: Boolean(state.voiceServer && state.voiceServer.active), issues: call.issues, autoplay: call.autoplay,
    });
    const key = JSON.stringify([document.documentElement.lang, list.map((n) => [n.kind, n.key, n.sub, n.actions]), call.endingOther]);
    patch(notes, key, () => list.map((n) => h("div", { class: "hm-note", dataset: { tone: n.tone, kind: n.kind }, role: n.tone === "bad" ? "alert" : "status" },
      icon(n.icon, 20),
      h("div", { class: "hm-note-body" },
        h("p", { class: "hm-note-title", text: t(n.key) }),
        n.sub ? h("p", { class: "hm-note-text", text: t(n.sub) }) : null),
      noteActions(n))));
    notes.hidden = list.length === 0;
  }

  function noteActions(n) {
    const btns = n.actions.map((a) => {
      // Retry already is the big button above; a note never repeats it.
      if (a === "tray") return button({ word: t("home.useButtons"), icon: "check", kind: "secondary", size: "sm", onClick: () => act("tray") });
      if (a === "type") return button({ word: t("home.typeInstead"), icon: "keyboard", kind: "secondary", size: "sm", onClick: () => act("type") });
      if (a === "endOther") return button({ word: t("talk.endThat"), icon: "phoneOff", kind: "secondary", size: "sm", busy: Boolean(call.endingOther), onClick: () => act("endOther") });
      return null;
    }).filter(Boolean);
    return btns.length ? h("div", { class: "hm-note-actions" }, ...btns) : null;
  }

  /* ---- conversation ---- */
  function renderConvo() {
    const live = inCall() || busy();
    if (wasLive && !live) endedAt = Date.now();
    if (live) endedAt = null;
    wasLive = live;
    const turns = call.transcript.filter((x) => (x.role === "owner" || x.role === "agent") && String(x.text || "").trim()).length;
    const show = showConversation({ live: inCall(), turns, endedAt, typed });
    convo.hidden = !show;
    if (!show) { convo.__key = null; return; }
    const biz = (state.business && state.business.name) || "";
    const v = conversationView(call.transcript, { disclosure: t("talk.disclosure", { biz }), showEarlier: showAll, keep: 4 });
    const key = JSON.stringify([document.documentElement.lang, v.pinned.text, showAll, v.older, v.shown.map((x) => [x.key, x.text, x.live, x.interrupted, x.via])]);
    if (convo.__key === key) return;
    convo.__key = key;
    const row = (role, x, pinned) => h("li", { class: `hm-turn is-${role}${x.live ? " is-live" : ""}${pinned ? " is-pinned" : ""}` },
      h("span", { class: "hm-who", text: role === "agent" ? t("home.sahay") : t("home.you") }),
      scripted("p", x.text, { class: "hm-said" }),
      x.via === "text" ? h("span", { class: "hm-flag", text: t("home.typed") }) : null,
      x.live && role === "owner" ? h("span", { class: "hm-flag", text: t("home.hearing") }) : null,
      x.interrupted ? h("span", { class: "hm-flag", text: t("home.cut") }) : null);
    fill(convoList, row("agent", { text: v.pinned.text }, true), ...v.shown.map((x) => row(x.role, x, false)));
    fill(convoMore, v.older || showAll
      ? h("button", { class: "link-btn", type: "button", "aria-expanded": String(showAll), on: { click: () => { showAll = !showAll; convo.__key = null; renderConvo(); } } },
        h("span", { text: showAll ? t("home.showLess") : t("home.showAll") }))
      : null);
    fill(convo, card({ title: t("home.convo"), body: [convoList, convoMore], cls: "hm-convo-card" }));
    requestAnimationFrame(() => { convoList.scrollTop = convoList.scrollHeight; });
  }

  /* ---- Needs you (rows from the Yes card's own state machine, yes.js) ---- */
  function needRow(r) {
    const line = r.line || "";
    const meta = [r.meta, r.simulated ? t("simulated") : ""].filter(Boolean).join(", ");
    const amount = r.amountText || "";
    return h("li", null, h("button", { class: "row hm-need", type: "button", "aria-label": t("home.checkLong", { line: [line, meta, amount].filter(Boolean).join(", ") }), on: { click: () => r.open() } },
      h("span", { class: "row-ico", "aria-hidden": "true" }, icon(r.icon, 20)),
      h("span", { class: "row-main" },
        scripted("span", line, { class: "row-title" }),
        meta ? scripted("span", meta, { class: `row-sub${r.simulated ? " hm-sim" : ""}` }) : null),
      h("span", { class: "row-end hm-need-end" },
        amount ? h("span", { class: "amount", text: amount }) : null,
        h("span", { class: "btn btn-secondary btn-sm hm-check", "aria-hidden": "true" }, h("span", { text: t("home.check") })))));
  }

  function renderNeeds() {
    const all = needsRows();
    const rows = all.slice(0, 3);
    const total = all.length;
    const key = JSON.stringify([document.documentElement.lang, rows.map((r) => [r.key, r.phase, r.line, r.meta, r.amountText, r.simulated]), total]);
    if (needsBody.__key === key) return;
    needsBody.__key = key;
    fill(needsBody, rows.length
      ? h("ul", { class: "list hm-needs-list", "aria-label": t("home.needs") }, ...rows.map(needRow))
      : scripted("p", t("home.needsEmpty"), { class: "hm-empty" }),
    total > rows.length ? h("button", { class: "link-btn", type: "button", on: { click: () => openNeeds(null) } }, h("span", { text: t("home.needsAll", { n: total }) })) : null);
  }

  /* ---- Today ---- */
  function renderToday() {
    const list = todayStats({
      now: new Date(),
      orders: [...state.orders.values()],
      ordersReady: state.boot === "ready",
      invoices: sell.status === "ready" ? [...sell.invoices.values()] : null,
      receipts: sell.status === "ready" ? sell.receipts : null,
      items: stock.status === "ready" ? [...stock.items.values()] : null,
    });
    const failed = [sell, stock].filter((x) => x.status === "error").length;
    const key = JSON.stringify([document.documentElement.lang, list.map((x) => [x.id, x.value]), failed]);
    if (todayBody.__key === key) return;
    todayBody.__key = key;
    const tiles = list.map((x) => {
      const value = x.value === null ? "—" : x.kind === "money" ? money(x.value) : grouped(x.value);
      const label = t(x.key);
      return h("li", null, h("a", { class: "tile hm-tile", href: x.route, dataset: { id: x.id, tone: x.tone, empty: String(x.value === null) }, "aria-label": t("home.statOpen", { word: label, value }) },
        h("span", { class: "tile-label" }, scripted("span", label), icon(x.icon, 20)),
        h("span", { class: "tile-value", text: value })));
    });
    fill(todayBody,
      h("ul", { class: "tiles hm-tiles", role: "list" }, ...tiles),
      failed ? h("div", { class: "hm-today-err" }, errorLine(t("home.statsFail")),
        button({ word: t("retry"), icon: "refresh", kind: "secondary", size: "sm", onClick: () => { if (sell.status === "error") loadSell(); if (stock.status === "error") loadStock(); } })) : null);
  }

  function renderCards() {
    if (!cards.childNodes.length) {
      cards.append(
        card({ title: t("home.needs"), body: needsBody, cls: "hm-card hm-card-needs" }),
        card({ title: t("home.today"), body: todayBody, cls: "hm-card hm-card-today" }));
    }
    renderNeeds();
    renderToday();
  }

  /* ---- data for Today: the same loads Sell, Money and Stock use ---- */
  const tried = { sell: false, stock: false };
  function ensureData() {
    if (state.boot !== "ready") return;
    if (sell.status === "idle" || (sell.status === "error" && !tried.sell)) { tried.sell = sell.status === "error"; loadSell({ quiet: true }); }
    if (stock.status === "idle" || (stock.status === "error" && !tried.stock)) { tried.stock = stock.status === "error"; loadStock({ quiet: true }); }
  }

  /* ---- render ---- */
  function render(parts) {
    ensureData();
    const all = parts.has("all") || parts.has("lang");
    if (all) { fill(cards); needsBody.__key = null; todayBody.__key = null; convo.__key = null; }
    const v = view();
    if (all || parts.has("business")) { renderGreeting(); figure.relabel(); }
    renderState(v);
    if (all || parts.has("call") || parts.has("business") || parts.has("agent")) { renderActions(); renderNotes(); renderComposer(); }
    if (all || parts.has("call") || parts.has("transcript") || parts.has("business")) renderConvo();
    renderCards();
    el.dataset.live = String(inCall());
  }

  // The figure's level follows the live voice: the owner's mic while listening, Sahay's voice while speaking.
  let raf = 0;
  let pending = 0;
  onLevels(({ mic, agent }) => {
    const st = call.agentState;
    pending = st === "speaking" ? Math.min(1, agent * 1.4) : st === "listening" && !call.muted ? Math.min(1, mic * 1.6) : 0;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; figure.level(pending); });
  });
  for (const ev of ["online", "offline"]) window.addEventListener(ev, () => render(new Set(["call"])));
  // "Type" from elsewhere (sahay:compose) opens the input here.
  document.addEventListener("sahay:compose", () => { if (!/^#\/(home|sahay|talk)?$/.test(location.hash || "")) location.hash = "#/home"; requestAnimationFrame(() => setComposer(true, true)); });
  // Minute tick: the greeting follows the time of day and "just after a call" expires.
  setInterval(() => { if (el.isConnected) { renderGreeting(); renderConvo(); } }, 60000);
  // The Yes card's state machine (yes.js) owns the waiting decisions; Home follows it.
  onNeedsRows(() => { renderNeeds(); renderState(view()); });
  onCount(() => renderState(view()));
  ensureData();

  return {
    el,
    update: (_s, parts) => render(parts),
    enter() {
      // Today reads sell (bills, money in) and stock (low items): load them on every visit when
      // they are not loaded yet; a failed load shows its own line with Try again.
      ensureData();
      render(new Set(["all"]));
    },
    leave() { if (composerOpen) setComposer(false, false); },
  };
}

