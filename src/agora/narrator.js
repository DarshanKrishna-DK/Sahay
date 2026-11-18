"use strict";

/**
 * Spoken progress for the owner's live call. Listens to the event bus and, for a
 * business with an active owner agent, speaks one native-script line per
 * milestone through /speak APPEND (after the reply in flight, never cutting it).
 *
 * Milestones: job.started (unless the tool that started it already said so),
 * the first vendor.found batch (count), job.done for sourcing (top result),
 * job.failed, negotiation.ended, order.created, payment.link, followup.fired.
 * Rate-limited per business: at most one line every MIN_GAP_MS, a short queue,
 * and repeated milestones of the same kind replace the queued one.
 */

const events = require("../events");
const repo = require("../db/repo");
const agent = require("./agent");
const { langKey } = require("../tools/errors");

const settings = { minGapMs: 5000, vendorDebounceMs: 2500, queueLimit: 3, suppressMs: 20000 };

/** businessId -> live narration state for the active owner call */
const live = new Map();
/** businessId -> Map(eventType -> until ms): lines a tool already spoke */
const suppressed = new Map();

let speakImpl = (agentId, text) => agent.speak(agentId, text, { priority: "APPEND", interruptable: true });
let unsubscribe = null;

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => String(round2(n));

const SIM = { "hi-IN": " (सिम्युलेटेड विक्रेता)", "kn-IN": " (ಸಿಮ್ಯುಲೇಟೆಡ್ ವೆಂಡರ್)", "en-IN": " (simulated vendor)" };

const LINES = {
  sourcing_started: {
    "hi-IN": () => "विक्रेताओं की खोज शुरू हो गई है।",
    "kn-IN": () => "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಶುರುವಾಗಿದೆ.",
    "en-IN": () => "The vendor search has started.",
  },
  negotiation_started: {
    "hi-IN": () => "मोल-भाव शुरू हो गया है।",
    "kn-IN": () => "ಚೌಕಾಸಿ ಶುರುವಾಗಿದೆ.",
    "en-IN": () => "The negotiation has started.",
  },
  vendors_found: {
    "hi-IN": (v) => `${v.count} विक्रेता मिल गए हैं, उनकी जाँच कर रहा हूँ।`,
    "kn-IN": (v) => `${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ, ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ.`,
    "en-IN": (v) => `${v.count} vendors found so far; checking them now.`,
  },
  sourcing_done: {
    "hi-IN": (v) => `खोज पूरी हुई, ${v.count} विक्रेता मिले; सबसे ऊपर ${v.name}${v.price ? `, लिस्टिंग भाव ${v.price} रुपये` : ""}।`,
    "kn-IN": (v) => `ಹುಡುಕಾಟ ಮುಗಿಯಿತು, ${v.count} ಮಾರಾಟಗಾರರು; ಮೊದಲನೆಯವರು ${v.name}${v.price ? `, ಪಟ್ಟಿಯ ಬೆಲೆ ${v.price} ರೂಪಾಯಿ` : ""}.`,
    "en-IN": (v) => `Search done: ${v.count} vendors; the top one is ${v.name}${v.price ? `, listed at ${v.price} rupees` : ""}.`,
  },
  job_failed: {
    "hi-IN": (v) => (v.kind === "negotiation" ? "मोल-भाव पूरा नहीं हो पाया, कारण स्क्रीन पर है।" : "विक्रेताओं की खोज पूरी नहीं हो पाई, कारण स्क्रीन पर है।"),
    "kn-IN": (v) => (v.kind === "negotiation" ? "ಚೌಕಾಸಿ ಮುಗಿಸಲು ಆಗಲಿಲ್ಲ, ಕಾರಣ ಪರದೆಯ ಮೇಲಿದೆ." : "ಮಾರಾಟಗಾರರ ಹುಡುಕಾಟ ಮುಗಿಸಲು ಆಗಲಿಲ್ಲ, ಕಾರಣ ಪರದೆಯ ಮೇಲಿದೆ."),
    "en-IN": (v) => (v.kind === "negotiation" ? "The negotiation could not be completed; the reason is on the screen." : "The vendor search could not be completed; the reason is on the screen."),
  },
  negotiation_agreed: {
    "hi-IN": (v) => `${v.vendor}${v.sim ? SIM["hi-IN"] : ""} से मोल-भाव पूरा, ${v.price} रुपये प्रति ${v.unit} पर बात बनी।`,
    "kn-IN": (v) => `${v.vendor}${v.sim ? SIM["kn-IN"] : ""} ಜೊತೆ ಚೌಕಾಸಿ ಮುಗಿಯಿತು, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿಗೆ ಒಪ್ಪಿಗೆಯಾಯಿತು.`,
    "en-IN": (v) => `The negotiation with ${v.vendor}${v.sim ? SIM["en-IN"] : ""} is done at ${v.price} rupees per ${v.unit}.`,
  },
  negotiation_no_deal: {
    "hi-IN": (v) => `${v.vendor}${v.sim ? SIM["hi-IN"] : ""} से सौदा नहीं बना।`,
    "kn-IN": (v) => `${v.vendor}${v.sim ? SIM["kn-IN"] : ""} ಜೊತೆ ವ್ಯವಹಾರ ಆಗಲಿಲ್ಲ.`,
    "en-IN": (v) => `No deal with ${v.vendor}${v.sim ? SIM["en-IN"] : ""}.`,
  },
  order_created: {
    "hi-IN": (v) => `ऑर्डर बन गया, खरीद आदेश नंबर ${v.po}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ಆಗಿದೆ, ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ ${v.po}.`,
    "en-IN": (v) => `The order is placed, purchase order ${v.po}.`,
  },
  payment_link: {
    "hi-IN": () => "भुगतान का टेस्ट लिंक बन गया है, स्क्रीन पर है।",
    "kn-IN": () => "ಪಾವತಿಯ ಟೆಸ್ಟ್ ಲಿಂಕ್ ಸಿದ್ಧ, ಪರದೆಯ ಮೇಲಿದೆ.",
    "en-IN": () => "The test-mode payment link is ready on the screen.",
  },
  followup: {
    "hi-IN": (v) => `याद दिलाना: ${v.message}`,
    "kn-IN": (v) => `ನೆನಪಿಸುವಿಕೆ: ${v.message}`,
    "en-IN": (v) => `Reminder: ${v.message}`,
  },
};

