// Home (#/home; #/sahay, #/talk and the empty route are aliases). UI v7, owner's layout (live test):
//   laptop (>= 1024): one compact top row (pixel agent sprite + state word + greeting | TALK / TYPE),
//   then a two-column main area filling the viewport height: LEFT the conversation (always there,
//   scrolls, newest at the bottom, "jump to latest", the typed input at its foot), RIGHT the
//   Discovery board (W4A's createDiscoveryBoard() from discovery.js; an empty board until Sahay
//   publishes sellers and deals). Below the fold: Needs you + Today.
//   phone: sprite + Talk / Type, the board (only when it has something), the conversation, Needs you, Today.
// Behaviour kept: the call contract (call.js / voice.js), drop and blocked-network recovery, typing
// during a call never mutes the mic (D16), a typed yes never approves, read-aloud of "now".
// Logic is in home-model.js (tested without a DOM).

import { h, icon, fill, patch, scripted, button, card, errorLine, money } from "./ui.js";
import { t } from "./i18n.js";
import "./home-strings.js";
import { state } from "./store.js";
import { sell, stock, loadSell, loadStock } from "./store-sell.js";
// yes.js is imported here directly so Home never depends on boot order (W3 owns the decisions).
import { needsRows, onNeedsRows, openNeeds, onCount, typedYesHint } from "./yes.js";
import { call, inCall, startCall, endCall, setMuted, sendText, textSupported, resumeAudio, endServerCall } from "./call.js";
import { runningJobs, nowLine } from "./activity.js";
import { speakButton } from "./speak.js";
import {
  orbView, callStrip, recoveryNotes, conversationView, isTypedYes, todayStats, boxState, stateWord,
  greetingKey, grouped,
} from "./home-model.js";

// This screen's stylesheet (until the shell links it from app.html).
if (!document.querySelector('link[href="/css/home.css"]')) {
  document.head.append(h("link", { rel: "stylesheet", href: "/css/home.css" }));
}

const online = () => navigator.onLine !== false;
const MAX_TEXT = 500;
const ALL_TURNS = 400; // the conversation scrolls instead of folding

/**
 * The agent figure: the pixel helper sprite (public/art/agent-*.png, README there), one 192px cell
 * per state in agent-sheet.png (idle, listening, thinking, speaking, waiting, trouble), pixelated.
 * The sheet is one image, preloaded with the six single frames, so a state change never flashes; a
 * gentle two-step bob runs only when motion is allowed (CSS, still under reduced motion).
 * Size: 96px in the compact laptop row, 144px on phones, 120px on short phones.
 */
const AGENT_STATES = ["idle", "listening", "thinking", "speaking", "waiting", "trouble"];
const AGENT_SHEET = "/art/agent-sheet.png";
const preloaded = [];
function preloadAgent() {
  if (preloaded.length || typeof Image !== "function") return;
  for (const src of [AGENT_SHEET, ...AGENT_STATES.map((st) => `/art/agent-${st}.png`)]) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    preloaded.push(img);
  }
}
const FIG_QUERIES = ["(max-width: 767px)", "(max-height: 700px)"];
function figureSize() {
  if (matchMedia("(max-width: 767px)").matches) return matchMedia("(max-height: 700px)").matches ? 120 : 144;
  return 96;
}
function createFigure() {
  preloadAgent();
  const sprite = h("span", { class: "hm-agent", role: "img", dataset: { state: "idle" } });
  const host = h("div", { class: "hm-figure", dataset: { state: "idle" } }, sprite);
  const size = () => host.style.setProperty("--fig", `${figureSize()}px`);
  for (const q of FIG_QUERIES) matchMedia(q).addEventListener("change", size);
  size();
  return {
    el: host,
    set(st) {
      const next = AGENT_STATES.includes(st) ? st : "idle";
      host.dataset.state = next;
      sprite.dataset.state = next;
      sprite.style.setProperty("--cell", String(AGENT_STATES.indexOf(next)));
    },
    relabel(label) { sprite.setAttribute("aria-label", label); },
  };
}

/**
 * The Discovery board (W4A, discovery.js). Imported defensively: until the module lands, or when it
 * reports nothing to show, the panel shows its own empty state. Accepted shapes:
 * createDiscoveryBoard() -> { el, update?(state, parts), isEmpty?(), onChange?(fn), destroy?() }.
 */
