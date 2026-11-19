// Talk (home): the agent orb, one line of what Sahay is doing now (🔊), the disclosure as the
// first bubble, the latest three turns, and a Call / Type toggle. Voice and typed text are the
// same agent session and transcript (VoiceCall start({ mode }) / sendText).

import { h, icon, fill, patch, scripted } from "./dom.js";
import { t } from "./i18n.js";
import { state } from "./store.js";
import { call, inCall, startCall, endCall, setMuted, setMode, sendText, textSupported, resumeAudio, endServerCall } from "./call.js";
import { createOrb } from "./orb.js";
import { nowLine, runningJobs } from "./activity.js";
import { speakButton } from "./speak.js";

const YES_WORDS = /^\s*(yes|yeah|ok|okay|haan|han|ha|हाँ|हां|जी हाँ|ठीक है|ಹೌದು|ಸರಿ)\s*[.!]?\s*$/i;

export function createTalk() {
  const el = h("section", { class: "talk", "aria-labelledby": "talk-title" });
  const title = h("h1", { class: "sr-only", id: "talk-title" });
  // The orb always answers a tap: start when idle (or after an error, or when an old call is
  // stuck ending), otherwise end or cancel the call. call.js drops a call object that hangs.
  const orb = createOrb({ onPress: () => {
    if (call.status === "idle" || call.status === "error" || call.status === "ending") startCall(call.mode === "text" ? "text" : "voice");
    else endCall();
  } });
  const orbLabel = h("p", { class: "orb-label", "aria-live": "polite" });
  const now = h("div", { class: "now" });
  const issues = h("div", { class: "talk-issues" });
  const controls = h("div", { class: "talk-controls" });
  const convo = h("ol", { class: "convo", "aria-label": "" });
  const typeRow = h("form", { class: "type-row", autocomplete: "off" });
  const hint = h("p", { class: "talk-hint", hidden: true });
  let hintKey = null;
  const stage = h("div", { class: "talk-stage" }, orb.el, orbLabel, now, issues, controls);
  const side = h("div", { class: "talk-side" }, h("h2", { class: "sr-only", id: "convo-title" }), convo, hint, typeRow);
  el.append(title, stage, side);

  // Type row.
  const input = h("input", { class: "type-input", type: "text", maxlength: 500, enterkeyhint: "send", id: "type-input" });
  const sendBtn = h("button", { class: "icon-btn icon-btn-lg send-btn", type: "submit" }, icon("send", 24));
  const typeLabel = h("label", { class: "sr-only", for: "type-input" });
  const typeNote = h("p", { class: "type-note", role: "status", "aria-live": "polite" });
  typeRow.append(typeLabel, h("div", { class: "type-pill" }, input, sendBtn), typeNote);
  typeRow.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || call.sending) return;
    const ok = await sendText(text);
    if (ok) {
      input.value = "";
      typeNote.textContent = YES_WORDS.test(text) && [...state.approvals.values()].some((a) => a.status === "pending") ? t("talk.typedYes") : "";
    }
    render(new Set(["call"]));
  });

  document.addEventListener("sahay:focus-type", () => requestAnimationFrame(() => input.focus()));
  document.addEventListener("sahay:hint", (e) => { hintKey = e.detail && e.detail.key; render(new Set(["call"])); });

  function orbView() {
    const s = call.status;
    const working = runningJobs().length > 0;
    if (s === "error") return ["idle", call.error ? errorText(call.error) : t("call.failed"), "bad"];
    if (s === "idle" && call.ended) return ["idle", t("talk.callEnded"), "bad"];
    if (s === "mic") return ["connecting", t("talk.mic")];
    if (s === "connecting") return ["connecting", t("talk.connecting")];
    if (s === "waiting") return ["connecting", t("talk.waiting")];
    if (s === "reconnecting") return ["connecting", t("talk.reconnecting")];
    if (s === "ending") return ["connecting", t("talk.ending")];
    if (s === "live") {
      const a = call.agentState;
      if (a === "listening") return ["listening", call.mode === "text" ? t("talk.yourTurn") : t("talk.listening")];
      if (a === "thinking") return ["thinking", t("talk.thinking")];
      if (a === "speaking") return ["speaking", t("talk.speaking")];
      return ["listening", t("talk.yourTurn")];
    }
    if (working) return ["working", t("talk.working")];
    return ["idle", t("talk.tap")];
  }

  function errorText(err) {
    // Owner language only: a known code has its own line, anything else is "could not start".
    const k = `call.${err.code}`;
    const tr = t(k);
    return tr !== k ? tr : t("call.failed");
  }

  function renderOrb() {
    const [st, label, tone] = orbView();
    const ends = inCall() || call.status === "mic" || call.status === "connecting";
    orb.set(st, ends ? `${label}. ${t("talk.end")}` : label, runningJobs().length > 0);
    orb.el.disabled = false;
    orbLabel.textContent = label;
    orbLabel.dataset.state = st;
    if (tone) orbLabel.dataset.tone = tone; else delete orbLabel.dataset.tone;
  }

  function renderNow() {
    const n = nowLine();
    const text = t(n.key, n.vars);
    patch(now, `${text}|${n.tone}|${document.documentElement.lang}`, () => [
      h("p", { class: `now-line tone-${n.tone}` },
        h("span", { class: "now-dot", "aria-hidden": "true" }),
        scripted("span", text, { class: "now-text" })),
      speakButton("now", { size: "sm" }),
    ]);
  }

  function renderIssues() {
    const items = [];
    if (call.status === "error" && call.error && call.error.retry !== false) {
      items.push(h("button", { class: "btn btn-ghost", type: "button", on: { click: () => startCall(call.mode) } }, icon("refresh", 20), h("span", { text: t("retry") })));
    }
    if (call.status === "idle" && call.ended && (call.ended.reason === "offline" || call.ended.reason === "stuck")) {
      items.push(h("div", { class: "issue issue-bad", role: "status" }, icon(call.ended.reason === "offline" ? "alert" : "phoneOff", 22), h("span", { text: t(`call.${call.ended.reason}`) })));
    }
    if ((call.status === "idle" || call.status === "error") && state.voiceServer && state.voiceServer.active) {
      items.push(h("div", { class: "issue issue-warn" }, icon("alert", 22), h("span", { text: t("talk.otherTab") }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: call.endingOther ? true : undefined, on: { click: endServerCall } },
          call.endingOther ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("phoneOff", 20), h("span", { text: t("talk.endThat") }))));
    }
    if (call.autoplay) items.push(h("button", { class: "btn btn-primary", type: "button", on: { click: resumeAudio } }, icon("speaker", 22), h("span", { text: t("talk.audioBlocked") })));
    if (inCall()) for (const i of call.issues) items.push(h("div", { class: "issue issue-warn" }, icon("alert", 22), h("span", { text: i.message })));
    fill(issues, ...items);
  }

  function renderControls() {
    const live = inCall();
    const text = textSupported();
    const mode = call.mode;
    const seg = h("div", { class: "seg", role: "group", "aria-label": t("talk.modeLabel") },
      h("button", { class: "seg-btn", type: "button", "aria-pressed": String(mode === "voice"), on: { click: () => { setMode("voice"); if (!live) render(new Set(["call"])); } } },
        icon("mic", 22), h("span", { text: t("talk.modeCall") })),
      h("button", { class: "seg-btn", type: "button", "aria-pressed": String(mode === "text"), "aria-disabled": text ? undefined : "true",
        on: { click: () => { if (!text) return; setMode("text"); requestAnimationFrame(() => input.focus()); } } },
      icon("keyboard", 22), h("span", { text: t("talk.modeType") }), text ? null : h("span", { class: "seg-soon", text: t("edge.soon") })));
    const parts = [seg];
    if (live) {
      if (mode === "voice") {
        parts.push(h("button", { class: "icon-btn icon-btn-lg mute-btn", type: "button", "aria-pressed": String(call.muted), "aria-label": call.muted ? t("talk.unmute") : t("talk.mute"), dataset: { tip: call.muted ? t("talk.unmute") : t("talk.mute") }, on: { click: () => setMuted(!call.muted) } },
          icon(call.muted ? "micOff" : "mic", 24)));
      }
      parts.push(h("button", { class: "btn btn-end btn-lg", type: "button", on: { click: () => endCall() } }, icon("phoneOff", 24), h("span", { text: t("talk.end") })));
    }
    fill(controls, ...parts);
  }

  function bubble(role, text, extra = {}) {
    return h("li", { class: `bubble bubble-${role}${extra.live ? " is-live" : ""}${extra.cut ? " is-cut" : ""}${extra.pinned ? " is-pinned" : ""}` },
      h("span", { class: "bubble-who" }, role === "agent" ? h("span", { class: "who-orb", "aria-hidden": "true" }) : icon(extra.typed ? "keyboard" : "user", 18), h("span", { text: role === "agent" ? t("talk.sahay") : t("talk.you") })),
      scripted("p", text, { class: "bubble-text" }),
      extra.cut ? h("span", { class: "bubble-flag", text: t("talk.interrupted") }) : null);
  }

  let showEarlier = false;

  function renderConvo() {
    const biz = (state.business && state.business.name) || "";
    const turns = call.transcript.filter((x) => x.role === "owner" || x.role === "agent");
    // The disclosure always leads: Sahay's first spoken line once a call has one (the server
    // speaks it first on every call), otherwise the same sentence written here.
    const first = turns.find((x) => x.role === "agent");
    const pinned = first ? first.text : t("talk.disclosure", { biz });
    const rest = turns.filter((x) => x !== first);
    const older = rest.slice(0, -3);
    const last = rest.slice(-3);
    if (!older.length) showEarlier = false;
    const shown = showEarlier ? rest : last;
    const key = JSON.stringify([document.documentElement.lang, pinned, showEarlier, older.length, shown.map((x) => [x.key, x.text, x.live, x.interrupted])]);
    convo.setAttribute("aria-label", t("talk.convo"));
    patch(convo, key, () => {
      const items = [bubble("agent", pinned, { pinned: true })];
      if (older.length) {
        items.push(h("li", { class: "convo-earlier" },
          h("button", {
            class: "btn btn-ghost btn-sm earlier-toggle", type: "button", "aria-expanded": String(showEarlier),
            on: { click: () => { showEarlier = !showEarlier; renderConvo(); requestAnimationFrame(() => { const b = convo.querySelector(".earlier-toggle"); if (b) b.focus({ preventScroll: true }); }); } },
          }, icon(showEarlier ? "chevronUp" : "history", 20), h("span", { text: showEarlier ? t("talk.earlierHide") : t("talk.earlier", { n: older.length }) }))));
      }
      for (const x of shown) items.push(bubble(x.role, x.text, { live: x.live, cut: x.interrupted, typed: x.via === "text" }));
      return items;
    });
    const showHint = !turns.length || hintKey;
    hint.hidden = !showHint;
    hint.textContent = t(hintKey || "talk.hint");
  }

  function renderType() {
    const text = textSupported();
    typeRow.hidden = !(text && call.mode === "text");
    typeLabel.textContent = t("talk.typeBox");
    input.placeholder = "";
    input.disabled = call.sending;
    sendBtn.disabled = call.sending;
    sendBtn.setAttribute("aria-label", t("talk.send"));
    sendBtn.dataset.tip = t("talk.send");
    fill(sendBtn, call.sending ? h("span", { class: "spinner", "aria-hidden": "true" }) : icon("send", 24));
    if (call.sendError) typeNote.textContent = t("talk.sendFail");
  }

  function render(parts) {
    const all = parts.has("all") || parts.has("lang");
    title.textContent = t("nav.talk");
    if (all || parts.has("call") || parts.has("work") || parts.has("approvals")) { renderOrb(); renderIssues(); renderControls(); renderType(); }
    if (all || parts.has("work") || parts.has("approvals") || parts.has("orders")) renderNow();
    if (all || parts.has("transcript") || parts.has("call") || parts.has("business")) renderConvo();
    el.dataset.mode = call.mode;
    el.dataset.live = String(inCall());
  }

  return { el, update: (_s, parts) => render(parts) };
}