const line = (key, language, vars = {}) => LINES[key][langKey(language)](vars);

/** Tell the narrator a tool already spoke this milestone, so it is not said twice. */
function suppress(businessId, type, ms = settings.suppressMs) {
  if (!suppressed.has(businessId)) suppressed.set(businessId, new Map());
  suppressed.get(businessId).set(type, Date.now() + ms);
}

function isSuppressed(businessId, type) {
  const until = suppressed.get(businessId)?.get(type);
  if (!until) return false;
  suppressed.get(businessId).delete(type);
  return until >= Date.now();
}

/* ---------------------------------------------------------------- queue --- */

function enqueue(state, key, text) {
  const existing = state.queue.findIndex((item) => item.key === key);
  if (existing !== -1) state.queue.splice(existing, 1);
  state.queue.push({ key, text });
  while (state.queue.length > settings.queueLimit) state.queue.shift();
  pump(state);
}

function pump(state) {
  if (state.timer || !state.queue.length || state.closed) return;
  const wait = Math.max(0, state.lastSpokeAt + settings.minGapMs - Date.now());
  state.timer = setTimeout(async () => {
    state.timer = null;
    const item = state.queue.shift();
    if (!item || state.closed) return;
    state.lastSpokeAt = Date.now();
    try {
      await speakImpl(state.agentId, item.text);
    } catch (err) {
      console.warn(`[narrator] speak failed for ${item.key}: ${err.message}`);
    }
    pump(state);
  }, wait);
  state.timer.unref?.();
}

/* --------------------------------------------------------------- events --- */

