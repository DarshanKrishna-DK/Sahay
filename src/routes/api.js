"use strict";

/**
 * REST for the browser console (docs/build/architecture.md, "REST for the browser").
 * The tenant is always req.auth.businessId from the signed HttpOnly cookie
 * (auth.requireSession); no handler reads a business id from a body, a query
 * or a path. Errors answer `{code, message, say?}`.
 *
 * Voice is two steps so the browser is subscribed before the agent speaks:
 *   POST /api/voice/token  -> the browser joins RTC + RTM (also used to renew)
 *   POST /api/voice/start  -> /join, then the disclosure via /speak INTERRUPT, not interruptable
 *
 * Cost guards (security review r1 #1): new businesses and voice calls are rate limited per
 * client IP (and per business), an optional access code gates creating a business, a live
 * owner call holds one global "owner_call" slot (src/limits.js), and the server ends a call
 * after config.limits.callSeconds or as soon as Agora reports its agent gone.
 */

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { config } = require("../config");
const limits = require("../limits");
const auth = require("../auth");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const orders = require("../orders");
const payments = require("../orders/payments");
const agent = require("../agora/agent");
const narrator = require("../agora/narrator");
const { buildRtcRtmToken } = require("../agora/token");
const registry = require("../tools/registry");
const negotiation = require("../negotiation/session");
const telegram = require("../notify/telegram");
const { ToolError, toToolError } = require("../tools/errors");
const agentProfile = require("../agent/profile");
const agentRules = require("../agent/rules");
const agentMemories = require("../agent/memories");
const agentPolicy = require("../agent/policy");
const speakIt = require("../agent/speak");

const USER_UID = 1002;
const AGENT_UID = 1001;
const USER_TOKEN_SECONDS = 3600;
const BROWSER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];
const MINUTE = 60 * 1000;

/** Fixed-window limits: {max, windowMs}. Per client IP and, for voice, per business too. */
const RATE = Object.freeze({
  newBusiness: Object.freeze({ perIp: { max: 5, windowMs: 60 * MINUTE } }),
  voiceToken: Object.freeze({ perBusiness: { max: 20, windowMs: 10 * MINUTE }, perIp: { max: 60, windowMs: 10 * MINUTE } }),
  voiceStart: Object.freeze({ perBusiness: { max: 6, windowMs: 10 * MINUTE }, perIp: { max: 20, windowMs: 10 * MINUTE } }),
  pay: Object.freeze({ perIp: { max: 60, windowMs: 10 * MINUTE } }),
  speak: Object.freeze({ perBusiness: { max: 30, windowMs: 10 * MINUTE } }),
});
/** How often a live owner call's agent is checked with Agora (it may have left on idle_timeout). */
const AGENT_WATCH_MS = 30 * 1000;
/** Wait before the one server-side retry of a transient /join failure (E2E 2026-11-19: one 502, the owner's retry worked). */
const JOIN_RETRY_MS = 700;

/**
 * A /join failure worth one more try: Agora not answering, rate limited or a 5xx. A 4xx (bad
 * body, bad credentials, conflict) would fail the same way again, so it is reported at once.
 */
const transientJoinFailure = (err) => err?.name === "AgoraError" && (err.code === "AGORA_UNREACHABLE" || [429, 500, 502, 503, 504].includes(err.status));

