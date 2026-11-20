// The owner's live session with Sahay (voice or typed), wrapping VoiceCall from ../voice.js.
// Contract (plan, Track V): start({ mode = "voice" }), sendText(text), transcript turns with
// via: "text" for typed lines. Until Track V lands, text mode reports itself unavailable.

import { VoiceCall, preloadSdks } from "../voice.js";
import * as api from "../api.js";
import { state as store, touch } from "./store.js";

export const call = {
  status: "idle", // idle | mic | connecting | waiting | live | reconnecting | ending | error
  route: null, // "direct" | "proxy": proxy means Agora Cloud Proxy (TLS 443) on a restrictive network
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

// One VoiceCall per attempt. When a call is lost (network gone, a stage that never finishes),
// the app drops that object, shows "Call ended. Tap to call again." and makes a fresh one, so a
// stale call can never swallow the next tap. Events from a dropped object are ignored.
const STUCK_MS = { connecting: 30000, waiting: 45000, ending: 6000, reconnecting: 25000 };
const OFFLINE_GRACE_MS = 5000;
let gen = 0;
let vc = makeCall();
let stuckTimer = 0;
let offlineTimer = 0;
let serverStopOwed = false; // a dropped call may still be held by the server; stop it before the next one

function makeCall() {
  const my = ++gen;
  const mine = () => my === gen;
  return new VoiceCall({
    onStatus(status, detail = {}) {
      if (!mine()) return;
      call.status = status;
      if (status === "connecting") call.route = detail.route || null;
      else if (status === "idle" || status === "error") call.route = null;
      watch(status);
      if (status === "error") {
        call.error = detail.error || null;
        // A call that was connected and then failed is a dropped call: back to idle, coral line.
        if (call.error && ["dropped", "expired"].includes(call.error.code)) {
          call.status = "idle";
          call.ended = { reason: call.error.code };
          call.error = null;
        }
        call.agentState = null;
      }
      if (status === "idle") {
        call.agentState = null;
        call.ended = detail.unexpected ? { reason: detail.note || null } : null;
        call.muted = false;
      }
      if (status === "mic" || (status === "connecting" && call.mode === "text")) {
        call.ended = null; call.error = null; call.issues = []; call.transcript = []; call.sendError = null;
      }
      touch("call");
    },
    onAgentState(s) { if (!mine()) return; call.agentState = s; touch("call"); },
    onTranscript(turns) { if (!mine()) return; call.transcript = Array.isArray(turns) ? turns : []; touch("transcript"); },
    onLanguage() {},
    onIssue(issue) {
      if (!mine()) return;
      if (issue && issue.source === "network") { offlineSeen(); return; }
      const now = Date.now();
      if (call.issues.some((i) => i.message === issue.message && now - i.at < 1500)) return;
      call.issues = [{ ...issue, at: now }, ...call.issues].slice(0, 3);
      touch("call");
    },
    onLevels(lv) { if (!mine()) return; for (const fn of levelSubs) fn(lv); },
    onAutoplay(blocked) { if (!mine()) return; call.autoplay = blocked; touch("call"); },
    onMetric() {},
    onTranscriptLink() {},
    onTimings(marks) { if (mine()) window.__sahayCallTimings = marks; },
    onTextReply() { if (mine()) touch("transcript"); },
  });
}

/** A stage that never finishes (no network, a hung leave) drops the call instead of freezing the orb. */
function watch(status) {
  clearTimeout(stuckTimer);
  const ms = STUCK_MS[status];
  if (ms) stuckTimer = setTimeout(() => { if (call.status === status) dropCall("stuck"); }, ms);
}

function offlineSeen() {
  if (!(vc.active || busy())) return;
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(() => { if (!navigator.onLine && (vc.active || busy())) dropCall("offline"); }, OFFLINE_GRACE_MS);
}

/**
 * Drop the current call object without waiting on the network: release the microphone and leave
 * in the background (the old object can no longer reach the server), show the coral ended line,
 * and start the next call from a fresh object. The server's hold on the call is stopped first
 * thing on the next start (or by its own idle timeout).
 */
function dropCall(reason) {
  clearTimeout(stuckTimer);
  clearTimeout(offlineTimer);
  const old = vc;
  const wasHeld = old.serverStarted || old.session || ["waiting", "live", "reconnecting", "ending"].includes(call.status);
  vc = makeCall();
  try {
    old.status = "idle"; // its own handlers (connection change, user-left) now return early
    old.teardown({ stopServer: false }).catch(() => {});
  } catch { /* already gone */ }
  if (wasHeld) serverStopOwed = true;
  call.status = "idle";
  call.agentState = null;
  call.muted = false;
  call.error = null;
  call.autoplay = false;
  call.ended = { reason };
  for (const fn of levelSubs) fn({ mic: 0, agent: 0 });
  touch("call");
}

window.addEventListener("offline", offlineSeen);
window.addEventListener("online", () => clearTimeout(offlineTimer));

export const inCall = () => ["waiting", "live", "reconnecting"].includes(call.status);
export const busy = () => ["mic", "connecting", "ending"].includes(call.status);

export async function startCall(mode = "voice") {
  if (mode === "text" && !textSupported()) return;
  call.mode = mode;
  touch("call");
  // A tap while the old call is stuck ending, or after the network went, starts clean.
  if (call.status === "ending" || (vc.active && !navigator.onLine)) dropCall(navigator.onLine ? "stuck" : "offline");
  if (vc.active) {
    if (mode === "voice" && call.muted) await setMuted(false);
    return;
  }
  if (serverStopOwed) {
    serverStopOwed = false;
    try { await api.stopVoice(); } catch { /* the server's idle timeout ends it; start() reports what it must */ }
  }
  const mine = vc;
  try {
    await mine.start({ mode });
  } catch (err) {
    // start() reports through onStatus("error"); a throw here must not leave the orb busy.
    if (mine === vc && busy()) { call.status = "error"; call.error = err || null; touch("call"); }
  }
}

export async function endCall() {
  if (!vc.active) return;
  if (!navigator.onLine) { dropCall("offline"); return; }
  const mine = vc;
  await Promise.race([mine.end(), new Promise((r) => setTimeout(r, STUCK_MS.ending))]);
  if (mine === vc && mine.active) dropCall("stuck");
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
