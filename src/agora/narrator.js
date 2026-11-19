"use strict";

/**
 * Spoken progress for the owner's live call. Listens to the event bus and, for a
 * business with an active owner agent, speaks one native-script line per
 * milestone through /speak APPEND (after the reply in flight, never cutting it).
 *
 * Milestones: job.started (unless the tool that started it already said so),
 * the first vendor.found batch (count), job.done for sourcing (top result),
 * job.failed, negotiation.ended, order.created, payment.link, followup.fired.
 * A follow-up is worded from its order (PO number, amount) in the owner's current language,
 * never by prefixing the stored message, which is in the business language (E2E r3 bug 3).
 * Rate-limited per business: at most one line every MIN_GAP_MS, a short queue,
 * and repeated milestones of the same kind replace the queued one.
 *
 * Order: a sourcing job can finish within a second, while the model is still
 * saying the tool's own "search started" line. Results of a job (vendor count,
 * job.done, job.failed) are therefore held until holdMs after the job started;
 * a job.done inside that window replaces the vendor count, so one result is spoken.
 * Lines follow the language the owner last used (useLanguage), else the call's.
 *
 * A result a tool already spoke (get_job_status or get_shortlist after the search finished)
 * is suppressed per requirement ("sourcing.done:<requirementId>"), even while it waits in the
 * hold window or the queue, so the owner hears "search done" once (E2E r2).
 *
 * Approval hold: from approval.requested (or holdForApproval) until that approval is decided,
 * the request fails, or settings.approvalHoldMs passes, nothing is spoken. The server speaks the
 * read-back and the owner's next words are the answer to it (approvals.answerToReadback); a
 * progress line between the two would stand between the question and the answer (E2E r3, item 5).
 *
 * Every hi/kn line is checked for stray Latin letters and for the other Indic script
 * (src/agora/script.js) before it is spoken; a violation is logged, never silently sent.
 *
 * /speak lines are not documented to enter the owner agent's LLM context, so every job
 * milestone is also written to the agent as a "Call status" system message
 * (agent.updateCallStatus). Without it the model answered "already negotiating" after a
 * negotiation had ended, and did not call start_negotiation again (E2E r2).
 */

const events = require("../events");
const repo = require("../db/repo");
const agent = require("./agent");
const { langKey } = require("../tools/errors");
const { unitWord } = require("../procurement/units");
const { scriptProblems } = require("./script");

const settings = { minGapMs: 5000, vendorDebounceMs: 2500, queueLimit: 3, suppressMs: 20000, holdMs: 6000, approvalHoldMs: 60000 };

/** businessId -> live narration state for the active owner call */
const live = new Map();
/** businessId -> Map(eventType -> until ms): lines a tool already spoke */
const suppressed = new Map();

