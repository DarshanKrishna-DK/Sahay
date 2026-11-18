// Server-sent events from GET /api/events, typed per docs/build/architecture.md:
// { id, ts, businessId, type, data }. The server may send them as unnamed "message"
// events or as named events (event: <type>); both are handled and de-duplicated by id.

export const EVENT_TYPES = [
  "session.started", "session.ended", "transcript", "requirement.saved",
  "job.started", "job.progress", "job.done", "job.failed", "vendor.found",
  "negotiation.turn", "negotiation.ended", "quote.recorded",
  "approval.requested", "approval.decided", "order.created", "payment.link",
  "followup.fired", "error",
];

const MAX_BACKOFF_MS = 30000;

/**
 * connectEvents({ onEvent, onStatus }) -> { close() }
 * onStatus(state, info): state is "connecting" | "open" | "reconnecting" | "closed".
 * info.resumed is true on an open that follows a drop, so the caller can resync state.
 */
export function connectEvents({ onEvent, onStatus }) {
  let source = null;
  let closedByUs = false;
  let attempt = 0;
  let retryTimer = null;
  let everOpened = false;
  const seen = new Set();
  const seenOrder = [];

  function remember(id) {
    if (id === undefined || id === null) return true;
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    seenOrder.push(key);
    if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
    return true;
  }

  function handle(raw, namedType) {
    let evt;
    try { evt = JSON.parse(raw.data); } catch { return; }
    if (!evt || typeof evt !== "object") return;
    const type = typeof evt.type === "string" ? evt.type : namedType;
    if (!type) return;
    if (!remember(evt.id ?? raw.lastEventId ?? null)) return;
    onEvent({ id: evt.id ?? null, ts: evt.ts ?? null, type, data: evt.data ?? {} });
  }

  function open() {
    if (closedByUs) return;
    onStatus(attempt === 0 && !everOpened ? "connecting" : "reconnecting", { attempt });
    try {
      source = new EventSource("/api/events", { withCredentials: true });
    } catch {
      scheduleRetry();
      return;
    }
    source.onopen = () => {
      const resumed = everOpened;
      everOpened = true;
      attempt = 0;
      onStatus("open", { resumed });
    };
    source.onmessage = (e) => handle(e, null);
    for (const t of EVENT_TYPES) source.addEventListener(t, (e) => handle(e, t));
    source.onerror = () => {
      if (closedByUs) return;
      // CONNECTING: the browser retries on its own. CLOSED: the server refused (e.g. 401,
      // 404, wrong content type), so retry ourselves with backoff.
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        scheduleRetry();
      } else {
        onStatus("reconnecting", { attempt: attempt + 1 });
      }
    };
  }

  function scheduleRetry() {
    attempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5)) + Math.random() * 500;
    onStatus(attempt >= 4 ? "closed" : "reconnecting", { attempt, retryInMs: delay });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(open, delay);
  }

  function retryNow() {
    if (closedByUs) return;
    clearTimeout(retryTimer);
    if (source) source.close();
    open();
  }

  open();
  return {
    retryNow,
    close() {
      closedByUs = true;
      clearTimeout(retryTimer);
      if (source) source.close();
    },
  };
}
