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
 * Security review r2 #3: it acts only on the owner's FIRST spoken turn after the read-back, with no
 * other model line, server line or tool call in between (answerAfterSpoken), never when any tool
 * other than this question's confirm tool started after the read-back, and never on a turn that may
 * be the agent's own voice heard back (possibleEcho). Its audit row names the subject by its real
 * key (approvalId, invoiceId, receiptDraftId, ruleId, proposalId; r2 #9), so a simulated vendor's
 * deal is labelled as one (events.js).
 *
 * Live check 129a071 (2026-11-20): read-back, the owner's "शायद थोड़ा सोचने दीजिए।", no agent reply,
 * then "हाँ, ठीक है।" twice. The first answer was a maybe, so nothing could ever bind that yes, and
 * the only way back (the confirm tool's own re-read on a later yes) needs the model to call it,
 * which it never did. So when the first answer was not clear (or something else came between the
 * read-back and it), and the owner's LATEST turn after the read-back is a clear yes that the model
 * has left alone for `graceMs`, the server calls the confirm tool with that yes for the kinds that
 * re-read (`rereads`): the tool's gate still refuses it (only the first answer binds), and the tool
 * reads the question out again, exactly as when the model calls it. That approves nothing: only
 * the owner's next answer to the fresh read-back can. Audit row action "read_again".
 *
 * Every poll also notes an owner turn the agent leaves unanswered: after SILENCE_LOG_MS it logs, once,
 * the shape of the /history tail (roles, sources, turn ids, tool names; never words), as evidence of
 * where a silent agent stopped.
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
 * agent, every subject still waiting with the texts the server spoke for it and when. `rereads`: its
 * confirm tool reads the question out again for a clear yes that is not the first answer.
 */
const KINDS = {
  approval: {
    tool: "confirm_approval",
    rereads: true,
    ref: (s) => ({ approvalId: s.id }),
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
    rereads: true,
    ref: (s) => ({ invoiceId: s.invoiceId, invoiceApprovalId: s.id }),
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
    rereads: true,
    ref: (s) => ({ receiptDraftId: s.id }),
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
    ref: (s) => ({ ruleId: s.id }),
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
    ref: (s) => ({ proposalId: s.id }),
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

/**
 * True while something the server read out through this call's agent still waits for the owner's
 * answer (any watched kind, or an item's tax), read out within maxAgeMs. Nothing else may be spoken
 * into the call meanwhile (agent/speak.js, security review r2 #3); after maxAgeMs a line may be spoken,
 * and the gate then refuses that stale read-back's yes anyway (READBACK_SUPERSEDED).
 */
function readbackWaiting(businessId, agentId, now = Date.now()) {
  if (!agentId) return false;
  if (latestWaiting(businessId, agentId, now)) return true;
  const tax = require("../sell/item-tax").pendingFor(businessId, agentId);
  return Boolean(tax && now - Date.parse(tax.spoken_at) <= settings.maxAgeMs);
}

/* ------------------------------------------------------------- polling --- */

let historyImpl = (agentId) => require("./agent").history(agentId, { timeoutMs: settings.historyTimeoutMs });
let liveImpl = (businessId) => require("./narrator").liveCall(businessId);
let callToolImpl = (ctx, name, args) => require("../tools/registry").callTool(ctx, name, args);

/** businessId -> { timer, seen: Map(key -> firstSeenMs), acted: Set(key), silence: {turn, since, logged} | null } */
const watching = new Map();
/** businessId -> { tool, at }: the confirm tool the server ran last for an owner's answer. */
const done = new Map();

/**
 * True when a tool other than this subject's own confirm tool started after its read-back was spoken
 * (the confirm tool is the model answering this very question: inFlight / the "model" check handle it).
 */
function otherToolSince(businessId, subject) {
  const since = Date.parse(subject.spokenAt) + 1;
  return Number.isFinite(since) && toolCalls.startedSince(businessId, null, since, { except: [KINDS[subject.kind].tool] });
}

/** How soon after the agent stopped speaking a bare acknowledgement may be its own voice heard back. */
const ECHO_WINDOW_MS = 1500;
/** Acknowledgements that are a yes to the classifier but are also what an echo or a backchannel sounds like. */
const FILLERS = new Set(["ठीक है", "ठीक", "ओके", "okay", "ok", "alright", "all right", "fine", "theek hai", "thik hai", "ಸರಿ", "ಓಕೆ", "ಆಯ್ತು"].map(normaliseWords));

function normaliseWords(text) {
  return String(text ?? "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

/**
 * Security review r2 (reviewer's echo question): the owner's turn at `index` may be the agent's own
 * voice heard back through the owner's speaker: it repeats the agent's line just before it, or it is
 * a bare acknowledgement that started within ECHO_WINDOW_MS of that line's end. The server then leaves
 * it to the model; a real yes ("हाँ") right after the question is never taken for an echo.
 */
function possibleEcho(contents, index) {
  const said = contents[index];
  let agentLine = null;
  for (let i = index - 1; i >= 0 && !agentLine; i--) {
    const item = contents[i];
    if (item?.role === "assistant" && typeof item.content === "string" && item.content.trim()) agentLine = item;
  }
  if (!said || !agentLine) return false;
  const words = normaliseWords(said.content);
  if (words && words === normaliseWords(agentLine.content)) return true;
  const start = Number.isFinite(said.speech_start_ms) ? said.speech_start_ms : said.metadata?.speech_timing?.speech_start_ms;
  return FILLERS.has(words) && Number.isFinite(start) && Number.isFinite(agentLine.speech_end_ms) && start - agentLine.speech_end_ms < ECHO_WINDOW_MS;
}

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
    state = { timer: null, seen: new Map(), acted: new Set(), busy: false, silence: null };
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
 * `graceMs` to act), "model" (the model called the confirm tool), "acted", or "read_again" (a later
 * clear yes had the question read out again).
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
  noteSilence(state, history, now);
  let answer = null;
  let refusal = null;
  try {
    answer = approvals.answerAfterSpoken(businessId, history, { agentId: call.agentId, spoken: subject.spoken, subject: { ...subject.subject, kind: subject.kind } });
  } catch (err) {
    refusal = err?.code ?? null; // no spoken answer after the read-back yet, a typed one, or something else came first
  }
  if (!answer) return SUPERSEDED.has(refusal) ? readAgainOnLaterYes(businessId, state, call, subject, history, -1, now) : "waiting";
  const kindOfAnswer = approvals.classifyUtterance(answer.text);
  // A maybe or a question is the model's to handle; a clear yes after it gets the question read out again.
  if (kindOfAnswer !== "affirmative" && kindOfAnswer !== "negative") return readAgainOnLaterYes(businessId, state, call, subject, history, answer.index, now);
  if (possibleEcho(history, answer.index)) return "waiting"; // maybe the agent's own voice, heard back: the model decides

  const key = answerKey(subject, answer.turnId);
  const ready = readyToAct(businessId, state, call, subject, key, now);
  if (ready) return ready;
  return act(businessId, call, subject, { answer: kindOfAnswer, turnId: answer.turnId, action: "decided" });
}

/**
 * The checks before the server acts on an owner's turn (`key`), in order; returns the tick result
 * when it must not act now, or null when it may (the turn is then marked acted on).
 */
function readyToAct(businessId, state, call, subject, key, now) {
  const spec = KINDS[subject.kind];
  if (state.acted.has(key)) return "waiting";
  if (!state.seen.has(key)) state.seen.set(key, now());
  const firstSeen = state.seen.get(key);
  // The model called this kind's confirm tool around or after the answer arrived: its result stands.
  // A call that started before the read-back was spoken cannot answer it: the confirm_approval that
  // a yes to get_ranked_deals' offer reached, which itself had the deal read out (registry
  // offerAccepted), is not the model answering this read-back.
  const spokenAt = Date.parse(subject.spokenAt);
  const answeredSince = Math.max(firstSeen - settings.seenSlackMs, Number.isFinite(spokenAt) ? spokenAt : -Infinity);
  if (toolCalls.startedSince(businessId, [spec.tool], answeredSince, { answer: true })) {
    state.acted.add(key);
    return "model";
  }
  // Any other tool the model ran after the read-back means the owner's words may answer something
  // else (security review r2 #3): the server never acts on them (the model's own call still goes
  // through the gate). The tool that spoke the read-back started before it.
  if (otherToolSince(businessId, subject)) return "waiting";
  if (now() - firstSeen < settings.graceMs) return "grace";
  // Look again right before acting: the model may have started a tool while /history was read.
  if (toolCalls.inFlight(businessId, [spec.tool]) || otherToolSince(businessId, subject) || !stillWaiting(businessId, call.agentId, subject)) return "waiting";
  state.acted.add(key);
  return null;
}

/** answerAfterSpoken refusals after which a later clear yes gets the question read out again (as the confirm tools' REREAD_ON). */
const SUPERSEDED = new Set(["READBACK_SUPERSEDED", "ANSWER_DURING_READBACK"]);

/**
 * Live check 129a071: the first answer after the read-back was not a clear one (or something came
 * between the read-back and it), and the owner's latest turn since the read-back (after index
 * `after`) is a clear yes. When the model leaves it alone, the server calls the confirm tool with
 * that yes: the gate refuses it (only the first answer binds, security review r2 #3) and the tool
 * reads the question out again. Nothing is decided; the owner's next answer is the first one again.
 */
function readAgainOnLaterYes(businessId, state, call, subject, history, after, now) {
  if (!KINDS[subject.kind].rereads) return "waiting";
  const latest = approvals.lastOwnerTurnAfterSpoken(history, subject.spoken);
  if (!latest || latest.index <= after) return "waiting";
  if (approvals.classifyUtterance(latest.text) !== "affirmative") return "waiting";
  if (possibleEcho(history, latest.index)) return "waiting";
  const ready = readyToAct(businessId, state, call, subject, `${answerKey(subject, latest.turnId)}:again`, now);
  if (ready) return ready;
  return act(businessId, call, subject, { answer: "affirmative", turnId: latest.turnId, action: "read_again" });
}

/**
 * Call the subject's confirm tool for the owner's answer, through the same registry path as the
 * model, and write the audit row. "decided": the first answer, the gate decides. "read_again": a
 * later yes; the tool's own re-read speaks the question again (if the gate took it after all, the
 * row says "decided"). Returns "acted" or "read_again".
 */
async function act(businessId, call, subject, { answer, turnId, action }) {
  const spec = KINDS[subject.kind];
  const ctx = { businessId, sessionId: call.sessionId ?? null, agentId: call.agentId, actor: "agent", toolScope: "owner" };
  const args = { ...spec.args(subject, answer), reply_language: call.language };
  let ok = true;
  let code = null;
  let did = action;
  try {
    // The tool runs its gate on the owner's own words and says the result itself.
    const result = await callToolImpl(ctx, spec.tool, args);
    if (!result?.readAgain) {
      did = "decided";
      done.set(businessId, { tool: spec.tool, at: Date.now() });
    }
  } catch (err) {
    ok = false;
    code = err?.code ?? "INTERNAL";
    // Decided meanwhile by the model's own call: that call's result stands, nothing to correct.
    if (stillWaiting(businessId, call.agentId, subject)) await outcome.announce(ctx, outcome.notDone(call.language, err?.say));
  }
  events.emit(
    businessId,
    "confirm.watchdog",
    { kind: subject.kind, subjectId: subject.id, ...spec.ref(subject), tool: spec.tool, answer, turnId, action: did, ok, ...(code ? { code } : {}) },
    { sessionId: call.sessionId ?? null, actor: "system" },
  );
  return action === "read_again" ? "read_again" : "acted";
}

/* ------------------------------------------------------------ diagnostics --- */

/** How long an owner turn may stay unanswered before its /history shape is logged (once per turn). */
const SILENCE_LOG_MS = 10_000;
const TAIL_ITEMS = 8;

/** Something the agent produced: a line (any source), a tool call or a tool result. */
const agentItem = (item) => item?.role === "tool" || (item?.role === "assistant" && ((typeof item.content === "string" && item.content.trim()) || (Array.isArray(item.tool_calls) && item.tool_calls.length)));

/** The shape of the last items of /history: role:source#turn, interrupted, tool names; never any words. */
function historyTail(history) {
  return history
    .slice(-TAIL_ITEMS)
    .map((item) => {
      const turn = Number.isFinite(item?.turn_id) ? item.turn_id : "-";
      const calls = Array.isArray(item?.tool_calls) && item.tool_calls.length ? ` calls ${item.tool_calls.map((c) => String(c?.name ?? c?.function?.name ?? "?").replace(/^[A-Za-z0-9]+__/, "")).join(",")}` : "";
      const ended = Number.isFinite(item?.speech_end_ms ?? item?.metadata?.speech_timing?.speech_end_ms) ? " ended" : "";
      return `${item?.role ?? "?"}:${item?.metadata?.source ?? "-"}#${turn}${item?.metadata?.interrupted ? " interrupted" : ""}${ended}${calls}${item?.role === "tool" ? " result" : ""}`;
    })
    .join(" ");
}

/**
 * Live check 129a071: the owner's turns were transcribed and the agent said nothing for minutes.
 * Note when the latest owner turn has no agent item after it; past SILENCE_LOG_MS, log the /history
 * shape once, so a live check shows where the agent stopped (model line missing, read-back
 * interrupted, tool items, timings).
 */
function noteSilence(state, history, now) {
  let i = history.length - 1;
  while (i >= 0 && !approvals.isOwnerAsr(history[i])) i--;
  if (i < 0 || history.slice(i + 1).some(agentItem)) return;
  const turn = Number.isFinite(history[i].turn_id) ? history[i].turn_id : `at ${i}`;
  if (state.silence?.turn !== turn) {
    state.silence = { turn, since: now(), logged: false };
    return;
  }
  const waited = now() - state.silence.since;
  if (state.silence.logged || waited < SILENCE_LOG_MS) return;
  state.silence.logged = true;
  console.warn(`[confirm-watch] no agent reply ${Math.round(waited / 1000)} s after owner turn ${turn}; /history tail: ${historyTail(history)}`);
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

module.exports = { start, stop, watch, unwatch, tick, latestWaiting, readbackWaiting, possibleEcho, doneRecently, configure, KINDS, settings };