let speakImpl = (agentId, text) => agent.speak(agentId, text, { priority: "APPEND", interruptable: true });
let statusImpl = (agentId, text) => agent.updateCallStatus(agentId, text);
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
    "hi-IN": (v) => `${v.count} विक्रेता मिल गए हैं, उनकी जाँच कर रही हूँ।`,
    "kn-IN": (v) => `${v.count} ಮಾರಾಟಗಾರರು ಸಿಕ್ಕಿದ್ದಾರೆ, ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ.`,
    "en-IN": (v) => `${v.count} vendors found so far; checking them now.`,
  },
  sourcing_done: {
    "hi-IN": (v) => `खोज पूरी हुई, ${v.count} विक्रेता मिले; सबसे अच्छे ${v.name}${v.price ? `, ${v.price} रुपये प्रति ${v.unit}` : ""}।`,
    "kn-IN": (v) => `ಹುಡುಕಾಟ ಮುಗಿಯಿತು, ${v.count} ಮಾರಾಟಗಾರರು; ಉತ್ತಮರು ${v.name}${v.price ? `, ಒಂದು ${v.unit}ಗೆ ${v.price} ರೂಪಾಯಿ` : ""}.`,
    "en-IN": (v) => `Search done: ${v.count} vendors; the best is ${v.name}${v.price ? `, at ${v.price} rupees per ${v.unit}` : ""}.`,
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
    "hi-IN": (v) => `ऑर्डर बन गया${v.sim ? SIM["hi-IN"] : ""}, खरीद आदेश नंबर ${v.po}।`,
    "kn-IN": (v) => `ಆರ್ಡರ್ ಆಗಿದೆ${v.sim ? SIM["kn-IN"] : ""}, ಖರೀದಿ ಆದೇಶ ಸಂಖ್ಯೆ ${v.po}.`,
    "en-IN": (v) => `The order is placed${v.sim ? SIM["en-IN"] : ""}, purchase order ${v.po}.`,
  },
  payment_link: {
    "hi-IN": () => "भुगतान का टेस्ट लिंक बन गया है, स्क्रीन पर है।",
    "kn-IN": () => "ಪಾವತಿಯ ಟೆಸ್ಟ್ ಲಿಂಕ್ ಸಿದ್ಧ, ಪರದೆಯ ಮೇಲಿದೆ.",
    "en-IN": () => "The test-mode payment link is ready on the screen.",
  },
  followup_payment_due: {
    "hi-IN": (v) => `याद दिला दूँ: ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""} का भुगतान बाकी है, ${v.amount} रुपये।`,
    "kn-IN": (v) => `ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""} ಪಾವತಿ ಬಾಕಿ ಇದೆ, ${v.amount} ರೂಪಾಯಿ.`,
    "en-IN": (v) => `A reminder: payment for order ${v.po}${v.sim ? SIM["en-IN"] : ""} is due, ${v.amount} rupees.`,
  },
  followup_delivery_check: {
    "hi-IN": (v) => `याद दिला दूँ: ऑर्डर ${v.po}${v.sim ? SIM["hi-IN"] : ""} की डिलीवरी का समय हो गया है, क्या माल पहुँच गया?`,
    "kn-IN": (v) => `ನೆನಪಿಸುತ್ತಿದ್ದೇನೆ: ಆರ್ಡರ್ ${v.po}${v.sim ? SIM["kn-IN"] : ""} ಡೆಲಿವರಿ ಸಮಯ ಬಂದಿದೆ, ಸರಕು ತಲುಪಿದೆಯೇ?`,
    "en-IN": (v) => `A reminder: order ${v.po}${v.sim ? SIM["en-IN"] : ""} is due for delivery; has it arrived?`,
  },
  followup_other: {
    "hi-IN": () => "एक रिमाइंडर स्क्रीन पर है।",
    "kn-IN": () => "ಒಂದು ನೆನಪಿನ ಸೂಚನೆ ಪರದೆಯ ಮೇಲಿದೆ.",
    "en-IN": () => "A reminder is on the screen.",
  },
};

/** Variables that hold a name or code as written (vendor brand, PO number): allowed in any script. */
const VERBATIM_VARS = ["name", "vendor", "po"];

/** One spoken line. A hi/kn line with stray Latin or the other Indic script is logged (rule 5). */
function line(key, language, vars = {}) {
  const lang = langKey(language);
  const text = LINES[key][lang](vars);
  const problems = scriptProblems(text, lang, { allow: VERBATIM_VARS.map((k) => vars[k]) });
  if (problems.latin.length || problems.foreign) {
    console.warn(`[narrator] ${key} (${lang}) is not all in its own script: ${[...problems.latin, problems.foreign ? "<other Indic script>" : null].filter(Boolean).join(", ")}`);
  }
  return text;
}

/**
 * A follow-up as one line in `language`, from its order: the stored message is in the business
 * language, and prefixing it with a word in the owner's language mixed two scripts in one line.
 */
function followupLine(businessId, followup, language) {
  const key = { payment_due: "followup_payment_due", delivery_check: "followup_delivery_check" }[followup?.kind];
  const order = followup?.orderId ? repo.getOrder(businessId, followup.orderId) : null;
  if (!key || !order?.po_number) return line("followup_other", language);
  return line(key, language, { po: order.po_number, amount: money(Number(order.amount)), sim: Boolean(order.simulated) });
}

