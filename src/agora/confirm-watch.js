"use strict";

/**
 * The confirmation watchdog (E2E full run, bug 1). After the server has read something out and
 * asked for a yes (a deal, a bill, a payment received, a rule, a low-stock reorder), the owner's
 * spoken answer must reach that thing's confirm tool. In long calls the model sometimes answered
 * a yes from memory ("बिल बन गया", "लिख लिया") without calling the tool, so nothing happened while
 * the owner was told it had.
 *
 * While such a question waits in a live owner call, this polls the call's Agora /history. When the
 * owner's answer to it is there (approvals.answerAfterSpoken: the same ordering check the gates
 * use) and is a clear yes or a clear no, and no confirm tool of that kind has run since, the server
 * calls that confirm tool itself after `graceMs`, through registry.callTool: the very same tool,
 * gate and audit row as when the model calls it. Nothing is decided here: an unclear answer is
 * left alone, and a gate refusal is said aloud as "अभी हुआ नहीं। <the gate's reason>". A success
 * is said by the tool itself (src/agora/outcome.js).
 *
 * In memory per live call; it never runs without a live owner call (narrator.liveCall).
 */

const db = require("../db");
const events = require("../events");
const approvals = require("../approvals");
const toolCalls = require("../tools/calls");
const outcome = require("./outcome");

/**
 * pollMs: how often /history is read while something waits. graceMs: how long the model has, from
 * the moment the answer is seen, to call the confirm tool itself. seenSlackMs: how much earlier than
 * that moment a model call still counts as answering it (one poll interval plus /history lag).
 */
const settings = { pollMs: 1500, graceMs: 6000, maxAgeMs: 3 * 60 * 1000, historyTimeoutMs: 4000, seenSlackMs: 4500 };

/**
 * What can wait for a spoken answer, newest read-back first. `pending` lists, for this call's
 * agent, every subject still waiting with the texts the server spoke for it and when.
 */
const KINDS = {
  approval: {
    tool: "confirm_approval",
    args: (s, answer) => ({ approvalId: s.id, decision: answer === "affirmative" ? "approve" : "reject" }),
    pending: (businessId, agentId) =>
      grouped(
        db
          .prepare("SELECT r.approval_id AS id, r.spoken_text, r.spoken_at FROM approval_readbacks r JOIN approvals a ON a.id = r.approval_id WHERE r.business_id = ? AND r.agent_id = ? AND a.status = 'pending' ORDER BY r.spoken_at, r.rowid")
          .all(businessId, agentId),
        (id) => ({ approvalId: id }),
      ),
  },
  invoice: {
    tool: "confirm_invoice",
    args: (s, answer) => ({ invoiceId: s.invoiceId, decision: answer === "affirmative" ? "approve" : "reject" }),
    pending: (businessId, agentId) =>
      grouped(
        db
          .prepare("SELECT r.approval_id AS id, a.invoice_id, r.spoken_text, r.spoken_at FROM invoice_readbacks r JOIN invoice_approvals a ON a.id = r.approval_id WHERE r.business_id = ? AND r.agent_id = ? AND a.status = 'pending' ORDER BY r.spoken_at, r.rowid")
          .all(businessId, agentId),
        () => ({}),
      ),
  },
  receipt: {
    tool: "record_payment",
    args: (s, answer) => ({ decision: answer === "affirmative" ? "confirm" : "cancel" }),
    pending: (businessId, agentId) =>
      grouped(
        db
          .prepare("SELECT id, spoken_text, spoken_at FROM receipt_readbacks WHERE business_id = ? AND agent_id = ? AND status = 'pending' AND spoken_text IS NOT NULL ORDER BY spoken_at, rowid")
          .all(businessId, agentId),
        () => ({}),
      ),
  },
  rule: {
    tool: "confirm_rule",
    args: (s, answer) => ({ ruleId: s.id, decision: answer === "affirmative" ? "keep" : "forget" }),
    pending: (businessId, agentId) =>
      grouped(
        db
          .prepare("SELECT r.rule_id AS id, r.spoken_text, r.spoken_at FROM rule_readbacks r JOIN agent_rules g ON g.id = r.rule_id WHERE r.business_id = ? AND r.agent_id = ? AND g.status = 'suggested' ORDER BY r.spoken_at, r.rowid")
          .all(businessId, agentId),
        (id) => ({ ruleId: id }),
      ),
  },
  reorder: {
    tool: "confirm_reorder",
    args: (s, answer) => ({ decision: answer === "affirmative" ? "yes" : "no" }),
    pending: (businessId, agentId) =>
      grouped(
        db
          .prepare("SELECT r.proposal_id AS id, r.spoken_text, r.spoken_at FROM reorder_readbacks r JOIN reorder_proposals p ON p.id = r.proposal_id WHERE r.business_id = ? AND r.agent_id = ? AND p.status = 'open' ORDER BY r.spoken_at, r.rowid")
          .all(businessId, agentId),
        () => ({}),
      ),
  },
};

