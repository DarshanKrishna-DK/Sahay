// Sahay home (#/sahay; #/talk and the empty route are aliases): talking is the main act, so the
// home is the lime orb, the call strip under it (Talk / Type / Mute / End, End its own red control),
// the "now doing" HUD, the conversation with the disclosure pinned first, typing during a live
// call without muting the mic (D16), and the honest recovery states (F8: safer route, network
// blocked, call dropped, call ended, offline, a call open elsewhere, blocked audio). First visit
// shows three "try saying" chips (instructions, never records); an idle home with no conversation
// shows Today tiles with real numbers only. Voice and typed text are one session (call.js).
// Logic lives in home-model.js (tested without a DOM); this file only draws it.

import { h, icon, fill, patch, scripted } from "./dom.js";
import { t, lang } from "./i18n.js";
import "./home-strings.js";
import { state, pendingApprovals } from "./store.js";
import { sell, stock, pendingInvoices, loadSell, loadStock } from "./store-sell.js";
import { call, inCall, startCall, endCall, setMuted, textSupported, resumeAudio, endServerCall } from "./call.js";
import { createOrb } from "./orb.js";
import { runningJobs, agentState } from "./activity.js";
import { createHud, setWaitingCount } from "./hud.js";
import { createComposer } from "./composer.js";
import { mountCallDock, onHome } from "./call-dock.js";
import { orbView, callStrip, recoveryNotes, conversationView, isFirstVisit, todayTiles, inr, grouped } from "./home-model.js";

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

const PAID = new Set(["paid", "in_transit", "delivered", "closed", "cancelled", "rejected"]);
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

