// The owner's live session with Sahay (voice or typed), wrapping VoiceCall from ../voice.js.
// Contract (plan, Track V): start({ mode = "voice" }), sendText(text), transcript turns with
// via: "text" for typed lines. Until Track V lands, text mode reports itself unavailable.

import { VoiceCall, preloadSdks } from "../voice.js";
import * as api from "../api.js";
import { state as store, touch } from "./store.js";

export const call = {
  status: "idle", // idle | mic | connecting | waiting | live | reconnecting | ending | error
  agentState: null,
  muted: false,
  mode: "voice",
  error: null,
  ended: null,
  autoplay: false,
  transcript: [],
  issues: [],
  sending: false,
  sendError: null,
  endingOther: false,
};

const levelSubs = new Set();
/** Mic and agent levels (0..1), ~10/s while a call is live; kept out of the store on purpose. */
export function onLevels(fn) { levelSubs.add(fn); return () => levelSubs.delete(fn); }

export const textSupported = () => typeof VoiceCall.prototype.sendText === "function";

const vc = new VoiceCall({
  onStatus(status, detail = {}) {
    call.status = status;
    if (status === "error") call.error = detail.error || null;
    if (status === "idle") {
      call.agentState = null;
      call.ended = detail.unexpected ? { reason: detail.note || null } : null;
      call.muted = false;
    }
    if (status === "mic") { call.ended = null; call.error = null; call.issues = []; call.transcript = []; call.sendError = null; }
    touch("call");
  },
  onAgentState(s) { call.agentState = s; touch("call"); },
  onTranscript(turns) { call.transcript = Array.isArray(turns) ? turns : []; touch("transcript"); },
  onLanguage() {},
  onIssue(issue) {
    const now = Date.now();
    if (call.issues.some((i) => i.message === issue.message && now - i.at < 1500)) return;
    call.issues = [{ ...issue, at: now }, ...call.issues].slice(0, 3);
    touch("call");
  },
  onLevels(lv) { for (const fn of levelSubs) fn(lv); },
  onAutoplay(blocked) { call.autoplay = blocked; touch("call"); },
  onMetric() {},
  onTranscriptLink() {},
  onTimings(marks) { window.__sahayCallTimings = marks; },
  onTextReply() { touch("transcript"); },
});

export const inCall = () => ["waiting", "live", "reconnecting"].includes(call.status);
export const busy = () => ["mic", "connecting", "ending"].includes(call.status);

export async function startCall(mode = "voice") {
  if (mode === "text" && !textSupported()) return;
  call.mode = mode;
  touch("call");
  if (vc.active) {
    if (mode === "voice" && call.muted) await setMuted(false);
    return;
  }
  // start() takes { mode } once Track V lands; older builds ignore the argument.
  await vc.start({ mode });
}

export async function endCall() {
  if (vc.active) await vc.end();
}

export async function setMuted(m) {
  call.muted = await vc.setMuted(m);
  touch("call");
}

export function setMode(mode) {
  if (mode === "text" && !textSupported()) return;
  call.mode = mode;
  touch("call");
  if (inCall()) setMuted(mode === "text");
}

export async function sendText(text) {
  const msg = String(text || "").trim();
  if (!msg || !textSupported()) return false;
  call.sending = true;
  call.sendError = null;
  touch("call");
  try {
    if (!inCall()) await startCall("text");
    if (!inCall()) throw new Error("NOT_CONNECTED");
    await vc.sendText(msg);
    return true;
  } catch (err) {
    call.sendError = err;
    return false;
  } finally {
    call.sending = false;
    touch("call");
  }
}

export function resumeAudio() { vc.resumeAudio(); }

/** The server still holds a call (another tab, or an earlier one): end it from here. */
export async function endServerCall() {
  call.endingOther = true;
  touch("call");
  try {
    await api.stopVoice();
    store.voiceServer = null;
  } catch { /* the banner stays; the owner can retry */ }
  call.endingOther = false;
  touch("call");
}

/** The server ended this tab's call (another tab, time limit): reflect it here. */
export function serverEnded(channel, reason) { vc.endedByServer(channel, reason); }

export function preload() {
  requestAnimationFrame(() => setTimeout(() => preloadSdks().catch(() => {}), 0));
}