/** Business, owner and place names: letters and marks of any script, digits, space, . , & ' - ( ), and ZWNJ/ZWJ (Kannada, Devanagari). */
const NAME_CHARS = /^[\p{L}\p{M}\p{N} .,&'()\p{Join_Control}-]+$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const NAME_MAX = 80;

const SAY = {
  newBusinessLimited: {
    "en-IN": "Too many new businesses were set up from this network. Please try again in an hour.",
    "hi-IN": "इस नेटवर्क से बहुत सारे नए व्यापार बनाए गए हैं। कृपया एक घंटे बाद फिर कोशिश कीजिए।",
    "kn-IN": "ಈ ನೆಟ್‌ವರ್ಕ್‌ನಿಂದ ತುಂಬಾ ಹೊಸ ವ್ಯಾಪಾರಗಳನ್ನು ರಚಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಒಂದು ಗಂಟೆಯ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
  voiceLimited: {
    "en-IN": "Too many call attempts. Please wait a few minutes, then try again.",
    "hi-IN": "बहुत बार कॉल शुरू करने की कोशिश हुई। कृपया कुछ मिनट रुककर फिर कोशिश कीजिए।",
    "kn-IN": "ತುಂಬಾ ಬಾರಿ ಕರೆ ಪ್ರಾರಂಭಿಸಲು ಪ್ರಯತ್ನಿಸಲಾಗಿದೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷ ಕಾದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
  busy: {
    "en-IN": "Sahay is on as many calls as it can take right now. Please try again in a few minutes.",
    "hi-IN": "सहाय अभी जितनी कॉल ले सकती है, उतनी पर है। कृपया कुछ मिनट बाद फिर कोशिश कीजिए।",
    "kn-IN": "ಸಹಾಯ್ ಈಗ ತೆಗೆದುಕೊಳ್ಳಬಹುದಾದಷ್ಟು ಕರೆಗಳಲ್ಲಿ ಇದೆ. ದಯವಿಟ್ಟು ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
};
const sayIn = (lines, language) => lines[LANGUAGES.includes(language) ? language : "en-IN"];

class HttpError extends Error {
  constructor(status, code, message, say, { retryAfterSeconds } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    if (say) this.say = say;
    if (retryAfterSeconds) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The caller's IP for rate limiting. cloudflared runs on this machine, so a request from
 * loopback carries the real client in CF-Connecting-IP; from anywhere else the header is the
 * caller's own claim and is ignored.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const IP_TEXT = /^[0-9A-Fa-f:.]{2,45}$/;
const PRIVATE_IP = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|::ffff:(10|127|192\.168)\.|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * The caller's address for rate limits. Behind the local cloudflared tunnel: CF-Connecting-IP from
 * loopback. Behind a hosting proxy (opt-in, TRUST_FORWARDED_FOR=1, e.g. Hugging Face Spaces): the
 * right-most public X-Forwarded-For entry, which the proxy appended and the client cannot forge.
 */
function clientIp(req, { trustForwardedFor = config.trustForwardedFor } = {}) {
  const peer = req.socket?.remoteAddress ?? "unknown";
  if (trustForwardedFor && PRIVATE_IP.test(peer)) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).reverse();
    const client = hops.find((h) => IP_TEXT.test(h) && !PRIVATE_IP.test(h));
    if (client) return client;
  }
  if (LOOPBACK.has(peer)) {
    const forwarded = req.headers["cf-connecting-ip"];
    if (typeof forwarded === "string" && IP_TEXT.test(forwarded.trim())) return forwarded.trim();
  }
  return peer;
}

/** Throw 429 RATE_LIMITED unless every {key, max, windowMs} is under its limit. */
function rateLimit(checks, say) {
  for (const { key, max, windowMs } of checks) {
    if (!limits.allow(key, max, windowMs)) {
      throw new HttpError(429, "RATE_LIMITED", "Too many requests. Wait a few minutes and try again.", say, { retryAfterSeconds: Math.ceil(windowMs / 1000) });
    }
  }
}

function accessCodeMatches(given) {
  if (typeof given !== "string" || given.length > 256) return false;
  const digest = (s) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(digest(given), digest(config.accessCode));
}

/** businessId -> the owner's live voice call in this process */
const voice = new Map();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function text(value, name, max, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(400, "INVALID", `${name} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError(400, "INVALID", `${name} must be text of at most ${max} characters.`);
  return value.trim();
}

/** A business, owner or place name (security review r1 #16): it reaches the agent's prompts. */
function nameText(value, name, { required = false } = {}) {
  const out = text(value, name, NAME_MAX, { required });
  if (out === undefined) return undefined;
  if (!NAME_CHARS.test(out) || !HAS_LETTER_OR_DIGIT.test(out)) {
    throw new HttpError(400, "INVALID", `${name} may use letters, digits, spaces and . , & ' - ( ) only.`);
  }
  return out;
}

/* ----------------------------------------------------------- voice call --- */

let watchTimer = null;

/** One sweep: end every owner call whose agent Agora reports stopped or no longer knows. */
async function checkAgents() {
  const live = [...voice.entries()].filter(([, v]) => v.agentId);
  if (!live.length && watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  await Promise.allSettled(
    live.map(async ([businessId, v]) => {
      let gone = false;
      try {
        const { status } = await agent.agentStatus(v.agentId);
        gone = status === "STOPPED" || status === "FAILED";
      } catch (err) {
        gone = err?.name === "AgoraError" && err.status === 404;
      }
      if (gone && voice.get(businessId) === v) endVoice(businessId, "agent_left");
    }),
  );
}

function watchAgents() {
  if (watchTimer) return;
  watchTimer = setInterval(() => checkAgents().catch(() => {}), AGENT_WATCH_MS);
  watchTimer.unref();
}

/** The server ends the call itself (max length): the agent leaves, the console hears session.ended. */
async function endFromServer(businessId, v, reason) {
  if (voice.get(businessId) !== v) return;
  try {
    if (v.agentId) await agent.stopAgent(v.agentId);
  } catch (err) {
    // Agora unreachable: the agent's own idle_timeout ends it once the browser leaves, and its MCP bearer dies with the session row.
    console.error(`[api] ending call (${reason}): agent did not leave: ${err?.code ?? err?.name ?? "Error"}`);
  }
  if (voice.get(businessId) === v) endVoice(businessId, reason);
}

function endVoice(businessId, reason) {
  const v = voice.get(businessId);
  if (!v) return null;
  voice.delete(businessId);
  clearTimeout(v.maxTimer);
  v.release?.();
  narrator.detach(businessId);
  repo.updateSession(businessId, v.sessionId, { status: "ended", ended_at: new Date().toISOString() });
  events.emit(businessId, "session.ended", { sessionId: v.sessionId, kind: "owner", channel: v.channel, reason }, { sessionId: v.sessionId, actor: reason === "owner" ? "owner" : "system" });
  return v;
}

/** Stop every owner agent this process started (graceful shutdown). */
async function stopAllVoice() {
  const all = [...voice.entries()];
  await Promise.allSettled(
    all.map(async ([businessId, v]) => {
      if (v.agentId) await agent.stopAgent(v.agentId);
      endVoice(businessId, "shutdown");
    }),
  );
}

/* --------------------------------------------------------------- state --- */

function snapshot(businessId) {
  const business = repo.getBusiness(businessId);
  const requirements = repo.listRequirements(businessId);
  const requirement = requirements.length ? requirements[requirements.length - 1] : null;
  const forRequirement = requirement ? { requirement_id: requirement.id } : null;
  const v = voice.get(businessId);
  return {
    business,
    requirement,
    requirements,
    jobs: repo.listJobs(businessId),
    vendors: forRequirement ? rankedForState(businessId, requirement) : [],
    negotiations: forRequirement ? repo.listNegotiations(businessId, forRequirement) : [],
    quotes: forRequirement ? repo.listQuotes(businessId, forRequirement) : [],
    deals: requirement ? registry.rankedDeals(businessId, requirement.id) : [],
    approvals: repo.listApprovals(businessId),
    orders: repo.listOrders(businessId).map((o) => ({ ...o, pdfUrl: `/api/orders/${encodeURIComponent(o.id)}/po.pdf` })),
    followups: repo.listFollowups(businessId),
    audit: repo
      .listAudit(businessId, { newest_first: true, limit: 200 })
      .reverse()
      .map((row) => ({ id: row.id, ts: row.ts, type: row.type, actor: row.actor, sessionId: row.session_id, data: row.detail })),
    voice: v ? { channel: v.channel, agentId: v.agentId ?? null, active: Boolean(v.agentId) } : null,
    telegramLinked: Boolean(repo.getTelegramLink(businessId)),
  };
}

/**
 * The requirement's vendors in the order the get_shortlist tool ranks them (src/agent/policy.js:
 * the owner's rules applied); `rank` 1 = best, so the app shows the vendor the agent calls number
 * one as #1. A vendor the owner's rule avoids is listed last, unranked and marked `avoided`.
 */
function rankedForState(businessId, requirement) {
  const ranked = agentPolicy.rankedVendors(businessId, requirement).map((v, i) => ({ ...v, rank: i + 1, avoided: false }));
  const seen = new Set(ranked.map((v) => v.id));
  const avoided = repo.listVendors(businessId, { requirement_id: requirement.id }).filter((v) => !seen.has(v.id)).map((v) => ({ ...v, rank: null, avoided: true }));
  return [...ranked, ...avoided];
}

/* ------------------------------------------------------- vendor join page --- */

/**
 * Agora Web RTC SDK 4.24.3 from jsDelivr (byte-identical to download.agora.io's AgoraRTC_N-4.24.3.js,
 * which sends no CORS header and so cannot be SRI-checked). Same pin as public/js/voice.js.
 */
const RTC_SDK = Object.freeze({
  src: "https://cdn.jsdelivr.net/npm/agora-rtc-sdk-ng@4.24.3/AgoraRTC_N-production.js",
  integrity: "sha384-nw2NeZrSeNHx9ARgmXyDt/wyJfls4Wyt8YHR+4Rts9Fpqjucz+B+Qf5kxkxfXCJm",
});

/** Minimal page for a human vendor joining a negotiation. No data in the HTML; the code is read from the URL. */
const VENDOR_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sahay negotiation</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1b16;--muted:#5d5a52;--accent:#1f6f5c}
@media (prefers-color-scheme:dark){:root{--bg:#15140f;--fg:#f1efe8;--muted:#a9a59a;--accent:#6fcfb4}}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:34rem;margin:0 auto;padding:2rem 1rem}
.notice{border-left:4px solid var(--accent);padding:.5rem .75rem;margin:1rem 0}
button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:0;background:var(--accent);color:var(--bg);cursor:pointer}
button:disabled{opacity:.5;cursor:default}
#status{color:var(--muted)}
</style></head>
<body><main>
<h1>Price discussion</h1>
<p class="notice" id="notice">You will speak with Sahay, an automated assistant acting for a buyer. आप सहाय से बात करेंगे, जो एक स्वचालित सहायक है।</p>
<p id="what"></p>
<button id="join" disabled>Join the call</button> <button id="leave" hidden>Leave</button>
<p id="status" role="status">Loading.</p>
</main>
<script src="${RTC_SDK.src}" integrity="${RTC_SDK.integrity}" crossorigin="anonymous"></script>
<script src="/js/vendor-join.js"></script>
</body></html>`;

/* --------------------------------------------------------------- router --- */

function createApiRouter() {
  const router = express.Router();
  const json = express.json({ limit: "64kb" });

  // Public: the onboarding form asks for an access code only when this server needs one.
  router.get("/api/config", (_req, res) => res.json({ accessCodeRequired: Boolean(config.accessCode) }));

  router.post(
    "/api/session",
    json,
    wrap(async (req, res) => {
      let claims = null;
      try {
        claims = auth.verifySession(cookieValue(req), { scope: "browser" });
      } catch {
        claims = null;
      }
      let business = claims ? repo.getBusiness(claims.businessId) : null;
      if (!business) {
        const body = req.body ?? {};
        const name = nameText(body.name, "name");
        if (!name) {
          throw new HttpError(400, "BUSINESS_DETAILS_REQUIRED", "Tell Sahay the business name, city and language to start.");
        }
        const language = body.language ?? "hi-IN";
        if (!LANGUAGES.includes(language)) throw new HttpError(400, "INVALID", `language must be one of: ${LANGUAGES.join(", ")}.`);
        const details = {
          name,
          owner_name: nameText(body.ownerName, "ownerName"),
          city: nameText(body.city, "city"),
          state: nameText(body.state, "state"),
          language,
        };
        // Counted before the access code is checked, so the same window also caps guessing it.
        const { perIp } = RATE.newBusiness;
        rateLimit([{ key: `session:${clientIp(req)}`, ...perIp }], sayIn(SAY.newBusinessLimited, language));
        if (config.accessCode && !accessCodeMatches(body.accessCode)) {
          throw new HttpError(403, "ACCESS_CODE_REQUIRED", body.accessCode ? "That access code is not right." : "This Sahay server needs an access code to set up a new business.");
        }
        business = repo.createBusiness(repo.newId("biz"), details);
        const token = auth.signSession({
          businessId: business.id,
          sessionId: repo.newId("web"),
          scope: "browser",
          exp: Math.floor(Date.now() / 1000) + BROWSER_SESSION_SECONDS,
        });
        auth.setSessionCookie(req, res, token);
      }
      res.json({ business: { id: business.id, name: business.name, city: business.city, language: business.language } });
    }),
  );

  router.use("/api", auth.requireSession);

  router.post(
    "/api/voice/token",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      limitVoice(req, "voiceToken");
      let v = voice.get(businessId);
      // Renewal names the call's channel. If that call is gone (ended elsewhere, or the server
      // restarted), say so instead of quietly opening a new call the browser never joined.
      const renewing = req.body?.channel;
      if (renewing !== undefined && (!v || renewing !== v.channel)) {
        throw new HttpError(409, "CALL_ENDED", "The call ended. Start a new call to continue.");
      }
      if (!v) {
        const channel = `own-${repo.newId("c").slice(2, 22)}`;
        const session = repo.createSession(businessId, { kind: "owner", channel, status: "connecting" });
        v = { sessionId: session.id, channel, userUid: USER_UID, agentUid: AGENT_UID, agentId: null };
        voice.set(businessId, v);
      }
      const { token, expiresAt, appId } = buildRtcRtmToken(v.channel, v.userUid, USER_TOKEN_SECONDS);
      res.json({ appId, channel: v.channel, uid: v.userUid, token, agentUid: v.agentUid, expiresAt });
    }),
  );

  router.post(
    "/api/voice/start",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      limitVoice(req, "voiceStart");
      const v = voice.get(businessId);
      if (!v) throw new HttpError(409, "NO_VOICE_SESSION", "Ask for a voice token first (POST /api/voice/token).");
      if (req.body?.channel !== undefined && req.body.channel !== v.channel) throw new HttpError(409, "CHANNEL_MISMATCH", "That is not this session's channel.");
      if (v.agentId || v.starting) throw new HttpError(409, "ALREADY_STARTED", "The assistant is already in this call.");
      const business = repo.getBusiness(businessId);
      // One global slot per live owner call; endVoice gives it back (stop, agent gone, max length, shutdown).
      const release = limits.tryAcquire("owner_call");
      if (!release) throw new HttpError(503, "BUSY", "Sahay is on as many calls as it can take. Try again in a few minutes.", sayIn(SAY.busy, business?.language));
      v.release = release;
      v.starting = true;
      try {
        // One `now` for both tries: the agent's /join name is built from it, so when a first /join
        // that seemed to fail did start an agent, Agora refuses the retry (409) instead of a second agent.
        const now = Date.now();
        const join = () => agent.startOwnerAgent({
          businessId,
          sessionId: v.sessionId,
          channel: v.channel,
          agentUid: v.agentUid,
          userUid: v.userUid,
          language: business.language,
          now,
        });
        let started;
        try {
          started = await join();
        } catch (err) {
          if (!transientJoinFailure(err)) throw err;
          console.warn(`[voice] /join failed (${err.message}); trying once more in ${JOIN_RETRY_MS} ms.`);
          await new Promise((resolve) => setTimeout(resolve, JOIN_RETRY_MS));
          if (voice.get(businessId) !== v) throw new HttpError(409, "CALL_ENDED", "The call was ended while the assistant was joining.");
          started = await join(); // a second failure is the honest error the owner sees
        }
        // The owner may have pressed End while /join was in flight: stop the agent we just
        // started instead of attaching it to a call record that no longer exists.
        if (voice.get(businessId) !== v) {
          await agent.stopAgent(started.agentId).catch(() => {});
          throw new HttpError(409, "CALL_ENDED", "The call was ended while the assistant was joining.");
        }
        v.agentId = started.agentId;
        repo.updateSession(businessId, v.sessionId, { agent_id: started.agentId, status: "active" });
        try {
          // Disclosure first, whole, even if the owner talks over it (S0 run 6).
          await agent.speak(started.agentId, started.disclosure, { priority: "INTERRUPT", interruptable: false });
        } catch (err) {
          await agent.stopAgent(started.agentId).catch(() => {});
          endVoice(businessId, "disclosure_failed");
          throw err;
        }
        if (voice.get(businessId) !== v) throw new HttpError(409, "CALL_ENDED", "The call was ended while the assistant was joining.");
        events.emit(businessId, "session.started", { sessionId: v.sessionId, kind: "owner", channel: v.channel }, { sessionId: v.sessionId, actor: "system" });
        narrator.attach(businessId, { agentId: started.agentId, sessionId: v.sessionId, language: started.language });
        v.maxTimer = setTimeout(() => endFromServer(businessId, v, "max_duration"), config.limits.callSeconds * 1000);
        v.maxTimer.unref();
        watchAgents();
        res.json({ agentId: started.agentId, agentUid: v.agentUid, channel: v.channel });
      } catch (err) {
        release(); // idempotent: endVoice may already have given it back
        throw err;
      } finally {
        v.starting = false;
      }
    }),
  );

  router.post(
    "/api/voice/stop",
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const v = voice.get(businessId);
      if (!v) return res.json({ stopped: false });
      try {
        if (v.agentId) await agent.stopAgent(v.agentId);
      } finally {
        // Even when Agora does not answer, the call ends here: the slot is freed and the MCP bearer
        // dies with the session row; the agent's idle_timeout ends it once the browser has left.
        endVoice(businessId, "owner");
      }
      res.json({ stopped: true });
    }),
  );

  router.get("/api/state", (req, res) => res.json(snapshot(req.auth.businessId)));

  router.post(
    "/api/approvals/:id/decision",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const decision = req.body?.decision;
      if (decision !== "approve" && decision !== "reject") throw new HttpError(400, "INVALID_DECISION", 'decision is "approve" or "reject".');
      const sessionId = voice.get(businessId)?.sessionId ?? null;
      const decided = approvals.confirmApproval(businessId, req.params.id, { decision, via: "button", sessionId });
      if (decided.status !== "approved") return res.json({ approvalId: decided.id, status: decided.status });
      // The tick IS the owner's yes: the server places the order itself, through the same gate
      // (orders.createOrder -> approvals.assertApproved), instead of waiting for the agent to be
      // nudged (final-2 E). order.created is narrated into a live call by the narrator.
      const order = await orders.placeApproved(businessId, decided.id, { sessionId });
      res.json({ approvalId: decided.id, status: decided.status, orderId: order.id, poNumber: order.po_number });
    }),
  );

  // The ✕ on an earlier need: the owner drops a need saved from a garbled turn. Only a need with
  // no running work and no order; it then leaves /api/state and the agent's "current need".
  router.post(
    "/api/requirements/:id/dismiss",
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const before = repo.getRequirement(businessId, req.params.id);
      let need;
      try {
        need = repo.dismissRequirement(businessId, req.params.id);
      } catch (err) {
        if (err?.code === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "No such need.");
        if (err?.code === "REQUIREMENT_BUSY" || err?.code === "REQUIREMENT_ORDERED") throw new HttpError(409, err.code, err.message);
        throw err;
      }
      if (before && before.status !== need.status) {
        events.emit(businessId, "requirement.saved", need, { sessionId: voice.get(businessId)?.sessionId ?? null, actor: "owner" });
      }
      res.json({ requirement: need });
    }),
  );

  router.get(
    "/api/orders/:id/po.pdf",
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      if (!repo.getOrder(businessId, req.params.id)) throw new HttpError(404, "NOT_FOUND", "No such order.");
      const pdfPath = await orders.issuePurchaseOrder(businessId, req.params.id);
      // The page CSP (object-src 'none') is for our HTML; the PDF opens in the browser's own viewer.
      res.removeHeader("Content-Security-Policy");
      res.type("application/pdf");
      res.set("Content-Disposition", `inline; filename="${path.basename(pdfPath).replace(/[^A-Za-z0-9._-]/g, "_")}"`);
      res.sendFile(path.resolve(pdfPath));
    }),
  );

  router.get("/api/events", events.sseHandler);

  /* "My Sahay": profile, rules and memories of the session's business. */
  router.get("/api/agent", (req, res) => {
    const { businessId } = req.auth;
    res.json({ profile: agentProfile.get(businessId), rules: agentRules.list(businessId), memories: agentMemories.list(businessId) });
  });

  router.put(
    "/api/agent/profile",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      res.json({ profile: agentProfile.update(businessId, req.body, { sessionId: voice.get(businessId)?.sessionId ?? null }) });
    }),
  );

  // Speak-it: the client names a card by key; the server builds the sentence (never free text).
  // In a live call the agent says it; otherwise the answer is Murf audio.
  router.post(
    "/api/speak",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const key = req.body?.key;
      if (typeof key !== "string" || key.length > 80) throw new HttpError(400, "INVALID", "key names a card, such as now or rule:<id>.");
      rateLimit([{ key: `speak:biz:${businessId}`, ...RATE.speak.perBusiness }]);
      const out = await speakIt.speak(businessId, key, { agentId: voice.get(businessId)?.agentId ?? null });
      if (out.kind === "spoken") return res.json({ spoken: true });
      res.set("Cache-Control", "private, max-age=600").type("audio/mpeg").send(out.audio);
    }),
  );

  // The ✓ / ✕ on a rule card. A spoken keep goes through the confirm_rule tool instead.
  router.post(
    "/api/agent/rules/:id/decision",
    json,
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      const decision = req.body?.decision;
      if (decision !== "keep" && decision !== "forget") throw new HttpError(400, "INVALID_DECISION", 'decision is "keep" or "forget".');
      const rule = agentRules.decide(businessId, req.params.id, decision, { via: "button", sessionId: voice.get(businessId)?.sessionId ?? null });
      res.json({ rule });
    }),
  );

  router.post(
    "/api/telegram/link-code",
    wrap(async (req, res) => {
      if (!telegram.isConfigured()) throw new HttpError(503, "TELEGRAM_NOT_CONFIGURED", "Telegram notifications are not set up on this server.");
      res.json(telegram.createLinkCode(req.auth.businessId));
    }),
  );

  // Listen-only token for the owner's console to hear a running negotiation.
  router.post(
    "/api/negotiations/:id/listen",
    wrap(async (req, res) => {
      const token = negotiation.listenerToken(req.auth.businessId, req.params.id);
      if (!token) throw new HttpError(404, "NOT_RUNNING", "That negotiation is not running.");
      res.json(token);
    }),
  );

  return router;
}

/** Public routes for a human vendor with a one-time link (no Sahay session). */
function createVendorRouter() {
  const router = express.Router();
  router.get("/vendor/:code", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("html").send(VENDOR_PAGE);
  });
  // The first answer for a code carries `renewKey`; the page keeps it (sessionStorage) and sends it
  // back in RENEW_KEY_HEADER to reload or renew its token. Without it a used code gets nothing.
  router.get("/api/vendor/:code/token", (req, res) => {
    const renewKey = req.get(RENEW_KEY_HEADER);
    const info = negotiation.humanJoinInfo(req.params.code, renewKey ? { renewKey } : {});
    if (!info) return res.status(404).json({ code: "LINK_INVALID", message: "This link is not valid or has expired." });
    res.set("Cache-Control", "no-store").json(info);
  });
  router.post(
    "/api/vendor/:code/joined",
    wrap(async (req, res) => {
      const ok = await negotiation.humanJoined(req.params.code);
      if (!ok) return res.status(404).json({ code: "LINK_INVALID", message: "This link is not valid or has expired." });
      res.json({ ok: true });
    }),
  );
  return router;
}

/** Header the vendor join page sends its renewKey in (public/js/vendor-join.js). */
const RENEW_KEY_HEADER = "X-Sahay-Renew-Key";

const PAY_PAGE = path.join(__dirname, "..", "..", "public", "pay.html");

/**
 * Public pay page (no Sahay session): the 128-bit token in the path is the payer's only
 * credential, bound to one order of one business (src/orders/payments.js). The page itself is
 * static; its data comes from GET /api/pay/:token, and Checkout's success handler posts to
 * /api/pay/:token/verify, where the server checks Razorpay's signature before marking the order paid.
 */
function createPayRouter() {
  const router = express.Router();
  const json = express.json({ limit: "4kb" });
  const limitPay = (req) => rateLimit([{ key: `pay:ip:${clientIp(req)}`, ...RATE.pay.perIp }]);

  router.get("/pay/:token", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(PAY_PAGE);
  });
  router.get(
    "/api/pay/:token",
    wrap(async (req, res) => {
      limitPay(req);
      res.set("Cache-Control", "no-store").json(payments.checkoutForToken(req.params.token));
    }),
  );
  router.post(
    "/api/pay/:token/verify",
    json,
    wrap(async (req, res) => {
      limitPay(req);
      const { status, poNumber, already } = payments.verifyCheckoutPayment(req.params.token, req.body ?? {});
      res.set("Cache-Control", "no-store").json({ status, poNumber, already });
    }),
  );
  return router;
}

/** Per-business and per-client-IP limits on a voice route; 429 with a line in the business's language. */
function limitVoice(req, kind) {
  const { perBusiness, perIp } = RATE[kind];
  const language = repo.getBusiness(req.auth.businessId)?.language;
  rateLimit(
    [
      { key: `${kind}:biz:${req.auth.businessId}`, ...perBusiness },
      { key: `${kind}:ip:${clientIp(req)}`, ...perIp },
    ],
    sayIn(SAY.voiceLimited, language),
  );
}

function cookieValue(req) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === auth.COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * What the log names a request by: the route pattern ("/api/vendor/:code/joined"), never the
 * concrete path or query string, which can carry a vendor's join code (security review r1 #13).
 */
function routeLabel(req) {
  const pattern = req.route?.path;
  return `${req.method} ${typeof pattern === "string" ? `${req.baseUrl ?? ""}${pattern}` : "(unmatched route)"}`;
}

/** Error handler: `{code, message, say?}` with the right status; internal details stay in the log. */
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return res.end();
  if (err?.type === "entity.parse.failed") return res.status(400).json({ code: "BAD_JSON", message: "The request body is not valid JSON." });
  if (err?.type === "entity.too.large") return res.status(413).json({ code: "TOO_LARGE", message: "The request body is too large." });
  if (err instanceof HttpError) {
    if (err.retryAfterSeconds) res.set("Retry-After", String(err.retryAfterSeconds));
    return res.status(err.status).json({ code: err.code, message: err.message, ...(err.say ? { say: err.say } : {}) });
  }
  if (err?.name === "AuthError") return res.status(err.code === "NO_SECRET" ? 500 : 401).json({ code: "UNAUTHORIZED", message: "Your session is not valid. Reload the page." });
  if (err?.name === "AgoraError" || err?.name === "TokenError") {
    console.error(`[api] ${routeLabel(req)}: ${err.name} ${err.code}: ${err.message}`);
    return res.status(err.name === "TokenError" ? 500 : 502).json({ code: err.code, message: err.message });
  }
  const language = req.auth?.businessId ? repo.getBusiness(req.auth.businessId)?.language : undefined;
  const toolError = err instanceof ToolError ? err : toToolError(err, language);
  if (toolError.status >= 500) console.error(`[api] ${routeLabel(req)}: ${err?.name ?? "Error"} ${err?.code ?? ""}: ${err?.message ?? err}`);
  const known = toolError.code !== "INTERNAL";
  res.status(toolError.status).json({ code: toolError.code, message: known ? toolError.message : "The Sahay server hit an error.", say: toolError.say });
}

module.exports = {
  createApiRouter, createVendorRouter, createPayRouter, errorHandler, stopAllVoice, checkAgents, clientIp,
  voice, HttpError, RATE, RTC_SDK, VENDOR_PAGE, RENEW_KEY_HEADER, USER_UID, AGENT_UID, JOIN_RETRY_MS,
};