/** Rows of one readbacks table -> one subject per id: {id, spoken[], spokenAt, subject, invoiceId?}. */
function grouped(rows, subjectOf) {
  const byId = new Map();
  for (const row of rows) {
    const entry = byId.get(row.id) ?? { id: row.id, spoken: [], spokenAt: row.spoken_at, subject: subjectOf(row.id), invoiceId: row.invoice_id ?? null };
    entry.spoken.push(row.spoken_text);
    if (row.spoken_at > entry.spokenAt) entry.spokenAt = row.spoken_at;
    byId.set(row.id, entry);
  }
  return [...byId.values()];
}

/** The question read out last in this call that still waits, or null (the owner's answer goes to the one read out last). */
function latestWaiting(businessId, agentId, now = Date.now()) {
  let latest = null;
  for (const [kind, spec] of Object.entries(KINDS)) {
    for (const s of spec.pending(businessId, agentId)) {
      if (now - Date.parse(s.spokenAt) > settings.maxAgeMs) continue;
      if (!latest || s.spokenAt > latest.spokenAt) latest = { ...s, kind };
    }
  }
  return latest;
}

/* ------------------------------------------------------------- polling --- */

let historyImpl = (agentId) => require("./agent").history(agentId, { timeoutMs: settings.historyTimeoutMs });
let liveImpl = (businessId) => require("./narrator").liveCall(businessId);
let callToolImpl = (ctx, name, args) => require("../tools/registry").callTool(ctx, name, args);

/** businessId -> { timer, seen: Map(key -> firstSeenMs), acted: Set(key) } */
const watching = new Map();
/** businessId -> { tool, at }: the confirm tool the server ran last for an owner's answer. */
const done = new Map();

/** True while this subject still waits for the owner's answer. */
const stillWaiting = (businessId, agentId, subject) => KINDS[subject.kind].pending(businessId, agentId).some((s) => s.id === subject.id);

/** How long after the server acted a late model call of the same tool is told it is already done. */
const DONE_RECENTLY_MS = 60 * 1000;

/**
 * True when the server ran `tool` for the owner's answer within DONE_RECENTLY_MS: the model's own
 * call of it, arriving late, then finds nothing waiting and is told it is done instead of refused
 * (registry.callTool), so it does not tell the owner "there is no bill".
 */
function doneRecently(businessId, tool, at = Date.now()) {
  const last = done.get(businessId);
  return Boolean(last && last.tool === tool && at - last.at <= DONE_RECENTLY_MS);
}

const answerKey = (s, turnId) => `${s.kind}:${s.id}:${turnId}`;

/** Start (or keep) polling a business's live call. */
function watch(businessId) {
  if (!liveImpl(businessId)?.agentId) return;
  let state = watching.get(businessId);
  if (!state) {
    state = { timer: null, seen: new Map(), acted: new Set(), busy: false };
    watching.set(businessId, state);
  }
  schedule(businessId, state);
}

function schedule(businessId, state) {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    tick(businessId).catch((err) => console.warn(`[confirm-watch] ${err.message}`));
  }, settings.pollMs);
  state.timer.unref?.();
}

function unwatch(businessId) {
  const state = watching.get(businessId);
  if (!state) return;
  clearTimeout(state.timer);
  watching.delete(businessId);
}

/**
 * One look at the call. Returns what it did, for tests: "idle" (nothing waits: polling stops),
 * "waiting" (no answer yet, or an unclear one), "grace" (an answer is there, the model has
 * `graceMs` to act), "model" (the model called the confirm tool), or "acted".
 */
async function tick(businessId, now = () => Date.now()) {
  const state = watching.get(businessId);
  const call = liveImpl(businessId);
  if (!state || !call?.agentId) {
    unwatch(businessId);
    return "idle";
  }
  if (state.busy) return "waiting";
  state.busy = true;
  try {
    const result = await look(businessId, state, call, now);
    if (result === "idle") unwatch(businessId);
    else schedule(businessId, state);
    return result;
  } finally {
    state.busy = false;
  }
}

