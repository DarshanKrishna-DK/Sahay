// Server-sent events from GET /api/events (src/events.js). Every event is a default
// "message" event (no `event:` line) with an `id:` line and data JSON
// { id, ts, businessId, sessionId, actor, type, data }. On reconnect the browser sends
// Last-Event-ID and the server replays what was missed; ids are de-duplicated here.

const MAX_BACKOFF_MS = 30000;

/**
 * connectEvents({ onEvent, onStatus }) -> { close(), retryNow() }
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
    if (id === undefined || id === null || id === "") return true;
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    seenOrder.push(key);
    if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
    return true;
  }

  function handle(raw) {
    let evt;
    try { evt = JSON.parse(raw.data); } catch { return; }
    if (!evt || typeof evt !== "object" || typeof evt.type !== "string") return;
    const id = evt.id ?? (raw.lastEventId || null);
    if (!remember(id)) return;
    onEvent({
      id,
      ts: evt.ts ?? null,
      type: evt.type,
      actor: typeof evt.actor === "string" ? evt.actor : null,
      sessionId: evt.sessionId ?? null,
      data: evt.data && typeof evt.data === "object" ? evt.data : {},
    });
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
    source.onmessage = handle;
    source.onerror = () => {
      if (closedByUs) return;
      // CONNECTING: the browser retries on its own. CLOSED: the server refused (e.g. 401),
      // so retry ourselves with backoff.
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
