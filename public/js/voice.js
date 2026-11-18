// Agora voice call for the owner leg. Flow and teardown order follow
// docs/build/re/agora-client.md (patterns adapted from AgoraIO-Conversational-AI
// agent-client-toolkit-ts apps/playground/src/App.tsx and agent-quickstart-nextjs, MIT).
// API names checked against the pinned bundles: AgoraRTC_N-4.24.3.js, agora-rtm@2.2.3,
// agora-agent-client-toolkit@2.10.0 dist/index.mjs.
//
// Script order in index.html: RTC UMD, then RTM UMD (its wrapper reads globalThis.AgoraRTC),
// then the app module. The toolkit is an ES module imported lazily from the CDN below; it has
// no static imports, and enableAgoraMetrics stays off so no bare-specifier import is triggered.

import * as api from "./api.js";

const TOOLKIT_URL = "https://cdn.jsdelivr.net/npm/agora-agent-client-toolkit@2.10.0/dist/index.mjs";
const AGENT_JOIN_TIMEOUT_MS = 20000;

const RTC_URL = "https://download.agora.io/sdk/release/AgoraRTC_N-4.24.3.js";
const RTM_URL = "https://cdn.jsdelivr.net/npm/agora-rtm@2.2.3/agora-rtm.js";

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => { el.remove(); reject(new Error(`failed to load ${src}`)); };
    document.head.appendChild(el);
  });
}

let sdkPromise = null;
/** Load RTC, then RTM (RTM's UMD wrapper reads globalThis.AgoraRTC). Safe to call repeatedly. */
export function preloadSdks() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      if (!window.AgoraRTC) await injectScript(RTC_URL);
      if (!window.AgoraRTM) await injectScript(RTM_URL);
      loadToolkit().catch(() => {}); // warm the module cache; start() reports failures
    })().catch((err) => { sdkPromise = null; throw err; });
  }
  return sdkPromise;
}

// The toolkit's dist/index.mjs reads process.env.NODE_ENV unguarded, so AgoraVoiceAI.init
// throws "process is not defined" in a browser (docs/build/evidence/s0-report.md, surprise 1).
// Same shim as the S0 spike; it must exist before the module is evaluated.
if (typeof globalThis.process === "undefined") {
  globalThis.process = { env: { NODE_ENV: "production" } };
}

let toolkitPromise = null;
function loadToolkit() {
  if (!toolkitPromise) {
    toolkitPromise = import(TOOLKIT_URL).catch((err) => {
      toolkitPromise = null;
      throw err;
    });
  }
  return toolkitPromise;
}

export class CallError extends Error {
  constructor(code, title, message, { retry = true } = {}) {
    super(message);
    this.code = code;
    this.title = title;
    this.retry = retry;
  }
}

function micError(err) {
  const code = (err && (err.code || err.name)) || "";
  if (code === "PERMISSION_DENIED" || code === "NotAllowedError") {
    return new CallError("mic_denied", "Microphone blocked",
      "Allow microphone access for this site from the lock icon in the address bar, then press Start call again.");
  }
  if (code === "NOT_READABLE" || code === "NotReadableError") {
    return new CallError("mic_busy", "Microphone is busy",
      "Another app is using the microphone. Close it, then press Start call again.");
  }
  if (code === "DEVICE_NOT_FOUND" || code === "NotFoundError") {
    return new CallError("mic_missing", "No microphone found",
      "Connect a microphone or headset, then press Start call again.");
  }
  if (code === "NOT_SUPPORTED") {
    return new CallError("mic_unsupported", "Browser not supported",
      "This browser cannot capture audio for calls. Use a current Chrome, Edge or Safari.", { retry: false });
  }
  return new CallError("mic_failed", "Microphone did not start",
    "The microphone could not be opened. Check your audio settings and try again.");
}

function langFromCode(code) {
  if (typeof code !== "string") return null;
  const c = code.toLowerCase();
  if (c.startsWith("hi")) return "hi";
  if (c.startsWith("kn")) return "kn";
  if (c.startsWith("en")) return "en";
  return null;
}

/** Script of a string: "hi" (Devanagari), "kn" (Kannada), "en" (Latin) or null. */
export function scriptOf(text) {
  if (typeof text !== "string" || !text) return null;
  let deva = 0, knda = 0, latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0900 && cp <= 0x097f) deva++;
    else if (cp >= 0x0c80 && cp <= 0x0cff) knda++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  if (deva === 0 && knda === 0 && latin === 0) return null;
  if (deva >= knda && deva >= latin) return "hi";
  if (knda >= latin) return "kn";
  return "en";
}

function toMs(t) {
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return null;
  return t < 1e12 ? t * 1000 : t;
}