/**
 * Tell the narrator a tool already spoke this milestone, so it is not said twice: a line of
 * this type still waiting in the queue is dropped, and one still held back is never queued.
 */
function suppress(businessId, type, ms = settings.suppressMs) {
  if (!suppressed.has(businessId)) suppressed.set(businessId, new Map());
  suppressed.get(businessId).set(type, Date.now() + ms);
  const state = live.get(businessId);
  if (state) state.queue = state.queue.filter((item) => item.type !== type);
}

function isSuppressed(businessId, type) {
  const until = suppressed.get(businessId)?.get(type);
  if (!until) return false;
  suppressed.get(businessId).delete(type);
  return until >= Date.now();
}

/* ---------------------------------------------------------------- queue --- */

function enqueue(state, key, text, type = null) {
  const existing = state.queue.findIndex((item) => item.key === key);
  if (existing !== -1) state.queue.splice(existing, 1);
  state.queue.push({ key, text, type });
  while (state.queue.length > settings.queueLimit) state.queue.shift();
  pump(state);
}

/** Milliseconds the approval hold still lasts (0 when none); an expired hold is cleared. */
function approvalHoldLeft(state) {
  if (!state.approvalHold) return 0;
  const left = state.approvalHold.until - Date.now();
  if (left > 0) return left;
  state.approvalHold = null;
  return 0;
}

