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
 */

const path = require("node:path");
const express = require("express");
const { config } = require("../config");
const auth = require("../auth");
const repo = require("../db/repo");
const events = require("../events");
const approvals = require("../approvals");
const orders = require("../orders");
const agent = require("../agora/agent");
const narrator = require("../agora/narrator");
const { buildRtcRtmToken } = require("../agora/token");
const registry = require("../tools/registry");
const negotiation = require("../negotiation/session");
const telegram = require("../notify/telegram");
const { ToolError, toToolError } = require("../tools/errors");

const USER_UID = 1002;
const AGENT_UID = 1001;
const USER_TOKEN_SECONDS = 3600;
const BROWSER_SESSION_SECONDS = 7 * 24 * 60 * 60;
const LANGUAGES = ["hi-IN", "kn-IN", "en-IN"];

class HttpError extends Error {
  constructor(status, code, message, say) {
    super(message);
    this.status = status;
    this.code = code;
    if (say) this.say = say;
  }
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

/* ----------------------------------------------------------- voice call --- */

function endVoice(businessId, reason) {
  const v = voice.get(businessId);
  if (!v) return null;
  voice.delete(businessId);
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
    vendors: forRequirement ? repo.listVendors(businessId, forRequirement) : [],
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

/* ------------------------------------------------------- vendor join page --- */

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
<script src="https://download.agora.io/sdk/release/AgoraRTC_N-4.24.3.js"></script>
<script>
(function () {
  var code = location.pathname.split("/").pop();
  var status = document.getElementById("status");
  var joinBtn = document.getElementById("join");
  var leaveBtn = document.getElementById("leave");
  var info = null, client = null, mic = null;
  function show(t) { status.textContent = t; }
  fetch("/api/vendor/" + encodeURIComponent(code) + "/token").then(function (r) {
    if (!r.ok) throw new Error(r.status === 404 ? "This link is not valid or has expired." : "The server could not prepare the call.");
    return r.json();
  }).then(function (j) {
    info = j;
    document.getElementById("notice").textContent = j.disclosure;
    document.getElementById("what").textContent = "Item: " + j.item;
    joinBtn.disabled = false;
    show("Ready. Press join and allow the microphone.");
  }).catch(function (e) { show(e.message); });
  joinBtn.onclick = async function () {
    joinBtn.disabled = true;
    try {
      client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      client.on("user-published", async function (user, type) {
        await client.subscribe(user, type);
        if (type === "audio") user.audioTrack.play();
      });
      await client.join(info.appId, info.channel, info.token, Number(info.uid));
      mic = await AgoraRTC.createMicrophoneAudioTrack();
      await client.publish([mic]);
      await fetch("/api/vendor/" + encodeURIComponent(code) + "/joined", { method: "POST" });
      leaveBtn.hidden = false;
      show("Connected. Speak normally.");
    } catch (e) {
      joinBtn.disabled = false;
      show("Could not join: " + e.message);
    }
  };
  leaveBtn.onclick = async function () {
    if (mic) mic.close();
    if (client) await client.leave();
    leaveBtn.hidden = true;
    show("You left the call.");
  };
})();
</script>
</body></html>`;

/* --------------------------------------------------------------- router --- */

function createApiRouter() {
  const router = express.Router();
  const json = express.json({ limit: "64kb" });

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
        const name = text(body.name, "name", 120);
        if (!name) {
          throw new HttpError(400, "BUSINESS_DETAILS_REQUIRED", "Tell Sahay the business name, city and language to start.");
        }
        const language = body.language ?? "hi-IN";
        if (!LANGUAGES.includes(language)) throw new HttpError(400, "INVALID", `language must be one of: ${LANGUAGES.join(", ")}.`);
        business = repo.createBusiness(repo.newId("biz"), {
          name,
          owner_name: text(body.ownerName, "ownerName", 120),
          city: text(body.city, "city", 80),
          state: text(body.state, "state", 80),
          language,
        });
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
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      let v = voice.get(businessId);
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
      const v = voice.get(businessId);
      if (!v) throw new HttpError(409, "NO_VOICE_SESSION", "Ask for a voice token first (POST /api/voice/token).");
      if (req.body?.channel !== undefined && req.body.channel !== v.channel) throw new HttpError(409, "CHANNEL_MISMATCH", "That is not this session's channel.");
      if (v.agentId || v.starting) throw new HttpError(409, "ALREADY_STARTED", "The assistant is already in this call.");
      v.starting = true;
      try {
        const business = repo.getBusiness(businessId);
        const started = await agent.startOwnerAgent({
          businessId,
          sessionId: v.sessionId,
          channel: v.channel,
          agentUid: v.agentUid,
          userUid: v.userUid,
          language: business.language,
        });
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
        events.emit(businessId, "session.started", { sessionId: v.sessionId, kind: "owner", channel: v.channel }, { sessionId: v.sessionId, actor: "system" });
        narrator.attach(businessId, { agentId: started.agentId, sessionId: v.sessionId, language: started.language });
        res.json({ agentId: started.agentId, agentUid: v.agentUid, channel: v.channel });
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
      if (v.agentId) await agent.stopAgent(v.agentId);
      endVoice(businessId, "owner");
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
      const decided = approvals.confirmApproval(businessId, req.params.id, {
        decision,
        via: "button",
        sessionId: voice.get(businessId)?.sessionId ?? null,
      });
      res.json({ approvalId: decided.id, status: decided.status });
    }),
  );

  router.get(
    "/api/orders/:id/po.pdf",
    wrap(async (req, res) => {
      const { businessId } = req.auth;
      if (!repo.getOrder(businessId, req.params.id)) throw new HttpError(404, "NOT_FOUND", "No such order.");
      const pdfPath = await orders.issuePurchaseOrder(businessId, req.params.id);
      res.type("application/pdf");
      res.set("Content-Disposition", `inline; filename="${path.basename(pdfPath).replace(/[^A-Za-z0-9._-]/g, "_")}"`);
      res.sendFile(path.resolve(pdfPath));
    }),
  );

  router.get("/api/events", events.sseHandler);

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
  router.get("/api/vendor/:code/token", (req, res) => {
    const info = negotiation.humanJoinInfo(req.params.code);
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

function cookieValue(req) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === auth.COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/** Error handler: `{code, message, say?}` with the right status; internal details stay in the log. */
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return res.end();
  if (err?.type === "entity.parse.failed") return res.status(400).json({ code: "BAD_JSON", message: "The request body is not valid JSON." });
  if (err?.type === "entity.too.large") return res.status(413).json({ code: "TOO_LARGE", message: "The request body is too large." });
  if (err instanceof HttpError) return res.status(err.status).json({ code: err.code, message: err.message, ...(err.say ? { say: err.say } : {}) });
  if (err?.name === "AuthError") return res.status(err.code === "NO_SECRET" ? 500 : 401).json({ code: "UNAUTHORIZED", message: "Your session is not valid. Reload the page." });
  if (err?.name === "AgoraError" || err?.name === "TokenError") {
    console.error(`[api] ${req.method} ${req.path}: ${err.name} ${err.code}: ${err.message}`);
    return res.status(err.name === "TokenError" ? 500 : 502).json({ code: err.code, message: err.message });
  }
  const language = req.auth?.businessId ? repo.getBusiness(req.auth.businessId)?.language : undefined;
  const toolError = err instanceof ToolError ? err : toToolError(err, language);
  if (toolError.status >= 500) console.error(`[api] ${req.method} ${req.path}: ${err?.name ?? "Error"} ${err?.code ?? ""}: ${err?.message ?? err}`);
  const known = toolError.code !== "INTERNAL";
  res.status(toolError.status).json({ code: toolError.code, message: known ? toolError.message : "The Sahay server hit an error.", say: toolError.say });
}

module.exports = { createApiRouter, createVendorRouter, errorHandler, stopAllVoice, voice, HttpError, USER_UID, AGENT_UID };