/**
 * handlers: onStatus(status, detail), onAgentState(state), onTranscript(turns),
 * onLanguage({ lang, source }), onIssue({ source, message }), onLevels({ mic, agent }),
 * onAutoplay(blocked), onMetric({ stage, ms }), onTranscriptLink(ok)
 * status: idle | mic | connecting | waiting | live | reconnecting | ending | error
 */
export class VoiceCall {
  constructor(handlers) {
    this.h = handlers;
    this.status = "idle";
    this.reset();
    this._onPageHide = () => { if (this.active) api.stopVoiceOnUnload(); };
    this._onOffline = () => { if (this.active) this.h.onIssue({ source: "network", message: "This device went offline. The call will resume when the network is back." }); };
    window.addEventListener("pagehide", this._onPageHide);
    window.addEventListener("offline", this._onOffline);
  }

  reset() {
    this.rtc = null;
    this.rtm = null;
    this.ai = null;
    this.mic = null;
    this.session = null;
    this.agentUid = null;
    this.agentPresent = false;
    this.remoteTracks = new Map();
    this.interruptedTurns = new Set();
    this.levelTimer = null;
    this.agentTimer = null;
    this.renewing = null;
    this.muted = false;
    this.serverStarted = false;
  }

  get active() {
    return !["idle", "error"].includes(this.status);
  }

  setStatus(status, detail = {}) {
    this.status = status;
    this.h.onStatus(status, detail);
  }

  async start() {
    if (this.active) return;
    this.reset();
    try {
      if (!window.isSecureContext) {
        throw new CallError("insecure", "Secure connection needed",
          "Calls need HTTPS or localhost. Open the console from its https:// address.", { retry: false });
      }
      try { await preloadSdks(); } catch { /* reported just below */ }
      const { AgoraRTC, AgoraRTM } = window;
      if (!AgoraRTC || !AgoraRTM) {
        throw new CallError("sdk_missing", "Voice library did not load",
          "The Agora voice SDK could not be downloaded. Check the network and reload the page.");
      }
      let tk;
      try {
        tk = await loadToolkit();
      } catch {
        throw new CallError("toolkit_missing", "Voice library did not load",
          "The Agora agent toolkit could not be downloaded. Check the network and try again.");
      }

      // 1. Microphone first, from the click. If it fails, the agent is never started.
      this.setStatus("mic");
      try {
        this.mic = await AgoraRTC.createMicrophoneAudioTrack();
      } catch (err) {
        throw micError(err);
      }

      // 2. Server starts the owner agent and mints a short-lived RTC+RTM token.
      this.setStatus("connecting");
      let s;
      try {
        s = await api.startVoice();
      } catch (err) {
        throw new CallError("start_failed", "Could not start Sahay", err.message || "The server could not start the call.");
      }
      this.serverStarted = true;
      if (!s || !s.appId || !s.channel || s.uid === undefined || s.uid === null || !s.token) {
        throw new CallError("bad_session", "Could not start Sahay", "The server's call details were incomplete.");
      }
      this.session = s;
      this.agentUid = s.agentUid !== undefined && s.agentUid !== null ? String(s.agentUid) : null;
      const uid = String(s.uid);

      // 3. Clients and handlers before join so nothing is missed.
      AgoraRTC.onAutoplayFailed = () => this.h.onAutoplay(true);
      const rtc = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      this.rtc = rtc;
      this.bindRtc(rtc);
      const rtm = new AgoraRTM.RTM(s.appId, uid);
      this.rtm = rtm;
      rtm.addEventListener("linkState", (e) => {
        if (!this.active) return;
        const st = e && e.currentState;
        if (st === "CONNECTED") this.h.onTranscriptLink(true);
        else if (st === "DISCONNECTED" || st === "SUSPENDED" || st === "FAILED") this.h.onTranscriptLink(false);
      });

      const joinUid = /^\d+$/.test(uid) ? Number(uid) : uid;
      await Promise.all([
        rtc.join(s.appId, s.channel, s.token, joinUid),
        rtm.login({ token: s.token }),
      ]);
      await rtc.publish([this.mic]);
      await rtm.subscribe(s.channel, { withMessage: true, withPresence: true });

      // 4. Toolkit: transcripts from RTM messages, agent state from RTM presence.
      const { AgoraVoiceAI, AgoraVoiceAIEvents: E, TranscriptHelperMode } = tk;
      const ai = await AgoraVoiceAI.init({ rtcEngine: rtc, rtmEngine: rtm, renderMode: TranscriptHelperMode.TEXT });
      this.ai = ai;
      ai.on(E.TRANSCRIPT_UPDATED, (items) => this.onTranscript(items));
      ai.on(E.AGENT_STATE_CHANGED, (_uid, ev) => {
        if (ev && typeof ev.state === "string") this.h.onAgentState(ev.state);
      });
      ai.on(E.AGENT_INTERRUPTED, (_uid, ev) => {
        if (ev && ev.turnID !== undefined) this.interruptedTurns.add(String(ev.turnID));
      });
      ai.on(E.AGENT_ERROR, (_uid, ev) => {
        this.h.onIssue({ source: ev && ev.type ? String(ev.type) : "agent", message: (ev && ev.message) || "The agent reported an error." });
      });
      ai.on(E.MESSAGE_ERROR, (_uid, ev) => {
        this.h.onIssue({ source: "message", message: (ev && ev.message) || "A message to the agent failed." });
      });
      ai.on(E.AGENT_METRICS, (_uid, m) => {
        if (m && typeof m.value === "number") this.h.onMetric({ stage: String(m.type || m.name || ""), ms: m.value });
      });
      ai.on(E.AGENT_TURN_FINISHED, (_uid, m) => {
        if (m && typeof m.e2eLatencyMs === "number") this.h.onMetric({ stage: "turn", ms: m.e2eLatencyMs });
      });
      ai.subscribeMessage(s.channel);

      this.levelTimer = setInterval(() => this.pollLevels(), 100);

      if (this.findAgent()) this.setStatus("live");
      else {
        this.setStatus("waiting");
        this.agentTimer = setTimeout(() => {
          if (this.status === "waiting") {
            this.h.onIssue({ source: "agent", message: "Sahay has not joined the call yet. You can keep waiting or end the call and try again." });
          }
        }, AGENT_JOIN_TIMEOUT_MS);
      }
    } catch (err) {
      const e = err instanceof CallError ? err
        : new CallError("join_failed", "Call could not connect", (err && err.message) ? `Agora said: ${err.message}` : "The call could not connect.");
      await this.teardown({ stopServer: this.serverStarted });
      this.setStatus("error", { error: e });
    }
  }