async function look(businessId, state, call, now) {
  const subject = latestWaiting(businessId, call.agentId, now());
  if (!subject) return "idle";
  const spec = KINDS[subject.kind];
  if (toolCalls.inFlight(businessId, [spec.tool])) return "waiting";

  let history;
  try {
    history = await historyImpl(call.agentId);
  } catch {
    return "waiting"; // /history is unavailable now; look again on the next tick
  }
  let answer;
  try {
    answer = approvals.answerAfterSpoken(businessId, history, { agentId: call.agentId, spoken: subject.spoken, subject: { ...subject.subject, kind: subject.kind } });
  } catch {
    return "waiting"; // no spoken answer after the read-back yet (or it was typed, or another question came after it)
  }
  const kindOfAnswer = approvals.classifyUtterance(answer.text);
  if (kindOfAnswer !== "affirmative" && kindOfAnswer !== "negative") return "waiting"; // a maybe or a question is the model's to handle

  const key = answerKey(subject, answer.turnId);
  if (state.acted.has(key)) return "waiting";
  if (!state.seen.has(key)) state.seen.set(key, now());
  const firstSeen = state.seen.get(key);
  // The model called this kind's confirm tool around or after the answer arrived: its result stands.
  if (toolCalls.startedSince(businessId, [spec.tool], firstSeen - settings.seenSlackMs, { answer: true })) {
    state.acted.add(key);
    return "model";
  }
  if (now() - firstSeen < settings.graceMs) return "grace";
  // Look again right before acting: the model may have started the tool while /history was read.
  if (toolCalls.inFlight(businessId, [spec.tool]) || !stillWaiting(businessId, call.agentId, subject)) return "waiting";

  state.acted.add(key);
  const ctx = { businessId, sessionId: call.sessionId ?? null, agentId: call.agentId, actor: "agent", toolScope: "owner" };
  const args = { ...spec.args(subject, kindOfAnswer), reply_language: call.language };
  let ok = true;
  let code = null;
  try {
    // The tool runs its gate on the owner's own words and says the result itself.
    await callToolImpl(ctx, spec.tool, args);
    done.set(businessId, { tool: spec.tool, at: Date.now() });
  } catch (err) {
    ok = false;
    code = err?.code ?? "INTERNAL";
    // Decided meanwhile by the model's own call: that call's result stands, nothing to correct.
    if (stillWaiting(businessId, call.agentId, subject)) await outcome.announce(ctx, outcome.notDone(call.language, err?.say));
  }
  events.emit(
    businessId,
    "confirm.watchdog",
    { kind: subject.kind, subjectId: subject.id, tool: spec.tool, answer: kindOfAnswer, turnId: answer.turnId, ok, ...(code ? { code } : {}) },
    { sessionId: call.sessionId ?? null, actor: "system" },
  );
  return "acted";
}

/* ---------------------------------------------------------------- events --- */

const SPOKEN = new Set(["approval.spoken", "invoice.spoken", "receipt.spoken", "rule.spoken", "stock.reorder_spoken"]);

function onEvent(event) {
  if (SPOKEN.has(event.type)) watch(event.businessId);
  else if (event.type === "session.ended" && event.data?.kind === "owner") {
    unwatch(event.businessId);
    done.delete(event.businessId);
  }
}

let unsubscribe = null;

/** Watch every business's live owner call. Returns stop(). */
function start() {
  if (!unsubscribe) unsubscribe = events.subscribeAll(onEvent);
  return stop;
}

function stop() {
  unsubscribe?.();
  unsubscribe = null;
  for (const businessId of [...watching.keys()]) unwatch(businessId);
  done.clear();
}

/** Tests: replace /history, the live-call lookup, the tool call and the timing. */
function configure({ history, live, callTool, pollMs, graceMs, maxAgeMs, seenSlackMs } = {}) {
  if (history) historyImpl = history;
  if (live) liveImpl = live;
  if (callTool) callToolImpl = callTool;
  Object.assign(settings, Object.fromEntries(Object.entries({ pollMs, graceMs, maxAgeMs, seenSlackMs }).filter(([, v]) => v !== undefined)));
}

module.exports = { start, stop, watch, unwatch, tick, latestWaiting, doneRecently, configure, KINDS, settings };