function onEvent(event) {
  const state = live.get(event.businessId);
  if (!state) return;
  const d = event.data ?? {};
  const lang = state.language;
  switch (event.type) {
    case "job.started":
      if (isSuppressed(event.businessId, "job.started")) return;
      enqueue(state, "job.started", line(d.kind === "negotiation" ? "negotiation_started" : "sourcing_started", lang));
      return;
    case "vendor.found": {
      const requirementId = d.requirementId;
      if (state.vendorBatches.get(requirementId) === "spoken") return;
      const batch = state.vendorBatches.get(requirementId) ?? { count: 0, timer: null };
      batch.count += 1;
      state.vendorBatches.set(requirementId, batch);
      if (!batch.timer) {
        batch.timer = setTimeout(() => {
          state.vendorBatches.set(requirementId, "spoken");
          enqueue(state, `vendors:${requirementId}`, line("vendors_found", lang, { count: batch.count }));
        }, settings.vendorDebounceMs);
        batch.timer.unref?.();
      }
      return;
    }
    case "job.done": {
      if (d.kind !== "sourcing") return;
      const top = d.result?.shortlist?.[0];
      if (!top) return;
      // The final count replaces any queued "vendors found" line for this requirement.
      const requirementId = d.result.requirementId;
      const batch = state.vendorBatches.get(requirementId);
      if (batch && batch !== "spoken") clearTimeout(batch.timer);
      state.vendorBatches.set(requirementId, "spoken");
      state.queue = state.queue.filter((item) => item.key !== `vendors:${requirementId}`);
      enqueue(state, `sourcing:${requirementId}`, line("sourcing_done", lang, { count: d.result.count, name: top.name, price: top.listedPrice != null ? money(top.listedPrice) : null }));
      return;
    }
    case "job.failed":
      enqueue(state, `failed:${d.jobId}`, line("job_failed", lang, { kind: d.kind }));
      return;
    case "negotiation.ended": {
      const o = d.outcome ?? {};
      const vars = { vendor: o.vendorName ?? "", sim: Boolean(d.simulated || o.simulated), price: o.unitPrice != null ? money(o.unitPrice) : null, unit: o.unitWord ?? o.unit ?? "" };
      enqueue(state, `negotiation:${d.negotiationId}`, line(o.agreed && vars.price ? "negotiation_agreed" : "negotiation_no_deal", lang, vars));
      return;
    }
    case "order.created":
      if (isSuppressed(event.businessId, "order.created")) return;
      enqueue(state, `order:${d.orderId}`, line("order_created", lang, { po: d.poNumber ?? d.po_number }));
      return;
    case "payment.link":
      if (isSuppressed(event.businessId, "payment.link")) return;
      enqueue(state, `payment:${d.orderId}`, line("payment_link", lang));
      return;
    case "followup.fired":
      if (d.message) enqueue(state, `followup:${d.followupId ?? d.orderId}`, line("followup", lang, { message: d.message }));
      return;
    default:
  }
}

/** Follow-ups that fired since the previous owner call ended, to say at the start of this one. */
function missedFollowups(businessId, currentSessionId) {
  const ended = repo
    .listSessions(businessId, { kind: "owner" })
    .filter((s) => s.id !== currentSessionId && s.ended_at)
    .map((s) => s.ended_at)
    .sort();
  const since = ended.length ? ended[ended.length - 1] : null;
  return repo.listFollowups(businessId, { status: "fired" }).filter((f) => f.fired_at && (!since || f.fired_at > since));
}

/**
 * Start narrating for a business's active owner call. Call after the disclosure
 * was sent, so narration queues behind it.
 */
function attach(businessId, { agentId, sessionId, language }) {
  detach(businessId);
  const state = { agentId, sessionId, language: langKey(language), queue: [], lastSpokeAt: Date.now(), timer: null, vendorBatches: new Map(), closed: false };
  live.set(businessId, state);
  for (const f of missedFollowups(businessId, sessionId)) {
    if (f.message) enqueue(state, `followup:${f.id}`, line("followup", state.language, { message: f.message }));
  }
  return state;
}

function detach(businessId) {
  const state = live.get(businessId);
  if (!state) return;
  state.closed = true;
  clearTimeout(state.timer);
  for (const batch of state.vendorBatches.values()) if (batch && batch !== "spoken") clearTimeout(batch.timer);
  live.delete(businessId);
}

function isLive(businessId) {
  return live.has(businessId);
}

/** Subscribe to every business's events. Returns stop(). */
function start() {
  if (!unsubscribe) unsubscribe = events.subscribeAll(onEvent);
  return stop;
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  for (const businessId of [...live.keys()]) detach(businessId);
}

/** Tests: replace the /speak call and the timing. */
function configure({ speak, minGapMs, vendorDebounceMs, queueLimit, suppressMs } = {}) {
  if (speak) speakImpl = speak;
  Object.assign(
    settings,
    Object.fromEntries(Object.entries({ minGapMs, vendorDebounceMs, queueLimit, suppressMs }).filter(([, v]) => v !== undefined)),
  );
}

module.exports = { start, stop, attach, detach, isLive, suppress, configure, onEvent, LINES };
