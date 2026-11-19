// REST wrappers for the browser contract in src/routes/api.js (the source of truth).
// The page never holds a secret: the server keeps the session in an HttpOnly cookie and
// mints short-lived Agora tokens. Every request is same-origin with credentials.
//
// Error bodies: requireSession answers 401 { error, code }; every other error is
// { code, message, say? }.

export class ApiError extends Error {
  constructor(status, code, message, say) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 means the request never reached the server
    this.code = code;
    this.say = say || null;
  }
}

const TIMEOUT_MS = 20000;

async function request(method, path, body, { timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    throw new ApiError(0, timedOut ? "TIMEOUT" : "NETWORK",
      timedOut ? "The Sahay server took too long to answer." : "Could not reach the Sahay server.");
  } finally {
    clearTimeout(timer);
  }

  const type = res.headers.get("content-type") || "";
  let payload = null;
  if (type.includes("application/json")) {
    try { payload = await res.json(); } catch { payload = null; }
  }
  if (!res.ok) {
    const code = String((payload && payload.code) || `HTTP_${res.status}`);
    const say = payload && typeof payload.say === "string" ? payload.say : null;
    // A 401 body has no message; describe it from the status instead.
    const message = (payload && typeof payload.message === "string" && payload.message) || describeStatus(res.status);
    throw new ApiError(res.status, code, message, say);
  }
  if (payload === null) {
    throw new ApiError(res.status, "BAD_RESPONSE", "The server answered in an unexpected format.");
  }
  return payload;
}

function describeStatus(status) {
  if (status === 401 || status === 403) return "Your console session has expired. Reload the page to continue.";
  if (status === 404) return "The server does not know this request.";
  if (status === 409) return "This was already handled.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The Sahay server hit an error.";
  return `The server refused the request (HTTP ${status}).`;
}

/**
 * POST /api/session. With a valid cookie: { business } for the existing business.
 * Without one: needs { name, ownerName?, city?, state?, language }, otherwise
 * 400 BUSINESS_DETAILS_REQUIRED.
 */
export function openSession(details) {
  return request("POST", "/api/session", details || {});
}

/** GET /api/state: business, requirement(s), jobs, vendors, negotiations, quotes, deals, approvals, orders, followups, audit, voice, telegramLinked. */
export function getState() {
  return request("GET", "/api/state");
}

/**
 * Step 1 of a call, and token renewal: POST /api/voice/token ->
 * { appId, channel, uid, token, agentUid, expiresAt }. Same channel and uid while the call lives.
 */
export function getVoiceToken() {
  return request("POST", "/api/voice/token", {});
}

/**
 * Token renewal for a live call: POST /api/voice/token { channel } -> same shape as above,
 * for the same channel and uid; 409 CALL_ENDED when the server no longer holds that call.
 */
export function renewVoiceToken(channel) {
  return request("POST", "/api/voice/token", { channel });
}

/** Step 2, after the browser has joined and subscribed: POST /api/voice/start { channel } -> { agentId, agentUid, channel }. */
export function startVoice(channel) {
  // The agent join plus the spoken disclosure can take a while.
  return request("POST", "/api/voice/start", { channel }, { timeoutMs: 45000 });
}

/** POST /api/voice/stop -> { stopped } */
export function stopVoice() {
  return request("POST", "/api/voice/stop", {});
}

/** Fire-and-forget stop for page unload; sendBeacon carries same-origin cookies. */
export function stopVoiceOnUnload() {
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/voice/stop", new Blob(["{}"], { type: "application/json" }));
      return;
    }
  } catch { /* fall through */ }
  try {
    fetch("/api/voice/stop", { method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch { /* page is going away */ }
}

/** POST /api/approvals/:id/decision { decision } -> { approvalId, status } (button path). */
export function decideApproval(approvalId, decision) {
  if (decision !== "approve" && decision !== "reject") throw new Error("decision must be approve or reject");
  return request("POST", `/api/approvals/${encodeURIComponent(approvalId)}/decision`, { decision });
}

/** URL of the PO PDF for an order (served by the API, session cookie required). */
export function poPdfUrl(orderId) {
  return `/api/orders/${encodeURIComponent(orderId)}/po.pdf`;
}

/** POST /api/telegram/link-code -> { code, deepLink, expiresAt }; 503 TELEGRAM_NOT_CONFIGURED when the bot is not set up. */
export function telegramLinkCode() {
  return request("POST", "/api/telegram/link-code", {});
}

/** POST /api/negotiations/:id/listen -> { appId, channel, uid, token, expiresAt } (receive-only); 404 NOT_RUNNING. */
export function negotiationListenToken(negotiationId) {
  return request("POST", `/api/negotiations/${encodeURIComponent(negotiationId)}/listen`, {});
}