export function createSahayHome() {
  mountCallDock();
  const el = h("section", { class: "sh-home", "aria-labelledby": "sh-title", dataset: { visual: "idle" } });
  const title = h("h1", { class: "sr-only", id: "sh-title" });

  const orb = createOrb({ onPress: orbPress });
  const label = h("p", { class: "sh-orb-label", "aria-live": "polite" });
  const hud = createHud();
  const notes = h("div", { class: "sh-notes" });
  const strip = h("div", { class: "sh-strip", role: "group" });
  const hint = h("p", { class: "sh-hint", hidden: true });
  const stage = h("div", { class: "sh-stage" }, hud.el, h("div", { class: "sh-orb-wrap" }, orb.el), label, hint, notes, strip);

  const convo = h("ol", { class: "sh-convo" });
  const convoWrap = h("section", { class: "sh-talk", "aria-labelledby": "sh-convo-title" }, h("h2", { class: "sr-only", id: "sh-convo-title" }), convo);
  const top = h("div", { class: "sh-top" });

  let keyboardBtn = null;
  const composer = createComposer({
    openTray,
    waitingCount: countWaiting,
    onOpenChange: (open, restore) => {
      el.dataset.composer = open ? "open" : "closed";
      renderStrip();
      if (!open && restore && keyboardBtn) keyboardBtn.focus({ preventScroll: true });
    },
  });
  el.append(title, top, convoWrap, stage, composer.el);
  el.dataset.composer = "closed";

  const phoneQuery = matchMedia("(max-width: 599px)");
  phoneQuery.addEventListener("change", () => { convo.__key = null; renderConvo(); });
  let hintKey = null;
  let showEarlier = false;
  let stick = true; // keep the newest turn in view unless the owner scrolled up to read
  convo.addEventListener("scroll", () => { stick = convo.scrollHeight - convo.scrollTop - convo.clientHeight < 40; }, { passive: true });

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

  function view() {
    const first = isFirstVisit({ turns: call.transcript.length, requirements: state.requirements.length, orders: state.orders.size, hasRequirement: Boolean(state.requirement) });
    return orbView({
      status: call.status, agentState: call.agentState, mode: call.mode, route: call.route, error: call.error,
      ended: call.ended, online: online(), working: runningJobs().length > 0, muted: call.muted, first,
    });
  }

  function orbPress() {
    const s = call.status;
    if (s === "idle" || s === "error") { startCall("voice"); return; }
    // Live: the orb opens or unmutes the mic, never ends the call (D12).
    if (inCall() && (call.micless || call.muted)) setMuted(false);
  }

  function renderOrb(v) {
    const pressable = call.status === "idle" || call.status === "error" || (inCall() && (call.micless || call.muted));
    const words = t(v.key);
    orb.set({ visual: v.visual, state: v.state, label: pressable || !inCall() ? words : `${words}. ${t("home.orb.pressLive")}`, agent: agentState(), badge: v.visual === "error" || v.tone === "warn" ? v.icon : null, pressable });
    el.dataset.visual = v.visual;
    el.dataset.state = v.state;
    el.dataset.tone = v.tone;
    patch(label, `${words}|${v.icon}|${v.tone}`, () => [icon(v.icon, 20), scripted("span", words)]);
    label.dataset.tone = v.tone;
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

  function renderStrip() {
    const s = callStrip({ status: call.status, mode: call.mode, muted: call.muted, micless: call.micless, autoplay: call.autoplay, error: call.error, ended: call.ended, textSupported: textSupported() });
    strip.setAttribute("aria-label", t("home.title"));
    const parts = [];
    keyboardBtn = null;
    if (s.keyboard) {
      const open = composer.isOpen();
      keyboardBtn = h("button", {
        class: "keycap keycap-md keycap-secondary sh-ctl sh-ctl-type", type: "button", "aria-expanded": String(open), "aria-controls": "sh-composer-input",
        on: { click: () => (open ? composer.close(true) : composer.open()) },
      }, icon(open ? "x" : "keyboard", 24), h("span", { text: open ? t("home.typeClose") : t("home.type") }));
      parts.push(keyboardBtn);
    }
    if (s.mute) {
      parts.push(h("button", {
        class: `keycap keycap-md keycap-secondary sh-ctl sh-ctl-mute${s.mute.on ? "" : " is-off"}`, type: "button",
        "aria-pressed": s.mute.action === "openMic" ? undefined : String(call.muted),
        "aria-label": s.mute.action === "mute" ? t("home.muteLong") : s.mute.action === "unmute" ? t("home.unmuteLong") : t(s.mute.key),
        on: { click: () => act(s.mute.action) },
      }, icon(s.mute.icon, 24), h("span", { text: t(s.mute.key) })));
    }
    if (s.primary) {
      parts.push(h("button", { class: `keycap keycap-md keycap-primary sh-ctl sh-ctl-primary is-${s.primary.action}`, type: "button", on: { click: () => act(s.primary.action) } },
        icon(s.primary.icon, 24), h("span", { text: t(s.primary.key) })));
    }
    if (s.end) {
      parts.push(h("button", { class: "keycap keycap-md keycap-danger sh-ctl sh-ctl-end", type: "button", "aria-label": inCall() ? t("home.endLong") : t(s.end.key), on: { click: () => endCall() } },
        icon("phoneOff", 24), h("span", { text: t(s.end.key) })));
    }
    fill(strip, ...parts);
    strip.dataset.count = String(parts.length);
  }

  function renderNotes() {
    const list = recoveryNotes({
      status: call.status, error: call.error, ended: call.ended, online: online(), jobsRunning: runningJobs().length,
      voiceServerActive: Boolean(state.voiceServer && state.voiceServer.active), issues: call.issues, autoplay: call.autoplay,
    });
    const key = JSON.stringify([document.documentElement.lang, list.map((n) => [n.kind, n.key, n.sub, n.actions]), call.endingOther]);
    patch(notes, key, () => list.map((n) => h("article", { class: `card sh-note${n.tone === "bad" ? " card-alert" : ""}`, dataset: { tone: n.tone, kind: n.kind }, role: n.tone === "bad" ? "alert" : "status" },
      h("span", { class: "sh-note-icon", "aria-hidden": "true" }, icon(n.icon, 22)),
      h("div", { class: "sh-note-body" },
        h("p", { class: "sh-note-title", text: t(n.key) }),
        n.sub ? h("p", { class: "sh-note-text", text: t(n.sub) }) : null),
      noteActions(n))));
    notes.hidden = list.length === 0;
  }

  function noteActions(n) {
    const btns = n.actions.map(noteAction).filter(Boolean);
    return btns.length ? h("div", { class: "sh-note-actions" }, ...btns) : null;
  }

  function noteAction(a) {
    // Retry also sits in the call strip; the note repeats it only where the strip has none.
    if (a === "retry") return null;
    if (a === "tray") return h("button", { class: "chip", type: "button", on: { click: () => act("tray") } }, icon("check", 20), h("span", { text: t("home.useButtons") }));
    if (a === "type") return h("button", { class: "chip", type: "button", on: { click: () => act("type") } }, icon("keyboard", 20), h("span", { text: t("home.typeInstead") }));
    if (a === "endOther") {
      return h("button", { class: "chip", type: "button", "aria-busy": call.endingOther ? "true" : undefined, disabled: call.endingOther ? true : undefined, on: { click: () => act("endOther") } },
        call.endingOther ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("phoneOff", 20), h("span", { text: t("talk.endThat") }));
    }
    return null;
  }

  function bubble(role, text, extra = {}) {
    const who = role === "agent" ? t("home.sahay") : extra.typed ? t("home.youTyped") : t("home.you");
    return h("li", { class: `sh-bubble is-${role}${extra.live ? " is-live" : ""}${extra.cut ? " is-cut" : ""}${extra.pinned ? " is-pinned" : ""}` },
      h("span", { class: "sh-bubble-who" },
        role === "agent" ? h("span", { class: "sh-who-dot", "aria-hidden": "true" }) : icon(extra.typed ? "keyboard" : "mic", 16),
        h("span", { text: who }),
        extra.pinned ? h("span", { class: "sh-bubble-notice" }, icon("shield", 16), h("span", { text: t("notice.short") })) : null),
      scripted("p", text, { class: "sh-bubble-text" }),
      extra.live && role === "owner" ? h("span", { class: "sh-bubble-flag is-hearing", text: t("home.hearing") }) : null,
      extra.cut ? h("span", { class: "sh-bubble-flag", text: t("home.cut") }) : null);
  }

  function renderConvo() {
    const biz = (state.business && state.business.name) || "";
    // Phones keep the last two turns in view (the orb and its controls must stay above the dock).
    const v = conversationView(call.transcript, { disclosure: t("talk.disclosure", { biz }), showEarlier, keep: phoneQuery.matches ? 2 : 3 });
    if (!v.older) showEarlier = false;
    convo.setAttribute("aria-label", t("home.convo"));
    const key = JSON.stringify([document.documentElement.lang, v.pinned.text, showEarlier, v.older, v.shown.map((x) => [x.key, x.text, x.live, x.interrupted, x.via])]);
    const changed = patch(convo, key, () => {
      const items = [bubble("agent", v.pinned.text, { pinned: true })];
      if (v.older) {
        items.push(h("li", { class: "sh-earlier" },
          h("button", {
            class: "chip sh-earlier-btn", type: "button", "aria-expanded": String(showEarlier),
            on: { click: () => { showEarlier = !showEarlier; renderConvo(); requestAnimationFrame(() => { const b = convo.querySelector(".sh-earlier-btn"); if (b) b.focus({ preventScroll: true }); }); } },
          }, icon(showEarlier ? "chevronUp" : "history", 20), h("span", { text: showEarlier ? t("home.earlierHide") : t("home.earlier", { n: v.older }) }))));
      }
      for (const x of v.shown) items.push(bubble(x.role, x.text, { live: x.live, cut: x.interrupted, typed: x.via === "text" }));
      return items;
    });
    if (changed && stick) requestAnimationFrame(() => { convo.scrollTop = convo.scrollHeight; });
    el.dataset.turns = String(v.count);
    hint.hidden = !hintKey || v.count > 0;
    hint.textContent = hintKey ? t(hintKey) : "";
  }

  function tile(x) {
    const value = x.kind === "money" ? inr(x.value) : grouped(x.value);
    return h("li", null, h("a", { class: "card card-interactive sh-tile", href: x.route, dataset: { id: x.id } },
      icon(x.icon, 22), h("span", { class: "sh-tile-word", text: t(x.key) }), h("span", { class: "sh-tile-num", text: value })));
  }

  function renderTop(v) {
    const idle = call.status === "idle" && !call.transcript.length;
    if (v.state === "first") {
      patch(top, `first|${document.documentElement.lang}`, () => {
        const chips = TRY.map((k) => {
          const words = t(k);
          const b = h("button", { class: "chip sh-try", type: "button", dataset: { state: "idle" } },
            icon("speaker", 20), scripted("span", words));
          b.setAttribute("aria-label", `${t("home.tryHear")}: ${words}`);
          b.addEventListener("click", () => {
            for (const o of top.querySelectorAll(".sh-try")) o.dataset.state = "idle";
            b.dataset.state = "playing";
            sayOnDevice(words, () => { b.dataset.state = "idle"; });
          });
          return h("li", null, b);
        });
        return [h("p", { class: "sh-try-title", text: t("home.trySaying") }), h("ul", { class: "sh-try-list", role: "list" }, ...chips)];
      });
      top.hidden = false;
      top.dataset.kind = "try";
      return;
    }
    if (!idle) { top.hidden = true; top.__key = null; return; }
    const owed = sell.status === "ready" ? sell.owed.reduce((s, o) => s + (o.amount || 0), 0) : null;
    const orders = [...state.orders.values()].filter((o) => o.status && !PAID.has(o.status));
    const toPay = state.boot === "ready" ? orders.reduce((s, o) => s + (o.amount || 0), 0) : null;
    const low = stock.status === "ready" ? [...stock.items.values()].filter((i) => i.low === true).length : null;
    const bills = sell.status === "ready" ? pendingInvoices().length : null;
    const tiles = todayTiles({ toCollect: owed, toPay, low, billsWaiting: bills });
    // Loading: one skeleton per tile still coming. Error: one line with Try again (never a zero).
    const waitingFor = (sell.status === "loading" ? 3 : 0) + (stock.status === "loading" ? 1 : 0);
    const failed = [sell, stock].filter((x) => x.status === "error");
    patch(top, JSON.stringify(["tiles", document.documentElement.lang, tiles.map((x) => [x.id, x.value]), waitingFor, failed.length]), () => [
      h("h2", { class: "sh-today-title", text: t("home.today") }),
      h("ul", { class: "sh-tiles", role: "list", "aria-busy": waitingFor ? "true" : undefined },
        ...tiles.map(tile),
        ...Array.from({ length: Math.min(waitingFor, 4 - tiles.length) }, () => h("li", { "aria-hidden": "true" }, h("span", { class: "skel skel-card sh-tile-skel" })))),
      failed.length ? h("p", { class: "error-line sh-tiles-error", role: "alert" }, icon("alert", 20), h("span", { text: t("home.tilesFail") }),
        h("button", { class: "chip", type: "button", on: { click: () => { if (sell.status === "error") loadSell(); if (stock.status === "error") loadStock(); } } }, icon("refresh", 20), h("span", { text: t("retry") }))) : null,
    ]);
    top.hidden = tiles.length === 0 && !waitingFor && !failed.length;
    top.dataset.kind = "tiles";
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    title.textContent = t("home.title");
    const v = view();
    if (all || parts.has("call") || parts.has("work") || parts.has("approvals") || parts.has("business") || parts.has("agent")) {
      renderOrb(v); renderNotes(); renderStrip(); composer.update();
    }
    if (all || parts.has("call") || parts.has("work") || parts.has("approvals") || parts.has("orders") || parts.has("sell") || parts.has("stock") || parts.has("transcript")) hud.update();
    if (all || parts.has("transcript") || parts.has("call") || parts.has("business")) renderConvo();
    if (all || parts.has("call") || parts.has("transcript") || parts.has("orders") || parts.has("sell") || parts.has("stock") || parts.has("boot")) renderTop(v);
    el.dataset.live = String(inCall());
    el.dataset.mode = call.mode;
  }

  return {
    el,
    update: (_s, parts) => render(parts),
    enter() {
      // Today tiles read sell and stock; load them quietly once (a missing route leaves its tile out).
      if (sell.status === "idle") loadSell({ quiet: true });
      if (stock.status === "idle") loadStock({ quiet: true });
      render(new Set(["all"]));
    },
    leave() { if (composer.isOpen()) composer.close(false); },
  };
}

/** Kept for screens.js until the shell routes #/sahay by its own name. */
export const createTalk = createSahayHome;