function createBoardSlot(onChange) {
  const body = h("div", { class: "hm-board-body" });
  const empty = h("div", { class: "hm-board-empty" },
    h("span", { class: "hm-board-art", "aria-hidden": "true" }),
    scripted("p", "", { class: "hm-board-empty-text" }));
  let board = null;
  const isEmpty = () => {
    if (!board) return true;
    if (typeof board.isEmpty === "function") { try { return Boolean(board.isEmpty()); } catch { return false; } }
    if (board.el && board.el.dataset && board.el.dataset.empty !== undefined) return board.el.dataset.empty === "true";
    return !(board.el && board.el.childElementCount);
  };
  function paint() {
    const e = isEmpty();
    empty.querySelector(".hm-board-empty-text").textContent = t("home.boardEmpty");
    empty.hidden = !e;
    if (board && board.el) board.el.hidden = e && typeof board.isEmpty === "function";
    onChange(e);
  }
  body.append(empty);
  import("./discovery.js").then((m) => {
    if (!m || typeof m.createDiscoveryBoard !== "function") return;
    board = m.createDiscoveryBoard();
    if (board && board.el) body.append(board.el);
    if (board && typeof board.onChange === "function") board.onChange(paint);
    paint();
  }).catch(() => { /* no board module on this build yet: the empty state stays */ });
  return {
    el: body,
    update(s, parts) {
      if (board && typeof board.update === "function") { try { board.update(s, parts); } catch (err) { console.error(err); } }
      paint();
    },
  };
}