  isAgent(uid) {
    const u = String(uid);
    if (this.agentUid) return u === this.agentUid;
    // Without an agent uid from the server, the only other participant is the agent.
    return this.session ? u !== String(this.session.uid) : false;
  }

  findAgent() {
    if (!this.rtc) return false;
    const found = this.rtc.remoteUsers.some((u) => this.isAgent(u.uid));
    this.agentPresent = found;
    return found;
  }

  bindRtc(rtc) {
    rtc.on("user-joined", (user) => {
      if (!this.isAgent(user.uid)) return;
      this.agentPresent = true;
      clearTimeout(this.agentTimer);
      if (this.status === "waiting") this.setStatus("live");
    });
    rtc.on("user-left", (user) => {
      if (!this.isAgent(user.uid) || !this.active || this.status === "ending") return;
      this.agentPresent = false;
      this.end({ note: "Sahay left the call." });
    });
    rtc.on("user-published", async (user, mediaType) => {
      if (mediaType !== "audio") return;
      try {
        await rtc.subscribe(user, mediaType);
        if (user.audioTrack) {
          this.remoteTracks.set(String(user.uid), user.audioTrack);
          user.audioTrack.play();
        }
      } catch (err) {
        this.h.onIssue({ source: "audio", message: "Could not play Sahay's voice. " + ((err && err.message) || "") });
      }
    });
    rtc.on("user-unpublished", (user, mediaType) => {
      if (mediaType === "audio") this.remoteTracks.delete(String(user.uid));
    });
    rtc.on("connection-state-change", (cur, _prev, reason) => {
      if (this.status === "ending" || this.status === "idle") return;
      if (cur === "RECONNECTING") {
        this.setStatus("reconnecting");
      } else if (cur === "CONNECTED" && this.status === "reconnecting") {
        this.setStatus(this.findAgent() ? "live" : "waiting");
      } else if (cur === "DISCONNECTED" && reason !== "LEAVE") {
        const why = typeof reason === "string" && reason ? reason.toLowerCase().replace(/_/g, " ") : "network error";
        this.failMidCall(new CallError("dropped", "Call disconnected", `The connection to Agora was lost (${why}). Start the call again when the network is back.`));
      }
    });
    rtc.on("token-privilege-will-expire", () => { this.renewToken(); });
    rtc.on("token-privilege-did-expire", () => { this.rejoinAfterExpiry(); });
  }