function pump(state) {
  if (state.timer || !state.queue.length || state.closed) return;
  const wait = Math.max(0, state.lastSpokeAt + settings.minGapMs - Date.now(), approvalHoldLeft(state));
  state.timer = setTimeout(async () => {
    state.timer = null;
    if (state.closed) return;
    if (approvalHoldLeft(state) > 0) return pump(state);
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

/* ----------------------------------------------------------- call status --- */

/**
 * English for the model, not for speech: what is running and how the last jobs ended.
 * These become a SYSTEM message, so they carry only server-made words and numbers: never a
 * vendor's name or listing title, which a seller controls (security review r1 #5). The model
 * gets names from tool results (get_shortlist, get_ranked_deals) when it needs them.
 */
const STATUS = {
  sourcingRunning: () => "A vendor search is running now; its result will be announced to the owner automatically.",
  sourcingDone: (v) =>
    `The vendor search has finished: ${v.count} vendors found${v.price ? `; the best-ranked vendor with a comparable price lists ${v.price} rupees per ${v.unit} (get_shortlist has the names)` : ""}. No search is running now.`,
  sourcingFailed: () => "The last vendor search failed. No search is running now; if the owner asks to search again, call start_sourcing.",
  negotiationRunning: () =>
    "A negotiation is running now; its result will be announced to the owner automatically. If the owner asks to negotiate before it ends, call start_negotiation anyway: it will say one is running.",
  negotiationEnded: (v) =>
    `The negotiation with ${v.sim ? "the simulated vendor" : "the vendor"} has ended ${v.price ? `with a quote of ${v.price} rupees per ${v.unit}, which the owner has not approved; get_ranked_deals has it` : "with no deal"}. No negotiation is running now. If the owner asks to negotiate again, call start_negotiation.`,
  negotiationFailed: () => "The last negotiation stopped before a result. No negotiation is running now. If the owner asks to negotiate again, call start_negotiation.",
};

/** Write the job state into the owner agent's LLM context; in order, never blocking speech. */
function setStatus(state, kind, text) {
  state.callStatus[kind] = text;
  const combined = [state.callStatus.negotiation, state.callStatus.sourcing].filter(Boolean).join(" ");
  state.statusChain = state.statusChain.then(async () => {
    if (state.closed) return;
    try {
      await statusImpl(state.agentId, combined);
    } catch (err) {
      console.warn(`[narrator] call status update failed: ${err.message}`);
    }
  });
}

/* -------------------------------------------------------- approval hold --- */

/** Hold narration; a line already waiting on its timer re-checks the hold when the timer fires. */
function startHold(state, approvalId, ms = settings.approvalHoldMs) {
  state.approvalHold = { approvalId: approvalId ?? state.approvalHold?.approvalId ?? null, until: Date.now() + ms };
}

function endHold(state) {
  if (!state.approvalHold) return;
  state.approvalHold = null;
  clearTimeout(state.timer);
  state.timer = null;
  pump(state);
}

/**
 * Hold narration for this business's live call while an approval read-back is spoken and
 * answered. request_approval should call this before its /speak of the read-back, so even the
 * moment between that speak and the approval.spoken event is covered.
 */
function holdForApproval(businessId, approvalId = null, ms = settings.approvalHoldMs) {
  const state = live.get(businessId);
  if (state) startHold(state, approvalId, ms);
}

function isHeld(businessId) {
  const state = live.get(businessId);
  return Boolean(state && approvalHoldLeft(state) > 0);
}

/* --------------------------------------------------------------- events --- */

/** Milliseconds left until a job's results may be spoken (0 when its start is unknown or long past). */
function holdLeft(state, jobId) {
  const startedAt = jobId ? state.jobStartedAt.get(jobId) : state.lastSourcingStartedAt;
  return startedAt == null ? 0 : Math.max(0, startedAt + settings.holdMs - Date.now());
}

/** Run `fn` after `ms` (at once when 0), on a timer that detach() clears. */
function later(state, ms, fn) {
  if (ms <= 0) return fn();
  const timer = setTimeout(() => {
    state.timers.delete(timer);
    if (!state.closed) fn();
  }, ms);
  timer.unref?.();
  state.timers.add(timer);
}

function onEvent(event) {
  const state = live.get(event.businessId);
  if (!state) return;
  const d = event.data ?? {};
  const lang = state.language;
  switch (event.type) {
    case "job.started":
      state.jobStartedAt.set(d.jobId, Date.now());
      if (d.kind === "sourcing") state.lastSourcingStartedAt = Date.now();
      if (d.kind === "negotiation") setStatus(state, "negotiation", STATUS.negotiationRunning());
      else if (d.kind === "sourcing") setStatus(state, "sourcing", STATUS.sourcingRunning());
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
          enqueue(state, `vendors:${requirementId}`, line("vendors_found", state.language, { count: batch.count }), `sourcing.done:${requirementId}`);
        }, Math.max(settings.vendorDebounceMs, holdLeft(state, null)));
        batch.timer.unref?.();
      }
      return;
    }
    case "job.done": {
      if (d.kind !== "sourcing") return;
      const result = d.result ?? {};
      // The best vendor whose price is per the requirement unit; a per-bag price is never read out as if per kg.
      const top = result.shortlist?.find((v) => v.comparablePrice != null) ?? result.shortlist?.[0];
      if (!top) return;
      // The final count replaces any pending "vendors found" line for this requirement.
      const requirementId = result.requirementId;
      const batch = state.vendorBatches.get(requirementId);
      if (batch && batch !== "spoken") clearTimeout(batch.timer);
      state.vendorBatches.set(requirementId, "spoken");
      state.queue = state.queue.filter((item) => item.key !== `vendors:${requirementId}`);
      const price = top.comparablePrice != null ? money(top.comparablePrice) : null;
      setStatus(state, "sourcing", STATUS.sourcingDone({ count: result.count, price: top.comparablePrice != null ? price : null, unit: unitWord(result.unit, "en-IN") }));
      const type = `sourcing.done:${requirementId}`;
      later(state, holdLeft(state, d.jobId), () => {
        // get_job_status or get_shortlist already said this result: say it once.
        if (isSuppressed(event.businessId, type)) return;
        enqueue(state, `sourcing:${requirementId}`, line("sourcing_done", state.language, { count: result.count, name: top.name, price, unit: unitWord(result.unit, state.language) }), type);
      });
      return;
    }
    case "job.failed":
      if (d.kind === "negotiation") setStatus(state, "negotiation", STATUS.negotiationFailed());
      else setStatus(state, "sourcing", STATUS.sourcingFailed());
      later(state, holdLeft(state, d.jobId), () => enqueue(state, `failed:${d.jobId}`, line("job_failed", state.language, { kind: d.kind })));
      return;
    case "negotiation.ended": {
      const o = d.outcome ?? {};
      const unit = o.unit ? unitWord(o.unit, lang) : o.unitWord ?? "";
      const vars = { vendor: o.vendorName ?? "", sim: Boolean(d.simulated || o.simulated), price: o.unitPrice != null ? money(o.unitPrice) : null, unit };
      setStatus(state, "negotiation", STATUS.negotiationEnded({
        sim: vars.sim,
        price: o.agreed ? vars.price : null,
        unit: o.unit ? unitWord(o.unit, "en-IN") : "unit",
      }));
      enqueue(state, `negotiation:${d.negotiationId}`, line(o.agreed && vars.price ? "negotiation_agreed" : "negotiation_no_deal", lang, vars));
      return;
    }
    case "order.created":
      if (isSuppressed(event.businessId, "order.created")) return;
      enqueue(state, `order:${d.orderId}`, line("order_created", lang, { po: d.poNumber ?? d.po_number, sim: Boolean(d.simulated) }));
      return;
    case "payment.link":
      if (isSuppressed(event.businessId, "payment.link")) return;
      enqueue(state, `payment:${d.orderId}`, line("payment_link", lang));
      return;
    case "followup.fired":
      enqueue(state, `followup:${d.followupId ?? d.orderId}`, followupLine(event.businessId, d, lang));
      return;
    case "approval.requested":
    case "approval.spoken":
      startHold(state, d.approvalId);
      return;
    case "approval.decided": {
      const hold = state.approvalHold;
      // A deal the system withdrew (it carries a reason) does not answer the read-back being held for.
      if (hold && (hold.approvalId ? hold.approvalId === d.approvalId : !d.reason)) endHold(state);
      return;
    }
    case "error":
      if (d.tool === "request_approval") endHold(state);
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
  const state = {
    agentId,
    sessionId,
    language: langKey(language),
    queue: [],
    lastSpokeAt: Date.now(),
    timer: null,
    timers: new Set(),
    vendorBatches: new Map(),
    jobStartedAt: new Map(),
    lastSourcingStartedAt: null,
    callStatus: { sourcing: null, negotiation: null },
    statusChain: Promise.resolve(),
    approvalHold: null,
    closed: false,
  };
  live.set(businessId, state);
  for (const f of missedFollowups(businessId, sessionId)) {
    enqueue(state, `followup:${f.id}`, followupLine(businessId, { kind: f.kind, orderId: f.order_id }, state.language));
  }
  return state;
}

function detach(businessId) {
  const state = live.get(businessId);
  if (!state) return;
  state.closed = true;
  clearTimeout(state.timer);
  for (const timer of state.timers) clearTimeout(timer);
  for (const batch of state.vendorBatches.values()) if (batch && batch !== "spoken") clearTimeout(batch.timer);
  live.delete(businessId);
}

/** The owner just spoke `language` (a tool's reply_language): narrate in it from now on. */
function useLanguage(businessId, language) {
  const state = live.get(businessId);
  if (state) state.language = langKey(language);
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

/** Tests: replace the /speak and /update calls and the timing. */
function configure({ speak, status, minGapMs, vendorDebounceMs, queueLimit, suppressMs, holdMs, approvalHoldMs } = {}) {
  if (speak) speakImpl = speak;
  if (status) statusImpl = status;
  Object.assign(
    settings,
    Object.fromEntries(Object.entries({ minGapMs, vendorDebounceMs, queueLimit, suppressMs, holdMs, approvalHoldMs }).filter(([, v]) => v !== undefined)),
  );
}

module.exports = { start, stop, attach, detach, isLive, isHeld, holdForApproval, suppress, useLanguage, configure, onEvent, LINES, VERBATIM_VARS };
