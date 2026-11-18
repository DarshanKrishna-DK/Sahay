// REST wrappers for the browser contract in docs/build/architecture.md.
// The page never holds a secret: the server keeps the session in an HttpOnly cookie and
// mints short-lived Agora tokens. Every request is same-origin with credentials.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 means the request never reached the server
    this.code = code;
  }
}

const TIMEOUT_MS = 15000;

async function request(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
    throw new ApiError(0, timedOut ? "timeout" : "network",
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
    const code = (payload && (payload.code || payload.error)) || `http_${res.status}`;
    const message = (payload && (payload.message || payload.say)) || describeStatus(res.status);
    throw new ApiError(res.status, String(code), String(message));
  }
  if (payload === null && res.status !== 204) {
    throw new ApiError(res.status, "bad_response", "The server answered in an unexpected format.");
  }
  return payload;
}

function describeStatus(status) {
  if (status === 401 || status === 403) return "Your console session has expired. Reload the page to sign in again.";
  if (status === 404) return "This feature is not available on the server yet.";
  if (status === 409) return "This was already handled.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The Sahay server hit an error.";
  return `The server refused the request (HTTP ${status}).`;
}

/** POST /api/session -> creates or loads the business and sets the signed cookie. */
export function openSession() {
  return request("POST", "/api/session", {});
}

/** GET /api/state -> requirement, jobs, vendors, deals, approvals, orders, audit. */
export function getState() {
  return request("GET", "/api/state");
}

/** POST /api/voice/start -> { appId, channel, uid, token, agentId } (agentUid if the server sends it). */
export function startVoice() {
  return request("POST", "/api/voice/start", {});
}

/** POST /api/voice/stop */
export function stopVoice() {
  return request("POST", "/api/voice/stop", {});
}

/**
 * Fresh RTC+RTM token for the current call (same channel and uid, bound server-side).
 * Not yet in architecture.md: reported as a contract gap. Expected answer: { token }.
 */
export function renewVoiceToken() {
  return request("POST", "/api/voice/token", {});
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

/** POST /api/approvals/:id/decision { decision: 'approve' | 'reject' } (button path). */
export function decideApproval(approvalId, decision) {
  if (decision !== "approve" && decision !== "reject") throw new Error("decision must be approve or reject");
  return request("POST", `/api/approvals/${encodeURIComponent(approvalId)}/decision`, { decision });
}

/** URL of the PO PDF for an order (served by the API, session cookie required). */
export function poPdfUrl(orderId) {
  return `/api/orders/${encodeURIComponent(orderId)}/po.pdf`;
}