export function createHome() {
  const el = h("div", { class: "screen hm", dataset: { state: "idle" } });

  /* ---- top row: sprite + state word + greeting | TALK / TYPE ---- */
  const greet = h("h1", { class: "hm-greet", id: "hm-title", tabindex: "-1" });
  const figure = createFigure();
  const word = h("p", { class: "hm-state", role: "status", "aria-live": "polite" });
  const assistant = h("p", { class: "hm-assistant" });
  const actions = h("div", { class: "hm-actions", role: "group" });
  const notes = h("div", { class: "hm-notes", hidden: true });
  const hero = h("section", { class: "hm-hero", "aria-labelledby": "hm-title" },
    figure.el,
    h("div", { class: "hm-hero-text" }, greet, word, assistant),
    actions,
    notes);

  /* ---- conversation panel (always there) ---- */
  const convoTitle = h("h2", { class: "hm-panel-title", id: "hm-convo-title" });
  const liveDot = h("span", { class: "hm-live-dot", "aria-hidden": "true" });
  const convoList = h("ol", { class: "hm-convo", tabindex: "0", "aria-labelledby": "hm-convo-title" });
  const jump = h("button", { class: "btn btn-secondary btn-sm hm-jump", type: "button", hidden: true });
  const composer = h("form", { class: "hm-composer", autocomplete: "off" });
  const convoPanel = h("section", { class: "hm-panel hm-convo-panel", "aria-labelledby": "hm-convo-title" },
    h("header", { class: "hm-panel-head" }, liveDot, convoTitle),
    h("div", { class: "hm-convo-scroll" }, convoList, jump),
    composer);

  /* ---- discovery board panel ---- */
  const boardTitle = h("h2", { class: "hm-panel-title", id: "hm-board-title" });
  const boardPanel = h("section", { class: "hm-panel hm-board-panel", "aria-labelledby": "hm-board-title", dataset: { empty: "true" } });
  const boardSlot = createBoardSlot((isEmpty) => { boardPanel.dataset.empty = String(isEmpty); });
  boardPanel.append(h("header", { class: "hm-panel-head" }, boardTitle), boardSlot.el);

  const main = h("div", { class: "hm-main" }, convoPanel, boardPanel);

  /* ---- Needs you + Today (below the fold) ---- */
  const needsBody = h("div", { class: "hm-needs" });
  const todayBody = h("div", { class: "hm-today" });
  const cards = h("div", { class: "hm-cards" });

  el.append(hero, main, cards);

  let failedText = null;
  let typedYes = false;
  let stick = true; // keep the newest turn in view unless the owner scrolled up to read

  /* ---- typing (always at the foot of the conversation) ---- */
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
    stick = true;
    const ok = await sendText(text);
    if (ok) input.value = ""; else { failedText = text; typedYes = false; }
    renderComposer();
    renderConvo();
    input.focus({ preventScroll: true });
  });
  input.addEventListener("input", () => { failedText = null; renderComposer(); });

  function focusInput() {
    if (!textSupported()) return;
    composer.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  function renderComposer() {
    composer.hidden = !textSupported();
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

  /* ---- top row ---- */
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
    convoTitle.textContent = t("home.convo");
    boardTitle.textContent = t("home.board");
    jump.replaceChildren(icon("chevronDown", 18), h("span", { text: t("home.jumpLatest") }));
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
    figure.relabel(`${t("home.figure")}: ${text}`);
    el.dataset.state = v.state;
  }

  function act(a) {
    if (a === "start") startCall("voice");
    else if (a === "retry") startCall(call.mode === "text" ? "text" : "voice");
    else if (a === "hear") resumeAudio();
    else if (a === "mute") setMuted(true);
    else if (a === "unmute" || a === "openMic") setMuted(false);
    else if (a === "tray") openNeeds(null);
    else if (a === "type") focusInput();
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
    if (s.keyboard) parts.push(button({ word: t("home.type"), icon: "keyboard", kind: "secondary", size: "hero", cls: "hm-typebtn", label: t("home.typeInstead"), onClick: () => focusInput() }));
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

  /* ---- conversation: every turn, scrolls, newest at the bottom ---- */
  const atBottom = () => convoList.scrollHeight - convoList.scrollTop - convoList.clientHeight < 32;
  convoList.addEventListener("scroll", () => { stick = atBottom(); jump.hidden = stick; }, { passive: true });
  jump.addEventListener("click", () => {
    stick = true;
    jump.hidden = true;
    convoList.scrollTo({ top: convoList.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  function renderConvo() {
    const biz = (state.business && state.business.name) || "";
    const v = conversationView(call.transcript, { disclosure: t("talk.disclosure", { biz }), keep: ALL_TURNS, showEarlier: true });
    convoPanel.dataset.live = String(inCall());
    convoPanel.dataset.turns = String(v.count);
    const key = JSON.stringify([document.documentElement.lang, v.pinned.text, v.shown.map((x) => [x.key, x.text, x.live, x.interrupted, x.via])]);
    if (convoList.__key === key) return;
    convoList.__key = key;
    const row = (role, x, pinned) => h("li", { class: `hm-turn is-${role}${x.live ? " is-live" : ""}${pinned ? " is-pinned" : ""}` },
      h("span", { class: "hm-who", text: role === "agent" ? t("home.sahay") : t("home.you") }),
      scripted("p", x.text, { class: "hm-said" }),
      x.via === "text" ? h("span", { class: "hm-flag", text: t("home.typed") }) : null,
      x.live && role === "owner" ? h("span", { class: "hm-flag", text: t("home.hearing") }) : null,
      x.interrupted ? h("span", { class: "hm-flag", text: t("home.cut") }) : null);
    fill(convoList,
      row("agent", { text: v.pinned.text }, true),
      ...v.shown.map((x) => row(x.role, x, false)),
      v.count ? null : h("li", { class: "hm-convo-empty" }, scripted("p", t("home.convoHint"))));
    requestAnimationFrame(() => {
      if (stick) { convoList.scrollTop = convoList.scrollHeight; jump.hidden = true; } else jump.hidden = false;
    });
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
        h("span", { class: "tile-label" }, icon(x.icon, 18), scripted("span", label, { class: "hm-tile-word" })),
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
    if (all) { fill(cards); needsBody.__key = null; todayBody.__key = null; convoList.__key = null; }
    const v = view();
    if (all || parts.has("business")) renderGreeting();
    renderState(v);
    if (all || parts.has("call") || parts.has("business") || parts.has("agent")) { renderActions(); renderNotes(); renderComposer(); }
    if (all || parts.has("call") || parts.has("transcript") || parts.has("business")) renderConvo();
    boardSlot.update(state, parts);
    renderCards();
    el.dataset.live = String(inCall());
  }

  for (const ev of ["online", "offline"]) window.addEventListener(ev, () => render(new Set(["call"])));
  // "Type" from elsewhere (sahay:compose) focuses the input here.
  document.addEventListener("sahay:compose", () => { if (!/^#\/(home|sahay|talk)?$/.test(location.hash || "")) location.hash = "#/home"; requestAnimationFrame(focusInput); });
  // Minute tick: the greeting follows the time of day.
  setInterval(() => { if (el.isConnected) renderGreeting(); }, 60000);
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
  };
}