  async renewToken() {
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      try {
        const r = await api.renewVoiceToken();
        if (!r || !r.token) throw new Error("no token");
        await Promise.all([this.rtc.renewToken(r.token), this.rtm.renewToken(r.token)]);
        return r.token;
      } catch {
        this.h.onIssue({ source: "token", message: "Could not renew the call token. The call will stop when the current token expires." });
        return null;
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  async rejoinAfterExpiry() {
    if (!this.active || !this.session) return;
    this.setStatus("reconnecting");
    try {
      const r = await api.renewVoiceToken();
      if (!r || !r.token) throw new Error("no token");
      const s = this.session;
      const uid = String(s.uid);
      await this.rtc.leave();
      await this.rtc.join(s.appId, s.channel, r.token, /^\d+$/.test(uid) ? Number(uid) : uid);
      await this.rtc.publish([this.mic]);
      await this.rtm.renewToken(r.token);
      this.setStatus(this.findAgent() ? "live" : "waiting");
    } catch {
      this.failMidCall(new CallError("expired", "Call session expired", "The call token expired and could not be renewed. Start a new call."));
    }
  }

  async failMidCall(error) {
    if (this.status === "error" || this.status === "idle") return;
    this.status = "ending";
    await this.teardown({ stopServer: true });
    this.setStatus("error", { error });
  }

  onTranscript(items) {
    if (!Array.isArray(items)) return;
    const turns = items.map((it) => {
      const md = it.metadata || {};
      const owner = String(it.uid) === "0";
      const turnId = it.turn_id !== undefined ? String(it.turn_id) : "";
      // TEXT mode sets status to END on every message, so liveness comes from metadata.
      const live = owner ? md.final === false : md.turn_status === 0;
      const interrupted = !owner && (md.turn_status === 2 || this.interruptedTurns.has(turnId));
      return {
        key: `${turnId}:${it.stream_id ?? ""}:${it.uid}`,
        role: owner ? "owner" : "agent",
        text: typeof it.text === "string" ? it.text : "",
        live: Boolean(live),
        interrupted,
        time: toMs(it._time),
        language: langFromCode(md.language),
      };
    }).filter((t) => t.text.trim() !== "");
    this.h.onTranscript(turns);

    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.role !== "owner") continue;
      if (t.language) { this.h.onLanguage({ lang: t.language, source: "asr" }); break; }
      const sc = scriptOf(t.text);
      if (sc) { this.h.onLanguage({ lang: sc, source: "script" }); break; }
    }
  }

  pollLevels() {
    let mic = 0, agent = 0;
    try { if (this.mic && !this.muted) mic = this.mic.getVolumeLevel() || 0; } catch { /* track closed */ }
    for (const t of this.remoteTracks.values()) {
      try { agent = Math.max(agent, t.getVolumeLevel() || 0); } catch { /* track gone */ }
    }
    this.h.onLevels({ mic, agent });
  }

  async setMuted(muted) {
    if (!this.mic) return this.muted;
    try {
      await this.mic.setEnabled(!muted);
      this.muted = muted;
    } catch {
      this.h.onIssue({ source: "mic", message: muted ? "Could not mute the microphone." : "Could not unmute the microphone." });
    }
    return this.muted;
  }

  resumeAudio() {
    for (const t of this.remoteTracks.values()) {
      try { t.play(); } catch { /* ignore */ }
    }
    this.h.onAutoplay(false);
  }

  async end({ note } = {}) {
    if (!this.active || this.status === "ending") return;
    this.setStatus("ending");
    await this.teardown({ stopServer: true });
    this.setStatus("idle", { note: note || "Call ended." });
  }

  // Order from TK App.tsx:1085-1133: release the mic first so it frees even if the
  // network stalls, then unsubscribe, destroy the toolkit, and leave/logout settled.
  async teardown({ stopServer }) {
    clearInterval(this.levelTimer);
    clearTimeout(this.agentTimer);
    this.h.onLevels({ mic: 0, agent: 0 });
    this.h.onAutoplay(false);
    const { rtc, rtm, ai, mic, session } = this;
    try { if (mic) { mic.stop(); mic.close(); } } catch { /* ignore */ }
    try { if (rtc && mic) await rtc.unpublish([mic]); } catch { /* ignore */ }
    for (const t of this.remoteTracks.values()) { try { t.stop(); } catch { /* ignore */ } }
    try { if (rtm && session) await rtm.unsubscribe(session.channel); } catch { /* ignore */ }
    if (ai) {
      try {
        ai.unsubscribe();
        const tk = await loadToolkit();
        if (tk.AgoraVoiceAI.getInstance() === ai) ai.destroy();
      } catch { /* ignore */ }
    }
    await Promise.allSettled([
      rtc ? rtc.leave() : null,
      rtm ? rtm.logout() : null,
      stopServer ? api.stopVoice() : null,
    ]);
    if (window.AgoraRTC) window.AgoraRTC.onAutoplayFailed = undefined;
    this.reset();
  }
}
