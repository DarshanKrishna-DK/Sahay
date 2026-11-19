// Agora voice call for the owner leg. Flow and teardown order follow
// docs/build/re/agora-client.md (patterns adapted from AgoraIO-Conversational-AI
// agent-client-toolkit-ts apps/playground/src/App.tsx and agent-quickstart-nextjs, MIT).
// API names checked against the pinned bundles: AgoraRTC_N-4.24.3.js, agora-rtm@2.2.3,
// agora-agent-client-toolkit@2.10.0 dist/index.mjs.
//
// Load order: RTC UMD, then RTM UMD (its wrapper reads globalThis.AgoraRTC), both injected
// below with Subresource Integrity. They download in parallel and run in insertion order
// (async=false). The toolkit is an ES module imported from the CDN below, fetched at the same
// time; its hash is pinned in the import map in index.html. It has no static imports, and
// enableAgoraMetrics stays off so no bare-specifier import is triggered. Every URL here must
// also be listed in the server's Content-Security-Policy (server.js CDN_SCRIPTS).

import * as api from "./api.js";

const TOOLKIT_URL = "https://cdn.jsdelivr.net/npm/agora-agent-client-toolkit@2.10.0/dist/index.mjs";
const AGENT_JOIN_TIMEOUT_MS = 20000;

// RTC from jsDelivr: byte-identical to download.agora.io/sdk/release/AgoraRTC_N-4.24.3.js, which
// sends no CORS header and so cannot be integrity-checked. Hashes: sha384 of the exact files.
const RTC_SDK = {
  src: "https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.3/AgoraRTC_N-production.js",
  integrity: "sha384-nw2NeZrSeNHx9ARgmXyDt/wyJfls4Wyt8YHR+4Rts9Fpqjucz+B+Qf5kxkxfXCJm",
};
const RTM_SDK = {
  src: "https://cdn.jsdelivr.net/npm/agora-rtm@2.2.3/agora-rtm.js",
  integrity: "sha384-XRsjslUkF99Q7yPB3/0D6CkP9sm+fb53Zbkb/Qmn2FRKBzANHJygt1okh1/MK63i",
};

function injectScript({ src, integrity }) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.integrity = integrity;
    el.crossOrigin = "anonymous";
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => { el.remove(); reject(new Error(`failed to load ${src}`)); };
    document.head.appendChild(el);
  });
}

let sdkPromise = null;
/**
 * Fetch RTC, RTM and the toolkit at once (E2E r3: they were fetched one after another, so a
 * click soon after page load waited for all three in turn). Both script elements are inserted
 * together with async=false, so they download in parallel and still run in insertion order:
 * RTM's UMD wrapper reads globalThis.AgoraRTC. Safe to call repeatedly.
 */
