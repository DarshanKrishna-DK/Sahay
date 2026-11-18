"use strict";

/**
 * The event bus. `emit` writes the audit row and hands the same event to the
 * subscribers of that business (the browser's SSE stream, narration, notifiers).
 * Inside a database transaction the audit row is part of that transaction and
 * subscribers hear about it only after the commit.
 *
 * Event: { id, ts, businessId, sessionId, actor, type, data } - `id` is the audit row id.
 */

const db = require("./db");
const repo = require("./db/repo");

const ACTORS = ["owner", "agent", "system", "vendor"];
const TYPE_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)*$/;
const HEARTBEAT_MS = 15_000;
const REPLAY_PAGE = 200;
const MAX_TIMER_MS = 2 ** 31 - 1;

class EventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventError";
    this.code = code;
  }
}

const subscribers = new Map();
const everyBusiness = new Set();
const openStreams = new Set();

function reportSubscriberFailure(event, err) {
  console.error(`[events] a subscriber failed on "${event.type}" (event ${event.id}): ${err?.message ?? err}`);
}

function deliver(event) {
  for (const fn of [...(subscribers.get(event.businessId) ?? []), ...everyBusiness]) {
    try {
      const pending = fn(event);
      if (pending && typeof pending.catch === "function") pending.catch((err) => reportSubscriberFailure(event, err));
    } catch (err) {
      reportSubscriberFailure(event, err);
    }
  }
}

/**
 * Record an event and fan it out. If `data` concerns a simulated vendor or
 * negotiation, the event is labelled as such here, whatever the caller passed.
 */
function emit(businessId, type, data = {}, { sessionId = null, actor = "system" } = {}) {
  if (typeof type !== "string" || !TYPE_PATTERN.test(type)) {
    throw new EventError("INVALID_TYPE", 'An event type looks like "job.progress".');
  }
  if (!ACTORS.includes(actor)) throw new EventError("INVALID_ACTOR", `actor must be one of: ${ACTORS.join(", ")}.`);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new EventError("INVALID_DATA", "Event data must be an object.");
  }

  // What subscribers receive is exactly what a later replay from the audit log will contain.
  let detail = JSON.parse(JSON.stringify(data));
  if (concernsSimulated(businessId, detail)) detail = { ...detail, simulated: true, vendorLabel: repo.SIMULATED_LABEL };

  const row = repo.appendAudit(businessId, { session_id: sessionId, actor, type, detail });
  const event = toEvent(row);
  db.afterCommit(() => deliver(event));
  return event;
}

const REFERENCE_KEYS = ["orderId", "approvalId", "quoteId", "negotiationId", "vendorId"];

/**
 * True when the data, at any depth, names a simulated order, approval, quote,
 * negotiation or vendor of this business, or a simulated counterpart.
 */
function concernsSimulated(businessId, value) {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, inner]) => {
    if (key === "counterpart" && inner === "simulated") return true;
    if (REFERENCE_KEYS.includes(key) && typeof inner === "string") return repo.isSimulated(businessId, { [key]: inner });
    return concernsSimulated(businessId, inner);
  });
}

function toEvent(row) {
  return {
    id: row.id,
    ts: row.ts,
    businessId: row.business_id,
    sessionId: row.session_id,
    actor: row.actor,
    type: row.type,
    data: row.detail,
  };
}

/** Receive every event of one business. Returns the function that stops it. */
function subscribe(businessId, fn) {
  if (typeof businessId !== "string" || businessId === "") throw new EventError("BUSINESS_REQUIRED", "A business id is required.");
  if (typeof fn !== "function") throw new EventError("INVALID_SUBSCRIBER", "A subscriber is a function.");
  let set = subscribers.get(businessId);
  if (!set) subscribers.set(businessId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0 && subscribers.get(businessId) === set) subscribers.delete(businessId);
  };
}

/** Receive the events of every business. For server-internal listeners (notifiers), never for a client. */
function subscribeAll(fn) {
  if (typeof fn !== "function") throw new EventError("INVALID_SUBSCRIBER", "A subscriber is a function.");
  everyBusiness.add(fn);
  return () => everyBusiness.delete(fn);
}

function subscriberCount(businessId) {
  return subscribers.get(businessId)?.size ?? 0;
}

/**
 * Build the SSE route handler. It must be mounted behind `auth.requireSession`:
 * the business comes from `req.auth`, never from the request itself. Every
 * event is sent as a default `message` whose data is the event JSON. A client
 * that reconnects with Last-Event-ID first receives what it missed.
 */
function createSseHandler({ heartbeatMs = HEARTBEAT_MS } = {}) {
  return function sseHandler(req, res) {
    const businessId = req.auth?.businessId;
    if (!businessId) return res.status(401).json({ error: "unauthorized" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    const send = (event) => res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);

    const lastEventId = req.headers["last-event-id"];
    if (lastEventId !== undefined && /^\d+$/.test(lastEventId)) {
      let afterId = Number(lastEventId);
      for (;;) {
        const rows = repo.listAudit(businessId, { after_id: afterId, limit: REPLAY_PAGE });
        for (const row of rows) send(toEvent(row));
        if (rows.length < REPLAY_PAGE) break;
        afterId = rows[rows.length - 1].id;
      }
    }

    const unsubscribe = subscribe(businessId, send);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
    heartbeat.unref();
    // The stream must not outlive the session that opened it.
    const expiry = Number.isInteger(req.auth.exp)
      ? setTimeout(() => res.end(), Math.min(Math.max(req.auth.exp * 1000 - Date.now(), 0), MAX_TIMER_MS))
      : null;
    expiry?.unref();

    openStreams.add(res);
    res.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
      openStreams.delete(res);
    });
  };
}

const sseHandler = createSseHandler();

/** End every open SSE stream so the HTTP server can shut down. */
function closeStreams() {
  for (const res of openStreams) res.end();
}

module.exports = { EventError, emit, subscribe, subscribeAll, subscriberCount, sseHandler, createSseHandler, closeStreams };