export function preloadSdks() {
  if (!sdkPromise) {
    loadToolkit().catch(() => {}); // start() reports a toolkit failure
    sdkPromise = Promise.all([
      window.AgoraRTC ? null : injectScript(RTC_SDK),
      window.AgoraRTM ? null : injectScript(RTM_SDK),
    ]).then(() => undefined, (err) => { sdkPromise = null; throw err; });
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
 * Transcript turns in the order they were spoken. The toolkit's list is not reliably in that
 * order (server /speak lines and model replies can land out of sequence), so: by turn id when
 * every turn has one (the disclosure, spoken first by the server, has the lowest), else by
 * time; within one turn id the owner's words come before Sahay's reply; then by time; and
 * finally the toolkit's own order. A total order, so the panel never reshuffles between updates.
 * Each turn: { role: "owner"|"agent", turnNo: number|null, time: ms|null }.
 */
export function orderTurns(turns) {
  const byTurn = turns.length > 0 && turns.every((t) => Number.isFinite(t.turnNo));
  const time = (t) => (Number.isFinite(t.time) ? t.time : Infinity);
  return turns
    .map((turn, index) => ({ turn, index }))
    .sort((a, b) => {
      if (byTurn && a.turn.turnNo !== b.turn.turnNo) return a.turn.turnNo - b.turn.turnNo;
      if (!byTurn && time(a.turn) !== time(b.turn)) return time(a.turn) < time(b.turn) ? -1 : 1;
      if (a.turn.role !== b.turn.role) return a.turn.role === "owner" ? -1 : 1;
      if (time(a.turn) !== time(b.turn)) return time(a.turn) < time(b.turn) ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ turn }) => turn);
}

/**
 * System lines (a follow-up that fired, for example) placed among the spoken turns by time:
 * each goes before the first turn spoken after it; turns without a time keep their place and
 * lines with no later turn go last. Turns keep their own order (orderTurns).
 * A line: { key, role: "system", time: ms, ... }.
 */
export function withSystemLines(turns, lines) {
  if (!lines || !lines.length) return turns;
  const pending = [...lines].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  const out = [];
  for (const turn of turns) {
    while (pending.length && Number.isFinite(turn.time) && (pending[0].time ?? Infinity) < turn.time) out.push(pending.shift());
    out.push(turn);
  }
  return out.concat(pending);
}

/** Stages of a call start, in order, for the timing line (E2E r3 bug 8). */
export const START_STAGES = ["sdk", "mic", "token", "joined", "subscribed", "toolkit", "start_sent", "start_done", "published", "agent_joined", "first_words"];

/** "sdk=12 mic=340 ..." from marks {stage: ms since click}; stages not reached are left out. */
export function formatTimings(marks) {
  return START_STAGES.filter((k) => Number.isFinite(marks[k])).map((k) => `${k}=${Math.round(marks[k])}`).join(" ");
}

/** Same words, ignoring spacing and Unicode normal form (a typed message and its echo). */
function sameWords(a, b) {
  const norm = (s) => String(s).normalize("NFC").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

const TEXT_MAX_CHARS = 1000;
const CONNECTED = ["live", "waiting", "reconnecting"];

/**
 * handlers: onStatus(status, detail), onAgentState(state), onTranscript(turns),
 * onLanguage({ lang, source }), onIssue({ source, message }), onLevels({ mic, agent }),
 * onAutoplay(blocked), onMetric({ stage, ms }), onTranscriptLink(ok), onTimings(marks),
 * optional onTextReply(turn): the first finished Sahay turn after a typed message.
 * status: idle | mic | connecting | waiting | live | reconnecting | ending | error
 * Transcript turn: { key, role: "owner"|"agent", via?: "voice"|"text" (owner only), turnNo,
 * text, live, interrupted, time, language }.
 */
export class VoiceCall {
  constructor(handlers) {
    this.h = handlers;
    this.status = "idle";
    this.mode = "voice";
    this.textSeq = 0;
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
    this.serverStarting = false;
    this.startedAt = null;
    this.marks = {};
    this.tk = null;
    this.items = [];          // the toolkit's latest full transcript (TRANSCRIPT_UPDATED replaces it)
    this.typed = [];          // the owner's typed messages: { key, text, time }
    this.agentSpoke = false;  // Sahay's first sentence (the disclosure) has reached the transcript
    this.spokeWaiters = [];
    this.replyAfter = null;   // time of the last typed message still waiting for onTextReply
    this.openingMic = null;
  }

  /** Milliseconds since Start call for one stage; reported once the first words arrive. */
  mark(stage) {
    if (this.startedAt === null || Number.isFinite(this.marks[stage])) return;
    this.marks[stage] = performance.now() - this.startedAt;
    if (stage === "first_words" && this.h.onTimings) this.h.onTimings({ ...this.marks });
  }

  get active() {
    return !["idle", "error"].includes(this.status);
  }

  setStatus(status, detail = {}) {
    this.status = status;
    this.h.onStatus(status, detail);
  }

  /**
   * mode "voice": the microphone opens from the click and is published. mode "text": no
   * microphone is opened or published (no permission prompt); the owner types with sendText
   * and still hears Sahay. setMuted(false) later opens and publishes the microphone.
   */
  async start({ mode = "voice" } = {}) {
    if (this.active || this.preparing) return;
    this.reset();
    this.mode = mode === "text" ? "text" : "voice";
    this.muted = this.mode === "text";
    this.startedAt = performance.now();
    this.preparing = true; // a second click while the SDKs finish loading starts nothing
    try {
      if (!window.isSecureContext) {
        throw new CallError("insecure", "Secure connection needed",
          "Calls need HTTPS or localhost. Open the console from its https:// address.", { retry: false });
      }
      try { await preloadSdks(); } catch { /* reported just below */ } finally { this.preparing = false; }
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
      this.mark("sdk");

      // 1. Microphone, from the click. Step one of the server contract (a short-lived RTC+RTM
      //    token for this business's call channel) is fetched meanwhile; from the moment it
      //    answers the server holds a call entry, so teardown must stop it. The agent itself is
      //    started only in step 5, so a microphone failure never starts it. Text mode skips it.
      if (this.mode === "voice") this.setStatus("mic");
      const tokenRequest = api.getVoiceToken().then(
        (session) => { this.serverStarted = true; return session; },
        (err) => { throw new CallError("token_failed", "Could not start the call", (err && err.message) || "The server could not prepare the call."); },
      );
      tokenRequest.catch(() => {}); // awaited below; a mic failure must not leave it unhandled
      if (this.mode === "voice") {
        try {
          this.mic = await AgoraRTC.createMicrophoneAudioTrack();
        } catch (err) {
          await tokenRequest.catch(() => {}); // settle it, so teardown knows whether to stop the server entry
          throw micError(err);
        }
        this.mark("mic");
      }

      // 2. The token.
      this.setStatus("connecting");
      const s = await tokenRequest;
      this.mark("token");
      if (!s || !s.appId || !s.channel || s.uid === undefined || s.uid === null || !s.token || s.agentUid === undefined || s.agentUid === null) {
        throw new CallError("bad_session", "Could not start the call", "The server's call details were incomplete.");
      }
      this.session = s;
      this.agentUid = String(s.agentUid);
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

      // RTC join and RTM login+subscribe run side by side; the transcript needs only RTM.
      const joinUid = /^\d+$/.test(uid) ? Number(uid) : uid;
      await Promise.all([
        rtc.join(s.appId, s.channel, s.token, joinUid).then(() => this.mark("joined")),
        rtm.login({ token: s.token }).then(() => rtm.subscribe(s.channel, { withMessage: true, withPresence: true })).then(() => this.mark("subscribed")),
      ]);
      // Publishing the microphone overlaps the agent's start (step 5): Sahay speaks first, and it
      // subscribes to the owner's audio whenever that is published. Never rejects; checked below.
      // Text mode publishes nothing.
      const published = !this.mic ? Promise.resolve(null)
        : rtc.publish([this.mic]).then(() => { this.mark("published"); return null; }, (err) => err || new Error("publish failed"));

      // 4. Toolkit: transcripts from RTM messages, agent state from RTM presence; typed
      //    messages go out through it (sendText needs the rtmEngine given here).
      const { AgoraVoiceAI, AgoraVoiceAIEvents: E, TranscriptHelperMode } = tk;
      const ai = await AgoraVoiceAI.init({ rtcEngine: rtc, rtmEngine: rtm, renderMode: TranscriptHelperMode.TEXT });
      this.ai = ai;
      this.tk = tk;
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
      this.mark("toolkit");

      this.levelTimer = setInterval(() => this.pollLevels(), 100);

      // 5. Step two: only now that we are subscribed does the server bring the agent in, so
      //    its first sentence (the automated-assistant disclosure) reaches the transcript.
      if (!this.findAgent()) this.setStatus("waiting");
      this.serverStarting = true;
      this.mark("start_sent");
      try {
        await api.startVoice(s.channel);
        this.mark("start_done");
      } catch (err) {
        // ALREADY_STARTED: the agent is already in this same channel (for example after a
        // reload within the call); keep the call and wait for it.
        if (!(err && err.code === "ALREADY_STARTED")) {
          throw new CallError("start_failed", "Sahay could not join", err.message || "The server could not start the assistant.");
        }
      } finally {
        this.serverStarting = false;
      }
      if (this.status === "ending" || !this.active) return;
      const publishError = await published;
      if (publishError) throw publishError;
      if (this.status === "ending" || !this.active) return;

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
      // The owner pressed End while we were still connecting: that path already tore down.
      if (this.status === "idle" || this.status === "ending") return;
      const e = err instanceof CallError ? err
        : new CallError("join_failed", "Call could not connect", (err && err.message) ? `Agora said: ${err.message}` : "The call could not connect.");
      await this.teardown({ stopServer: this.serverStarted });
      this.setStatus("error", { error: e });
    }
  }

  isAgent(uid) {
    return this.agentUid !== null && String(uid) === this.agentUid;
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
      this.mark("agent_joined");
      this.agentPresent = true;
      clearTimeout(this.agentTimer);
      if (this.status === "waiting") this.setStatus("live");
    });
    rtc.on("user-left", (user) => {
      if (!this.isAgent(user.uid) || !this.active || this.status === "ending") return;
      this.agentPresent = false;
      this.end({ note: "Sahay left the call.", unexpected: true });
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
        this.failMidCall(new CallError("dropped", "The call ended", `The connection to Agora was lost (${why}). Start a new call to continue.`));
      }
    });
    rtc.on("token-privilege-will-expire", () => { this.renewToken(); });
    rtc.on("token-privilege-did-expire", () => { this.rejoinAfterExpiry(); });
  }

  async renewToken() {
    if (this.renewing) return this.renewing;
    this.renewing = (async () => {
      try {
        const r = await this.freshToken();
        await Promise.all([this.rtc.renewToken(r.token), this.rtm.renewToken(r.token)]);
        return r.token;
      } catch (err) {
        if (err && err.code === "CALL_ENDED") {
          // The server no longer holds this call; nothing said from here would reach Sahay.
          this.end({ note: "The call was closed on the server.", unexpected: true });
        } else {
          this.h.onIssue({ source: "token", message: "Could not renew the call token. The call will stop when the current token expires." });
        }
        return null;
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  /** Renewal: POST /api/voice/token { channel }; it must still be this call's channel and uid. */
  async freshToken() {
    const s = this.session;
    if (!s) throw new Error("No call to renew.");
    const r = await api.renewVoiceToken(s.channel);
    if (!r || !r.token || !s || r.channel !== s.channel || String(r.uid) !== String(s.uid)) {
      throw new Error("The server answered for a different call.");
    }
    return r;
  }

  async rejoinAfterExpiry() {
    if (!this.active || !this.session) return;
    this.setStatus("reconnecting");
    try {
      const r = await this.freshToken();
      const s = this.session;
      const uid = String(s.uid);
      await this.rtc.leave();
      await this.rtc.join(s.appId, s.channel, r.token, /^\d+$/.test(uid) ? Number(uid) : uid);
      if (this.mic) await this.rtc.publish([this.mic]); // text mode without a microphone: nothing
      await this.rtm.renewToken(r.token);
      this.setStatus(this.findAgent() ? "live" : "waiting");
    } catch {
      this.failMidCall(new CallError("expired", "The call ended", "The call token expired and could not be renewed. Start a new call to continue."));
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
    this.items = items;
    this.emitTranscript();
  }

  /**
   * The toolkit's turns plus the owner's typed messages. A typed message is shown from the
   * moment it is sent; if the agent echoes it back as a user transcription (an owner turn with
   * the same words that arrived after it was sent), that turn takes its place, marked via text.
   */
  emitTranscript() {
    const spoken = orderTurns(this.items.map((it) => {
      const md = it.metadata || {};
      const owner = String(it.uid) === "0";
      const turnId = it.turn_id !== undefined ? String(it.turn_id) : "";
      const turnNo = turnId !== "" && Number.isFinite(Number(turnId)) ? Number(turnId) : null;
      // TEXT mode sets status to END on every message, so liveness comes from metadata.
      const live = owner ? md.final === false : md.turn_status === 0;
      const interrupted = !owner && (md.turn_status === 2 || this.interruptedTurns.has(turnId));
      return {
        key: `${turnId}:${it.stream_id ?? ""}:${it.uid}`,
        role: owner ? "owner" : "agent",
        ...(owner ? { via: "voice" } : {}),
        turnNo,
        text: typeof it.text === "string" ? it.text : "",
        live: Boolean(live),
        interrupted,
        time: toMs(it._time),
        language: langFromCode(md.language),
      };
    }).filter((t) => t.text.trim() !== ""));

    const shown = [];
    const echoes = new Set();
    for (const typed of this.typed) {
      const echo = spoken.find((t) => t.role === "owner" && !echoes.has(t) && Number.isFinite(t.time) && t.time >= typed.time && sameWords(t.text, typed.text));
      if (echo) { echoes.add(echo); echo.via = "text"; continue; }
      shown.push({ key: typed.key, role: "owner", via: "text", turnNo: null, text: typed.text, live: false, interrupted: false, time: typed.time, language: null });
    }
    const turns = withSystemLines(spoken, shown);

    if (spoken.some((t) => t.role === "agent")) {
      this.mark("first_words");
      if (!this.agentSpoke) {
        this.agentSpoke = true;
        for (const w of this.spokeWaiters.splice(0)) w.resolve();
      }
    }
    this.h.onTranscript(turns);

    if (this.replyAfter !== null) {
      const { time, turnNo } = this.replyAfter;
      const reply = spoken.find((t) => t.role === "agent" && !t.live && !t.interrupted
        && Number.isFinite(t.time) && t.time >= time
        && !(Number.isFinite(turnNo) && Number.isFinite(t.turnNo) && t.turnNo <= turnNo));
      if (reply) {
        this.replyAfter = null;
        if (this.h.onTextReply) this.h.onTextReply(reply);
      }
    }

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

  /**
   * Send the owner's typed message to Sahay over the live session (RTM peer message through
   * the toolkit's sendText; shape in docs/build/agora-findings.md, "Typed owner message").
   * It shows in the transcript at once as { role: "owner", via: "text" }. Until Sahay's first
   * sentence (the automated-assistant disclosure) has arrived, the message is held so it can
   * never cut that sentence off. Resolves once RTM accepted it (not when Sahay answered).
   * A typed "yes" is never an approval: the server counts only spoken (asr) turns.
   */
  async sendText(text) {
    if (!this.ai || !this.agentUid || !CONNECTED.includes(this.status)) {
      throw new CallError("NOT_CONNECTED", "Not connected", "Sahay is not on a call. Start a call, then type again.");
    }
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) throw new CallError("EMPTY_TEXT", "Nothing to send", "Type a message first.");
    if (body.length > TEXT_MAX_CHARS) {
      throw new CallError("TEXT_TOO_LONG", "Message too long", `Keep a message under ${TEXT_MAX_CHARS} characters.`);
    }
    const typed = { key: `text:${++this.textSeq}`, text: body, time: Date.now() };
    const { ai, agentUid, tk } = this;
    this.typed.push(typed);
    this.emitTranscript();
    const unsend = () => {
      const i = this.typed.indexOf(typed);
      if (i >= 0) { this.typed.splice(i, 1); this.emitTranscript(); }
    };
    if (!this.agentSpoke) {
      try {
        await new Promise((resolve, reject) => this.spokeWaiters.push({ resolve, reject }));
      } catch (err) {
        unsend();
        throw err;
      }
      typed.time = Date.now(); // Sahay hears it now, after its first sentence; show it there
      this.emitTranscript();
    }
    if (this.ai !== ai || !CONNECTED.includes(this.status)) {
      unsend();
      throw new CallError("NOT_CONNECTED", "Not connected", "The call ended before the message was sent.");
    }
    const lastAgentTurn = Math.max(-Infinity, ...this.items.filter((it) => String(it.uid) !== "0").map((it) => Number(it.turn_id)).filter(Number.isFinite));
    this.replyAfter = { time: typed.time, turnNo: Number.isFinite(lastAgentTurn) ? lastAgentTurn : null };
    try {
      await ai.sendText(agentUid, {
        messageType: tk.ChatMessageType.TEXT,
        text: body,
        priority: tk.ChatMessagePriority.INTERRUPTED,
        responseInterruptable: true,
      });
    } catch (err) {
      this.replyAfter = null;
      unsend();
      throw new CallError("SEND_FAILED", "Message not sent",
        `The message did not reach Sahay${err && err.message ? ` (${err.message})` : ""}. Try again.`);
    }
  }

  openMic() {
    if (this.openingMic) return this.openingMic;
    const rtc = this.rtc;
    this.openingMic = (async () => {
      let track;
      try {
        track = await window.AgoraRTC.createMicrophoneAudioTrack();
      } catch (err) {
        this.h.onIssue({ source: "mic", message: micError(err).message });
        return this.muted;
      }
      try {
        if (this.rtc !== rtc || !this.active) throw new Error("call ended");
        await rtc.publish([track]);
        if (this.rtc !== rtc || !this.active) throw new Error("call ended");
      } catch (err) {
        try { track.stop(); track.close(); } catch { /* ignore */ }
        if (this.rtc === rtc && this.active) this.h.onIssue({ source: "mic", message: "Could not send your voice to Sahay. Keep typing, or try again." });
        return this.muted;
      }
      this.mic = track;
      this.muted = false;
      this.mark("published");
      return false;
    })().finally(() => { this.openingMic = null; });
    return this.openingMic;
  }

  /**
   * Mute or unmute. In a text-mode call without a microphone, unmuting opens the microphone
   * and publishes it (the owner switched from typing to talking).
   */
  async setMuted(muted) {
    if (!this.mic) {
      if (muted || !this.rtc || !CONNECTED.includes(this.status)) return this.muted;
      return this.openMic();
    }
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

  /**
   * `unexpected`: the owner did not press End (Sahay left, the server closed the call). The
   * console then shows "The call ended. Start a new call to continue." until the next start.
   */
  async end({ note, unexpected = false } = {}) {
    if (!this.active || this.status === "ending") return;
    this.setStatus("ending");
    await this.teardown({ stopServer: true });
    this.setStatus("idle", { note: note || "Call ended.", unexpected });
  }

  /**
   * The server reported this call's session ended while the browser still holds it (closed
   * from another tab, or the server stopped it). Only a connected call reacts; a call still
   * starting reports its own error from start().
   */
  endedByServer(channel, reason) {
    if (!this.session || channel !== this.session.channel) return;
    if (!["live", "waiting", "reconnecting"].includes(this.status) || this.serverStarting) return;
    const note = {
      max_duration: "The call reached its time limit. Start a new call to continue.",
      agent_left: "Sahay left the call.",
    }[reason] || "The call was closed on the server.";
    this.end({ note, unexpected: true });
  }

  // Order from TK App.tsx:1085-1133: release the mic first so it frees even if the
  // network stalls, then unsubscribe, destroy the toolkit, and leave/logout settled.
  async teardown({ stopServer }) {
    clearInterval(this.levelTimer);
    clearTimeout(this.agentTimer);
    this.h.onLevels({ mic: 0, agent: 0 });
    this.h.onAutoplay(false);
    const ended = new CallError("NOT_CONNECTED", "Not connected", "The call ended before the message was sent.");
    for (const w of this.spokeWaiters.splice(0)) w.reject(ended);
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

/**
 * Receive-only listener for a running negotiation (POST /api/negotiations/:id/listen).
 * A separate RTC client that joins the negotiation channel with the listener uid, plays
 * whatever audio is published there and never publishes anything itself, so neither the
 * negotiator nor the vendor can hear the owner.
 *
 * onChange({ negotiationId, status, error, speakers }) on every change.
 * status: idle | joining | listening | error
 */
export class NegotiationListener {
  constructor(onChange) {
    this.onChange = onChange;
    this.negotiationId = null;
    this.status = "idle";
    this.error = null;
    this.rtc = null;
    this.tracks = new Map();
    this.run = 0;
    window.addEventListener("pagehide", () => { this.stop(); });
  }

  emit() {
    this.onChange({ negotiationId: this.negotiationId, status: this.status, error: this.error, speakers: this.tracks.size });
  }

  async start(negotiationId) {
    if (this.negotiationId !== null && this.status !== "idle") await this.stop();
    const run = ++this.run;
    this.negotiationId = String(negotiationId);
    this.error = null;
    this.status = "joining";
    this.emit();
    try {
      if (!window.isSecureContext) throw new Error("Listening needs HTTPS or localhost.");
      try { await preloadSdks(); } catch { /* reported just below */ }
      const { AgoraRTC } = window;
      if (!AgoraRTC) throw new Error("The Agora voice SDK could not be downloaded. Check the network and try again.");

      const t = await api.negotiationListenToken(negotiationId);
      if (run !== this.run) return;
      if (!t || !t.appId || !t.channel || !t.token || t.uid === undefined || t.uid === null) {
        throw new Error("The server's listening details were incomplete.");
      }

      const rtc = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      this.rtc = rtc;
      rtc.on("user-published", async (user, mediaType) => {
        if (mediaType !== "audio") return;
        try {
          await rtc.subscribe(user, mediaType);
          if (run !== this.run || !user.audioTrack) return;
          this.tracks.set(String(user.uid), user.audioTrack);
          user.audioTrack.play();
          this.emit();
        } catch (err) {
          if (run === this.run) { this.error = `Could not play the call audio. ${(err && err.message) || ""}`.trim(); this.emit(); }
        }
      });
      const drop = (user) => { if (this.tracks.delete(String(user.uid)) && run === this.run) this.emit(); };
      rtc.on("user-unpublished", drop);
      rtc.on("user-left", drop);
      rtc.on("connection-state-change", (cur, _prev, reason) => {
        if (run !== this.run || cur !== "DISCONNECTED" || reason === "LEAVE") return;
        this.fail(run, "The connection to the negotiation call was lost.");
      });
      rtc.on("token-privilege-did-expire", () => this.fail(run, "The listening pass expired. Press Listen in to join again."));

      const uid = String(t.uid);
      await rtc.join(t.appId, t.channel, t.token, /^\d+$/.test(uid) ? Number(uid) : uid);
      if (run !== this.run) { try { await rtc.leave(); } catch { /* ignore */ } return; }
      this.status = "listening";
      this.emit();
    } catch (err) {
      if (run !== this.run) return;
      await this.release();
      this.status = "error";
      this.error = err && err.code === "NOT_RUNNING"
        ? "That negotiation has already finished."
        : (err && err.message) || "Could not join the negotiation call.";
      this.emit();
    }
  }

  async fail(run, message) {
    if (run !== this.run) return;
    this.run++;
    await this.release();
    this.status = "error";
    this.error = message;
    this.emit();
  }

  async release() {
    const rtc = this.rtc;
    this.rtc = null;
    for (const t of this.tracks.values()) { try { t.stop(); } catch { /* ignore */ } }
    this.tracks.clear();
    if (rtc) { try { await rtc.leave(); } catch { /* ignore */ } }
  }

  async stop() {
    this.run++;
    await this.release();
    const wasActive = this.status !== "idle";
    this.status = "idle";
    this.error = null;
    if (wasActive) this.emit();
    this.negotiationId = null;
  }
}
